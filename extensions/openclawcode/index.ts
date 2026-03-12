import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readRequestBodyWithLimit } from "../../src/infra/http-body.js";
import {
  OpenClawCodeChatopsStore,
  applyPullRequestReviewWebhookToSnapshot,
  applyPullRequestWebhookToSnapshot,
  buildIssueApprovalMessage,
  buildIssueEscalationMessage,
  buildOpenClawCodeRunArgv,
  buildRunRequestFromCommand,
  buildRunStatusMessage,
  decideIssueWebhookIntake,
  extractWorkflowRunFromCommandOutput,
  findLatestLocalRunStatusForIssue,
  formatIssueKey,
  formatRepoKey,
  parseChatopsCommand,
  parseChatopsIssueDraftCommand,
  parseChatopsRepoReference,
  collectLatestLocalRunStatuses,
  resolveOpenClawCodePluginConfig,
  readGitHubRepositoryOwner,
  syncIssueSnapshotFromGitHub,
  type GitHubIssueWebhookEvent,
  type GitHubPullRequestReviewWebhookEvent,
  type GitHubPullRequestWebhookEvent,
  type OpenClawCodeChatopsRepoConfig,
  type OpenClawCodeGitHubDeliveryRecord,
  type OpenClawCodeIssueStatusSnapshot,
} from "../../src/integrations/openclaw-plugin/index.js";
import { GitHubRestClient } from "../../src/openclawcode/github/index.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_WEBHOOK_MAX_BYTES = 256 * 1024;
const SUPPORTED_GITHUB_EVENTS = new Set(["issues", "pull_request", "pull_request_review"]);

let workerActive = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

type GitHubWebhookPayload =
  | GitHubIssueWebhookEvent
  | GitHubPullRequestWebhookEvent
  | GitHubPullRequestReviewWebhookEvent;

function resolveRepoConfig(
  repoConfigs: OpenClawCodeChatopsRepoConfig[],
  issue: { owner: string; repo: string },
): OpenClawCodeChatopsRepoConfig | undefined {
  return repoConfigs.find(
    (config) =>
      config.owner.toLowerCase() === issue.owner.toLowerCase() &&
      config.repo.toLowerCase() === issue.repo.toLowerCase(),
  );
}

function resolveDefaultRepoConfig(
  repoConfigs: OpenClawCodeChatopsRepoConfig[],
): OpenClawCodeChatopsRepoConfig | undefined {
  return repoConfigs.length === 1 ? repoConfigs[0] : undefined;
}

function resolveCommandNotifyTarget(ctx: {
  to?: string;
  from?: string;
  senderId?: string;
}): string | undefined {
  return ctx.to?.trim() || ctx.from?.trim() || ctx.senderId?.trim();
}

function issueKeyMatchesRepo(issueKey: string, repo: { owner: string; repo: string }): boolean {
  return issueKey.toLowerCase().startsWith(`${formatRepoKey(repo).toLowerCase()}#`);
}

function formatStageLabel(stage: string): string {
  return stage
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function trimToSingleLine(value: string | undefined): string | undefined {
  const singleLine = value
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return singleLine && singleLine.length > 0 ? singleLine : undefined;
}

function formatDeliveryReason(record: OpenClawCodeGitHubDeliveryRecord): string {
  switch (record.reason) {
    case "review-approved":
      return "review approved";
    case "review-changes-requested":
      return "review changes requested";
    case "pull-request-merged":
      return "pull request merged";
    case "pull-request-closed-without-merge":
      return "pull request closed without merge";
    default:
      return `${record.eventName}/${record.action} (${record.reason})`;
  }
}

function collectRecentLifecycleEvents(params: {
  state: Awaited<ReturnType<OpenClawCodeChatopsStore["snapshot"]>>;
  issueKey: string;
}): OpenClawCodeGitHubDeliveryRecord[] {
  return Object.values(params.state.githubDeliveriesById)
    .filter((record) => record.issueKey === params.issueKey)
    .filter((record) => record.accepted)
    .filter(
      (record) => record.eventName === "pull_request" || record.eventName === "pull_request_review",
    )
    .toSorted((left, right) => right.receivedAt.localeCompare(left.receivedAt))
    .slice(0, 2);
}

function resolveFinalDisposition(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  recentLifecycleEvents: OpenClawCodeGitHubDeliveryRecord[];
}): string {
  const latestReason = params.recentLifecycleEvents[0]?.reason;
  switch (latestReason) {
    case "pull-request-merged":
      return "merged";
    case "review-changes-requested":
      return "changes requested";
    case "review-approved":
      return "awaiting human review";
    case "pull-request-closed-without-merge":
      return "closed without merge";
    default:
      break;
  }

  switch (params.snapshot.stage) {
    case "merged":
      return "merged";
    case "changes-requested":
      return "changes requested";
    case "ready-for-human-review":
      return "awaiting human review";
    case "escalated":
      return "escalated";
    case "failed":
      return "failed";
    default:
      return formatStageLabel(params.snapshot.stage).toLowerCase();
  }
}

function buildRerunLedgerLines(params: {
  priorRunId?: string;
  priorStage?: string;
  requestedAt?: string;
  reason?: string;
}): string[] {
  if (!params.priorRunId && !params.priorStage && !params.requestedAt && !params.reason) {
    return [];
  }

  const line = `  rerun: ${[
    params.priorRunId ?? "prior run unknown",
    params.priorStage ? `from ${formatStageLabel(params.priorStage)}` : "from unknown stage",
    params.requestedAt,
  ]
    .filter(Boolean)
    .join(" | ")}`;
  const reason = trimToSingleLine(params.reason);
  return reason ? [line, `  reason: ${reason}`] : [line];
}

