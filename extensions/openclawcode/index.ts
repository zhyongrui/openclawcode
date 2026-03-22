import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
import { formatCliCommand } from "../../src/cli/command-format.js";
import { readRequestBodyWithLimit } from "../../src/infra/http-body.js";
import {
  OpenClawCodeChatopsStore,
  applyPullRequestReviewWebhookToSnapshot,
  applyPullRequestWebhookToSnapshot,
  buildIssueApprovalMessage,
  buildIssueEscalationMessage,
  deriveScopedChatIssueDrafts,
  buildOpenClawCodeRunArgv,
  buildRunRequestFromCommand,
  buildRunStatusMessage,
  buildWorkflowFailureDiagnosticLines,
  classifyChatIssueDraftKind,
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
  type OpenClawCodeDeferredRuntimeReroute,
} from "../../src/integrations/openclaw-plugin/index.js";
import {
  buildOnboardingRepoNameSuggestions,
  createOnboardingRepositoryViaGh,
  inspectOnboardingGitHubCliDeviceLogin,
  onboardingOpenClawCodeDeps,
  parseOnboardingRepositoryCreationInput,
  resolveOnboardingGitHubToken,
  runOnboardingOpenClawCodeBootstrap,
  startOnboardingGitHubCliDeviceLogin,
  type OnboardingProjectMode,
  type OnboardingGitHubCliDeviceLoginStatus,
} from "../../src/wizard/setup.code.js";
import { appendProjectBlueprintDiscussionEntry } from "../../src/openclawcode/blueprint-discussion.js";
import {
  PROJECT_BLUEPRINT_REQUIRED_SECTIONS,
  inspectProjectBlueprintClarifications,
  parseProjectBlueprintSectionName,
  parseProjectBlueprintRoleId,
  projectBlueprintRoleIds,
  projectBlueprintSectionIds,
  readProjectBlueprintDocument,
  updateProjectBlueprintSection,
  updateProjectBlueprintProviderRole,
  updateProjectBlueprintStatus,
} from "../../src/openclawcode/blueprint.js";
import type { GitHubIssueClient } from "../../src/openclawcode/github/index.js";
import { GitHubRestClient } from "../../src/openclawcode/github/index.js";
import {
  readProjectPromotionReceiptArtifact,
  readProjectRollbackReceiptArtifact,
} from "../../src/openclawcode/promotion-artifacts.js";
import { readOpenClawCodeOperatorStatusSnapshot } from "../../src/openclawcode/operator-status.js";
import {
  readProjectAutonomousLoopArtifact,
  runProjectAutonomousLoop,
  setProjectAutonomousLoopDisabled,
} from "../../src/openclawcode/autonomous-loop.js";
import {
  readProjectIssueMaterializationArtifact,
  writeProjectIssueMaterializationArtifact,
} from "../../src/openclawcode/issue-materialization.js";
import { resolveChatNextSuggestedCommand } from "../../src/openclawcode/next-suggested-command.js";
import {
  readProjectProgressArtifact,
  writeProjectProgressArtifact,
} from "../../src/openclawcode/project-progress.js";
import {
  readProjectNextWorkSelection,
  writeProjectNextWorkSelection,
} from "../../src/openclawcode/next-work.js";
import {
  readProjectRoleRoutingPlan,
  writeProjectRoleRoutingPlan,
} from "../../src/openclawcode/role-routing.js";
import {
  projectRuntimeSteeringStageIds,
  readProjectRuntimeSteeringArtifact,
  recordProjectRuntimeSteeringOverride,
} from "../../src/openclawcode/runtime-steering.js";
import {
  readProjectStageGateArtifact,
  recordProjectStageGateDecision,
  writeProjectStageGateArtifact,
} from "../../src/openclawcode/stage-gates.js";
import {
  classifyValidationIssue,
  type ValidationIssueClass,
  type ValidationIssueTemplateId,
} from "../../src/openclawcode/validation-issues.js";
import {
  readProjectWorkItemInventory,
  writeProjectWorkItemInventory,
} from "../../src/openclawcode/work-items.js";
import { buildOpenClawCodePolicySnapshot } from "../../src/openclawcode/policy.js";
import { resolveConcreteChatNotifyTarget } from "../../src/openclawcode/operator-chat-targets.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_WEBHOOK_MAX_BYTES = 256 * 1024;
const SUPPORTED_GITHUB_EVENTS = new Set(["issues", "pull_request", "pull_request_review"]);

type ActiveProviderPause = {
  until: string;
  triggeredAt: string;
  lastFailureAt: string;
  failureCount: number;
  reason: string;
};

type SetupCheckReadinessPayload = {
  basic: boolean;
  strict: boolean;
  lowRiskProofReady: boolean;
  fallbackProofReady: boolean;
  promotionReady: boolean;
  chatSetupRoutingReady: boolean;
  gatewayReachable: boolean;
  routeProbeReady: boolean;
  routeProbeSkipped: boolean;
  builtStartupProofRequested: boolean;
  builtStartupProofReady: boolean;
  nextAction: string;
};

type SetupCheckPluginActivationPayload = {
  ready: boolean;
  pluginsEnabled: boolean;
  allowlisted: boolean;
  entryEnabled: boolean;
};

type SetupCheckSummaryPayload = {
  pass: number;
  warn: number;
  fail: number;
};

type SetupCheckProbePayload = {
  ok: boolean;
  strict: boolean;
  repoRoot: string;
  operatorRoot: string;
  readiness: SetupCheckReadinessPayload;
  pluginActivation?: SetupCheckPluginActivationPayload;
  summary: SetupCheckSummaryPayload;
};

let workerActive = false;
let runnerReady = false;
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

function resolveChannelDmPolicy(config: OpenClawPluginApi["config"], channel: string): string | undefined {
  const channels =
    config && typeof config === "object" && config.channels && typeof config.channels === "object"
      ? (config.channels as Record<string, unknown>)
      : undefined;
  const channelConfig = channels?.[channel];
  if (!channelConfig || typeof channelConfig !== "object") {
    return undefined;
  }
  const dmPolicy = (channelConfig as { dmPolicy?: unknown }).dmPolicy;
  return typeof dmPolicy === "string" && dmPolicy.trim() ? dmPolicy.trim() : undefined;
}

function resolvePairingSenderIdFromNotifyTarget(target: string): string | undefined {
  const trimmed = target.trim();
  if (!trimmed.toLowerCase().startsWith("user:")) {
    return undefined;
  }
  const senderId = trimmed.slice("user:".length).trim();
  return senderId || undefined;
}

function resolveProactivePairingIdentity(params: {
  api: OpenClawPluginApi;
  channel: string;
  target: string;
}): { accountId: string; senderId: string } | undefined {
  if (resolveChannelDmPolicy(params.api.config, params.channel) !== "pairing") {
    return undefined;
  }
  const senderId = resolvePairingSenderIdFromNotifyTarget(params.target);
  if (!senderId) {
    return undefined;
  }
  return {
    accountId: DEFAULT_ACCOUNT_ID,
    senderId,
  };
}

function issueKeyMatchesRepo(issueKey: string, repo: { owner: string; repo: string }): boolean {
  return issueKey.toLowerCase().startsWith(`${formatRepoKey(repo).toLowerCase()}#`);
}

function parseIssueKey(
  issueKey: string,
): { owner: string; repo: string; number: number } | undefined {
  const match = issueKey.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) {
    return undefined;
  }
  const number = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isInteger(number)) {
    return undefined;
  }
  return {
    owner: match[1] ?? "",
    repo: match[2] ?? "",
    number,
  };
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

