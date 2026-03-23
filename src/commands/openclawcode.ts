import * as childProcess from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import * as net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatCliCommand } from "../cli/command-format.js";
import {
  OpenClawCodeChatopsStore,
  buildRunRequestFromCommand,
  formatIssueKey,
  formatRepoKey,
  resolveOpenClawCodePluginConfig,
  type OpenClawCodeChatopsRepoConfig,
  type OpenClawCodeIssueStatusSnapshot,
  type OpenClawCodeRepoNotificationBinding,
} from "../integrations/openclaw-plugin/index.js";
import { discoverPreferredOperatorChatTarget } from "../operator-chat-targets/store.js";
import {
  createProjectBlueprint,
  inspectProjectBlueprintClarifications,
  parseProjectBlueprintRoleId,
  parseProjectBlueprintSectionName,
  parseProjectBlueprintStatus,
  projectBlueprintRoleIds,
  projectBlueprintSectionIds,
  projectBlueprintStatusIds,
  readProjectBlueprint,
  updateProjectBlueprintSection,
  updateProjectBlueprintProviderRole,
  updateProjectBlueprintStatus,
  type ProjectBlueprintStatus,
} from "../openclawcode/blueprint.js";
import type {
  ExecutionSpec,
  ProjectRuntimeSteeringStageId,
  WorkflowRerunContext,
  WorkflowRun,
} from "../openclawcode/index.js";
import {
  assessValidationIssueImplementation,
  buildOperatorProgramSummary,
  buildOpenClawCodeCapabilityMapSnapshot,
  classifyValidationIssue,
  FileSystemWorkflowRunStore,
  buildValidationIssueDraft,
  GitHubPullRequestMerger,
  GitHubPullRequestPublisher,
  GitHubRestClient,
  GitWorktreeManager,
  HeuristicPlanner,
  HostShellRunner,
  listValidationIssueTemplates,
  listValidationPoolMinimumTargets,
  OpenClawAgentRunner,
  parseValidationIssue,
  AgentBackedBuilder,
  AgentBackedVerifier,
  createProjectOperatorProgram,
  readProjectDiscoveryInventory,
  readProjectIssueMaterializationArtifact,
  readProjectOperatorProgram,
  readProjectRuntimeSteeringArtifact,
  readProjectRoleRoutingPlan,
  readProjectPromotionGateArtifact,
  readProjectPromotionReceiptArtifact,
  readOpenClawCodeOperatorStatusSnapshot,
  readProjectProgressArtifact,
  readProjectNextWorkSelection,
  readProjectRollbackReceiptArtifact,
  readProjectRollbackSuggestionArtifact,
  readProjectStageGateArtifact,
  readProjectAutonomousLoopArtifact,
  deriveWorkflowQualityGate,
  deriveWorkflowPreCodeDiscipline,
  deriveWorkflowLoopHealth,
  readProjectWorkItemInventory,
  recordProjectStageGateDecision,
  resolveGitHubRepoFromGit,
  runIssueWorkflow,
  type ValidationIssueTemplateId,
  parseProjectStageGateDecisionId,
  parseProjectStageGateId,
  projectStageGateDecisionIds,
  projectStageGateIds,
  writeProjectStageGateArtifact,
  writeProjectDiscoveryInventory,
  writeProjectPromotionGateArtifact,
  writeProjectPromotionReceiptArtifact,
  writeProjectRollbackReceiptArtifact,
  writeProjectRollbackSuggestionArtifact,
  writeProjectRoleRoutingPlan,
  writeProjectIssueMaterializationArtifact,
  writeProjectProgressArtifact,
  writeProjectNextWorkSelection,
  writeProjectWorkItemInventory,
  writeProjectWorkItemInventoryWithDiscoveredItems,
  runProjectAutonomousLoop,
  buildOpenClawCodePolicySnapshot,
  resolveAutoMergeDisposition,
  resolveAutoMergePolicy,
  type OpenClawCodeOperatorStatusSnapshot,
  recordProjectRuntimeSteeringOverride,
  projectRuntimeSteeringStageIds,
  resolveValidationPoolDeficits,
} from "../openclawcode/index.js";
import { isConcreteChatNotifyTarget } from "../openclawcode/operator-chat-targets.js";
import type { RuntimeEnv } from "../runtime.js";

export interface OpenClawCodeRunOpts {
  issue: string;
  owner?: string;
  repo?: string;
  repoRoot?: string;
  stateDir?: string;
  baseBranch?: string;
  branchName?: string;
  builderAgent?: string;
  verifierAgent?: string;
  test?: string[];
  openPr?: boolean;
  mergeOnApprove?: boolean;
  requirePlanApproval?: boolean;
  approvePlanDigest?: string;
  planApprovalActor?: string;
  planApprovalNote?: string;
  planEditFile?: string;
  planEditActor?: string;
  planEditNote?: string;
  rerunPriorRunId?: string;
  rerunPriorStage?: WorkflowRun["stage"];
  rerunReason?: string;
  rerunRequestedAt?: string;
  rerunReviewDecision?: "approved" | "changes-requested";
  rerunReviewSubmittedAt?: string;
  rerunReviewSummary?: string;
  rerunReviewUrl?: string;
  rerunRequestedCoderAgentId?: string;
  rerunRequestedVerifierAgentId?: string;
  suitabilityOverrideActor?: string;
  suitabilityOverrideReason?: string;
  json?: boolean;
}

export interface OpenClawCodeRerouteRunOpts {
  issue: string;
  owner?: string;
  repo?: string;
  repoRoot?: string;
  stateDir?: string;
  coderAgent?: string;
  verifierAgent?: string;
  actor?: string;
  note?: string;
  json?: boolean;
}

export type OpenClawCodeBootstrapMode = "auto" | "cli-only" | "chatops";

export interface OpenClawCodeBootstrapOpts {
  repo: string;
  repoRoot?: string;
  stateDir?: string;
  mode?: OpenClawCodeBootstrapMode;
  channel?: string;
  chatTarget?: string;
  webhookUrl?: string;
  baseBranch?: string;
  builderAgent?: string;
  verifierAgent?: string;
  test?: string[];
  configureWebhook?: boolean;
  startGateway?: boolean;
  startTunnel?: boolean;
  probeBuiltStartup?: boolean;
  json?: boolean;
}

export interface OpenClawCodeRepoPlanOpts {
  owner?: string;
  project?: string;
  repo?: string;
  existing?: boolean;
  create?: boolean;
  visibility?: "public" | "private";
  description?: string;
  limit?: number;
  json?: boolean;
}

export interface OpenClawCodeSeedValidationIssueOpts {
  template?: ValidationIssueTemplateId;
  owner?: string;
  repo?: string;
  repoRoot?: string;
  fieldName?: string;
  sourcePath?: string;
  docPath?: string;
  summary?: string;
  balanced?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface OpenClawCodeListValidationIssuesOpts {
  owner?: string;
  repo?: string;
  repoRoot?: string;
  state?: "open" | "closed" | "all";
  json?: boolean;
}

export interface OpenClawCodeReconcileValidationIssuesOpts {
  owner?: string;
  repo?: string;
  repoRoot?: string;
  closeImplemented?: boolean;
  enforceMinimumPoolSize?: boolean;
  json?: boolean;
}

export interface OpenClawCodeBlueprintInitOpts {
  repoRoot?: string;
  title?: string;
  goal?: string;
  force?: boolean;
  json?: boolean;
}

export interface OpenClawCodeBlueprintShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeBlueprintSetStatusOpts {
  repoRoot?: string;
  status: string;
  json?: boolean;
}

export interface OpenClawCodeBlueprintSetProviderRoleOpts {
  repoRoot?: string;
  role: string;
  provider?: string;
  clear?: boolean;
  json?: boolean;
}

export interface OpenClawCodeBlueprintSetSectionOpts {
  repoRoot?: string;
  section: string;
  body: string;
  append?: boolean;
  createIfMissing?: boolean;
  json?: boolean;
}

export interface OpenClawCodeBlueprintClarifyOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeBlueprintDecomposeOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeWorkItemsShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeDiscoverWorkItemsOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeRoleRoutingRefreshOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeRoleRoutingShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeStageGatesRefreshOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeRuntimeSteeringShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeRuntimeSteeringSetOpts {
  repoRoot?: string;
  stage: string;
  adapter?: string;
  agent?: string;
  actor?: string;
  note?: string;
  clear?: boolean;
  json?: boolean;
}

export interface OpenClawCodeStageGatesShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeNextWorkShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeIssueMaterializeOpts {
  owner?: string;
  repo?: string;
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeIssueMaterializationShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeProjectProgressShowOpts {
  owner?: string;
  repo?: string;
  repoRoot?: string;
  stateDir?: string;
  json?: boolean;
}

export interface OpenClawCodeOperatorProgramInitOpts {
  repoRoot?: string;
  title?: string;
  summary?: string;
  force?: boolean;
  json?: boolean;
}

export interface OpenClawCodeOperatorProgramShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeAutonomousLoopRunOpts {
  owner?: string;
  repo?: string;
  repoRoot?: string;
  stateDir?: string;
  once?: boolean;
  iterations?: number;
  json?: boolean;
}

export interface OpenClawCodeAutonomousLoopShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeStageGatesDecideOpts {
  repoRoot?: string;
  gate: string;
  decision: string;
  actor?: string;
  note?: string;
  json?: boolean;
}

export interface OpenClawCodePromotionGateRefreshOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodePromotionGateShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeRollbackSuggestionRefreshOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeRollbackSuggestionShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodePromotionReceiptRecordOpts {
  repoRoot?: string;
  actor?: string;
  note?: string;
  promotedBranch?: string;
  promotedCommitSha?: string;
  json?: boolean;
}

export interface OpenClawCodePromotionReceiptShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeRollbackReceiptRecordOpts {
  repoRoot?: string;
  actor?: string;
  note?: string;
  restoredBranch?: string;
  restoredCommitSha?: string;
  json?: boolean;
}

export interface OpenClawCodeRollbackReceiptShowOpts {
  repoRoot?: string;
  json?: boolean;
}

export interface OpenClawCodeOperatorStatusSnapshotShowOpts {
  stateDir?: string;
  json?: boolean;
}

export interface OpenClawCodeCapabilityMapShowOpts {
  json?: boolean;
}

export interface OpenClawCodePolicyShowOpts {
  json?: boolean;
}

export const OPENCLAWCODE_RUN_JSON_CONTRACT_VERSION = 1;
export const OPENCLAWCODE_REROUTE_RUN_JSON_CONTRACT_VERSION = 1;
export const OPENCLAWCODE_VALIDATION_POOL_CONTRACT_VERSION = 1;
export const DEFAULT_OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS = 300;
export const DEFAULT_OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS = 180;

const OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS_ENV = "OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS";
const OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS_ENV = "OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS";

interface ValidationIssueAssessmentContext {
  commandJsonSource?: string;
  commandJsonTests?: string;
  runJsonContractDoc?: string;
}

interface ValidationIssueInventoryEntry {
  issueNumber: number;
  title: string;
  url: string;
  state: "open" | "closed";
  createdAt: string | null;
  updatedAt: string | null;
  ageDays: number | null;
  template: ValidationIssueTemplateId;
  issueClass: "command-layer" | "operator-docs" | "high-risk-validation";
  fieldName: string | null;
  implementationState: "implemented" | "pending" | "manual-review";
  implementationSummary: string;
  autoClosable: boolean;
}

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--issue must be a positive integer");
  }
  return parsed;
}

function resolvePositiveTimeoutSeconds(params: { envName: string; fallback: number }): number {
  const raw = process.env[params.envName]?.trim();
  if (!raw) {
    return params.fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${params.envName} must be a positive integer when set.`);
  }
  return parsed;
}

async function resolveRepoRef(params: {
  owner?: string;
  repo?: string;
  repoRoot: string;
}): Promise<{ owner: string; repo: string }> {
  if (params.owner && params.repo) {
    return { owner: params.owner, repo: params.repo };
  }
  return await resolveGitHubRepoFromGit(params.repoRoot);
}

function normalizeRepoKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

async function resolveOperatorRepoConfig(params: {
  operatorStateDir: string;
  repoRoot: string;
  repoRef: {
    owner: string;
    repo: string;
  };
}): Promise<OpenClawCodeChatopsRepoConfig | null> {
  const configPath = path.join(params.operatorStateDir, "openclaw.json");
  const rawConfig = await readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!rawConfig) {
    return null;
  }

  const parsed = JSON.parse(rawConfig) as {
    plugins?: {
      openclawcode?: Record<string, unknown>;
      entries?: {
        openclawcode?: {
          config?: Record<string, unknown>;
        };
      };
    };
  };
  const pluginConfig =
    parsed.plugins?.entries?.openclawcode?.config ?? parsed.plugins?.openclawcode;
  const resolved = resolveOpenClawCodePluginConfig(pluginConfig);
  const normalizedRepoRoot = path.resolve(params.repoRoot);

  return (
    resolved.repos.find(
      (entry) =>
        normalizeRepoKeyPart(entry.owner) === normalizeRepoKeyPart(params.repoRef.owner) &&
        normalizeRepoKeyPart(entry.repo) === normalizeRepoKeyPart(params.repoRef.repo) &&
        path.resolve(entry.repoRoot) === normalizedRepoRoot,
    ) ??
    resolved.repos.find(
      (entry) =>
        normalizeRepoKeyPart(entry.owner) === normalizeRepoKeyPart(params.repoRef.owner) &&
        normalizeRepoKeyPart(entry.repo) === normalizeRepoKeyPart(params.repoRef.repo),
    ) ??
    null
  );
}

async function readCliExecutionStartGate(repoRoot: string): Promise<
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

async function queueCliAutonomousLoopIssueExecution(params: {
  operatorStateDir: string;
  repoConfig: OpenClawCodeChatopsRepoConfig;
  issueNumber: number;
  queuedStatus: string;
  gatedStatus?: string;
}): Promise<{ outcome: "queued" | "gated" | "already-tracked"; issueKey: string | null }> {
  const store = OpenClawCodeChatopsStore.fromStateDir(params.operatorStateDir);
  const issueKey = `${params.repoConfig.owner}/${params.repoConfig.repo}#${params.issueNumber}`;
  const executionStartGate = await readCliExecutionStartGate(params.repoConfig.repoRoot);
  if (executionStartGate && executionStartGate.gate.readiness !== "ready") {
    const held = await store.upsertPendingApproval(
      {
        issueKey,
        notifyChannel: params.repoConfig.notifyChannel,
        notifyTarget: params.repoConfig.notifyTarget,
        approvalKind: "execution-start-gated",
      },
      params.gatedStatus ?? "Awaiting execution-start gate approval.",
    );
    return {
      outcome: held === "already-tracked" ? "already-tracked" : "gated",
      issueKey,
    };
  }

  const queued = await store.promotePendingApprovalToQueue({
    issueKey,
    request: buildRunRequestFromCommand({
      command: {
        action: "start",
        issue: {
          owner: params.repoConfig.owner,
          repo: params.repoConfig.repo,
          number: params.issueNumber,
        },
      },
      config: params.repoConfig,
    }),
    fallbackNotifyChannel: params.repoConfig.notifyChannel,
    fallbackNotifyTarget: params.repoConfig.notifyTarget,
    status: params.queuedStatus,
  });
  if (!queued) {
    return {
      outcome: "already-tracked",
      issueKey,
    };
  }
  return {
    outcome: "queued",
    issueKey: queued.issueKey,
  };
}

const OPENCLAWCODE_BOOTSTRAP_CONTRACT_VERSION = 1;
const DEFAULT_OPENCLAWCODE_BOOTSTRAP_NOTIFY_CHANNEL = "bootstrap";
const DEFAULT_OPENCLAWCODE_BOOTSTRAP_TRIGGER_MODE = "approve";
const DEFAULT_OPENCLAWCODE_BOOTSTRAP_BUILDER_AGENT = "main";
const DEFAULT_OPENCLAWCODE_BOOTSTRAP_VERIFIER_AGENT = "main";
const DEFAULT_OPENCLAWCODE_BOOTSTRAP_HOOK_EVENTS = "issues,pull_request,pull_request_review";
const DEFAULT_OPENCLAWCODE_BOOTSTRAP_GATEWAY_PORT = 18789;
const DEFAULT_OPENCLAWCODE_BOOTSTRAP_WEBHOOK_ROUTE = "/plugins/openclawcode/github";
const DEFAULT_OPENCLAWCODE_BOOTSTRAP_TUNNEL_LOG_FILE = "/tmp/openclawcode-webhook-tunnel.log";

interface BootstrapSetupCheckPayload {
  ok: boolean;
  strict: boolean;
  repoRoot: string;
  operatorRoot: string;
  readiness: {
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
  pluginActivation?: {
    ready: boolean;
    pluginsEnabled: boolean;
    allowlisted: boolean;
    entryEnabled: boolean;
  };
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  checks?: Array<{
    status: string;
    message: string;
  }>;
}

interface BootstrapTunnelResult {
  action: "started" | "already-running" | "failed" | "skipped";
  url: string | null;
  error: string | null;
}

type BootstrapNotifyBindingMode =
  | "explicit"
  | "existing-config"
  | "auto-discovered"
  | "chat-placeholder"
  | "cli-placeholder";

interface BootstrapHandoffPlan {
  recommendedProofMode: "cli-only" | "chatops";
  reason: string;
  operatorStatusCommand: string;
  cliRunCommand: string;
  blueprintCommand: string;
  blueprintClarifyCommand: string;
  blueprintAgreeCommand: string;
  blueprintDecomposeCommand: string;
  gatesCommand: string;
  gatewayRestartCommand: string;
  pluginActivationRepairCommand: string | null;
  chatSetupCommand: string | null;
  chatSetupStatusCommand: string | null;
  chatBindCommand: string | null;
  chatStartCommand: string | null;
  webhookRetryCommand: string | null;
}

interface BootstrapProofReadiness {
  cliProofReady: boolean;
  chatProofReady: boolean;
  chatSetupRoutingReady: boolean;
  webhookReady: boolean;
  webhookUrlReady: boolean;
  needsChatBind: boolean;
  needsPublicWebhookUrl: boolean;
  recommendedProofMode: "cli-only" | "chatops";
}

interface ResolvedGitHubToken {
  token: string;
  source: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token";
}

function parseBootstrapRepoRef(value: string): { owner: string; repo: string } {
  const trimmed = value.trim();
  const parts = trimmed
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`--repo must be in owner/repo form. Received: ${value}`);
  }
  return {
    owner: parts[0],
    repo: parts[1],
  };
}

function resolveOpenClawCodeOperatorRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function isDirectoryEmpty(targetPath: string): Promise<boolean> {
  const entries = await readdir(targetPath);
  return entries.length === 0;
}

function buildGitHubRepoUrl(repoRef: { owner: string; repo: string }): string {
  return `https://github.com/${repoRef.owner}/${repoRef.repo}.git`;
}

function buildGitHubExtraHeader(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return `AUTHORIZATION: basic ${basic}`;
}

function resolveGitHubTokenFromEnvOrGhCli(): ResolvedGitHubToken | null {
  const ghToken = process.env.GH_TOKEN?.trim();
  if (ghToken) {
    return { token: ghToken, source: "GH_TOKEN" };
  }
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  if (githubToken) {
    return { token: githubToken, source: "GITHUB_TOKEN" };
  }
  const result = childProcess.spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    const token = result.stdout.trim();
    if (token) {
      return { token, source: "gh-auth-token" };
    }
  }
  return null;
}

function slugifyRepoNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildRepoNameSuggestions(projectText: string): string[] {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "app",
    "application",
    "build",
    "for",
    "in",
    "of",
    "platform",
    "project",
    "service",
    "system",
    "the",
    "to",
    "tool",
  ]);
  const rawWords = projectText
    .split(/[^A-Za-z0-9]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const words = rawWords.filter((entry) => !stopWords.has(entry));
  const seedWords = (words.length > 0 ? words : rawWords).slice(0, 4);
  const base = slugifyRepoNamePart(seedWords.join("-")) || "new-project";
  const suggestions = [base];
  const suffixes = ["app", "web", "service", "workspace"];
  for (const suffix of suffixes) {
    if (!base.endsWith(`-${suffix}`) && base !== suffix) {
      suggestions.push(`${base}-${suffix}`);
    }
  }
  return [...new Set(suggestions)].slice(0, 5);
}

function runGitCommand(params: {
  cwd?: string;
  args: string[];
  token?: string;
  allowFailure?: boolean;
}): string | null {
  const args = params.token
    ? ["-c", `http.extraHeader=${buildGitHubExtraHeader(params.token)}`, ...params.args]
    : params.args;
  const result = childProcess.spawnSync("git", args, {
    cwd: params.cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (params.allowFailure) {
      return null;
    }
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(
      detail
        ? `git ${params.args.join(" ")} failed: ${detail}`
        : `git ${params.args.join(" ")} failed`,
    );
  }
  const stdout = result.stdout.trim();
  return stdout.length > 0 ? stdout : null;
}

async function resolveBootstrapRepoRoot(params: {
  requestedRepoRoot?: string;
  repoRef: {
    owner: string;
    repo: string;
  };
}): Promise<{
  repoRoot: string;
  selection:
    | "explicit"
    | "existing-operator-config"
    | "current-working-tree"
    | "default-repo-name"
    | "existing-default-repo-name"
    | "owner-prefixed-repo-name";
}> {
  if (params.requestedRepoRoot) {
    return {
      repoRoot: path.resolve(params.requestedRepoRoot),
      selection: "explicit",
    };
  }

  const cwd = path.resolve(process.cwd());
  try {
    const currentRepo = await resolveGitHubRepoFromGit(cwd);
    if (
      normalizeRepoKeyPart(currentRepo.owner) === normalizeRepoKeyPart(params.repoRef.owner) &&
      normalizeRepoKeyPart(currentRepo.repo) === normalizeRepoKeyPart(params.repoRef.repo)
    ) {
      return {
        repoRoot: cwd,
        selection: "current-working-tree",
      };
    }
  } catch {
    // Ignore non-repository working directories.
  }

  const defaultRoot = path.join(os.homedir(), "pros", params.repoRef.repo);
  if (!(await pathExists(defaultRoot))) {
    return {
      repoRoot: defaultRoot,
      selection: "default-repo-name",
    };
  }
  try {
    const defaultRepo = await resolveGitHubRepoFromGit(defaultRoot);
    if (
      normalizeRepoKeyPart(defaultRepo.owner) === normalizeRepoKeyPart(params.repoRef.owner) &&
      normalizeRepoKeyPart(defaultRepo.repo) === normalizeRepoKeyPart(params.repoRef.repo)
    ) {
      return {
        repoRoot: defaultRoot,
        selection: "existing-default-repo-name",
      };
    }
  } catch {
    // Fall through to owner-prefixed root when the default path is occupied by another checkout.
  }

  return {
    repoRoot: path.join(os.homedir(), "pros", `${params.repoRef.owner}-${params.repoRef.repo}`),
    selection: "owner-prefixed-repo-name",
  };
}

async function ensureBootstrapRepoCheckout(params: {
  repoRoot: string;
  repoRef: {
    owner: string;
    repo: string;
  };
  token: string;
}): Promise<{
  action: "cloned" | "attached";
  remoteUrl: string;
}> {
  const repoRoot = path.resolve(params.repoRoot);
  const remoteUrl = buildGitHubRepoUrl(params.repoRef);
  const exists = await pathExists(repoRoot);

  if (!exists) {
    await mkdir(path.dirname(repoRoot), { recursive: true });
    runGitCommand({
      args: ["clone", remoteUrl, repoRoot],
      token: params.token,
    });
  } else {
    try {
      const existingRepo = await resolveGitHubRepoFromGit(repoRoot);
      if (
        normalizeRepoKeyPart(existingRepo.owner) !== normalizeRepoKeyPart(params.repoRef.owner) ||
        normalizeRepoKeyPart(existingRepo.repo) !== normalizeRepoKeyPart(params.repoRef.repo)
      ) {
        throw new Error(
          `Existing checkout at ${repoRoot} points to ${existingRepo.owner}/${existingRepo.repo}, not ${params.repoRef.owner}/${params.repoRef.repo}.`,
        );
      }
      return {
        action: "attached",
        remoteUrl,
      };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("points to")) {
        const targetStat = await stat(repoRoot);
        if (!targetStat.isDirectory()) {
          throw new Error(`Bootstrap target root is not a directory: ${repoRoot}`, {
            cause: error,
          });
        }
        if (!(await isDirectoryEmpty(repoRoot))) {
          throw new Error(
            `Bootstrap target root exists but is not a matching git checkout: ${repoRoot}`,
            { cause: error },
          );
        }
        runGitCommand({
          args: ["clone", remoteUrl, repoRoot],
          token: params.token,
        });
      } else {
        throw error;
      }
    }
  }

  const verified = await resolveGitHubRepoFromGit(repoRoot);
  if (
    normalizeRepoKeyPart(verified.owner) !== normalizeRepoKeyPart(params.repoRef.owner) ||
    normalizeRepoKeyPart(verified.repo) !== normalizeRepoKeyPart(params.repoRef.repo)
  ) {
    throw new Error(
      `Cloned checkout at ${repoRoot} resolved to ${verified.owner}/${verified.repo}, not ${params.repoRef.owner}/${params.repoRef.repo}.`,
    );
  }
  return {
    action: "cloned",
    remoteUrl,
  };
}