function buildNotificationLedgerLines(snapshot: OpenClawCodeIssueStatusSnapshot): string[] {
  if (!snapshot.lastNotificationAt && !snapshot.lastNotificationTarget) {
    return [];
  }

  const destination =
    snapshot.lastNotificationChannel && snapshot.lastNotificationTarget
      ? `${snapshot.lastNotificationChannel}:${snapshot.lastNotificationTarget}`
      : snapshot.lastNotificationTarget;
  const line = `  notify: ${[
    snapshot.lastNotificationStatus ?? "sent",
    destination,
    snapshot.lastNotificationAt,
  ]
    .filter(Boolean)
    .join(" | ")}`;
  const error = trimToSingleLine(snapshot.lastNotificationError);
  return error ? [line, `  notify-error: ${error}`] : [line];
}

function buildSuitabilityLedgerLines(snapshot: OpenClawCodeIssueStatusSnapshot): string[] {
  if (!snapshot.suitabilityDecision && !snapshot.suitabilitySummary) {
    return [];
  }
  const line = `  suitability: ${[
    snapshot.suitabilityDecision ?? "unknown",
    trimToSingleLine(snapshot.suitabilitySummary),
  ]
    .filter(Boolean)
    .join(" | ")}`;
  return [line];
}

function buildPrecheckedEscalationStatus(params: {
  issue: { owner: string; repo: string; number: number };
  summary: string;
}): string {
  const issueKey = formatIssueKey(params.issue);
  return [
    `openclawcode status for ${issueKey}`,
    "Stage: Escalated",
    `Summary: ${params.summary}`,
    "Suitability: escalate",
  ].join("\n");
}

function buildSyntheticIssueWebhookEvent(params: {
  issue: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    body?: string;
    labels?: string[];
  };
}): GitHubIssueWebhookEvent {
  return {
    action: "opened",
    repository: {
      owner: params.issue.owner,
      name: params.issue.repo,
    },
    issue: {
      number: params.issue.number,
      title: params.issue.title,
      body: params.issue.body,
      labels: (params.issue.labels ?? []).map((name) => ({ name })),
    },
  };
}

async function recordPrecheckedEscalationSnapshot(params: {
  store: OpenClawCodeChatopsStore;
  issue: {
    owner: string;
    repo: string;
    number: number;
  };
  destination: {
    channel: string;
    target: string;
  };
  summary: string;
  suitabilityDecision: "escalate";
}): Promise<boolean> {
  const timestamp = new Date().toISOString();
  return await params.store.recordPrecheckedEscalation({
    issueKey: formatIssueKey(params.issue),
    status: buildPrecheckedEscalationStatus({
      issue: params.issue,
      summary: params.summary,
    }),
    stage: "escalated",
    runId: `intake-precheck-${params.issue.number}`,
    updatedAt: timestamp,
    owner: params.issue.owner,
    repo: params.issue.repo,
    issueNumber: params.issue.number,
    notifyChannel: params.destination.channel,
    notifyTarget: params.destination.target,
    suitabilityDecision: params.suitabilityDecision,
    suitabilitySummary: params.summary,
  });
}

async function enqueueInteractiveIssueIntake(params: {
  store: OpenClawCodeChatopsStore;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  issue: {
    owner: string;
    repo: string;
    number: number;
  };
  destination: {
    channel: string;
    target: string;
  };
  status: string;
}): Promise<Awaited<ReturnType<OpenClawCodeChatopsStore["promotePendingApprovalToQueue"]>>> {
  return await params.store.promotePendingApprovalToQueue({
    issueKey: formatIssueKey(params.issue),
    request: buildRunRequestFromCommand({
      command: {
        action: "start",
        issue: {
          owner: params.issue.owner,
          repo: params.issue.repo,
          number: params.issue.number,
        },
      },
      config: params.repoConfig,
    }),
    fallbackNotifyChannel: params.destination.channel,
    fallbackNotifyTarget: params.destination.target,
    status: params.status,
  });
}