function buildChatSetupAwaitingGitHubAuthMessage(params: {
  verificationUri: string;
  userCode: string;
  selectionLabel?: string;
}): string {
  return [
    "OpenClaw Code setup is waiting for GitHub approval.",
    `Open: ${params.verificationUri}`,
    `Code: ${params.userCode}`,
    params.selectionLabel ? `Selected target: ${params.selectionLabel}` : undefined,
    "The host-side GitHub login flow is already running.",
    "Finish approval in your browser. OpenClaw Code will push the next status here automatically.",
    "If that push does not arrive, send /occode-setup-status here.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildChatSetupReadyMessage(params: {
  source: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token";
  repoKey?: string;
}): string {
  return [
    "OpenClaw Code setup has GitHub auth ready.",
    `Source: ${params.source}`,
    params.repoKey ? `Selected repo: ${params.repoKey}` : undefined,
    params.repoKey
      ? `Next: ${formatCliCommand(`openclaw code bootstrap --repo ${params.repoKey} --mode auto`)}`
      : "Next: send /occode-setup owner/repo to pin the repo for this chat.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildChatSetupAwaitingPairingMessage(params: {
  api: OpenClawPluginApi;
  channel: string;
  senderId: string;
  code: string;
  selectionLabel?: string;
}): string {
  return [
    "OpenClaw Code found this chat as a configured setup target, but pairing must be approved first.",
    params.selectionLabel ? `Selected target: ${params.selectionLabel}` : undefined,
    params.api.runtime.channel.pairing.buildPairingReply({
      channel: params.channel,
      idLine: `Chat identity: ${params.senderId}`,
      code: params.code,
    }),
    "After approval, OpenClaw Code will automatically continue setup here and start GitHub login.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildChatSetupAwaitingPairingStatusMessage(params: {
  repoKey?: string;
}): string {
  return [
    "OpenClaw Code setup is waiting for chat pairing approval.",
    params.repoKey ? `Selected repo: ${params.repoKey}` : undefined,
    "Approve the pairing request for this chat first.",
    "After approval, OpenClaw Code will automatically continue setup here and start GitHub login.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildChatSetupFailedMessage(params: {
  reason: string;
  repoKey?: string;
  logTail?: string;
  step?: "github-auth" | "repo-create" | "bootstrap" | "blueprint-sync";
  retryCommand?: string;
  needsOperatorAction?: boolean;
}): string {
  return [
    "OpenClaw Code setup hit a recoverable failure.",
    params.step ? `Failed step: ${params.step}` : undefined,
    `Reason: ${params.reason}`,
    params.repoKey ? `Selected repo: ${params.repoKey}` : undefined,
    params.logTail ? `Recent gh output:\n${params.logTail}` : undefined,
    params.retryCommand
      ? `Retry: ${params.retryCommand}`
      : "Retry: /occode-setup-retry",
    params.needsOperatorAction
      ? "Operator action: fix the host-side problem first, then retry."
      : undefined,
    params.step === "github-auth" ? "If the device flow expired, start a fresh login with /occode-setup." : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

type ChatSetupSession = NonNullable<
  Awaited<ReturnType<OpenClawCodeChatopsStore["getSetupSession"]>>
>;

type ChatSetupProjectSelection =
  | {
      kind: "existing-repo";
      projectMode: "existing-repo";
      repoKey: string;
    }
  | {
      kind: "new-repo";
      projectMode: "new-project";
      pendingRepoName: string;
    }
  | {
      kind: "new-project-blueprint";
      projectMode: "new-project";
    };

const SETUP_BLUEPRINT_REQUIRED_SECTIONS_FOR_AGREEMENT = [
  "Goal",
  "Success Criteria",
  "Scope",
  "Non-Goals",
  "Constraints",
] as const satisfies readonly (typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number][];

function isChatSetupBlueprintDraftSession(
  session: ChatSetupSession | undefined,
): session is ChatSetupSession &
  Required<Pick<ChatSetupSession, "blueprintDraft">> & { projectMode: "new-project" } {
  return Boolean(
    session &&
      session.projectMode === "new-project" &&
      !session.repoKey &&
      session.blueprintDraft &&
      (session.stage === "drafting-blueprint" || session.stage === "awaiting-repo-choice"),
  );
}

function hasChatSetupBlueprintDraft(
  session: ChatSetupSession | undefined,
): session is ChatSetupSession &
  Required<Pick<ChatSetupSession, "blueprintDraft">> & { projectMode: "new-project" } {
  return Boolean(session && session.projectMode === "new-project" && session.blueprintDraft);
}

function collectChatSetupDraftMissingSections(
  session: ChatSetupSession,
): (typeof SETUP_BLUEPRINT_REQUIRED_SECTIONS_FOR_AGREEMENT)[number][] {
  const sections = session.blueprintDraft?.sections ?? {};
  return SETUP_BLUEPRINT_REQUIRED_SECTIONS_FOR_AGREEMENT.filter(
    (section) => !sections[section] || sections[section]?.trim().length === 0,
  );
}

function buildChatSetupDraftProjectText(session: ChatSetupSession): string {
  const sections = session.blueprintDraft?.sections ?? {};
  return [
    sections.Goal,
    sections["Success Criteria"],
    sections.Scope,
    sections["Non-Goals"],
    sections.Constraints,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
}

function buildChatSetupDraftGoalSummary(session: ChatSetupSession): string | undefined {
  return trimToSingleLine(session.blueprintDraft?.sections?.Goal);
}

function buildChatSetupDraftingBlueprintMessage(params: {
  session: ChatSetupSession;
}): string {
  const missing = collectChatSetupDraftMissingSections(params.session);
  const filledCount = Object.values(params.session.blueprintDraft?.sections ?? {}).filter(
    (value) => value.trim().length > 0,
  ).length;
  const goalSummary = buildChatSetupDraftGoalSummary(params.session);
  return [
    "OpenClaw Code is drafting a blueprint-first new-project setup for this chat.",
    params.session.githubAuthSource
      ? `GitHub auth: ready via ${params.session.githubAuthSource}`
      : "GitHub auth: not needed yet; auth will start when you choose a repo name.",
    `Draft status: ${params.session.blueprintDraft?.status ?? "draft"}`,
    goalSummary ? `Goal: ${goalSummary}` : undefined,
    `Draft sections captured: ${filledCount}`,
    `Missing before agreement: ${missing.length}`,
    ...missing.slice(0, 5).map((section) => `- ${section}`),
    "Use /occode-goal <goal text> to capture the project goal.",
    `Use /occode-blueprint-edit <section>\\n<body...> for sections such as ${projectBlueprintSectionIds().join(", ")}.`,
    "Capture the first MVP in `success-criteria`, then add scope, non-goals, and constraints.",
    "When the draft is ready, send /occode-blueprint-agree to lock the setup draft and get repo-name suggestions.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildChatSetupAwaitingRepoChoiceMessage(params: {
  session: ChatSetupSession;
}): string {
  const goalSummary = buildChatSetupDraftGoalSummary(params.session);
  const suggestions = params.session.blueprintDraft?.repoNameSuggestions ?? [];
  return [
    "OpenClaw Code has an agreed blueprint draft for this new-project setup.",
    params.session.githubAuthSource
      ? `GitHub auth: ready via ${params.session.githubAuthSource}`
      : "GitHub auth: will start after you pick a repo name.",
    goalSummary ? `Goal: ${goalSummary}` : undefined,
    `Repo-name suggestions: ${suggestions.length}`,
    ...suggestions.map((suggestion) => `- ${suggestion}`),
    suggestions[0]
      ? `Choose one with /occode-setup new ${suggestions[0]}`
      : "Choose a repo name with /occode-setup new <repo-name>",
    "You can also send /occode-setup new <custom-name> to override the suggestions.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildChatSetupRepoCreationBlockedMessage(params: {
  session: ChatSetupSession;
}): string {
  return [
    "OpenClaw Code has a new-project setup draft, but the blueprint is not agreed yet.",
    buildChatSetupDraftingBlueprintMessage({
      session: params.session,
    }),
  ].join("\n");
}

function parseChatSetupProjectSelection(params: {
  args: string;
  defaultRepo?: { owner: string; repo: string };
}): ChatSetupProjectSelection | "invalid" | undefined {
  const trimmed = params.args.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^new-project$/i.test(trimmed)) {
    return {
      kind: "new-project-blueprint",
      projectMode: "new-project",
    };
  }

  const explicitExisting = /^existing\s+(.+)$/i.exec(trimmed)?.[1]?.trim();
  if (explicitExisting) {
    const repo = parseChatopsRepoReference(explicitExisting, params.defaultRepo);
    return repo
      ? { kind: "existing-repo", projectMode: "existing-repo", repoKey: formatRepoKey(repo) }
      : "invalid";
  }

  const explicitNew = /^new\s+(.+)$/i.exec(trimmed)?.[1]?.trim();
  if (explicitNew) {
    return {
      kind: "new-repo",
      projectMode: "new-project",
      pendingRepoName: explicitNew,
    };
  }

  const repo = parseChatopsRepoReference(trimmed, params.defaultRepo);
  if (repo) {
    return {
      kind: "existing-repo",
      projectMode: "existing-repo",
      repoKey: formatRepoKey(repo),
    };
  }

  return {
    kind: "new-repo",
    projectMode: "new-project",
    pendingRepoName: trimmed,
  };
}

function buildChatSetupRepoReadyMessage(params: {
  source: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token";
  repoKey: string;
  projectMode: OnboardingProjectMode;
  created?: boolean;
}): string {
  return [
    params.projectMode === "new-project"
      ? params.created
        ? "OpenClaw Code created the new GitHub repo for this setup."
        : "OpenClaw Code has a new-project repo selected for this setup."
      : "OpenClaw Code has an existing repo selected for this setup.",
    `Source: ${params.source}`,
    `Repo: ${params.repoKey}`,
    `Next: ${formatCliCommand(`openclaw code bootstrap --repo ${params.repoKey} --mode auto`)}`,
    "After bootstrap, use /occode-goal and /occode-blueprint to align the project blueprint in chat.",
  ].join("\n");
}

function buildChatSetupBootstrapRepairLines(
  bootstrap: NonNullable<
    NonNullable<Awaited<ReturnType<OpenClawCodeChatopsStore["getSetupSession"]>>>["bootstrap"]
  >,
): string[] {
  if (
    bootstrap.pluginActivation?.ready !== false &&
    bootstrap.proofReadiness?.chatSetupRoutingReady !== false &&
    bootstrap.nextAction !== "repair-plugin-activation"
  ) {
    return [];
  }

  return [
    bootstrap.pluginActivationRepairCommand
      ? `Repair: ${bootstrap.pluginActivationRepairCommand}`
      : undefined,
    bootstrap.chatSetupStatusCommand
      ? `Chat retry: ${bootstrap.chatSetupStatusCommand}`
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));
}

function buildChatSetupBootstrapCompleteMessage(params: {
  source: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token";
  repoKey: string;
  bootstrap: NonNullable<
    NonNullable<Awaited<ReturnType<OpenClawCodeChatopsStore["getSetupSession"]>>>["bootstrap"]
  >;
}): string {
  return [
    "OpenClaw Code bootstrap finished for this setup session.",
    `Source: ${params.source}`,
    `Repo: ${params.repoKey}`,
    params.bootstrap.repoRoot ? `Local path: ${params.bootstrap.repoRoot}` : undefined,
    params.bootstrap.checkoutAction ? `Checkout: ${params.bootstrap.checkoutAction}` : undefined,
    params.bootstrap.blueprintPath ? `Blueprint: ${params.bootstrap.blueprintPath}` : undefined,
    params.bootstrap.blueprintStatus ? `Blueprint status: ${params.bootstrap.blueprintStatus}` : undefined,
    params.bootstrap.blueprintRevisionId
      ? `Blueprint revision: ${params.bootstrap.blueprintRevisionId}`
      : undefined,
    params.bootstrap.blueprintGoalSummary
      ? `Blueprint goal: ${params.bootstrap.blueprintGoalSummary}`
      : undefined,
    typeof params.bootstrap.workstreamCandidateCount === "number" &&
    typeof params.bootstrap.openQuestionCount === "number" &&
    typeof params.bootstrap.humanGateCount === "number"
      ? `Blueprint counts: workstreams=${params.bootstrap.workstreamCandidateCount} | openQuestions=${params.bootstrap.openQuestionCount} | humanGates=${params.bootstrap.humanGateCount}`
      : undefined,
    typeof params.bootstrap.workItemCount === "number" &&
    typeof params.bootstrap.plannedWorkItemCount === "number"
      ? `Work items: total=${params.bootstrap.workItemCount} | planned=${params.bootstrap.plannedWorkItemCount}`
      : undefined,
    typeof params.bootstrap.blockedGateCount === "number" &&
    typeof params.bootstrap.needsHumanDecisionCount === "number"
      ? `Stage gates: blocked=${params.bootstrap.blockedGateCount} | needsHumanDecision=${params.bootstrap.needsHumanDecisionCount}`
      : undefined,
    params.bootstrap.pluginActivation
      ? `Plugin activation: ${params.bootstrap.pluginActivation.ready ? "ready" : "blocked"} | plugins=${params.bootstrap.pluginActivation.pluginsEnabled ? "enabled" : "disabled"} | allow=${params.bootstrap.pluginActivation.allowlisted ? "ready" : "missing"} | entry=${params.bootstrap.pluginActivation.entryEnabled ? "enabled" : "disabled"}`
      : undefined,
    typeof params.bootstrap.readyForIssueProjection === "boolean"
      ? `Issue projection: ${params.bootstrap.readyForIssueProjection ? "ready" : "blocked"}`
      : undefined,
    typeof params.bootstrap.proofReadiness?.chatSetupRoutingReady === "boolean"
      ? `Chat setup routing: ${params.bootstrap.proofReadiness.chatSetupRoutingReady ? "ready" : "blocked"}`
      : undefined,
    params.bootstrap.firstWorkItemTitle
      ? `First work item: ${params.bootstrap.firstWorkItemTitle}`
      : undefined,
    params.bootstrap.nextSuggestedCommand
      ? `Next suggested command: ${params.bootstrap.nextSuggestedCommand}`
      : undefined,
    ...buildChatSetupBootstrapRepairLines(params.bootstrap),
    params.bootstrap.autoBindStatus
      ? `Auto-bind: ${params.bootstrap.autoBindStatus}${params.bootstrap.autoBindChannel && params.bootstrap.autoBindTarget ? ` (${params.bootstrap.autoBindChannel}:${params.bootstrap.autoBindTarget})` : ""}`
      : undefined,
    params.bootstrap.clarificationQuestions?.length
      ? `Clarifications: ${params.bootstrap.clarificationQuestions.length}`
      : undefined,
    ...(params.bootstrap.clarificationQuestions ?? []).slice(0, 3).map((question) => `- ${question}`),
    params.bootstrap.clarificationSuggestions?.length
      ? `Suggestions: ${params.bootstrap.clarificationSuggestions.length}`
      : undefined,
    ...(params.bootstrap.clarificationSuggestions ?? []).slice(0, 2).map((suggestion) => `- ${suggestion}`),
    params.bootstrap.nextAction ? `Status: ${params.bootstrap.nextAction}` : undefined,
    params.bootstrap.cliRunCommand ? `CLI proof: ${params.bootstrap.cliRunCommand}` : undefined,
    params.bootstrap.blueprintCommand ? `Chat blueprint: ${params.bootstrap.blueprintCommand}` : undefined,
    params.bootstrap.blueprintClarifyCommand
      ? `Blueprint clarify: ${params.bootstrap.blueprintClarifyCommand}`
      : undefined,
    params.bootstrap.blueprintAgreeCommand
      ? `Blueprint agree: ${params.bootstrap.blueprintAgreeCommand}`
      : undefined,
    params.bootstrap.blueprintDecomposeCommand
      ? `Blueprint decompose: ${params.bootstrap.blueprintDecomposeCommand}`
      : undefined,
    params.bootstrap.gatesCommand ? `Stage gates: ${params.bootstrap.gatesCommand}` : undefined,
    params.bootstrap.chatBindCommand ? `Chat bind: ${params.bootstrap.chatBindCommand}` : undefined,
    params.bootstrap.chatStartCommand ? `Chat proof: ${params.bootstrap.chatStartCommand}` : undefined,
    params.bootstrap.webhookRetryCommand
      ? `Webhook retry: ${params.bootstrap.webhookRetryCommand}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

async function ensureChatSetupRepoBinding(params: {
  store: OpenClawCodeChatopsStore;
  session: ChatSetupSession;
}): Promise<{
  status: "bound" | "already-bound" | "existing-binding-kept";
  notifyChannel: string;
  notifyTarget: string;
}> {
  const current = params.session.repoKey
    ? await params.store.getRepoBinding(params.session.repoKey)
    : undefined;
  if (!params.session.repoKey) {
    return {
      status: "existing-binding-kept",
      notifyChannel: params.session.notifyChannel,
      notifyTarget: params.session.notifyTarget,
    };
  }
  if (!current) {
    await params.store.setRepoBinding({
      repoKey: params.session.repoKey,
      notifyChannel: params.session.notifyChannel,
      notifyTarget: params.session.notifyTarget,
    });
    return {
      status: "bound",
      notifyChannel: params.session.notifyChannel,
      notifyTarget: params.session.notifyTarget,
    };
  }
  if (
    current.notifyChannel === params.session.notifyChannel &&
    current.notifyTarget === params.session.notifyTarget
  ) {
    return {
      status: "already-bound",
      notifyChannel: current.notifyChannel,
      notifyTarget: current.notifyTarget,
    };
  }
  return {
    status: "existing-binding-kept",
    notifyChannel: current.notifyChannel,
    notifyTarget: current.notifyTarget,
  };
}

function resolveChatSetupStageAfterAuth(session: ChatSetupSession): ChatSetupSession["stage"] {
  if (session.stage === "bootstrap-complete") {
    return "bootstrap-complete";
  }
  if (session.stage === "drafting-blueprint" || session.stage === "awaiting-repo-choice") {
    return session.stage;
  }
  return "github-authenticated";
}

async function syncChatSetupBlueprintDraftToRepo(params: {
  session: ChatSetupSession;
  repo: { owner: string; repo: string };
  repoRoot: string;
}): Promise<{
  blueprint: Awaited<ReturnType<typeof readProjectBlueprintDocument>>;
  clarification: Awaited<ReturnType<typeof inspectProjectBlueprintClarifications>>;
  workItems: Awaited<ReturnType<typeof writeProjectWorkItemInventory>>;
  stageGates: Awaited<ReturnType<typeof writeProjectStageGateArtifact>>;
}> {
  const sections = Object.entries(params.session.blueprintDraft?.sections ?? {})
    .map(([sectionName, body]) => {
      const normalizedSectionName = parseProjectBlueprintSectionName(sectionName);
      if (!normalizedSectionName || body.trim().length === 0) {
        return undefined;
      }
      return [normalizedSectionName, body] as const;
    })
    .filter(
      (
        entry,
      ): entry is readonly [(typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number], string] =>
        Boolean(entry),
    );

  for (const [sectionName, body] of sections) {
    await updateProjectBlueprintSection({
      repoRoot: params.repoRoot,
      sectionName,
      body,
      createIfMissing: true,
      title: `${params.repo.repo} project blueprint`,
    });
  }

  if (sections.some(([sectionName]) => sectionName === "Provider Strategy")) {
    await writeProjectRoleRoutingPlan(params.repoRoot);
  }

  if (params.session.blueprintDraft?.status === "agreed") {
    await updateProjectBlueprintStatus({
      repoRoot: params.repoRoot,
      status: "agreed",
    });
  }

  const blueprint = await readProjectBlueprintDocument(params.repoRoot);
  const clarification = await inspectProjectBlueprintClarifications(params.repoRoot);
  const workItems = await writeProjectWorkItemInventory(params.repoRoot);
  const stageGates = await writeProjectStageGateArtifact(params.repoRoot);
  return {
    blueprint,
    clarification,
    workItems,
    stageGates,
  };
}

async function completeChatSetupProjectSelection(params: {
  store: OpenClawCodeChatopsStore;
  session: ChatSetupSession;
}): Promise<{
  session: ChatSetupSession;
  message?: string;
}> {
  if (!params.session.githubAuthSource || params.session.stage === "awaiting-github-device-auth") {
    return { session: params.session };
  }
  const token = resolveOnboardingGitHubToken();
  if (!token) {
    return { session: params.session };
  }
  if (params.session.projectMode === "existing-repo" && params.session.repoKey) {
    const repo = parseChatopsRepoReference(params.session.repoKey);
    if (!repo) {
      return {
        session: params.session,
        message: buildChatSetupFailedMessage({
          reason: `Saved repo reference is invalid: ${params.session.repoKey}`,
          repoKey: params.session.repoKey,
        }),
      };
    }
    let summary;
    try {
      summary = await onboardingOpenClawCodeDeps.fetchRepositorySummary(token.token, repo);
    } catch (error) {
      return {
        session: params.session,
        message: buildChatSetupFailedMessage({
          reason: error instanceof Error ? error.message : String(error),
          repoKey: params.session.repoKey,
        }),
      };
    }
    if (!summary) {
      return {
        session: params.session,
        message: buildChatSetupFailedMessage({
          reason: `${params.session.repoKey} was not found or is not accessible with the current GitHub login.`,
          repoKey: params.session.repoKey,
        }),
      };
    }
    const updated = {
      ...params.session,
      repoKey: formatRepoKey(summary),
      updatedAt: new Date().toISOString(),
    };
    await params.store.upsertSetupSession(updated);
    return {
      session: updated,
      message: buildChatSetupRepoReadyMessage({
        source: updated.githubAuthSource,
        repoKey: updated.repoKey ?? params.session.repoKey,
        projectMode: "existing-repo",
      }),
    };
  }
  if (params.session.projectMode === "new-project" && params.session.pendingRepoName) {
    if (params.session.repoKey) {
      return {
        session: params.session,
        message: buildChatSetupRepoReadyMessage({
          source: params.session.githubAuthSource,
          repoKey: params.session.repoKey,
          projectMode: "new-project",
        }),
      };
    }
    if (
      isChatSetupBlueprintDraftSession(params.session) &&
      params.session.blueprintDraft.status !== "agreed"
    ) {
      return {
        session: params.session,
        message: buildChatSetupRepoCreationBlockedMessage({
          session: params.session,
        }),
      };
    }
    let created;
    try {
      const viewer = await onboardingOpenClawCodeDeps.fetchAuthenticatedViewer(token.token);
      const repoRef = parseOnboardingRepositoryCreationInput(
        params.session.pendingRepoName,
        viewer.login,
      );
      created = await createOnboardingRepositoryViaGh({
        owner: repoRef.owner,
        repo: repoRef.repo,
      });
    } catch (error) {
      const failed = {
        ...params.session,
        lastFailure: {
          step: "repo-create" as const,
          reason: error instanceof Error ? error.message : String(error),
          occurredAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };
      await params.store.upsertSetupSession(failed);
      return {
        session: failed,
        message: buildChatSetupFailedMessage({
          reason: error instanceof Error ? error.message : String(error),
          repoKey: params.session.repoKey,
        }),
      };
    }
    const updated = {
      ...params.session,
      repoKey: formatRepoKey(created),
      pendingRepoName: undefined,
      lastFailure: undefined,
      stage:
        params.session.stage === "awaiting-repo-choice"
          ? ("github-authenticated" as const)
          : params.session.stage,
      updatedAt: new Date().toISOString(),
    };
    await params.store.upsertSetupSession(updated);
    return {
      session: updated,
      message: buildChatSetupRepoReadyMessage({
        source: updated.githubAuthSource,
        repoKey: updated.repoKey ?? formatRepoKey(created),
        projectMode: "new-project",
        created: true,
      }),
    };
  }
  return { session: params.session };
}

async function completeChatSetupBootstrap(params: {
  store: OpenClawCodeChatopsStore;
  session: ChatSetupSession;
}): Promise<{
  session: ChatSetupSession;
  message?: string;
}> {
  if (!params.session.githubAuthSource || !params.session.repoKey) {
    return { session: params.session };
  }
  if (params.session.stage === "bootstrap-complete" && params.session.bootstrap) {
    return {
      session: params.session,
      message: buildChatSetupBootstrapCompleteMessage({
        source: params.session.githubAuthSource,
        repoKey: params.session.repoKey,
        bootstrap: params.session.bootstrap,
      }),
    };
  }
  let payload;
  try {
    payload = await runOnboardingOpenClawCodeBootstrap({
      repo: params.session.repoKey,
    });
  } catch (error) {
    const failed = {
      ...params.session,
      lastFailure: {
        step: "bootstrap" as const,
        reason: error instanceof Error ? error.message : String(error),
        occurredAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    await params.store.upsertSetupSession(failed);
    return {
      session: failed,
      message: buildChatSetupFailedMessage({
        reason: error instanceof Error ? error.message : String(error),
        repoKey: params.session.repoKey,
      }),
    };
  }
  let blueprintDocument:
    | Awaited<ReturnType<typeof readProjectBlueprintDocument>>
    | undefined;
  let blueprintClarification:
    | Awaited<ReturnType<typeof inspectProjectBlueprintClarifications>>
    | undefined;
  let workItems: Awaited<ReturnType<typeof readProjectWorkItemInventory>> | undefined;
  let stageGates: Awaited<ReturnType<typeof readProjectStageGateArtifact>> | undefined;
  const autoBind =
    params.session.repoKey != null
      ? await ensureChatSetupRepoBinding({
          store: params.store,
          session: params.session,
        })
      : undefined;
  if (payload.repo?.repoRoot) {
    try {
      const repo = parseChatopsRepoReference(params.session.repoKey);
      if (repo && hasChatSetupBlueprintDraft(params.session)) {
        const synchronized = await syncChatSetupBlueprintDraftToRepo({
          session: params.session,
          repo,
          repoRoot: payload.repo.repoRoot,
        });
        blueprintDocument = synchronized.blueprint;
        blueprintClarification = synchronized.clarification;
        workItems = synchronized.workItems;
        stageGates = synchronized.stageGates;
      } else {
        blueprintDocument = await readProjectBlueprintDocument(payload.repo.repoRoot);
        blueprintClarification = await inspectProjectBlueprintClarifications(payload.repo.repoRoot);
        workItems = await readProjectWorkItemInventory(payload.repo.repoRoot);
        stageGates = await readProjectStageGateArtifact(payload.repo.repoRoot);
      }
    } catch (error) {
      const failed = {
        ...params.session,
        lastFailure: {
          step: "blueprint-sync" as const,
          reason: error instanceof Error ? error.message : String(error),
          occurredAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };
      await params.store.upsertSetupSession(failed);
      return {
        session: failed,
        message: buildChatSetupFailedMessage({
          reason: error instanceof Error ? error.message : String(error),
          repoKey: params.session.repoKey,
        }),
      };
    }
  }
  const nextSuggestedCommand =
    stageGates && (stageGates.blockedGateCount > 0 || stageGates.needsHumanDecisionCount > 0)
      ? (payload.handoff?.gatesCommand ?? null)
      : workItems?.readyForIssueProjection &&
            workItems.workItems.length > 0 &&
            params.session.repoKey
        ? `/occode-materialize ${params.session.repoKey}`
        : (payload.handoff?.blueprintCommand ??
            payload.handoff?.blueprintDecomposeCommand ??
            null);
  const updated = {
    ...params.session,
    stage: "bootstrap-complete" as const,
    lastFailure: undefined,
    bootstrap: {
      completedAt: new Date().toISOString(),
      repoRoot: payload.repo?.repoRoot,
      checkoutAction: payload.repo?.checkoutAction,
      blueprintPath: blueprintDocument?.blueprintPath ?? payload.blueprint?.blueprintPath,
      blueprintStatus: blueprintDocument?.status ?? payload.blueprint?.status,
      blueprintRevisionId: blueprintDocument?.revisionId ?? payload.blueprint?.revisionId,
      blueprintGoalSummary: blueprintDocument?.goalSummary ?? undefined,
      workstreamCandidateCount: blueprintDocument?.workstreamCandidateCount,
      openQuestionCount: blueprintDocument?.openQuestionCount,
      humanGateCount: blueprintDocument?.humanGateCount,
      workItemCount: workItems?.workItemCount,
      plannedWorkItemCount: workItems?.plannedWorkItemCount,
      readyForIssueProjection: workItems?.readyForIssueProjection,
      blockedGateCount: stageGates?.blockedGateCount,
      needsHumanDecisionCount: stageGates?.needsHumanDecisionCount,
      pluginActivation: payload.pluginActivation,
      firstWorkItemTitle: workItems?.workItems[0]?.title,
      nextSuggestedCommand,
      autoBindStatus: autoBind?.status,
      autoBindChannel: autoBind?.notifyChannel,
      autoBindTarget: autoBind?.notifyTarget,
      clarificationQuestions: blueprintClarification?.questions ?? undefined,
      clarificationSuggestions: blueprintClarification?.suggestions ?? undefined,
      nextAction: payload.nextAction,
      cliRunCommand: payload.handoff?.cliRunCommand,
      blueprintCommand: payload.handoff?.blueprintCommand,
      blueprintClarifyCommand: payload.handoff?.blueprintClarifyCommand,
      blueprintAgreeCommand: payload.handoff?.blueprintAgreeCommand,
      blueprintDecomposeCommand: payload.handoff?.blueprintDecomposeCommand,
      gatesCommand: payload.handoff?.gatesCommand,
      gatewayRestartCommand: payload.handoff?.gatewayRestartCommand,
      pluginActivationRepairCommand: payload.handoff?.pluginActivationRepairCommand,
      chatSetupCommand: payload.handoff?.chatSetupCommand,
      chatSetupStatusCommand: payload.handoff?.chatSetupStatusCommand,
      chatBindCommand: payload.handoff?.chatBindCommand,
      chatStartCommand: payload.handoff?.chatStartCommand,
      webhookRetryCommand: payload.handoff?.webhookRetryCommand,
      recommendedProofMode: payload.handoff?.recommendedProofMode,
      reason: payload.handoff?.reason,
      proofReadiness: payload.proofReadiness,
    },
    updatedAt: new Date().toISOString(),
  };
  await params.store.upsertSetupSession(updated);
  return {
    session: updated,
    message: buildChatSetupBootstrapCompleteMessage({
      source: updated.githubAuthSource,
      repoKey: updated.repoKey,
      bootstrap: updated.bootstrap,
    }),
  };
}

async function continueChatSetupSession(params: {
  store: OpenClawCodeChatopsStore;
  session: ChatSetupSession;
}): Promise<string> {
  const synced = await syncChatSetupSession({
    store: params.store,
    session: params.session,
  });
  if (
    synced.session.githubAuthSource &&
    synced.session.stage !== "awaiting-github-device-auth" &&
    (synced.session.repoKey || synced.session.pendingRepoName)
  ) {
    const completed = await completeChatSetupProjectSelection({
      store: params.store,
      session: synced.session,
    });
    if (completed.session.repoKey) {
      const bootstrapped = await completeChatSetupBootstrap({
        store: params.store,
        session: completed.session,
      });
      if (bootstrapped.message) {
        return bootstrapped.message;
      }
    }
    if (completed.message) {
      return completed.message;
    }
  }
  if (isChatSetupBlueprintDraftSession(synced.session)) {
    return synced.session.stage === "awaiting-repo-choice"
      ? buildChatSetupAwaitingRepoChoiceMessage({
          session: synced.session,
        })
      : buildChatSetupDraftingBlueprintMessage({
          session: synced.session,
        });
  }
  if (synced.session.stage === "awaiting-chat-pairing") {
    return buildChatSetupAwaitingPairingStatusMessage({
      repoKey: synced.session.repoKey,
    });
  }
  if (synced.session.stage === "bootstrap-complete" && synced.session.githubAuthSource) {
    return buildChatSetupBootstrapCompleteMessage({
      source: synced.session.githubAuthSource,
      repoKey: synced.session.repoKey ?? "unknown",
      bootstrap: synced.session.bootstrap ?? {
        completedAt: new Date().toISOString(),
      },
    });
  }
  if (synced.session.stage === "github-authenticated" && synced.session.githubAuthSource) {
    return buildChatSetupReadyMessage({
      source: synced.session.githubAuthSource,
      repoKey: synced.session.repoKey,
    });
  }
  if (synced.status?.state === "pending") {
    return buildChatSetupAwaitingGitHubAuthMessage({
      verificationUri: synced.status.verificationUri,
      userCode: synced.status.userCode,
      selectionLabel: synced.session.repoKey ?? synced.session.pendingRepoName,
    });
  }
  return buildChatSetupFailedMessage({
    reason:
      synced.status?.state === "failed"
        ? synced.status.reason ?? "GitHub device login did not complete."
        : synced.session.lastFailure?.reason ??
          "GitHub auth is still missing. Start with /occode-setup.",
    repoKey: synced.session.repoKey,
    step: synced.session.lastFailure?.step,
    retryCommand: "/occode-setup-retry",
    needsOperatorAction:
      synced.session.lastFailure?.step === "repo-create" ||
      synced.session.lastFailure?.step === "bootstrap" ||
      synced.session.lastFailure?.step === "blueprint-sync",
  });
}

function resolveSetupSessionNotificationState(params: {
  session: ChatSetupSession;
  status?: OnboardingGitHubCliDeviceLoginStatus;
}): "authorized" | "failed" | null {
  if (params.status?.state === "failed") {
    return "failed";
  }
  if (
    params.session.githubAuthSource &&
    params.session.stage !== "awaiting-github-device-auth"
  ) {
    return "authorized";
  }
  return null;
}

type ProactiveChatSetupTarget = {
  notifyChannel: string;
  notifyTarget: string;
  projectMode?: OnboardingProjectMode;
  repoKey?: string;
};

async function collectProactiveChatSetupTargets(
  repoConfigs: OpenClawCodeChatopsRepoConfig[],
  stateDir: string,
): Promise<ProactiveChatSetupTarget[]> {
  const grouped = new Map<
    string,
    {
      notifyChannel: string;
      notifyTarget: string;
      repoKeys: string[];
    }
  >();
  for (const repoConfig of repoConfigs) {
    const resolvedTarget = await resolveConcreteChatNotifyTarget({
      stateDir,
      repoConfig,
    });
    if (!resolvedTarget) {
      continue;
    }
    const key = `${resolvedTarget.notifyChannel}\u0000${resolvedTarget.notifyTarget}`;
    const current = grouped.get(key);
    const repoKey = formatRepoKey(repoConfig);
    if (current) {
      current.repoKeys.push(repoKey);
      continue;
    }
    grouped.set(key, {
      notifyChannel: resolvedTarget.notifyChannel,
      notifyTarget: resolvedTarget.notifyTarget,
      repoKeys: [repoKey],
    });
  }
  return [...grouped.values()].map((entry) => ({
    notifyChannel: entry.notifyChannel,
    notifyTarget: entry.notifyTarget,
    projectMode: entry.repoKeys.length === 1 ? "existing-repo" : undefined,
    repoKey: entry.repoKeys.length === 1 ? entry.repoKeys[0] : undefined,
  }));
}

function cloneGitHubDeviceAuthSession(
  githubDeviceAuth: NonNullable<ChatSetupSession["githubDeviceAuth"]>,
): NonNullable<ChatSetupSession["githubDeviceAuth"]> {
  return {
    pid: githubDeviceAuth.pid,
    logPath: githubDeviceAuth.logPath,
    userCode: githubDeviceAuth.userCode,
    verificationUri: githubDeviceAuth.verificationUri,
    startedAt: githubDeviceAuth.startedAt,
  };
}

type ProactiveGitHubAuthTarget = ProactiveChatSetupTarget & {
  existingSession?: ChatSetupSession;
};

async function isProactiveSetupTargetPaired(params: {
  api: OpenClawPluginApi,
  target: ProactiveChatSetupTarget;
}): Promise<boolean> {
  const pairingIdentity = resolveProactivePairingIdentity({
    api: params.api,
    channel: params.target.notifyChannel,
    target: params.target.notifyTarget,
  });
  if (!pairingIdentity) {
    return true;
  }
  const allowFrom = await params.api.runtime.channel.pairing.readAllowFromStore({
    channel: params.target.notifyChannel,
    accountId: pairingIdentity.accountId,
  });
  return allowFrom.some((entry) => entry.trim() === pairingIdentity.senderId);
}

async function proactivelyRequestChatPairing(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  target: ProactiveChatSetupTarget;
  existingSession?: ChatSetupSession;
}): Promise<void> {
  const pairingIdentity = resolveProactivePairingIdentity({
    api: params.api,
    channel: params.target.notifyChannel,
    target: params.target.notifyTarget,
  });
  if (!pairingIdentity) {
    return;
  }
  const request = await params.api.runtime.channel.pairing.upsertPairingRequest({
    channel: params.target.notifyChannel,
    accountId: pairingIdentity.accountId,
    id: pairingIdentity.senderId,
  });
  const now = new Date().toISOString();
  await params.store.upsertSetupSession({
    ...params.existingSession,
    notifyChannel: params.target.notifyChannel,
    notifyTarget: params.target.notifyTarget,
    projectMode: params.target.projectMode ?? params.existingSession?.projectMode,
    repoKey: params.target.repoKey ?? params.existingSession?.repoKey,
    pendingRepoName: params.existingSession?.pendingRepoName,
    stage: "awaiting-chat-pairing",
    githubAuthSource: undefined,
    githubDeviceAuth: undefined,
    lastFailure: undefined,
    createdAt: params.existingSession?.createdAt ?? now,
    updatedAt: now,
  });
  try {
    await sendText({
      api: params.api,
      channel: params.target.notifyChannel,
      target: params.target.notifyTarget,
      text: buildChatSetupAwaitingPairingMessage({
        api: params.api,
        channel: params.target.notifyChannel,
        senderId: pairingIdentity.senderId,
        code: request.code,
        selectionLabel: params.target.repoKey,
      }),
    });
  } catch (error) {
    params.api.logger.warn(
      `openclawcode proactive pairing notification failed for ${params.target.notifyChannel}:${params.target.notifyTarget}: ${String(error)}`,
    );
  }
}

async function proactivelyStartGitHubAuthForTargets(
  api: OpenClawPluginApi,
  store: OpenClawCodeChatopsStore,
  targets: ProactiveGitHubAuthTarget[],
): Promise<void> {
  if (targets.length === 0) {
    return;
  }

  const existingSessions = await store.listSetupSessions();
  const reusableChallenge = existingSessions.find(
    (session) =>
      session.stage === "awaiting-github-device-auth" &&
      session.githubDeviceAuth &&
      !session.githubDeviceAuth.notificationState,
  )?.githubDeviceAuth;

  let githubDeviceAuth = reusableChallenge
    ? cloneGitHubDeviceAuthSession(reusableChallenge)
    : undefined;

  if (!githubDeviceAuth) {
    try {
      const started = await startOnboardingGitHubCliDeviceLogin({
        stateDir: api.runtime.state.resolveStateDir(),
      });
      githubDeviceAuth = {
        pid: started.pid,
        logPath: started.logPath,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        startedAt: started.startedAt,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const target of targets) {
        const now = new Date().toISOString();
        await store.upsertSetupSession({
          ...target.existingSession,
          notifyChannel: target.notifyChannel,
          notifyTarget: target.notifyTarget,
          projectMode: target.projectMode ?? target.existingSession?.projectMode,
          repoKey: target.repoKey ?? target.existingSession?.repoKey,
          pendingRepoName: target.existingSession?.pendingRepoName,
          stage: "awaiting-github-device-auth",
          githubAuthSource: undefined,
          githubDeviceAuth: undefined,
          lastFailure: {
            step: "github-auth",
            reason,
            occurredAt: now,
          },
          createdAt: target.existingSession?.createdAt ?? now,
          updatedAt: now,
        });
        try {
          await sendText({
            api,
            channel: target.notifyChannel,
            target: target.notifyTarget,
            text: buildChatSetupFailedMessage({
              reason,
              repoKey: target.repoKey,
              step: "github-auth",
            }),
          });
        } catch (sendError) {
          api.logger.warn(
            `openclawcode proactive setup notification failed for ${target.notifyChannel}:${target.notifyTarget}: ${String(sendError)}`,
          );
        }
      }
      return;
    }
  }

  for (const target of targets) {
    const now = new Date().toISOString();
    await store.upsertSetupSession({
      ...target.existingSession,
      notifyChannel: target.notifyChannel,
      notifyTarget: target.notifyTarget,
      projectMode: target.projectMode ?? target.existingSession?.projectMode,
      repoKey: target.repoKey ?? target.existingSession?.repoKey,
      pendingRepoName: target.existingSession?.pendingRepoName,
      stage: "awaiting-github-device-auth",
      githubAuthSource: undefined,
      githubDeviceAuth: cloneGitHubDeviceAuthSession(githubDeviceAuth),
      lastFailure: undefined,
      createdAt: target.existingSession?.createdAt ?? now,
      updatedAt: now,
    });
    try {
      await sendText({
        api,
        channel: target.notifyChannel,
        target: target.notifyTarget,
        text: buildChatSetupAwaitingGitHubAuthMessage({
          verificationUri:
            githubDeviceAuth.verificationUri ?? "https://github.com/login/device",
          userCode: githubDeviceAuth.userCode ?? "unknown",
          selectionLabel: target.repoKey,
        }),
      });
    } catch (error) {
      api.logger.warn(
        `openclawcode proactive setup notification failed for ${target.notifyChannel}:${target.notifyTarget}: ${String(error)}`,
      );
    }
  }
}

async function proactivelyStartChatSetupSessions(
  api: OpenClawPluginApi,
  store: OpenClawCodeChatopsStore,
  repoConfigs: OpenClawCodeChatopsRepoConfig[],
): Promise<void> {
  if (repoConfigs.length === 0 || resolveOnboardingGitHubToken()) {
    return;
  }

  const existingSessions = await store.listSetupSessions();
  const targets = (
    await collectProactiveChatSetupTargets(repoConfigs, api.runtime.state.resolveStateDir())
  ).filter(
    (target) =>
      !existingSessions.some(
        (session) =>
          session.notifyChannel === target.notifyChannel &&
          session.notifyTarget === target.notifyTarget,
      ),
  );
  if (targets.length === 0) {
    return;
  }

  const githubAuthTargets: ProactiveGitHubAuthTarget[] = [];
  for (const target of targets) {
    if (await isProactiveSetupTargetPaired({ api, target })) {
      githubAuthTargets.push(target);
      continue;
    }
    await proactivelyRequestChatPairing({
      api,
      store,
      target,
    });
  }

  await proactivelyStartGitHubAuthForTargets(api, store, githubAuthTargets);
}

async function processPendingSetupSessions(
  api: OpenClawPluginApi,
  store: OpenClawCodeChatopsStore,
): Promise<void> {
  const sessions = await store.listSetupSessions();
  for (const session of sessions) {
    if (session.stage === "awaiting-chat-pairing") {
      const target = {
        notifyChannel: session.notifyChannel,
        notifyTarget: session.notifyTarget,
        projectMode: session.projectMode,
        repoKey: session.repoKey,
      } satisfies ProactiveChatSetupTarget;
      if (!(await isProactiveSetupTargetPaired({ api, target }))) {
        continue;
      }
      if (resolveOnboardingGitHubToken()) {
        const message = await continueChatSetupSession({
          store,
          session: {
            ...session,
            updatedAt: new Date().toISOString(),
          },
        });
        await sendText({
          api,
          channel: session.notifyChannel,
          target: session.notifyTarget,
          text: message,
        });
        continue;
      }
      await proactivelyStartGitHubAuthForTargets(api, store, [
        {
          ...target,
          existingSession: session,
        },
      ]);
      continue;
    }

    if (
      session.stage !== "awaiting-github-device-auth" ||
      !session.githubDeviceAuth ||
      session.githubDeviceAuth.notificationState
    ) {
      continue;
    }

    const synced = await syncChatSetupSession({
      store,
      session,
    });
    const notificationState = resolveSetupSessionNotificationState(synced);
    if (!notificationState) {
      continue;
    }

    const message = await continueChatSetupSession({
      store,
      session: synced.session,
    });
    await sendText({
      api,
      channel: synced.session.notifyChannel,
      target: synced.session.notifyTarget,
      text: message,
    });

    const latest = await store.getSetupSession({
      notifyChannel: synced.session.notifyChannel,
      notifyTarget: synced.session.notifyTarget,
    });
    if (!latest?.githubDeviceAuth) {
      continue;
    }
    await store.upsertSetupSession({
      ...latest,
      githubDeviceAuth: {
        ...latest.githubDeviceAuth,
        notificationState,
        notificationSentAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });
  }
}

async function syncChatSetupSession(params: {
  store: OpenClawCodeChatopsStore;
  session: ChatSetupSession;
}): Promise<{
  session: ChatSetupSession;
  status?: OnboardingGitHubCliDeviceLoginStatus;
}> {
  const resolvedToken = resolveOnboardingGitHubToken();
  if (resolvedToken) {
    const updated = {
      ...params.session,
      stage: resolveChatSetupStageAfterAuth(params.session),
      githubAuthSource: resolvedToken.source,
      githubDeviceAuth: params.session.githubDeviceAuth
        ? {
            ...params.session.githubDeviceAuth,
            completedAt:
              params.session.githubDeviceAuth.completedAt ?? new Date().toISOString(),
          }
        : undefined,
      updatedAt: new Date().toISOString(),
    };
    await params.store.upsertSetupSession(updated);
    return {
      session: updated,
    };
  }

  if (!params.session.githubDeviceAuth) {
    return {
      session: params.session,
    };
  }

  const status = await inspectOnboardingGitHubCliDeviceLogin(params.session.githubDeviceAuth);
  if (status.state === "authorized") {
    const updated = {
      ...params.session,
      stage: resolveChatSetupStageAfterAuth(params.session),
      githubAuthSource: status.source,
      githubDeviceAuth: {
        ...params.session.githubDeviceAuth,
        userCode: status.userCode ?? params.session.githubDeviceAuth.userCode,
        verificationUri: status.verificationUri ?? params.session.githubDeviceAuth.verificationUri,
        completedAt: status.completedAt,
      },
      updatedAt: new Date().toISOString(),
    };
    await params.store.upsertSetupSession(updated);
    return {
      session: updated,
      status,
    };
  }

  if (status.state === "failed") {
    const updated = {
      ...params.session,
      githubDeviceAuth: {
        ...params.session.githubDeviceAuth,
        userCode: status.userCode ?? params.session.githubDeviceAuth.userCode,
        verificationUri: status.verificationUri ?? params.session.githubDeviceAuth.verificationUri,
        failureReason: status.reason,
        completedAt: status.completedAt ?? params.session.githubDeviceAuth.completedAt,
      },
      updatedAt: new Date().toISOString(),
    };
    await params.store.upsertSetupSession(updated);
    return {
      session: updated,
      status,
    };
  }

  const updated = {
    ...params.session,
    githubDeviceAuth: {
      ...params.session.githubDeviceAuth,
      userCode: status.userCode,
      verificationUri: status.verificationUri,
    },
    updatedAt: new Date().toISOString(),
  };
  await params.store.upsertSetupSession(updated);
  return {
    session: updated,
    status,
  };
}

function hasGitHubApiCredential(): boolean {
  return Boolean(process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim());
}

function formatValidationIssueClass(value: ValidationIssueClass): string {
  switch (value) {
    case "command-layer":
      return "command-layer";
    case "operator-docs":
      return "operator-docs";
    case "high-risk-validation":
      return "high-risk-validation";
    default:
      return value;
  }
}

function formatValidationIssueTemplate(value: ValidationIssueTemplateId): string {
  return value;
}

interface ValidationPoolEntry {
  issueNumber: number;
  title: string;
  issueClass: ValidationIssueClass;
  template: ValidationIssueTemplateId;
}

interface ValidationPoolSummary {
  entries: ValidationPoolEntry[];
  classCounts: Record<ValidationIssueClass, number>;
  templateCounts: Partial<Record<ValidationIssueTemplateId, number>>;
}

function summarizeValidationPoolEntries(entries: ValidationPoolEntry[]): ValidationPoolSummary {
  const classCounts: Record<ValidationIssueClass, number> = {
    "command-layer": 0,
    "operator-docs": 0,
    "high-risk-validation": 0,
  };
  const templateCounts: Partial<Record<ValidationIssueTemplateId, number>> = {};
  for (const entry of entries) {
    classCounts[entry.issueClass] += 1;
    templateCounts[entry.template] = (templateCounts[entry.template] ?? 0) + 1;
  }
  return {
    entries,
    classCounts,
    templateCounts,
  };
}

async function fetchValidationPoolSummary(params: {
  repo: { owner: string; repo: string };
  github?: GitHubIssueClient;
}): Promise<ValidationPoolSummary | undefined> {
  if (!hasGitHubApiCredential()) {
    return undefined;
  }
  const github = params.github ?? new GitHubRestClient();
  const issues = await github.listIssues({
    owner: params.repo.owner,
    repo: params.repo.repo,
    state: "open",
    perPage: 100,
  });
  const entries = issues
    .flatMap((issue) => {
      const classified = classifyValidationIssue({
        title: issue.title,
        body: issue.body,
      });
      if (!classified) {
        return [];
      }
      return [
        {
          issueNumber: issue.number,
          title: issue.title,
          issueClass: classified.issueClass,
          template: classified.template,
        } satisfies ValidationPoolEntry,
      ];
    })
    .toSorted((left, right) => left.issueNumber - right.issueNumber);
  return summarizeValidationPoolEntries(entries);
}

function buildValidationPoolLines(summary: ValidationPoolSummary | undefined): string[] {
  if (!summary) {
    return [];
  }
  const lines = [`Validation pool: ${summary.entries.length}`];
  if (summary.entries.length > 0) {
    const classSummary = (["command-layer", "operator-docs", "high-risk-validation"] as const)
      .filter((issueClass) => summary.classCounts[issueClass] > 0)
      .map(
        (issueClass) =>
          `${formatValidationIssueClass(issueClass)} ${summary.classCounts[issueClass]}`,
      )
      .join(", ");
    if (classSummary) {
      lines.push(`- classes: ${classSummary}`);
    }
    const templateSummary = Object.entries(summary.templateCounts)
      .filter((entry): entry is [ValidationIssueTemplateId, number] => (entry[1] ?? 0) > 0)
      .toSorted((left, right) => left[0].localeCompare(right[0]))
      .map(([template, count]) => `${formatValidationIssueTemplate(template)} ${count}`)
      .join(", ");
    if (templateSummary) {
      lines.push(`- templates: ${templateSummary}`);
    }
  }
  for (const entry of summary.entries) {
    lines.push(
      `- #${entry.issueNumber} | ${formatValidationIssueClass(entry.issueClass)} | ${formatValidationIssueTemplate(entry.template)} | ${entry.title}`,
    );
  }
  return lines;
}

