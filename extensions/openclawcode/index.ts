import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readRequestBodyWithLimit } from "../../src/infra/http-body.js";
import { runMessageAction } from "../../src/infra/outbound/message-action-runner.js";
import {
  OpenClawCodeChatopsStore,
  buildIssueApprovalMessage,
  buildOpenClawCodeRunArgv,
  buildRunRequestFromCommand,
  buildRunStatusMessage,
  decideIssueWebhookIntake,
  extractWorkflowRunFromCommandOutput,
  formatIssueKey,
  parseChatopsCommand,
  resolveOpenClawCodePluginConfig,
  type GitHubIssueWebhookEvent,
  type OpenClawCodeChatopsRepoConfig,
} from "../../src/integrations/openclaw-plugin/index.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_WEBHOOK_MAX_BYTES = 256 * 1024;

let workerActive = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

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

function summarizeFailure(stderr: string, stdout: string): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  if (!combined) {
    return "Command failed without output.";
  }
  const lines = combined.split("\n").filter(Boolean);
  return lines.slice(-8).join("\n");
}

async function sendText(params: {
  api: OpenClawPluginApi;
  channel: string;
  target: string;
  text: string;
}): Promise<void> {
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

  const eventName = req.headers["x-github-event"];
  const githubEvent = Array.isArray(eventName) ? eventName[0] : eventName;
  if (githubEvent !== "issues") {
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

  let payload: GitHubIssueWebhookEvent;
  try {
    payload = JSON.parse(rawBody) as GitHubIssueWebhookEvent;
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid JSON");
    return true;
  }

  const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
  const matchingRepo = resolveRepoConfig(pluginConfig.repos, {
    owner: payload.repository.owner,
    repo: payload.repository.name,
  });
  if (!matchingRepo) {
    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ accepted: false, reason: "unconfigured-repo" }));
    return true;
  }

  const decision = decideIssueWebhookIntake({
    event: payload,
    config: matchingRepo,
  });
  if (!decision.accept || !decision.issue) {
    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ accepted: false, reason: decision.reason }));
    return true;
  }

  const issueKey = formatIssueKey(decision.issue);
  if (matchingRepo.triggerMode === "auto") {
    const enqueued = await store.enqueue(
      {
        issueKey,
        notifyChannel: matchingRepo.notifyChannel,
        notifyTarget: matchingRepo.notifyTarget,
        request: buildRunRequestFromCommand({
          command: {
            action: "start",
            issue: {
              owner: decision.issue.owner,
              repo: decision.issue.repo,
              number: decision.issue.number,
            },
          },
          config: matchingRepo,
        }),
      },
      "Auto-started from issue webhook.",
    );
    if (!enqueued) {
      res.statusCode = 202;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ accepted: false, reason: "already-tracked", issue: issueKey }));
      return true;
    }
    await sendText({
      api,
      channel: matchingRepo.notifyChannel,
      target: matchingRepo.notifyTarget,
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
      config: matchingRepo,
    });
    const accepted = await store.addPendingApproval({
      issueKey,
      notifyChannel: matchingRepo.notifyChannel,
      notifyTarget: matchingRepo.notifyTarget,
    });
    if (!accepted) {
      res.statusCode = 202;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ accepted: false, reason: "already-tracked", issue: issueKey }));
      return true;
    }
    await sendText({
      api,
      channel: matchingRepo.notifyChannel,
      target: matchingRepo.notifyTarget,
      text: approvalMessage,
    });
  }

  res.statusCode = 202;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ accepted: true, issue: issueKey }));
  return true;
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
      await store.finishCurrent(next.issueKey, `Failed.\n${failure}`);
      await sendText({
        api,
        channel: next.notifyChannel,
        target: next.notifyTarget,
        text: `openclawcode failed on ${next.issueKey}.\n${failure}`,
      });
      return;
    }

    const run = extractWorkflowRunFromCommandOutput(result.stdout);
    if (!run) {
      await store.finishCurrent(next.issueKey, "Completed, but workflow JSON could not be parsed.");
      await sendText({
        api,
        channel: next.notifyChannel,
        target: next.notifyTarget,
        text: `openclawcode finished ${next.issueKey}, but could not parse the workflow JSON output.`,
      });
      return;
    }

    const statusMessage = buildRunStatusMessage(run);
    await store.finishCurrent(next.issueKey, statusMessage);
    await sendText({
      api,
      channel: next.notifyChannel,
      target: next.notifyTarget,
      text: statusMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishCurrent(next.issueKey, `Failed.\n${message}`);
    await sendText({
      api,
      channel: next.notifyChannel,
      target: next.notifyTarget,
      text: `openclawcode failed on ${next.issueKey}.\n${message}`,
    }).catch(() => undefined);
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
          ctx.from?.trim() ||
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
        if (await store.isPendingApproval(issueKey)) {
          return {
            text: (await store.getStatus(issueKey)) ?? `Awaiting chat approval for ${issueKey}.`,
          };
        }
        return {
          text:
            (await store.getStatus(issueKey)) ??
            `No openclawcode status recorded yet for ${issueKey}.`,
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

    api.registerService({
      id: "openclawcode-runner",
      start: async () => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const intervalMs = pluginConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        await store.recoverInterruptedRun();
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
