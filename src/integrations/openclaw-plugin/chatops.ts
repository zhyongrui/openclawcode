import path from "node:path";
import process from "node:process";
import type {
  IssueRef,
  WorkflowFailureDiagnostics,
  WorkflowRerunContext,
  WorkflowRun,
} from "../../openclawcode/contracts/index.js";
import { collectSuitabilityPolicySignals } from "../../openclawcode/policy.js";

const SUPPORTED_ISSUE_ACTIONS = new Set(["opened", "reopened", "labeled"]);

function trimToSingleLine(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : undefined;
}

export interface GitHubIssueWebhookEvent {
  action: string;
  repository: {
    owner:
      | string
      | {
          login?: string;
        };
    name: string;
  };
  issue: {
    number: number;
    title: string;
    body?: string;
    labels?: Array<{ name: string }>;
    pull_request?: unknown;
  };
  label?: {
    name?: string;
  };
}

export interface OpenClawCodeChatopsRepoConfig {
  owner: string;
  repo: string;
  repoRoot: string;
  baseBranch: string;
  triggerMode?: "approve" | "auto";
  notifyChannel: string;
  notifyTarget: string;
  builderAgent: string;
  verifierAgent: string;
  testCommands: string[];
  triggerLabels?: string[];
  skipLabels?: string[];
  openPullRequest?: boolean;
  mergeOnApprove?: boolean;
}

export interface OpenClawCodeFeishuOperatorBindingConfig {
  accountId?: string;
  email?: string;
  mobile?: string;
  sendWelcomeMessage?: boolean;
}

export interface OpenClawCodePluginConfig {
  githubWebhookSecretEnv?: string;
  pollIntervalMs?: number;
  repos: OpenClawCodeChatopsRepoConfig[];
  feishuOperatorBinding?: OpenClawCodeFeishuOperatorBindingConfig;
}

export interface ChatopsIssueIntakeDecision {
  accept: boolean;
  reason: string;
  issue?: IssueRef;
  precheck?: {
    decision: "escalate";
    summary: string;
    reasons: string[];
  };
}

export interface OpenClawCodeChatopsCommand {
  action: "start" | "rerun" | "skip" | "status";
  issue: {
    owner: string;
    repo: string;
    number: number;
  };
}

export interface OpenClawCodeChatopsRepoRef {
  owner: string;
  repo: string;
}

export interface OpenClawCodeChatopsIssueDraftCommand {
  action: "intake";
  repo: {
    owner: string;
    repo: string;
  };
  draft: {
    title: string;
    body: string;
    bodySynthesized: boolean;
    sourceRequest: string;
  };
}

export interface OpenClawCodeScopedIssueDraft {
  title: string;
  body: string;
  reason: string;
}

export type OpenClawCodeChatIssueDraftKind = "feature" | "bugfix" | "refactor" | "research";

export interface OpenClawCodeChatopsRunRequest {
  owner: string;
  repo: string;
  issueNumber: number;
  repoRoot: string;
  baseBranch: string;
  branchName: string;
  builderAgent: string;
  verifierAgent: string;
  testCommands: string[];
  openPullRequest: boolean;
  mergeOnApprove: boolean;
  suitabilityOverride?: {
    actor?: string;
    reason?: string;
  };
  rerunContext?: WorkflowRerunContext;
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry));
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : undefined;
}

function readTriggerMode(value: unknown): "approve" | "auto" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "auto" || normalized === "approve" ? normalized : undefined;
}

function collectIssueLabels(labels: Array<{ name: string }> | undefined): string[] {
  const seen = new Set<string>();
  const collected: string[] = [];
  for (const entry of labels ?? []) {
    const normalized = normalizeValue(entry.name);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    collected.push(normalized);
  }
  return collected;
}

function normalizeFilter(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const candidate = normalizeValue(value);
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized;
}

function repoMatches(
  event: GitHubIssueWebhookEvent,
  config: OpenClawCodeChatopsRepoConfig,
): boolean {
  const owner = readGitHubRepositoryOwner(event.repository.owner);
  if (!owner) {
    return false;
  }
  return (
    normalizeValue(owner) === normalizeValue(config.owner) &&
    normalizeValue(event.repository.name) === normalizeValue(config.repo)
  );
}