function buildProviderPauseLines(params: {
  pause: ActiveProviderPause | undefined;
  now?: string;
}): string[] {
  if (!params.pause) {
    return [];
  }
  const now = params.now ?? new Date().toISOString();
  if (params.pause.until <= now) {
    return [];
  }
  return [
    `Provider pause: active until ${params.pause.until}`,
    `- failures: ${params.pause.failureCount} | last failure: ${params.pause.lastFailureAt}`,
    `- reason: ${params.pause.reason}`,
    "- impact: new work can still queue, but queued runs will not start until the pause clears.",
    "- recovery: queue drain resumes automatically after the pause window elapses.",
  ];
}

function appendProviderPauseText(params: {
  text: string;
  pause: ActiveProviderPause | undefined;
  now?: string;
}): string {
  const pauseLines = buildProviderPauseLines({
    pause: params.pause,
    now: params.now,
  });
  if (pauseLines.length === 0) {
    return params.text;
  }
  return [params.text, ...pauseLines].join("\n");
}

function buildProviderPauseResumedMessage(params: {
  pause: ActiveProviderPause;
  issueKey: string;
}): string {
  return [
    "openclawcode is resuming queue drain after the provider pause cleared.",
    `Next issue: ${params.issueKey}`,
    `Previous pause window: ${params.pause.until}`,
    `Recent failures before recovery: ${params.pause.failureCount} | last failure: ${params.pause.lastFailureAt}`,
    `Reason: ${params.pause.reason}`,
  ].join("\n");
}

function buildProviderFailureContextLines(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  now?: string;
  topLevel?: boolean;
}): string[] {
  if (
    !params.snapshot.lastProviderFailureAt &&
    !params.snapshot.providerFailureCount &&
    !params.snapshot.providerPauseUntil
  ) {
    return [];
  }

  const now = params.now ?? new Date().toISOString();
  const summaryParts: string[] = [];
  if (params.snapshot.providerPauseUntil) {
    summaryParts.push(
      params.snapshot.providerPauseUntil > now
        ? `active pause until ${params.snapshot.providerPauseUntil}`
        : `pause cleared after ${params.snapshot.providerPauseUntil}`,
    );
  }
  if (params.snapshot.lastProviderFailureAt) {
    summaryParts.push(`last transient failure at ${params.snapshot.lastProviderFailureAt}`);
  }
  if (summaryParts.length === 0) {
    return [];
  }

  const contextLabel = params.topLevel ? "Provider failure context" : "  provider";
  const reasonLabel = params.topLevel ? "Provider failure reason" : "  provider-reason";
  const line = `${contextLabel}: ${[
    ...summaryParts,
    params.snapshot.providerFailureCount
      ? `failures: ${params.snapshot.providerFailureCount}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" | ")}`;
  const reason = trimToSingleLine(params.snapshot.providerPauseReason);
  return reason ? [line, `${reasonLabel}: ${reason}`] : [line];
}

function buildProviderRerunLines(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  pause: ActiveProviderPause | undefined;
  now?: string;
}): string[] {
  const activePauseLines = buildProviderPauseLines({
    pause: params.pause,
    now: params.now,
  });
  if (activePauseLines.length > 0) {
    return activePauseLines;
  }

  const now = params.now ?? new Date().toISOString();
  if (!params.snapshot.providerPauseUntil || params.snapshot.providerPauseUntil > now) {
    return [];
  }

  const details: string[] = [
    `Provider recovery: pause cleared after ${params.snapshot.providerPauseUntil}`,
  ];
  if (params.snapshot.lastProviderFailureAt || params.snapshot.providerFailureCount) {
    details.push(
      `- last failure: ${[
        params.snapshot.lastProviderFailureAt,
        params.snapshot.providerFailureCount
          ? `failures: ${params.snapshot.providerFailureCount}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" | ")}`,
    );
  }
  const reason = trimToSingleLine(params.snapshot.providerPauseReason);
  if (reason) {
    details.push(`- reason: ${reason}`);
  }
  details.push("- note: this rerun is probing recovery after the cleared pause window.");
  return details;
}

