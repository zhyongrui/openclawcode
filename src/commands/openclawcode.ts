import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import type { WorkflowRerunContext, WorkflowRun } from "../openclawcode/index.js";
import {
  assessValidationIssueImplementation,
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
  readProjectDiscoveryInventory,
  readProjectRoleRoutingPlan,
  readProjectPromotionGateArtifact,
  readProjectPromotionReceiptArtifact,
  readOpenClawCodeOperatorStatusSnapshot,
  readProjectRollbackReceiptArtifact,
  readProjectRollbackSuggestionArtifact,
  readProjectStageGateArtifact,
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
  writeProjectWorkItemInventory,
  buildOpenClawCodePolicySnapshot,
  resolveAutoMergeDisposition,
  resolveAutoMergePolicy,
  type OpenClawCodeOperatorStatusSnapshot,
  resolveValidationPoolDeficits,
} from "../openclawcode/index.js";
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

export interface OpenClawCodeStageGatesShowOpts {
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

export interface OpenClawCodePolicyShowOpts {
  json?: boolean;
}

export const OPENCLAWCODE_RUN_JSON_CONTRACT_VERSION = 1;
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
  if (plan.blockers.length > 0) {
    runtime.log("Blockers:");
    for (const blocker of plan.blockers) {
      runtime.log(`- ${blocker}`);
    }
  }
  for (const route of plan.routes) {
    runtime.log(
      `- ${route.roleId}: ${route.rawAssignment ?? "openclaw-default"} (${route.adapterId}, ${route.source})`,
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
      `- ${repo.repoKey}: tracked=${repo.trackedIssueCount} pending=${repo.pendingApprovalCount} queued=${repo.queuedRunCount} current=${repo.currentRunCount} ready=${repo.readyForHumanReviewCount} merged=${repo.mergedCount} failed=${repo.failedCount}`,
    );
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

function resolveRoleRouteAdapter(run: WorkflowRun, roleId: string): string | null {
  return run.roleRouting?.routes.find((route) => route.roleId === roleId)?.adapterId ?? null;
}

function resolveRuntimeRoutingSelection(run: WorkflowRun, roleId: string) {
  return run.runtimeRouting?.selections.find((selection) => selection.roleId === roleId) ?? null;
}

function resolveStageGateReadiness(run: WorkflowRun, gateId: string): string | null {
  return run.stageGates?.gates.find((gate) => gate.gateId === gateId)?.readiness ?? null;
}

function toWorkflowRunJson(run: WorkflowRun) {
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
  return {
    ...run,
    contractVersion: OPENCLAWCODE_RUN_JSON_CONTRACT_VERSION,
    runCreatedAt: run.createdAt ?? null,
    runUpdatedAt: run.updatedAt ?? null,
    runHasUpdatedAt: run.updatedAt != null,
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
    workspaceBaseBranch: run.workspace.baseBranch ?? null,
    workspaceBranchName: run.workspace.branchName ?? null,
    workspaceBranchMatchesIssue:
      run.issue.number != null
        ? (run.workspace.branchName?.endsWith(`issue-${run.issue.number}`) ?? false)
        : false,
    workspaceRepoRoot: run.workspace.repoRoot ?? null,
    workspaceRepoRootPresent: (run.workspace.repoRoot?.trim().length ?? 0) > 0,
    workspaceHasPreparedAt: run.workspace.preparedAt != null,
    workspacePreparedAt: run.workspace.preparedAt ?? null,
    workspaceHasWorktreePath: run.workspace.worktreePath != null,
    workspaceWorktreePath: run.workspace.worktreePath ?? null,
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
        : run.verificationReport.findings.length > 0 ||
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
  const stateDir = path.resolve(opts.stateDir ?? path.join(repoRoot, ".openclawcode"));
  const shellRunner = new HostShellRunner();
  const worktreeManager = new GitWorktreeManager();
  const github = new GitHubRestClient();
  const planner = new HeuristicPlanner();
  const agentRunner = new OpenClawAgentRunner();
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
    testCommands: opts.test ?? [],
    agentId: opts.builderAgent,
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
    agentId: opts.verifierAgent,
    timeoutSeconds: verifierTimeoutSeconds,
  });
  const store = new FileSystemWorkflowRunStore(path.join(stateDir, "runs"));

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
    runtime.log(JSON.stringify(toWorkflowRunJson(run), null, 2));
    return;
  }

  runtime.log(`Run: ${run.id}`);
  runtime.log(`Stage: ${run.stage}`);
  if (run.workspace) {
    runtime.log(`Worktree: ${run.workspace.worktreePath}`);
    runtime.log(`Branch: ${run.workspace.branchName}`);
  }
  if (run.draftPullRequest?.url) {
    runtime.log(`Draft PR: ${run.draftPullRequest.url}`);
  }
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
