import path from "node:path";
import process from "node:process";
import type { IssueRef, WorkflowRun } from "../../openclawcode/contracts/index.js";

const SUPPORTED_ISSUE_ACTIONS = new Set(["opened", "reopened", "labeled"]);

export interface GitHubIssueWebhookEvent {
  action: string;
  repository: {
    owner: string;
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

export interface OpenClawCodePluginConfig {
  githubWebhookSecretEnv?: string;
  pollIntervalMs?: number;
  repos: OpenClawCodeChatopsRepoConfig[];
}

export interface ChatopsIssueIntakeDecision {
  accept: boolean;
  reason: string;
  issue?: IssueRef;
}

export interface OpenClawCodeChatopsCommand {
  action: "start" | "skip" | "status";
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
  return (
    normalizeValue(event.repository.owner) === normalizeValue(config.owner) &&
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

  return {
    githubWebhookSecretEnv: readString(pluginConfig?.githubWebhookSecretEnv),
    pollIntervalMs: readPositiveInteger(pluginConfig?.pollIntervalMs),
    repos,
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

  return {
    accept: true,
    reason: "Issue should be announced for human approval in chat.",
    issue: {
      owner: config.owner,
      repo: config.repo,
      number: event.issue.number,
      title: event.issue.title,
      body: event.issue.body,
      labels,
    },
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

  return [
    "openclawcode has a new GitHub issue ready for a decision.",
    `Issue: ${issueKey}`,
    `Title: ${issue.title}`,
    `Labels: ${labels}`,
    `Planned flow: ${publicationMode}`,
    "Reply with one command:",
    `/occode-start ${issueKey}`,
    `/occode-skip ${issueKey}`,
    `/occode-status ${issueKey}`,
  ].join("\n");
}

function parseCommandAction(input: string): OpenClawCodeChatopsCommand["action"] | null {
  const match = /^\/occode-(start|skip|status)\b/i.exec(input.trim());
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

  const args = input.trim().replace(/^\/occode-(start|skip|status)\s*/i, "");
  const issue = parseIssueReference(args, defaults);
  if (!issue) {
    return null;
  }

  return {
    action,
    issue,
  };
}

function defaultBranchName(issueNumber: number): string {
  return `openclawcode/issue-${issueNumber}`;
}

export function buildRunRequestFromCommand(params: {
  command: OpenClawCodeChatopsCommand;
  config: OpenClawCodeChatopsRepoConfig;
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
    builderAgent: config.builderAgent,
    verifierAgent: config.verifierAgent,
    testCommands: [...config.testCommands],
    openPullRequest: config.openPullRequest !== false,
    mergeOnApprove: config.mergeOnApprove === true,
  };
}

export function buildOpenClawCodeRunArgv(request: OpenClawCodeChatopsRunRequest): string[] {
  const argv = [
    process.execPath,
    path.join(request.repoRoot, "scripts/run-node.mjs"),
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
  if (run.verificationReport?.summary) {
    return run.verificationReport.summary;
  }
  if (run.buildResult?.summary) {
    return run.buildResult.summary;
  }
  return `Run is currently at stage ${run.stage}.`;
}

export function buildRunStatusMessage(run: WorkflowRun): string {
  const lines = [
    `openclawcode status for ${formatIssueKey(run.issue)}`,
    `Stage: ${formatStageLabel(run.stage)}`,
    `Summary: ${resolveRunSummary(run)}`,
  ];

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