function buildDeferredRuntimeRerouteLines(params: {
  record: OpenClawCodeDeferredRuntimeReroute | undefined;
  topLevel?: boolean;
}): string[] {
  const record = params.record;
  if (!record) {
    return [];
  }
  const label = params.topLevel ? "Pending runtime reroute" : "  pending-reroute";
  const reroute = [
    record.requestedCoderAgentId ? `coder=${record.requestedCoderAgentId}` : undefined,
    record.requestedVerifierAgentId ? `verifier=${record.requestedVerifierAgentId}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  if (!reroute) {
    return [];
  }
  const lines = [`${label}: ${[reroute, record.requestedAt].filter(Boolean).join(" | ")}`];
  const note = trimToSingleLine(record.note);
  if (note) {
    lines.push(`${params.topLevel ? "Pending reroute note" : "  pending-reroute-note"}: ${note}`);
  }
  return lines;
}

async function appendValidationIssueStatusContext(params: {
  text: string;
  issue: { owner: string; repo: string; number: number };
  github?: GitHubIssueClient;
}): Promise<string> {
  if (!hasGitHubApiCredential()) {
    return params.text;
  }
  const github = params.github ?? new GitHubRestClient();
  const issue = await github.fetchIssue({
    owner: params.issue.owner,
    repo: params.issue.repo,
    issueNumber: params.issue.number,
  });
  const classified = classifyValidationIssue({
    title: issue.title,
    body: issue.body,
  });
  if (!classified) {
    return params.text;
  }
  return [
    params.text,
    `Validation issue: ${formatValidationIssueClass(classified.issueClass)}`,
    `Validation template: ${formatValidationIssueTemplate(classified.template)}`,
  ].join("\n");
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
    case "completed-without-changes":
      return "completed without changes";
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

function formatReviewDecisionLabel(decision: "approved" | "changes-requested"): string {
  return decision === "approved" ? "Approved" : "Changes Requested";
}

function buildRerunLedgerLines(params: {
  priorRunId?: string;
  priorStage?: string;
  requestedAt?: string;
  reason?: string;
  reviewDecision?: "approved" | "changes-requested";
  reviewSubmittedAt?: string;
  reviewSummary?: string;
  reviewUrl?: string;
  requestedCoderAgentId?: string;
  requestedVerifierAgentId?: string;
  manualTakeoverRequestedAt?: string;
  manualTakeoverActor?: string;
  manualTakeoverWorktreePath?: string;
  manualResumeNote?: string;
  topLevel?: boolean;
}): string[] {
  if (
    !params.priorRunId &&
    !params.priorStage &&
    !params.requestedAt &&
    !params.reason &&
    !params.reviewDecision &&
    !params.reviewSubmittedAt &&
    !params.reviewSummary &&
    !params.reviewUrl &&
    !params.requestedCoderAgentId &&
    !params.requestedVerifierAgentId &&
    !params.manualTakeoverRequestedAt &&
    !params.manualTakeoverActor &&
    !params.manualTakeoverWorktreePath &&
    !params.manualResumeNote
  ) {
    return [];
  }

  const rerunLabel = params.topLevel ? "Rerun" : "  rerun";
  const reasonLabel = params.topLevel ? "Rerun reason" : "  reason";
  const rerouteLabel = params.topLevel ? "Reroute" : "  reroute";
  const reviewLabel = params.topLevel ? "Rerun review" : "  review";
  const reviewSummaryLabel = params.topLevel ? "Rerun review summary" : "  review-summary";
  const reviewUrlLabel = params.topLevel ? "Rerun review URL" : "  review-url";
  const manualResumeLabel = params.topLevel ? "Manual resume" : "  manual-resume";
  const manualWorktreeLabel = params.topLevel ? "Manual worktree" : "  manual-worktree";
  const manualNoteLabel = params.topLevel ? "Manual note" : "  manual-note";
  const line = `${rerunLabel}: ${[
    params.priorRunId ?? "prior run unknown",
    params.priorStage ? `from ${formatStageLabel(params.priorStage)}` : "from unknown stage",
    params.requestedAt,
  ]
    .filter(Boolean)
    .join(" | ")}`;
  const reason = trimToSingleLine(params.reason);
  const reviewLine = [
    params.reviewDecision ? formatReviewDecisionLabel(params.reviewDecision) : undefined,
    params.reviewSubmittedAt,
  ]
    .filter(Boolean)
    .join(" | ");
  const reviewSummary = trimToSingleLine(params.reviewSummary);
  const reviewUrl = trimToSingleLine(params.reviewUrl);
  const runtimeReroute = [
    params.requestedCoderAgentId ? `coder=${params.requestedCoderAgentId}` : undefined,
    params.requestedVerifierAgentId ? `verifier=${params.requestedVerifierAgentId}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const manualResumeLine = [
    params.manualTakeoverActor ? `actor=${params.manualTakeoverActor}` : undefined,
    params.manualTakeoverRequestedAt ? `requestedAt=${params.manualTakeoverRequestedAt}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
  const manualWorktree = trimToSingleLine(params.manualTakeoverWorktreePath);
  const manualNote = trimToSingleLine(params.manualResumeNote);
  return [
    line,
    ...(reason ? [`${reasonLabel}: ${reason}`] : []),
    ...(reviewLine ? [`${reviewLabel}: ${reviewLine}`] : []),
    ...(reviewSummary ? [`${reviewSummaryLabel}: ${reviewSummary}`] : []),
    ...(reviewUrl ? [`${reviewUrlLabel}: ${reviewUrl}`] : []),
    ...(runtimeReroute ? [`${rerouteLabel}: ${runtimeReroute}`] : []),
    ...(manualResumeLine ? [`${manualResumeLabel}: ${manualResumeLine}`] : []),
    ...(manualWorktree ? [`${manualWorktreeLabel}: ${manualWorktree}`] : []),
    ...(manualNote ? [`${manualNoteLabel}: ${manualNote}`] : []),
  ];
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

function buildOperatorContextLines(repoConfig: OpenClawCodeChatopsRepoConfig): string[] {
  const lines = [
    `Operator repo root: ${repoConfig.repoRoot}`,
    `Operator baseline: ${repoConfig.baseBranch}`,
  ];
  const profile = process.env.OPENCLAW_PROFILE?.trim();
  if (profile) {
    lines.push(`OpenClaw profile: ${profile}`);
  }
  const configPath = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (configPath) {
    lines.push(`OpenClaw config: ${configPath}`);
  }
  return lines;
}

function isSetupCheckReadinessPayload(value: unknown): value is SetupCheckReadinessPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.basic === "boolean" &&
    typeof candidate.strict === "boolean" &&
    typeof candidate.lowRiskProofReady === "boolean" &&
    typeof candidate.fallbackProofReady === "boolean" &&
    typeof candidate.promotionReady === "boolean" &&
    typeof candidate.chatSetupRoutingReady === "boolean" &&
    typeof candidate.gatewayReachable === "boolean" &&
    typeof candidate.routeProbeReady === "boolean" &&
    typeof candidate.routeProbeSkipped === "boolean" &&
    typeof candidate.builtStartupProofRequested === "boolean" &&
    typeof candidate.builtStartupProofReady === "boolean" &&
    typeof candidate.nextAction === "string"
  );
}

function isSetupCheckPluginActivationPayload(
  value: unknown,
): value is SetupCheckPluginActivationPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ready === "boolean" &&
    typeof candidate.pluginsEnabled === "boolean" &&
    typeof candidate.allowlisted === "boolean" &&
    typeof candidate.entryEnabled === "boolean"
  );
}

function isSetupCheckSummaryPayload(value: unknown): value is SetupCheckSummaryPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.pass === "number" &&
    typeof candidate.warn === "number" &&
    typeof candidate.fail === "number"
  );
}

function parseSetupCheckProbePayload(stdout: string): SetupCheckProbePayload | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.ok !== "boolean" ||
    typeof candidate.strict !== "boolean" ||
    typeof candidate.repoRoot !== "string" ||
    typeof candidate.operatorRoot !== "string" ||
    !isSetupCheckReadinessPayload(candidate.readiness) ||
    !isSetupCheckSummaryPayload(candidate.summary)
  ) {
    return undefined;
  }
  return {
    ok: candidate.ok,
    strict: candidate.strict,
    repoRoot: candidate.repoRoot,
    operatorRoot: candidate.operatorRoot,
    readiness: candidate.readiness,
    pluginActivation: isSetupCheckPluginActivationPayload(candidate.pluginActivation)
      ? candidate.pluginActivation
      : undefined,
    summary: candidate.summary,
  };
}

async function probeSetupCheckReadiness(params: {
  api: OpenClawPluginApi;
  repoConfig: OpenClawCodeChatopsRepoConfig;
}): Promise<SetupCheckProbePayload | undefined> {
  const scriptPath = path.join(
    params.repoConfig.repoRoot,
    "scripts",
    "openclawcode-setup-check.sh",
  );
  const operatorRoot =
    process.env.OPENCLAWCODE_SETUP_OPERATOR_ROOT?.trim() ||
    process.env.OPENCLAWCODE_OPERATOR_ROOT?.trim() ||
    params.repoConfig.repoRoot;
  let result:
    | {
        code: number;
        stdout: string;
        stderr: string;
      }
    | undefined;
  try {
    result = await params.api.runtime.system.runCommandWithTimeout(
      ["bash", scriptPath, "--strict", "--json"],
      {
        cwd: params.repoConfig.repoRoot,
        timeoutMs: 90_000,
        noOutputTimeoutMs: 90_000,
        env: {
          OPENCLAWCODE_SETUP_OPERATOR_ROOT: operatorRoot,
        },
      },
    );
  } catch {
    result = undefined;
  }
  if (!result || typeof result.stdout !== "string") {
    return undefined;
  }
  return parseSetupCheckProbePayload(result.stdout);
}

function buildPromotionReadinessLines(params: {
  repoConfig: OpenClawCodeChatopsRepoConfig;
  probe?: SetupCheckProbePayload;
}): string[] {
  if (!params.probe) {
    return [];
  }
  return [
    `Promotion readiness: ${params.probe.readiness.promotionReady ? "ready" : "blocked"} | next=${params.probe.readiness.nextAction}`,
    `Proof readiness: low-risk=${params.probe.readiness.lowRiskProofReady ? "ready" : "blocked"} | fallback=${params.probe.readiness.fallbackProofReady ? "ready" : "blocked"}`,
    `Rollback readiness: ${params.repoConfig.baseBranch ? "ready" : "blocked"} | target=${params.repoConfig.baseBranch || "unknown"}`,
    `Setup-check summary: pass=${params.probe.summary.pass} | warn=${params.probe.summary.warn} | fail=${params.probe.summary.fail}`,
  ];
}

function buildReleaseReceiptLines(params: {
  promotionReceipt?: Awaited<ReturnType<typeof readProjectPromotionReceiptArtifact>>;
  rollbackReceipt?: Awaited<ReturnType<typeof readProjectRollbackReceiptArtifact>>;
}): string[] {
  const lines: string[] = [];
  if (params.promotionReceipt?.exists) {
    lines.push(
      `Latest promotion receipt: ${[
        params.promotionReceipt.promotedRef,
        params.promotionReceipt.actor ? `actor=${params.promotionReceipt.actor}` : undefined,
        params.promotionReceipt.recordedAt,
      ]
        .filter(Boolean)
        .join(" | ")}`,
    );
  }
  if (params.rollbackReceipt?.exists) {
    lines.push(
      `Latest rollback receipt: ${[
        params.rollbackReceipt.restoredRef,
        params.rollbackReceipt.actor ? `actor=${params.rollbackReceipt.actor}` : undefined,
        params.rollbackReceipt.recordedAt,
      ]
        .filter(Boolean)
        .join(" | ")}`,
    );
  }
  return lines;
}

function buildPromotionChecklistMessage(params: {
  repoConfig: OpenClawCodeChatopsRepoConfig;
  probe?: SetupCheckProbePayload;
  promotionReceipt?: Awaited<ReturnType<typeof readProjectPromotionReceiptArtifact>>;
  rollbackReceipt?: Awaited<ReturnType<typeof readProjectRollbackReceiptArtifact>>;
}): string {
  const lines = [
    `openclawcode promotion checklist for ${formatRepoKey(params.repoConfig)}`,
    `Operator repo root: ${params.repoConfig.repoRoot}`,
    `Operator baseline: ${params.repoConfig.baseBranch}`,
  ];
  if (!params.probe) {
    lines.push("Setup-check probe: unavailable");
    lines.push(
      "Retry after the operator host can run scripts/openclawcode-setup-check.sh --strict --json.",
    );
    return lines.join("\n");
  }
  lines.push(`Operator root: ${params.probe.operatorRoot}`);
  lines.push(...buildPromotionReadinessLines(params));
  lines.push(...buildReleaseReceiptLines(params));
  lines.push(
    `Checklist: strict=${params.probe.readiness.strict ? "yes" : "no"} | gateway=${params.probe.readiness.gatewayReachable ? "yes" : "no"} | route-probe=${params.probe.readiness.routeProbeReady ? "yes" : params.probe.readiness.routeProbeSkipped ? "skipped" : "no"} | built-startup=${params.probe.readiness.builtStartupProofReady ? "yes" : "no"}`,
  );
  return lines.join("\n");
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
  const overrideLine = snapshot.suitabilityOverrideApplied
    ? `  suitability override: applied${snapshot.suitabilityOverrideActor ? ` | actor=${snapshot.suitabilityOverrideActor}` : ""}${snapshot.suitabilityOverrideReason ? ` | ${trimToSingleLine(snapshot.suitabilityOverrideReason)}` : ""}`
    : undefined;
  return [line, overrideLine].filter((entry): entry is string => Boolean(entry));
}

function buildTopLevelSuitabilityPolicyLines(snapshot: OpenClawCodeIssueStatusSnapshot): string[] {
  if (!snapshot.suitabilityDecision || !snapshot.suitabilitySummary) {
    return [];
  }
  if (snapshot.suitabilityDecision === "auto-run" && !snapshot.suitabilityOverrideApplied) {
    return [];
  }
  return [
    `Suitability policy: ${[
      snapshot.suitabilityDecision,
      trimToSingleLine(snapshot.suitabilitySummary),
    ]
      .filter(Boolean)
      .join(" | ")}`,
    ...(snapshot.suitabilityOverrideApplied
      ? [
          `Suitability override: applied${snapshot.suitabilityOverrideReason ? ` | ${trimToSingleLine(snapshot.suitabilityOverrideReason)}` : ""}`,
        ]
      : []),
  ];
}

function buildTopLevelRuntimeRoutingLines(snapshot: OpenClawCodeIssueStatusSnapshot): string[] {
  if (!snapshot.runtimeRoutingSummary || snapshot.status.includes("\nRuntime routing:")) {
    return [];
  }
  return [`Runtime routing: ${snapshot.runtimeRoutingSummary}`];
}

function buildTopLevelQualityGateLines(snapshot: OpenClawCodeIssueStatusSnapshot): string[] {
  if (!snapshot.qualityGateStatus || !snapshot.qualityGateSummary) {
    return [];
  }
  if (snapshot.status.includes("\nQuality gate:")) {
    return [];
  }
  return [`Quality gate: ${snapshot.qualityGateStatus} | ${snapshot.qualityGateSummary}`];
}

function summarizeRepoQualityGates(params: {
  state: Awaited<ReturnType<OpenClawCodeChatopsStore["snapshot"]>>;
  repo: { owner: string; repo: string };
}): string | undefined {
  const counts = {
    pass: 0,
    warn: 0,
    fail: 0,
    pending: 0,
  };
  for (const snapshot of Object.values(params.state.statusSnapshotsByIssue)) {
    if (!issueKeyMatchesRepo(snapshot.issueKey, params.repo) || !snapshot.qualityGateStatus) {
      continue;
    }
    counts[snapshot.qualityGateStatus] += 1;
  }
  if (counts.pass + counts.warn + counts.fail + counts.pending === 0) {
    return undefined;
  }
  return `Quality gates: pass=${counts.pass} | warn=${counts.warn} | fail=${counts.fail} | pending=${counts.pending}`;
}

function buildInboxQualityGateLines(snapshot: OpenClawCodeIssueStatusSnapshot): string[] {
  if (!snapshot.qualityGateStatus || !snapshot.qualityGateSummary) {
    return [];
  }
  return [`  quality: ${snapshot.qualityGateStatus} | ${trimToSingleLine(snapshot.qualityGateSummary)}`];
}

function buildTopLevelHandoffSummaryLines(snapshot: OpenClawCodeIssueStatusSnapshot): string[] {
  if (
    !snapshot.handoffEntries ||
    snapshot.handoffEntries.length === 0 ||
    snapshot.status.includes("\nHandoffs:")
  ) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const entry of snapshot.handoffEntries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }

  const summary = [...counts.entries()]
    .toSorted((left, right) => left[0].localeCompare(right[0]))
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");

  return [`Handoffs: ${summary}`];
}

function buildTopLevelAutoMergePolicyLines(snapshot: OpenClawCodeIssueStatusSnapshot): string[] {
  if (
    snapshot.autoMergePolicyEligible !== false ||
    !snapshot.autoMergePolicyReason ||
    snapshot.stage !== "ready-for-human-review"
  ) {
    return [];
  }
  return [`Auto-merge policy: blocked | ${trimToSingleLine(snapshot.autoMergePolicyReason)}`];
}

function buildPolicyShortcutLines(params: {
  issueKey: string;
  snapshot?: OpenClawCodeIssueStatusSnapshot;
}): string[] {
  const snapshot = params.snapshot;
  if (!snapshot) {
    return [];
  }
  if (
    snapshot.suitabilityDecision === "auto-run" &&
    !snapshot.suitabilityOverrideApplied &&
    snapshot.autoMergePolicyEligible !== false
  ) {
    return [];
  }
  return [`  policy: /occode-policy ${params.issueKey}`];
}

function buildPendingApprovalActionLines(params: {
  entry: {
    issueKey: string;
    approvalKind?: "manual" | "execution-start-gated";
  };
}): string[] {
  if (params.entry.approvalKind === "execution-start-gated") {
    const parsed = parseIssueKey(params.entry.issueKey);
    if (!parsed) {
      return [];
    }
    const repoKey = `${parsed.owner}/${parsed.repo}`;
    return [
      `  action: /occode-gates ${repoKey}`,
      `  approve: /occode-gate-decide ${repoKey} execution-start approved [note]`,
    ];
  }
  return [`  action: /occode-start ${params.entry.issueKey}`];
}

function buildRunningActionLines(issueKey: string): string[] {
  return [
    `  action: /occode-status ${issueKey}`,
    `  takeover: /occode-takeover ${issueKey} [note]`,
  ];
}

function buildQueuedActionLines(issueKey: string): string[] {
  return [
    `  action: /occode-status ${issueKey}`,
    `  skip: /occode-skip ${issueKey} [reason]`,
  ];
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
    "Escalation path: human review required before execution.",
    `Next: /occode-start-override ${issueKey} only after a human accepts a one-run exception.`,
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

async function queueOrGateIssueExecution(params: {
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
  queuedStatus: string;
  gatedStatus?: string;
}): Promise<
  | {
      outcome: "queued";
      queuedRun: NonNullable<
        Awaited<ReturnType<OpenClawCodeChatopsStore["promotePendingApprovalToQueue"]>>
      >;
    }
  | {
      outcome: "gated";
      gate: NonNullable<Awaited<ReturnType<typeof readExecutionStartGate>>["gate"]>;
    }
  | {
      outcome: "already-tracked";
    }
> {
  const executionStartGate = await readExecutionStartGate(params.repoConfig.repoRoot);
  if (executionStartGate && executionStartGate.gate.readiness !== "ready") {
    const accepted = await params.store.addPendingApproval(
      {
        issueKey: formatIssueKey(params.issue),
        notifyChannel: params.destination.channel,
        notifyTarget: params.destination.target,
        approvalKind: "execution-start-gated",
      },
      params.gatedStatus ?? "Awaiting execution-start gate approval.",
    );
    if (!accepted) {
      return { outcome: "already-tracked" };
    }
    return {
      outcome: "gated",
      gate: executionStartGate.gate,
    };
  }

  const queuedRun = await enqueueInteractiveIssueIntake({
    store: params.store,
    repoConfig: params.repoConfig,
    issue: params.issue,
    destination: params.destination,
    status: params.queuedStatus,
  });
  if (!queuedRun) {
    return { outcome: "already-tracked" };
  }
  return {
    outcome: "queued",
    queuedRun,
  };
}

async function createAndHandleChatIntakeIssue(params: {
  store: OpenClawCodeChatopsStore;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  destination: {
    channel: string;
    target: string;
  };
  draft: {
    title: string;
    body: string;
  };
}): Promise<{ text: string; shouldKickQueue: boolean; issueCreated: boolean }> {
  const github = new GitHubRestClient();
  let createdIssue: Awaited<ReturnType<GitHubRestClient["createIssue"]>>;
  try {
    createdIssue = await github.createIssue({
      owner: params.repoConfig.owner,
      repo: params.repoConfig.repo,
      title: params.draft.title,
      body: params.draft.body,
    });
  } catch (error) {
    return {
      text: `Failed to create a GitHub issue for ${params.repoConfig.owner}/${params.repoConfig.repo}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      shouldKickQueue: false,
      issueCreated: false,
    };
  }

  const decision = decideIssueWebhookIntake({
    event: buildSyntheticIssueWebhookEvent({ issue: createdIssue }),
    config: {
      ...params.repoConfig,
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
      shouldKickQueue: false,
      issueCreated: true,
    };
  }

  if (decision.precheck?.decision === "escalate") {
    const accepted = await recordPrecheckedEscalationSnapshot({
      store: params.store,
      issue: decision.issue,
      destination: params.destination,
      summary: decision.precheck.summary,
      suitabilityDecision: decision.precheck.decision,
    });
    if (!accepted) {
      return {
        text: [
          `Created GitHub issue ${issueKey}.`,
          createdIssue.url,
          (await params.store.getStatus(issueKey)) ?? `${issueKey} is already tracked.`,
        ].join("\n"),
        shouldKickQueue: false,
        issueCreated: true,
      };
    }
    return {
      text: buildIntakeEscalatedMessage({
        issue: createdIssue,
        summary: decision.precheck.summary,
      }),
      shouldKickQueue: false,
      issueCreated: true,
    };
  }

  const queued = await queueOrGateIssueExecution({
    store: params.store,
    repoConfig: params.repoConfig,
    issue: decision.issue,
    destination: params.destination,
    queuedStatus: "Queued from chat intake.",
    gatedStatus: "Awaiting execution-start gate approval.",
  });
  if (queued.outcome === "already-tracked") {
    return {
      text: [
        `Created GitHub issue ${issueKey}.`,
        createdIssue.url,
        (await params.store.getStatus(issueKey)) ?? `${issueKey} is already queued or running.`,
      ].join("\n"),
      shouldKickQueue: false,
      issueCreated: true,
    };
  }
  if (queued.outcome === "queued") {
    const providerPause = await params.store.getActiveProviderPause();
    return {
      text: buildIntakeQueuedMessage({
        issue: createdIssue,
        pause: providerPause,
      }),
      shouldKickQueue: true,
      issueCreated: true,
    };
  }

  return {
    text: buildExecutionStartGateDeferredMessage({
      issue: createdIssue,
      gate: queued.gate,
      source: "chat-intake",
    }),
    shouldKickQueue: false,
    issueCreated: true,
  };
}

async function materializeAndHandleNextWorkIssue(params: {
  store: OpenClawCodeChatopsStore;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  destination: {
    channel: string;
    target: string;
  };
}): Promise<{ text: string; shouldKickQueue: boolean }> {
  const artifact = await writeProjectIssueMaterializationArtifact({
    repoRoot: params.repoConfig.repoRoot,
    owner: params.repoConfig.owner,
    repo: params.repoConfig.repo,
  });
  const workItems = await readProjectWorkItemInventory(params.repoConfig.repoRoot);
  const selectedWorkItem = artifact.selectedWorkItemId
    ? workItems.workItems.find((entry) => entry.id === artifact.selectedWorkItemId)
    : undefined;

  if (artifact.selectedIssueNumber == null) {
    return {
      text: buildIssueMaterializationSummaryMessage({
        repo: {
          owner: params.repoConfig.owner,
          repo: params.repoConfig.repo,
        },
        artifact,
      }),
      shouldKickQueue: false,
    };
  }

  const issue = {
    owner: params.repoConfig.owner,
    repo: params.repoConfig.repo,
    number: artifact.selectedIssueNumber,
  };
  const decision = decideIssueWebhookIntake({
    event: buildSyntheticIssueWebhookEvent({
      issue: {
        ...issue,
        title: artifact.selectedIssueTitle ?? "[Blueprint] materialized issue",
        body: selectedWorkItem?.githubIssueDraft.body,
      },
    }),
    config: {
      ...params.repoConfig,
      triggerLabels: [],
      skipLabels: [],
    },
  });

  if (!decision.accept || !decision.issue) {
    return {
      text: [
        buildIssueMaterializationSummaryMessage({
          repo: {
            owner: params.repoConfig.owner,
            repo: params.repoConfig.repo,
          },
          artifact,
        }),
        `Automatic intake was skipped: ${decision.reason}`,
      ].join("\n"),
      shouldKickQueue: false,
    };
  }

  if (decision.precheck?.decision === "escalate") {
    await recordPrecheckedEscalationSnapshot({
      store: params.store,
      issue: decision.issue,
      destination: params.destination,
      summary: decision.precheck.summary,
      suitabilityDecision: decision.precheck.decision,
    });
    return {
      text: [
        buildIssueMaterializationSummaryMessage({
          repo: {
            owner: params.repoConfig.owner,
            repo: params.repoConfig.repo,
          },
          artifact,
        }),
        `Suitability: escalate | ${decision.precheck.summary}`,
      ].join("\n"),
      shouldKickQueue: false,
    };
  }

  const queued = await queueOrGateIssueExecution({
    store: params.store,
    repoConfig: params.repoConfig,
    issue: decision.issue,
    destination: params.destination,
    queuedStatus: "Queued from blueprint issue materialization.",
    gatedStatus: "Awaiting execution-start gate approval.",
  });

  if (queued.outcome === "queued") {
    return {
      text: [
        buildIssueMaterializationSummaryMessage({
          repo: {
            owner: params.repoConfig.owner,
            repo: params.repoConfig.repo,
          },
          artifact,
        }),
        `Queued ${formatRepoKey(decision.issue)}#${decision.issue.number}.`,
      ].join("\n"),
      shouldKickQueue: true,
    };
  }

  if (queued.outcome === "gated") {
    return {
      text: [
        buildIssueMaterializationSummaryMessage({
          repo: {
            owner: params.repoConfig.owner,
            repo: params.repoConfig.repo,
          },
          artifact,
        }),
        buildExecutionStartGateDeferredMessage({
          issue: decision.issue,
          gate: queued.gate,
          source: "issue-materialization",
        }),
      ].join("\n"),
      shouldKickQueue: false,
    };
  }

  return {
    text: [
      buildIssueMaterializationSummaryMessage({
        repo: {
          owner: params.repoConfig.owner,
          repo: params.repoConfig.repo,
        },
        artifact,
      }),
      (await params.store.getStatus(formatIssueKey(issue))) ??
        `${formatIssueKey(issue)} is already queued or running.`,
    ].join("\n"),
    shouldKickQueue: false,
  };
}

function buildIntakeQueuedMessage(params: {
  issue: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    url?: string;
  };
  pause?: ActiveProviderPause;
}): string {
  const issueKey = formatIssueKey(params.issue);
  return appendProviderPauseText({
    text: [
      "openclawcode created and queued a new GitHub issue from chat.",
      `Issue: ${issueKey}`,
      `Title: ${params.issue.title}`,
      params.issue.url ? `URL: ${params.issue.url}` : undefined,
      "Status: queued for execution",
      `Use /occode-status ${issueKey} to inspect progress.`,
    ]
      .filter(Boolean)
      .join("\n"),
    pause: params.pause,
  });
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
    "Escalation path: human review required before execution.",
    `Use /occode-status ${issueKey} to inspect the tracked status.`,
    `Use /occode-start-override ${issueKey} only after a human accepts a one-run exception.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildExecutionStartGateDeferredMessage(params: {
  issue: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    url?: string;
  };
  gate: NonNullable<Awaited<ReturnType<typeof readExecutionStartGate>>["gate"]>;
  source: "chat-intake" | "auto-webhook";
}): string {
  const issueKey = formatIssueKey(params.issue);
  return [
    params.source === "chat-intake"
      ? "openclawcode created a new GitHub issue from chat, but execution start is currently gated."
      : "openclawcode received a new GitHub issue, but execution start is currently gated.",
    `Issue: ${issueKey}`,
    `Title: ${params.issue.title}`,
    params.issue.url ? `URL: ${params.issue.url}` : undefined,
    `Gate: ${params.gate.gateId}`,
    `Readiness: ${params.gate.readiness}`,
    params.gate.blockers.length > 0
      ? `Blockers: ${params.gate.blockers.slice(0, 2).join(" ; ")}`
      : params.gate.suggestions.length > 0
        ? `Suggestions: ${params.gate.suggestions.slice(0, 2).join(" ; ")}`
        : undefined,
    `Use /occode-gates ${params.issue.owner}/${params.issue.repo} to inspect the current gate state.`,
    `Use /occode-gate-decide ${params.issue.owner}/${params.issue.repo} execution-start approved [note] when a human accepts the current execution-start risk.`,
    "Once the gate is approved, openclawcode will resume this held execution automatically.",
  ]
    .filter(Boolean)
    .join("\n");
}

type ChatIntakeClarificationReport = {
  kind: "feature" | "bugfix" | "refactor" | "research";
  needsConfirmation: boolean;
  priorityQuestion: string | null;
  questions: string[];
  suggestions: string[];
};

function analyzeChatIntakeDraft(params: {
  title: string;
  body: string;
  bodySynthesized: boolean;
  answeredQuestions?: string[];
}): ChatIntakeClarificationReport {
  const questions: string[] = [];
  const seenQuestions = new Set<string>();
  const suggestions: string[] = [];
  const seenSuggestions = new Set<string>();
  const answeredQuestions = new Set((params.answeredQuestions ?? []).map((value) => value.trim()));
  const combinedText = [params.title, params.body].join("\n");
  const kind = classifyChatIssueDraftKind(combinedText);
  const wordCount = params.title
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;

  const addQuestion = (question: string): void => {
    if (answeredQuestions.has(question)) {
      return;
    }
    if (!seenQuestions.has(question)) {
      seenQuestions.add(question);
      questions.push(question);
    }
  };
  const addSuggestion = (suggestion: string): void => {
    if (!seenSuggestions.has(suggestion)) {
      seenSuggestions.add(suggestion);
      suggestions.push(suggestion);
    }
  };

  if (params.bodySynthesized) {
    switch (kind) {
      case "bugfix":
        addQuestion("What is the observed behavior right now?");
        addQuestion("What should happen instead when the bug is fixed?");
        addQuestion("What is the smallest reproduction path or failing proof?");
        break;
      case "refactor":
        addQuestion("What behavior must remain unchanged during this refactor?");
        addQuestion("What first safe checkpoint should still work after the first structural change?");
        addQuestion("What part of the codebase is in scope, and what should stay untouched?");
        break;
      case "research":
        addQuestion("What concrete question should this investigation answer?");
        addQuestion("What evidence or proof should the investigation collect?");
        addQuestion("What next executable slice should come out of the investigation?");
        break;
      default:
        addQuestion("What exact behavior, contract, or operator surface should change?");
        addQuestion("What proof should show the request succeeded?");
        addQuestion("Are there any files, commands, or constraints the workflow must avoid?");
        break;
    }
  }
  if (wordCount <= 5) {
    addQuestion(
      "Can you restate the request with a slightly more specific user-visible outcome?",
    );
  }
  switch (kind) {
    case "bugfix":
      addSuggestion(
        "Capture observed behavior, expected behavior, and the smallest reproduction before confirming the draft.",
      );
      addSuggestion(
        "Prefer a regression proof before the fix so the failure cannot silently return.",
      );
      break;
    case "refactor":
      addSuggestion(
        "State the invariant behavior and the first safe checkpoint before confirming the draft.",
      );
      addSuggestion(
        "Split behavior-preserving structure changes from behavior changes whenever possible.",
      );
      break;
    case "research":
      addSuggestion(
        "End the draft with a recommendation and the next executable slice, not only observations.",
      );
      break;
    default:
      addSuggestion(
        "Describe the public behavior change and the proof of success before confirming the draft.",
      );
      break;
  }
  addSuggestion(
    "Use `/occode-intake-edit` to refine the generated title or body before issue creation.",
  );
  addSuggestion(
    "Use `/occode-intake-confirm` only after the draft is specific enough to execute safely.",
  );

  return {
    kind,
    needsConfirmation: params.bodySynthesized || questions.length > 0,
    priorityQuestion: questions[0] ?? null,
    questions,
    suggestions,
  };
}

function buildPendingIntakeDraftMessage(params: {
  repo: { owner: string; repo: string };
  draft: {
    title: string;
    body: string;
    bodySynthesized: boolean;
    clarificationResponses?: Array<{
      question: string;
      answer: string;
      answeredAt: string;
    }>;
    scopedDrafts?: Array<{
      title: string;
      reason: string;
    }>;
  };
  clarification: ChatIntakeClarificationReport;
  introLine?: string;
}): string {
  const clarificationResponses = params.draft.clarificationResponses ?? [];
  const materializedBody = materializePendingIntakeDraftBody({
    body: params.draft.body,
    clarificationResponses,
  });
  return [
    params.introLine ??
      `openclawcode drafted a chat intake issue for ${formatRepoKey(params.repo)} but is waiting for confirmation.`,
    `Intake mode: ${params.clarification.kind}`,
    `Title: ${params.draft.title}`,
    `Body source: ${params.draft.bodySynthesized ? "generated from one-line intake" : "edited draft"}`,
    "Body preview:",
    materializedBody,
    `Clarification answers: ${clarificationResponses.length}`,
    ...clarificationResponses
      .slice(-2)
      .map((response) => `- Answered: ${trimToSingleLine(response.question)}`),
    params.clarification.priorityQuestion
      ? `Priority question: ${params.clarification.priorityQuestion}`
      : undefined,
    `Clarifications: ${params.clarification.questions.length}`,
    ...params.clarification.questions.slice(0, 3).map((question) => `- ${question}`),
    `Scoped drafts: ${params.draft.scopedDrafts?.length ?? 0}`,
    ...(params.draft.scopedDrafts ?? [])
      .slice(0, 3)
      .map((draft, index) => `- [${index + 1}] ${draft.title} (${draft.reason})`),
    `Suggestions: ${params.clarification.suggestions.length}`,
    ...params.clarification.suggestions.slice(0, 2).map((suggestion) => `- ${suggestion}`),
    ...(params.draft.scopedDrafts?.length
      ? [
          `Use /occode-intake-choose ${formatRepoKey(params.repo)} <index> to replace the pending draft with one scoped variant.`,
        ]
      : []),
    ...(params.clarification.questions.length > 0
      ? [
          `Use /occode-intake-answer ${formatRepoKey(params.repo)} [index] <answer...> to answer one clarification and refresh the draft.`,
        ]
      : []),
    `Use /occode-intake-preview ${formatRepoKey(params.repo)} to review the pending draft again before creation.`,
    `Use /occode-intake-edit ${formatRepoKey(params.repo)} <title>\\n<body...> to refine the draft.`,
    `Use /occode-intake-confirm ${formatRepoKey(params.repo)} when the draft is ready to create on GitHub.`,
    `Use /occode-intake-reject ${formatRepoKey(params.repo)} [reason] to discard the pending draft.`,
  ].join("\n");
}

function materializePendingIntakeDraftBody(params: {
  body: string;
  clarificationResponses?: Array<{
    question: string;
    answer: string;
    answeredAt: string;
  }>;
}): string {
  const responses = params.clarificationResponses ?? [];
  if (responses.length === 0) {
    return params.body;
  }
  return [
    params.body,
    "",
    "Clarifications from operator",
    ...responses.flatMap((response) => [
      "",
      `Q: ${response.question}`,
      `A: ${response.answer}`,
    ]),
  ].join("\n");
}

function parseRepoScopedMultilineBody(params: {
  commandBody: string;
  commandName: string;
  defaults: { owner?: string; repo?: string };
}): 
  | {
      repo: { owner: string; repo: string };
      body: string;
    }
  | undefined {
  const normalized = params.commandBody.replace(/\r\n/g, "\n").trim();
  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  const firstLineArgs = firstLine
    .replace(new RegExp(`^/${params.commandName}\\b\\s*`, "i"), "")
    .trim();
  const tokens = firstLineArgs
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  let repo = parseChatopsRepoReference("", params.defaults);
  let remainderTokens = tokens;
  const explicitRepo = tokens.length > 0 ? parseChatopsRepoReference(tokens[0] ?? "") : null;
  if (explicitRepo) {
    repo = explicitRepo;
    remainderTokens = tokens.slice(1);
  }
  const lines = [remainderTokens.join(" ").trim(), ...remainingLines];
  while (lines.length > 0 && lines[0]?.trim().length === 0) {
    lines.shift();
  }
  const body = lines.join("\n").trim();
  if (!repo || !body) {
    return undefined;
  }
  return {
    repo,
    body,
  };
}

function parseIntakeAnswerArgs(params: {
  commandBody: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      repo: { owner: string; repo: string };
      questionIndex: number;
      answer: string;
    }
  | undefined {
  const parsed = parseRepoScopedMultilineBody({
    commandBody: params.commandBody,
    commandName: "occode-intake-answer",
    defaults: params.defaults,
  });
  if (!parsed) {
    return undefined;
  }
  const body = parsed.body.trim();
  if (!body) {
    return undefined;
  }
  const indexedAnswerMatch = /^(\d+)(?:\s+|\n+)([\s\S]+)$/.exec(body);
  if (indexedAnswerMatch) {
    return {
      repo: parsed.repo,
      questionIndex: Number.parseInt(indexedAnswerMatch[1] ?? "1", 10),
      answer: (indexedAnswerMatch[2] ?? "").trim(),
    };
  }
  return {
    repo: parsed.repo,
    questionIndex: 1,
    answer: body,
  };
}

function parseBlueprintAnswerArgs(params: {
  commandBody: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      repo: { owner: string; repo: string };
      questionIndex: number;
      answer: string;
    }
  | undefined {
  const parsed = parseRepoScopedMultilineBody({
    commandBody: params.commandBody,
    commandName: "occode-blueprint-answer",
    defaults: params.defaults,
  });
  if (!parsed) {
    return undefined;
  }
  const body = parsed.body.trim();
  if (!body) {
    return undefined;
  }
  const indexedAnswerMatch = /^(\d+)(?:\s+|\n+)([\s\S]+)$/.exec(body);
  if (indexedAnswerMatch) {
    return {
      repo: parsed.repo,
      questionIndex: Number.parseInt(indexedAnswerMatch[1] ?? "1", 10),
      answer: (indexedAnswerMatch[2] ?? "").trim(),
    };
  }
  return {
    repo: parsed.repo,
    questionIndex: 1,
    answer: body,
  };
}

function normalizeBlueprintAnswerListBody(answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^[-*]\s+/m.test(trimmed) || /^\d+\.\s+/m.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.includes("\n")) {
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");
  }
  return `- ${trimmed}`;
}

function resolveBlueprintAnswerTarget(params: {
  question: string;
  blueprint: Awaited<ReturnType<typeof readProjectBlueprintDocument>>;
}): {
  sectionName: (typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number];
  append: boolean;
} {
  const question = params.question;
  const defaulted = new Set(params.blueprint.defaultedSections);
  if (/No project blueprint exists yet/i.test(question)) {
    return {
      sectionName: "Goal",
      append: false,
    };
  }
  if (/Goal placeholder|`Goal` section/i.test(question)) {
    return {
      sectionName: "Goal",
      append: !defaulted.has("Goal"),
    };
  }
  if (/Success Criteria/i.test(question)) {
    return {
      sectionName: "Success Criteria",
      append: !defaulted.has("Success Criteria"),
    };
  }
  if (/`Scope` section|in scope and out of scope/i.test(question)) {
    return {
      sectionName: "Scope",
      append: !defaulted.has("Scope"),
    };
  }
  if (/workstreams before autonomous issue creation|`Workstreams` section/i.test(question)) {
    return {
      sectionName: "Workstreams",
      append: !defaulted.has("Workstreams"),
    };
  }
  if (/Open Questions/i.test(question)) {
    return {
      sectionName: "Open Questions",
      append: false,
    };
  }
  return {
    sectionName: "Assumptions",
    append: !defaulted.has("Assumptions"),
  };
}

function extractMultilineCommandBody(params: {
  commandBody: string;
  commandName: string;
}): string | undefined {
  const normalized = params.commandBody.replace(/\r\n/g, "\n").trim();
  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  const firstLineArgs = firstLine
    .replace(new RegExp(`^/${params.commandName}\\b\\s*`, "i"), "")
    .trim();
  const lines = [firstLineArgs, ...remainingLines];
  while (lines.length > 0 && lines[0]?.trim().length === 0) {
    lines.shift();
  }
  const body = lines.join("\n").trim();
  return body || undefined;
}

function hasExplicitRepoArgumentInCommandBody(params: {
  commandBody: string;
  commandName: string;
}): boolean {
  const normalized = params.commandBody.replace(/\r\n/g, "\n").trim();
  const [firstLine = ""] = normalized.split("\n");
  const firstLineArgs = firstLine
    .replace(new RegExp(`^/${params.commandName}\\b\\s*`, "i"), "")
    .trim();
  const firstToken = firstLineArgs
    .split(/\s+/)
    .map((token) => token.trim())
    .find(Boolean);
  return Boolean(firstToken && parseChatopsRepoReference(firstToken));
}

function parseBlueprintEditArgs(params: {
  commandBody: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      repo: { owner: string; repo: string };
      sectionName: ReturnType<typeof parseProjectBlueprintSectionName>;
      body: string;
    }
  | undefined {
  const normalized = params.commandBody.replace(/\r\n/g, "\n").trim();
  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  const firstLineArgs = firstLine.replace(/^\/occode-blueprint-edit\b\s*/i, "").trim();
  const tokens = firstLineArgs
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  let repo = parseChatopsRepoReference("", params.defaults);
  let remainderTokens = tokens;
  const explicitRepo = tokens.length > 0 ? parseChatopsRepoReference(tokens[0] ?? "") : null;
  if (explicitRepo) {
    repo = explicitRepo;
    remainderTokens = tokens.slice(1);
  }
  const sectionToken = remainderTokens[0];
  const lines = [remainderTokens.slice(1).join(" ").trim(), ...remainingLines];
  while (lines.length > 0 && lines[0]?.trim().length === 0) {
    lines.shift();
  }
  const body = lines.join("\n").trim();
  if (!repo || !sectionToken || !body) {
    return undefined;
  }
  return {
    repo,
    sectionName: parseProjectBlueprintSectionName(sectionToken),
    body,
  };
}

function parseSetupBlueprintEditArgs(commandBody: string):
  | {
      sectionName: ReturnType<typeof parseProjectBlueprintSectionName>;
      body: string;
    }
  | undefined {
  const normalized = commandBody.replace(/\r\n/g, "\n").trim();
  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  const firstLineArgs = firstLine.replace(/^\/occode-blueprint-edit\b\s*/i, "").trim();
  const tokens = firstLineArgs
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const sectionToken = tokens[0];
  const lines = [tokens.slice(1).join(" ").trim(), ...remainingLines];
  while (lines.length > 0 && lines[0]?.trim().length === 0) {
    lines.shift();
  }
  const body = lines.join("\n").trim();
  if (!sectionToken || !body) {
    return undefined;
  }
  return {
    sectionName: parseProjectBlueprintSectionName(sectionToken),
    body,
  };
}

function buildBlueprintGoalUpdateMessage(params: {
  repo: { owner: string; repo: string };
  blueprint: Awaited<ReturnType<typeof readProjectBlueprintDocument>>;
  clarification: Awaited<ReturnType<typeof inspectProjectBlueprintClarifications>>;
  executionStartReadiness: string | undefined;
}): string {
  const lines = [
    `openclawcode updated the blueprint goal for ${formatRepoKey(params.repo)}.`,
    `Status: ${params.blueprint.status ?? "unknown"}`,
    params.blueprint.revisionId ? `Revision: ${params.blueprint.revisionId}` : undefined,
    params.blueprint.goalSummary ? `Goal: ${params.blueprint.goalSummary}` : undefined,
    params.executionStartReadiness
      ? `Execution-start gate: ${params.executionStartReadiness}`
      : undefined,
    `Validation: errors=${params.blueprint.validationErrorCount} | warnings=${params.blueprint.validationWarningCount}`,
    ...(params.blueprint.validationErrors.slice(0, 2).map((entry) => `- error: ${entry}`) ?? []),
    params.clarification.priorityQuestion
      ? `Priority question: ${params.clarification.priorityQuestion}`
      : undefined,
    `Clarifications: ${params.clarification.questionCount}`,
    ...params.clarification.questions.slice(0, 3).map((question) => `- ${question}`),
    `Suggestions: ${params.clarification.suggestionCount}`,
    ...params.clarification.suggestions.slice(0, 2).map((suggestion) => `- ${suggestion}`),
    `Clarification history: ${params.clarification.clarificationHistoryCount}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function buildBlueprintAgreementMessage(params: {
  repo: { owner: string; repo: string };
  blueprint: Awaited<ReturnType<typeof readProjectBlueprintDocument>>;
  executionStartReadiness: string | undefined;
}): string {
  return [
    `openclawcode marked the blueprint as agreed for ${formatRepoKey(params.repo)}.`,
    `Status: ${params.blueprint.status ?? "unknown"}`,
    params.blueprint.revisionId ? `Revision: ${params.blueprint.revisionId}` : undefined,
    params.executionStartReadiness
      ? `Execution-start gate: ${params.executionStartReadiness}`
      : undefined,
    "Use /occode-gates to inspect any remaining human decisions before execution.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function updateChatSetupBlueprintDraftSection(params: {
  store: OpenClawCodeChatopsStore;
  session: ChatSetupSession;
  sectionName: (typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number];
  body: string;
}): Promise<ChatSetupSession> {
  const currentSections = params.session.blueprintDraft?.sections ?? {};
  const nextSession = {
    ...params.session,
    stage: "drafting-blueprint" as const,
    blueprintDraft: {
      status: "draft" as const,
      repoNameSuggestions: undefined,
      sections: {
        ...currentSections,
        [params.sectionName]: params.body.trim(),
      },
    },
    updatedAt: new Date().toISOString(),
  };
  await params.store.upsertSetupSession(nextSession);
  return nextSession;
}

function buildChatSetupDraftUpdateMessage(params: {
  sectionName: string;
  session: ChatSetupSession;
}): string {
  return [
    `Updated setup draft section \`${params.sectionName}\`.`,
    params.session.stage === "awaiting-repo-choice"
      ? buildChatSetupAwaitingRepoChoiceMessage({
          session: params.session,
        })
      : buildChatSetupDraftingBlueprintMessage({
          session: params.session,
        }),
  ].join("\n");
}

function buildWorkItemBacklogLines(
  inventory: Awaited<ReturnType<typeof readProjectWorkItemInventory>> | undefined,
): string[] {
  if (!inventory || (!inventory.exists && !inventory.blueprintExists)) {
    return [];
  }

  const revisionId =
    inventory.currentBlueprintRevisionId ?? inventory.blueprintRevisionId ?? "unknown";
  const stale =
    inventory.artifactStale == null ? "unknown" : inventory.artifactStale ? "yes" : "no";
  const headline = inventory.exists
    ? `Blueprint backlog: ${inventory.workItemCount} items | planned=${inventory.plannedWorkItemCount} | discovered=${inventory.discoveredWorkItemCount} | stale=${stale}`
    : `Blueprint backlog: artifact missing | planned=0 | discovered=0 | stale=${stale}`;

  return [
    headline,
    `- blueprint: ${inventory.blueprintStatus ?? "unknown"} | revision ${revisionId}`,
    `- issue projection: ${inventory.readyForIssueProjection ? "ready" : "blocked"} | execution: ${inventory.readyForExecution ? "ready" : "blocked"} | blockers=${inventory.blockerCount} | suggestions=${inventory.suggestionCount}`,
  ];
}

function buildBlueprintProviderStrategyLine(
  blueprint: Awaited<ReturnType<typeof readProjectBlueprintDocument>>,
): string | undefined {
  const entries = [
    ["planner", blueprint.providerRoleAssignments.planner],
    ["coder", blueprint.providerRoleAssignments.coder],
    ["reviewer", blueprint.providerRoleAssignments.reviewer],
    ["verifier", blueprint.providerRoleAssignments.verifier],
    ["doc-writer", blueprint.providerRoleAssignments.docWriter],
  ]
    .filter(([, value]) => value != null && value.trim().length > 0)
    .map(([role, value]) => `${role}=${value}`);

  return entries.length > 0 ? `Provider strategy: ${entries.join(", ")}` : undefined;
}

function buildRoleRoutingSummaryMessage(params: {
  repo: { owner: string; repo: string };
  plan: Awaited<ReturnType<typeof readProjectRoleRoutingPlan>>;
}): string {
  const routeLine = params.plan.routes
    .map((route) => {
      const role = route.roleId === "docWriter" ? "doc-writer" : route.roleId;
      return `${role}=${route.adapterId}${route.resolvedAgentId ? `@${route.resolvedAgentId}` : ""}`;
    })
    .join(", ");
  const stageLine = params.plan.stageRoutes
    .map((route) => `${route.stageId}=${route.adapterId}/${route.roleId === "docWriter" ? "doc-writer" : route.roleId}`)
    .join(", ");
  const fallbackLine = params.plan.routes
    .filter((route) => route.fallbackChain.length > 0)
    .map(
      (route) =>
        `${route.roleId === "docWriter" ? "doc-writer" : route.roleId}=${route.fallbackChain.join(" -> ")}`,
    )
    .join(", ");
  return [
    `openclawcode role routing for ${formatRepoKey(params.repo)}`,
    `Role routing: ${routeLine}`,
    stageLine ? `Stage routing: ${stageLine}` : undefined,
    `Mixed mode: ${params.plan.mixedMode ? "yes" : "no"}`,
    `Fallback configured: ${params.plan.fallbackConfigured ? "yes" : "no"}`,
    fallbackLine ? `Role fallbacks: ${fallbackLine}` : undefined,
    `Unresolved roles: ${params.plan.unresolvedRoleCount}`,
    ...params.plan.blockers.slice(0, 3).map((blocker) => `- blocker: ${blocker}`),
    ...params.plan.suggestions.slice(0, 2).map((suggestion) => `- suggestion: ${suggestion}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRuntimeSteeringSummaryMessage(params: {
  repo: { owner: string; repo: string };
  artifact: Awaited<ReturnType<typeof readProjectRuntimeSteeringArtifact>>;
}): string {
  const overrideLines =
    params.artifact.overrides.length > 0
      ? params.artifact.overrides.map(
          (override) =>
            `- ${override.stageId}: role=${override.roleId} | agent=${override.agentId ?? "runner-default"} | adapter=${override.adapterId ?? "unchanged"} | updated=${override.updatedAt}`,
        )
      : [
          `- none; set one with /occode-runtime-steering-set ${formatRepoKey(params.repo)} building <agent-id>`,
        ];
  return [
    `openclawcode runtime steering for ${formatRepoKey(params.repo)}`,
    `Overrides: ${params.artifact.overrideCount}`,
    ...overrideLines,
  ].join("\n");
}

function parseRoleRoutingSetArgs(params: {
  args: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      repo: { owner: string; repo: string };
      roleId: ReturnType<typeof parseProjectBlueprintRoleId>;
      provider: string | null;
    }
  | undefined {
  const tokens = params.args
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2) {
    return undefined;
  }
  const firstRepo = parseChatopsRepoReference(tokens[0] ?? "", params.defaults);
  const offset = firstRepo ? 1 : 0;
  const repo = firstRepo ?? parseChatopsRepoReference("", params.defaults);
  const roleToken = tokens[offset];
  const providerToken = tokens
    .slice(offset + 1)
    .join(" ")
    .trim();
  if (!repo || !roleToken || providerToken.length === 0) {
    return undefined;
  }
  const loweredProvider = providerToken.toLowerCase();
  return {
    repo,
    roleId: parseProjectBlueprintRoleId(roleToken),
    provider:
      loweredProvider === "clear" || loweredProvider === "none" || loweredProvider === "null"
        ? null
        : providerToken,
  };
}

function parseRuntimeSteeringSetArgs(params: {
  args: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      repo: { owner: string; repo: string };
      stageId: "building" | "verifying";
      agentId?: string;
      adapterId?: string;
      note?: string;
      clear: boolean;
    }
  | undefined {
  const tokens = params.args
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2) {
    return undefined;
  }
  const firstRepo = parseChatopsRepoReference(tokens[0] ?? "", params.defaults);
  const offset = firstRepo ? 1 : 0;
  const repo = firstRepo ?? parseChatopsRepoReference("", params.defaults);
  const stageId = tokens[offset]?.trim().toLowerCase();
  const target = tokens[offset + 1]?.trim();
  if (!repo || !stageId || !target) {
    return undefined;
  }
  if (stageId !== "building" && stageId !== "verifying") {
    throw new Error(`Stage must be one of: ${projectRuntimeSteeringStageIds().join(", ")}`);
  }

  const remaining = tokens.slice(offset + 2);
  const adapterTokenIndex = remaining.findIndex((token) => token.toLowerCase().startsWith("adapter="));
  const adapterId =
    adapterTokenIndex >= 0 ? remaining[adapterTokenIndex]?.slice("adapter=".length) : undefined;
  const noteTokens =
    adapterTokenIndex >= 0
      ? remaining.filter((_, index) => index !== adapterTokenIndex)
      : remaining;
  const loweredTarget = target.toLowerCase();
  return {
    repo,
    stageId,
    agentId:
      loweredTarget === "clear" || loweredTarget === "none" || loweredTarget === "null"
        ? undefined
        : target,
    adapterId: adapterId?.trim() || undefined,
    note: noteTokens.join(" ").trim() || undefined,
    clear: loweredTarget === "clear" || loweredTarget === "none" || loweredTarget === "null",
  };
}

function parseRuntimeRerouteArgs(params: {
  args: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      issue: { owner: string; repo: string; number: number };
      roleId: "coder" | "verifier";
      agentId: string;
    }
  | undefined {
  const tokens = params.args
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 3) {
    return undefined;
  }
  const command = parseChatopsCommand(`/occode-status ${tokens[0] ?? ""}`, params.defaults);
  const roleToken = tokens[1]?.trim().toLowerCase();
  const agentId = tokens.slice(2).join(" ").trim();
  if (!command || !roleToken || !agentId) {
    return undefined;
  }
  if (roleToken !== "coder" && roleToken !== "verifier") {
    throw new Error("Role must be one of: coder, verifier");
  }
  return {
    issue: command.issue,
    roleId: roleToken,
    agentId,
  };
}

function parseIssueCommandWithOptionalNote(params: {
  args: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      issue: { owner: string; repo: string; number: number };
      note: string | null;
    }
  | undefined {
  const tokens = params.args
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return undefined;
  }
  const command = parseChatopsCommand(`/occode-status ${tokens[0] ?? ""}`, params.defaults);
  if (!command) {
    return undefined;
  }
  const note = tokens.slice(1).join(" ").trim();
  return {
    issue: command.issue,
    note: note.length > 0 ? note : null,
  };
}

function parsePolicyArgs(params: {
  args: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      repo: { owner: string; repo: string };
      issue?:
        | {
            owner: string;
            repo: string;
            number: number;
          }
        | undefined;
    }
  | undefined {
  const trimmed = params.args.trim();
  if (!trimmed) {
    const repo = parseChatopsRepoReference("", params.defaults);
    return repo ? { repo } : undefined;
  }

  const issueCommand = parseChatopsCommand(`/occode-status ${trimmed}`, params.defaults);
  if (issueCommand) {
    return {
      repo: {
        owner: issueCommand.issue.owner,
        repo: issueCommand.issue.repo,
      },
      issue: issueCommand.issue,
    };
  }

  const repo = parseChatopsRepoReference(trimmed, params.defaults);
  return repo ? { repo } : undefined;
}

function buildPolicySnapshotMessage(params: {
  repo: { owner: string; repo: string };
  snapshot?: OpenClawCodeIssueStatusSnapshot;
  issueKey?: string;
}): string {
  const policy = buildOpenClawCodePolicySnapshot();
  const lines = [`openclawcode policy for ${formatRepoKey(params.repo)}`];
  if (params.issueKey) {
    lines.push(`Issue: ${params.issueKey}`);
  }
  lines.push(`Policy contract version: ${policy.contractVersion}`);
  lines.push(`Suitability allowlist labels: ${policy.suitability.lowRiskLabels.join(", ")}`);
  lines.push(`Suitability denylist labels: ${policy.suitability.highRiskLabels.join(", ")}`);
  lines.push(
    `Build guardrails: lines>=${policy.buildGuardrails.largeDiffLineThreshold} | files>=${policy.buildGuardrails.largeDiffFileThreshold} | fan-out files>=${policy.buildGuardrails.broadFanOutFileThreshold} | dirs>=${policy.buildGuardrails.broadFanOutDirectoryThreshold}`,
  );
  lines.push(
    `Provider auto-pause classes: ${policy.providerFailureHandling.autoPauseClasses.join(", ")}`,
  );
  if (params.snapshot?.suitabilityDecision && params.snapshot.suitabilitySummary) {
    lines.push(
      `Current suitability: ${params.snapshot.suitabilityDecision} | ${trimToSingleLine(params.snapshot.suitabilitySummary)}`,
    );
  }
  if (params.snapshot?.suitabilityOverrideApplied) {
    lines.push(
      `Current suitability override: applied${params.snapshot.suitabilityOverrideReason ? ` | ${trimToSingleLine(params.snapshot.suitabilityOverrideReason)}` : ""}`,
    );
  }
  if (params.snapshot?.autoMergePolicyEligible === false && params.snapshot.autoMergePolicyReason) {
    lines.push(
      `Current auto-merge: blocked | ${trimToSingleLine(params.snapshot.autoMergePolicyReason)}`,
    );
  }
  lines.push(
    params.issueKey
      ? `Suitability override path: /occode-start-override ${params.issueKey}`
      : `Suitability override path: /occode-start-override ${formatRepoKey(params.repo)}#123`,
  );
  lines.push(
    `Merge override path: /occode-gate-decide ${formatRepoKey(params.repo)} merge-promotion approved [note]`,
  );
  lines.push("Auto-merge policy doc: docs/openclawcode/auto-merge-policy.md");
  lines.push(
    "Use /occode-status owner/repo#issue to inspect the latest tracked policy decision for a specific run.",
  );
  return lines.join("\n");
}

function buildBlueprintSummaryMessage(params: {
  repo: { owner: string; repo: string };
  blueprint: Awaited<ReturnType<typeof readProjectBlueprintDocument>>;
  clarification: Awaited<ReturnType<typeof inspectProjectBlueprintClarifications>>;
}): string {
  const lines = [`openclawcode blueprint for ${formatRepoKey(params.repo)}`];

  if (!params.blueprint.exists) {
    lines.push("Blueprint: missing");
  } else {
    lines.push(`Title: ${params.blueprint.title ?? "Untitled blueprint"}`);
    lines.push(`Status: ${params.blueprint.status ?? "unknown"}`);
    if (params.blueprint.revisionId) {
      lines.push(`Revision: ${params.blueprint.revisionId}`);
    }
    if (params.blueprint.goalSummary) {
      lines.push(`Goal: ${params.blueprint.goalSummary}`);
    }
    lines.push(
      `Counts: workstreams=${params.blueprint.workstreamCandidateCount} | openQuestions=${params.blueprint.openQuestionCount} | humanGates=${params.blueprint.humanGateCount} | defaulted=${params.blueprint.defaultedSectionCount}`,
    );
    const providerStrategy = buildBlueprintProviderStrategyLine(params.blueprint);
    if (providerStrategy) {
      lines.push(providerStrategy);
    }
    lines.push(
      `Validation: errors=${params.blueprint.validationErrorCount} | warnings=${params.blueprint.validationWarningCount}`,
    );
    for (const error of params.blueprint.validationErrors.slice(0, 3)) {
      lines.push(`- error: ${error}`);
    }
    for (const warning of params.blueprint.validationWarnings.slice(0, 2)) {
      lines.push(`- warning: ${warning}`);
    }
    lines.push(
      `Clarification history: ${params.blueprint.clarificationHistoryCount}${params.blueprint.lastClarificationAt ? ` | last=${params.blueprint.lastClarificationAt}` : ""}`,
    );
  }

  lines.push(`Clarifications: ${params.clarification.questionCount}`);
  if (params.clarification.priorityQuestion) {
    lines.push(`Priority question: ${params.clarification.priorityQuestion}`);
  }
  for (const question of params.clarification.questions.slice(0, 5)) {
    lines.push(`- ${question}`);
  }

  if (params.clarification.suggestionCount > 0) {
    lines.push(`Suggestions: ${params.clarification.suggestionCount}`);
    for (const suggestion of params.clarification.suggestions.slice(0, 5)) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines.join("\n");
}

function buildStageGateSummaryMessage(params: {
  repo: { owner: string; repo: string };
  artifact: Awaited<ReturnType<typeof readProjectStageGateArtifact>>;
}): string {
  const lines = [`openclawcode stage gates for ${formatRepoKey(params.repo)}`];

  if (!params.artifact.blueprintExists) {
    lines.push("Blueprint: missing");
    return lines.join("\n");
  }

  if (params.artifact.blueprintRevisionId) {
    lines.push(`Blueprint revision: ${params.artifact.blueprintRevisionId}`);
  }
  lines.push(
    `Gate counts: blocked=${params.artifact.blockedGateCount} | needsHuman=${params.artifact.needsHumanDecisionCount} | total=${params.artifact.gateCount}`,
  );

  for (const gate of params.artifact.gates) {
    lines.push(
      `- ${gate.gateId} | ${gate.readiness} | decisionRequired=${gate.decisionRequired ? "yes" : "no"}`,
    );
    if (gate.latestDecision) {
      lines.push(
        `  latest: ${gate.latestDecision.decision} | ${gate.latestDecision.actor ?? "unknown"} | ${gate.latestDecision.recordedAt}`,
      );
      if (gate.latestDecision.note) {
        lines.push(`  note: ${gate.latestDecision.note}`);
      }
    }
    if (gate.blockers.length > 0) {
      lines.push(`  blockers: ${gate.blockers.slice(0, 2).join(" ; ")}`);
    } else if (gate.suggestions.length > 0) {
      lines.push(`  suggestions: ${gate.suggestions.slice(0, 2).join(" ; ")}`);
    }
  }

  return lines.join("\n");
}

function buildNextWorkSummaryMessage(params: {
  repo: { owner: string; repo: string };
  selection: Awaited<ReturnType<typeof readProjectNextWorkSelection>>;
}): string {
  const lines = [`openclawcode next work for ${formatRepoKey(params.repo)}`];

  if (!params.selection.blueprintExists) {
    lines.push("Blueprint: missing");
    return lines.join("\n");
  }

  if (params.selection.blueprintRevisionId) {
    lines.push(`Blueprint revision: ${params.selection.blueprintRevisionId}`);
  }
  lines.push(`Decision: ${params.selection.decision}`);
  lines.push(
    `Autonomous continuation: ${params.selection.canContinueAutonomously ? "ready" : "blocked"}`,
  );
  lines.push(
    `Signals: clarifications=${params.selection.clarificationQuestionCount} | discovery=${params.selection.discoveryEvidenceCount} | workItems=${params.selection.workItemCount} | blockedGates=${params.selection.blockedGateCount} | needsHuman=${params.selection.needsHumanDecisionCount} | unresolvedRoles=${params.selection.unresolvedRoleCount}`,
  );
  if (params.selection.blockingGateId) {
    lines.push(`Blocking gate: ${params.selection.blockingGateId}`);
  }
  if (params.selection.selectedWorkItem) {
    lines.push(
      `Selected: ${params.selection.selectedWorkItem.title} | ${params.selection.selectedWorkItem.selectedFrom} | ${params.selection.selectedWorkItem.kind}`,
    );
    lines.push(`Execution mode: ${params.selection.selectedWorkItem.executionMode}`);
    lines.push(`Issue draft: ${params.selection.selectedWorkItem.githubIssueDraftTitle}`);
  }
  if (params.selection.selectedReason) {
    lines.push(`Reason: ${params.selection.selectedReason}`);
  }
  if (params.selection.decision === "ready-to-execute") {
    lines.push(`Use /occode-materialize ${formatRepoKey(params.repo)} to create or reuse the execution issue.`);
  }
  for (const blocker of params.selection.blockers.slice(0, 3)) {
    lines.push(`- blocker: ${blocker}`);
  }
  for (const suggestion of params.selection.suggestions.slice(0, 3)) {
    lines.push(`- suggestion: ${suggestion}`);
  }

  return lines.join("\n");
}

function buildIssueMaterializationSummaryMessage(params: {
  repo: { owner: string; repo: string };
  artifact: Awaited<ReturnType<typeof readProjectIssueMaterializationArtifact>>;
}): string {
  const lines = [`openclawcode issue materialization for ${formatRepoKey(params.repo)}`];
  lines.push(`Decision: ${params.artifact.nextWorkDecision}`);
  lines.push(`Outcome: ${params.artifact.outcome}`);
  if (params.artifact.blockingGateId) {
    lines.push(`Blocking gate: ${params.artifact.blockingGateId}`);
  }
  if (params.artifact.selectedWorkItemId) {
    lines.push(`Selected work item: ${params.artifact.selectedWorkItemId}`);
  }
  if (params.artifact.selectedWorkItemExecutionMode) {
    lines.push(`Execution mode: ${params.artifact.selectedWorkItemExecutionMode}`);
    switch (params.artifact.selectedWorkItemExecutionMode) {
      case "bugfix":
        lines.push("Mode guidance: confirm observed behavior, expected behavior, and reproduction before broad edits.");
        break;
      case "refactor":
        lines.push("Mode guidance: preserve current behavior and keep the repository working after each checkpoint.");
        break;
      case "research":
        lines.push("Mode guidance: end with a concrete recommendation and the next executable slice.");
        break;
      default:
        lines.push("Mode guidance: keep the slice demoable and verify public behavior before broadening scope.");
        break;
    }
  }
  if (params.artifact.selectedIssueNumber != null) {
    lines.push(
      `Selected issue: #${params.artifact.selectedIssueNumber} | ${params.artifact.selectedIssueTitle ?? "untitled"}`,
    );
    if (params.artifact.selectedIssueUrl) {
      lines.push(params.artifact.selectedIssueUrl);
    }
    lines.push(`Use /occode-start ${formatRepoKey(params.repo)}#${params.artifact.selectedIssueNumber} for the first run.`);
  }
  for (const blocker of params.artifact.blockers.slice(0, 3)) {
    lines.push(`- blocker: ${blocker}`);
  }
  for (const suggestion of params.artifact.suggestions.slice(0, 3)) {
    lines.push(`- suggestion: ${suggestion}`);
  }
  return lines.join("\n");
}

function buildProjectProgressSummaryMessage(params: {
  repo: { owner: string; repo: string };
  artifact: Awaited<ReturnType<typeof readProjectProgressArtifact>>;
}): string {
  const lines = [`openclawcode progress for ${formatRepoKey(params.repo)}`];
  lines.push(
    `Blueprint: ${params.artifact.blueprintStatus ?? "unknown"} | ${params.artifact.blueprintRevisionId ?? "unknown"}`,
  );
  lines.push(`Next work: ${params.artifact.nextWorkDecision}`);
  lines.push(
    `Signals: workItems=${params.artifact.workItemCount} | unresolvedRoles=${params.artifact.unresolvedRoleCount} | blockedGates=${params.artifact.blockedGateCount} | needsHuman=${params.artifact.needsHumanDecisionCount}`,
  );
  if (params.artifact.nextWorkBlockingGateId) {
    lines.push(`Next-work gate: ${params.artifact.nextWorkBlockingGateId}`);
  }
  if (params.artifact.activeWorkstreamSummary) {
    lines.push(`Active workstream: ${params.artifact.activeWorkstreamSummary}`);
  }
  if (params.artifact.selectedWorkItemTitle) {
    lines.push(`Selected work item: ${params.artifact.selectedWorkItemTitle}`);
  }
  if (params.artifact.selectedWorkItemExecutionMode) {
    lines.push(`Execution mode: ${params.artifact.selectedWorkItemExecutionMode}`);
  }
  if (params.artifact.selectedIssueNumber != null) {
    lines.push(
      `Selected issue: #${params.artifact.selectedIssueNumber} | ${params.artifact.selectedIssueTitle ?? "untitled"}`,
    );
  }
  if (params.artifact.nextWorkPrimaryBlocker) {
    lines.push(`Primary blocker: ${params.artifact.nextWorkPrimaryBlocker}`);
  }
  if (params.artifact.roleRouteSummary.length > 0) {
    lines.push(`Roles: ${params.artifact.roleRouteSummary.join(", ")}`);
  }
  lines.push(
    `Operator: binding=${params.artifact.operator.bindingPresent ? "yes" : "no"} | pending=${params.artifact.operator.pendingApprovalCount} | queued=${params.artifact.operator.queuedRunCount} | current=${params.artifact.operator.currentRunCount} | pause=${params.artifact.operator.providerPauseActive ? "yes" : "no"}`,
  );
  if (params.artifact.operator.currentRunIssueKey) {
    lines.push(`Current run: ${params.artifact.operator.currentRunIssueKey}`);
  }
  if (params.artifact.operator.currentRunStage) {
    lines.push(`Current run stage: ${params.artifact.operator.currentRunStage}`);
  }
  if (params.artifact.operator.currentRunBranchName) {
    lines.push(`Current run branch: ${params.artifact.operator.currentRunBranchName}`);
  }
  if (params.artifact.operator.currentRunPullRequestNumber != null) {
    lines.push(`Current run PR: #${params.artifact.operator.currentRunPullRequestNumber}`);
  }
  const nextSuggestedCommand =
    params.artifact.nextSuggestedChatCommand ??
    resolveChatNextSuggestedCommand({
      repo: params.repo,
      command: params.artifact.nextSuggestedCommand,
    });
  if (nextSuggestedCommand) {
    lines.push(`Next: ${nextSuggestedCommand}`);
  }
  return lines.join("\n");
}

function buildAutonomousLoopSummaryMessage(params: {
  repo: { owner: string; repo: string };
  artifact: Awaited<ReturnType<typeof readProjectAutonomousLoopArtifact>>;
}): string {
  const lines = [`openclawcode autopilot for ${formatRepoKey(params.repo)}`];
  lines.push(`Mode: ${params.artifact.mode}`);
  lines.push(`Status: ${params.artifact.status}`);
  lines.push(`Enabled: ${params.artifact.enabled ? "yes" : "no"}`);
  lines.push(`Iterations: ${params.artifact.completedIterationCount}/${params.artifact.requestedIterationCount}`);
  lines.push(`Next work: ${params.artifact.nextWorkDecision}`);
  if (params.artifact.nextWorkBlockingGateId) {
    lines.push(`Next-work gate: ${params.artifact.nextWorkBlockingGateId}`);
  }
  if (params.artifact.activeWorkstreamSummary) {
    lines.push(`Active workstream: ${params.artifact.activeWorkstreamSummary}`);
  }
  lines.push(
    `Operator: queued=${params.artifact.queuedRunCount} | currentRun=${params.artifact.currentRunPresent ? "yes" : "no"} | pause=${params.artifact.providerPauseActive ? "yes" : "no"}`,
  );
  if (params.artifact.selectedWorkItemId) {
    lines.push(`Selected work item: ${params.artifact.selectedWorkItemId}`);
  }
  if (params.artifact.selectedWorkItemExecutionMode) {
    lines.push(`Execution mode: ${params.artifact.selectedWorkItemExecutionMode}`);
  }
  if (params.artifact.roleRouteSummary.length > 0) {
    lines.push(`Roles: ${params.artifact.roleRouteSummary.join(", ")}`);
  }
  if (params.artifact.selectedIssueNumber != null) {
    lines.push(`Selected issue: #${params.artifact.selectedIssueNumber}`);
  }
  if (params.artifact.queuedIssueKey) {
    lines.push(`Queued issue: ${params.artifact.queuedIssueKey}`);
  }
  if (params.artifact.currentRunIssueKey) {
    lines.push(`Current run: ${params.artifact.currentRunIssueKey}`);
  }
  if (params.artifact.currentRunStage) {
    lines.push(`Current run stage: ${params.artifact.currentRunStage}`);
  }
  if (params.artifact.currentRunBranchName) {
    lines.push(`Current run branch: ${params.artifact.currentRunBranchName}`);
  }
  if (params.artifact.currentRunPullRequestNumber != null) {
    lines.push(`Current run PR: #${params.artifact.currentRunPullRequestNumber}`);
  }
  if (params.artifact.stopReason) {
    lines.push(`Stop reason: ${params.artifact.stopReason}`);
  }
  if (params.artifact.nextWorkPrimaryBlocker) {
    lines.push(`Primary blocker: ${params.artifact.nextWorkPrimaryBlocker}`);
  }
  if (params.artifact.message) {
    lines.push(`Message: ${params.artifact.message}`);
  }
  const nextSuggestedCommand =
    params.artifact.nextSuggestedChatCommand ??
    resolveChatNextSuggestedCommand({
      repo: params.repo,
      command: params.artifact.nextSuggestedCommand,
    });
  if (nextSuggestedCommand) {
    lines.push(`Next: ${nextSuggestedCommand}`);
  }
  for (const iteration of params.artifact.iterations.slice(0, 3)) {
    const iterationParts = [
      `${iteration.status}`,
      `${iteration.nextWorkDecision}`,
      iteration.selectedIssueNumber != null ? `#${iteration.selectedIssueNumber}` : null,
      iteration.queuedIssueKey,
      iteration.stopReason ? `stop=${iteration.stopReason}` : null,
      iteration.message ? `message=${iteration.message}` : null,
      iteration.activeWorkstreamSummary ? `workstream=${iteration.activeWorkstreamSummary}` : null,
    ].filter((part): part is string => Boolean(part));
    lines.push(`- iteration ${iteration.iteration}: ${iterationParts.join(" | ")}`);
  }
  return lines.join("\n");
}

function parseAutopilotArgs(params: {
  args: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      action: "once" | "repeat" | "status" | "off";
      iterations: number;
      repo: { owner: string; repo: string };
    }
  | undefined {
  const tokens = params.args
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const actionToken = (tokens[0] ?? "status").toLowerCase();
  if (actionToken !== "once" && actionToken !== "repeat" && actionToken !== "status" && actionToken !== "off") {
    return undefined;
  }
  let iterations = 1;
  let repoTokens = tokens.slice(1);
  if (actionToken === "repeat" && repoTokens[0] && /^\d+$/.test(repoTokens[0])) {
    iterations = Math.max(1, Number.parseInt(repoTokens[0], 10) || 1);
    repoTokens = repoTokens.slice(1);
  }
  const repo = parseChatopsRepoReference(repoTokens.join(" "), params.defaults) ??
    parseChatopsRepoReference("", params.defaults);
  if (!repo) {
    return undefined;
  }
  return {
    action: actionToken,
    iterations,
    repo,
  };
}

function parseStageGateDecisionArgs(params: {
  args: string;
  defaults: { owner?: string; repo?: string };
}):
  | {
      repo: { owner: string; repo: string };
      gateId: string;
      decision: string;
      note: string;
    }
  | undefined {
  const trimmed = params.args.trim();
  if (!trimmed) {
    return undefined;
  }

  const tokens = trimmed.split(/\s+/);
  let repo = parseChatopsRepoReference(tokens[0] ?? "", params.defaults);
  let offset = 1;
  if (!repo) {
    if (!params.defaults.owner || !params.defaults.repo) {
      return undefined;
    }
    repo = { owner: params.defaults.owner, repo: params.defaults.repo };
    offset = 0;
  }

  const gateId = tokens[offset];
  const decision = tokens[offset + 1];
  if (!repo || !gateId || !decision) {
    return undefined;
  }

  return {
    repo,
    gateId,
    decision,
    note: tokens
      .slice(offset + 2)
      .join(" ")
      .trim(),
  };
}

async function readExecutionStartGate(repoRoot: string): Promise<
  | {
      artifact: Awaited<ReturnType<typeof writeProjectStageGateArtifact>>;
      gate: NonNullable<Awaited<ReturnType<typeof writeProjectStageGateArtifact>>["gates"][number]>;
    }
  | undefined
> {
  const artifact = await writeProjectStageGateArtifact(repoRoot);
  const gate = artifact.gates.find((entry) => entry.gateId === "execution-start");
  if (!gate) {
    return undefined;
  }
  return { artifact, gate };
}

function buildExecutionStartGateBlockedMessage(params: {
  repo: { owner: string; repo: string };
  gate: NonNullable<Awaited<ReturnType<typeof writeProjectStageGateArtifact>>["gates"][number]>;
}): string {
  return [
    `Execution start is currently gated for ${formatRepoKey(params.repo)}.`,
    `Gate: ${params.gate.gateId}`,
    `Readiness: ${params.gate.readiness}`,
    params.gate.blockers.length > 0
      ? `Blockers: ${params.gate.blockers.slice(0, 2).join(" ; ")}`
      : params.gate.suggestions.length > 0
        ? `Suggestions: ${params.gate.suggestions.slice(0, 2).join(" ; ")}`
        : undefined,
    `Use /occode-gates ${formatRepoKey(params.repo)} to inspect all stage gates.`,
    `Use /occode-gate-decide ${formatRepoKey(params.repo)} execution-start approved [note] after a human accepts the current execution-start risk.`,
    "Once the gate is approved, openclawcode will resume any held execution-start work automatically.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function holdExecutionStartAttempt(params: {
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
}): Promise<"added" | "updated" | "already-tracked"> {
  return await params.store.upsertPendingApproval(
    {
      issueKey: formatIssueKey(params.issue),
      notifyChannel: params.destination.channel,
      notifyTarget: params.destination.target,
      approvalKind: "execution-start-gated",
    },
    "Awaiting execution-start gate approval.",
  );
}

async function resumeExecutionStartHeldApprovals(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  repoConfig: OpenClawCodeChatopsRepoConfig;
}): Promise<string[]> {
  const state = await params.store.snapshot();
  const heldApprovals = state.pendingApprovals.filter(
    (entry) =>
      entry.approvalKind === "execution-start-gated" &&
      issueKeyMatchesRepo(entry.issueKey, {
        owner: params.repoConfig.owner,
        repo: params.repoConfig.repo,
      }),
  );

  const resumedIssueKeys: string[] = [];
  for (const pending of heldApprovals) {
    const issue = parseIssueKey(pending.issueKey);
    if (!issue) {
      continue;
    }
    const queued = await params.store.promotePendingApprovalToQueue({
      issueKey: pending.issueKey,
      request: buildRunRequestFromCommand({
        command: {
          action: "start",
          issue,
        },
        config: params.repoConfig,
      }),
      fallbackNotifyChannel: pending.notifyChannel,
      fallbackNotifyTarget: pending.notifyTarget,
      status: "Execution-start gate approved and queued.",
    });
    if (queued) {
      resumedIssueKeys.push(pending.issueKey);
    }
  }

  if (resumedIssueKeys.length > 0) {
    kickQueueDrain(params.api, params.store);
  }
  return resumedIssueKeys;
}

function buildMergedByApprovedReviewStatus(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  pullRequestUrl?: string;
  overrideUsed: boolean;
}): string {
  const summary = params.overrideUsed
    ? "GitHub review approved the pull request and openclawcode merged it automatically using the approved merge-promotion override."
    : "GitHub review approved the pull request and openclawcode merged it automatically.";
  return [
    `openclawcode status for ${params.snapshot.issueKey}`,
    "Stage: Merged",
    `Summary: ${summary}`,
    params.pullRequestUrl ? `PR: ${params.pullRequestUrl}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildApprovedReviewAutoMergeFailureStatus(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  pullRequestUrl?: string;
  reason: string;
  overrideUsed: boolean;
}): string {
  const summary = params.overrideUsed
    ? "GitHub review approved the pull request, but the merge-promotion override merge failed."
    : "GitHub review approved the pull request, but the automatic merge failed.";
  return [
    `openclawcode status for ${params.snapshot.issueKey}`,
    "Stage: Ready For Human Review",
    `Summary: ${summary}`,
    `Auto-merge failure: ${params.reason}`,
    params.pullRequestUrl ? `PR: ${params.pullRequestUrl}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

async function resolveMergePromotionOverrideApproval(repoRoot: string): Promise<boolean> {
  const stageGates = await readProjectStageGateArtifact(repoRoot);
  const mergeGate = stageGates.gates.find((gate) => gate.gateId === "merge-promotion");
  return mergeGate?.latestDecision?.decision === "approved";
}

async function maybeAutoMergeApprovedSnapshot(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: Awaited<ReturnType<OpenClawCodeChatopsStore["getRepoBinding"]>>;
  snapshot: OpenClawCodeIssueStatusSnapshot;
}): Promise<
  | {
      handled: false;
    }
  | {
      handled: true;
      merged: boolean;
      reason: string;
      snapshot: OpenClawCodeIssueStatusSnapshot;
    }
> {
  const snapshot = params.snapshot;
  if (
    !params.repoConfig.mergeOnApprove ||
    snapshot.stage !== "ready-for-human-review" ||
    snapshot.latestReviewDecision !== "approved" ||
    snapshot.pullRequestNumber == null
  ) {
    return { handled: false };
  }

  const overrideUsed =
    snapshot.autoMergePolicyEligible !== true &&
    (await resolveMergePromotionOverrideApproval(params.repoConfig.repoRoot));
  const mergeAllowed = snapshot.autoMergePolicyEligible === true || overrideUsed;
  if (!mergeAllowed) {
    return { handled: false };
  }

  const github = new GitHubRestClient();
  const updatedAt = new Date().toISOString();
  const pullRequestUrl =
    snapshot.pullRequestUrl ??
    `https://github.com/${params.repoConfig.owner}/${params.repoConfig.repo}/pull/${snapshot.pullRequestNumber}`;
  const destination = resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
    snapshot,
  });

  try {
    await github.mergePullRequest({
      owner: params.repoConfig.owner,
      repo: params.repoConfig.repo,
      pullNumber: snapshot.pullRequestNumber,
    });
    try {
      await github.closeIssue({
        owner: params.repoConfig.owner,
        repo: params.repoConfig.repo,
        issueNumber: snapshot.issueNumber,
      });
    } catch {
      // Keep the merged snapshot even if issue close fails.
    }
    const mergedSnapshot: OpenClawCodeIssueStatusSnapshot = {
      ...snapshot,
      stage: "merged",
      status: buildMergedByApprovedReviewStatus({
        snapshot,
        pullRequestUrl,
        overrideUsed,
      }),
      updatedAt,
      autoMergeDisposition: "merged",
      autoMergeDispositionReason: overrideUsed
        ? "Merged after review approval using the approved merge-promotion override."
        : "Merged automatically after review approval.",
    };
    await params.store.setStatusSnapshot(mergedSnapshot);
    await sendIssueNotification({
      api: params.api,
      store: params.store,
      issueKey: mergedSnapshot.issueKey,
      channel: destination.channel,
      target: destination.target,
      text: mergedSnapshot.status,
    }).catch(() => undefined);
    return {
      handled: true,
      merged: true,
      reason: overrideUsed ? "review-approved-override-merged" : "review-approved-auto-merged",
      snapshot: mergedSnapshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedSnapshot: OpenClawCodeIssueStatusSnapshot = {
      ...snapshot,
      status: buildApprovedReviewAutoMergeFailureStatus({
        snapshot,
        pullRequestUrl,
        reason: message,
        overrideUsed,
      }),
      updatedAt,
      autoMergeDisposition: "failed",
      autoMergeDispositionReason: overrideUsed
        ? `Merge-promotion override merge failed after review approval: ${message}`
        : `Automatic merge failed after review approval: ${message}`,
    };
    await params.store.setStatusSnapshot(failedSnapshot);
    await sendIssueNotification({
      api: params.api,
      store: params.store,
      issueKey: failedSnapshot.issueKey,
      channel: destination.channel,
      target: destination.target,
      text: failedSnapshot.status,
    }).catch(() => undefined);
    return {
      handled: true,
      merged: false,
      reason: overrideUsed
        ? "review-approved-override-merge-failed"
        : "review-approved-auto-merge-failed",
      snapshot: failedSnapshot,
    };
  }
}

function buildInboxMessage(params: {
  repo: { owner: string; repo: string };
  state: Awaited<ReturnType<OpenClawCodeChatopsStore["snapshot"]>>;
  validationPool?: ValidationPoolSummary;
  workItems?: Awaited<ReturnType<typeof readProjectWorkItemInventory>>;
  repoConfig?: OpenClawCodeChatopsRepoConfig;
  setupCheck?: SetupCheckProbePayload;
  promotionReceipt?: Awaited<ReturnType<typeof readProjectPromotionReceiptArtifact>>;
  rollbackReceipt?: Awaited<ReturnType<typeof readProjectRollbackReceiptArtifact>>;
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
  lines.push(...buildProviderPauseLines({ pause: params.state.providerPause }));
  const qualityGateSummary = summarizeRepoQualityGates({
    state: params.state,
    repo: params.repo,
  });
  if (qualityGateSummary) {
    lines.push(qualityGateSummary);
  }

  if (pending.length > 0) {
    lines.push(`Pending approvals: ${pending.length}`);
    for (const entry of pending) {
      const snapshot = params.state.statusSnapshotsByIssue[entry.issueKey];
      lines.push(
        `- ${entry.issueKey} | ${
          trimToSingleLine(params.state.statusByIssue[entry.issueKey]) ?? "Awaiting chat approval."
        }`,
      );
      lines.push(...buildPendingApprovalActionLines({ entry }));
      lines.push(...buildPolicyShortcutLines({ issueKey: entry.issueKey, snapshot }));
    }
  } else {
    lines.push("Pending approvals: 0");
  }

  if (running.length > 0) {
    lines.push(`Running: ${running.length}`);
    for (const entry of running) {
      const snapshot = params.state.statusSnapshotsByIssue[entry.issueKey];
      lines.push(
        `- ${entry.issueKey} | ${
          trimToSingleLine(params.state.statusByIssue[entry.issueKey]) ?? "Running."
        }`,
      );
      lines.push(...buildRunningActionLines(entry.issueKey));
      lines.push(...buildPolicyShortcutLines({ issueKey: entry.issueKey, snapshot }));
      lines.push(
        ...buildRerunLedgerLines({
          priorRunId: entry.request.rerunContext?.priorRunId,
          priorStage: entry.request.rerunContext?.priorStage,
          requestedAt: entry.request.rerunContext?.requestedAt,
          reason: entry.request.rerunContext?.reason,
          reviewDecision: entry.request.rerunContext?.reviewDecision,
          reviewSubmittedAt: entry.request.rerunContext?.reviewSubmittedAt,
          reviewSummary: entry.request.rerunContext?.reviewSummary,
          reviewUrl: entry.request.rerunContext?.reviewUrl,
          requestedCoderAgentId: entry.request.rerunContext?.requestedCoderAgentId,
          requestedVerifierAgentId: entry.request.rerunContext?.requestedVerifierAgentId,
          manualTakeoverRequestedAt: entry.request.rerunContext?.manualTakeoverRequestedAt,
          manualTakeoverActor: entry.request.rerunContext?.manualTakeoverActor,
          manualTakeoverWorktreePath: entry.request.rerunContext?.manualTakeoverWorktreePath,
          manualResumeNote: entry.request.rerunContext?.manualResumeNote,
        }),
      );
    }
  } else {
    lines.push("Running: 0");
  }

  if (queued.length > 0) {
    lines.push(`Queued: ${queued.length}`);
    for (const entry of queued) {
      const snapshot = params.state.statusSnapshotsByIssue[entry.issueKey];
      lines.push(
        `- ${entry.issueKey} | ${trimToSingleLine(params.state.statusByIssue[entry.issueKey]) ?? "Queued."}`,
      );
      lines.push(...buildQueuedActionLines(entry.issueKey));
      lines.push(...buildPolicyShortcutLines({ issueKey: entry.issueKey, snapshot }));
      lines.push(
        ...buildRerunLedgerLines({
          priorRunId: entry.request.rerunContext?.priorRunId,
          priorStage: entry.request.rerunContext?.priorStage,
          requestedAt: entry.request.rerunContext?.requestedAt,
          reason: entry.request.rerunContext?.reason,
          reviewDecision: entry.request.rerunContext?.reviewDecision,
          reviewSubmittedAt: entry.request.rerunContext?.reviewSubmittedAt,
          reviewSummary: entry.request.rerunContext?.reviewSummary,
          reviewUrl: entry.request.rerunContext?.reviewUrl,
          requestedCoderAgentId: entry.request.rerunContext?.requestedCoderAgentId,
          requestedVerifierAgentId: entry.request.rerunContext?.requestedVerifierAgentId,
          manualTakeoverRequestedAt: entry.request.rerunContext?.manualTakeoverRequestedAt,
          manualTakeoverActor: entry.request.rerunContext?.manualTakeoverActor,
          manualTakeoverWorktreePath: entry.request.rerunContext?.manualTakeoverWorktreePath,
          manualResumeNote: entry.request.rerunContext?.manualResumeNote,
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
      lines.push(...buildInboxQualityGateLines(entry));
      lines.push(...buildPolicyShortcutLines({ issueKey: entry.issueKey, snapshot: entry }));
      lines.push(
        ...buildRerunLedgerLines({
          priorRunId: entry.rerunPriorRunId,
          priorStage: entry.rerunPriorStage,
          requestedAt: entry.rerunRequestedAt,
          reason: entry.rerunReason,
          reviewDecision: entry.latestReviewDecision,
          reviewSubmittedAt: entry.latestReviewSubmittedAt,
          reviewSummary: entry.latestReviewSummary,
          reviewUrl: entry.latestReviewUrl,
          requestedCoderAgentId: entry.rerunRequestedCoderAgentId,
          requestedVerifierAgentId: entry.rerunRequestedVerifierAgentId,
          manualTakeoverRequestedAt: entry.rerunManualTakeoverRequestedAt,
          manualTakeoverActor: entry.rerunManualTakeoverActor,
          manualTakeoverWorktreePath: entry.rerunManualTakeoverWorktreePath,
          manualResumeNote: entry.rerunManualResumeNote,
        }),
      );
      lines.push(...buildProviderFailureContextLines({ snapshot: entry }));
      lines.push(
        ...buildWorkflowFailureDiagnosticLines({
          diagnostics: entry.failureDiagnostics,
        }),
      );
      lines.push(...buildNotificationLedgerLines(entry));
    }
  } else {
    lines.push("Recent ledger: 0");
  }

  lines.push(...buildWorkItemBacklogLines(params.workItems));
  lines.push(...buildValidationPoolLines(params.validationPool));
  if (params.repoConfig) {
    lines.push(
      ...buildPromotionReadinessLines({ repoConfig: params.repoConfig, probe: params.setupCheck }),
    );
    lines.push(...buildReleaseReceiptLines(params));
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

function buildManualTakeoverLines(
  takeover: Awaited<ReturnType<OpenClawCodeChatopsStore["getManualTakeover"]>> | undefined,
): string[] {
  if (!takeover) {
    return [];
  }
  return [
    `Manual takeover: active | requestedAt=${takeover.requestedAt}`,
    `- worktree=${takeover.worktreePath}`,
    takeover.branchName ? `- branch=${takeover.branchName}` : undefined,
    takeover.actor ? `- actor=${takeover.actor}` : undefined,
    takeover.note ? `- note=${takeover.note}` : undefined,
  ].filter((line): line is string => Boolean(line));
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

async function maybeQueueDeferredRuntimeReroute(params: {
  api: OpenClawPluginApi;
  store: OpenClawCodeChatopsStore;
  issueKey: string;
}): Promise<void> {
  const deferred = await params.store.getDeferredRuntimeReroute(params.issueKey);
  if (!deferred) {
    return;
  }

  const snapshot = await params.store.getStatusSnapshot(params.issueKey);
  const parsedIssue = parseIssueKey(params.issueKey);
  if (!snapshot || !parsedIssue) {
    return;
  }

  if (snapshot.stage !== "failed") {
    await params.store.removeDeferredRuntimeReroute(params.issueKey);
    await sendText({
      api: params.api,
      channel: deferred.notifyChannel,
      target: deferred.notifyTarget,
      text: [
        `Cleared the pending runtime reroute for ${params.issueKey}.`,
        `The current run finished at ${formatStageLabel(snapshot.stage)} instead of Failed, so no automatic rerun was queued.`,
      ].join("\n"),
    }).catch(() => undefined);
    return;
  }

  const pluginConfig = resolveOpenClawCodePluginConfig(params.api.pluginConfig);
  const repoConfig = resolveRepoConfig(pluginConfig.repos, parsedIssue);
  if (!repoConfig) {
    return;
  }

  const rerunContext = {
    reason: `${resolveRerunReason(snapshot)} Runtime reroute requested while the prior run was active.`,
    requestedAt: deferred.requestedAt,
    priorRunId: snapshot.runId,
    priorStage: snapshot.stage,
    reviewDecision: snapshot.latestReviewDecision,
    reviewSubmittedAt: snapshot.latestReviewSubmittedAt,
    reviewSummary: snapshot.latestReviewSummary,
    reviewUrl: snapshot.latestReviewUrl,
    requestedCoderAgentId: deferred.requestedCoderAgentId ?? snapshot.rerunRequestedCoderAgentId,
    requestedVerifierAgentId:
      deferred.requestedVerifierAgentId ?? snapshot.rerunRequestedVerifierAgentId,
  } as const;
  const request = buildRunRequestFromCommand({
    command: {
      action: "rerun",
      issue: parsedIssue,
    },
    config: repoConfig,
    rerunContext,
    runtimeAgentOverrides: {
      coderAgentId: rerunContext.requestedCoderAgentId,
      verifierAgentId: rerunContext.requestedVerifierAgentId,
    },
  });
  const queued = await params.store.enqueue(
    {
      issueKey: params.issueKey,
      notifyChannel: deferred.notifyChannel,
      notifyTarget: deferred.notifyTarget,
      request,
    },
    "Queued deferred runtime reroute after failed run.",
  );
  if (!queued) {
    return;
  }
  await params.store.removeDeferredRuntimeReroute(params.issueKey);
  kickQueueDrain(params.api, params.store);
  await sendText({
    api: params.api,
    channel: deferred.notifyChannel,
    target: deferred.notifyTarget,
    text: [
      `Queued deferred runtime reroute for ${params.issueKey} after Failed state.`,
      ...buildDeferredRuntimeRerouteLines({
        record: deferred,
        topLevel: true,
      }),
    ].join("\n"),
  }).catch(() => undefined);
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
    const queued = await queueOrGateIssueExecution({
      store: params.store,
      repoConfig: params.repoConfig,
      issue: decision.issue,
      destination,
      queuedStatus: "Auto-started from issue webhook.",
      gatedStatus: "Awaiting execution-start gate approval.",
    });
    if (queued.outcome === "already-tracked") {
      return await params.respondJson({
        accepted: false,
        reason: "already-tracked",
        issue: issueKey,
      });
    }
    if (queued.outcome === "queued") {
      const providerPause = await params.store.getActiveProviderPause();
      scheduleNotification({
        api: params.api,
        channel: destination.channel,
        target: destination.target,
        text: appendProviderPauseText({
          text: [
            "openclawcode auto-started a new GitHub issue.",
            `Issue: ${issueKey}`,
            `Title: ${decision.issue.title}`,
            "Mode: auto",
            "Status: queued for execution",
          ].join("\n"),
          pause: providerPause,
        }),
      });
      kickQueueDrain(params.api, params.store);
      return await params.respondJson({
        accepted: true,
        reason: "auto-enqueued",
        issue: issueKey,
      });
    }

    scheduleNotification({
      api: params.api,
      channel: destination.channel,
      target: destination.target,
      text: buildExecutionStartGateDeferredMessage({
        issue: decision.issue,
        gate: queued.gate,
        source: "auto-webhook",
      }),
    });
    return await params.respondJson({
      accepted: true,
      reason: "execution-start-gated",
      issue: issueKey,
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
    reason: "announced-for-approval",
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
  try {
    await sendIssueNotification({
      api: params.api,
      store: params.store,
      issueKey: applied.snapshot.issueKey,
      channel: destination.channel,
      target: destination.target,
      text: applied.snapshot.status,
    });
  } catch (error) {
    params.api.logger.warn(
      `openclawcode notification failed for ${destination.channel}:${destination.target}: ${String(error)}`,
    );
  }
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

  const merged = await maybeAutoMergeApprovedSnapshot({
    api: params.api,
    store: params.store,
    repoConfig: params.repoConfig,
    binding: params.binding,
    snapshot: applied.snapshot,
  });
  if (merged.handled) {
    return await params.respondJson({
      accepted: true,
      reason: merged.reason,
      issue: merged.snapshot.issueKey,
      pullRequestNumber: params.payload.pull_request.number,
    });
  }

  await params.store.setStatusSnapshot(applied.snapshot);
  const destination = resolveNotificationDestination({
    repoConfig: params.repoConfig,
    binding: params.binding,
    snapshot: applied.snapshot,
  });
  try {
    await sendIssueNotification({
      api: params.api,
      store: params.store,
      issueKey: applied.snapshot.issueKey,
      channel: destination.channel,
      target: destination.target,
      text: applied.snapshot.status,
    });
  } catch (error) {
    params.api.logger.warn(
      `openclawcode notification failed for ${destination.channel}:${destination.target}: ${String(error)}`,
    );
  }
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
  if (!runnerReady) {
    return;
  }
  if (workerActive) {
    return;
  }
  const snapshotBeforePauseCheck = await store.snapshot();
  const providerPause = await store.getActiveProviderPause();
  if (providerPause) {
    return;
  }
  const resumedProviderPause = snapshotBeforePauseCheck.providerPause;
  const next = await store.startNext();
  if (!next) {
    return;
  }

  workerActive = true;
  const startedAt = new Date().toISOString();
  try {
    if (resumedProviderPause) {
      await sendText({
        api,
        channel: next.notifyChannel,
        target: next.notifyTarget,
        text: buildProviderPauseResumedMessage({
          pause: resumedProviderPause,
          issueKey: next.issueKey,
        }),
      });
    }
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
        await maybeQueueDeferredRuntimeReroute({
          api,
          store,
          issueKey: next.issueKey,
        });
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
        await maybeQueueDeferredRuntimeReroute({
          api,
          store,
          issueKey: next.issueKey,
        });
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
    await maybeQueueDeferredRuntimeReroute({
      api,
      store,
      issueKey: next.issueKey,
    });
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

function kickQueueDrain(api: OpenClawPluginApi, store: OpenClawCodeChatopsStore): void {
  if (!runnerReady) {
    return;
  }
  queueMicrotask(() => {
    void processNextQueuedRun(api, store).catch(() => undefined);
  });
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
              "[issue title or one-line request]",
              "[optional issue body...]",
              "Or, when exactly one repo is configured:",
              "/occode-intake",
              "[issue title or one-line request]",
              "[optional issue body...]",
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
        const repoKey = formatRepoKey(command.repo);
        const draftHandle = {
          repoKey,
          notifyChannel: destination.channel,
          notifyTarget: destination.target,
        };
        if (command.draft.bodySynthesized) {
          const clarification = analyzeChatIntakeDraft({
            title: command.draft.title,
            body: command.draft.body,
            bodySynthesized: command.draft.bodySynthesized,
          });
          const scopedDrafts = deriveScopedChatIssueDrafts(command.draft.title);
          await store.upsertPendingIntakeDraft({
            ...draftHandle,
            title: command.draft.title,
            body: command.draft.body,
            sourceRequest: command.draft.sourceRequest,
            bodySynthesized: command.draft.bodySynthesized,
            scopedDrafts,
            clarificationQuestions: clarification.questions,
            clarificationSuggestions: clarification.suggestions,
            clarificationResponses: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          return {
            text: buildPendingIntakeDraftMessage({
              repo: command.repo,
              draft: {
                ...command.draft,
                clarificationResponses: [],
                scopedDrafts,
              },
              clarification,
            }),
          };
        }

        const result = await createAndHandleChatIntakeIssue({
          store,
          repoConfig,
          destination,
          draft: {
            title: command.draft.title,
            body: command.draft.body,
          },
        });
        if (result.issueCreated) {
          await store.removePendingIntakeDraft(draftHandle);
        }
        if (result.shouldKickQueue) {
          kickQueueDrain(api, store);
        }
        return {
          text: result.text,
        };
      },
    });

    api.registerCommand({
      name: "occode-intake-edit",
      description: "Edit the pending chat-native intake draft before creating the GitHub issue.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const parsed = parseRepoScopedMultilineBody({
          commandBody: ctx.commandBody,
          commandName: "occode-intake-edit",
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed) {
          return {
            text:
              "Usage: /occode-intake-edit owner/repo <title>\n<body...>\n" +
              "Or, when exactly one repo is configured: /occode-intake-edit <title>\n<body...>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(parsed.repo));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
        });
        const draftHandle = {
          repoKey: formatRepoKey(parsed.repo),
          notifyChannel: destination.channel,
          notifyTarget: destination.target,
        };
        const existing = await store.getPendingIntakeDraft(draftHandle);
        if (!existing) {
          return {
            text: [
              `No pending intake draft found for ${formatRepoKey(parsed.repo)} in this chat.`,
              `Start with /occode-intake ${formatRepoKey(parsed.repo)} <one-line request> first.`,
            ].join("\n"),
          };
        }

        const [nextTitleLine, ...restLines] = parsed.body.split("\n").map((line) => line.trimEnd());
        const nextTitle = nextTitleLine?.trim() || existing.title;
        const nextBody = restLines.join("\n").trim() || existing.body;
        const clarification = analyzeChatIntakeDraft({
          title: nextTitle,
          body: nextBody,
          bodySynthesized: false,
        });
        await store.upsertPendingIntakeDraft({
          ...existing,
          ...draftHandle,
          title: nextTitle,
          body: nextBody,
          sourceRequest: parsed.body,
          bodySynthesized: false,
          scopedDrafts: [],
          clarificationQuestions: clarification.questions,
          clarificationSuggestions: clarification.suggestions,
          clarificationResponses: [],
          updatedAt: new Date().toISOString(),
        });
        return {
          text: buildPendingIntakeDraftMessage({
            repo: parsed.repo,
            draft: {
              title: nextTitle,
              body: nextBody,
              bodySynthesized: false,
              clarificationResponses: [],
              scopedDrafts: [],
            },
            clarification,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-intake-answer",
      description: "Answer one pending chat-native intake clarification and refresh the draft.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const parsed = parseIntakeAnswerArgs({
          commandBody: ctx.commandBody,
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed || !parsed.answer) {
          return {
            text:
              "Usage: /occode-intake-answer owner/repo [index] <answer...>\n" +
              "Or, when exactly one repo is configured: /occode-intake-answer [index] <answer...>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(parsed.repo));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
        });
        const draftHandle = {
          repoKey: formatRepoKey(parsed.repo),
          notifyChannel: destination.channel,
          notifyTarget: destination.target,
        };
        const existing = await store.getPendingIntakeDraft(draftHandle);
        if (!existing) {
          return {
            text: [
              `No pending intake draft found for ${formatRepoKey(parsed.repo)} in this chat.`,
              `Start with /occode-intake ${formatRepoKey(parsed.repo)} <request> first.`,
            ].join("\n"),
          };
        }
        if (existing.clarificationQuestions.length === 0) {
          return {
            text: [
              `No outstanding clarification prompts remain for ${formatRepoKey(parsed.repo)}.`,
              `Use /occode-intake-preview ${formatRepoKey(parsed.repo)} to review the draft or /occode-intake-confirm ${formatRepoKey(parsed.repo)} to create the issue.`,
            ].join("\n"),
          };
        }

        const selectedQuestion = existing.clarificationQuestions[parsed.questionIndex - 1];
        if (!selectedQuestion) {
          return {
            text: [
              `Clarification index ${parsed.questionIndex} is out of range for ${formatRepoKey(parsed.repo)}.`,
              `Outstanding clarifications: 1-${existing.clarificationQuestions.length}`,
            ].join("\n"),
          };
        }

        const clarificationResponses = [
          ...(existing.clarificationResponses ?? []),
          {
            question: selectedQuestion,
            answer: parsed.answer,
            answeredAt: new Date().toISOString(),
          },
        ];
        const clarification = analyzeChatIntakeDraft({
          title: existing.title,
          body: existing.body,
          bodySynthesized: existing.bodySynthesized,
          answeredQuestions: clarificationResponses.map((response) => response.question),
        });
        await store.upsertPendingIntakeDraft({
          ...existing,
          ...draftHandle,
          clarificationQuestions: clarification.questions,
          clarificationSuggestions: clarification.suggestions,
          clarificationResponses,
          updatedAt: new Date().toISOString(),
        });
        return {
          text: buildPendingIntakeDraftMessage({
            repo: parsed.repo,
            draft: {
              title: existing.title,
              body: existing.body,
              bodySynthesized: existing.bodySynthesized,
              clarificationResponses,
              scopedDrafts: existing.scopedDrafts,
            },
            clarification,
            introLine: `openclawcode refreshed the pending chat intake draft for ${formatRepoKey(parsed.repo)} after recording a clarification answer.`,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-intake-preview",
      description: "Show the current pending chat-native intake draft before creating the GitHub issue.",
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
              "Usage: /occode-intake-preview owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-intake-preview",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(repo));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
        });
        const draftHandle = {
          repoKey: formatRepoKey(repo),
          notifyChannel: destination.channel,
          notifyTarget: destination.target,
        };
        const draft = await store.getPendingIntakeDraft(draftHandle);
        if (!draft) {
          return {
            text: [
              `No pending intake draft found for ${formatRepoKey(repo)} in this chat.`,
              `Use /occode-intake ${formatRepoKey(repo)} <request> to create one first.`,
            ].join("\n"),
          };
        }

        const clarification = analyzeChatIntakeDraft({
          title: draft.title,
          body: draft.body,
          bodySynthesized: draft.bodySynthesized,
        });
        return {
          text: buildPendingIntakeDraftMessage({
            repo,
            draft: {
              title: draft.title,
              body: draft.body,
              bodySynthesized: draft.bodySynthesized,
              clarificationResponses: draft.clarificationResponses,
              scopedDrafts: draft.scopedDrafts,
            },
            clarification,
            introLine: `openclawcode is holding a pending chat intake draft for ${formatRepoKey(repo)}.`,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-intake-choose",
      description: "Replace the pending chat-native intake draft with one scoped variant.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const tokens = (ctx.args ?? "")
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean);
        const explicitRepo = tokens.length > 0 ? parseChatopsRepoReference(tokens[0] ?? "") : null;
        const repo =
          explicitRepo ??
          parseChatopsRepoReference("", {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          });
        const indexToken = explicitRepo ? tokens[1] : tokens[0];
        const selectedIndex = Number.parseInt(indexToken ?? "", 10);
        if (!repo || !Number.isInteger(selectedIndex) || selectedIndex < 1) {
          return {
            text:
              "Usage: /occode-intake-choose owner/repo <index>\n" +
              "Or, when exactly one repo is configured: /occode-intake-choose <index>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(repo));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
        });
        const draftHandle = {
          repoKey: formatRepoKey(repo),
          notifyChannel: destination.channel,
          notifyTarget: destination.target,
        };
        const existing = await store.getPendingIntakeDraft(draftHandle);
        if (!existing) {
          return {
            text: [
              `No pending intake draft found for ${formatRepoKey(repo)} in this chat.`,
              `Use /occode-intake ${formatRepoKey(repo)} <request> to create one first.`,
            ].join("\n"),
          };
        }
        if (existing.scopedDrafts.length === 0) {
          return {
            text: [
              `No scoped draft variants are available for ${formatRepoKey(repo)}.`,
              `Use /occode-intake-edit ${formatRepoKey(repo)} <title>\\n<body...> to refine the draft manually.`,
            ].join("\n"),
          };
        }

        const selected = existing.scopedDrafts[selectedIndex - 1];
        if (!selected) {
          return {
            text: [
              `Scoped draft index ${selectedIndex} is out of range for ${formatRepoKey(repo)}.`,
              `Available variants: 1-${existing.scopedDrafts.length}`,
            ].join("\n"),
          };
        }

        const clarification = analyzeChatIntakeDraft({
          title: selected.title,
          body: selected.body,
          bodySynthesized: false,
        });
        await store.upsertPendingIntakeDraft({
          ...existing,
          ...draftHandle,
          title: selected.title,
          body: selected.body,
          bodySynthesized: false,
          scopedDrafts: [],
          clarificationQuestions: clarification.questions,
          clarificationSuggestions: clarification.suggestions,
          clarificationResponses: [],
          updatedAt: new Date().toISOString(),
        });
        return {
          text: buildPendingIntakeDraftMessage({
            repo,
            draft: {
              title: selected.title,
              body: selected.body,
              bodySynthesized: false,
              clarificationResponses: [],
              scopedDrafts: [],
            },
            clarification,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-intake-confirm",
      description: "Create and queue the pending chat-native intake draft for the current repo.",
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
              "Usage: /occode-intake-confirm owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-intake-confirm",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(repo));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
        });
        const draftHandle = {
          repoKey: formatRepoKey(repo),
          notifyChannel: destination.channel,
          notifyTarget: destination.target,
        };
        const draft = await store.getPendingIntakeDraft(draftHandle);
        if (!draft) {
          return {
            text: [
              `No pending intake draft found for ${formatRepoKey(repo)} in this chat.`,
              `Use /occode-intake ${formatRepoKey(repo)} <request> to create one first.`,
            ].join("\n"),
          };
        }

        const result = await createAndHandleChatIntakeIssue({
          store,
          repoConfig,
          destination,
          draft: {
            title: draft.title,
            body: materializePendingIntakeDraftBody({
              body: draft.body,
              clarificationResponses: draft.clarificationResponses,
            }),
          },
        });
        if (result.issueCreated) {
          await store.removePendingIntakeDraft(draftHandle);
        }
        if (result.shouldKickQueue) {
          kickQueueDrain(api, store);
        }
        return {
          text: result.text,
        };
      },
    });

    api.registerCommand({
      name: "occode-intake-reject",
      description: "Discard the pending chat-native intake draft for the current repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const args = (ctx.args ?? "").trim();
        const tokens = args
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean);
        const explicitRepo = tokens.length > 0 ? parseChatopsRepoReference(tokens[0] ?? "") : null;
        const repo =
          explicitRepo ??
          parseChatopsRepoReference("", {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          });
        if (!repo) {
          return {
            text:
              "Usage: /occode-intake-reject owner/repo [reason]\n" +
              "Or, when exactly one repo is configured: /occode-intake-reject [reason]",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(repo));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
        });
        const draftHandle = {
          repoKey: formatRepoKey(repo),
          notifyChannel: destination.channel,
          notifyTarget: destination.target,
        };
        const existing = await store.getPendingIntakeDraft(draftHandle);
        if (!existing) {
          return {
            text: [
              `No pending intake draft found for ${formatRepoKey(repo)} in this chat.`,
              `Use /occode-intake ${formatRepoKey(repo)} <request> to create one first.`,
            ].join("\n"),
          };
        }

        await store.removePendingIntakeDraft(draftHandle);
        const reason =
          (explicitRepo ? tokens.slice(1) : tokens).join(" ").trim() || "No reason provided.";
        return {
          text: [
            `openclawcode discarded the pending intake draft for ${formatRepoKey(repo)}.`,
            `Reason: ${reason}`,
            `Use /occode-intake ${formatRepoKey(repo)} <request> to start a new draft.`,
          ].join("\n"),
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
        const executionStartGate = await readExecutionStartGate(repoConfig.repoRoot);
        if (executionStartGate && executionStartGate.gate.readiness !== "ready") {
          await holdExecutionStartAttempt({
            store,
            issue: command.issue,
            destination: {
              channel:
                pendingApproval?.notifyChannel ?? ctx.channel?.trim() ?? repoConfig.notifyChannel,
              target:
                resolveCommandNotifyTarget(ctx) ||
                ctx.senderId?.trim() ||
                pendingApproval?.notifyTarget ||
                repoConfig.notifyTarget,
            },
          });
          return {
            text: buildExecutionStartGateBlockedMessage({
              repo: {
                owner: repoConfig.owner,
                repo: repoConfig.repo,
              },
              gate: executionStartGate.gate,
            }),
          };
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
        const providerPause = await store.getActiveProviderPause();
        kickQueueDrain(api, store);
        return {
          text: appendProviderPauseText({
            text: `Queued ${issueKey}. I will post status updates here.`,
            pause: providerPause,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-start-override",
      description: "Queue an openclawcode issue run with an explicit suitability override.",
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
              "Usage: /occode-start-override owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-start-override #123",
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
        const executionStartGate = await readExecutionStartGate(repoConfig.repoRoot);
        if (executionStartGate && executionStartGate.gate.readiness !== "ready") {
          await holdExecutionStartAttempt({
            store,
            issue: command.issue,
            destination: {
              channel:
                pendingApproval?.notifyChannel ?? ctx.channel?.trim() ?? repoConfig.notifyChannel,
              target:
                resolveCommandNotifyTarget(ctx) ||
                ctx.senderId?.trim() ||
                pendingApproval?.notifyTarget ||
                repoConfig.notifyTarget,
            },
          });
          return {
            text: buildExecutionStartGateBlockedMessage({
              repo: {
                owner: repoConfig.owner,
                repo: repoConfig.repo,
              },
              gate: executionStartGate.gate,
            }),
          };
        }

        const request = buildRunRequestFromCommand({
          command,
          config: repoConfig,
          suitabilityOverride: {
            actor: resolveCommandNotifyTarget(ctx) || ctx.senderId?.trim(),
            reason: "Chat operator approved a suitability override for this run.",
          },
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
          status: pendingApproval
            ? "Suitability override approved in chat and queued."
            : "Queued with suitability override.",
        });
        if (!queuedRun) {
          return { text: `${issueKey} is already queued or running.` };
        }
        const providerPause = await store.getActiveProviderPause();
        kickQueueDrain(api, store);
        return {
          text: appendProviderPauseText({
            text: `Queued ${issueKey} with an explicit suitability override. I will post status updates here.`,
            pause: providerPause,
          }),
        };
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
        const providerPause = await store.getActiveProviderPause();
        kickQueueDrain(api, store);
        const providerLines = buildProviderRerunLines({
          snapshot,
          pause: providerPause,
        });
        return {
          text: [
            `Queued rerun for ${issueKey} from ${stageLabel} state. I will post status updates here.`,
            ...providerLines,
          ].join("\n"),
        };
      },
    });

    api.registerCommand({
      name: "occode-reroute-run",
      description:
        "Queue a rerun for a tracked openclawcode issue with a coder/verifier agent override.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        let parsed:
          | {
              issue: { owner: string; repo: string; number: number };
              roleId: "coder" | "verifier";
              agentId: string;
            }
          | undefined;
        try {
          parsed = parseRuntimeRerouteArgs({
            args: ctx.args ?? "",
            defaults: {
              owner: defaultRepo?.owner,
              repo: defaultRepo?.repo,
            },
          });
        } catch (error) {
          return {
            text: (error as Error).message,
          };
        }
        if (!parsed) {
          return {
            text:
              "Usage: /occode-reroute-run owner/repo#123 <coder|verifier> <agent-id>\n" +
              "Or, when exactly one repo is configured: /occode-reroute-run #123 <coder|verifier> <agent-id>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.issue);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.issue.owner}/${parsed.issue.repo}.`,
          };
        }

        const issueKey = formatIssueKey(parsed.issue);
        const currentStatus = await store.getStatus(issueKey);
        const queueState = await store.snapshot();
        const currentRun =
          queueState.currentRun?.issueKey === issueKey ? queueState.currentRun : undefined;
        const queuedRun = queueState.queue.find((entry) => entry.issueKey === issueKey);
        if (currentRun) {
          const currentSnapshot = await store.getStatusSnapshot(issueKey);
          const existingDeferred = await store.getDeferredRuntimeReroute(issueKey);
          const deferredRequestedAt = new Date().toISOString();
          const deferred = await store.upsertDeferredRuntimeReroute({
            issueKey,
            notifyChannel: currentRun.notifyChannel,
            notifyTarget: currentRun.notifyTarget,
            requestedAt: deferredRequestedAt,
            actor: resolveCommandNotifyTarget(ctx) ?? ctx.senderId ?? ctx.channel,
            note: "Runtime reroute requested while the current run is active.",
            sourceRunId: currentSnapshot?.runId,
            sourceStage: currentSnapshot?.stage,
            requestedCoderAgentId:
              parsed.roleId === "coder"
                ? parsed.agentId
                : (existingDeferred?.requestedCoderAgentId ??
                  currentSnapshot?.rerunRequestedCoderAgentId),
            requestedVerifierAgentId:
              parsed.roleId === "verifier"
                ? parsed.agentId
                : (existingDeferred?.requestedVerifierAgentId ??
                  currentSnapshot?.rerunRequestedVerifierAgentId),
          });
          return {
            text: [
              `${deferred === "added" ? "Recorded" : "Updated"} a deferred runtime reroute for ${issueKey}.`,
              `The current run is still active; if it finishes Failed, openclawcode will queue a rerun automatically with the requested override.`,
              currentStatus ?? "Currently running.",
              ...buildDeferredRuntimeRerouteLines({
                record: await store.getDeferredRuntimeReroute(issueKey),
                topLevel: true,
              }),
            ].join("\n"),
          };
        }
        if (queuedRun) {
          await store.updateQueuedRuntimeReroute({
            issueKey,
            requestedCoderAgentId: parsed.roleId === "coder" ? parsed.agentId : undefined,
            requestedVerifierAgentId: parsed.roleId === "verifier" ? parsed.agentId : undefined,
            requestedAt: new Date().toISOString(),
            reason: `Runtime reroute requested for ${parsed.roleId} before execution started.`,
          });
          return {
            text: [
              `Updated the queued runtime override for ${issueKey}.`,
              `Execution has not started yet, so the next run will start with ${parsed.roleId} -> ${parsed.agentId}.`,
              currentStatus ?? "Queued.",
            ].join("\n"),
          };
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

        const binding = await store.getRepoBinding(formatRepoKey(parsed.issue));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
          snapshot,
        });
        const rerunContext = {
          reason: `${resolveRerunReason(snapshot)} Runtime reroute requested for ${parsed.roleId}.`,
          requestedAt: new Date().toISOString(),
          priorRunId: snapshot.runId,
          priorStage: snapshot.stage,
          reviewDecision: snapshot.latestReviewDecision,
          reviewSubmittedAt: snapshot.latestReviewSubmittedAt,
          reviewSummary: snapshot.latestReviewSummary,
          reviewUrl: snapshot.latestReviewUrl,
          requestedCoderAgentId:
            parsed.roleId === "coder" ? parsed.agentId : snapshot.rerunRequestedCoderAgentId,
          requestedVerifierAgentId:
            parsed.roleId === "verifier" ? parsed.agentId : snapshot.rerunRequestedVerifierAgentId,
        } as const;
        const request = buildRunRequestFromCommand({
          command: {
            action: "rerun",
            issue: parsed.issue,
          },
          config: repoConfig,
          rerunContext,
          runtimeAgentOverrides: {
            coderAgentId: rerunContext.requestedCoderAgentId,
            verifierAgentId: rerunContext.requestedVerifierAgentId,
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
          `Queued rerun from ${stageLabel} state with ${parsed.roleId} -> ${parsed.agentId}.`,
        );
        if (!queued) {
          return { text: `${issueKey} is already queued or running.` };
        }
        const providerPause = await store.getActiveProviderPause();
        kickQueueDrain(api, store);
        const providerLines = buildProviderRerunLines({
          snapshot: {
            ...snapshot,
            rerunRequestedCoderAgentId: rerunContext.requestedCoderAgentId,
            rerunRequestedVerifierAgentId: rerunContext.requestedVerifierAgentId,
          },
          pause: providerPause,
        });
        return {
          text: [
            `Queued reroute rerun for ${issueKey} from ${stageLabel} state. I will post status updates here.`,
            `Runtime override: ${parsed.roleId} -> ${parsed.agentId}`,
            ...providerLines,
          ].join("\n"),
        };
      },
    });

    api.registerCommand({
      name: "occode-takeover",
      description:
        "Record that a human is taking over the current issue worktree before resuming autonomous execution later.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const parsed = parseIssueCommandWithOptionalNote({
          args: ctx.args ?? "",
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed) {
          return {
            text:
              "Usage: /occode-takeover owner/repo#123 [note]\n" +
              "Or, when exactly one repo is configured: /occode-takeover #123 [note]",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.issue);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.issue.owner}/${parsed.issue.repo}.`,
          };
        }

        const issueKey = formatIssueKey(parsed.issue);
        const currentStatus = await store.getStatus(issueKey);
        if (await store.isQueuedOrRunning(issueKey)) {
          return { text: `${issueKey} is already in progress.\n${currentStatus ?? "Queued."}` };
        }
        if (await store.isPendingApproval(issueKey)) {
          return {
            text: [
              `${issueKey} has not started yet, so there is no prepared worktree to take over.`,
              `Use /occode-start ${issueKey} for the first run.`,
            ].join("\n"),
          };
        }

        const snapshot = await store.getStatusSnapshot(issueKey);
        if (!snapshot || !snapshot.worktreePath) {
          return {
            text: [
              `No tracked worktree is available for ${issueKey}.`,
              "Wait for at least one workflow run to prepare a workspace before taking over manually.",
            ].join("\n"),
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(parsed.issue));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
          snapshot,
        });
        await store.upsertManualTakeover({
          issueKey,
          runId: snapshot.runId,
          stage: snapshot.stage,
          branchName: snapshot.branchName,
          worktreePath: snapshot.worktreePath,
          notifyChannel: destination.channel,
          notifyTarget: destination.target,
          actor: resolveCommandNotifyTarget(ctx) ?? ctx.senderId ?? ctx.channel,
          note: parsed.note ?? undefined,
          requestedAt: new Date().toISOString(),
        });

        return {
          text: [
            `Recorded manual takeover for ${issueKey}.`,
            `Stage: ${formatStageLabel(snapshot.stage)}`,
            `Worktree: ${snapshot.worktreePath}`,
            snapshot.branchName ? `Branch: ${snapshot.branchName}` : undefined,
            parsed.note ? `Note: ${parsed.note}` : undefined,
            `Use /occode-resume-after-edit ${issueKey} [note] when the human edits are ready for a structured rerun.`,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      },
    });

    api.registerCommand({
      name: "occode-resume-after-edit",
      description:
        "Queue a structured rerun after a human finished editing a manually taken-over worktree.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const parsed = parseIssueCommandWithOptionalNote({
          args: ctx.args ?? "",
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed) {
          return {
            text:
              "Usage: /occode-resume-after-edit owner/repo#123 [note]\n" +
              "Or, when exactly one repo is configured: /occode-resume-after-edit #123 [note]",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.issue);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.issue.owner}/${parsed.issue.repo}.`,
          };
        }

        const issueKey = formatIssueKey(parsed.issue);
        const currentStatus = await store.getStatus(issueKey);
        if (await store.isQueuedOrRunning(issueKey)) {
          return { text: `${issueKey} is already in progress.\n${currentStatus ?? "Queued."}` };
        }

        const takeover = await store.getManualTakeover(issueKey);
        if (!takeover) {
          return {
            text: [
              `No active manual takeover is recorded for ${issueKey}.`,
              `Use /occode-takeover ${issueKey} before requesting a structured resume.`,
            ].join("\n"),
          };
        }

        const snapshot = await store.getStatusSnapshot(issueKey);
        if (!snapshot) {
          return {
            text: `No tracked openclawcode run found for ${issueKey}.`,
          };
        }

        const binding = await store.getRepoBinding(formatRepoKey(parsed.issue));
        const destination = resolveInteractiveNotificationDestination({
          ctx,
          repoConfig,
          binding,
          snapshot,
        });
        const rerunContext = {
          reason: `${resolveRerunReason(snapshot)} Manual takeover resume requested after human edits.`,
          requestedAt: new Date().toISOString(),
          priorRunId: snapshot.runId,
          priorStage: snapshot.stage,
          reviewDecision: snapshot.latestReviewDecision,
          reviewSubmittedAt: snapshot.latestReviewSubmittedAt,
          reviewSummary: snapshot.latestReviewSummary,
          reviewUrl: snapshot.latestReviewUrl,
          requestedCoderAgentId: snapshot.rerunRequestedCoderAgentId,
          requestedVerifierAgentId: snapshot.rerunRequestedVerifierAgentId,
          manualTakeoverRequestedAt: takeover.requestedAt,
          manualTakeoverActor: takeover.actor,
          manualTakeoverWorktreePath: takeover.worktreePath,
          manualResumeNote: parsed.note ?? takeover.note,
        } as const;
        const request = buildRunRequestFromCommand({
          command: {
            action: "rerun",
            issue: parsed.issue,
          },
          config: repoConfig,
          rerunContext,
          runtimeAgentOverrides: {
            coderAgentId: rerunContext.requestedCoderAgentId,
            verifierAgentId: rerunContext.requestedVerifierAgentId,
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
          `Queued rerun after manual takeover from ${stageLabel} state.`,
        );
        if (!queued) {
          return { text: `${issueKey} is already queued or running.` };
        }
        await store.removeManualTakeover(issueKey);
        const providerPause = await store.getActiveProviderPause();
        kickQueueDrain(api, store);
        return {
          text: appendProviderPauseText({
            text: [
              `Queued rerun for ${issueKey} after manual edits from ${stageLabel} state.`,
              `Worktree: ${takeover.worktreePath}`,
              parsed.note ? `Resume note: ${parsed.note}` : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            pause: providerPause,
          }),
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
      name: "occode-setup",
      description: "Start or resume chat-native openclawcode setup for this chat.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        if (!notifyTarget) {
          return {
            text: "This setup flow needs a concrete chat target. Start it from a direct or bound chat.",
          };
        }

        const selection = parseChatSetupProjectSelection({
          args: ctx.args ?? "",
          defaultRepo: defaultRepo ? { owner: defaultRepo.owner, repo: defaultRepo.repo } : undefined,
        });
        if (selection === "invalid") {
          return {
            text:
              "Usage: /occode-setup new-project\n" +
              "   or: /occode-setup existing owner/repo\n" +
              "   or: /occode-setup new repo-name\n" +
              "   or: /occode-setup new owner/repo\n" +
              "   or: /occode-setup owner/repo",
          };
        }

        const existing = await store.getSetupSession({
          notifyChannel: ctx.channel,
          notifyTarget,
        });
        const synced = existing
          ? await syncChatSetupSession({
              store,
              session: existing,
            })
          : undefined;
        const currentSession = synced?.session ?? existing;
        if (selection?.kind === "new-project-blueprint") {
          const now = new Date().toISOString();
          const nextSession = {
            notifyChannel: ctx.channel,
            notifyTarget,
            projectMode: "new-project" as const,
            repoKey: undefined,
            pendingRepoName: undefined,
            stage: "drafting-blueprint" as const,
            githubAuthSource: currentSession?.githubAuthSource,
            githubDeviceAuth: currentSession?.githubDeviceAuth,
            blueprintDraft: currentSession?.blueprintDraft ?? {
              status: "draft" as const,
              sections: {},
            },
            createdAt: currentSession?.createdAt ?? now,
            updatedAt: now,
          };
          await store.upsertSetupSession(nextSession);
          return {
            text: buildChatSetupDraftingBlueprintMessage({
              session: nextSession,
            }),
          };
        }
        if (isChatSetupBlueprintDraftSession(currentSession) && !selection) {
          return {
            text:
              currentSession.stage === "awaiting-repo-choice"
                ? buildChatSetupAwaitingRepoChoiceMessage({
                    session: currentSession,
                  })
                : buildChatSetupDraftingBlueprintMessage({
                    session: currentSession,
                  }),
          };
        }
        if (
          isChatSetupBlueprintDraftSession(currentSession) &&
          selection?.kind === "new-repo" &&
          currentSession.blueprintDraft.status !== "agreed"
        ) {
          return {
            text: buildChatSetupRepoCreationBlockedMessage({
              session: currentSession,
            }),
          };
        }
        if (synced?.session.stage === "github-authenticated" && synced.session.githubAuthSource) {
          const nextSession = {
            ...synced.session,
            projectMode: selection?.projectMode ?? synced.session.projectMode,
            repoKey: selection?.kind === "existing-repo" ? selection.repoKey : synced.session.repoKey,
            pendingRepoName:
              selection?.kind === "new-repo"
                ? selection.pendingRepoName
                : selection?.kind === "existing-repo" ||
                    selection?.kind === "new-project-blueprint"
                  ? undefined
                  : synced.session.pendingRepoName,
            blueprintDraft:
              selection?.kind === "existing-repo" ? undefined : synced.session.blueprintDraft,
            updatedAt: new Date().toISOString(),
          };
          await store.upsertSetupSession(nextSession);
          const completed = await completeChatSetupProjectSelection({
            store,
            session: nextSession,
          });
          if (completed.session.repoKey) {
            const bootstrapped = await completeChatSetupBootstrap({
              store,
              session: completed.session,
            });
            if (bootstrapped.message) {
              return {
                text: bootstrapped.message,
              };
            }
          }
          if (completed.message) {
            return {
              text: completed.message,
            };
          }
          return {
            text: buildChatSetupReadyMessage({
              source: nextSession.githubAuthSource,
              repoKey: nextSession.repoKey,
            }),
          };
        }
        if (synced?.status?.state === "pending") {
          await store.upsertSetupSession({
            ...synced.session,
            projectMode: selection?.projectMode ?? synced.session.projectMode,
            repoKey: selection?.kind === "existing-repo" ? selection.repoKey : synced.session.repoKey,
            pendingRepoName:
              selection?.kind === "new-repo"
                ? selection.pendingRepoName
                : selection?.kind === "existing-repo" ||
                    selection?.kind === "new-project-blueprint"
                  ? undefined
                  : synced.session.pendingRepoName,
            blueprintDraft:
              selection?.kind === "existing-repo" ? undefined : synced.session.blueprintDraft,
            updatedAt: new Date().toISOString(),
          });
          return {
            text: buildChatSetupAwaitingGitHubAuthMessage({
              verificationUri: synced.status.verificationUri,
              userCode: synced.status.userCode,
              selectionLabel:
                selection?.kind === "existing-repo"
                  ? selection.repoKey
                  : selection?.kind === "new-repo"
                    ? selection.pendingRepoName
                    : synced.session.repoKey ?? synced.session.pendingRepoName,
            }),
          };
        }

        const readyToken = resolveOnboardingGitHubToken();
        if (readyToken) {
          const now = new Date().toISOString();
          const nextSession = {
            notifyChannel: ctx.channel,
            notifyTarget,
            projectMode: selection?.projectMode ?? currentSession?.projectMode,
            repoKey: selection?.kind === "existing-repo" ? selection.repoKey : undefined,
            pendingRepoName:
              selection?.kind === "new-repo" ? selection.pendingRepoName : undefined,
            stage: currentSession ? resolveChatSetupStageAfterAuth(currentSession) : "github-authenticated",
            githubAuthSource: readyToken.source,
            blueprintDraft:
              selection?.kind === "existing-repo" ? undefined : currentSession?.blueprintDraft,
            githubDeviceAuth: currentSession?.githubDeviceAuth,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          } as const;
          await store.upsertSetupSession(nextSession);
          const completed = await completeChatSetupProjectSelection({
            store,
            session: nextSession,
          });
          if (completed.session.repoKey) {
            const bootstrapped = await completeChatSetupBootstrap({
              store,
              session: completed.session,
            });
            if (bootstrapped.message) {
              return {
                text: bootstrapped.message,
              };
            }
          }
          if (completed.message) {
            return {
              text: completed.message,
            };
          }
          return {
            text: buildChatSetupReadyMessage({
              source: readyToken.source,
              repoKey: nextSession.repoKey,
            }),
          };
        }

        let started;
        try {
          started = await startOnboardingGitHubCliDeviceLogin({
            stateDir: api.runtime.state.resolveStateDir(),
          });
        } catch (error) {
          const failed = {
            notifyChannel: ctx.channel,
            notifyTarget,
            projectMode: selection?.projectMode ?? currentSession?.projectMode,
            repoKey: selection?.kind === "existing-repo" ? selection.repoKey : undefined,
            pendingRepoName:
              selection?.kind === "new-repo" ? selection.pendingRepoName : undefined,
            stage: "awaiting-github-device-auth" as const,
            blueprintDraft:
              selection?.kind === "existing-repo" ? undefined : currentSession?.blueprintDraft,
            lastFailure: {
              step: "github-auth" as const,
              reason: error instanceof Error ? error.message : String(error),
              occurredAt: new Date().toISOString(),
            },
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await store.upsertSetupSession(failed);
          return {
            text: buildChatSetupFailedMessage({
              reason: error instanceof Error ? error.message : String(error),
              repoKey: failed.repoKey,
            }),
          };
        }
        const now = new Date().toISOString();
        await store.upsertSetupSession({
          notifyChannel: ctx.channel,
          notifyTarget,
          projectMode: selection?.projectMode ?? currentSession?.projectMode,
          repoKey: selection?.kind === "existing-repo" ? selection.repoKey : undefined,
          pendingRepoName:
            selection?.kind === "new-repo" ? selection.pendingRepoName : undefined,
          stage: "awaiting-github-device-auth",
          blueprintDraft:
            selection?.kind === "existing-repo" ? undefined : currentSession?.blueprintDraft,
          lastFailure: undefined,
          githubDeviceAuth: {
            pid: started.pid,
            logPath: started.logPath,
            userCode: started.userCode,
            verificationUri: started.verificationUri,
            startedAt: started.startedAt,
          },
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return {
          text: buildChatSetupAwaitingGitHubAuthMessage({
            verificationUri: started.verificationUri,
            userCode: started.userCode,
            selectionLabel:
              selection?.kind === "existing-repo"
                ? selection.repoKey
                : selection?.kind === "new-repo"
                  ? selection.pendingRepoName
                  : undefined,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-setup-status",
      description: "Show the current chat-native openclawcode setup state for this chat.",
      acceptsArgs: false,
      handler: async (ctx) => {
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        if (!notifyTarget) {
          return {
            text:
              "This setup flow needs a concrete chat target. Start it from a direct or bound chat.",
          };
        }
        const existing = await store.getSetupSession({
          notifyChannel: ctx.channel,
          notifyTarget,
        });
        const readyToken = resolveOnboardingGitHubToken();
        if (!existing && readyToken) {
          return {
            text: buildChatSetupReadyMessage({
              source: readyToken.source,
            }),
          };
        }
        if (!existing) {
          return {
            text: "No active openclawcode setup session for this chat. Start with /occode-setup.",
          };
        }
        return {
          text: await continueChatSetupSession({
            store,
            session: existing,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-setup-cancel",
      description: "Discard the active openclawcode setup session for this chat.",
      acceptsArgs: false,
      handler: async (ctx) => {
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        if (!notifyTarget) {
          return {
            text:
              "This setup flow needs a concrete chat target. Start it from a direct or bound chat.",
          };
        }
        const removed = await store.removeSetupSession({
          notifyChannel: ctx.channel,
          notifyTarget,
        });
        return {
          text: removed
            ? "Cancelled the active openclawcode setup session for this chat."
            : "No active openclawcode setup session for this chat. Start with /occode-setup.",
        };
      },
    });

    api.registerCommand({
      name: "occode-setup-retry",
      description: "Retry or resume the active openclawcode setup session for this chat.",
      acceptsArgs: false,
      handler: async (ctx) => {
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        if (!notifyTarget) {
          return {
            text:
              "This setup flow needs a concrete chat target. Start it from a direct or bound chat.",
          };
        }
        const existing = await store.getSetupSession({
          notifyChannel: ctx.channel,
          notifyTarget,
        });
        if (!existing) {
          return {
            text: "No active openclawcode setup session for this chat. Start with /occode-setup.",
          };
        }
        return {
          text: await continueChatSetupSession({
            store,
            session: existing,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-policy",
      description: "Show openclawcode safety and override policy for a repo or tracked issue.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const parsed = parsePolicyArgs({
          args: ctx.args ?? "",
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed) {
          return {
            text:
              "Usage: /occode-policy owner/repo\n" +
              "   or: /occode-policy owner/repo#123\n" +
              "Or, when exactly one repo is configured: /occode-policy\n" +
              "   or: /occode-policy #123",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        const issueKey = parsed.issue ? formatIssueKey(parsed.issue) : undefined;
        const snapshot = issueKey ? await store.getStatusSnapshot(issueKey) : undefined;
        return {
          text: buildPolicySnapshotMessage({
            repo: parsed.repo,
            snapshot,
            issueKey,
          }),
        };
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
        let statusText: string | undefined;
        let currentSnapshot = await store.getStatusSnapshot(issueKey);
        if (await store.isPendingApproval(issueKey)) {
          statusText =
            (await store.getStatus(issueKey)) ?? `Awaiting chat approval for ${issueKey}.`;
        } else {
          if (currentSnapshot) {
            try {
              const synced = await syncIssueSnapshotFromGitHub({
                snapshot: currentSnapshot,
              });
              if (synced.changed) {
                await store.setStatusSnapshot(synced.snapshot);
                currentSnapshot = synced.snapshot;
                statusText = synced.snapshot.status;
              }
            } catch {
              // Keep /occode-status usable even if GitHub is temporarily unavailable.
            }
          }
          if (!statusText) {
            const currentStatus = await store.getStatus(issueKey);
            if (currentStatus) {
              statusText = currentStatus;
            }
          }
          if (!statusText) {
            const reconciled = await findLatestLocalRunStatusForIssue({
              repo: repoConfig,
              issueKey,
            });
            statusText =
              reconciled?.status ?? `No openclawcode status recorded yet for ${issueKey}.`;
          }
        }
        const resolvedStatusText =
          statusText ?? `No openclawcode status recorded yet for ${issueKey}.`;
        const manualTakeover = await store.getManualTakeover(issueKey);
        const deferredRuntimeReroute = await store.getDeferredRuntimeReroute(issueKey);
        const providerPause = await store.getActiveProviderPause();
        const providerLines = providerPause
          ? buildProviderPauseLines({ pause: providerPause })
          : currentSnapshot
            ? buildProviderFailureContextLines({
                snapshot: currentSnapshot,
                topLevel: true,
              })
            : [];
        const resolvedWithProvider =
          providerLines.length > 0 || currentSnapshot?.failureDiagnostics
            ? [
                resolvedStatusText,
                ...providerLines,
                ...buildWorkflowFailureDiagnosticLines({
                  diagnostics: currentSnapshot?.failureDiagnostics,
                  topLevel: true,
                }),
              ].join("\n")
            : resolvedStatusText;
        const resolvedWithOperatorContext = [
          resolvedWithProvider,
          ...(currentSnapshot
            ? buildRerunLedgerLines({
                priorRunId: currentSnapshot.rerunPriorRunId,
                priorStage: currentSnapshot.rerunPriorStage,
                requestedAt: currentSnapshot.rerunRequestedAt,
                reason: currentSnapshot.rerunReason,
                reviewDecision: currentSnapshot.latestReviewDecision,
                reviewSubmittedAt: currentSnapshot.latestReviewSubmittedAt,
                reviewSummary: currentSnapshot.latestReviewSummary,
                reviewUrl: currentSnapshot.latestReviewUrl,
                requestedCoderAgentId: currentSnapshot.rerunRequestedCoderAgentId,
                requestedVerifierAgentId: currentSnapshot.rerunRequestedVerifierAgentId,
                manualTakeoverRequestedAt: currentSnapshot.rerunManualTakeoverRequestedAt,
                manualTakeoverActor: currentSnapshot.rerunManualTakeoverActor,
                manualTakeoverWorktreePath: currentSnapshot.rerunManualTakeoverWorktreePath,
                manualResumeNote: currentSnapshot.rerunManualResumeNote,
                topLevel: true,
              })
            : []),
          ...buildManualTakeoverLines(manualTakeover),
          ...buildDeferredRuntimeRerouteLines({
            record: deferredRuntimeReroute,
            topLevel: true,
          }),
          ...(currentSnapshot ? buildTopLevelQualityGateLines(currentSnapshot) : []),
          ...(currentSnapshot ? buildTopLevelRuntimeRoutingLines(currentSnapshot) : []),
          ...(currentSnapshot ? buildTopLevelHandoffSummaryLines(currentSnapshot) : []),
          ...(currentSnapshot ? buildTopLevelSuitabilityPolicyLines(currentSnapshot) : []),
          ...(currentSnapshot ? buildTopLevelAutoMergePolicyLines(currentSnapshot) : []),
          ...buildOperatorContextLines(repoConfig),
        ].join("\n");
        return {
          text:
            (await appendValidationIssueStatusContext({
              text: resolvedWithOperatorContext,
              issue: command.issue,
            }).catch(() => resolvedWithOperatorContext)) ?? resolvedWithOperatorContext,
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
        const validationPool = await fetchValidationPoolSummary({
          repo: {
            owner: repoConfig.owner,
            repo: repoConfig.repo,
          },
        }).catch(() => undefined);
        const workItems = await readProjectWorkItemInventory(repoConfig.repoRoot).catch(
          () => undefined,
        );
        const setupCheck = await probeSetupCheckReadiness({
          api,
          repoConfig,
        });
        const promotionReceipt = await readProjectPromotionReceiptArtifact(
          repoConfig.repoRoot,
        ).catch(() => undefined);
        const rollbackReceipt = await readProjectRollbackReceiptArtifact(repoConfig.repoRoot).catch(
          () => undefined,
        );
        return {
          text: buildInboxMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            state,
            validationPool,
            workItems,
            repoConfig,
            setupCheck,
            promotionReceipt,
            rollbackReceipt,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-promotion-checklist",
      description:
        "Show a compact promotion and rollback readiness checklist for an openclawcode repo.",
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
              "Usage: /occode-promotion-checklist owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-promotion-checklist",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const setupCheck = await probeSetupCheckReadiness({
          api,
          repoConfig,
        });
        const promotionReceipt = await readProjectPromotionReceiptArtifact(
          repoConfig.repoRoot,
        ).catch(() => undefined);
        const rollbackReceipt = await readProjectRollbackReceiptArtifact(repoConfig.repoRoot).catch(
          () => undefined,
        );
        return {
          text: buildPromotionChecklistMessage({
            repoConfig,
            probe: setupCheck,
            promotionReceipt,
            rollbackReceipt,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-goal",
      description:
        "Capture or update the repo-level project goal in PROJECT-BLUEPRINT.md from chat.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        const setupSession = notifyTarget
          ? await store.getSetupSession({
              notifyChannel: ctx.channel,
              notifyTarget,
            })
          : undefined;
        if (
          isChatSetupBlueprintDraftSession(setupSession) &&
          !hasExplicitRepoArgumentInCommandBody({
            commandBody: ctx.commandBody,
            commandName: "occode-goal",
          })
        ) {
          const body = extractMultilineCommandBody({
            commandBody: ctx.commandBody,
            commandName: "occode-goal",
          });
          if (!body) {
            return {
              text: "Usage during new-project setup: /occode-goal <goal text>",
            };
          }
          const updated = await updateChatSetupBlueprintDraftSection({
            store,
            session: setupSession,
            sectionName: "Goal",
            body,
          });
          return {
            text: buildChatSetupDraftUpdateMessage({
              sectionName: "Goal",
              session: updated,
            }),
          };
        }
        const parsed = parseRepoScopedMultilineBody({
          commandBody: ctx.commandBody,
          commandName: "occode-goal",
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed) {
          return {
            text:
              "Usage: /occode-goal owner/repo <goal text>\n" +
              "Or, when exactly one repo is configured: /occode-goal <goal text>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        const blueprint = await updateProjectBlueprintSection({
          repoRoot: repoConfig.repoRoot,
          sectionName: "Goal",
          body: parsed.body,
          createIfMissing: true,
          title: `${repoConfig.repo} project blueprint`,
        });
        const clarification = await inspectProjectBlueprintClarifications(repoConfig.repoRoot);
        const stageGates = await writeProjectStageGateArtifact(repoConfig.repoRoot);
        return {
          text: buildBlueprintGoalUpdateMessage({
            repo: parsed.repo,
            blueprint,
            clarification,
            executionStartReadiness: stageGates.gates.find(
              (entry) => entry.gateId === "execution-start",
            )?.readiness,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-blueprint-edit",
      description:
        "Update one blueprint section from chat without opening PROJECT-BLUEPRINT.md manually.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        const setupSession = notifyTarget
          ? await store.getSetupSession({
              notifyChannel: ctx.channel,
              notifyTarget,
            })
          : undefined;
        if (
          isChatSetupBlueprintDraftSession(setupSession) &&
          !hasExplicitRepoArgumentInCommandBody({
            commandBody: ctx.commandBody,
            commandName: "occode-blueprint-edit",
          })
        ) {
          let parsedSetup;
          try {
            parsedSetup = parseSetupBlueprintEditArgs(ctx.commandBody);
          } catch (error) {
            return {
              text: (error as Error).message,
            };
          }
          if (!parsedSetup) {
            return {
              text:
                "Usage during new-project setup: /occode-blueprint-edit <section>\n<body...>\n" +
                `Sections: ${projectBlueprintSectionIds().join(", ")}`,
            };
          }
          const updated = await updateChatSetupBlueprintDraftSection({
            store,
            session: setupSession,
            sectionName: parsedSetup.sectionName,
            body: parsedSetup.body,
          });
          return {
            text: buildChatSetupDraftUpdateMessage({
              sectionName: parsedSetup.sectionName,
              session: updated,
            }),
          };
        }
        let parsed:
          | {
              repo: { owner: string; repo: string };
              sectionName: ReturnType<typeof parseProjectBlueprintSectionName>;
              body: string;
            }
          | undefined;
        try {
          parsed = parseBlueprintEditArgs({
            commandBody: ctx.commandBody,
            defaults: {
              owner: defaultRepo?.owner,
              repo: defaultRepo?.repo,
            },
          });
        } catch (error) {
          return {
            text: (error as Error).message,
          };
        }
        if (!parsed) {
          return {
            text:
              "Usage: /occode-blueprint-edit owner/repo <section>\n<body...>\n" +
              `Sections: ${projectBlueprintSectionIds().join(", ")}\n` +
              "Or, when exactly one repo is configured: /occode-blueprint-edit <section>\n<body...>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        const blueprint = await updateProjectBlueprintSection({
          repoRoot: repoConfig.repoRoot,
          sectionName: parsed.sectionName,
          body: parsed.body,
          createIfMissing: true,
          title: `${repoConfig.repo} project blueprint`,
        });
        const clarification = await inspectProjectBlueprintClarifications(repoConfig.repoRoot);
        if (parsed.sectionName === "Provider Strategy") {
          await writeProjectRoleRoutingPlan(repoConfig.repoRoot);
        }
        const stageGates = await writeProjectStageGateArtifact(repoConfig.repoRoot);
        return {
          text: [
            `Updated blueprint section \`${parsed.sectionName}\` for ${formatRepoKey(parsed.repo)}.`,
            buildBlueprintGoalUpdateMessage({
              repo: parsed.repo,
              blueprint,
              clarification,
              executionStartReadiness: stageGates.gates.find(
                (entry) => entry.gateId === "execution-start",
              )?.readiness,
            }),
          ].join("\n"),
        };
      },
    });

    api.registerCommand({
      name: "occode-blueprint-agree",
      description: "Mark the current repo blueprint as agreed directly from chat.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        const setupSession = notifyTarget
          ? await store.getSetupSession({
              notifyChannel: ctx.channel,
              notifyTarget,
            })
          : undefined;
        if (isChatSetupBlueprintDraftSession(setupSession) && !(ctx.args ?? "").trim()) {
          const missing = collectChatSetupDraftMissingSections(setupSession);
          if (missing.length > 0) {
            return {
              text: buildChatSetupDraftingBlueprintMessage({
                session: setupSession,
              }),
            };
          }
          const now = new Date().toISOString();
          const updated = {
            ...setupSession,
            stage: "awaiting-repo-choice" as const,
            blueprintDraft: {
              ...setupSession.blueprintDraft,
              status: "agreed" as const,
              agreedAt: now,
              repoNameSuggestions: buildOnboardingRepoNameSuggestions(
                buildChatSetupDraftProjectText(setupSession),
              ),
            },
            updatedAt: now,
          };
          await store.upsertSetupSession(updated);
          return {
            text: buildChatSetupAwaitingRepoChoiceMessage({
              session: updated,
            }),
          };
        }
        const repo = parseChatopsRepoReference(ctx.args ?? "", {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!repo) {
          return {
            text:
              "Usage: /occode-blueprint-agree owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-blueprint-agree",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        try {
          await updateProjectBlueprintStatus({
            repoRoot: repoConfig.repoRoot,
            status: "agreed",
          });
        } catch (error) {
          return {
            text: String((error as Error).message),
          };
        }
        const blueprint = await readProjectBlueprintDocument(repoConfig.repoRoot);
        const stageGates = await writeProjectStageGateArtifact(repoConfig.repoRoot);
        return {
          text: buildBlueprintAgreementMessage({
            repo,
            blueprint,
            executionStartReadiness: stageGates.gates.find(
              (entry) => entry.gateId === "execution-start",
            )?.readiness,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-blueprint-answer",
      description: "Answer one blueprint clarification question from chat and write it back.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const parsed = parseBlueprintAnswerArgs({
          commandBody: ctx.commandBody,
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed) {
          return {
            text:
              "Usage: /occode-blueprint-answer owner/repo [index] <answer...>\n" +
              "Or, when exactly one repo is configured: /occode-blueprint-answer [index] <answer...>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        const blueprintBefore = await readProjectBlueprintDocument(repoConfig.repoRoot);
        const clarificationBefore = await inspectProjectBlueprintClarifications(repoConfig.repoRoot);
        if (clarificationBefore.questionCount === 0) {
          return {
            text: `No outstanding blueprint clarification questions remain for ${formatRepoKey(parsed.repo)}.`,
          };
        }
        const selectedQuestion = clarificationBefore.questions[parsed.questionIndex - 1];
        if (!selectedQuestion) {
          return {
            text:
              `Outstanding blueprint clarifications: 1-${clarificationBefore.questionCount}\n` +
              `Use /occode-blueprint-answer ${formatRepoKey(parsed.repo)} <index> <answer...> to answer one of them.`,
          };
        }

        const target = resolveBlueprintAnswerTarget({
          question: selectedQuestion,
          blueprint: blueprintBefore,
        });
        const isListSection =
          target.sectionName !== "Goal" && target.sectionName !== "Scope" && target.sectionName !== "Constraints";
        const body = isListSection ? normalizeBlueprintAnswerListBody(parsed.answer) : parsed.answer.trim();
        const blueprint = await updateProjectBlueprintSection({
          repoRoot: repoConfig.repoRoot,
          sectionName: target.sectionName,
          body,
          append: target.append,
          createIfMissing: true,
          title: `${repoConfig.repo} project blueprint`,
        });
        await appendProjectBlueprintDiscussionEntry({
          repoRoot: repoConfig.repoRoot,
          entry: {
            question: selectedQuestion,
            answer: parsed.answer.trim(),
            appliedSection: target.sectionName,
            actor: resolveCommandNotifyTarget(ctx) ?? ctx.senderId ?? null,
            appliedAt: new Date().toISOString(),
            questionIndex: parsed.questionIndex,
            blueprintRevisionBefore: blueprintBefore.revisionId,
            blueprintRevisionAfter: blueprint.revisionId,
          },
        });
        const clarification = await inspectProjectBlueprintClarifications(repoConfig.repoRoot);
        const stageGates = await writeProjectStageGateArtifact(repoConfig.repoRoot);
        return {
          text: [
            `Applied blueprint answer ${parsed.questionIndex} to \`${target.sectionName}\` for ${formatRepoKey(parsed.repo)}.`,
            `Answered: ${selectedQuestion}`,
            buildBlueprintGoalUpdateMessage({
              repo: parsed.repo,
              blueprint,
              clarification,
              executionStartReadiness: stageGates.gates.find(
                (entry) => entry.gateId === "execution-start",
              )?.readiness,
            }),
          ].join("\n"),
        };
      },
    });

    api.registerCommand({
      name: "occode-blueprint",
      description:
        "Show the current project blueprint summary and clarification prompts for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        const setupSession = notifyTarget
          ? await store.getSetupSession({
              notifyChannel: ctx.channel,
              notifyTarget,
            })
          : undefined;
        if (isChatSetupBlueprintDraftSession(setupSession) && !(ctx.args ?? "").trim()) {
          return {
            text:
              setupSession.stage === "awaiting-repo-choice"
                ? buildChatSetupAwaitingRepoChoiceMessage({
                    session: setupSession,
                  })
                : buildChatSetupDraftingBlueprintMessage({
                    session: setupSession,
                  }),
          };
        }
        const repo = parseChatopsRepoReference(ctx.args ?? "", {
          owner: defaultRepo?.owner,
          repo: defaultRepo?.repo,
        });
        if (!repo) {
          return {
            text:
              "Usage: /occode-blueprint owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-blueprint",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const blueprint = await readProjectBlueprintDocument(repoConfig.repoRoot);
        const clarification = await inspectProjectBlueprintClarifications(repoConfig.repoRoot);
        return {
          text: buildBlueprintSummaryMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            blueprint,
            clarification,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-routing",
      description: "Show the current provider-role routing plan for an openclawcode repo.",
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
              "Usage: /occode-routing owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-routing",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const plan = await writeProjectRoleRoutingPlan(repoConfig.repoRoot);
        return {
          text: buildRoleRoutingSummaryMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            plan,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-route-set",
      description: "Update one provider-role assignment for an openclawcode repo from chat.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        let parsed:
          | {
              repo: { owner: string; repo: string };
              roleId: ReturnType<typeof parseProjectBlueprintRoleId>;
              provider: string | null;
            }
          | undefined;
        try {
          parsed = parseRoleRoutingSetArgs({
            args: ctx.args ?? "",
            defaults: {
              owner: defaultRepo?.owner,
              repo: defaultRepo?.repo,
            },
          });
        } catch (error) {
          return {
            text: (error as Error).message,
          };
        }
        if (!parsed) {
          return {
            text:
              "Usage: /occode-route-set owner/repo <role> <provider|clear>\n" +
              `Roles: ${projectBlueprintRoleIds().join(", ")}\n` +
              "Or, when exactly one repo is configured: /occode-route-set <role> <provider|clear>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        try {
          const blueprint = await updateProjectBlueprintProviderRole({
            repoRoot: repoConfig.repoRoot,
            roleId: parsed.roleId,
            provider: parsed.provider,
          });
          const plan = await writeProjectRoleRoutingPlan(repoConfig.repoRoot);
          const stageGates = await writeProjectStageGateArtifact(repoConfig.repoRoot);
          const executionRoutingGate = stageGates.gates.find(
            (entry) => entry.gateId === "execution-routing",
          );
          return {
            text: [
              `Updated provider routing for ${formatRepoKey(parsed.repo)}`,
              `Role: ${parsed.roleId === "docWriter" ? "doc-writer" : parsed.roleId}`,
              `Provider: ${parsed.provider ?? "cleared"}`,
              `Blueprint revision: ${blueprint.revisionId ?? "unknown"}`,
              executionRoutingGate
                ? `Execution routing gate: ${executionRoutingGate.readiness}`
                : undefined,
              buildRoleRoutingSummaryMessage({
                repo: {
                  owner: repoConfig.owner,
                  repo: repoConfig.repo,
                },
                plan,
              }),
            ]
              .filter(Boolean)
              .join("\n"),
          };
        } catch (error) {
          return {
            text: (error as Error).message,
          };
        }
      },
    });

    api.registerCommand({
      name: "occode-runtime-steering",
      description: "Show the current per-stage runtime steering overrides for an openclawcode repo.",
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
              "Usage: /occode-runtime-steering owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-runtime-steering",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const artifact = await readProjectRuntimeSteeringArtifact(repoConfig.repoRoot);
        return {
          text: buildRuntimeSteeringSummaryMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            artifact,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-runtime-steering-set",
      description: "Update one per-stage runtime steering override for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        let parsed:
          | ReturnType<typeof parseRuntimeSteeringSetArgs>
          | undefined;
        try {
          parsed = parseRuntimeSteeringSetArgs({
            args: ctx.args ?? "",
            defaults: {
              owner: defaultRepo?.owner,
              repo: defaultRepo?.repo,
            },
          });
        } catch (error) {
          return {
            text: (error as Error).message,
          };
        }
        if (!parsed) {
          return {
            text:
              "Usage: /occode-runtime-steering-set owner/repo <building|verifying> <agent-id|clear> [adapter=<id>] [note]\n" +
              "Or, when exactly one repo is configured: /occode-runtime-steering-set <building|verifying> <agent-id|clear> [adapter=<id>] [note]",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        const artifact = await recordProjectRuntimeSteeringOverride({
          repoRoot: repoConfig.repoRoot,
          stageId: parsed.stageId,
          agentId: parsed.agentId,
          adapterId: parsed.adapterId,
          actor: resolveCommandNotifyTarget({
            to: ctx.to,
            from: ctx.from,
            senderId: ctx.senderId,
          }),
          note: parsed.note,
          clear: parsed.clear,
        });

        return {
          text: [
            `${parsed.clear ? "Cleared" : "Updated"} runtime steering for ${formatRepoKey(parsed.repo)}.`,
            `Stage: ${parsed.stageId}`,
            ...(!parsed.clear
              ? [
                  `Agent: ${parsed.agentId ?? "runner-default"}`,
                  parsed.adapterId ? `Adapter: ${parsed.adapterId}` : undefined,
                ]
              : []),
            parsed.note ? `Note: ${parsed.note}` : undefined,
            buildRuntimeSteeringSummaryMessage({
              repo: parsed.repo,
              artifact,
            }),
          ]
            .filter(Boolean)
            .join("\n"),
        };
      },
    });

    api.registerCommand({
      name: "occode-gates",
      description: "Show the current blueprint stage-gate state for an openclawcode repo.",
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
              "Usage: /occode-gates owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-gates",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const artifact = await writeProjectStageGateArtifact(repoConfig.repoRoot);
        return {
          text: buildStageGateSummaryMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            artifact,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-next",
      description:
        "Show the next blueprint-backed work item to execute, or explain why autonomous progress is blocked.",
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
              "Usage: /occode-next owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-next",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }

        const selection = await writeProjectNextWorkSelection(repoConfig.repoRoot);
        return {
          text: buildNextWorkSummaryMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            selection,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-materialize",
      description: "Create or reuse the GitHub issue for the selected blueprint-backed work item.",
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
              "Usage: /occode-materialize owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-materialize",
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
            text: "This command needs a concrete chat target so any queued run can post updates here.",
          };
        }

        const result = await materializeAndHandleNextWorkIssue({
          store,
          repoConfig,
          destination: {
            channel: ctx.channel,
            target: notifyTarget,
          },
        });
        if (result.shouldKickQueue) {
          kickQueueDrain(api, store);
        }
        return {
          text: result.text,
        };
      },
    });

    api.registerCommand({
      name: "occode-progress",
      description: "Show the current blueprint-aware project progress summary for an openclawcode repo.",
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
              "Usage: /occode-progress owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-progress",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${repo.owner}/${repo.repo}.`,
          };
        }
        const operatorSnapshot = await readOpenClawCodeOperatorStatusSnapshot(
          api.runtime.state.resolveStateDir(),
        ).catch(() => undefined);
        const artifact = await writeProjectProgressArtifact({
          repoRoot: repoConfig.repoRoot,
          repo: {
            owner: repoConfig.owner,
            repo: repoConfig.repo,
          },
          operatorSnapshot,
        });
        return {
          text: buildProjectProgressSummaryMessage({
            repo: {
              owner: repoConfig.owner,
              repo: repoConfig.repo,
            },
            artifact,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-autopilot",
      description: "Run, inspect, or disable one autonomous blueprint-backed progress loop for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const parsed = parseAutopilotArgs({
          args: ctx.args ?? "",
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed) {
          return {
            text:
              "Usage: /occode-autopilot <once|repeat [count]|status|off> owner/repo\n" +
              "Or, when exactly one repo is configured: /occode-autopilot <once|repeat [count]|status|off>",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }
        if (parsed.action === "off") {
          const artifact = await setProjectAutonomousLoopDisabled({
            repoRoot: repoConfig.repoRoot,
            repo: parsed.repo,
          });
          return {
            text: buildAutonomousLoopSummaryMessage({
              repo: parsed.repo,
              artifact,
            }),
          };
        }
        if (parsed.action === "status") {
          const artifact = await readProjectAutonomousLoopArtifact(repoConfig.repoRoot);
          return {
            text: buildAutonomousLoopSummaryMessage({
              repo: parsed.repo,
              artifact,
            }),
          };
        }
        const notifyTarget = resolveCommandNotifyTarget(ctx);
        const operatorSnapshot = await readOpenClawCodeOperatorStatusSnapshot(
          api.runtime.state.resolveStateDir(),
        ).catch(() => undefined);
        const artifact = await runProjectAutonomousLoop({
          repoRoot: repoConfig.repoRoot,
          repo: parsed.repo,
          operatorSnapshot,
          readOperatorSnapshot: async () =>
            await readOpenClawCodeOperatorStatusSnapshot(
              api.runtime.state.resolveStateDir(),
            ).catch(() => undefined),
          queueIssue:
            notifyTarget == null
              ? undefined
              : async ({ issueNumber }) => {
                  const queued = await queueOrGateIssueExecution({
                    store,
                    repoConfig,
                    issue: {
                      owner: repoConfig.owner,
                      repo: repoConfig.repo,
                      number: issueNumber,
                    },
                    destination: {
                      channel: ctx.channel,
                      target: notifyTarget,
                    },
                    queuedStatus:
                      parsed.action === "repeat"
                        ? "Queued from /occode-autopilot repeat."
                        : "Queued from /occode-autopilot once.",
                    gatedStatus: "Awaiting execution-start gate approval.",
                  });
                  if (queued.outcome === "queued") {
                    kickQueueDrain(api, store);
                    return {
                      outcome: "queued" as const,
                      issueKey: queued.queuedRun.issueKey,
                    };
                  }
                  if (queued.outcome === "gated") {
                    return {
                      outcome: "gated" as const,
                      issueKey: `${repoConfig.owner}/${repoConfig.repo}#${issueNumber}`,
                    };
                  }
                  return {
                    outcome: "already-tracked" as const,
                    issueKey:
                      queued.outcome === "already-tracked"
                        ? `${repoConfig.owner}/${repoConfig.repo}#${issueNumber}`
                        : null,
                  };
                },
          maxIterations: parsed.action === "repeat" ? parsed.iterations : 1,
        });
        return {
          text: buildAutonomousLoopSummaryMessage({
            repo: parsed.repo,
            artifact,
          }),
        };
      },
    });

    api.registerCommand({
      name: "occode-gate-decide",
      description: "Record a blueprint stage-gate decision from chat for an openclawcode repo.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const pluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
        const defaultRepo = resolveDefaultRepoConfig(pluginConfig.repos);
        const parsed = parseStageGateDecisionArgs({
          args: ctx.args ?? "",
          defaults: {
            owner: defaultRepo?.owner,
            repo: defaultRepo?.repo,
          },
        });
        if (!parsed) {
          return {
            text:
              "Usage: /occode-gate-decide owner/repo <gate-id> <decision> [note]\n" +
              "Or, when exactly one repo is configured: /occode-gate-decide <gate-id> <decision> [note]",
          };
        }

        const repoConfig = resolveRepoConfig(pluginConfig.repos, parsed.repo);
        if (!repoConfig) {
          return {
            text: `No openclawcode repo config found for ${parsed.repo.owner}/${parsed.repo.repo}.`,
          };
        }

        try {
          const artifact = await recordProjectStageGateDecision({
            repoRoot: repoConfig.repoRoot,
            gateId: parsed.gateId,
            decision: parsed.decision,
            note: parsed.note || undefined,
            actor: resolveCommandNotifyTarget(ctx) ?? ctx.senderId ?? ctx.channel,
          });
          const gate = artifact.gates.find((entry) => entry.gateId === parsed.gateId);
          const resumedIssueKeys =
            parsed.gateId === "execution-start" &&
            parsed.decision === "approved" &&
            gate?.readiness === "ready"
              ? await resumeExecutionStartHeldApprovals({
                  api,
                  store,
                  repoConfig,
                })
              : [];
          let mergeDecisionLine: string | undefined;
          if (parsed.gateId === "merge-promotion" && parsed.decision === "approved") {
            const state = await store.snapshot();
            const candidates = Object.values(state.statusSnapshotsByIssue).filter(
              (snapshot) =>
                snapshot.owner.toLowerCase() === repoConfig.owner.toLowerCase() &&
                snapshot.repo.toLowerCase() === repoConfig.repo.toLowerCase() &&
                snapshot.stage === "ready-for-human-review" &&
                snapshot.latestReviewDecision === "approved" &&
                snapshot.pullRequestNumber != null,
            );
            if (candidates.length === 1) {
              const mergeAttempt = await maybeAutoMergeApprovedSnapshot({
                api,
                store,
                repoConfig,
                binding: await store.getRepoBinding(formatRepoKey(parsed.repo)),
                snapshot: candidates[0]!,
              });
              if (mergeAttempt.handled) {
                mergeDecisionLine = mergeAttempt.merged
                  ? `Merge action: merged ${mergeAttempt.snapshot.issueKey} automatically.`
                  : `Merge action: attempted ${mergeAttempt.snapshot.issueKey}, but merge failed.`;
              }
            } else if (candidates.length > 1) {
              mergeDecisionLine =
                "Merge action: skipped automatic merge because multiple review-approved candidates are waiting in this repo.";
            }
          }
          return {
            text: [
              `Recorded stage-gate decision for ${formatRepoKey(parsed.repo)}`,
              `Gate: ${parsed.gateId}`,
              `Decision: ${parsed.decision}`,
              gate ? `Readiness: ${gate.readiness}` : undefined,
              parsed.note ? `Note: ${parsed.note}` : undefined,
              mergeDecisionLine,
              resumedIssueKeys.length > 0
                ? `Resumed held executions: ${resumedIssueKeys.length}`
                : undefined,
              ...resumedIssueKeys.slice(0, 5).map((issueKey) => `- ${issueKey}`),
            ]
              .filter(Boolean)
              .join("\n"),
          };
        } catch (error) {
          return {
            text: (error as Error).message,
          };
        }
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
        workerActive = false;
        runnerReady = true;
        pollTimer = setInterval(() => {
          const currentPluginConfig = resolveOpenClawCodePluginConfig(api.pluginConfig);
          void processPendingSetupSessions(api, store).catch(() => undefined);
          void proactivelyStartChatSetupSessions(api, store, currentPluginConfig.repos).catch(
            () => undefined,
          );
          void processNextQueuedRun(api, store).catch(() => undefined);
        }, intervalMs);
        pollTimer.unref?.();
        await processPendingSetupSessions(api, store);
        await proactivelyStartChatSetupSessions(api, store, pluginConfig.repos);
        kickQueueDrain(api, store);
      },
      stop: async () => {
        runnerReady = false;
        workerActive = false;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        await store.snapshot();
      },
    });
  },
};