function hasMatchingLabel(labels: string[], filters: string[]): boolean {
  return filters.some((filter) => labels.includes(filter));
}

export function formatIssueKey(issue: Pick<IssueRef, "owner" | "repo" | "number">): string {
  return `${issue.owner}/${issue.repo}#${issue.number}`;
}

export function formatRepoKey(repo: OpenClawCodeChatopsRepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

export function readGitHubRepositoryOwner(
  owner: GitHubIssueWebhookEvent["repository"]["owner"],
): string | undefined {
  if (typeof owner === "string") {
    return readString(owner);
  }
  if (!owner || typeof owner !== "object") {
    return undefined;
  }
  return readString(owner.login);
}

export function resolveOpenClawCodePluginConfig(
  pluginConfig: Record<string, unknown> | undefined,
): OpenClawCodePluginConfig {
  const reposRaw = Array.isArray(pluginConfig?.repos) ? pluginConfig.repos : [];
  const repos: OpenClawCodeChatopsRepoConfig[] = [];

  for (const entry of reposRaw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const owner = readString(candidate.owner);
    const repo = readString(candidate.repo);
    const repoRoot = readString(candidate.repoRoot);
    const baseBranch = readString(candidate.baseBranch) ?? "main";
    const notifyChannel = readString(candidate.notifyChannel);
    const notifyTarget = readString(candidate.notifyTarget);
    const builderAgent = readString(candidate.builderAgent);
    const verifierAgent = readString(candidate.verifierAgent);
    const testCommands = readStringArray(candidate.testCommands);
    if (
      !owner ||
      !repo ||
      !repoRoot ||
      !notifyChannel ||
      !notifyTarget ||
      !builderAgent ||
      !verifierAgent ||
      testCommands.length === 0
    ) {
      continue;
    }

    repos.push({
      owner,
      repo,
      repoRoot,
      baseBranch,
      triggerMode: readTriggerMode(candidate.triggerMode) ?? "approve",
      notifyChannel,
      notifyTarget,
      builderAgent,
      verifierAgent,
      testCommands,
      triggerLabels: readStringArray(candidate.triggerLabels),
      skipLabels: readStringArray(candidate.skipLabels),
      openPullRequest: readBoolean(candidate.openPullRequest),
      mergeOnApprove: readBoolean(candidate.mergeOnApprove),
    });
  }

  let feishuOperatorBinding: OpenClawCodeFeishuOperatorBindingConfig | undefined;
  const feishuOperatorBindingRaw = pluginConfig?.feishuOperatorBinding;
  if (feishuOperatorBindingRaw && typeof feishuOperatorBindingRaw === "object") {
    const candidate = feishuOperatorBindingRaw as Record<string, unknown>;
    const email = readString(candidate.email);
    const mobile = readString(candidate.mobile);
    if (email || mobile) {
      feishuOperatorBinding = {
        accountId: readString(candidate.accountId),
        email,
        mobile,
        sendWelcomeMessage: readBoolean(candidate.sendWelcomeMessage),
      };
    }
  }

  return {
    githubWebhookSecretEnv: readString(pluginConfig?.githubWebhookSecretEnv),
    pollIntervalMs: readPositiveInteger(pluginConfig?.pollIntervalMs),
    repos,
    feishuOperatorBinding,
  };
}

export function decideIssueWebhookIntake(params: {
  event: GitHubIssueWebhookEvent;
  config: OpenClawCodeChatopsRepoConfig;
}): ChatopsIssueIntakeDecision {
  const { event, config } = params;

  if (!repoMatches(event, config)) {
    return {
      accept: false,
      reason: "Webhook repository does not match the configured openclawcode target.",
    };
  }

  if (event.issue.pull_request) {
    return {
      accept: false,
      reason: "Pull request issue events are ignored by the chatops intake.",
    };
  }

  if (!SUPPORTED_ISSUE_ACTIONS.has(event.action)) {
    return {
      accept: false,
      reason: `Unsupported issue action: ${event.action}.`,
    };
  }

  const labels = collectIssueLabels(event.issue.labels);
  const skipLabels = normalizeFilter(config.skipLabels);
  if (skipLabels.length > 0 && hasMatchingLabel(labels, skipLabels)) {
    return {
      accept: false,
      reason: "Issue matched a skip label and will not be queued for chat approval.",
    };
  }

  const triggerLabels = normalizeFilter(config.triggerLabels);
  if (triggerLabels.length > 0 && !hasMatchingLabel(labels, triggerLabels)) {
    return {
      accept: false,
      reason: "Issue does not yet match any configured trigger label.",
    };
  }

  const issue: IssueRef = {
    owner: config.owner,
    repo: config.repo,
    number: event.issue.number,
    title: event.issue.title,
    body: event.issue.body,
    labels,
  };

  const policySignals = collectSuitabilityPolicySignals(issue);
  if (policySignals.denylisted) {
    const reasons = [
      ...(policySignals.matchedHighRiskLabels.length > 0
        ? [
            `Issue labels matched denylisted high-risk labels: ${policySignals.matchedHighRiskLabels.join(", ")}.`,
          ]
        : []),
      ...(policySignals.matchedHighRiskKeywords.length > 0
        ? [
            `Issue text references high-risk areas: ${policySignals.matchedHighRiskKeywords.join(", ")}.`,
          ]
        : []),
    ];
    const reason = reasons[0] ?? "Issue matched the denylisted high-risk suitability policy.";
    return {
      accept: true,
      reason: "Issue requires escalation before approval or auto-run.",
      issue,
      precheck: {
        decision: "escalate",
        summary: `Webhook intake precheck escalated the issue before chat approval. ${reason}`,
        reasons,
      },
    };
  }

  return {
    accept: true,
    reason: "Issue should be announced for human approval in chat.",
    issue,
  };
}

export function buildIssueApprovalMessage(params: {
  issue: IssueRef;
  config: OpenClawCodeChatopsRepoConfig;
}): string {
  const { issue, config } = params;
  const issueKey = formatIssueKey(issue);
  const labels = issue.labels && issue.labels.length > 0 ? issue.labels.join(", ") : "none";
  const publicationMode =
    config.openPullRequest === false
      ? "No PR publication"
      : config.mergeOnApprove
        ? "Open PR, verify, and auto-merge when policy allows"
        : "Open PR and stop for review";
  const formatChatCommandWithAlias = (command: string) => {
    if (!command.startsWith("/occode-")) {
      return command;
    }
    const alias = command.replace(/^\/occode-/, "/occ-");
    return `${command} (alias ${alias})`;
  };

  return [
    "openclawcode has a new GitHub issue ready for a decision.",
    `Issue: ${issueKey}`,
    `Title: ${issue.title}`,
    `Labels: ${labels}`,
    `Planned flow: ${publicationMode}`,
    "Reply with one command:",
    formatChatCommandWithAlias(`/occode-start ${issueKey}`),
    formatChatCommandWithAlias(`/occode-skip ${issueKey}`),
    formatChatCommandWithAlias(`/occode-status ${issueKey}`),
  ].join("\n");
}

export function buildIssueEscalationMessage(params: {
  issue: IssueRef;
  summary: string;
  reasons: string[];
}): string {
  const { issue, summary, reasons } = params;
  const issueKey = formatIssueKey(issue);
  const reasonLines = reasons.map((entry) => `- ${entry}`);
  const statusCommand = `/occode-status ${issueKey}`;
  return [
    "openclawcode escalated a new GitHub issue before chat approval.",
    `Issue: ${issueKey}`,
    `Title: ${issue.title}`,
    `Summary: ${summary}`,
    "Reasons:",
    ...reasonLines,
    "Use /occode-status (alias /occ-status) to inspect the tracked status if you later decide to handle it manually.",
    `${statusCommand} (alias ${statusCommand.replace(/^\/occode-/, "/occ-")})`,
  ].join("\n");
}

function parseCommandAction(input: string): OpenClawCodeChatopsCommand["action"] | null {
  const match = /^\/oc(?:code|c)-(start|rerun|skip|status)\b/i.exec(input.trim());
  if (!match) {
    return null;
  }
  return match[1].toLowerCase() as OpenClawCodeChatopsCommand["action"];
}

function parseIssueReference(
  value: string,
  defaults?: { owner?: string; repo?: string },
): OpenClawCodeChatopsCommand["issue"] | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const explicitMatch = /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)#(?<issue>\d+)$/.exec(
    trimmed,
  );
  if (explicitMatch?.groups) {
    return {
      owner: explicitMatch.groups.owner,
      repo: explicitMatch.groups.repo,
      number: Number.parseInt(explicitMatch.groups.issue, 10),
    };
  }

  const simpleMatch = /^#?(?<issue>\d+)$/.exec(trimmed);
  if (!simpleMatch?.groups) {
    return null;
  }
  if (!defaults?.owner || !defaults?.repo) {
    return null;
  }

  return {
    owner: defaults.owner,
    repo: defaults.repo,
    number: Number.parseInt(simpleMatch.groups.issue, 10),
  };
}