function resolveBootstrapBaseBranch(repoRoot: string, explicitBaseBranch?: string): string {
  const trimmed = explicitBaseBranch?.trim();
  if (trimmed) {
    return trimmed;
  }
  const remoteHead = runGitCommand({
    cwd: repoRoot,
    args: ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    allowFailure: true,
  });
  if (remoteHead?.startsWith("origin/")) {
    return remoteHead.slice("origin/".length);
  }
  for (const candidate of ["main", "master"]) {
    const exists = runGitCommand({
      cwd: repoRoot,
      args: ["rev-parse", "--verify", `refs/heads/${candidate}`],
      allowFailure: true,
    });
    if (exists) {
      return candidate;
    }
  }
  return (
    runGitCommand({
      cwd: repoRoot,
      args: ["branch", "--show-current"],
      allowFailure: true,
    }) ?? "main"
  );
}

async function detectBootstrapTestCommands(repoRoot: string): Promise<{
  commands: string[];
  source:
    | "explicit"
    | "existing-config"
    | "empty-repo-blueprint"
    | "vitest-openclawcode"
    | "package-manager"
    | "go"
    | "cargo"
    | "pytest";
}> {
  const openclawVitestConfig = path.join(repoRoot, "vitest.openclawcode.config.mjs");
  if (await pathExists(openclawVitestConfig)) {
    return {
      commands: [
        "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1",
      ],
      source: "vitest-openclawcode",
    };
  }

  const packageJsonPath = path.join(repoRoot, "package.json");
  if (await pathExists(packageJsonPath)) {
    const rawPackageJson = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(rawPackageJson) as {
      scripts?: {
        test?: string;
      };
    };
    if (typeof packageJson.scripts?.test === "string" && packageJson.scripts.test.trim()) {
      if (await pathExists(path.join(repoRoot, "pnpm-lock.yaml"))) {
        return { commands: ["pnpm test"], source: "package-manager" };
      }
      if (await pathExists(path.join(repoRoot, "yarn.lock"))) {
        return { commands: ["yarn test"], source: "package-manager" };
      }
      return { commands: ["npm test"], source: "package-manager" };
    }
  }

  if (await pathExists(path.join(repoRoot, "go.mod"))) {
    return { commands: ["go test ./..."], source: "go" };
  }
  if (await pathExists(path.join(repoRoot, "Cargo.toml"))) {
    return { commands: ["cargo test"], source: "cargo" };
  }
  if (
    (await pathExists(path.join(repoRoot, "pyproject.toml"))) ||
    (await pathExists(path.join(repoRoot, "pytest.ini")))
  ) {
    return { commands: ["pytest"], source: "pytest" };
  }

  const trackedFiles = runGitCommand({
    cwd: repoRoot,
    args: ["ls-files"],
    allowFailure: true,
  });
  if (!trackedFiles) {
    const repoEntries = await readdir(repoRoot);
    const meaningfulEntries = repoEntries.filter((entry) => {
      if (entry === ".git" || entry === ".github") {
        return false;
      }
      if (entry.startsWith(".")) {
        return false;
      }
      const normalized = entry.toLowerCase();
      if (normalized.startsWith("readme") || normalized.startsWith("license")) {
        return false;
      }
      return true;
    });
    if (meaningfulEntries.length === 0) {
      return {
        commands: [],
        source: "empty-repo-blueprint",
      };
    }
  }

  throw new Error(
    `Unable to infer test commands for ${repoRoot}. Pass --test explicitly so bootstrap can persist a safe repo config.`,
  );
}

function resolveBootstrapMode(params: {
  requestedMode?: OpenClawCodeBootstrapMode;
  channel?: string;
  chatTarget?: string;
}): "cli-only" | "chatops" {
  if (params.requestedMode && params.requestedMode !== "auto") {
    return params.requestedMode;
  }
  return params.channel && params.chatTarget ? "chatops" : "cli-only";
}

function shellQuoteEnvValue(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellQuoteArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseEnvLineValue(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length) : trimmed;
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(withoutExport);
  if (!match) {
    return null;
  }
  let value = match[2] ?? "";
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

async function writeBootstrapEnvFile(params: {
  envFilePath: string;
  repoKey: string;
  token: string;
  hookId?: number | null;
}): Promise<{
  created: boolean;
  updatedKeys: string[];
  webhookSecretGenerated: boolean;
  values: Record<string, string>;
}> {
  const exists = await pathExists(params.envFilePath);
  const original = exists ? await readFile(params.envFilePath, "utf8") : "";
  const lines = original ? original.replace(/\r\n/g, "\n").split("\n") : [];
  const webhookSecretLine = lines.find((line) =>
    /^\s*(export\s+)?OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=/.test(line),
  );
  const existingWebhookSecret = webhookSecretLine ? parseEnvLineValue(webhookSecretLine) : null;
  const desiredValues = new Map<string, string>([
    ["GH_TOKEN", params.token],
    [
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET",
      existingWebhookSecret || randomBytes(32).toString("hex"),
    ],
    ["OPENCLAWCODE_GITHUB_REPO", params.repoKey],
    ["OPENCLAWCODE_GITHUB_HOOK_EVENTS", DEFAULT_OPENCLAWCODE_BOOTSTRAP_HOOK_EVENTS],
  ]);
  if (params.hookId != null) {
    desiredValues.set("OPENCLAWCODE_GITHUB_HOOK_ID", String(params.hookId));
  }

  const updatedKeys: string[] = [];
  const nextLines = [...lines];
  for (const [key, value] of desiredValues.entries()) {
    const rendered = `export ${key}=${shellQuoteEnvValue(value)}`;
    const index = nextLines.findIndex((line) => new RegExp(`^\\s*(export\\s+)?${key}=`).test(line));
    if (index >= 0) {
      if (nextLines[index] !== rendered) {
        nextLines[index] = rendered;
        updatedKeys.push(key);
      }
      continue;
    }
    nextLines.push(rendered);
    updatedKeys.push(key);
  }

  await mkdir(path.dirname(params.envFilePath), { recursive: true });
  const body = `${nextLines.filter((line, index, source) => !(index === source.length - 1 && line === "")).join("\n")}\n`;
  await writeFile(params.envFilePath, body, "utf8");
  return {
    created: !exists,
    updatedKeys,
    webhookSecretGenerated: !existingWebhookSecret,
    values: Object.fromEntries(desiredValues),
  };
}

function normalizeBootstrapWebhookUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("Bootstrap webhook URL cannot be empty.");
  }
  const parsed = new URL(trimmed);
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error(`Bootstrap webhook URL must be http or https. Received: ${trimmed}`);
  }
  if (
    parsed.pathname === "/" ||
    parsed.pathname === "" ||
    parsed.pathname === "/index.html" ||
    parsed.pathname.endsWith(".trycloudflare.com")
  ) {
    parsed.pathname = DEFAULT_OPENCLAWCODE_BOOTSTRAP_WEBHOOK_ROUTE;
    parsed.search = "";
    parsed.hash = "";
  }
  if (parsed.pathname === DEFAULT_OPENCLAWCODE_BOOTSTRAP_WEBHOOK_ROUTE) {
    parsed.search = "";
    parsed.hash = "";
  }
  return parsed.toString().replace(/\/$/, "");
}

async function resolveBootstrapWebhookUrl(params: {
  explicitWebhookUrl?: string;
  operatorStateDir: string;
}): Promise<{
  url: string | null;
  source: "explicit" | "env" | "tunnel-log" | null;
}> {
  const explicit = params.explicitWebhookUrl?.trim();
  if (explicit) {
    return {
      url: normalizeBootstrapWebhookUrl(explicit),
      source: "explicit",
    };
  }

  const envValue = process.env.OPENCLAWCODE_BOOTSTRAP_WEBHOOK_URL?.trim();
  if (envValue) {
    return {
      url: normalizeBootstrapWebhookUrl(envValue),
      source: "env",
    };
  }

  const operatorTunnelLog = path.join(params.operatorStateDir, "openclawcode-webhook-tunnel.log");
  for (const logFile of [
    process.env.OPENCLAWCODE_TUNNEL_LOG_FILE?.trim(),
    operatorTunnelLog,
    DEFAULT_OPENCLAWCODE_BOOTSTRAP_TUNNEL_LOG_FILE,
  ]) {
    if (!logFile) {
      continue;
    }
    const raw = await readFile(logFile, "utf8").catch(() => null);
    if (!raw) {
      continue;
    }
    const matches = [...raw.matchAll(/https:\/\/[a-z0-9.-]+\.trycloudflare\.com/gi)];
    const baseUrl = matches.at(-1)?.[0]?.trim();
    if (!baseUrl) {
      continue;
    }
    return {
      url: normalizeBootstrapWebhookUrl(baseUrl),
      source: "tunnel-log",
    };
  }

  return {
    url: null,
    source: null,
  };
}