function buildIntakeQueuedMessage(params: {
  issue: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    url?: string;
  };
}): string {
  const issueKey = formatIssueKey(params.issue);
  return [
    "openclawcode created and queued a new GitHub issue from chat.",
    `Issue: ${issueKey}`,
    `Title: ${params.issue.title}`,
    params.issue.url ? `URL: ${params.issue.url}` : undefined,
    "Status: queued for execution",
    `Use /occode-status ${issueKey} to inspect progress.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildIntakeEscalatedMessage(params: {
  issue: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    url?: string;
  };
  summary: string;
}): string {
  const issueKey = formatIssueKey(params.issue);
  return [
    "openclawcode created a new GitHub issue from chat, but suitability escalated it immediately.",
    `Issue: ${issueKey}`,
    `Title: ${params.issue.title}`,
    params.issue.url ? `URL: ${params.issue.url}` : undefined,
    `Summary: ${params.summary}`,
    `Use /occode-status ${issueKey} to inspect the tracked status.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildInboxMessage(params: {
  repo: { owner: string; repo: string };
  state: Awaited<ReturnType<OpenClawCodeChatopsStore["snapshot"]>>;
}): string {
  const repoKey = formatRepoKey(params.repo);
  const pending = params.state.pendingApprovals.filter((entry) =>
    issueKeyMatchesRepo(entry.issueKey, params.repo),
  );
  const running =
    params.state.currentRun && issueKeyMatchesRepo(params.state.currentRun.issueKey, params.repo)
      ? [params.state.currentRun]
      : [];
  const queued = params.state.queue.filter((entry) =>
    issueKeyMatchesRepo(entry.issueKey, params.repo),
  );
  const activeIssueKeys = new Set([
    ...pending.map((entry) => entry.issueKey),
    ...running.map((entry) => entry.issueKey),
    ...queued.map((entry) => entry.issueKey),
  ]);
  const recent = Object.values(params.state.statusSnapshotsByIssue)
    .filter((snapshot) => issueKeyMatchesRepo(snapshot.issueKey, params.repo))
    .filter((snapshot) => !activeIssueKeys.has(snapshot.issueKey))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5);

  const lines = [`openclawcode inbox for ${repoKey}`];

  if (pending.length > 0) {
    lines.push(`Pending approvals: ${pending.length}`);
    for (const entry of pending) {
      lines.push(
        `- ${entry.issueKey} | ${
          trimToSingleLine(params.state.statusByIssue[entry.issueKey]) ?? "Awaiting chat approval."
        }`,
      );
    }
  } else {
    lines.push("Pending approvals: 0");
  }

  if (running.length > 0) {
    lines.push(`Running: ${running.length}`);
    for (const entry of running) {
      lines.push(
        `- ${entry.issueKey} | ${
          trimToSingleLine(params.state.statusByIssue[entry.issueKey]) ?? "Running."
        }`,
      );
      lines.push(
        ...buildRerunLedgerLines({
          priorRunId: entry.request.rerunContext?.priorRunId,
          priorStage: entry.request.rerunContext?.priorStage,
          requestedAt: entry.request.rerunContext?.requestedAt,
          reason: entry.request.rerunContext?.reason,
        }),
      );
    }
  } else {
    lines.push("Running: 0");
  }

  if (queued.length > 0) {
    lines.push(`Queued: ${queued.length}`);
    for (const entry of queued) {
      lines.push(
        `- ${entry.issueKey} | ${trimToSingleLine(params.state.statusByIssue[entry.issueKey]) ?? "Queued."}`,
      );
      lines.push(
        ...buildRerunLedgerLines({
          priorRunId: entry.request.rerunContext?.priorRunId,
          priorStage: entry.request.rerunContext?.priorStage,
          requestedAt: entry.request.rerunContext?.requestedAt,
          reason: entry.request.rerunContext?.reason,
        }),
      );
    }
  } else {
    lines.push("Queued: 0");
  }

  if (recent.length > 0) {
    lines.push(`Recent ledger: ${recent.length}`);
    for (const entry of recent) {
      const recentLifecycleEvents = collectRecentLifecycleEvents({
        state: params.state,
        issueKey: entry.issueKey,
      });
      lines.push(
        [
          `- ${entry.issueKey}`,
          formatStageLabel(entry.stage),
          `final: ${resolveFinalDisposition({
            snapshot: entry,
            recentLifecycleEvents,
          })}`,
          entry.pullRequestNumber ? `PR #${entry.pullRequestNumber}` : undefined,
          entry.updatedAt,
        ]
          .filter(Boolean)
          .join(" | "),
      );
      if (recentLifecycleEvents.length > 0) {
        lines.push(
          `  events: ${recentLifecycleEvents
            .map((record) => `${formatDeliveryReason(record)} @ ${record.receivedAt}`)
            .join("; ")}`,
        );
      }
      lines.push(...buildSuitabilityLedgerLines(entry));
      lines.push(
        ...buildRerunLedgerLines({
          priorRunId: entry.rerunPriorRunId,
          priorStage: entry.rerunPriorStage,
          requestedAt: entry.rerunRequestedAt,
          reason: entry.rerunReason,
        }),
      );
      lines.push(...buildNotificationLedgerLines(entry));
    }
  } else {
    lines.push("Recent ledger: 0");
  }

  return lines.join("\n");
}

function summarizeFailure(stderr: string, stdout: string): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  if (!combined) {
    return "Command failed without output.";
  }
  const lines = combined.split("\n").filter(Boolean);
  return lines.slice(-8).join("\n");
}

async function reconcileLocalRunStatuses(params: {
  store: OpenClawCodeChatopsStore;
  repoConfigs: OpenClawCodeChatopsRepoConfig[];
}): Promise<void> {
  const records: Array<{
    issueKey: string;
    status: string;
    run: Awaited<ReturnType<typeof collectLatestLocalRunStatuses>>[number]["run"];
  }> = [];
  for (const repo of params.repoConfigs) {
    const repoRecords = await collectLatestLocalRunStatuses(repo);
    for (const record of repoRecords) {
      records.push(record);
    }
  }
  await params.store.reconcileWorkflowRunStatuses(records);
}

async function syncSnapshotsFromGitHub(store: OpenClawCodeChatopsStore): Promise<{
  checked: number;
  changed: number;
  failed: number;
}> {
  const snapshotState = await store.snapshot();
  let checked = 0;
  let changed = 0;
  let failed = 0;

  for (const snapshot of Object.values(snapshotState.statusSnapshotsByIssue)) {
    checked += 1;
    try {
      const synced = await syncIssueSnapshotFromGitHub({ snapshot });
      if (!synced.changed) {
        continue;
      }
      await store.setStatusSnapshot(synced.snapshot);
      changed += 1;
    } catch {
      failed += 1;
    }
  }

  return { checked, changed, failed };
}

async function sendText(params: {
  api: OpenClawPluginApi;
  channel: string;
  target: string;
  text: string;
}): Promise<void> {
  const { runMessageAction } = await import("../../src/infra/outbound/message-action-runner.js");
  await runMessageAction({
    cfg: params.api.config,
    action: "send",
    params: {
      channel: params.channel,
      to: params.target,
      message: params.text,
    },
  });
}

function scheduleNotification(params: {
  api: OpenClawPluginApi;
  channel: string;
  target: string;
  text: string;
}): void {
  void sendText(params).catch((error) => {
    params.api.logger.warn(
      `openclawcode notification failed for ${params.channel}:${params.target}: ${String(error)}`,
    );
  });
}