export function parseChatopsRepoReference(
  value: string,
  defaults?: { owner?: string; repo?: string },
): OpenClawCodeChatopsRepoRef | null {
  const trimmed = value.trim();
  if (!trimmed) {
    if (!defaults?.owner || !defaults?.repo) {
      return null;
    }
    return {
      owner: defaults.owner,
      repo: defaults.repo,
    };
  }

  const explicitMatch = /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (!explicitMatch?.groups) {
    return null;
  }

  return {
    owner: explicitMatch.groups.owner,
    repo: explicitMatch.groups.repo,
  };
}

export function parseChatopsCommand(
  input: string,
  defaults?: { owner?: string; repo?: string },
): OpenClawCodeChatopsCommand | null {
  const action = parseCommandAction(input);
  if (!action) {
    return null;
  }

  const args = input.trim().replace(/^\/oc(?:code|c)-(start|rerun|skip|status)\s*/i, "");
  const issue = parseIssueReference(args, defaults);
  if (!issue) {
    return null;
  }

  return {
    action,
    issue,
  };
}

export function parseChatopsIssueDraftCommand(
  input: string,
  defaults?: { owner?: string; repo?: string },
): OpenClawCodeChatopsIssueDraftCommand | null {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  const match = /^\/oc(?:code|c)-intake\b/i.exec(normalized);
  if (!match) {
    return null;
  }

  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  const firstLineArgs = firstLine.replace(/^\/oc(?:code|c)-intake\b\s*/i, "").trim();

  let repo = firstLineArgs ? parseChatopsRepoReference(firstLineArgs) : null;
  let draftLines = remainingLines;

  if (!repo) {
    if (!defaults?.owner || !defaults?.repo) {
      return null;
    }
    repo = {
      owner: defaults.owner,
      repo: defaults.repo,
    };
    draftLines = firstLineArgs ? [firstLineArgs, ...remainingLines] : remainingLines;
  }

  const firstContentIndex = draftLines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) {
    return null;
  }

  const title = draftLines[firstContentIndex]?.trim() ?? "";
  const explicitBody = draftLines
    .slice(firstContentIndex + 1)
    .join("\n")
    .trim();
  if (!title) {
    return null;
  }
  const bodySynthesized = explicitBody.length === 0;

  return {
    action: "intake",
    repo,
    draft: {
      title,
      body: explicitBody || buildMinimalChatIssueBody(title),
      bodySynthesized,
      sourceRequest: title,
    },
  };
}