async function ensureBootstrapWebhook(params: {
  github: GitHubRestClient;
  repoRef: {
    owner: string;
    repo: string;
  };
  webhookUrl: string | null;
  webhookUrlSource: "explicit" | "env" | "tunnel-log" | null;
  secret: string;
}): Promise<{
  action: "created" | "updated" | "unchanged" | "skipped" | "failed";
  hookId: number | null;
  webhookUrl: string | null;
  webhookUrlSource: "explicit" | "env" | "tunnel-log" | null;
  events: string[];
  error: string | null;
}> {
  const events = DEFAULT_OPENCLAWCODE_BOOTSTRAP_HOOK_EVENTS.split(",").map((entry) => entry.trim());
  if (!params.webhookUrl) {
    return {
      action: "skipped",
      hookId: null,
      webhookUrl: null,
      webhookUrlSource: params.webhookUrlSource,
      events,
      error: null,
    };
  }

  try {
    const result = await params.github.ensureRepoWebhook({
      owner: params.repoRef.owner,
      repo: params.repoRef.repo,
      webhookUrl: params.webhookUrl,
      secret: params.secret,
      events,
    });
    return {
      action: result.action,
      hookId: result.id,
      webhookUrl: result.webhookUrl,
      webhookUrlSource: params.webhookUrlSource,
      events: result.events,
      error: null,
    };
  } catch (error) {
    return {
      action: "failed",
      hookId: null,
      webhookUrl: params.webhookUrl,
      webhookUrlSource: params.webhookUrlSource,
      events,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeBootstrapOperatorConfig(params: {
  configPath: string;
  repoRef: {
    owner: string;
    repo: string;
  };
  targetRepoRoot: string;
  baseBranch: string;
  notifyChannel: string;
  notifyTarget: string;
  builderAgent: string;
  verifierAgent: string;
  testCommands: string[];
}): Promise<{
  created: boolean;
  repoEntryAction: "created" | "updated" | "unchanged";
}> {
  const exists = await pathExists(params.configPath);
  const parsed = exists
    ? (JSON.parse(await readFile(params.configPath, "utf8")) as Record<string, unknown>)
    : {};
  const config = parsed;
  const gateway =
    config.gateway && typeof config.gateway === "object"
      ? ({ ...(config.gateway as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  if (!gateway.mode) {
    gateway.mode = "local";
  }
  if (!gateway.port) {
    gateway.port = DEFAULT_OPENCLAWCODE_BOOTSTRAP_GATEWAY_PORT;
  }
  config.gateway = gateway;

  const plugins =
    config.plugins && typeof config.plugins === "object"
      ? ({ ...(config.plugins as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  plugins.enabled = true;
  const allow = Array.isArray(plugins.allow) ? [...plugins.allow] : [];
  if (!allow.includes("openclawcode")) {
    allow.push("openclawcode");
  }
  plugins.allow = allow;

  const entries =
    plugins.entries && typeof plugins.entries === "object"
      ? ({ ...(plugins.entries as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const pluginEntry =
    entries.openclawcode && typeof entries.openclawcode === "object"
      ? ({ ...(entries.openclawcode as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  pluginEntry.enabled = true;
  const pluginConfig =
    pluginEntry.config && typeof pluginEntry.config === "object"
      ? ({ ...(pluginEntry.config as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  pluginConfig.githubWebhookSecretEnv = "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET";
  const existingResolved = resolveOpenClawCodePluginConfig(pluginConfig);
  const existingRepo = existingResolved.repos.find(
    (entry) =>
      normalizeRepoKeyPart(entry.owner) === normalizeRepoKeyPart(params.repoRef.owner) &&
      normalizeRepoKeyPart(entry.repo) === normalizeRepoKeyPart(params.repoRef.repo),
  );
  const nextRepoEntry: OpenClawCodeChatopsRepoConfig = {
    owner: params.repoRef.owner,
    repo: params.repoRef.repo,
    repoRoot: params.targetRepoRoot,
    baseBranch: params.baseBranch,
    triggerMode: DEFAULT_OPENCLAWCODE_BOOTSTRAP_TRIGGER_MODE,
    notifyChannel: params.notifyChannel,
    notifyTarget: params.notifyTarget,
    builderAgent: params.builderAgent,
    verifierAgent: params.verifierAgent,
    testCommands: params.testCommands,
    triggerLabels: existingRepo?.triggerLabels ?? [],
    skipLabels: existingRepo?.skipLabels ?? [],
    openPullRequest: existingRepo?.openPullRequest ?? true,
    mergeOnApprove: existingRepo?.mergeOnApprove ?? false,
  };
  const existingReposRaw = Array.isArray(pluginConfig.repos) ? pluginConfig.repos : [];
  const repoIndex = existingReposRaw.findIndex((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const candidate = entry as Record<string, unknown>;
    const owner =
      typeof candidate.owner === "string" && candidate.owner.trim() ? candidate.owner : "";
    const repo = typeof candidate.repo === "string" && candidate.repo.trim() ? candidate.repo : "";
    return (
      normalizeRepoKeyPart(owner) === normalizeRepoKeyPart(params.repoRef.owner) &&
      normalizeRepoKeyPart(repo) === normalizeRepoKeyPart(params.repoRef.repo)
    );
  });
  let repoEntryAction: "created" | "updated" | "unchanged" = "created";
  if (repoIndex >= 0) {
    const currentEntry = existingReposRaw[repoIndex];
    if (JSON.stringify(currentEntry) === JSON.stringify(nextRepoEntry)) {
      repoEntryAction = "unchanged";
    } else {
      repoEntryAction = "updated";
    }
    existingReposRaw[repoIndex] = nextRepoEntry;
  } else {
    existingReposRaw.push(nextRepoEntry);
  }
  pluginConfig.repos = existingReposRaw;
  pluginEntry.config = pluginConfig;
  entries.openclawcode = pluginEntry;
  plugins.entries = entries;
  config.plugins = plugins;

  await mkdir(path.dirname(params.configPath), { recursive: true });
  await writeFile(params.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    created: !exists,
    repoEntryAction,
  };
}

async function ensureBootstrapRepoBinding(params: {
  operatorStateDir: string;
  repoKey: string;
  notifyChannel: string;
  notifyTarget: string;
}): Promise<{
  action: "created" | "updated" | "unchanged";
}> {
  const store = OpenClawCodeChatopsStore.fromStateDir(params.operatorStateDir);
  const current = await store.getRepoBinding(params.repoKey);
  if (
    current?.notifyChannel === params.notifyChannel &&
    current?.notifyTarget === params.notifyTarget
  ) {
    return { action: "unchanged" };
  }
  await store.setRepoBinding({
    repoKey: params.repoKey,
    notifyChannel: params.notifyChannel,
    notifyTarget: params.notifyTarget,
  });
  return {
    action: current ? "updated" : "created",
  };
}

async function discoverBootstrapNotifyBinding(params: {
  operatorStateDir: string;
  requestedChannel?: string;
}): Promise<{ notifyChannel: string; notifyTarget: string } | undefined> {
  const store = OpenClawCodeChatopsStore.fromStateDir(params.operatorStateDir);
  const bindings = await store.listRepoBindings();
  const normalizePairKey = (binding: OpenClawCodeRepoNotificationBinding): string =>
    `${binding.notifyChannel}\u0000${binding.notifyTarget}`;
  const trimmedRequestedChannel = params.requestedChannel?.trim();

  if (bindings.length > 0 && trimmedRequestedChannel) {
    const matchingChannelBindings = bindings.filter(
      (binding) => binding.notifyChannel === trimmedRequestedChannel,
    );
    const uniqueTargetBindings = Array.from(
      new Map(
        matchingChannelBindings
          .filter((binding) => binding.notifyTarget.trim().length > 0)
          .map((binding) => [binding.notifyTarget, binding]),
      ).values(),
    );
    if (uniqueTargetBindings.length === 1) {
      return {
        notifyChannel: uniqueTargetBindings[0].notifyChannel,
        notifyTarget: uniqueTargetBindings[0].notifyTarget,
      };
    }
  }

  if (bindings.length > 0 && !trimmedRequestedChannel) {
    const uniqueBindings = Array.from(
      new Map(bindings.map((binding) => [normalizePairKey(binding), binding])).values(),
    );
    if (uniqueBindings.length === 1) {
      return {
        notifyChannel: uniqueBindings[0].notifyChannel,
        notifyTarget: uniqueBindings[0].notifyTarget,
      };
    }
  }

  const preferredTarget = await discoverPreferredOperatorChatTarget({
    stateDir: params.operatorStateDir,
    requestedChannel: trimmedRequestedChannel,
  });
  if (!preferredTarget) {
    return undefined;
  }
  return {
    notifyChannel: preferredTarget.channel,
    notifyTarget: preferredTarget.target,
  };
}

function buildBootstrapWebhookRetryCommand(params: {
  repoKey: string;
  mode: "cli-only" | "chatops";
  notifyChannel: string;
  notifyTarget: string;
  notifyBindingMode: BootstrapNotifyBindingMode;
}): string {
  const args = ["openclaw code bootstrap", `--repo ${params.repoKey}`];
  if (params.mode === "chatops") {
    args.push("--mode chatops");
    args.push(`--channel ${params.notifyChannel}`);
    if (params.notifyBindingMode === "auto-discovered") {
      args.push("--chat-target auto");
    } else if (params.notifyBindingMode !== "chat-placeholder") {
      args.push(`--chat-target ${params.notifyTarget}`);
    }
  }
  args.push("--webhook-url <public-url>", "--json");
  return args.join(" ");
}

function buildBootstrapHandoffPlan(params: {
  repoKey: string;
  repoRef: { owner: string; repo: string };
  targetRepoRoot: string;
  mode: "cli-only" | "chatops";
  blueprintFirstBootstrap: boolean;
  notifyBindingMode: BootstrapNotifyBindingMode;
  notifyChannel: string;
  notifyTarget: string;
  webhookAction: "created" | "updated" | "unchanged" | "skipped" | "failed";
  webhookUrl: string | null;
}): BootstrapHandoffPlan {
  const recommendedProofMode =
    params.mode === "chatops" && params.notifyBindingMode !== "chat-placeholder"
      ? "chatops"
      : "cli-only";
  const reason =
    params.blueprintFirstBootstrap
      ? "Blueprint-first bootstrap is ready; clarify and decompose the project blueprint before the first issue run."
      : recommendedProofMode === "chatops"
      ? "Chat notifications are already routed to a concrete target."
      : params.mode === "chatops"
        ? "ChatOps is configured, but the repo still needs a real conversation bind."
        : "CLI bootstrap is ready without requiring chat routing.";
  const gatewayRestartCommand = formatCliCommand("openclaw gateway restart");
  const pluginActivationRepairCommand = formatCliCommand("openclaw gateway restart");
  return {
    recommendedProofMode,
    reason,
    operatorStatusCommand: "openclaw code operator-status-snapshot-show --json",
    cliRunCommand: `openclaw code run --issue <issue-number> --owner ${params.repoRef.owner} --repo ${params.repoRef.repo} --repo-root ${shellQuoteArg(params.targetRepoRoot)}`,
    blueprintCommand: `/occode-blueprint ${params.repoKey}`,
    blueprintClarifyCommand: `openclaw code blueprint-clarify --repo-root ${shellQuoteArg(params.targetRepoRoot)} --json`,
    blueprintAgreeCommand: `openclaw code blueprint-set-status --repo-root ${shellQuoteArg(params.targetRepoRoot)} --status agreed --json`,
    blueprintDecomposeCommand: `openclaw code blueprint-decompose --repo-root ${shellQuoteArg(params.targetRepoRoot)} --json`,
    gatesCommand: `/occode-gates ${params.repoKey}`,
    gatewayRestartCommand,
    pluginActivationRepairCommand,
    chatSetupCommand: params.mode === "chatops" ? `/occode-setup ${params.repoKey}` : null,
    chatSetupStatusCommand: params.mode === "chatops" ? "/occode-setup-status" : null,
    chatBindCommand:
      params.mode === "chatops" && params.notifyBindingMode === "chat-placeholder"
        ? `/occode-bind ${params.repoKey}`
        : null,
    chatStartCommand:
      params.mode === "chatops" ? `/occode-start ${params.repoKey}#<issue-number>` : null,
    webhookRetryCommand:
      params.webhookAction === "skipped" && !params.webhookUrl
        ? buildBootstrapWebhookRetryCommand({
            repoKey: params.repoKey,
            mode: params.mode,
            notifyChannel: params.notifyChannel,
            notifyTarget: params.notifyTarget,
            notifyBindingMode: params.notifyBindingMode,
          })
        : null,
  };
}

function buildBootstrapProofReadiness(params: {
  setupCheckPayload: BootstrapSetupCheckPayload | null;
  mode: "cli-only" | "chatops";
  notifyBindingMode: BootstrapNotifyBindingMode;
  webhookAction: "created" | "updated" | "unchanged" | "skipped" | "failed";
  webhookUrl: string | null;
  webhookHookId: number | null;
  recommendedProofMode: "cli-only" | "chatops";
}): BootstrapProofReadiness {
  const cliProofReady =
    params.setupCheckPayload?.readiness.strict === true &&
    params.setupCheckPayload.readiness.lowRiskProofReady;
  const chatSetupRoutingReady = params.setupCheckPayload?.readiness.chatSetupRoutingReady === true;
  const needsChatBind =
    params.mode === "chatops" && params.notifyBindingMode === "chat-placeholder";
  const webhookUrlReady = params.webhookUrl != null;
  const webhookReady = params.webhookHookId != null;
  const needsPublicWebhookUrl =
    params.webhookAction === "skipped" && params.webhookUrl == null && params.mode === "chatops";
  const chatProofReady =
    params.mode === "chatops" && !needsChatBind && cliProofReady && chatSetupRoutingReady;
  return {
    cliProofReady,
    chatProofReady,
    chatSetupRoutingReady,
    webhookReady,
    webhookUrlReady,
    needsChatBind,
    needsPublicWebhookUrl,
    recommendedProofMode: params.recommendedProofMode,
  };
}

function parseBootstrapSetupCheckPayload(stdout: string): BootstrapSetupCheckPayload | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as BootstrapSetupCheckPayload;
  } catch {
    return null;
  }
}

function runBootstrapSetupCheck(params: {
  operatorRepoRoot: string;
  operatorStateDir: string;
  probeBuiltStartup: boolean;
}): {
  payload: BootstrapSetupCheckPayload | null;
  status: number | null;
  stderr: string;
} {
  const scriptPath = path.join(params.operatorRepoRoot, "scripts", "openclawcode-setup-check.sh");
  const args = ["--strict", "--json"];
  if (params.probeBuiltStartup) {
    args.splice(1, 0, "--probe-built-startup");
  }
  const result = childProcess.spawnSync("bash", [scriptPath, ...args], {
    cwd: params.operatorRepoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAWCODE_SETUP_REPO_ROOT: params.operatorRepoRoot,
      OPENCLAWCODE_SETUP_OPERATOR_ROOT: params.operatorStateDir,
    },
  });
  return {
    payload: parseBootstrapSetupCheckPayload(result.stdout),
    status: result.status,
    stderr: result.stderr.trim(),
  };
}

function isGatewayReachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

async function startBootstrapGateway(params: {
  operatorRepoRoot: string;
  operatorStateDir: string;
  extraEnv: Record<string, string>;
  port?: number;
}): Promise<{
  action: "already-running" | "started" | "failed";
}> {
  const port = params.port ?? DEFAULT_OPENCLAWCODE_BOOTSTRAP_GATEWAY_PORT;
  if (await isGatewayReachable(port)) {
    return { action: "already-running" };
  }
  const distEntry = path.join(params.operatorRepoRoot, "dist", "index.js");
  const child = childProcess.spawn(
    process.execPath,
    [distEntry, "gateway", "run", "--bind", "loopback", "--port", String(port)],
    {
      cwd: params.operatorRepoRoot,
      env: {
        ...process.env,
        ...params.extraEnv,
        OPENCLAW_STATE_DIR: params.operatorStateDir,
      },
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await isGatewayReachable(port)) {
      return { action: "started" };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { action: "failed" };
}

async function startBootstrapTunnel(params: {
  operatorRepoRoot: string;
  operatorStateDir: string;
}): Promise<BootstrapTunnelResult> {
  const scriptPath = path.join(
    params.operatorRepoRoot,
    "scripts",
    "openclawcode-webhook-tunnel.sh",
  );
  const result = childProcess.spawnSync("bash", [scriptPath, "start-tunnel"], {
    cwd: params.operatorRepoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: params.operatorStateDir,
      OPENCLAWCODE_TUNNEL_OPERATOR_ROOT: params.operatorStateDir,
    },
  });
  if (result.status !== 0) {
    const error =
      result.stderr.trim() || result.stdout.trim() || "Failed to start the managed webhook tunnel.";
    return {
      action: "failed",
      url: null,
      error,
    };
  }

  const stdout = result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidateUrl = stdout.at(-1);
  if (candidateUrl) {
    return {
      action: "started",
      url: normalizeBootstrapWebhookUrl(candidateUrl),
      error: null,
    };
  }

  const resolved = await resolveBootstrapWebhookUrl({
    operatorStateDir: params.operatorStateDir,
  });
  if (resolved.url) {
    return {
      action: "already-running",
      url: resolved.url,
      error: null,
    };
  }

  return {
    action: "failed",
    url: null,
    error: "Managed tunnel command exited successfully, but no public URL was discovered.",
  };
}

export const openclawCodeBootstrapInternals = {
  runSetupCheck: runBootstrapSetupCheck,
  startGateway: startBootstrapGateway,
  startTunnel: startBootstrapTunnel,
  resolveWebhookUrl: resolveBootstrapWebhookUrl,
  ensureWebhook: ensureBootstrapWebhook,
};

function formatChatCommandWithAlias(command: string | null): string | null {
  if (!command) {
    return null;
  }
  if (!command.startsWith("/occode-")) {
    return command;
  }
  const alias = command.replace(/^\/occode-/, "/occ-");
  return `${command} (alias ${alias})`;
}

function parseRepoVisibility(value: string | undefined): "public" | "private" {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "private") {
    return "private";
  }
  if (normalized === "public") {
    return "public";
  }
  throw new Error(`Unsupported visibility: ${value}. Expected public or private.`);
}

export async function openclawCodeRepoPlanCommand(
  opts: OpenClawCodeRepoPlanOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const resolvedToken = resolveGitHubTokenFromEnvOrGhCli();
  if (!resolvedToken) {
    throw new Error(
      "Repo planning requires GH_TOKEN, GITHUB_TOKEN, or an authenticated `gh auth token` session.",
    );
  }

  const github = new GitHubRestClient(resolvedToken.token);
  const owner = opts.owner?.trim() || (await github.fetchAuthenticatedViewer()).login;
  const requestedLimit =
    typeof opts.limit === "number" && Number.isFinite(opts.limit) ? opts.limit : 5;
  const limit = Math.max(1, Math.min(requestedLimit, 20));
  const explicitRepo = opts.repo ? slugifyRepoNamePart(opts.repo) : undefined;
  const visibility = parseRepoVisibility(opts.visibility);

  if (opts.existing) {
    const repositories = await github.listAccessibleRepositories({
      owner,
      limit,
    });
    const payload = {
      owner,
      mode: "existing",
      credentials: {
        githubTokenSource: resolvedToken.source,
      },
      repositories,
      nextAction:
        repositories[0] != null
          ? `Choose one repo, then run: openclaw code bootstrap --repo ${repositories[0].owner}/${repositories[0].repo} --json`
          : `No accessible repos were found for ${owner}. Pass --project to generate new-repo suggestions, or specify --repo owner/name to bootstrap directly.`,
    };
    if (opts.json) {
      runtime.log(JSON.stringify(payload, null, 2));
      return;
    }
    runtime.log(`Owner: ${owner}`);
    runtime.log("Mode: existing");
    runtime.log(`GitHub token source: ${resolvedToken.source}`);
    runtime.log(`Accessible repos: ${repositories.length}`);
    for (const repo of repositories) {
      runtime.log(
        `- ${repo.owner}/${repo.repo} | ${repo.private ? "private" : "public"} | updated ${repo.updatedAt ?? "unknown"}`,
      );
    }
    runtime.log(`Next action: ${payload.nextAction}`);
    return;
  }

  const project = opts.project?.trim();
  const suggestions = explicitRepo
    ? [explicitRepo]
    : buildRepoNameSuggestions(project ?? "new project");
  let createdRepository:
    | {
        owner: string;
        repo: string;
        url: string;
        visibility: "public" | "private";
      }
    | undefined;
  if (opts.create) {
    if (!explicitRepo) {
      throw new Error(
        "Pass --repo <name> together with --create so the chosen repository name is explicit.",
      );
    }
    const created = await github.createRepository({
      owner,
      name: explicitRepo,
      description: opts.description ?? project,
      private: visibility !== "public",
    });
    createdRepository = {
      owner: created.owner,
      repo: created.repo,
      url: created.url,
      visibility: created.private ? "private" : "public",
    };
  }

  const createCommand = explicitRepo
    ? [
        "openclaw code repo-plan",
        `--owner ${owner}`,
        `--repo ${explicitRepo}`,
        "--create",
        `--visibility ${visibility}`,
        project ? `--project ${JSON.stringify(project)}` : null,
        opts.description ? `--description ${JSON.stringify(opts.description)}` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;
  const payload = {
    owner,
    mode: "new",
    credentials: {
      githubTokenSource: resolvedToken.source,
    },
    project: project ?? null,
    suggestions,
    selectedRepo: explicitRepo ? `${owner}/${explicitRepo}` : null,
    createdRepository,
    nextAction: createdRepository
      ? `openclaw code bootstrap --repo ${createdRepository.owner}/${createdRepository.repo} --json`
      : createCommand ??
        "Choose one suggested name or provide your own with --repo <name>, then rerun with --create when ready.",
  };

  if (opts.json) {
    runtime.log(JSON.stringify(payload, null, 2));
    return;
  }

  runtime.log(`Owner: ${owner}`);
  runtime.log("Mode: new");
  runtime.log(`GitHub token source: ${resolvedToken.source}`);
  if (project) {
    runtime.log(`Project: ${project}`);
  }
  runtime.log("Suggested repository names:");
  for (const suggestion of suggestions) {
    runtime.log(`- ${suggestion}`);
  }
  if (createdRepository) {
    runtime.log(
      `Created repo: ${createdRepository.owner}/${createdRepository.repo} (${createdRepository.visibility})`,
    );
    runtime.log(createdRepository.url);
  }
  runtime.log(`Next action: ${payload.nextAction}`);
}

function logProjectBlueprintSummary(params: {
  summary: Awaited<ReturnType<typeof readProjectBlueprint>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { summary, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(summary, null, 2));
    return;
  }

  runtime.log(`Repo root: ${summary.repoRoot}`);
  runtime.log(`Blueprint path: ${summary.blueprintPath}`);
  runtime.log(`Exists: ${summary.exists ? "yes" : "no"}`);
  if (!summary.exists) {
    return;
  }

  runtime.log(`Schema version: ${summary.schemaVersion ?? "unknown"}`);
  runtime.log(`Status: ${summary.status ?? "unknown"}`);
  runtime.log(`Status changed at: ${summary.statusChangedAt ?? "unknown"}`);
  runtime.log(`Title: ${summary.title ?? "untitled"}`);
  runtime.log(`Created at: ${summary.createdAt ?? "unknown"}`);
  runtime.log(`Updated at: ${summary.updatedAt ?? "unknown"}`);
  runtime.log(`Agreed at: ${summary.agreedAt ?? "not yet agreed"}`);
  runtime.log(`Revision: ${summary.revisionId ?? "unknown"}`);
  runtime.log(`Goal summary: ${summary.goalSummary ?? "none"}`);
  runtime.log(`Required sections present: ${summary.requiredSectionsPresent ? "yes" : "no"}`);
  if (summary.missingRequiredSections.length > 0) {
    runtime.log(`Missing sections: ${summary.missingRequiredSections.join(", ")}`);
  }
  runtime.log(`Defaulted sections: ${summary.defaultedSectionCount}`);
  if (summary.defaultedSections.length > 0) {
    runtime.log(`Still using defaults: ${summary.defaultedSections.join(", ")}`);
  }
  runtime.log(`Workstream candidates: ${summary.workstreamCandidateCount}`);
  runtime.log(`Open questions: ${summary.openQuestionCount}`);
  runtime.log(`Human gates: ${summary.humanGateCount}`);
  runtime.log(`Validation errors: ${summary.validationErrorCount}`);
  for (const error of summary.validationErrors) {
    runtime.log(`- validation-error: ${error}`);
  }
  runtime.log(`Validation warnings: ${summary.validationWarningCount}`);
  for (const warning of summary.validationWarnings) {
    runtime.log(`- validation-warning: ${warning}`);
  }
  runtime.log(`Clarification history: ${summary.clarificationHistoryCount}`);
  if (summary.lastClarificationAt) {
    runtime.log(`Last clarification at: ${summary.lastClarificationAt}`);
  }
  const providerAssignments = Object.entries(summary.providerRoleAssignments)
    .filter(([, value]) => value != null)
    .map(([role, value]) => `${role}=${value}`);
  runtime.log(
    `Provider roles: ${providerAssignments.length > 0 ? providerAssignments.join(", ") : "none"}`,
  );
}

function logProjectBlueprintClarificationReport(params: {
  report: Awaited<ReturnType<typeof inspectProjectBlueprintClarifications>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { report, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(report, null, 2));
    return;
  }

  logProjectBlueprintSummary({ summary: report, runtime, json: false });
  runtime.log(`Priority question: ${report.priorityQuestion ?? "none"}`);
  runtime.log(`Questions: ${report.questionCount}`);
  for (const question of report.questions) {
    runtime.log(`- question: ${question}`);
  }
  runtime.log(`Suggestions: ${report.suggestionCount}`);
  for (const suggestion of report.suggestions) {
    runtime.log(`- suggestion: ${suggestion}`);
  }
}

function logProjectWorkItemInventory(params: {
  inventory: Awaited<ReturnType<typeof readProjectWorkItemInventory>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { inventory, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(inventory, null, 2));
    return;
  }

  runtime.log(`Repo root: ${inventory.repoRoot}`);
  runtime.log(`Inventory path: ${inventory.inventoryPath}`);
  runtime.log(`Exists: ${inventory.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${inventory.generatedAt ?? "not yet generated"}`);
  runtime.log(`Blueprint exists: ${inventory.blueprintExists ? "yes" : "no"}`);
  runtime.log(`Blueprint path: ${inventory.blueprintPath}`);
  runtime.log(`Blueprint status: ${inventory.blueprintStatus ?? "unknown"}`);
  runtime.log(`Blueprint revision: ${inventory.blueprintRevisionId ?? "unknown"}`);
  runtime.log(
    `Artifact stale: ${inventory.artifactStale == null ? "unknown" : inventory.artifactStale ? "yes" : "no"}`,
  );
  runtime.log(`Ready for issue projection: ${inventory.readyForIssueProjection ? "yes" : "no"}`);
  runtime.log(`Work items: ${inventory.workItemCount}`);
  if (inventory.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of inventory.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  if (inventory.suggestions.length > 0) {
    runtime.log("Suggestions:");
    for (const suggestion of inventory.suggestions) {
      runtime.log(`- ${suggestion}`);
    }
  }
  for (const item of inventory.workItems) {
    runtime.log(`- ${item.id}: ${item.title}`);
  }
}

function logProjectDiscoveryInventory(params: {
  inventory: Awaited<ReturnType<typeof readProjectDiscoveryInventory>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { inventory, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(inventory, null, 2));
    return;
  }

  runtime.log(`Repo root: ${inventory.repoRoot}`);
  runtime.log(`Discovery path: ${inventory.inventoryPath}`);
  runtime.log(`Exists: ${inventory.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${inventory.generatedAt ?? "not yet generated"}`);
  runtime.log(`Evidence count: ${inventory.evidenceCount}`);
  runtime.log(`Highest priority: ${inventory.highestPriority ?? "none"}`);
  if (inventory.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of inventory.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  for (const entry of inventory.evidence) {
    runtime.log(`- ${entry.id}: ${entry.summary}`);
  }
}

function logProjectRoleRoutingPlan(params: {
  plan: Awaited<ReturnType<typeof readProjectRoleRoutingPlan>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { plan, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(plan, null, 2));
    return;
  }

  runtime.log(`Repo root: ${plan.repoRoot}`);
  runtime.log(`Role-routing path: ${plan.artifactPath}`);
  runtime.log(`Exists: ${plan.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${plan.generatedAt ?? "not yet generated"}`);
  runtime.log(`Fallback configured: ${plan.fallbackConfigured ? "yes" : "no"}`);
  runtime.log(`Mixed mode: ${plan.mixedMode ? "yes" : "no"}`);
  runtime.log(`Unresolved roles: ${plan.unresolvedRoleCount}`);
  if (plan.stageRoutes.length > 0) {
    runtime.log(
      `Stage routing: ${plan.stageRoutes
        .map((route) => `${route.stageId}=${route.adapterId}/${route.roleId}`)
        .join(", ")}`,
    );
  }
  if (plan.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of plan.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  for (const route of plan.routes) {
    runtime.log(
      `- ${route.roleId}: ${route.rawAssignment ?? "openclaw-default"} (${route.adapterId}, ${route.source}, runtime=${route.runtimeCapable ? "yes" : "no"}, reroute=${route.rerouteCapable ? "yes" : "no"}, agent=${route.resolvedAgentId ?? "runner-default"}, stages=${route.stages.join("/")}, fallbacks=${route.fallbackChain.length > 0 ? route.fallbackChain.join(" -> ") : "none"})`,
    );
  }
}

function logProjectStageGateArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectStageGateArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Stage-gate path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${artifact.generatedAt ?? "not yet generated"}`);
  runtime.log(`Blocked gates: ${artifact.blockedGateCount}`);
  runtime.log(`Needs human decision: ${artifact.needsHumanDecisionCount}`);
  for (const gate of artifact.gates) {
    runtime.log(`- ${gate.gateId}: ${gate.readiness} | ${gate.title}`);
  }
}

function logProjectRuntimeSteeringArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectRuntimeSteeringArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Runtime-steering path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${artifact.generatedAt ?? "not yet generated"}`);
  runtime.log(`Overrides: ${artifact.overrideCount}`);
  for (const override of artifact.overrides) {
    runtime.log(
      `- ${override.stageId}: role=${override.roleId} adapter=${override.adapterId ?? "unchanged"} agent=${override.agentId ?? "runner-default"} actor=${override.actor ?? "unknown"} updated=${override.updatedAt}${override.note ? ` | note=${override.note}` : ""}`,
    );
  }
}

function logProjectNextWorkSelection(params: {
  selection: Awaited<ReturnType<typeof readProjectNextWorkSelection>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { selection, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(selection, null, 2));
    return;
  }

  runtime.log(`Repo root: ${selection.repoRoot}`);
  runtime.log(`Next-work path: ${selection.artifactPath}`);
  runtime.log(`Exists: ${selection.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${selection.generatedAt ?? "not yet generated"}`);
  runtime.log(`Decision: ${selection.decision}`);
  runtime.log(`Autonomous continuation: ${selection.canContinueAutonomously ? "yes" : "no"}`);
  runtime.log(`Blueprint revision: ${selection.blueprintRevisionId ?? "unknown"}`);
  if (selection.blockingGateId) {
    runtime.log(`Blocking gate: ${selection.blockingGateId}`);
  }
  if (selection.selectedWorkItem) {
    runtime.log(
      `Selected work item: ${selection.selectedWorkItem.id} | ${selection.selectedWorkItem.title}`,
    );
    runtime.log(`Selected from: ${selection.selectedWorkItem.selectedFrom}`);
    runtime.log(`Execution mode: ${selection.selectedWorkItem.executionMode}`);
    runtime.log(`Issue draft: ${selection.selectedWorkItem.githubIssueDraftTitle}`);
  }
  if (selection.selectedReason) {
    runtime.log(`Reason: ${selection.selectedReason}`);
  }
  runtime.log(
    `Signals: clarifications=${selection.clarificationQuestionCount} | discovery=${selection.discoveryEvidenceCount} | workItems=${selection.workItemCount} | blockedGates=${selection.blockedGateCount} | needsHuman=${selection.needsHumanDecisionCount} | unresolvedRoles=${selection.unresolvedRoleCount}`,
  );
  if (selection.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of selection.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  if (selection.suggestions.length > 0) {
    runtime.log("Suggestions:");
    for (const suggestion of selection.suggestions) {
      runtime.log(`- ${suggestion}`);
    }
  }
}

function logProjectIssueMaterializationArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectIssueMaterializationArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Issue-materialization path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${artifact.generatedAt ?? "not yet generated"}`);
  runtime.log(`Decision: ${artifact.nextWorkDecision}`);
  runtime.log(`Outcome: ${artifact.outcome}`);
  if (artifact.blockingGateId) {
    runtime.log(`Blocking gate: ${artifact.blockingGateId}`);
  }
  if (artifact.selectedWorkItemId) {
    runtime.log(`Selected work item: ${artifact.selectedWorkItemId}`);
  }
  if (artifact.selectedWorkItemExecutionMode) {
    runtime.log(`Execution mode: ${artifact.selectedWorkItemExecutionMode}`);
  }
  if (artifact.selectedIssueNumber != null) {
    runtime.log(`Selected issue: #${artifact.selectedIssueNumber} | ${artifact.selectedIssueTitle}`);
    runtime.log(`Selected issue URL: ${artifact.selectedIssueUrl}`);
  }
  runtime.log(`Entries: ${artifact.entries.length}`);
  for (const entry of artifact.entries.slice(0, 5)) {
    runtime.log(
      `- ${entry.workItemId}: #${entry.issueNumber} | ${entry.issueState} | ${entry.reusedExisting ? "reused" : "created"}${entry.stale ? " | stale" : ""}`,
    );
  }
}

function logProjectProgressArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectProgressArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Project-progress path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${artifact.generatedAt ?? "not yet generated"}`);
  runtime.log(`Blueprint: ${artifact.blueprintStatus ?? "unknown"} | ${artifact.blueprintRevisionId ?? "unknown"}`);
  runtime.log(`Next work: ${artifact.nextWorkDecision}`);
  if (artifact.nextWorkBlockingGateId) {
    runtime.log(`Next-work gate: ${artifact.nextWorkBlockingGateId}`);
  }
  if (artifact.activeWorkstreamSummary) {
    runtime.log(`Active workstream: ${artifact.activeWorkstreamSummary}`);
  }
  runtime.log(
    `Signals: workItems=${artifact.workItemCount} | unresolvedRoles=${artifact.unresolvedRoleCount} | blockedGates=${artifact.blockedGateCount} | needsHuman=${artifact.needsHumanDecisionCount}`,
  );
  if (artifact.selectedWorkItemTitle) {
    runtime.log(`Selected work item: ${artifact.selectedWorkItemTitle}`);
  }
  if (artifact.selectedWorkItemExecutionMode) {
    runtime.log(`Execution mode: ${artifact.selectedWorkItemExecutionMode}`);
  }
  if (artifact.selectedIssueNumber != null) {
    runtime.log(`Selected issue: #${artifact.selectedIssueNumber} | ${artifact.selectedIssueTitle}`);
  }
  if (artifact.nextWorkPrimaryBlocker) {
    runtime.log(`Primary blocker: ${artifact.nextWorkPrimaryBlocker}`);
  }
  if (artifact.roleRouteSummary.length > 0) {
    runtime.log(`Roles: ${artifact.roleRouteSummary.join(", ")}`);
  }
  runtime.log(
    `Operator: available=${artifact.operator.available ? "yes" : "no"} | binding=${artifact.operator.bindingPresent ? "yes" : "no"} | pending=${artifact.operator.pendingApprovalCount} | queued=${artifact.operator.queuedRunCount} | current=${artifact.operator.currentRunCount} | pause=${artifact.operator.providerPauseActive ? "yes" : "no"}`,
  );
  runtime.log(
    `Operator program: available=${artifact.operatorProgram.available ? "yes" : "no"} | mutableSurface=${artifact.operatorProgram.mutableSurfaceMode ?? "unset"} | proof=${artifact.operatorProgram.requireOneExecutableProof ? "required" : "optional"} | attemptLedger=${artifact.operatorProgram.attemptLedgerRequired ? "required" : "optional"} | nextAction=${artifact.operatorProgram.nextActionCode ?? "none"}`,
  );
  if (artifact.operatorProgram.title || artifact.operatorProgram.updatedAt) {
    runtime.log(
      `Operator program meta: ${artifact.operatorProgram.title ?? "untitled"}${artifact.operatorProgram.updatedAt ? ` | updated=${artifact.operatorProgram.updatedAt}` : ""}`,
    );
  }
  if (artifact.operatorProgram.summary) {
    runtime.log(`Operator program summary: ${artifact.operatorProgram.summary}`);
  }
  runtime.log(
    `Operator program scope: paths=${artifact.operatorProgram.mutableSurfacePathCount} | allowlist=${artifact.operatorProgram.mutableSurfacePathsPresent ? "yes" : "no"} | simplify=${artifact.operatorProgram.simplificationBias ? "yes" : "no"}`,
  );
  if (artifact.operatorProgram.validationBudgetSummary) {
    runtime.log(`Operator program budget: ${artifact.operatorProgram.validationBudgetSummary}`);
  }
  runtime.log(
    `Operator program criteria: keep=${artifact.operatorProgram.keepCriteriaCount} | discard=${artifact.operatorProgram.discardCriteriaCount} | retry=${artifact.operatorProgram.retryCriteriaCount}`,
  );
  if (artifact.operatorProgram.advancementRuleSummary) {
    runtime.log(`Operator program advancement: ${artifact.operatorProgram.advancementRuleSummary}`);
  }
  if (artifact.operatorProgram.nextActionSummary) {
    runtime.log(`Operator program next: ${artifact.operatorProgram.nextActionSummary}`);
  }
  runtime.log(
    `Operator program links: blueprint=${artifact.operatorProgram.linkedBlueprintPath} | workItems=${artifact.operatorProgram.linkedWorkItemsPath} | stageGates=${artifact.operatorProgram.linkedStageGatesPath}`,
  );
  if (artifact.operator.currentRunIssueKey) {
    runtime.log(`Current run: ${artifact.operator.currentRunIssueKey}`);
  }
  if (artifact.operator.currentRunStage) {
    runtime.log(`Current run stage: ${artifact.operator.currentRunStage}`);
  }
  if (artifact.operator.currentRunBranchName) {
    runtime.log(`Current run branch: ${artifact.operator.currentRunBranchName}`);
  }
  if (artifact.operator.currentRunPullRequestNumber != null) {
    runtime.log(`Current run PR: #${artifact.operator.currentRunPullRequestNumber}`);
  }
  if (artifact.nextSuggestedCommand) {
    runtime.log(`Next suggested command: ${artifact.nextSuggestedCommand}`);
  }
  if (artifact.nextSuggestedChatCommand) {
    runtime.log(`Next suggested chat command: ${artifact.nextSuggestedChatCommand}`);
  }
}

function logProjectOperatorProgramArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectOperatorProgram>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Operator-program path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Updated at: ${artifact.updatedAt ?? "not yet generated"}`);
  runtime.log(`Title: ${artifact.title ?? "unknown"}`);
  runtime.log(`Mutable surface mode: ${artifact.mutableSurfaceMode ?? "unset"}`);
  runtime.log(
    `Validation budget: ${artifact.validationBudgetSummary ?? "not set"}${typeof artifact.validationBudgetMaxPrimaryCommands === "number" ? ` | max primary commands=${artifact.validationBudgetMaxPrimaryCommands}` : ""}`,
  );
  runtime.log(`Require executable proof: ${artifact.requireOneExecutableProof ? "yes" : "no"}`);
  runtime.log(`Attempt ledger required: ${artifact.attemptLedgerRequired ? "yes" : "no"}`);
  runtime.log(`Next action code: ${artifact.nextActionCode ?? "none"}`);
  if (artifact.nextActionSummary) {
    runtime.log(`Next action summary: ${artifact.nextActionSummary}`);
  }
}

function logProjectAutonomousLoopArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectAutonomousLoopArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Autonomous-loop path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${artifact.generatedAt ?? "not yet generated"}`);
  runtime.log(`Enabled: ${artifact.enabled ? "yes" : "no"}`);
  runtime.log(`Mode: ${artifact.mode}`);
  runtime.log(`Status: ${artifact.status}`);
  runtime.log(`Iterations: ${artifact.completedIterationCount}/${artifact.requestedIterationCount}`);
  runtime.log(`Next work: ${artifact.nextWorkDecision}`);
  if (artifact.nextWorkBlockingGateId) {
    runtime.log(`Next-work gate: ${artifact.nextWorkBlockingGateId}`);
  }
  if (artifact.activeWorkstreamSummary) {
    runtime.log(`Active workstream: ${artifact.activeWorkstreamSummary}`);
  }
  runtime.log(
    `Operator: queued=${artifact.queuedRunCount} | currentRun=${artifact.currentRunPresent ? "yes" : "no"} | pause=${artifact.providerPauseActive ? "yes" : "no"}`,
  );
  runtime.log(
    `Operator program: available=${artifact.operatorProgram.available ? "yes" : "no"} | mutableSurface=${artifact.operatorProgram.mutableSurfaceMode ?? "unset"} | proof=${artifact.operatorProgram.requireOneExecutableProof ? "required" : "optional"} | attemptLedger=${artifact.operatorProgram.attemptLedgerRequired ? "required" : "optional"} | nextAction=${artifact.operatorProgram.nextActionCode ?? "none"}`,
  );
  if (artifact.selectedWorkItemId) {
    runtime.log(`Selected work item: ${artifact.selectedWorkItemId}`);
  }
  if (artifact.selectedWorkItemExecutionMode) {
    runtime.log(`Execution mode: ${artifact.selectedWorkItemExecutionMode}`);
  }
  if (artifact.roleRouteSummary.length > 0) {
    runtime.log(`Roles: ${artifact.roleRouteSummary.join(", ")}`);
  }
  if (artifact.selectedIssueNumber != null) {
    runtime.log(`Selected issue: #${artifact.selectedIssueNumber}`);
  }
  if (artifact.queuedIssueKey) {
    runtime.log(`Queued issue: ${artifact.queuedIssueKey}`);
  }
  if (artifact.currentRunIssueKey) {
    runtime.log(`Current run: ${artifact.currentRunIssueKey}`);
  }
  if (artifact.currentRunStage) {
    runtime.log(`Current run stage: ${artifact.currentRunStage}`);
  }
  if (artifact.currentRunBranchName) {
    runtime.log(`Current run branch: ${artifact.currentRunBranchName}`);
  }
  if (artifact.currentRunPullRequestNumber != null) {
    runtime.log(`Current run PR: #${artifact.currentRunPullRequestNumber}`);
  }
  if (artifact.stopReason) {
    runtime.log(`Stop reason: ${artifact.stopReason}`);
  }
  if (artifact.nextWorkPrimaryBlocker) {
    runtime.log(`Primary blocker: ${artifact.nextWorkPrimaryBlocker}`);
  }
  if (artifact.message) {
    runtime.log(`Message: ${artifact.message}`);
  }
  if (artifact.nextSuggestedCommand) {
    runtime.log(`Next suggested command: ${artifact.nextSuggestedCommand}`);
  }
  if (artifact.nextSuggestedChatCommand) {
    runtime.log(`Next suggested chat command: ${artifact.nextSuggestedChatCommand}`);
  }
  if (artifact.iterations.length > 0) {
    runtime.log("Iteration history:");
    for (const iteration of artifact.iterations.slice(0, 5)) {
      const details = [
        `status=${iteration.status}`,
        `decision=${iteration.nextWorkDecision}`,
        iteration.selectedIssueNumber != null ? `issue=#${iteration.selectedIssueNumber}` : undefined,
        iteration.queuedIssueKey ? `queued=${iteration.queuedIssueKey}` : undefined,
        iteration.stopReason ? `stop=${iteration.stopReason}` : undefined,
        iteration.message ? `message=${iteration.message}` : undefined,
        iteration.activeWorkstreamSummary
          ? `workstream=${iteration.activeWorkstreamSummary}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" | ");
      runtime.log(`- ${iteration.iteration}: ${details}`);
    }
  }
}

function logProjectPromotionGateArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectPromotionGateArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Promotion-gate path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${artifact.generatedAt ?? "not yet generated"}`);
  runtime.log(`Branch: ${artifact.branchName ?? "unknown"}`);
  runtime.log(`Commit: ${artifact.commitSha ?? "unknown"}`);
  runtime.log(`Base branch: ${artifact.baseBranch ?? "unknown"}`);
  runtime.log(`Promotion ready: ${artifact.ready ? "yes" : "no"}`);
  runtime.log(`Setup-check available: ${artifact.setupCheckAvailable ? "yes" : "no"}`);
  runtime.log(`Merge-promotion gate: ${artifact.mergePromotionGateReadiness ?? "unknown"}`);
  if (artifact.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of artifact.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  if (artifact.suggestions.length > 0) {
    runtime.log("Suggestions:");
    for (const suggestion of artifact.suggestions) {
      runtime.log(`- ${suggestion}`);
    }
  }
}

function logProjectRollbackSuggestionArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectRollbackSuggestionArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Rollback path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${artifact.generatedAt ?? "not yet generated"}`);
  runtime.log(`Current branch: ${artifact.branchName ?? "unknown"}`);
  runtime.log(`Target ref: ${artifact.targetRef ?? "unknown"}`);
  runtime.log(`Recommended: ${artifact.recommended ? "yes" : "no"}`);
  runtime.log(`Reason: ${artifact.reason}`);
  if (artifact.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of artifact.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  if (artifact.suggestions.length > 0) {
    runtime.log("Suggestions:");
    for (const suggestion of artifact.suggestions) {
      runtime.log(`- ${suggestion}`);
    }
  }
}

function logProjectPromotionReceiptArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectPromotionReceiptArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Promotion receipt path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Recorded at: ${artifact.recordedAt ?? "not yet recorded"}`);
  runtime.log(
    `Source ref: ${artifact.sourceBranch ?? "unknown"}@${artifact.sourceCommitSha ?? "unknown"}`,
  );
  runtime.log(`Promoted ref: ${artifact.promotedRef ?? "unknown"}`);
  runtime.log(
    `Promotion ready at record time: ${artifact.promotionReady == null ? "unknown" : artifact.promotionReady ? "yes" : "no"}`,
  );
  if (artifact.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of artifact.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  if (artifact.suggestions.length > 0) {
    runtime.log("Suggestions:");
    for (const suggestion of artifact.suggestions) {
      runtime.log(`- ${suggestion}`);
    }
  }
}

function logProjectRollbackReceiptArtifact(params: {
  artifact: Awaited<ReturnType<typeof readProjectRollbackReceiptArtifact>>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { artifact, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(artifact, null, 2));
    return;
  }

  runtime.log(`Repo root: ${artifact.repoRoot}`);
  runtime.log(`Rollback receipt path: ${artifact.artifactPath}`);
  runtime.log(`Exists: ${artifact.exists ? "yes" : "no"}`);
  runtime.log(`Recorded at: ${artifact.recordedAt ?? "not yet recorded"}`);
  runtime.log(
    `Source ref: ${artifact.sourceBranch ?? "unknown"}@${artifact.sourceCommitSha ?? "unknown"}`,
  );
  runtime.log(`Restored ref: ${artifact.restoredRef ?? "unknown"}`);
  if (artifact.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of artifact.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  if (artifact.suggestions.length > 0) {
    runtime.log("Suggestions:");
    for (const suggestion of artifact.suggestions) {
      runtime.log(`- ${suggestion}`);
    }
  }
}

function logOpenClawCodeOperatorStatusSnapshot(params: {
  snapshot: OpenClawCodeOperatorStatusSnapshot;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { snapshot, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  runtime.log(`State dir: ${snapshot.stateDir}`);
  runtime.log(`State path: ${snapshot.statePath}`);
  runtime.log(`Exists: ${snapshot.exists ? "yes" : "no"}`);
  runtime.log(`Generated at: ${snapshot.generatedAt}`);
  runtime.log(`Tracked issues: ${snapshot.trackedIssueCount}`);
  runtime.log(`Pending approvals: ${snapshot.pendingApprovalCount}`);
  runtime.log(`- manual: ${snapshot.manualPendingApprovalCount}`);
  runtime.log(`- execution-start gated: ${snapshot.executionStartGatedApprovalCount}`);
  runtime.log(`Pending intake drafts: ${snapshot.pendingIntakeDraftCount}`);
  runtime.log(`Manual takeovers: ${snapshot.manualTakeoverCount}`);
  runtime.log(`Queued runs: ${snapshot.queuedRunCount}`);
  runtime.log(`Current run present: ${snapshot.currentRunPresent ? "yes" : "no"}`);
  runtime.log(`Repo bindings: ${snapshot.repoBindingCount}`);
  runtime.log(`GitHub deliveries: ${snapshot.githubDeliveryCount}`);
  runtime.log(`Provider pause active: ${snapshot.providerPauseActive ? "yes" : "no"}`);
  if (snapshot.currentRun) {
    runtime.log(
      `Current run: ${snapshot.currentRun.request.owner}/${snapshot.currentRun.request.repo}#${snapshot.currentRun.request.issueNumber}`,
    );
  }
  for (const repo of snapshot.repos) {
    runtime.log(
      `- ${repo.repoKey}: tracked=${repo.trackedIssueCount} pending=${repo.pendingApprovalCount} queued=${repo.queuedRunCount} current=${repo.currentRunCount} ready=${repo.readyForHumanReviewCount} merged=${repo.mergedCount} failed=${repo.failedCount} pre-code=ready:${repo.preCodeDisciplineReadyCount},warn:${repo.preCodeDisciplineWarnCount},blocked:${repo.preCodeDisciplineBlockedCount},pending:${repo.preCodeDisciplinePendingCount}${repo.preCodeDisciplineGapSummary ? `,gaps:${repo.preCodeDisciplineGapSummary}` : ""}${repo.preCodeDisciplineNextActionSummary ? `,next:${repo.preCodeDisciplineNextActionSummary}` : ""}${repo.preCodeDisciplineRepairSummary ? `,repair:${repo.preCodeDisciplineRepairSummary}` : ""}${repo.operatorProgramAvailable ? ` operator-program=mutable:${repo.operatorProgramMutableSurfaceMode ?? "unset"},paths:${repo.operatorProgramMutableSurfacePathCount ?? 0},simplify:${repo.operatorProgramSimplificationBias ? "yes" : "no"},proof:${repo.operatorProgramRequireOneExecutableProof ? "required" : "optional"},ledger:${repo.operatorProgramAttemptLedgerRequired ? "required" : "optional"},keep:${repo.operatorProgramKeepCriteriaCount ?? 0},discard:${repo.operatorProgramDiscardCriteriaCount ?? 0},retry:${repo.operatorProgramRetryCriteriaCount ?? 0}${repo.operatorProgramNextActionSummary ? `,next:${repo.operatorProgramNextActionSummary}` : ""}` : ""} loop=healthy:${repo.loopHealthHealthyCount},warn:${repo.loopHealthWarnCount},blocked:${repo.loopHealthBlockedCount},pending:${repo.loopHealthPendingCount}`,
    );
  }
}

function logOpenClawCodeCapabilityMap(params: {
  snapshot: ReturnType<typeof buildOpenClawCodeCapabilityMapSnapshot>;
  runtime: RuntimeEnv;
  json?: boolean;
}): void {
  const { snapshot, runtime } = params;
  if (params.json) {
    runtime.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  runtime.log(`Capability map contract version: ${snapshot.contractVersion}`);
  runtime.log(`Chat commands: ${snapshot.chatCommands.length}`);
  for (const command of snapshot.chatCommands) {
    runtime.log(`- ${command.command} | ${command.capabilities.join(", ")}`);
  }
  runtime.log(`CLI commands: ${snapshot.cliCommands.length}`);
  for (const command of snapshot.cliCommands) {
    runtime.log(`- ${command.command} | ${command.capabilities.join(", ")}`);
  }
  runtime.log(`Workflow artifacts: ${snapshot.workflowArtifacts.length}`);
  for (const artifact of snapshot.workflowArtifacts) {
    runtime.log(`- ${artifact.path} | ${artifact.summary}`);
  }
  runtime.log(`Runtime roles: ${snapshot.runtimeRoles.length}`);
  for (const role of snapshot.runtimeRoles) {
    runtime.log(`- ${role.roleId} | stages=${role.steeringStages.join(", ")}`);
  }
}

function logOpenClawCodePolicySnapshot(params: { runtime: RuntimeEnv; json?: boolean }): void {
  const snapshot = buildOpenClawCodePolicySnapshot();
  if (params.json) {
    params.runtime.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  params.runtime.log(`Policy contract version: ${snapshot.contractVersion}`);
  params.runtime.log(
    `Suitability allowlist labels: ${snapshot.suitability.lowRiskLabels.join(", ")}`,
  );
  params.runtime.log(
    `Suitability denylist labels: ${snapshot.suitability.highRiskLabels.join(", ")}`,
  );
  params.runtime.log(
    `Build guardrails: lines>=${snapshot.buildGuardrails.largeDiffLineThreshold}, files>=${snapshot.buildGuardrails.largeDiffFileThreshold}, fan-out files>=${snapshot.buildGuardrails.broadFanOutFileThreshold}, dirs>=${snapshot.buildGuardrails.broadFanOutDirectoryThreshold}`,
  );
  params.runtime.log(
    `Provider auto-pause classes: ${snapshot.providerFailureHandling.autoPauseClasses.join(", ")}`,
  );
}

function resolveOperatorStateDir(stateDir?: string): string {
  const envStateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  return path.resolve(stateDir ?? envStateDir ?? path.join(os.homedir(), ".openclaw"));
}

function resolvePublishedPullRequest(run: WorkflowRun): {
  pullRequestPublished: boolean;
  publishedPullRequestNumber: number | null;
  publishedPullRequestHasNumber: boolean;
  publishedPullRequestHasUrl: boolean;
  publishedPullRequestHasOpenedAt: boolean;
  publishedPullRequestHasTitle: boolean;
  publishedPullRequestHasBody: boolean;
  publishedPullRequestTitle: string | null;
  publishedPullRequestBody: string | null;
  publishedPullRequestBranchName: string | null;
  publishedPullRequestBaseBranch: string | null;
  publishedPullRequestUrl: string | null;
  publishedPullRequestOpenedAt: string | null;
} {
  // Workflow runs only persist one PR object. Once GitHub assigns a number or URL,
  // that same draft metadata becomes the published PR source of truth.
  const published = run.draftPullRequest?.number != null || run.draftPullRequest?.url != null;
  return {
    pullRequestPublished: published,
    publishedPullRequestNumber: published ? (run.draftPullRequest?.number ?? null) : null,
    publishedPullRequestHasNumber: published && run.draftPullRequest?.number != null,
    publishedPullRequestHasUrl: published && run.draftPullRequest?.url != null,
    publishedPullRequestHasOpenedAt: published && run.draftPullRequest?.openedAt != null,
    publishedPullRequestHasTitle:
      published && (run.draftPullRequest?.title?.trim().length ?? 0) > 0,
    publishedPullRequestHasBody: published && (run.draftPullRequest?.body?.trim().length ?? 0) > 0,
    publishedPullRequestTitle: published ? (run.draftPullRequest?.title ?? null) : null,
    publishedPullRequestBody: published ? (run.draftPullRequest?.body ?? null) : null,
    publishedPullRequestBranchName: published ? (run.draftPullRequest?.branchName ?? null) : null,
    publishedPullRequestBaseBranch: published ? (run.draftPullRequest?.baseBranch ?? null) : null,
    publishedPullRequestUrl: published ? (run.draftPullRequest?.url ?? null) : null,
    publishedPullRequestOpenedAt: published ? (run.draftPullRequest?.openedAt ?? null) : null,
  };
}

function resolveDraftPullRequestDisposition(run: WorkflowRun): {
  draftPullRequestDisposition: "published" | "skipped" | null;
  draftPullRequestDispositionReason: string | null;
} {
  const history = run.history ?? [];
  const published = resolvePublishedPullRequest(run).pullRequestPublished;
  if (published) {
    const note =
      [...history]
        .toReversed()
        .find(
          (entry) =>
            entry.startsWith("Draft PR opened:") || entry.startsWith("Pull request opened:"),
        ) ?? "Draft PR published.";
    return {
      draftPullRequestDisposition: "published",
      draftPullRequestDispositionReason: note,
    };
  }

  const skippedNote = [...history]
    .toReversed()
    .find((entry) => entry.startsWith("Draft PR skipped:"));
  if (skippedNote) {
    return {
      draftPullRequestDisposition: "skipped",
      draftPullRequestDispositionReason: skippedNote,
    };
  }

  return {
    draftPullRequestDisposition: null,
    draftPullRequestDispositionReason: null,
  };
}

function resolveChangedFileListStable(run: WorkflowRun): boolean {
  const changedFiles = run.buildResult?.changedFiles;
  if (changedFiles == null) {
    return false;
  }
  const normalized = changedFiles.map((entry) => entry.trim());
  if (normalized.some((entry) => entry.length === 0)) {
    return false;
  }
  const stable = [...new Set(normalized)].toSorted((left, right) => left.localeCompare(right));
  return (
    stable.length === normalized.length &&
    stable.every((entry, index) => entry === normalized[index])
  );
}

function resolveMergedPullRequest(run: WorkflowRun): {
  pullRequestMerged: boolean;
  mergedPullRequestMergedAt: string | null;
} {
  const merged = run.stage === "merged";
  return {
    pullRequestMerged: merged,
    mergedPullRequestMergedAt: merged ? run.updatedAt : null,
  };
}

function resolveChangeDisposition(run: WorkflowRun): {
  changeDisposition: "modified" | "no-op" | null;
  changeDispositionReason: string | null;
} {
  const history = run.history ?? [];
  if (!run.buildResult) {
    return {
      changeDisposition: null,
      changeDispositionReason: null,
    };
  }

  const noOpNote = [...history].toReversed().find((entry) => entry.startsWith("Draft PR skipped:"));
  if (noOpNote) {
    return {
      changeDisposition: "no-op",
      changeDispositionReason: noOpNote,
    };
  }

  if (run.buildResult.changedFiles.length > 0) {
    return {
      changeDisposition: "modified",
      changeDispositionReason: `Run produced ${run.buildResult.changedFiles.length} changed file(s).`,
    };
  }

  return {
    changeDisposition: "no-op",
    changeDispositionReason: "Run produced no changed files.",
  };
}

function formatWorkflowStageLabel(stage: WorkflowRun["stage"]): string {
  return stage
    .split("-")
    .map((segment) => {
      const upper = segment.toUpperCase();
      if (upper === "PR") {
        return upper;
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" ");
}

function resolveValidationIssueAgeDays(
  createdAt: string | undefined,
  now = Date.now(),
): number | null {
  if (!createdAt) {
    return null;
  }
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(((now - parsed) / 86_400_000) * 10) / 10;
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return (value?.trim().length ?? 0) > 0;
}

function resolveElapsedSeconds(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): number | null {
  if (!startedAt || !endedAt) {
    return null;
  }
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return null;
  }
  return Math.max(0, Math.floor((ended - started) / 1_000));
}

function resolveRunLastStageEnteredAt(run: WorkflowRun): string | null {
  return run.stageRecords?.at(-1)?.enteredAt ?? null;
}

async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function loadValidationIssueAssessmentContext(
  repoRoot: string,
): Promise<ValidationIssueAssessmentContext> {
  const [commandJsonSource, commandJsonTests, runJsonContractDoc] = await Promise.all([
    readOptionalTextFile(path.join(repoRoot, "src/commands/openclawcode.ts")),
    readOptionalTextFile(path.join(repoRoot, "src/commands/openclawcode.test.ts")),
    readOptionalTextFile(path.join(repoRoot, "docs/openclawcode/run-json-contract.md")),
  ]);
  return {
    commandJsonSource,
    commandJsonTests,
    runJsonContractDoc,
  };
}

function summarizeValidationIssueImplementationCounts(issues: ValidationIssueInventoryEntry[]) {
  return {
    implemented: issues.filter((issue) => issue.implementationState === "implemented").length,
    pending: issues.filter((issue) => issue.implementationState === "pending").length,
    manualReview: issues.filter((issue) => issue.implementationState === "manual-review").length,
  };
}

function resolveValidationPoolNextAction(params: {
  issues: ValidationIssueInventoryEntry[];
  closeImplemented: boolean;
  totalMissing: number;
  enforceMinimumPoolSize: boolean;
}): string {
  const closableOpenIssues = params.issues.filter(
    (issue) => issue.state === "open" && issue.autoClosable,
  );

  if (!params.closeImplemented && closableOpenIssues.length > 0) {
    return "close-implemented-validation-issues";
  }
  if (params.totalMissing > 0) {
    return params.enforceMinimumPoolSize ? "validation-pool-balanced" : "enforce-minimum-pool-size";
  }
  return "validation-pool-balanced";
}

async function listValidationIssueInventory(params: {
  owner: string;
  repo: string;
  repoRoot: string;
  state: "open" | "closed" | "all";
  github: GitHubRestClient;
}): Promise<ValidationIssueInventoryEntry[]> {
  const assessmentContext = await loadValidationIssueAssessmentContext(params.repoRoot);
  return (
    await params.github.listIssues({
      owner: params.owner,
      repo: params.repo,
      state: params.state,
    })
  )
    .flatMap((issue) => {
      const parsed = parseValidationIssue({
        title: issue.title,
        body: issue.body,
      });
      if (!parsed) {
        return [];
      }
      const assessment = assessValidationIssueImplementation(parsed, assessmentContext);
      return [
        {
          issueNumber: issue.number,
          title: issue.title,
          url: issue.url,
          state: issue.state,
          createdAt: issue.createdAt ?? null,
          updatedAt: issue.updatedAt ?? null,
          ageDays: resolveValidationIssueAgeDays(issue.createdAt),
          template: parsed.template,
          issueClass: parsed.issueClass,
          fieldName: parsed.fieldName ?? null,
          implementationState: assessment.state,
          implementationSummary: assessment.summary,
          autoClosable: assessment.autoClosable,
        },
      ];
    })
    .toSorted((left, right) => left.issueNumber - right.issueNumber);
}

function resolveValidationIssueClassCounts(issues: ValidationIssueInventoryEntry[]) {
  return {
    commandLayer: issues.filter((issue) => issue.issueClass === "command-layer").length,
    operatorDocs: issues.filter((issue) => issue.issueClass === "operator-docs").length,
    highRiskValidation: issues.filter((issue) => issue.issueClass === "high-risk-validation")
      .length,
  };
}

function resolveValidationPoolSummary(issues: ValidationIssueInventoryEntry[]) {
  const minimumPoolTargets = listValidationPoolMinimumTargets();
  const openIssues = issues.filter((issue) => issue.state === "open");
  const poolDeficits = resolveValidationPoolDeficits(openIssues).map((deficit) => ({
    issueClass: deficit.issueClass,
    minimumOpenIssues: deficit.minimumOpenIssues,
    currentOpenIssues: deficit.currentOpenIssues,
    missingIssues: deficit.missingIssues,
    rationale: deficit.rationale,
  }));
  return {
    minimumPoolTargets,
    poolDeficits,
    totalMissing: poolDeficits.reduce((sum, deficit) => sum + deficit.missingIssues, 0),
  };
}

type ValidationIssueSeedAction = {
  template: ValidationIssueTemplateId;
  issueClass: string;
  title: string;
  issueNumber: number | null;
  issueUrl: string | null;
  created: boolean;
  reusedExisting: boolean;
  dryRun: boolean;
};

async function seedValidationIssueDraft(params: {
  owner: string;
  repo: string;
  draft: ReturnType<typeof buildValidationIssueDraft>;
  dryRun: boolean;
  github: GitHubRestClient;
  existingOpenIssues?: Awaited<ReturnType<GitHubRestClient["listIssues"]>>;
}): Promise<ValidationIssueSeedAction> {
  const openIssues =
    params.existingOpenIssues ??
    (await params.github.listIssues({
      owner: params.owner,
      repo: params.repo,
      state: "open",
    }));
  const existing = openIssues
    .filter((issue) => {
      const classified = classifyValidationIssue({
        title: issue.title,
        body: issue.body,
      });
      return classified?.template === params.draft.template && issue.title === params.draft.title;
    })
    .toSorted((left, right) => left.number - right.number)[0];

  if (existing) {
    return {
      template: params.draft.template,
      issueClass: params.draft.issueClass,
      title: params.draft.title,
      issueNumber: existing.number,
      issueUrl: existing.url,
      created: false,
      reusedExisting: true,
      dryRun: params.dryRun,
    };
  }

  if (params.dryRun) {
    return {
      template: params.draft.template,
      issueClass: params.draft.issueClass,
      title: params.draft.title,
      issueNumber: null,
      issueUrl: null,
      created: false,
      reusedExisting: false,
      dryRun: true,
    };
  }

  const created = await params.github.createIssue({
    owner: params.owner,
    repo: params.repo,
    title: params.draft.title,
    body: params.draft.body,
  });
  return {
    template: params.draft.template,
    issueClass: params.draft.issueClass,
    title: params.draft.title,
    issueNumber: created.number,
    issueUrl: created.url,
    created: true,
    reusedExisting: false,
    dryRun: false,
  };
}

async function seedBalancedValidationPool(params: {
  owner: string;
  repo: string;
  repoRoot: string;
  openIssues: ValidationIssueInventoryEntry[];
  dryRun: boolean;
  github: GitHubRestClient;
}) {
  const deficits = resolveValidationPoolDeficits(params.openIssues);
  const requests = deficits.flatMap((deficit) => {
    if (deficit.missingIssues === 0) {
      return [];
    }
    return deficit.defaultSeedRequests.slice(0, deficit.missingIssues);
  });
  const existingOpenIssues = await params.github.listIssues({
    owner: params.owner,
    repo: params.repo,
    state: "open",
  });
  const actions: ValidationIssueSeedAction[] = [];
  for (const request of requests) {
    const draft = buildValidationIssueDraft(request);
    actions.push(
      await seedValidationIssueDraft({
        owner: params.owner,
        repo: params.repo,
        draft,
        dryRun: params.dryRun,
        github: params.github,
        existingOpenIssues,
      }),
    );
  }

  return {
    deficits,
    actions,
  };
}

function resolveRunSummary(run: WorkflowRun): string {
  if (run.verificationReport?.summary) {
    return run.verificationReport.summary;
  }

  if (run.buildResult?.summary) {
    return run.buildResult.summary;
  }

  return `Run is at the ${run.stage} stage.`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isAcceptanceCriteriaPatch(
  value: unknown,
): value is ExecutionSpec["acceptanceCriteria"] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry != null &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.text === "string" &&
        typeof entry.required === "boolean",
    )
  );
}

async function resolvePlanEditPatch(params: {
  repoRoot: string;
  planEditFile: string | undefined;
}): Promise<{ patch: Partial<ExecutionSpec>; source: string } | undefined> {
  if (!params.planEditFile) {
    return undefined;
  }

  const resolvedPath = path.resolve(params.repoRoot, params.planEditFile);
  const raw = JSON.parse(await readFile(resolvedPath, "utf8")) as Record<string, unknown>;
  if (raw == null || Array.isArray(raw) || typeof raw !== "object") {
    throw new Error("Plan edit file must contain a JSON object.");
  }

  const patch: Partial<ExecutionSpec> = {};
  const allowedKeys = new Set([
    "summary",
    "scope",
    "outOfScope",
    "acceptanceCriteria",
    "testPlan",
    "risks",
    "assumptions",
    "openQuestions",
    "riskLevel",
  ] satisfies Array<keyof ExecutionSpec>);

  for (const [key, value] of Object.entries(raw)) {
    if (!allowedKeys.has(key as keyof ExecutionSpec)) {
      throw new Error(`Unsupported plan edit field: ${key}`);
    }

    switch (key) {
      case "summary":
        if (typeof value !== "string") {
          throw new Error("Plan edit field 'summary' must be a string.");
        }
        patch.summary = value;
        break;
      case "scope":
      case "outOfScope":
      case "testPlan":
      case "risks":
      case "assumptions":
      case "openQuestions":
        if (!isStringArray(value)) {
          throw new Error(`Plan edit field '${key}' must be an array of strings.`);
        }
        patch[key] = value;
        break;
      case "acceptanceCriteria":
        if (!isAcceptanceCriteriaPatch(value)) {
          throw new Error(
            "Plan edit field 'acceptanceCriteria' must be an array of { id, text, required } objects.",
          );
        }
        patch.acceptanceCriteria = value;
        break;
      case "riskLevel":
        if (value !== "low" && value !== "medium" && value !== "high") {
          throw new Error("Plan edit field 'riskLevel' must be one of: low, medium, high.");
        }
        patch.riskLevel = value;
        break;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("Plan edit file did not contain any supported plan fields.");
  }

  return {
    patch,
    source: resolvedPath,
  };
}

function resolveVerificationApprovedForHumanReview(run: WorkflowRun): boolean | null {
  const decision = run.verificationReport?.decision;
  if (!decision) {
    return null;
  }

  return decision === "approve-for-human-review";
}

function resolveRerunContext(opts: OpenClawCodeRunOpts): WorkflowRerunContext | undefined {
  if (
    !opts.rerunReason &&
    !opts.rerunPriorRunId &&
    !opts.rerunPriorStage &&
    !opts.rerunReviewDecision &&
    !opts.rerunReviewSubmittedAt &&
    !opts.rerunReviewSummary &&
    !opts.rerunReviewUrl
  ) {
    return undefined;
  }

  return {
    reason: opts.rerunReason ?? "Manual rerun requested.",
    requestedAt: opts.rerunRequestedAt ?? new Date().toISOString(),
    priorRunId: opts.rerunPriorRunId,
    priorStage: opts.rerunPriorStage,
    reviewDecision: opts.rerunReviewDecision,
    reviewSubmittedAt: opts.rerunReviewSubmittedAt,
    reviewSummary: opts.rerunReviewSummary,
    reviewUrl: opts.rerunReviewUrl,
    requestedCoderAgentId: opts.rerunRequestedCoderAgentId,
    requestedVerifierAgentId: opts.rerunRequestedVerifierAgentId,
  };
}

const CLI_REROUTEABLE_STAGES = new Set<WorkflowRun["stage"]>([
  "awaiting-plan-approval",
  "changes-requested",
  "ready-for-human-review",
  "escalated",
  "failed",
]);

function formatStageLabel(stage: string): string {
  return stage
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function resolveSnapshotRerunReason(snapshot: OpenClawCodeIssueStatusSnapshot): string {
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

function resolveQueuedNotificationDestination(params: {
  repoConfig: OpenClawCodeChatopsRepoConfig;
  binding?: OpenClawCodeRepoNotificationBinding;
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

function formatRuntimeOverrideSummary(params: {
  coderAgentId?: string;
  verifierAgentId?: string;
}): string {
  const parts = [
    params.coderAgentId?.trim() ? `coder -> ${params.coderAgentId.trim()}` : undefined,
    params.verifierAgentId?.trim() ? `verifier -> ${params.verifierAgentId.trim()}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (parts.length === 0) {
    throw new Error("Pass --coder-agent and/or --verifier-agent.");
  }
  return parts.join(", ");
}

function appendRerouteAuditDetail(base: string, params: { actor?: string; note?: string }): string {
  const detail = [
    params.actor?.trim() ? `requested by ${params.actor.trim()}` : undefined,
    params.note?.trim() ? `note: ${params.note.trim()}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
  return detail ? `${base} (${detail})` : base;
}

function buildRerouteResultSummary(params: {
  issueKey: string;
  outcome: "deferred" | "queued-update" | "queued-rerun" | "blocked";
  outcomeDetail: string;
  runtimeOverrideSummary: string;
  stage?: WorkflowRun["stage"];
  runId?: string;
  notifyChannel?: string;
  notifyTarget?: string;
  status?: string | null;
}): Record<string, unknown> {
  return {
    contractVersion: OPENCLAWCODE_REROUTE_RUN_JSON_CONTRACT_VERSION,
    issueKey: params.issueKey,
    outcome: params.outcome,
    detail: params.outcomeDetail,
    runtimeOverrideSummary: params.runtimeOverrideSummary,
    stage: params.stage ?? null,
    runId: params.runId ?? null,
    notifyChannel: params.notifyChannel ?? null,
    notifyTarget: params.notifyTarget ?? null,
    status: params.status ?? null,
  };
}

function resolveRoleRouteAdapter(run: WorkflowRun, roleId: string): string | null {
  return run.roleRouting?.routes.find((route) => route.roleId === roleId)?.adapterId ?? null;
}

function resolveRuntimeRoutingSelection(run: WorkflowRun, roleId: string) {
  return run.runtimeRouting?.selections.find((selection) => selection.roleId === roleId) ?? null;
}

function resolveStageGateReadiness(run: WorkflowRun, gateId: string): string | null {
  return run.stageGates?.gates.find((gate) => gate.gateId === gateId)?.readiness ?? null;
}

async function toWorkflowRunJson(run: WorkflowRun, repoRoot?: string) {
  const workspace = run.workspace;
  const operatorProgram = buildOperatorProgramSummary(
    await readProjectOperatorProgram(repoRoot ?? workspace?.repoRoot ?? process.cwd()),
  );
  const autoMergePolicy = resolveAutoMergePolicy(run);
  const autoMergeDisposition = resolveAutoMergeDisposition(run);
  const publishedPullRequest = resolvePublishedPullRequest(run);
  const draftPullRequestDisposition = resolveDraftPullRequestDisposition(run);
  const changeDisposition = resolveChangeDisposition(run);
  const mergedPullRequest = resolveMergedPullRequest(run);
  const rerunHasReviewContext =
    run.rerunContext?.reviewDecision != null ||
    run.rerunContext?.reviewSubmittedAt != null ||
    run.rerunContext?.reviewSummary != null ||
    run.rerunContext?.reviewUrl != null;
  const runHasUpdatedAt =
    run.updatedAt === true ||
    (Array.isArray(run.updatedAt) && run.updatedAt.length > 0) ||
    (typeof run.updatedAt === "string" && run.updatedAt.length > 0);
  const latestPlanEdit = run.planEdits?.at(-1) ?? null;
  const qualityGate = deriveWorkflowQualityGate(run);
  const preCodeDiscipline = deriveWorkflowPreCodeDiscipline(run);
  const loopHealth = deriveWorkflowLoopHealth(run);
  return {
    ...run,
    contractVersion: OPENCLAWCODE_RUN_JSON_CONTRACT_VERSION,
    runCreatedAt: run.createdAt ?? null,
    runUpdatedAt: typeof run.updatedAt === "string" ? run.updatedAt : null,
    runHasUpdatedAt,
    runAgeSeconds: resolveElapsedSeconds(run.createdAt, run.updatedAt),
    issueNumber: run.issue.number ?? null,
    issueLabelCount: run.issue.labels?.length ?? null,
    issueHasLabels: (run.issue.labels?.length ?? 0) > 0,
    issueLabelListPresent: run.issue.labels != null,
    issueFirstLabel: run.issue.labels?.at(0) ?? null,
    issueLastLabel: run.issue.labels?.at(-1) ?? null,
    issueHasBody: (run.issue.body?.trim().length ?? 0) > 0,
    issueBodyLength: run.issue.body?.length ?? null,
    issueTitleLength: run.issue.title?.length ?? null,
    issueUrl: run.issue.url ?? null,
    issueTitle: run.issue.title ?? null,
    issueRepo: run.issue.repo ?? null,
    issueOwner: run.issue.owner ?? null,
    issueRepoOwnerPair:
      run.issue.owner != null && run.issue.repo != null
        ? `${run.issue.owner}/${run.issue.repo}`
        : null,
    stageLabel: formatWorkflowStageLabel(run.stage),
    totalAttemptCount: run.attempts?.total ?? null,
    planningAttemptCount: run.attempts?.planning ?? null,
    buildAttemptCount: run.attempts?.building ?? null,
    verificationAttemptCount: run.attempts?.verifying ?? null,
    buildSummary: run.buildResult?.summary ?? null,
    buildHasSignals:
      run.buildResult?.summary === true || (run.buildResult?.summary?.length ?? 0) > 0,
    buildSummaryPresent: (run.buildResult?.summary?.length ?? 0) > 0,
    changedFiles: run.buildResult?.changedFiles ?? [],
    changedFilesPresent: (run.buildResult?.changedFiles.length ?? 0) > 0,
    changedFileListStable: resolveChangedFileListStable(run),
    changedFileCount: run.buildResult?.changedFiles.length ?? null,
    buildPolicySignals: run.buildResult?.policySignals ?? null,
    buildPolicySignalsPresent: run.buildResult?.policySignals != null,
    buildChangedLineCount: run.buildResult?.policySignals?.changedLineCount ?? null,
    buildChangedDirectoryCount: run.buildResult?.policySignals?.changedDirectoryCount ?? null,
    buildBroadFanOut: run.buildResult?.policySignals?.broadFanOut ?? null,
    buildLargeDiff: run.buildResult?.policySignals?.largeDiff ?? null,
    buildGeneratedFilesPresent: (run.buildResult?.policySignals?.generatedFiles.length ?? 0) > 0,
    buildGeneratedFiles: run.buildResult?.policySignals?.generatedFiles ?? null,
    buildGeneratedFileCount: run.buildResult?.policySignals?.generatedFiles.length ?? null,
    qualityGate,
    qualityGateStatus: qualityGate.status,
    qualityGateSummary: qualityGate.summary,
    qualityGateBlockingReasons: qualityGate.blockingReasons,
    qualityGateBlockingReasonCount: qualityGate.blockingReasons.length,
    qualityGateWarnings: qualityGate.warningReasons,
    qualityGateWarningCount: qualityGate.warningReasons.length,
    qualityGateHasWarnings: qualityGate.warningReasons.length > 0,
    qualityGateHasFailures: qualityGate.blockingReasons.length > 0,
    preCodeDiscipline,
    preCodeDisciplineStatus: preCodeDiscipline.status,
    preCodeDisciplineSummary: preCodeDiscipline.summary,
    preCodeDisciplineBlockingReasons: preCodeDiscipline.blockingReasons,
    preCodeDisciplineBlockingReasonCount: preCodeDiscipline.blockingReasons.length,
    preCodeDisciplineWarnings: preCodeDiscipline.warningReasons,
    preCodeDisciplineWarningCount: preCodeDiscipline.warningReasons.length,
    preCodeDisciplinePlanStatus: preCodeDiscipline.planStatus,
    preCodeDisciplineExecutionSpecPresent: preCodeDiscipline.executionSpecPresent,
    preCodeDisciplineTestIntentPresent: preCodeDiscipline.testIntentPresent,
    preCodeDisciplineTestIntentCount: preCodeDiscipline.testIntentCount,
    preCodeDisciplinePlanApprovalRequired: preCodeDiscipline.planApprovalRequired,
    preCodeDisciplinePlanEdited: preCodeDiscipline.planEdited,
    preCodeDisciplineIsolatedWorktreePrepared: preCodeDiscipline.isolatedWorktreePrepared,
    preCodeDisciplineModeSpecificContextsPresent: preCodeDiscipline.modeSpecificContextsPresent,
    preCodeDisciplineFreshRoleExecutionPresent: preCodeDiscipline.freshRoleExecutionPresent,
    loopHealth,
    loopHealthStatus: loopHealth.status,
    loopHealthSummary: loopHealth.summary,
    loopHealthBlockingReasons: loopHealth.blockingReasons,
    loopHealthBlockingReasonCount: loopHealth.blockingReasons.length,
    loopHealthWarnings: loopHealth.warningReasons,
    loopHealthWarningCount: loopHealth.warningReasons.length,
    loopHealthFailureSummary: loopHealth.failureSummary,
    loopHealthPromptFootprintChars: loopHealth.promptFootprintChars,
    loopHealthBootstrapWarningShown: loopHealth.bootstrapWarningShown,
    loopHealthInjectedWorkspaceFileCount: loopHealth.injectedWorkspaceFileCount,
    loopHealthLastCallUsageTotal: loopHealth.lastCallUsageTotal,
    changeDisposition: changeDisposition.changeDisposition,
    changeDispositionReason: changeDisposition.changeDispositionReason,
    issueClassification: run.buildResult?.issueClassification ?? null,
    scopeCheck: run.buildResult?.scopeCheck ?? null,
    scopeCheckSummary: run.buildResult?.scopeCheck?.summary ?? null,
    scopeCheckSummaryPresent: (run.buildResult?.scopeCheck?.summary?.length ?? 0) > 0,
    scopeCheckPassed: run.buildResult?.scopeCheck?.ok ?? null,
    scopeCheckHasBlockedFiles:
      run.buildResult?.scopeCheck == null
        ? false
        : run.buildResult.scopeCheck.blockedFiles.length > 0,
    scopeBlockedFilesPresent: (run.buildResult?.scopeCheck?.blockedFiles.length ?? 0) > 0,
    scopeBlockedFiles: run.buildResult?.scopeCheck?.blockedFiles ?? null,
    scopeBlockedFileCount: run.buildResult?.scopeCheck?.blockedFiles.length ?? null,
    scopeBlockedFirstFile: run.buildResult?.scopeCheck?.blockedFiles.at(0) ?? null,
    scopeBlockedLastFile: run.buildResult?.scopeCheck?.blockedFiles.at(-1) ?? null,
    testCommandsPresent: (run.buildResult?.testCommands.length ?? 0) > 0,
    testCommandCount: run.buildResult?.testCommands.length ?? null,
    testResultsPresent: (run.buildResult?.testResults.length ?? 0) > 0,
    testResultCount: run.buildResult?.testResults.length ?? null,
    notesPresent: (run.buildResult?.notes.length ?? 0) > 0,
    noteCount: run.buildResult?.notes.length ?? null,
    failureDiagnostics: run.failureDiagnostics ?? null,
    failureDiagnosticsPresent: run.failureDiagnostics != null,
    failureDiagnosticsSummary: run.failureDiagnostics?.summary ?? null,
    failureDiagnosticSummaryPresent: hasNonEmptyText(run.failureDiagnostics?.summary),
    failureDiagnosticProvider: run.failureDiagnostics?.provider ?? null,
    failureDiagnosticProviderPresent: hasNonEmptyText(run.failureDiagnostics?.provider),
    failureDiagnosticModel: run.failureDiagnostics?.model ?? null,
    failureDiagnosticModelPresent: hasNonEmptyText(run.failureDiagnostics?.model),
    failureDiagnosticSystemPromptChars: run.failureDiagnostics?.systemPromptChars ?? null,
    failureDiagnosticSkillsPromptChars: run.failureDiagnostics?.skillsPromptChars ?? null,
    failureDiagnosticToolSchemaChars: run.failureDiagnostics?.toolSchemaChars ?? null,
    failureDiagnosticSkillCount: run.failureDiagnostics?.skillCount ?? null,
    failureDiagnosticInjectedWorkspaceFileCount:
      run.failureDiagnostics?.injectedWorkspaceFileCount ?? null,
    failureDiagnosticBootstrapWarningShown: run.failureDiagnostics?.bootstrapWarningShown ?? false,
    failureDiagnosticToolCount: run.failureDiagnostics?.toolCount ?? null,
    failureDiagnosticUsageTotal: run.failureDiagnostics?.lastCallUsageTotal ?? null,
    blueprintContext: run.blueprintContext ?? null,
    blueprintStatus: run.blueprintContext?.status ?? null,
    blueprintRevisionId: run.blueprintContext?.revisionId ?? null,
    blueprintAgreed: run.blueprintContext?.agreed ?? null,
    blueprintDefaultedSectionCount: run.blueprintContext?.defaultedSectionCount ?? null,
    blueprintWorkstreamCandidateCount: run.blueprintContext?.workstreamCandidateCount ?? null,
    blueprintOpenQuestionCount: run.blueprintContext?.openQuestionCount ?? null,
    blueprintHumanGateCount: run.blueprintContext?.humanGateCount ?? null,
    operatorProgram,
    operatorProgramAvailable: operatorProgram.available,
    operatorProgramArtifactPath: operatorProgram.artifactPath,
    operatorProgramUpdatedAt: operatorProgram.updatedAt,
    operatorProgramTitle: operatorProgram.title,
    operatorProgramSummary: operatorProgram.summary,
    operatorProgramMutableSurfaceMode: operatorProgram.mutableSurfaceMode,
    operatorProgramMutableSurfacePathCount: operatorProgram.mutableSurfacePathCount,
    operatorProgramMutableSurfacePathsPresent: operatorProgram.mutableSurfacePathsPresent,
    operatorProgramValidationBudgetSummary: operatorProgram.validationBudgetSummary,
    operatorProgramValidationBudgetMaxPrimaryCommands:
      operatorProgram.validationBudgetMaxPrimaryCommands,
    operatorProgramRequireOneExecutableProof: operatorProgram.requireOneExecutableProof,
    operatorProgramAdvancementRuleSummary: operatorProgram.advancementRuleSummary,
    operatorProgramKeepCriteriaCount: operatorProgram.keepCriteriaCount,
    operatorProgramDiscardCriteriaCount: operatorProgram.discardCriteriaCount,
    operatorProgramRetryCriteriaCount: operatorProgram.retryCriteriaCount,
    operatorProgramSimplificationBias: operatorProgram.simplificationBias,
    operatorProgramAttemptLedgerRequired: operatorProgram.attemptLedgerRequired,
    operatorProgramNextActionCode: operatorProgram.nextActionCode,
    operatorProgramNextActionSummary: operatorProgram.nextActionSummary,
    operatorProgramLinkedBlueprintPath: operatorProgram.linkedBlueprintPath,
    operatorProgramLinkedWorkItemsPath: operatorProgram.linkedWorkItemsPath,
    operatorProgramLinkedStageGatesPath: operatorProgram.linkedStageGatesPath,
    roleRouting: run.roleRouting ?? null,
    roleRoutingMixedMode: run.roleRouting?.mixedMode ?? null,
    roleRoutingFallbackConfigured: run.roleRouting?.fallbackConfigured ?? null,
    roleRoutingUnresolvedRoleCount: run.roleRouting?.unresolvedRoleCount ?? null,
    roleRoutingPlannerAdapter: resolveRoleRouteAdapter(run, "planner"),
    roleRoutingCoderAdapter: resolveRoleRouteAdapter(run, "coder"),
    roleRoutingReviewerAdapter: resolveRoleRouteAdapter(run, "reviewer"),
    roleRoutingVerifierAdapter: resolveRoleRouteAdapter(run, "verifier"),
    roleRoutingDocWriterAdapter: resolveRoleRouteAdapter(run, "docWriter"),
    runtimeRouting: run.runtimeRouting ?? null,
    runtimeRoutingSelectionCount: run.runtimeRouting?.selections.length ?? null,
    runtimeRoutingCoderAgentId:
      resolveRuntimeRoutingSelection(run, "coder")?.appliedAgentId ?? null,
    runtimeRoutingCoderAgentSource:
      resolveRuntimeRoutingSelection(run, "coder")?.agentSource ?? null,
    runtimeRoutingVerifierAgentId:
      resolveRuntimeRoutingSelection(run, "verifier")?.appliedAgentId ?? null,
    runtimeRoutingVerifierAgentSource:
      resolveRuntimeRoutingSelection(run, "verifier")?.agentSource ?? null,
    stageGates: run.stageGates ?? null,
    stageGateBlockedGateCount: run.stageGates?.blockedGateCount ?? null,
    stageGateNeedsHumanDecisionCount: run.stageGates?.needsHumanDecisionCount ?? null,
    goalAgreementStageGateReadiness: resolveStageGateReadiness(run, "goal-agreement"),
    workItemProjectionStageGateReadiness: resolveStageGateReadiness(run, "work-item-projection"),
    executionRoutingStageGateReadiness: resolveStageGateReadiness(run, "execution-routing"),
    executionStartStageGateReadiness: resolveStageGateReadiness(run, "execution-start"),
    mergePromotionStageGateReadiness: resolveStageGateReadiness(run, "merge-promotion"),
    planReview: run.planReview ?? null,
    planApprovalRequired: run.planReview?.required ?? false,
    planApprovalStatus: run.planReview?.status ?? null,
    planApprovalPending: run.planReview?.status === "awaiting-approval",
    planApprovalApproved: run.planReview?.status === "approved",
    planDigest: run.planReview?.planDigest ?? null,
    planDigestPresent: hasNonEmptyText(run.planReview?.planDigest),
    planApprovalRequestedAt: run.planReview?.requestedAt ?? null,
    planApprovalSuppliedDigest: run.planReview?.suppliedDigest ?? null,
    planApprovalSuppliedDigestMatches:
      run.planReview?.suppliedDigest == null
        ? null
        : run.planReview.suppliedDigest === run.planReview.planDigest,
    planApprovedAt: run.planReview?.approvedAt ?? null,
    planApprovedBy: run.planReview?.approvedBy ?? null,
    planApprovalSource: run.planReview?.approvalSource ?? null,
    planApprovalNote: run.planReview?.approvalNote ?? null,
    planEditCount: run.planEdits?.length ?? 0,
    planEdited: (run.planEdits?.length ?? 0) > 0,
    planLastEditedAt: latestPlanEdit?.appliedAt ?? null,
    planLastEditedBy: latestPlanEdit?.actor ?? null,
    planLastEditSource: latestPlanEdit?.source ?? null,
    planLastEditNote: latestPlanEdit?.note ?? null,
    planLastEditedFields: latestPlanEdit?.editedFields ?? [],
    planLastEditedFieldCount: latestPlanEdit?.editedFields.length ?? 0,
    suitabilityDecision: run.suitability?.decision ?? null,
    suitabilityDecisionIsAutoRun: run.suitability?.decision === "auto-run",
    suitabilityDecisionIsNeedsHumanReview: run.suitability?.decision === "needs-human-review",
    suitabilityDecisionIsEscalate: run.suitability?.decision === "escalate",
    suitabilitySummary: run.suitability?.summary ?? null,
    suitabilitySummaryPresent: (run.suitability?.summary?.length ?? 0) > 0,
    suitabilityReasons: run.suitability?.reasons ?? null,
    suitabilityReasonsPresent: (run.suitability?.reasons.length ?? 0) > 0,
    suitabilityReasonCount: run.suitability?.reasons.length ?? null,
    suitabilityClassification: run.suitability?.classification ?? null,
    suitabilityRiskLevel: run.suitability?.riskLevel ?? null,
    suitabilityEvaluatedAt: run.suitability?.evaluatedAt ?? null,
    suitabilityAllowlisted: run.suitability?.allowlisted ?? false,
    suitabilityDenylisted: run.suitability?.denylisted ?? false,
    suitabilityOverrideApplied: run.suitability?.overrideApplied ?? false,
    suitabilityOriginalDecision: run.suitability?.originalDecision ?? null,
    acceptanceCriteriaPresent: (run.executionSpec?.acceptanceCriteria.length ?? 0) > 0,
    acceptanceCriteriaCount: run.executionSpec?.acceptanceCriteria.length ?? null,
    openQuestionsPresent: (run.executionSpec?.openQuestions.length ?? 0) > 0,
    openQuestionCount: run.executionSpec?.openQuestions.length ?? null,
    risksPresent: (run.executionSpec?.risks.length ?? 0) > 0,
    riskCount: run.executionSpec?.risks.length ?? null,
    assumptionsPresent: (run.executionSpec?.assumptions.length ?? 0) > 0,
    assumptionCount: run.executionSpec?.assumptions.length ?? null,
    testPlanPresent: (run.executionSpec?.testPlan.length ?? 0) > 0,
    testPlanCount: run.executionSpec?.testPlan.length ?? null,
    scopeItemsPresent: (run.executionSpec?.scope.length ?? 0) > 0,
    scopeItemCount: run.executionSpec?.scope.length ?? null,
    outOfScopePresent: (run.executionSpec?.outOfScope.length ?? 0) > 0,
    outOfScopeCount: run.executionSpec?.outOfScope.length ?? null,
    workspaceBaseBranch: workspace?.baseBranch ?? null,
    workspaceBranchName: workspace?.branchName ?? null,
    workspaceBranchMatchesIssue:
      run.issue.number != null
        ? (workspace?.branchName?.endsWith(`issue-${run.issue.number}`) ?? false)
        : false,
    workspaceRepoRoot: workspace?.repoRoot ?? null,
    workspaceRepoRootPresent: (workspace?.repoRoot?.trim().length ?? 0) > 0,
    workspaceHasPreparedAt: workspace?.preparedAt != null,
    workspacePreparedAt: workspace?.preparedAt ?? null,
    workspaceHasWorktreePath: workspace?.worktreePath != null,
    workspaceWorktreePath: workspace?.worktreePath ?? null,
    draftPullRequestHasTitle: (run.draftPullRequest?.title?.trim().length ?? 0) > 0,
    draftPullRequestHasBody: (run.draftPullRequest?.body?.trim().length ?? 0) > 0,
    draftPullRequestHasOpenedAt: run.draftPullRequest?.openedAt != null,
    draftPullRequestTitle: run.draftPullRequest?.title ?? null,
    draftPullRequestBody: run.draftPullRequest?.body ?? null,
    draftPullRequestOpenedAt: run.draftPullRequest?.openedAt ?? null,
    draftPullRequestBranchName: run.draftPullRequest?.branchName ?? null,
    draftPullRequestBaseBranch: run.draftPullRequest?.baseBranch ?? null,
    draftPullRequestHasNumber: run.draftPullRequest?.number != null,
    draftPullRequestNumber: run.draftPullRequest?.number ?? null,
    publishedPullRequestNumber: publishedPullRequest.publishedPullRequestNumber,
    draftPullRequestHasUrl: run.draftPullRequest?.url != null,
    draftPullRequestUrl: run.draftPullRequest?.url ?? null,
    draftPullRequestDisposition: draftPullRequestDisposition.draftPullRequestDisposition,
    draftPullRequestDispositionReason:
      draftPullRequestDisposition.draftPullRequestDispositionReason,
    pullRequestPublished: publishedPullRequest.pullRequestPublished,
    publishedPullRequestTitle: publishedPullRequest.publishedPullRequestTitle,
    publishedPullRequestBody: publishedPullRequest.publishedPullRequestBody,
    publishedPullRequestHasNumber: publishedPullRequest.publishedPullRequestHasNumber,
    publishedPullRequestHasUrl: publishedPullRequest.publishedPullRequestHasUrl,
    publishedPullRequestHasOpenedAt: publishedPullRequest.publishedPullRequestHasOpenedAt,
    publishedPullRequestHasTitle: publishedPullRequest.publishedPullRequestHasTitle,
    publishedPullRequestHasBody: publishedPullRequest.publishedPullRequestHasBody,
    publishedPullRequestBranchName: publishedPullRequest.publishedPullRequestBranchName,
    publishedPullRequestBaseBranch: publishedPullRequest.publishedPullRequestBaseBranch,
    publishedPullRequestUrl: publishedPullRequest.publishedPullRequestUrl,
    publishedPullRequestOpenedAt: publishedPullRequest.publishedPullRequestOpenedAt,
    pullRequestMerged: mergedPullRequest.pullRequestMerged,
    mergedPullRequestMergedAt: mergedPullRequest.mergedPullRequestMergedAt,
    verificationDecision: run.verificationReport?.decision ?? null,
    verificationDecisionIsApprove: run.verificationReport?.decision === "approve-for-human-review",
    verificationDecisionIsRequestChanges: run.verificationReport?.decision === "request-changes",
    verificationDecisionIsEscalate: run.verificationReport?.decision === "escalate",
    verificationApprovedForHumanReview: resolveVerificationApprovedForHumanReview(run),
    verificationSummary: run.verificationReport?.summary ?? null,
    verificationSummaryPresent: (run.verificationReport?.summary?.length ?? 0) > 0,
    verificationHasFindings:
      run.verificationReport == null ? false : run.verificationReport.findings.length > 0,
    verificationFindingsPresent:
      run.verificationReport == null ? false : run.verificationReport.findings.length > 0,
    verificationHasMissingCoverage:
      run.verificationReport == null ? false : run.verificationReport.missingCoverage.length > 0,
    verificationMissingCoveragePresent:
      run.verificationReport == null ? false : run.verificationReport.missingCoverage.length > 0,
    verificationHasSignals:
      run.verificationReport == null
        ? false
        : (run.verificationReport.summary?.length ?? 0) > 0 ||
          run.verificationReport.findings.length > 0 ||
          run.verificationReport.missingCoverage.length > 0 ||
          run.verificationReport.followUps.length > 0,
    verificationHasFollowUps:
      run.verificationReport == null ? false : run.verificationReport.followUps.length > 0,
    verificationFollowUpsPresent:
      run.verificationReport == null ? false : run.verificationReport.followUps.length > 0,
    verificationFindingCount: run.verificationReport?.findings.length ?? null,
    verificationMissingCoverageCount: run.verificationReport?.missingCoverage.length ?? null,
    verificationFollowUpCount: run.verificationReport?.followUps.length ?? null,
    runLastStageEnteredAt: resolveRunLastStageEnteredAt(run),
    runHasHistory: (run.history?.length ?? 0) > 0,
    runHasStageRecords: (run.stageRecords?.length ?? 0) > 0,
    runHistoryTextPresent: run.history?.some((entry) => hasNonEmptyText(entry)) ?? false,
    stageRecordCount: run.stageRecords?.length ?? null,
    historyEntryCount: run.history?.length ?? null,
    rerunRequested: Boolean(run.rerunContext),
    rerunHasReviewContext,
    rerunReason: run.rerunContext?.reason ?? null,
    rerunReasonPresent: hasNonEmptyText(run.rerunContext?.reason),
    rerunRequestedAt: run.rerunContext?.requestedAt ?? null,
    rerunPriorRunId: run.rerunContext?.priorRunId ?? null,
    rerunPriorStage: run.rerunContext?.priorStage ?? null,
    rerunReviewDecision: run.rerunContext?.reviewDecision ?? null,
    rerunReviewDecisionPresent: run.rerunContext?.reviewDecision != null,
    rerunReviewSubmittedAt: run.rerunContext?.reviewSubmittedAt ?? null,
    rerunReviewSummary: run.rerunContext?.reviewSummary ?? null,
    rerunReviewSummaryPresent: hasNonEmptyText(run.rerunContext?.reviewSummary),
    rerunReviewUrl: run.rerunContext?.reviewUrl ?? null,
    rerunReviewUrlPresent: hasNonEmptyText(run.rerunContext?.reviewUrl),
    rerunRequestedCoderAgentId: run.rerunContext?.requestedCoderAgentId ?? null,
    rerunRequestedVerifierAgentId: run.rerunContext?.requestedVerifierAgentId ?? null,
    rerunManualTakeoverRequestedAt: run.rerunContext?.manualTakeoverRequestedAt ?? null,
    rerunManualTakeoverActor: run.rerunContext?.manualTakeoverActor ?? null,
    rerunManualTakeoverWorktreePath: run.rerunContext?.manualTakeoverWorktreePath ?? null,
    rerunManualResumeNote: run.rerunContext?.manualResumeNote ?? null,
    runSummary: resolveRunSummary(run),
    autoMergeDisposition: autoMergeDisposition.autoMergeDisposition,
    autoMergeDispositionReason: autoMergeDisposition.autoMergeDispositionReason,
    autoMergePolicyEligible: autoMergePolicy.autoMergePolicyEligible,
    autoMergePolicyReason: autoMergePolicy.autoMergePolicyReason,
  };
}

export async function openclawCodeRunCommand(
  opts: OpenClawCodeRunOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const issueNumber = parseIssueNumber(opts.issue);
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const operatorStateDir = resolveOperatorStateDir();
  const operatorRepoConfig = await resolveOperatorRepoConfig({
    operatorStateDir,
    repoRoot,
    repoRef,
  });
  const stateDir = path.resolve(opts.stateDir ?? path.join(repoRoot, ".openclawcode"));
  const shellRunner = new HostShellRunner();
  const worktreeManager = new GitWorktreeManager();
  const github = new GitHubRestClient();
  const planner = new HeuristicPlanner();
  const agentRunner = new OpenClawAgentRunner();
  const testCommands = opts.test?.length ? opts.test : (operatorRepoConfig?.testCommands ?? []);
  const builderTimeoutSeconds = resolvePositiveTimeoutSeconds({
    envName: OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS_ENV,
    fallback: DEFAULT_OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS,
  });
  const verifierTimeoutSeconds = resolvePositiveTimeoutSeconds({
    envName: OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS_ENV,
    fallback: DEFAULT_OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS,
  });
  const builder = new AgentBackedBuilder({
    agentRunner,
    shellRunner,
    testCommands,
    agentId: opts.builderAgent ?? operatorRepoConfig?.builderAgent,
    timeoutSeconds: builderTimeoutSeconds,
    collectChangedFiles: async (run) => {
      if (!run.workspace) {
        return [];
      }
      return await worktreeManager.collectChangedFiles(run.workspace);
    },
  });
  const verifier = new AgentBackedVerifier({
    agentRunner,
    agentId: opts.verifierAgent ?? operatorRepoConfig?.verifierAgent,
    timeoutSeconds: verifierTimeoutSeconds,
  });
  const store = new FileSystemWorkflowRunStore(path.join(stateDir, "runs"));
  const planEditPatch = await resolvePlanEditPatch({
    repoRoot,
    planEditFile: opts.planEditFile,
  });

  const run = await runIssueWorkflow(
    {
      owner: repoRef.owner,
      repo: repoRef.repo,
      issueNumber,
      repoRoot,
      stateDir,
      baseBranch: opts.baseBranch ?? "main",
      branchName: opts.branchName,
      openPullRequest: Boolean(opts.openPr),
      mergeOnApprove: Boolean(opts.mergeOnApprove),
      requirePlanApproval: Boolean(opts.requirePlanApproval || opts.approvePlanDigest),
      approvePlanDigest: opts.approvePlanDigest,
      planApprovalActor: opts.planApprovalActor,
      planApprovalNote: opts.planApprovalNote,
      planApprovalSource: opts.approvePlanDigest ? "cli" : undefined,
      planEdit: planEditPatch?.patch,
      planEditActor: opts.planEditActor,
      planEditNote: opts.planEditNote,
      planEditSource: planEditPatch?.source,
      suitabilityOverride:
        opts.suitabilityOverrideActor || opts.suitabilityOverrideReason
          ? {
              actor: opts.suitabilityOverrideActor,
              reason: opts.suitabilityOverrideReason,
            }
          : undefined,
      rerunContext: resolveRerunContext(opts),
    },
    {
      github,
      planner,
      builder,
      verifier,
      store,
      worktreeManager,
      shellRunner,
      publisher: opts.openPr ? new GitHubPullRequestPublisher(github, shellRunner) : undefined,
      merger: opts.mergeOnApprove ? new GitHubPullRequestMerger(github) : undefined,
    },
  );

  if (opts.json) {
    runtime.log(JSON.stringify(await toWorkflowRunJson(run, repoRoot), null, 2));
    return;
  }

  runtime.log(`Run: ${run.id}`);
  runtime.log(`Stage: ${run.stage}`);
  const preCodeDiscipline = deriveWorkflowPreCodeDiscipline(run);
  runtime.log(`Pre-code discipline: ${preCodeDiscipline.status} | ${preCodeDiscipline.summary}`);
  if (run.planEdits?.length) {
    const latestEdit = run.planEdits.at(-1);
    runtime.log(`Plan Edited: ${latestEdit?.editedFields.join(", ")}`);
  }
  if (run.planReview?.planDigest) {
    runtime.log(`Plan Digest: ${run.planReview.planDigest}`);
  }
  if (run.stage === "awaiting-plan-approval" && run.planReview?.planDigest) {
    runtime.log("Plan Approval: required before workspace preparation and code execution.");
    runtime.log(
      `Approve: openclaw code run --issue ${issueNumber} --repo-root ${repoRoot} --require-plan-approval --approve-plan-digest ${run.planReview.planDigest}`,
    );
  }
  if (run.workspace) {
    runtime.log(`Worktree: ${run.workspace.worktreePath}`);
    runtime.log(`Branch: ${run.workspace.branchName}`);
  }
  if (run.draftPullRequest?.url) {
    runtime.log(`Draft PR: ${run.draftPullRequest.url}`);
  }
}

export async function openclawCodeRerouteRunCommand(
  opts: OpenClawCodeRerouteRunOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const issueNumber = parseIssueNumber(opts.issue);
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const operatorStateDir = resolveOperatorStateDir(opts.stateDir);
  const operatorRepoConfig = await resolveOperatorRepoConfig({
    operatorStateDir,
    repoRoot,
    repoRef,
  });
  if (!operatorRepoConfig) {
    throw new Error(
      `No openclawcode operator repo config found for ${repoRef.owner}/${repoRef.repo} at ${repoRoot}.`,
    );
  }

  const requestedCoderAgentId = opts.coderAgent?.trim() || undefined;
  const requestedVerifierAgentId = opts.verifierAgent?.trim() || undefined;
  const runtimeOverrideSummary = formatRuntimeOverrideSummary({
    coderAgentId: requestedCoderAgentId,
    verifierAgentId: requestedVerifierAgentId,
  });
  const actor = opts.actor?.trim() || undefined;
  const note = opts.note?.trim() || undefined;
  const requestedAt = new Date().toISOString();

  const store = OpenClawCodeChatopsStore.fromStateDir(operatorStateDir);
  const issueKey = formatIssueKey({
    owner: repoRef.owner,
    repo: repoRef.repo,
    number: issueNumber,
  });
  const currentStatus = await store.getStatus(issueKey);
  const queueState = await store.snapshot();
  const currentRun = queueState.currentRun?.issueKey === issueKey ? queueState.currentRun : undefined;
  const queuedRun = queueState.queue.find((entry) => entry.issueKey === issueKey);

  if (currentRun) {
    const currentSnapshot = await store.getStatusSnapshot(issueKey);
    const existingDeferred = await store.getDeferredRuntimeReroute(issueKey);
    const deferredAction = await store.upsertDeferredRuntimeReroute({
      issueKey,
      notifyChannel: currentRun.notifyChannel,
      notifyTarget: currentRun.notifyTarget,
      requestedAt,
      actor,
      note,
      sourceRunId: currentSnapshot?.runId,
      sourceStage: currentSnapshot?.stage,
      requestedCoderAgentId:
        requestedCoderAgentId ??
        existingDeferred?.requestedCoderAgentId ??
        currentSnapshot?.rerunRequestedCoderAgentId,
      requestedVerifierAgentId:
        requestedVerifierAgentId ??
        existingDeferred?.requestedVerifierAgentId ??
        currentSnapshot?.rerunRequestedVerifierAgentId,
    });
    const detail = `${deferredAction === "added" ? "Recorded" : "Updated"} a deferred runtime reroute while the current run is still active.`;
    const payload = buildRerouteResultSummary({
      issueKey,
      outcome: "deferred",
      outcomeDetail: detail,
      runtimeOverrideSummary,
      stage: currentSnapshot?.stage,
      runId: currentSnapshot?.runId,
      notifyChannel: currentRun.notifyChannel,
      notifyTarget: currentRun.notifyTarget,
      status: currentStatus,
    });
    if (opts.json) {
      runtime.log(JSON.stringify(payload, null, 2));
      return;
    }
    runtime.log(detail);
    runtime.log(`Issue: ${issueKey}`);
    runtime.log(`Runtime override: ${runtimeOverrideSummary}`);
    if (currentSnapshot?.stage) {
      runtime.log(`Current stage: ${formatStageLabel(currentSnapshot.stage)}`);
    }
    runtime.log(
      `If the current run finishes Failed, openclawcode will queue a rerun with this override automatically.`,
    );
    return;
  }

  if (queuedRun) {
    const rerouteReason = appendRerouteAuditDetail(
      `Runtime reroute requested before execution started: ${runtimeOverrideSummary}.`,
      { actor, note },
    );
    const updated = await store.updateQueuedRuntimeReroute({
      issueKey,
      requestedCoderAgentId,
      requestedVerifierAgentId,
      requestedAt,
      reason: rerouteReason,
    });
    const detail = `Updated the queued runtime override before execution started.`;
    const payload = buildRerouteResultSummary({
      issueKey,
      outcome: "queued-update",
      outcomeDetail: detail,
      runtimeOverrideSummary,
      notifyChannel: updated?.notifyChannel ?? queuedRun.notifyChannel,
      notifyTarget: updated?.notifyTarget ?? queuedRun.notifyTarget,
      status: currentStatus,
    });
    if (opts.json) {
      runtime.log(JSON.stringify(payload, null, 2));
      return;
    }
    runtime.log(detail);
    runtime.log(`Issue: ${issueKey}`);
    runtime.log(`Runtime override: ${runtimeOverrideSummary}`);
    return;
  }

  if (await store.isPendingApproval(issueKey)) {
    const detail = `${issueKey} is still waiting for its first approved run, so there is no prior execution to reroute yet.`;
    const payload = buildRerouteResultSummary({
      issueKey,
      outcome: "blocked",
      outcomeDetail: detail,
      runtimeOverrideSummary,
      status: currentStatus,
    });
    if (opts.json) {
      runtime.log(JSON.stringify(payload, null, 2));
      return;
    }
    runtime.log(detail);
    return;
  }

  const snapshot = await store.getStatusSnapshot(issueKey);
  if (!snapshot) {
    const detail = `No tracked openclawcode run found for ${issueKey}. Start the first operator-managed run before requesting a reroute.`;
    const payload = buildRerouteResultSummary({
      issueKey,
      outcome: "blocked",
      outcomeDetail: detail,
      runtimeOverrideSummary,
      status: currentStatus,
    });
    if (opts.json) {
      runtime.log(JSON.stringify(payload, null, 2));
      return;
    }
    runtime.log(detail);
    return;
  }

  if (!CLI_REROUTEABLE_STAGES.has(snapshot.stage)) {
    const detail = `${issueKey} is currently tracked at ${formatStageLabel(snapshot.stage)}. CLI runtime reroute only resumes from failed or paused stages.`;
    const payload = buildRerouteResultSummary({
      issueKey,
      outcome: "blocked",
      outcomeDetail: detail,
      runtimeOverrideSummary,
      stage: snapshot.stage,
      runId: snapshot.runId,
      notifyChannel: snapshot.notifyChannel,
      notifyTarget: snapshot.notifyTarget,
      status: currentStatus,
    });
    if (opts.json) {
      runtime.log(JSON.stringify(payload, null, 2));
      return;
    }
    runtime.log(detail);
    return;
  }

  const binding = await store.getRepoBinding(formatRepoKey(repoRef));
  const destination = resolveQueuedNotificationDestination({
    repoConfig: operatorRepoConfig,
    binding,
    snapshot,
  });
  const rerunContext = {
    reason: appendRerouteAuditDetail(
      `${resolveSnapshotRerunReason(snapshot)} Runtime reroute requested with ${runtimeOverrideSummary}.`,
      { actor, note },
    ),
    requestedAt,
    priorRunId: snapshot.runId,
    priorStage: snapshot.stage,
    reviewDecision: snapshot.latestReviewDecision,
    reviewSubmittedAt: snapshot.latestReviewSubmittedAt,
    reviewSummary: snapshot.latestReviewSummary,
    reviewUrl: snapshot.latestReviewUrl,
    requestedCoderAgentId: requestedCoderAgentId ?? snapshot.rerunRequestedCoderAgentId,
    requestedVerifierAgentId:
      requestedVerifierAgentId ?? snapshot.rerunRequestedVerifierAgentId,
  } satisfies WorkflowRerunContext;
  const queued = await store.enqueue(
    {
      issueKey,
      notifyChannel: destination.channel,
      notifyTarget: destination.target,
      request: buildRunRequestFromCommand({
        command: {
          action: "rerun",
          issue: {
            owner: repoRef.owner,
            repo: repoRef.repo,
            number: issueNumber,
          },
        },
        config: operatorRepoConfig,
        rerunContext,
        runtimeAgentOverrides: {
          coderAgentId: requestedCoderAgentId,
          verifierAgentId: requestedVerifierAgentId,
        },
      }),
    },
    `Queued rerun from ${formatStageLabel(snapshot.stage)} with ${runtimeOverrideSummary}.`,
  );
  const detail = queued
    ? `Queued a reroute rerun from the tracked ${formatStageLabel(snapshot.stage)} snapshot.`
    : `${issueKey} became queued or running before the reroute could be enqueued.`;
  const payload = buildRerouteResultSummary({
    issueKey,
    outcome: queued ? "queued-rerun" : "blocked",
    outcomeDetail: detail,
    runtimeOverrideSummary,
    stage: snapshot.stage,
    runId: snapshot.runId,
    notifyChannel: destination.channel,
    notifyTarget: destination.target,
    status: currentStatus,
  });
  if (opts.json) {
    runtime.log(JSON.stringify(payload, null, 2));
    return;
  }
  runtime.log(detail);
  runtime.log(`Issue: ${issueKey}`);
  runtime.log(`Runtime override: ${runtimeOverrideSummary}`);
  if (queued) {
    runtime.log(`Queued from stage: ${formatStageLabel(snapshot.stage)}`);
  }
}

export async function openclawCodeBootstrapCommand(
  opts: OpenClawCodeBootstrapOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRef = parseBootstrapRepoRef(opts.repo);
  const repoKey = `${repoRef.owner}/${repoRef.repo}`;
  const operatorRepoRoot = resolveOpenClawCodeOperatorRepoRoot();
  const operatorStateDir = resolveOperatorStateDir(opts.stateDir);
  const resolvedToken = resolveGitHubTokenFromEnvOrGhCli();
  if (!resolvedToken) {
    throw new Error(
      "Bootstrap requires GH_TOKEN, GITHUB_TOKEN, or an authenticated `gh auth token` session so the target repo can be inspected and configured.",
    );
  }
  const token = resolvedToken.token;

  const initialRepoRoot = await resolveBootstrapRepoRoot({
    requestedRepoRoot: opts.repoRoot,
    repoRef,
  });
  let targetRepoRoot = initialRepoRoot.repoRoot;
  let repoRootSelection = initialRepoRoot.selection;
  const existingOperatorRepoConfig = await resolveOperatorRepoConfig({
    operatorStateDir,
    repoRoot: targetRepoRoot,
    repoRef,
  });
  if (!opts.repoRoot && existingOperatorRepoConfig?.repoRoot) {
    targetRepoRoot = path.resolve(existingOperatorRepoConfig.repoRoot);
    repoRootSelection = "existing-operator-config";
  }

  const checkout = await ensureBootstrapRepoCheckout({
    repoRoot: targetRepoRoot,
    repoRef,
    token,
  });
  targetRepoRoot = path.resolve(targetRepoRoot);

  const explicitChannel = opts.channel?.trim();
  const explicitChatTarget = opts.chatTarget?.trim();
  const chatTargetAutoRequested = explicitChatTarget === "auto";
  const concreteChatTarget = chatTargetAutoRequested ? undefined : explicitChatTarget;
  const existingConfiguredChatTarget = isConcreteChatNotifyTarget(
    existingOperatorRepoConfig?.notifyTarget,
  )
    ? existingOperatorRepoConfig?.notifyTarget.trim()
    : undefined;
  const shouldDiscoverNotifyBinding =
    chatTargetAutoRequested ||
    Boolean(explicitChannel) ||
    opts.mode === "chatops" ||
    Boolean(existingOperatorRepoConfig?.notifyChannel);
  const discoveredNotifyBinding =
    !shouldDiscoverNotifyBinding || concreteChatTarget || existingConfiguredChatTarget
      ? undefined
      : await discoverBootstrapNotifyBinding({
          operatorStateDir,
          requestedChannel: explicitChannel || existingOperatorRepoConfig?.notifyChannel,
        });
  const mode = resolveBootstrapMode({
    requestedMode: opts.mode,
    channel:
      explicitChannel ||
      existingOperatorRepoConfig?.notifyChannel ||
      discoveredNotifyBinding?.notifyChannel,
    chatTarget:
      concreteChatTarget || existingConfiguredChatTarget || discoveredNotifyBinding?.notifyTarget,
  });
  const defaultNotifyTarget =
    mode === "chatops" ? `bind-pending:${repoKey}` : `cli-only:${repoKey}`;
  const notifyChannel =
    explicitChannel ||
    existingOperatorRepoConfig?.notifyChannel ||
    discoveredNotifyBinding?.notifyChannel ||
    DEFAULT_OPENCLAWCODE_BOOTSTRAP_NOTIFY_CHANNEL;
  const notifyTarget =
    concreteChatTarget || existingConfiguredChatTarget || discoveredNotifyBinding?.notifyTarget || defaultNotifyTarget;
  const notifyBindingMode: BootstrapNotifyBindingMode =
    explicitChannel && concreteChatTarget
      ? "explicit"
      : existingOperatorRepoConfig?.notifyChannel && existingConfiguredChatTarget
        ? "existing-config"
        : discoveredNotifyBinding
          ? "auto-discovered"
          : mode === "chatops"
            ? "chat-placeholder"
            : "cli-placeholder";

  const testCommandsResult = opts.test?.length
    ? {
        commands: opts.test,
        source: "explicit" as const,
      }
    : existingOperatorRepoConfig?.testCommands?.length
      ? {
          commands: existingOperatorRepoConfig.testCommands,
          source: "existing-config" as const,
        }
      : await detectBootstrapTestCommands(targetRepoRoot);
  const baseBranch = resolveBootstrapBaseBranch(
    targetRepoRoot,
    opts.baseBranch ?? existingOperatorRepoConfig?.baseBranch,
  );
  const builderAgent =
    opts.builderAgent?.trim() ||
    existingOperatorRepoConfig?.builderAgent ||
    DEFAULT_OPENCLAWCODE_BOOTSTRAP_BUILDER_AGENT;
  const verifierAgent =
    opts.verifierAgent?.trim() ||
    existingOperatorRepoConfig?.verifierAgent ||
    DEFAULT_OPENCLAWCODE_BOOTSTRAP_VERIFIER_AGENT;
  const blueprintFirstBootstrap = testCommandsResult.source === "empty-repo-blueprint";

  const envFilePath = path.join(operatorStateDir, "openclawcode.env");
  const configPath = path.join(operatorStateDir, "openclaw.json");
  const chatopsStatePath = path.join(
    operatorStateDir,
    "plugins",
    "openclawcode",
    "chatops-state.json",
  );

  const envFile = await writeBootstrapEnvFile({
    envFilePath,
    repoKey,
    token,
  });
  const config = await writeBootstrapOperatorConfig({
    configPath,
    repoRef,
    targetRepoRoot,
    baseBranch,
    notifyChannel,
    notifyTarget,
    builderAgent,
    verifierAgent,
    testCommands: testCommandsResult.commands,
  });
  const binding = await ensureBootstrapRepoBinding({
    operatorStateDir,
    repoKey,
    notifyChannel,
    notifyTarget,
  });

  const existingBlueprint = await readProjectBlueprint(targetRepoRoot);
  const blueprint = existingBlueprint.exists
    ? existingBlueprint
    : await createProjectBlueprint({
        repoRoot: targetRepoRoot,
        title: `${repoRef.repo} Blueprint`,
        goal: `Bootstrap ${repoKey} for blueprint-first autonomous development.`,
      });
  const blueprintAction = existingBlueprint.exists ? "existing" : "created";
  const roleRouting = await writeProjectRoleRoutingPlan(targetRepoRoot);
  const discovery = await writeProjectDiscoveryInventory(targetRepoRoot);
  const stageGates = await writeProjectStageGateArtifact(targetRepoRoot);

  const gateway =
    opts.startGateway === false
      ? { action: "skipped" as const }
      : await openclawCodeBootstrapInternals.startGateway({
          operatorRepoRoot,
          operatorStateDir,
          extraEnv: envFile.values,
        });
  const resolvedWebhookUrl = await openclawCodeBootstrapInternals.resolveWebhookUrl({
    explicitWebhookUrl: opts.webhookUrl,
    operatorStateDir,
  });
  const tunnel =
    opts.configureWebhook === false || opts.startGateway === false || opts.startTunnel === false
      ? ({
          action: "skipped",
          url: null,
          error: null,
        } satisfies BootstrapTunnelResult)
      : resolvedWebhookUrl.url
        ? ({
            action: "skipped",
            url: null,
            error: null,
          } satisfies BootstrapTunnelResult)
        : await openclawCodeBootstrapInternals.startTunnel({
            operatorRepoRoot,
            operatorStateDir,
          });
  const webhookUrl =
    tunnel.url != null
      ? {
          url: tunnel.url,
          source: "tunnel-log" as const,
        }
      : resolvedWebhookUrl;
  const github = new GitHubRestClient(token);
  const webhook =
    opts.configureWebhook === false
      ? {
          action: "skipped" as const,
          hookId: null,
          webhookUrl: webhookUrl.url,
          webhookUrlSource: webhookUrl.source,
          events: DEFAULT_OPENCLAWCODE_BOOTSTRAP_HOOK_EVENTS.split(",").map((entry) =>
            entry.trim(),
          ),
          error: null,
        }
      : await openclawCodeBootstrapInternals.ensureWebhook({
          github,
          repoRef,
          webhookUrl: webhookUrl.url,
          webhookUrlSource: webhookUrl.source,
          secret: envFile.values.OPENCLAWCODE_GITHUB_WEBHOOK_SECRET,
        });
  const envFileAfterWebhook =
    webhook.hookId != null
      ? await writeBootstrapEnvFile({
          envFilePath,
          repoKey,
          token,
          hookId: webhook.hookId,
        })
      : envFile;
  const setupCheck = openclawCodeBootstrapInternals.runSetupCheck({
    operatorRepoRoot,
    operatorStateDir,
    probeBuiltStartup: opts.probeBuiltStartup !== false,
  });
  const setupCheckNextAction =
    setupCheck.payload?.readiness.nextAction ??
    (gateway.action === "failed"
      ? "start-or-restart-live-gateway"
      : "inspect-setup-check-output");
  const nextAction =
    blueprintFirstBootstrap
      ? "clarify-project-blueprint"
      : notifyBindingMode === "chat-placeholder"
        ? "connect-chat-and-run-occode-bind"
        : webhook.action === "failed"
          ? "review-github-webhook-permissions"
          : tunnel.action === "failed"
            ? "start-or-restart-webhook-tunnel"
            : setupCheckNextAction === "repair-plugin-activation"
              ? setupCheckNextAction
              : webhook.action === "skipped" && mode === "chatops"
                ? "configure-public-webhook-url"
                : setupCheckNextAction;
  const handoff = buildBootstrapHandoffPlan({
    repoKey,
    repoRef,
    targetRepoRoot,
    mode,
    blueprintFirstBootstrap,
    notifyBindingMode,
    notifyChannel,
    notifyTarget,
    webhookAction: webhook.action,
    webhookUrl: webhook.webhookUrl,
  });
  const proofReadiness = buildBootstrapProofReadiness({
    setupCheckPayload: setupCheck.payload,
    mode,
    notifyBindingMode,
    webhookAction: webhook.action,
    webhookUrl: webhook.webhookUrl,
    webhookHookId: webhook.hookId,
    recommendedProofMode: handoff.recommendedProofMode,
  });

  const payload = {
    contractVersion: OPENCLAWCODE_BOOTSTRAP_CONTRACT_VERSION,
    repo: {
      owner: repoRef.owner,
      repo: repoRef.repo,
      repoKey,
      repoRoot: targetRepoRoot,
      repoRootSelection,
      checkoutAction: checkout.action,
      remoteUrl: checkout.remoteUrl,
      baseBranch,
    },
    operator: {
      operatorRepoRoot,
      operatorStateDir,
      envFilePath,
      configPath,
      chatopsStatePath,
    },
    mode,
    notify: {
      notifyChannel,
      notifyTarget,
      bindingMode: notifyBindingMode,
    },
    credentials: {
      githubTokenSource: resolvedToken.source,
      envFileCreated: envFileAfterWebhook.created,
      envUpdatedKeys: envFileAfterWebhook.updatedKeys,
      webhookSecretGenerated: envFileAfterWebhook.webhookSecretGenerated,
    },
    config: {
      configCreated: config.created,
      repoEntryAction: config.repoEntryAction,
      builderAgent,
      verifierAgent,
      testCommands: testCommandsResult.commands,
      testCommandSource: testCommandsResult.source,
      blueprintFirstBootstrap,
    },
    pluginActivation: setupCheck.payload?.pluginActivation ?? {
      ready: false,
      pluginsEnabled: false,
      allowlisted: false,
      entryEnabled: false,
    },
    tunnel,
    webhook,
    binding,
    blueprint: {
      action: blueprintAction,
      blueprintPath: blueprint.blueprintPath,
      status: blueprint.status,
      revisionId: blueprint.revisionId,
      defaultedSectionCount: blueprint.defaultedSectionCount,
    },
    roleRouting: {
      artifactPath: roleRouting.artifactPath,
      unresolvedRoleCount: roleRouting.unresolvedRoleCount,
      fallbackConfigured: roleRouting.fallbackConfigured,
    },
    discovery: {
      artifactPath: discovery.inventoryPath,
      evidenceCount: discovery.evidenceCount,
    },
    stageGates: {
      artifactPath: stageGates.artifactPath,
      blockedGateCount: stageGates.blockedGateCount,
      needsHumanDecisionCount: stageGates.needsHumanDecisionCount,
      executionStartReadiness:
        stageGates.gates.find((gate) => gate.gateId === "execution-start")?.readiness ?? null,
    },
    gateway,
    setupCheck: {
      status: setupCheck.status,
      stderr: setupCheck.stderr,
      payload: setupCheck.payload,
    },
    proofReadiness,
    handoff,
    nextAction,
  };

  if (opts.json) {
    runtime.log(JSON.stringify(payload, null, 2));
    return;
  }

  runtime.log(`Repo: ${repoKey}`);
  runtime.log(`Target repo root: ${targetRepoRoot}`);
  runtime.log(`Repo root selection: ${repoRootSelection}`);
  runtime.log(`Checkout: ${checkout.action}`);
  runtime.log(`Mode: ${mode}`);
  runtime.log(`Notify target: ${notifyChannel}:${notifyTarget} (${notifyBindingMode})`);
  runtime.log(`Operator root: ${operatorStateDir}`);
  runtime.log(`Env file: ${envFilePath}`);
  runtime.log(`Config file: ${configPath}`);
  runtime.log(`Repo entry: ${config.repoEntryAction}`);
  runtime.log(
    `Tunnel: ${tunnel.action}${tunnel.url ? ` (${tunnel.url})` : ""}${tunnel.error ? ` | ${tunnel.error}` : ""}`,
  );
  runtime.log(
    `Webhook: ${webhook.action}${webhook.webhookUrl ? ` (${webhook.webhookUrl})` : ""}${webhook.error ? ` | ${webhook.error}` : ""}`,
  );
  runtime.log(`Repo binding: ${binding.action}`);
  runtime.log(`Blueprint: ${blueprintAction} (${blueprint.status ?? "unknown"})`);
  runtime.log(`Role routing unresolved roles: ${roleRouting.unresolvedRoleCount}`);
  runtime.log(`Discovery evidence: ${discovery.evidenceCount}`);
  runtime.log(
    `Stage gates: blocked=${stageGates.blockedGateCount} needsHuman=${stageGates.needsHumanDecisionCount}`,
  );
  runtime.log(`Gateway: ${gateway.action}`);
  runtime.log(
    `Proof readiness: cli=${proofReadiness.cliProofReady ? "ready" : "blocked"} chat=${proofReadiness.chatProofReady ? "ready" : "blocked"} webhook=${proofReadiness.webhookReady ? "ready" : "blocked"}`,
  );
  runtime.log(
    `Chat setup routing: ${proofReadiness.chatSetupRoutingReady ? "ready" : "blocked"}`,
  );
  if (setupCheck.payload?.pluginActivation) {
    runtime.log(
      `Plugin activation: ready=${setupCheck.payload.pluginActivation.ready} | plugins=${setupCheck.payload.pluginActivation.pluginsEnabled} | allow=${setupCheck.payload.pluginActivation.allowlisted} | entry=${setupCheck.payload.pluginActivation.entryEnabled}`,
    );
  }
  runtime.log(`Recommended proof mode: ${handoff.recommendedProofMode} | ${handoff.reason}`);
  if (blueprintFirstBootstrap) {
    runtime.log(`Blueprint clarify: ${handoff.blueprintClarifyCommand}`);
    runtime.log(`Blueprint agree: ${handoff.blueprintAgreeCommand}`);
    runtime.log(`Blueprint decompose: ${handoff.blueprintDecomposeCommand}`);
  }
  runtime.log(`CLI proof: ${handoff.cliRunCommand}`);
  runtime.log(`Blueprint inspect: ${formatChatCommandWithAlias(handoff.blueprintCommand)}`);
  runtime.log(`Stage gates inspect: ${formatChatCommandWithAlias(handoff.gatesCommand)}`);
  runtime.log(`Gateway restart: ${handoff.gatewayRestartCommand}`);
  if (payload.pluginActivation.ready === false || proofReadiness.chatSetupRoutingReady === false) {
    runtime.log(`Plugin activation repair: ${handoff.pluginActivationRepairCommand}`);
    if (handoff.chatSetupStatusCommand) {
      runtime.log(
        `Chat setup retry: ${formatChatCommandWithAlias(handoff.chatSetupStatusCommand)}`,
      );
    }
  }
  if (handoff.chatBindCommand) {
    runtime.log(`Chat bind: ${formatChatCommandWithAlias(handoff.chatBindCommand)}`);
  }
  if (handoff.chatStartCommand) {
    runtime.log(`Chat proof: ${formatChatCommandWithAlias(handoff.chatStartCommand)}`);
  }
  if (handoff.webhookRetryCommand) {
    runtime.log(`Webhook retry: ${handoff.webhookRetryCommand}`);
  }
  if (setupCheck.payload) {
    runtime.log(
      `Setup-check: ok=${setupCheck.payload.ok} pass=${setupCheck.payload.summary.pass} warn=${setupCheck.payload.summary.warn} fail=${setupCheck.payload.summary.fail}`,
    );
    runtime.log(`Setup-check next action: ${setupCheck.payload.readiness.nextAction}`);
  } else {
    runtime.log(`Setup-check: unavailable (status=${String(setupCheck.status)})`);
    if (setupCheck.stderr) {
      runtime.log(setupCheck.stderr);
    }
  }
  runtime.log(`Next action: ${nextAction}`);
}

export async function openclawCodePolicyShowCommand(
  opts: OpenClawCodePolicyShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  logOpenClawCodePolicySnapshot({
    runtime,
    json: opts.json,
  });
}

export async function openclawCodeBlueprintInitCommand(
  opts: OpenClawCodeBlueprintInitOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const summary = await createProjectBlueprint({
    repoRoot,
    title: opts.title,
    goal: opts.goal,
    force: Boolean(opts.force),
  });
  logProjectBlueprintSummary({
    summary,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeBlueprintShowCommand(
  opts: OpenClawCodeBlueprintShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const summary = await readProjectBlueprint(repoRoot);
  logProjectBlueprintSummary({
    summary,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeBlueprintClarifyCommand(
  opts: OpenClawCodeBlueprintClarifyOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const report = await inspectProjectBlueprintClarifications(repoRoot);
  logProjectBlueprintClarificationReport({
    report,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeBlueprintSetStatusCommand(
  opts: OpenClawCodeBlueprintSetStatusOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const summary = await updateProjectBlueprintStatus({
    repoRoot,
    status: parseProjectBlueprintStatus(String(opts.status)),
  });
  logProjectBlueprintSummary({
    summary,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeBlueprintSetProviderRoleCommand(
  opts: OpenClawCodeBlueprintSetProviderRoleOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const roleId = parseProjectBlueprintRoleId(opts.role);
  const provider =
    opts.clear || !opts.provider || opts.provider.trim().toLowerCase() === "clear"
      ? null
      : opts.provider.trim();
  const summary = await updateProjectBlueprintProviderRole({
    repoRoot,
    roleId,
    provider,
  });
  const plan = await writeProjectRoleRoutingPlan(repoRoot);
  const stageGates = await writeProjectStageGateArtifact(repoRoot);
  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          blueprint: summary,
          roleRouting: plan,
          stageGates,
          updatedRole: roleId,
          provider,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Repo root: ${repoRoot}`);
  runtime.log(`Updated role: ${opts.role}`);
  runtime.log(`Provider: ${provider ?? "cleared"}`);
  runtime.log(`Blueprint revision: ${summary.revisionId ?? "unknown"}`);
  runtime.log(
    `Execution routing gate: ${stageGates.gates.find((gate) => gate.gateId === "execution-routing")?.readiness ?? "unknown"}`,
  );
  logProjectRoleRoutingPlan({
    plan,
    runtime,
    json: false,
  });
}

export async function openclawCodeBlueprintSetSectionCommand(
  opts: OpenClawCodeBlueprintSetSectionOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const sectionName = parseProjectBlueprintSectionName(opts.section);
  const summary = await updateProjectBlueprintSection({
    repoRoot,
    sectionName,
    body: opts.body,
    append: Boolean(opts.append),
    createIfMissing: Boolean(opts.createIfMissing),
  });
  const clarification = await inspectProjectBlueprintClarifications(repoRoot);
  const stageGates = await writeProjectStageGateArtifact(repoRoot);
  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          blueprint: summary,
          clarification,
          stageGates,
          updatedSection: sectionName,
          append: Boolean(opts.append),
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Repo root: ${repoRoot}`);
  runtime.log(`Updated section: ${sectionName}`);
  runtime.log(`Blueprint revision: ${summary.revisionId ?? "unknown"}`);
  runtime.log(
    `Execution-start gate: ${stageGates.gates.find((gate) => gate.gateId === "execution-start")?.readiness ?? "unknown"}`,
  );
  logProjectBlueprintClarificationReport({
    report: clarification,
    runtime,
    json: false,
  });
}

export async function openclawCodeBlueprintDecomposeCommand(
  opts: OpenClawCodeBlueprintDecomposeOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const inventory = await writeProjectWorkItemInventory(repoRoot);
  logProjectWorkItemInventory({
    inventory,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeWorkItemsShowCommand(
  opts: OpenClawCodeWorkItemsShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const inventory = await readProjectWorkItemInventory(repoRoot);
  logProjectWorkItemInventory({
    inventory,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeDiscoverWorkItemsCommand(
  opts: OpenClawCodeDiscoverWorkItemsOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const inventory = await writeProjectDiscoveryInventory(repoRoot);
  await writeProjectWorkItemInventoryWithDiscoveredItems({
    repoRoot,
    discoveredWorkItems: inventory.evidence.map((entry) => entry.discoveredWorkItem),
  });
  logProjectDiscoveryInventory({
    inventory,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeRoleRoutingRefreshCommand(
  opts: OpenClawCodeRoleRoutingRefreshOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const plan = await writeProjectRoleRoutingPlan(repoRoot);
  logProjectRoleRoutingPlan({
    plan,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeRoleRoutingShowCommand(
  opts: OpenClawCodeRoleRoutingShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const plan = await readProjectRoleRoutingPlan(repoRoot);
  logProjectRoleRoutingPlan({
    plan,
    runtime,
    json: Boolean(opts.json),
  });
}

export function openclawCodeStageGateIds(): string[] {
  return projectStageGateIds();
}

export function openclawCodeStageGateDecisionIds(): string[] {
  return projectStageGateDecisionIds();
}

export function openclawCodeRuntimeSteeringStageIds(): string[] {
  return projectRuntimeSteeringStageIds();
}

export async function openclawCodeRuntimeSteeringShowCommand(
  opts: OpenClawCodeRuntimeSteeringShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectRuntimeSteeringArtifact(repoRoot);
  logProjectRuntimeSteeringArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeRuntimeSteeringSetCommand(
  opts: OpenClawCodeRuntimeSteeringSetOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const adapter = opts.adapter?.trim();
  const agent = opts.agent?.trim();
  if (!opts.clear && !adapter && !agent) {
    throw new Error("Pass --adapter, --agent, or --clear.");
  }
  const artifact = await recordProjectRuntimeSteeringOverride({
    repoRoot,
    stageId: opts.stage as ProjectRuntimeSteeringStageId,
    adapterId: adapter,
    agentId: agent,
    actor: opts.actor,
    note: opts.note,
    clear: Boolean(opts.clear),
  });
  logProjectRuntimeSteeringArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeStageGatesRefreshCommand(
  opts: OpenClawCodeStageGatesRefreshOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await writeProjectStageGateArtifact(repoRoot);
  logProjectStageGateArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeStageGatesShowCommand(
  opts: OpenClawCodeStageGatesShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectStageGateArtifact(repoRoot);
  logProjectStageGateArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeNextWorkShowCommand(
  opts: OpenClawCodeNextWorkShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const selection = await writeProjectNextWorkSelection(repoRoot);
  logProjectNextWorkSelection({
    selection,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeIssueMaterializeCommand(
  opts: OpenClawCodeIssueMaterializeOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const artifact = await writeProjectIssueMaterializationArtifact({
    repoRoot,
    owner: repoRef.owner,
    repo: repoRef.repo,
  });
  logProjectIssueMaterializationArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeIssueMaterializationShowCommand(
  opts: OpenClawCodeIssueMaterializationShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectIssueMaterializationArtifact(repoRoot);
  logProjectIssueMaterializationArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeProjectProgressShowCommand(
  opts: OpenClawCodeProjectProgressShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  }).catch(() => undefined);
  const operatorSnapshot = repoRef
    ? await readOpenClawCodeOperatorStatusSnapshot(resolveOperatorStateDir(opts.stateDir)).catch(
        () => undefined,
      )
    : undefined;
  const artifact = await writeProjectProgressArtifact({
    repoRoot,
    repo: repoRef,
    operatorSnapshot,
  });
  logProjectProgressArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeOperatorProgramInitCommand(
  opts: OpenClawCodeOperatorProgramInitOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await createProjectOperatorProgram({
    repoRoot,
    title: opts.title,
    summary: opts.summary,
    force: Boolean(opts.force),
  });
  logProjectOperatorProgramArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeOperatorProgramShowCommand(
  opts: OpenClawCodeOperatorProgramShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectOperatorProgram(repoRoot);
  logProjectOperatorProgramArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeAutonomousLoopRunCommand(
  opts: OpenClawCodeAutonomousLoopRunOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const stateDir = resolveOperatorStateDir(opts.stateDir);
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  }).catch(() => undefined);
  const operatorSnapshot = repoRef
    ? await readOpenClawCodeOperatorStatusSnapshot(stateDir).catch(() => undefined)
    : undefined;
  const repoConfig = repoRef
    ? await resolveOperatorRepoConfig({
        operatorStateDir: stateDir,
        repoRoot,
        repoRef,
      }).catch(() => null)
    : null;
  const artifact = await runProjectAutonomousLoop({
    repoRoot,
    repo: repoRef,
    operatorSnapshot,
    readOperatorSnapshot: repoRef
      ? async () => await readOpenClawCodeOperatorStatusSnapshot(stateDir).catch(() => undefined)
      : undefined,
    queueIssue:
      repoConfig && repoRef
        ? async ({ issueNumber }) =>
            await queueCliAutonomousLoopIssueExecution({
              operatorStateDir: stateDir,
              repoConfig,
              issueNumber,
              queuedStatus:
                (opts.iterations ?? 1) > 1
                  ? "Queued from openclaw code autonomous-loop-run --iterations."
                  : "Queued from openclaw code autonomous-loop-run --once.",
              gatedStatus: "Awaiting execution-start gate approval.",
            })
        : undefined,
    maxIterations: Math.max(1, Math.trunc(opts.iterations ?? (opts.once ? 1 : 1))),
  });
  logProjectAutonomousLoopArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeAutonomousLoopShowCommand(
  opts: OpenClawCodeAutonomousLoopShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectAutonomousLoopArtifact(repoRoot);
  logProjectAutonomousLoopArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeStageGatesDecideCommand(
  opts: OpenClawCodeStageGatesDecideOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await recordProjectStageGateDecision({
    repoRoot,
    gateId: parseProjectStageGateId(String(opts.gate)),
    decision: parseProjectStageGateDecisionId(String(opts.decision)),
    actor: opts.actor,
    note: opts.note,
  });
  logProjectStageGateArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodePromotionGateRefreshCommand(
  opts: OpenClawCodePromotionGateRefreshOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await writeProjectPromotionGateArtifact(repoRoot);
  logProjectPromotionGateArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodePromotionGateShowCommand(
  opts: OpenClawCodePromotionGateShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectPromotionGateArtifact(repoRoot);
  logProjectPromotionGateArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeRollbackSuggestionRefreshCommand(
  opts: OpenClawCodeRollbackSuggestionRefreshOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await writeProjectRollbackSuggestionArtifact(repoRoot);
  logProjectRollbackSuggestionArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeRollbackSuggestionShowCommand(
  opts: OpenClawCodeRollbackSuggestionShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectRollbackSuggestionArtifact(repoRoot);
  logProjectRollbackSuggestionArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodePromotionReceiptRecordCommand(
  opts: OpenClawCodePromotionReceiptRecordOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await writeProjectPromotionReceiptArtifact({
    repoRootInput: repoRoot,
    actor: opts.actor,
    note: opts.note,
    promotedBranch: opts.promotedBranch,
    promotedCommitSha: opts.promotedCommitSha,
  });
  logProjectPromotionReceiptArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodePromotionReceiptShowCommand(
  opts: OpenClawCodePromotionReceiptShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectPromotionReceiptArtifact(repoRoot);
  logProjectPromotionReceiptArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeRollbackReceiptRecordCommand(
  opts: OpenClawCodeRollbackReceiptRecordOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await writeProjectRollbackReceiptArtifact({
    repoRootInput: repoRoot,
    actor: opts.actor,
    note: opts.note,
    restoredBranch: opts.restoredBranch,
    restoredCommitSha: opts.restoredCommitSha,
  });
  logProjectRollbackReceiptArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeRollbackReceiptShowCommand(
  opts: OpenClawCodeRollbackReceiptShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const artifact = await readProjectRollbackReceiptArtifact(repoRoot);
  logProjectRollbackReceiptArtifact({
    artifact,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeOperatorStatusSnapshotShowCommand(
  opts: OpenClawCodeOperatorStatusSnapshotShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const stateDir = resolveOperatorStateDir(opts.stateDir);
  const snapshot = await readOpenClawCodeOperatorStatusSnapshot(stateDir);
  logOpenClawCodeOperatorStatusSnapshot({
    snapshot,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeCapabilityMapShowCommand(
  opts: OpenClawCodeCapabilityMapShowOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const snapshot = buildOpenClawCodeCapabilityMapSnapshot();
  logOpenClawCodeCapabilityMap({
    snapshot,
    runtime,
    json: Boolean(opts.json),
  });
}

export async function openclawCodeSeedValidationIssueCommand(
  opts: OpenClawCodeSeedValidationIssueOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const github = new GitHubRestClient();

  if (opts.balanced) {
    if (opts.template) {
      throw new Error("--template and --balanced cannot be used together");
    }
    const openIssues = await listValidationIssueInventory({
      owner: repoRef.owner,
      repo: repoRef.repo,
      repoRoot,
      state: "open",
      github,
    });
    const { minimumPoolTargets, poolDeficits } = resolveValidationPoolSummary(openIssues);
    const result = await seedBalancedValidationPool({
      owner: repoRef.owner,
      repo: repoRef.repo,
      repoRoot,
      openIssues,
      dryRun: Boolean(opts.dryRun),
      github,
    });

    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            contractVersion: OPENCLAWCODE_VALIDATION_POOL_CONTRACT_VERSION,
            owner: repoRef.owner,
            repo: repoRef.repo,
            balanced: true,
            dryRun: Boolean(opts.dryRun),
            minimumPoolTargets,
            poolDeficits,
            seedActions: result.actions,
          },
          null,
          2,
        ),
      );
      return;
    }

    runtime.log(`Repo: ${repoRef.owner}/${repoRef.repo}`);
    runtime.log(`Balanced seeding dry-run: ${Boolean(opts.dryRun)}`);
    for (const target of minimumPoolTargets) {
      runtime.log(
        `- ${target.issueClass}: minimum ${target.minimumOpenIssues} (${target.rationale})`,
      );
    }
    for (const deficit of poolDeficits) {
      runtime.log(
        `- deficit ${deficit.issueClass}: current=${deficit.currentOpenIssues} missing=${deficit.missingIssues}`,
      );
    }
    for (const action of result.actions) {
      runtime.log(
        `${action.created ? "created" : action.reusedExisting ? "reused" : "would-create"} ${action.issueClass}/${action.template}: ${action.title}`,
      );
      if (action.issueUrl) {
        runtime.log(action.issueUrl);
      }
    }
    return;
  }

  if (!opts.template) {
    throw new Error("--template is required unless --balanced is used");
  }

  const draft = buildValidationIssueDraft({
    template: opts.template,
    fieldName: opts.fieldName,
    sourcePath: opts.sourcePath,
    docPath: opts.docPath,
    summary: opts.summary,
  });
  if (opts.dryRun) {
    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            ...draft,
            owner: repoRef.owner,
            repo: repoRef.repo,
            dryRun: true,
          },
          null,
          2,
        ),
      );
      return;
    }
    runtime.log(`Template: ${draft.template}`);
    runtime.log(`Issue class: ${draft.issueClass}`);
    runtime.log(`Repo: ${repoRef.owner}/${repoRef.repo}`);
    runtime.log(`Title: ${draft.title}`);
    runtime.log("Body:");
    runtime.log(draft.body);
    return;
  }

  const action = await seedValidationIssueDraft({
    owner: repoRef.owner,
    repo: repoRef.repo,
    draft,
    dryRun: false,
    github,
  });

  if (action.reusedExisting) {
    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            ...draft,
            owner: repoRef.owner,
            repo: repoRef.repo,
            issueNumber: action.issueNumber,
            issueUrl: action.issueUrl,
            dryRun: false,
            created: false,
            reusedExisting: true,
          },
          null,
          2,
        ),
      );
      return;
    }
    runtime.log(`Using existing issue #${action.issueNumber}: ${action.issueUrl}`);
    runtime.log(`Template: ${draft.template}`);
    runtime.log(`Issue class: ${draft.issueClass}`);
    return;
  }

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          ...draft,
          owner: repoRef.owner,
          repo: repoRef.repo,
          issueNumber: action.issueNumber,
          issueUrl: action.issueUrl,
          dryRun: false,
          created: true,
          reusedExisting: false,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Created issue #${action.issueNumber}: ${action.issueUrl}`);
  runtime.log(`Template: ${draft.template}`);
  runtime.log(`Issue class: ${draft.issueClass}`);
}

export async function openclawCodeListValidationIssuesCommand(
  opts: OpenClawCodeListValidationIssuesOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const github = new GitHubRestClient();
  const issues = await listValidationIssueInventory({
    owner: repoRef.owner,
    repo: repoRef.repo,
    repoRoot,
    state: opts.state ?? "open",
    github,
  });
  const counts = resolveValidationIssueClassCounts(issues);
  const implementationCounts = summarizeValidationIssueImplementationCounts(issues);
  const templateCounts = issues.reduce<Partial<Record<ValidationIssueTemplateId, number>>>(
    (summary, issue) => {
      summary[issue.template] = (summary[issue.template] ?? 0) + 1;
      return summary;
    },
    {},
  );
  const { minimumPoolTargets, poolDeficits } = resolveValidationPoolSummary(issues);

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          contractVersion: OPENCLAWCODE_VALIDATION_POOL_CONTRACT_VERSION,
          owner: repoRef.owner,
          repo: repoRef.repo,
          state: opts.state ?? "open",
          totalValidationIssues: issues.length,
          counts,
          implementationCounts,
          templateCounts,
          minimumPoolTargets,
          poolDeficits,
          issues,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Repo: ${repoRef.owner}/${repoRef.repo}`);
  runtime.log(`State: ${opts.state ?? "open"}`);
  runtime.log(`Validation issues: ${issues.length}`);
  runtime.log(`- command-layer: ${counts.commandLayer}`);
  runtime.log(`- operator-docs: ${counts.operatorDocs}`);
  runtime.log(`- high-risk-validation: ${counts.highRiskValidation}`);
  runtime.log(`- implemented: ${implementationCounts.implemented}`);
  runtime.log(`- pending: ${implementationCounts.pending}`);
  runtime.log(`- manual-review: ${implementationCounts.manualReview}`);
  for (const target of minimumPoolTargets) {
    runtime.log(`- minimum ${target.issueClass}: ${target.minimumOpenIssues}`);
  }
  for (const deficit of poolDeficits) {
    runtime.log(
      `- deficit ${deficit.issueClass}: current=${deficit.currentOpenIssues} missing=${deficit.missingIssues}`,
    );
  }
  for (const [template, count] of Object.entries(templateCounts).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    runtime.log(`- template ${template}: ${count}`);
  }
  for (const issue of issues) {
    const age = issue.ageDays == null ? "unknown age" : `${issue.ageDays.toFixed(1)}d`;
    runtime.log(
      `#${issue.issueNumber} [${issue.issueClass}/${issue.template}/${issue.implementationState}] ${age} ${issue.title}`,
    );
    if (issue.fieldName) {
      runtime.log(`field: ${issue.fieldName}`);
    }
    runtime.log(issue.implementationSummary);
    runtime.log(issue.url);
  }
}

export async function openclawCodeReconcileValidationIssuesCommand(
  opts: OpenClawCodeReconcileValidationIssuesOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const github = new GitHubRestClient();
  const issues = await listValidationIssueInventory({
    owner: repoRef.owner,
    repo: repoRef.repo,
    repoRoot,
    state: "open",
    github,
  });
  const closable = issues.filter((issue) => issue.autoClosable);
  const actions: Array<{
    issueNumber: number;
    title: string;
    action: "would-close" | "closed" | "left-open";
    implementationState: ValidationIssueInventoryEntry["implementationState"];
    implementationSummary: string;
  }> = [];

  for (const issue of issues) {
    if (!issue.autoClosable) {
      actions.push({
        issueNumber: issue.issueNumber,
        title: issue.title,
        action: "left-open",
        implementationState: issue.implementationState,
        implementationSummary: issue.implementationSummary,
      });
      continue;
    }

    if (opts.closeImplemented) {
      await github.closeIssue({
        owner: repoRef.owner,
        repo: repoRef.repo,
        issueNumber: issue.issueNumber,
      });
      actions.push({
        issueNumber: issue.issueNumber,
        title: issue.title,
        action: "closed",
        implementationState: issue.implementationState,
        implementationSummary: issue.implementationSummary,
      });
      continue;
    }

    actions.push({
      issueNumber: issue.issueNumber,
      title: issue.title,
      action: "would-close",
      implementationState: issue.implementationState,
      implementationSummary: issue.implementationSummary,
    });
  }

  const remainingOpenIssues = opts.closeImplemented
    ? issues.filter((issue) => !issue.autoClosable)
    : issues;
  const { minimumPoolTargets, poolDeficits, totalMissing } =
    resolveValidationPoolSummary(remainingOpenIssues);
  const seedActions =
    opts.enforceMinimumPoolSize && totalMissing > 0
      ? (
          await seedBalancedValidationPool({
            owner: repoRef.owner,
            repo: repoRef.repo,
            repoRoot,
            openIssues: remainingOpenIssues,
            dryRun: false,
            github,
          })
        ).actions
      : [];
  const nextAction = resolveValidationPoolNextAction({
    issues: remainingOpenIssues,
    closeImplemented: Boolean(opts.closeImplemented),
    totalMissing,
    enforceMinimumPoolSize: Boolean(opts.enforceMinimumPoolSize),
  });
  const closedCount = actions.filter((action) => action.action === "closed").length;
  const closableCount = closable.length;

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          contractVersion: OPENCLAWCODE_VALIDATION_POOL_CONTRACT_VERSION,
          owner: repoRef.owner,
          repo: repoRef.repo,
          closeImplemented: Boolean(opts.closeImplemented),
          enforceMinimumPoolSize: Boolean(opts.enforceMinimumPoolSize),
          totalValidationIssues: issues.length,
          closableImplementedIssues: closableCount,
          closedIssues: closedCount,
          minimumPoolTargets,
          poolDeficits,
          seededIssues: seedActions.filter((action) => action.created).length,
          seedActions,
          nextAction,
          actions,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Repo: ${repoRef.owner}/${repoRef.repo}`);
  runtime.log(`Validation issues inspected: ${issues.length}`);
  runtime.log(`Closable implemented issues: ${closableCount}`);
  runtime.log(`Closed issues: ${closedCount}`);
  runtime.log(`Enforced minimum pool size: ${Boolean(opts.enforceMinimumPoolSize)}`);
  for (const target of minimumPoolTargets) {
    runtime.log(`- minimum ${target.issueClass}: ${target.minimumOpenIssues}`);
  }
  for (const deficit of poolDeficits) {
    runtime.log(
      `- deficit ${deficit.issueClass}: current=${deficit.currentOpenIssues} missing=${deficit.missingIssues}`,
    );
  }
  runtime.log(`Seeded issues: ${seedActions.filter((action) => action.created).length}`);
  runtime.log(`Next action: ${nextAction}`);
  for (const action of actions) {
    runtime.log(`#${action.issueNumber} [${action.action}] ${action.title}`);
    runtime.log(action.implementationSummary);
  }
  for (const seedAction of seedActions) {
    runtime.log(
      `${seedAction.created ? "created" : "reused"} ${seedAction.issueClass}/${seedAction.template}: ${seedAction.title}`,
    );
    if (seedAction.issueUrl) {
      runtime.log(seedAction.issueUrl);
    }
  }
}

export function openclawCodeSeedValidationIssueTemplateIds(): ValidationIssueTemplateId[] {
  return listValidationIssueTemplates().map((entry) => entry.id);
}

export function openclawCodeBlueprintStatusIds(): ProjectBlueprintStatus[] {
  return projectBlueprintStatusIds();
}

export function openclawCodeBlueprintRoleIds(): string[] {
  return projectBlueprintRoleIds();
}

export function openclawCodeBlueprintSectionIds(): string[] {
  return projectBlueprintSectionIds();
}