async function sendIssueNotification(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  issueKey: string;
  channel: string;
  target: string;
  text: string;
}): Promise<void> {
  const notifiedAt = new Date().toISOString();
  try {
    await sendText(params);
    await params.store.recordSnapshotNotification({
      issueKey: params.issueKey,
      notifyChannel: params.channel,
      notifyTarget: params.target,
      notifiedAt,
      status: "sent",
    });
  } catch (error) {
    await params.store.recordSnapshotNotification({
      issueKey: params.issueKey,
      notifyChannel: params.channel,
      notifyTarget: params.target,
      notifiedAt,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function scheduleIssueNotification(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  issueKey: string;
  channel: string;
  target: string;
  text: string;
}): void {
  void sendIssueNotification(params).catch((error) => {
    params.api.logger.warn(
      `openclawcode notification failed for ${params.channel}:${params.target}: ${String(error)}`,
    );
  });
}

function resolveNotificationDestination(params: {
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  snapshot?: OpenClawCodeIssueStatusSnapshot;
}): {
  channel: string;
  target: string;
} {
  return {
    channel:
      params.snapshot?.notifyChannel ??
      params.binding?.notifyChannel ??
      params.repoConfig.notifyChannel,
    target:
      params.snapshot?.notifyTarget ??
      params.binding?.notifyTarget ??
      params.repoConfig.notifyTarget,
  };
}

function resolveInteractiveNotificationDestination(params: {
  ctx: {
    channel?: string;
    to?: string;
    from?: string;
    senderId?: string;
  };
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  snapshot?: OpenClawCodeIssueStatusSnapshot;
}): {
  channel: string;
  target: string;
} {
  const currentTarget = resolveCommandNotifyTarget(params.ctx);
  if (currentTarget) {
    return {
      channel:
        params.ctx.channel?.trim() ||
        params.snapshot?.notifyChannel ||
        params.binding?.notifyChannel ||
        params.repoConfig.notifyChannel,
      target: currentTarget,
    };
  }

  return resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
    snapshot: params.snapshot,
  });
}

function extractStatusSummary(status: string): string | undefined {
  const summaryLine = status
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("Summary: "));
  if (!summaryLine) {
    return undefined;
  }
  const summary = summaryLine.slice("Summary: ".length).trim();
  return summary.length > 0 ? summary : undefined;
}

function resolveRerunReason(snapshot: OpenClawCodeIssueStatusSnapshot): string {
  const preferLatestReviewSummary =
    snapshot.stage === "changes-requested" ||
    (snapshot.stage === "ready-for-human-review" && snapshot.latestReviewDecision === "approved");
  return (
    (preferLatestReviewSummary ? snapshot.latestReviewSummary : undefined) ??
    extractStatusSummary(snapshot.status) ??
    snapshot.latestReviewSummary ??
    `Manual rerun requested from ${formatStageLabel(snapshot.stage)} state.`
  );
}

function resolveGithubSecret(
  pluginConfig: Record<string, unknown> | undefined,
): string | undefined {
  const resolved = resolveOpenClawCodePluginConfig(pluginConfig);
  const envName = resolved.githubWebhookSecretEnv;
  if (!envName) {
    return undefined;
  }
  const value = process.env[envName];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function verifyGithubSignature(params: {
  body: string;
  req: IncomingMessage;
  secret?: string;
}): boolean {
  if (!params.secret) {
    return true;
  }
  const provided = params.req.headers["x-hub-signature-256"];
  const signature = Array.isArray(provided) ? provided[0] : provided;
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
    return false;
  }
  const digest = crypto.createHmac("sha256", params.secret).update(params.body).digest("hex");
  return timingSafeEqualHex(signature, `sha256=${digest}`);
}

function readSingleHeaderValue(
  headers: IncomingMessage["headers"],
  name: string,
): string | undefined {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function handleIssueWebhookEvent(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  payload: GitHubIssueWebhookEvent;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  respondJson: (params: {
    accepted: boolean;
    reason: string;
    issue?: string;
    pullRequestNumber?: number;
    statusCode?: number;
    recordDelivery?: boolean;
    extra?: Record<string, unknown>;
  }) => Promise<boolean>;
}): Promise<boolean> {
  const decision = decideIssueWebhookIntake({
    event: params.payload,
    config: params.repoConfig,
  });
  if (!decision.accept || !decision.issue) {
    return await params.respondJson({
      accepted: false,
      reason: decision.reason,
    });
  }

  const issueKey = formatIssueKey(decision.issue);
  const destination = resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
  });
  if (decision.precheck?.decision === "escalate") {
    const accepted = await recordPrecheckedEscalationSnapshot({
      store: params.store,
      issue: decision.issue,
      destination,
      summary: decision.precheck.summary,
      suitabilityDecision: decision.precheck.decision,
    });
    if (!accepted) {
      return await params.respondJson({
        accepted: false,
        reason: "already-tracked",
        issue: issueKey,
      });
    }
    scheduleNotification({
      api: params.api,
      channel: destination.channel,
      target: destination.target,
      text: buildIssueEscalationMessage({
        issue: decision.issue,
        summary: decision.precheck.summary,
        reasons: decision.precheck.reasons,
      }),
    });
    return await params.respondJson({
      accepted: true,
      reason: "precheck-escalated",
      issue: issueKey,
      extra: {
        suitabilityDecision: decision.precheck.decision,
      },
    });
  }

  if (params.repoConfig.triggerMode === "auto") {
    const enqueued = await enqueueInteractiveIssueIntake({
      store: params.store,
      repoConfig: params.repoConfig,
      issue: decision.issue,
      destination,
      status: "Auto-started from issue webhook.",
    });
    if (!enqueued) {
      return await params.respondJson({
        accepted: false,
        reason: "already-tracked",
        issue: issueKey,
      });
    }
    scheduleNotification({
      api: params.api,
      channel: destination.channel,
      target: destination.target,
      text: [
        "openclawcode auto-started a new GitHub issue.",
        `Issue: ${issueKey}`,
        `Title: ${decision.issue.title}`,
        "Mode: auto",
        "Status: queued for execution",
      ].join("\n"),
    });
  } else {
    const approvalMessage = buildIssueApprovalMessage({
      issue: decision.issue,
      config: params.repoConfig,
    });
    const accepted = await params.store.addPendingApproval({
      issueKey,
      notifyChannel: destination.channel,
      notifyTarget: destination.target,
    });
    if (!accepted) {
      return await params.respondJson({
        accepted: false,
        reason: "already-tracked",
        issue: issueKey,
      });
    }
    scheduleNotification({
      api: params.api,
      channel: destination.channel,
      target: destination.target,
      text: approvalMessage,
    });
  }

  return await params.respondJson({
    accepted: true,
    reason: params.repoConfig.triggerMode === "auto" ? "auto-enqueued" : "announced-for-approval",
    issue: issueKey,
  });
}