export function buildMinimalChatIssueBody(title: string): string {
  const kind = classifyChatIssueDraftKind(title);
  switch (kind) {
    case "bugfix":
      return [
        "Summary",
        title,
        "",
        "Observed behavior",
        "- Describe what is failing right now.",
        "",
        "Expected behavior",
        "- Describe what should happen instead.",
        "",
        "Reproduction hints",
        "- Smallest reproduction path known so far.",
        "",
        "Regression proof",
        "- Add the proof that should fail before the fix and pass after it.",
        "",
        "Requested from chat intake",
        title,
      ].join("\n");
    case "refactor":
      return [
        "Summary",
        title,
        "",
        "Refactor goal",
        "This issue was drafted directly from chat intake and should clarify the structural improvement before code movement starts.",
        "",
        "Behavior to preserve",
        "- List the externally visible behavior that must stay unchanged.",
        "",
        "Safe checkpoints",
        "- Name the first small checkpoint that should remain working.",
        "",
        "Requested from chat intake",
        title,
      ].join("\n");
    case "research":
      return [
        "Summary",
        title,
        "",
        "Question to answer",
        "This issue was drafted directly from chat intake and should end with a concrete recommendation.",
        "",
        "Evidence to collect",
        "- Name the code path, behavior, or proof to inspect.",
        "",
        "Exit criteria",
        "- State the next executable slice once the investigation finishes.",
        "",
        "Requested from chat intake",
        title,
      ].join("\n");
    default:
      return [
        "Summary",
        title,
        "",
        "Problem to solve",
        "This issue was drafted directly from chat intake and needs the workflow to translate the request into the concrete code change.",
        "",
        "Requested behavior",
        "- Describe the visible outcome that should change.",
        "",
        "Proof of success",
        "- Describe the proof, command, or test that should show the request succeeded.",
        "",
        "Requested from chat intake",
        title,
      ].join("\n");
  }
}