async function handlePullRequestWebhookEvent(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  payload: GitHubPullRequestWebhookEvent;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  respondJson: (params: {
    accepted: boolean;
    reason: string;
    issue?: string;
    pullRequestNumber?: number;
    statusCode?: number;
    recordDelivery?: boolean;
    extra?: Record<string, unknown>;
  }) => Promise<boolean>;
}): Promise<boolean> {
  const snapshot = await params.store.findStatusSnapshotByPullRequest({
    owner: params.repoConfig.owner,
    repo: params.repoConfig.repo,
    pullRequestNumber: params.payload.pull_request.number,
  });
  if (!snapshot) {
    return await params.respondJson({
      accepted: false,
      reason: "untracked-pull-request",
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  const applied = applyPullRequestWebhookToSnapshot({
    snapshot,
    event: params.payload,
  });
  if (!applied.accepted || !applied.snapshot) {
    return await params.respondJson({
      accepted: false,
      reason: applied.reason,
      issue: snapshot.issueKey,
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  await params.store.setStatusSnapshot(applied.snapshot);
  const destination = resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
    snapshot: applied.snapshot,
  });
  scheduleIssueNotification({
    api: params.api,
    store: params.store,
    issueKey: applied.snapshot.issueKey,
    channel: destination.channel,
    target: destination.target,
    text: applied.snapshot.status,
  });
  return await params.respondJson({
    accepted: true,
    reason: applied.reason,
    issue: applied.snapshot.issueKey,
    pullRequestNumber: params.payload.pull_request.number,
  });
}

async function handlePullRequestReviewWebhookEvent(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  payload: GitHubPullRequestReviewWebhookEvent;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  respondJson: (params: {
    accepted: boolean;
    reason: string;
    issue?: string;
    pullRequestNumber?: number;
    statusCode?: number;
    recordDelivery?: boolean;
    extra?: Record<string, unknown>;
  }) => Promise<boolean>;
}): Promise<boolean> {
  const snapshot = await params.store.findStatusSnapshotByPullRequest({
    owner: params.repoConfig.owner,
    repo: params.repoConfig.repo,
    pullRequestNumber: params.payload.pull_request.number,
  });
  if (!snapshot) {
    return await params.respondJson({
      accepted: false,
      reason: "untracked-pull-request",
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  const applied = applyPullRequestReviewWebhookToSnapshot({
    snapshot,
    event: params.payload,
  });
  if (!applied.accepted || !applied.snapshot) {
    return await params.respondJson({
      accepted: false,
      reason: applied.reason,
      issue: snapshot.issueKey,
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  await params.store.setStatusSnapshot(applied.snapshot);
  const destination = resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
    snapshot: applied.snapshot,
  });
  scheduleIssueNotification({
    api: params.api,
    store: params.store,
    issueKey: applied.snapshot.issueKey,
    channel: destination.channel,
    target: destination.target,
    text: applied.snapshot.status,
  });
  return await params.respondJson({
    accepted: true,
    reason: applied.reason,
    issue: applied.snapshot.issueKey,
    pullRequestNumber: params.payload.pull_request.number,
  });
}

async function handleGithubWebhook(
  api: OpenClawPluginApi,
  store: OpenClawCodeChatopsStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  const githubEvent = readSingleHeaderValue(req.headers, "x-github-event");
  const githubDeliveryId = readSingleHeaderValue(req.headers, "x-github-delivery");
  if (!githubEvent || !SUPPORTED_GITHUB_EVENTS.has(githubEvent)) {
    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ accepted: false, reason: "ignored-event" }));
    return true;
  }

  let rawBody: string;
  try {
    rawBody = await readRequestBodyWithLimit(req, { maxBytes: DEFAULT_WEBHOOK_MAX_BYTES });
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(error instanceof Error ? error.message : String(error));
    return true;
  }

  if (
    !verifyGithubSignature({
      body: rawBody,
      req,
      secret: resolveGithubSecret(api.pluginConfig),
    })
  ) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid signature");
    return true;
  }

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid JSON");
    return true;
  }

  const respondJson = async (params: {
    accepted: boolean;
    reason: string;
    issue?: string;
    pullRequestNumber?: number;
    statusCode?: number;
    recordDelivery?: boolean;
    extra?: Record<string, unknown>;
  }): Promise<boolean> => {
    if (githubDeliveryId && params.recordDelivery !== false) {
      await store.recordGitHubDelivery({
        deliveryId: githubDeliveryId,
        eventName: githubEvent,
        action: payload.action,
        accepted: params.accepted,
        reason: params.reason,
        receivedAt: new Date().toISOString(),
        issueKey: params.issue,
        pullRequestNumber: params.pullRequestNumber,
      });
    }
    res.statusCode = params.statusCode ?? 202;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        accepted: params.accepted,
        reason: params.reason,
        issue: params.issue,
        pullRequest: params.pullRequestNumber,
        ...params.extra,
      }),
    );
    return true;
  };

  if (githubDeliveryId) {
    const existingDelivery = await store.getGitHubDelivery(githubDeliveryId);
    if (existingDelivery) {
      return await respondJson({
        accepted: false,
        reason: "duplicate-delivery",
        issue: existingDelivery.issueKey,
        pullRequestNumber: existingDelivery.pullRequestNumber,
        recordDelivery: false,
        extra: {
          delivery: githubDeliveryId,
          previousReason: existingDelivery.reason,
        },
      });
    }
  }

  const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
  const repositoryOwner = readGitHubRepositoryOwner(payload.repository.owner);
  if (!repositoryOwner) {
    return await respondJson({
      accepted: false,
      reason: "invalid-repository-owner",
    });
  }
  const matchingRepo = resolveRepoConfig(pluginConfig.repos, {
    owner: repositoryOwner,
    repo: payload.repository.name,
  });
  if (!matchingRepo) {
    return await respondJson({
      accepted: false,
      reason: "unconfigured-repo",
    });
  }

  const repoKey = formatRepoKey({
    owner: matchingRepo.owner,
    repo: matchingRepo.repo,
  });
  const binding = await store.getRepoBinding(repoKey);
  if (githubEvent === "issues") {
    return await handleIssueWebhookEvent({
      api,
      store,
      payload: payload as GitHubIssueWebhookEvent,
      repoConfig: matchingRepo,
      binding,
      respondJson,
    });
  }

  if (githubEvent === "pull_request") {
    return await handlePullRequestWebhookEvent({
      api,
      store,
      payload: payload as GitHubPullRequestWebhookEvent,
      repoConfig: matchingRepo,
      binding,
      respondJson,
    });
  }

  if (githubEvent === "pull_request_review") {
    return await handlePullRequestReviewWebhookEvent({
      api,
      store,
      payload: payload as GitHubPullRequestReviewWebhookEvent,
      repoConfig: matchingRepo,
      binding,
      respondJson,
    });
  }

  return await respondJson({
    accepted: false,
    reason: "ignored-event",
  });
}

function buildRepoConfigFromRunRequest(
  request: Parameters<typeof buildOpenClawCodeRunArgv>[0],
): OpenClawCodeChatopsRepoConfig {
  return {
    owner: request.owner,
    repo: request.repo,
    repoRoot: request.repoRoot,
    baseBranch: request.baseBranch,
    notifyChannel: "unknown",
    notifyTarget: "unknown",
    builderAgent: request.builderAgent,
    verifierAgent: request.verifierAgent,
    testCommands: request.testCommands,
    openPullRequest: request.openPullRequest,
    mergeOnApprove: request.mergeOnApprove,
  };
}

async function recoverTrackedRunStatus(params: {
  store: OpenClawCodeChatopsStore;
  queuedRun: NonNullable<Awaited<ReturnType<OpenClawCodeChatopsStore["startNext"]>>>;
  startedAt: string;
  fallbackStatus: string;
}): Promise<{
  status: string;
  recovered: boolean;
}> {
  const reconciled = await findLatestLocalRunStatusForIssue({
    repo: buildRepoConfigFromRunRequest(params.queuedRun.request),
    issueKey: params.queuedRun.issueKey,
  });
  const isFresh =
    reconciled &&
    (reconciled.run.createdAt >= params.startedAt || reconciled.run.updatedAt >= params.startedAt);
  if (!reconciled || !isFresh) {
    await params.store.finishCurrent(params.queuedRun.issueKey, params.fallbackStatus);
    return {
      status: params.fallbackStatus,
      recovered: false,
    };
  }

  await params.store.finishCurrent(params.queuedRun.issueKey, reconciled.status);
  await params.store.recordWorkflowRunStatus(reconciled.run, reconciled.status, {
    notifyChannel: params.queuedRun.notifyChannel,
    notifyTarget: params.queuedRun.notifyTarget,
  });
  return {
    status: reconciled.status,
    recovered: true,
  };
}

async function processNextQueuedRun(
  api: OpenClawPluginApi,
  store: OpenClawCodeChatopsStore,
): Promise<void> {
  if (workerActive) {
    return;
  }
  const next = await store.startNext();
  if (!next) {
    return;
  }

  workerActive = true;
  const startedAt = new Date().toISOString();
  try {
    await sendText({
      api,
      channel: next.notifyChannel,
      target: next.notifyTarget,
      text: `openclawcode is starting ${next.issueKey}.`,
    });

    const argv = buildOpenClawCodeRunArgv(next.request);
    const result = await api.runtime.system.runCommandWithTimeout(argv, {
      cwd: next.request.repoRoot,
      timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      noOutputTimeoutMs: 10 * 60_000,
    });

    if (result.code !== 0) {
      const failure = summarizeFailure(result.stderr, result.stdout);
      const recovered = await recoverTrackedRunStatus({
        store,
        queuedRun: next,
        startedAt,
        fallbackStatus: `Failed.\n${failure}`,
      });
      if (recovered.recovered) {
        await sendIssueNotification({
          api,
          store,
          issueKey: next.issueKey,
          channel: next.notifyChannel,
          target: next.notifyTarget,
          text: recovered.status,
        }).catch(() => undefined);
      } else {
        await sendText({
          api,
          channel: next.notifyChannel,
          target: next.notifyTarget,
          text: `openclawcode failed on ${next.issueKey}.\n${failure}`,
        });
      }
      return;
    }

    const run = extractWorkflowRunFromCommandOutput(result.stdout);
    if (!run) {
      const recovered = await recoverTrackedRunStatus({
        store,
        queuedRun: next,
        startedAt,
        fallbackStatus: "Completed, but workflow JSON could not be parsed.",
      });
      if (recovered.recovered) {
        await sendIssueNotification({
          api,
          store,
          issueKey: next.issueKey,
          channel: next.notifyChannel,
          target: next.notifyTarget,
          text: recovered.status,
        }).catch(() => undefined);
      } else {
        await sendText({
          api,
          channel: next.notifyChannel,
          target: next.notifyTarget,
          text: `openclawcode finished ${next.issueKey}, but could not parse the workflow JSON output.`,
        });
      }
      return;
    }

    const statusMessage = buildRunStatusMessage(run);
    await store.finishCurrent(next.issueKey, statusMessage);
    await store.recordWorkflowRunStatus(run, statusMessage, {
      notifyChannel: next.notifyChannel,
      notifyTarget: next.notifyTarget,
    });
    await sendIssueNotification({
      api,
      store,
      issueKey: next.issueKey,
      channel: next.notifyChannel,
      target: next.notifyTarget,
      text: statusMessage,
    }).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const recovered = await recoverTrackedRunStatus({
      store,
      queuedRun: next,
      startedAt,
      fallbackStatus: `Failed.\n${message}`,
    });
    if (recovered.recovered) {
      await sendIssueNotification({
        api,
        store,
        issueKey: next.issueKey,
        channel: next.notifyChannel,
        target: next.notifyTarget,
        text: recovered.status,
      }).catch(() => undefined);
    } else {
      await sendText({
        api,
        channel: next.notifyChannel,
        target: next.notifyTarget,
        text: `openclawcode failed on ${next.issueKey}.\n${message}`,
      }).catch(() => undefined);
    }
  } finally {
    workerActive = false;
  }
}