export function deriveScopedChatIssueDrafts(title: string): OpenClawCodeScopedIssueDraft[] {
  const trimmed = title.trim();
  const match = trimmed.match(
    /^(Expose|Add|Document|Clarify|Support|Implement)\s+(.+?)\s+(in|for|on|via|within)\s+(.+)$/i,
  );
  if (!match) {
    return [];
  }

  const verb = match[1] ?? "";
  const subject = match[2] ?? "";
  const preposition = match[3] ?? "";
  const scope = match[4] ?? "";
  const items = subject
    .split(/\s*,\s*|\s+and\s+/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const uniqueItems = [...new Set(items)];
  if (uniqueItems.length < 2 || uniqueItems.length > 4) {
    return [];
  }

  return uniqueItems.map((item) => {
    const scopedTitle = `${verb} ${item} ${preposition} ${scope}`;
    return {
      title: scopedTitle,
      body: buildMinimalChatIssueBody(scopedTitle),
      reason: `Narrow the request to just ${item}.`,
    };
  });
}

export function classifyChatIssueDraftKind(input: string): OpenClawCodeChatIssueDraftKind {
  if (/\b(fix|bug|regression|broken|crash|error|failure)\b/i.test(input)) {
    return "bugfix";
  }
  if (
    /\b(refactor|cleanup|clean up|rename|extract|restructure|reorganize|dedupe|simplify)\b/i.test(
      input,
    )
  ) {
    return "refactor";
  }
  if (/\b(investigate|diagnose|triage|research|spike|explore)\b/i.test(input)) {
    return "research";
  }
  return "feature";
}

function defaultBranchName(issueNumber: number): string {
  return `openclawcode/issue-${issueNumber}`;
}

export function buildRunRequestFromCommand(params: {
  command: OpenClawCodeChatopsCommand;
  config: OpenClawCodeChatopsRepoConfig;
  suitabilityOverride?: {
    actor?: string;
    reason?: string;
  };
  rerunContext?: WorkflowRerunContext;
  runtimeAgentOverrides?: {
    coderAgentId?: string;
    verifierAgentId?: string;
  };
}): OpenClawCodeChatopsRunRequest {
  const { command, config } = params;
  if (
    normalizeValue(command.issue.owner) !== normalizeValue(config.owner) ||
    normalizeValue(command.issue.repo) !== normalizeValue(config.repo)
  ) {
    throw new Error("Chat command repository does not match the configured repository target.");
  }

  return {
    owner: config.owner,
    repo: config.repo,
    issueNumber: command.issue.number,
    repoRoot: config.repoRoot,
    baseBranch: config.baseBranch,
    branchName: defaultBranchName(command.issue.number),
    builderAgent: params.runtimeAgentOverrides?.coderAgentId?.trim() || config.builderAgent,
    verifierAgent: params.runtimeAgentOverrides?.verifierAgentId?.trim() || config.verifierAgent,
    testCommands: [...config.testCommands],
    openPullRequest: config.openPullRequest !== false,
    mergeOnApprove: config.mergeOnApprove === true,
    suitabilityOverride: params.suitabilityOverride
      ? {
          actor: params.suitabilityOverride.actor?.trim() || undefined,
          reason: params.suitabilityOverride.reason?.trim() || undefined,
        }
      : undefined,
    rerunContext: params.rerunContext
      ? {
          ...params.rerunContext,
          requestedCoderAgentId:
            params.runtimeAgentOverrides?.coderAgentId?.trim() ||
            params.rerunContext.requestedCoderAgentId,
          requestedVerifierAgentId:
            params.runtimeAgentOverrides?.verifierAgentId?.trim() ||
            params.rerunContext.requestedVerifierAgentId,
        }
      : undefined,
  };
}

export function buildOpenClawCodeRunArgv(request: OpenClawCodeChatopsRunRequest): string[] {
  const argv = [
    process.execPath,
    path.join(request.repoRoot, "dist", "index.js"),
    "code",
    "run",
    "--issue",
    String(request.issueNumber),
    "--owner",
    request.owner,
    "--repo",
    request.repo,
    "--repo-root",
    request.repoRoot,
    "--base-branch",
    request.baseBranch,
    "--branch-name",
    request.branchName,
    "--builder-agent",
    request.builderAgent,
    "--verifier-agent",
    request.verifierAgent,
  ];

  for (const command of request.testCommands) {
    argv.push("--test", command);
  }

  if (request.openPullRequest) {
    argv.push("--open-pr");
  }
  if (request.mergeOnApprove) {
    argv.push("--merge-on-approve");
  }
  if (request.suitabilityOverride?.actor) {
    argv.push("--suitability-override-actor", request.suitabilityOverride.actor);
  }
  if (request.suitabilityOverride?.reason) {
    argv.push("--suitability-override-reason", request.suitabilityOverride.reason);
  }
  if (request.rerunContext?.priorRunId) {
    argv.push("--rerun-prior-run-id", request.rerunContext.priorRunId);
  }
  if (request.rerunContext?.priorStage) {
    argv.push("--rerun-prior-stage", request.rerunContext.priorStage);
  }
  if (request.rerunContext?.reason) {
    argv.push("--rerun-reason", request.rerunContext.reason);
  }
  if (request.rerunContext?.requestedAt) {
    argv.push("--rerun-requested-at", request.rerunContext.requestedAt);
  }
  if (request.rerunContext?.reviewDecision) {
    argv.push("--rerun-review-decision", request.rerunContext.reviewDecision);
  }
  if (request.rerunContext?.reviewSubmittedAt) {
    argv.push("--rerun-review-submitted-at", request.rerunContext.reviewSubmittedAt);
  }
  if (request.rerunContext?.reviewSummary) {
    argv.push("--rerun-review-summary", request.rerunContext.reviewSummary);
  }
  if (request.rerunContext?.reviewUrl) {
    argv.push("--rerun-review-url", request.rerunContext.reviewUrl);
  }
  if (request.rerunContext?.requestedCoderAgentId) {
    argv.push("--rerun-coder-agent", request.rerunContext.requestedCoderAgentId);
  }
  if (request.rerunContext?.requestedVerifierAgentId) {
    argv.push("--rerun-verifier-agent", request.rerunContext.requestedVerifierAgentId);
  }

  argv.push("--json");
  return argv;
}

export function extractWorkflowRunFromCommandOutput(output: string): WorkflowRun | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  const parseCandidate = (candidate: string): WorkflowRun | null => {
    try {
      return JSON.parse(candidate) as WorkflowRun;
    } catch {
      return null;
    }
  };

  const direct = parseCandidate(trimmed);
  if (direct) {
    return direct;
  }

  const lines = trimmed.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index]?.trim().startsWith("{")) {
      continue;
    }
    const candidate = lines.slice(index).join("\n").trim();
    const parsed = parseCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function formatStageLabel(stage: WorkflowRun["stage"]): string {
  return stage
    .split("-")
    .map((segment) => {
      const upper = segment.toUpperCase();
      return upper === "PR" ? upper : segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" ");
}

function resolveRunSummary(run: WorkflowRun): string {
  if (run.stage === "failed") {
    const failureNote = [...run.history]
      .toReversed()
      .find((entry) => /\bfailed:/i.test(entry.trim()));
    if (failureNote) {
      return failureNote;
    }
  }
  if (run.verificationReport?.summary) {
    return run.verificationReport.summary;
  }
  if (run.buildResult?.summary) {
    return run.buildResult.summary;
  }
  return `Run is currently at stage ${run.stage}.`;
}

function formatWorkflowFailureDiagnostics(
  diagnostics: WorkflowFailureDiagnostics | undefined,
): string | undefined {
  if (!diagnostics) {
    return undefined;
  }

  const modelId =
    diagnostics.provider && diagnostics.model
      ? `${diagnostics.provider}/${diagnostics.model}`
      : (diagnostics.provider ?? diagnostics.model);
  const parts = [
    modelId ? `model=${modelId}` : undefined,
    typeof diagnostics.systemPromptChars === "number"
      ? `prompt=${diagnostics.systemPromptChars}`
      : undefined,
    typeof diagnostics.skillsPromptChars === "number"
      ? `skillsPrompt=${diagnostics.skillsPromptChars}`
      : undefined,
    typeof diagnostics.toolSchemaChars === "number"
      ? `schema=${diagnostics.toolSchemaChars}`
      : undefined,
    typeof diagnostics.toolCount === "number" ? `tools=${diagnostics.toolCount}` : undefined,
    typeof diagnostics.skillCount === "number" ? `skills=${diagnostics.skillCount}` : undefined,
    typeof diagnostics.injectedWorkspaceFileCount === "number"
      ? `files=${diagnostics.injectedWorkspaceFileCount}`
      : undefined,
    typeof diagnostics.lastCallUsageTotal === "number"
      ? `usage=${diagnostics.lastCallUsageTotal}`
      : undefined,
    diagnostics.bootstrapWarningShown === true
      ? "bootstrap=warned"
      : diagnostics.bootstrapWarningShown === false
        ? "bootstrap=clean"
        : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(", ") : trimToSingleLine(diagnostics.summary);
}

export function buildWorkflowFailureDiagnosticLines(params: {
  diagnostics: WorkflowFailureDiagnostics | undefined;
  topLevel?: boolean;
}): string[] {
  const compact = formatWorkflowFailureDiagnostics(params.diagnostics);
  if (!compact) {
    return [];
  }
  return [`${params.topLevel ? "Failure diagnostics" : "  diagnostics"}: ${compact}`];
}

function formatBlueprintStatus(run: WorkflowRun): string | undefined {
  const blueprint = run.blueprintContext;
  if (!blueprint) {
    return undefined;
  }

  const parts = [
    blueprint.status ? `status=${blueprint.status}` : undefined,
    blueprint.revisionId ? `revision=${blueprint.revisionId}` : undefined,
    `agreed=${blueprint.agreed ? "yes" : "no"}`,
    `openQuestions=${blueprint.openQuestionCount}`,
    `humanGates=${blueprint.humanGateCount}`,
  ].filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function formatRoleRoutingStatus(run: WorkflowRun): string | undefined {
  const routing = run.roleRouting;
  if (!routing) {
    return undefined;
  }

  const roleOrder = ["planner", "coder", "reviewer", "verifier", "doc-writer"];
  const roleParts = roleOrder.map((roleId) => {
    const route = routing.routes.find((entry) => entry.roleId === roleId);
    return `${roleId}=${route?.adapterId ?? "unresolved"}`;
  });

  return [
    ...roleParts,
    `mixed=${routing.mixedMode ? "yes" : "no"}`,
    `unresolved=${routing.unresolvedRoleCount}`,
    `fallback=${routing.fallbackConfigured ? "configured" : "none"}`,
  ].join(", ");
}

function resolveStageGateReadiness(run: WorkflowRun, gateId: string): string | undefined {
  return run.stageGates?.gates.find((gate) => gate.gateId === gateId)?.readiness;
}

function formatStageGateStatus(run: WorkflowRun): string | undefined {
  const stageGates = run.stageGates;
  if (!stageGates) {
    return undefined;
  }

  const parts = [
    `blocked=${stageGates.blockedGateCount}`,
    `needsHuman=${stageGates.needsHumanDecisionCount}`,
    resolveStageGateReadiness(run, "goal-agreement")
      ? `goal=${resolveStageGateReadiness(run, "goal-agreement")}`
      : undefined,
    resolveStageGateReadiness(run, "work-item-projection")
      ? `projection=${resolveStageGateReadiness(run, "work-item-projection")}`
      : undefined,
    resolveStageGateReadiness(run, "execution-start")
      ? `execution=${resolveStageGateReadiness(run, "execution-start")}`
      : undefined,
    resolveStageGateReadiness(run, "merge-promotion")
      ? `merge=${resolveStageGateReadiness(run, "merge-promotion")}`
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? parts.join(", ") : undefined;
}

function formatRuntimeRoutingStatus(run: WorkflowRun): string | undefined {
  const selections = run.runtimeRouting?.selections;
  if (!selections || selections.length === 0) {
    return undefined;
  }

  return selections
    .map((selection) =>
      [
        `${selection.roleId}=${selection.appliedAgentId ?? "runner-default"}`,
        selection.adapterId ? `adapter=${selection.adapterId}` : undefined,
        `source=${selection.agentSource}`,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join(" || ");
}

function formatHandoffStatus(run: WorkflowRun): string | undefined {
  const entries = run.handoffs?.entries;
  if (!entries || entries.length === 0) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }

  return [...counts.entries()]
    .toSorted((left, right) => left[0].localeCompare(right[0]))
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
}

export function buildRunStatusMessage(run: WorkflowRun): string {
  const lines = [
    `openclawcode status for ${formatIssueKey(run.issue)}`,
    `Stage: ${formatStageLabel(run.stage)}`,
    `Summary: ${resolveRunSummary(run)}`,
  ];

  if (run.suitability?.decision) {
    lines.push(`Suitability: ${run.suitability.decision}`);
  }

  if (run.suitability?.summary) {
    lines.push(`Suitability summary: ${run.suitability.summary}`);
  }

  const blueprintStatus = formatBlueprintStatus(run);
  if (blueprintStatus) {
    lines.push(`Blueprint: ${blueprintStatus}`);
  }

  const roleRoutingStatus = formatRoleRoutingStatus(run);
  if (roleRoutingStatus) {
    lines.push(`Role routing: ${roleRoutingStatus}`);
  }

  const stageGateStatus = formatStageGateStatus(run);
  if (stageGateStatus) {
    lines.push(`Stage gates: ${stageGateStatus}`);
  }

  const runtimeRoutingStatus = formatRuntimeRoutingStatus(run);
  if (runtimeRoutingStatus) {
    lines.push(`Runtime routing: ${runtimeRoutingStatus}`);
  }

  const handoffStatus = formatHandoffStatus(run);
  if (handoffStatus) {
    lines.push(`Handoffs: ${handoffStatus}`);
  }

  lines.push(...buildWorkflowFailureDiagnosticLines({ diagnostics: run.failureDiagnostics }));

  if (run.draftPullRequest?.url) {
    lines.push(`PR: ${run.draftPullRequest.url}`);
  }

  if (run.verificationReport?.decision) {
    lines.push(`Verification: ${run.verificationReport.decision}`);
  }

  if (run.buildResult?.changedFiles.length) {
    lines.push(`Changed files: ${run.buildResult.changedFiles.join(", ")}`);
  }

  return lines.join("\n");
}