export default {
  id: "openclawcode",
  name: "OpenClawCode",
  description: "GitHub issue chatops adapter for the openclawcode workflow.",
  register(api: OpenClawPluginApi) {
    const store = OpenClawCodeChatopsStore.fromStateDir(api.runtime.state.resolveStateDir());

    api.registerHttpRoute({
      path: "/plugins/openclawcode/github",
      auth: "plugin",
      handler: async (req, res) => await handleGithubWebhook(api, store, req, res),
    });

    api.registerCommand({
      name: "occode-intake",
      description: "Create a GitHub issue from chat and queue it for openclawcode execution.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const command = parseChatopsIssueDraftCommand(ctx.commandBody, {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!command) {
          return {
            text: [
              "Usage: /occode-intake owner/repo",
              "[issue title]",
              "[issue body...]",
              "Or, when exactly one repo is configured:",
              "/occode-intake",
              "[issue title]",
              "[issue body...]",
            ].join("\n"),
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, command.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${command.repo.owner}/${command.repo.repo}.`,
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(command.repo));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
        });
        const github = new GitHubRestClient();
        let createdIssue: Awaited<ReturnType<GitHubRestClient["createIssue"]>>;
        try {
          createdIssue = await github.createIssue({
            owner: repoConfig.owner,
            repo: repoConfig.repo,
            title: command.draft.title,
            body: command.draft.body,
          });
        } catch (error) {
          return {
            text: `Failed to create a GitHub issue for ${repoConfig.owner}/${repoConfig.repo}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
        const decision = decideIssueWebhookIntake({
          event: buildSyntheticIssueWebhookEvent({ issue: createdIssue }),
          config: {
            ...repoConfig,
            triggerLabels: [],
            skipLabels: [],
          },
        });
        const issueKey = formatIssueKey(createdIssue);
        if (!decision.accept || !decision.issue) {
          return {
            text: [
              `Created GitHub issue ${issueKey}.`,
              createdIssue.url,
              `Automatic intake was skipped: ${decision.reason}`,
              `Use /occode-start ${issueKey} if you want to run it manually.`,
            ].join("\n"),
          };
        }

        if (decision.precheck?.decision === "escalate") {
          const accepted = await recordPrecheckedEscalationSnapshot({
            store,
            issue: decision.issue,
            destination,
            summary: decision.precheck.summary,
            suitabilityDecision: decision.precheck.decision,
          });
          if (!accepted) {
            return {
              text: [
                `Created GitHub issue ${issueKey}.`,
                createdIssue.url,
                (await store.getStatus(issueKey)) ?? `${issueKey} is already tracked.`,
              ].join("\n"),
            };
          }
          return {
            text: buildIntakeEscalatedMessage({
              issue: createdIssue,
              summary: decision.precheck.summary,
            }),
          };
        }

        const queued = await enqueueInteractiveIssueIntake({
          store,
          repoConfig,
          issue: decision.issue,
          destination,
          status: "Queued from chat intake.",
        });
        if (!queued) {
          return {
            text: [
              `Created GitHub issue ${issueKey}.`,
              createdIssue.url,
              (await store.getStatus(issueKey)) ?? `${issueKey} is already queued or running.`,
            ].join("\n"),
          };
        }

        return {
          text: buildIntakeQueuedMessage({
            issue: createdIssue,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-start",
      description: "Queue an openclawcode issue run.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const command = parseChatopsCommand(`/occode-start ${ctx.args ?? ""}`, {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!command) {
          return {
            text:
              "Usage: /occode-start owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-start #123",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, command.issue);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${command.issue.owner}/${command.issue.repo}.`,
          };
        }

        const issueKey = formatIssueKey({
          owner: command.issue.owner,
          repo: command.issue.repo,
          number: command.issue.number,
        });
        const currentStatus = await store.getStatus(issueKey);
        const pendingApproval = await store.getPendingApproval(issueKey);
        if (await store.isQueuedOrRunning(issueKey)) {
          return { text: `${issueKey} is already in progress.\n${currentStatus ?? "Queued."}` };
        }

        const request = buildRunRequestFromCommand({
          command,
          config: repoConfig,
        });
        const notifyTarget =
          resolveCommandNotifyTarget(ctx) ||
          ctx.senderId?.trim() ||
          pendingApproval?.notifyTarget ||
          repoConfig.notifyTarget;
        const queuedRun = await store.promotePendingApprovalToQueue({
          issueKey,
          request,
          fallbackNotifyChannel: pendingApproval?.notifyChannel ?? repoConfig.notifyChannel,
          fallbackNotifyTarget: notifyTarget,
          status: pendingApproval ? "Approved in chat and queued." : "Queued.",
        });
        if (!queuedRun) {
          return { text: `${issueKey} is already queued or running.` };
        }

        return { text: `Queued ${issueKey}. I will post status updates here.` };
      },
    });

    api.registerCommand({
      name: "occode-rerun",
      description: "Queue an explicit rerun for a tracked openclawcode issue.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const command = parseChatopsCommand(`/occode-rerun ${ctx.args ?? ""}`, {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!command) {
          return {
            text:
              "Usage: /occode-rerun owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-rerun #123",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, command.issue);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${command.issue.owner}/${command.issue.repo}.`,
          };
        }

        const issueKey = formatIssueKey({
          owner: command.issue.owner,
          repo: command.issue.repo,
          number: command.issue.number,
        });
        const currentStatus = await store.getStatus(issueKey);
        if (await store.isQueuedOrRunning(issueKey)) {
          return { text: `${issueKey} is already in progress.\n${currentStatus ?? "Queued."}` };
        }
        if (await store.isPendingApproval(issueKey)) {
          return {
            text: [
              `${issueKey} is still waiting for its initial approved run.`,
              `Use /occode-start ${issueKey} to begin the first workflow execution.`,
            ].join("\n"),
          };
        }

        const snapshot = await store.getStatusSnapshot(issueKey);
        if (!snapshot) {
          return {
            text: [
              `No tracked openclawcode run found for ${issueKey}.`,
              `Use /occode-start ${issueKey} for the first run.`,
            ].join("\n"),
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(command.issue));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
          snapshot,
        });
        const request = buildRunRequestFromCommand({
          command,
          config: repoConfig,
          rerunContext: {
            reason: resolveRerunReason(snapshot),
            requestedAt: new Date().toISOString(),
            priorRunId: snapshot.runId,
            priorStage: snapshot.stage,
            reviewDecision: snapshot.latestReviewDecision,
            reviewSubmittedAt: snapshot.latestReviewSubmittedAt,
            reviewSummary: snapshot.latestReviewSummary,
            reviewUrl: snapshot.latestReviewUrl,
          },
        });
        const stageLabel = formatStageLabel(snapshot.stage);
        const queued = await store.enqueue(
          {
            issueKey,
            notifyChannel: destination.channel,
            notifyTarget: destination.target,
            request,
          },
          `Queued rerun from ${stageLabel} state.`,
        );
        if (!queued) {
          return { text: `${issueKey} is already queued or running.` };
        }

        return {
          text: `Queued rerun for ${issueKey} from ${stageLabel} state. I will post status updates here.`,
        };
      },
    });

    api.registerCommand({
      name: "occode-bind",
      description: "Bind the current chat as the notification target for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const repo = parseChatopsRepoReference(ctx.args ?? "", {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!repo) {
          return {
            text:
              "Usage: /occode-bind owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-bind",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const notifyTarget = resolveCommandNotifyTarget(ctx);
        if (!notifyTarget) {
          return {
            text: "This chat session did not expose a reply target, so I could not save a binding.",
          };
        }

        const binding = await store.setRepoBinding({
          repoKey: formatRepoKey(repo),
          notifyChannel: ctx.channel?.trim() || repoConfig.notifyChannel,
          notifyTarget,
        });
        return {
          text: [
            `Bound ${binding.repoKey} notifications to this chat.`,
            `Channel: ${binding.notifyChannel}`,
            `Target: ${binding.notifyTarget}`,
          ].join("\n"),
        };
      },
    });

    api.registerCommand({
      name: "occode-unbind",
      description: "Remove the saved notification target binding for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const repo = parseChatopsRepoReference(ctx.args ?? "", {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!repo) {
          return {
            text:
              "Usage: /occode-unbind owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-unbind",
          };
        }

        const repoKey = formatRepoKey(repo);
        return (await store.removeRepoBinding(repoKey))
          ? { text: `Removed notification binding for ${repoKey}.` }
          : { text: `No saved notification binding found for ${repoKey}.` };
      },
    });

    api.registerCommand({
      name: "occode-status",
      description: "Show the latest known openclawcode issue status.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const command = parseChatopsCommand(`/occode-status ${ctx.args ?? ""}`, {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!command) {
          return {
            text:
              "Usage: /occode-status owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-status #123",
          };
        }

        const issueKey = formatIssueKey({
          owner: command.issue.owner,
          repo: command.issue.repo,
          number: command.issue.number,
        });
        const repoConfig = resolveRepoConfig(pluginConfig.repos, command.issue);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${command.issue.owner}/${command.issue.repo}.`,
          };
        }
        if (await store.isPendingApproval(issueKey)) {
          return {
            text: (await store.getStatus(issueKey)) ?? `Awaiting chat approval for ${issueKey}.`,
          };
        }
        const currentSnapshot = await store.getStatusSnapshot(issueKey);
        if (currentSnapshot) {
          try {
            const synced = await syncIssueSnapshotFromGitHub({
              snapshot: currentSnapshot,
            });
            if (synced.changed) {
              await store.setStatusSnapshot(synced.snapshot);
              return { text: synced.snapshot.status };
            }
          } catch {
            // Keep /occode-status usable even if GitHub is temporarily unavailable.
          }
        }
        const currentStatus = await store.getStatus(issueKey);
        if (currentStatus) {
          return { text: currentStatus };
        }
        const reconciled = await findLatestLocalRunStatusForIssue({
          repo: repoConfig,
          issueKey,
        });
        return {
          text: reconciled?.status ?? `No openclawcode status recorded yet for ${issueKey}.`,
        };
      },
    });

    api.registerCommand({
      name: "occode-inbox",
      description:
        "Show pending approvals, queue state, and recent activity for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const repo = parseChatopsRepoReference(ctx.args ?? "", {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!repo) {
          return {
            text:
              "Usage: /occode-inbox owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-inbox",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const state = await store.snapshot();
        return {
          text: buildInboxMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            state,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-skip",
      description: "Remove a queued openclawcode issue run before execution starts.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const command = parseChatopsCommand(`/occode-skip ${ctx.args ?? ""}`, {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!command) {
          return {
            text:
              "Usage: /occode-skip owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-skip #123",
          };
        }

        const issueKey = formatIssueKey({
          owner: command.issue.owner,
          repo: command.issue.repo,
          number: command.issue.number,
        });
        if (await store.removePendingApproval(issueKey)) {
          return { text: `Skipped pending approval for ${issueKey}.` };
        }
        return (await store.removeQueued(issueKey))
          ? { text: `Skipped queued run for ${issueKey}.` }
          : { text: `No pending or queued run found for ${issueKey}.` };
      },
    });

    api.registerCommand({
      name: "occode-sync",
      description: "Reconcile local run records and GitHub status for tracked issues.",
      acceptsArgs: false,
      handler: async () => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        await reconcileLocalRunStatuses({
          store,
          repoConfigs: pluginConfig.repos,
        });
        const result = await syncSnapshotsFromGitHub(store);
        return {
          text: [
            "openclawcode sync complete.",
            `Tracked snapshots checked: ${result.checked}`,
            `Statuses healed: ${result.changed}`,
            result.failed > 0
              ? `GitHub sync failures: ${result.failed}`
              : "GitHub sync failures: 0",
          ].join("\n"),
        };
      },
    });

    api.registerService({
      id: "openclawcode-runner",
      start: async () => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const intervalMs = pluginConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        await store.recoverInterruptedRun();
        await reconcileLocalRunStatuses({
          store,
          repoConfigs: pluginConfig.repos,
        });
        pollTimer = setInterval(() => {
          void processNextQueuedRun(api, store);
        }, intervalMs);
        pollTimer.unref?.();
      },
      stop: async () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      },
    });
  },
};
