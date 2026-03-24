import path from "node:path";
import { createHash } from "node:crypto";
import { readProjectBlueprintDocument } from "../blueprint.js";
import type {
  ExecutionSpec,
  WorkflowBlueprintContext,
  WorkflowFailureDiagnostics,
  WorkflowHandoffEntry,
  WorkflowHandoffSnapshot,
  WorkflowPlanEditRecord,
  WorkflowPlanReviewSnapshot,
  WorkflowRoleRoutingSnapshot,
  WorkflowRuntimeRoleSelection,
  WorkflowRerunContext,
  WorkflowRun,
  WorkflowStageGateSnapshot,
  WorkflowWorkspace,
} from "../contracts/index.js";
import type { GitHubIssueClient, PullRequestRef, RepoRef } from "../github/index.js";
import {
  buildPullRequestBody,
  createRun,
  executeBuild,
  executePlanning,
  executeVerification,
} from "../orchestrator/index.js";
import type { WorkflowRunStore } from "../persistence/index.js";
import { deriveProjectRoleRoutingPlan, readProjectRoleRoutingPlan } from "../role-routing.js";
import {
  assessIssueSuitability,
  type Builder,
  type Planner,
  type Verifier,
} from "../roles/index.js";
import {
  applyRuntimeSteeringOverride,
  readProjectRuntimeSteeringArtifact,
} from "../runtime-steering.js";
import {
  AgentRunFailureError,
  formatAgentRunFailureDiagnostics,
  type ShellRunner,
} from "../runtime/index.js";
import { deriveProjectStageGateArtifact, readProjectStageGateArtifact } from "../stage-gates.js";
import { resolveAutoMergePolicy } from "../workflow-derived.js";
import { transitionRun, type TimestampFactory } from "../workflow/index.js";
import type { WorkflowWorkspaceManager } from "../worktree/index.js";

export interface IssueWorkflowRequest extends RepoRef {
  issueNumber: number;
  repoRoot: string;
  stateDir: string;
  baseBranch: string;
  branchName?: string;
  openPullRequest?: boolean;
  mergeOnApprove?: boolean;
  suitabilityOverride?: {
    actor?: string;
    reason?: string;
  };
  requirePlanApproval?: boolean;
  approvePlanDigest?: string;
  planApprovalActor?: string;
  planApprovalNote?: string;
  planApprovalSource?: string;
  planEdit?: Partial<ExecutionSpec>;
  planEditActor?: string;
  planEditNote?: string;
  planEditSource?: string;
  rerunContext?: WorkflowRerunContext;
}

export interface PullRequestPublisher {
  publish(params: { run: WorkflowRun; repo: RepoRef; draft?: boolean }): Promise<PullRequestRef>;
}

export interface PullRequestMerger {
  merge(params: { run: WorkflowRun; repo: RepoRef; pullRequest: PullRequestRef }): Promise<void>;
}

export interface IssueWorkflowDeps {
  github: GitHubIssueClient;
  planner: Planner;
  builder: Builder;
  verifier: Verifier;
  store: WorkflowRunStore;
  worktreeManager: WorkflowWorkspaceManager;
  shellRunner: ShellRunner;
  publisher?: PullRequestPublisher;
  merger?: PullRequestMerger;
  now?: TimestampFactory;
}

function noteRun(run: WorkflowRun, note: string, now: TimestampFactory): WorkflowRun {
  return {
    ...run,
    updatedAt: now(),
    history: [...run.history, note],
  };
}

function trimSingleLine(value: string | undefined): string | undefined {
  const singleLine = value
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return singleLine && singleLine.length > 0 ? singleLine : undefined;
}

function formatWorkflowFailureNote(stageLabel: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const summary = trimSingleLine(message) ?? `${stageLabel} failed.`;
  const diagnostics =
    error instanceof AgentRunFailureError
      ? formatAgentRunFailureDiagnostics(error.diagnostics)
      : undefined;
  return diagnostics
    ? `${stageLabel} failed: ${summary} (${diagnostics})`
    : `${stageLabel} failed: ${summary}`;
}

function extractWorkflowFailureDiagnostics(error: unknown): WorkflowFailureDiagnostics | undefined {
  const summary = trimSingleLine(error instanceof Error ? error.message : String(error));
  if (!(error instanceof AgentRunFailureError)) {
    return summary ? { summary } : undefined;
  }

  return {
    summary: summary ?? "Agent run failed.",
    provider: error.diagnostics.provider,
    model: error.diagnostics.model,
    systemPromptChars: error.diagnostics.systemPromptChars,
    skillsPromptChars: error.diagnostics.skillsPromptChars,
    toolSchemaChars: error.diagnostics.toolSchemaChars,
    toolCount: error.diagnostics.toolCount,
    skillCount: error.diagnostics.skillCount,
    injectedWorkspaceFileCount: error.diagnostics.injectedWorkspaceFileCount,
    bootstrapWarningShown: error.diagnostics.bootstrapWarningShown,
    lastCallUsageTotal: error.diagnostics.lastCallUsageTotal,
  };
}

function transitionRunToFailure(
  run: WorkflowRun,
  stageLabel: string,
  error: unknown,
  now: TimestampFactory,
): WorkflowRun {
  const failedRun = transitionRun(
    {
      ...run,
      failureDiagnostics: undefined,
    },
    "failed",
    formatWorkflowFailureNote(stageLabel, error),
    now,
  );
  const diagnostics = extractWorkflowFailureDiagnostics(error);
  return diagnostics
    ? {
        ...failedRun,
        failureDiagnostics: diagnostics,
      }
    : failedRun;
}

function attachRerunContext(
  run: WorkflowRun,
  rerunContext: WorkflowRerunContext,
  now: TimestampFactory,
): WorkflowRun {
  const normalizedReason = rerunContext.reason.trim() || "Manual rerun requested.";
  const normalizedContext: WorkflowRerunContext = {
    ...rerunContext,
    reason: normalizedReason,
    reviewSummary: rerunContext.reviewSummary?.trim() || undefined,
    reviewUrl: rerunContext.reviewUrl?.trim() || undefined,
    requestedCoderAgentId: rerunContext.requestedCoderAgentId?.trim() || undefined,
    requestedVerifierAgentId: rerunContext.requestedVerifierAgentId?.trim() || undefined,
  };

  const notes = [
    `Rerun requested: ${trimSingleLine(normalizedReason) ?? "Manual rerun requested."}`,
  ];

  if (normalizedContext.priorRunId || normalizedContext.priorStage) {
    notes.push(
      `Rerun context: prior run ${normalizedContext.priorRunId ?? "unknown"} from stage ${normalizedContext.priorStage ?? "unknown"}.`,
    );
  }

  if (normalizedContext.reviewDecision || normalizedContext.reviewSubmittedAt) {
    notes.push(
      `Latest review context: ${normalizedContext.reviewDecision ?? "unknown"} at ${normalizedContext.reviewSubmittedAt ?? "unknown"}.`,
    );
  }

  const reviewSummary = trimSingleLine(normalizedContext.reviewSummary);
  if (reviewSummary) {
    notes.push(`Latest review summary: ${reviewSummary}`);
  }

  if (normalizedContext.reviewUrl) {
    notes.push(`Latest review URL: ${normalizedContext.reviewUrl}`);
  }

  if (normalizedContext.requestedCoderAgentId || normalizedContext.requestedVerifierAgentId) {
    notes.push(
      `Requested runtime reroute: ${[
        normalizedContext.requestedCoderAgentId
          ? `coder=${normalizedContext.requestedCoderAgentId}`
          : undefined,
        normalizedContext.requestedVerifierAgentId
          ? `verifier=${normalizedContext.requestedVerifierAgentId}`
          : undefined,
      ]
        .filter(Boolean)
        .join(", ")}`,
    );
  }

  return {
    ...appendWorkflowHandoffEntries(run, buildRerunContextHandoffs(normalizedContext)),
    updatedAt: now(),
    rerunContext: normalizedContext,
    history: [...run.history, ...notes],
  };
}

function defaultBranchName(issueNumber: number): string {
  return `openclawcode/issue-${issueNumber}`;
}

function computeExecutionSpecDigest(spec: ExecutionSpec): string {
  const stablePayload = JSON.stringify({
    summary: spec.summary,
    scope: spec.scope,
    outOfScope: spec.outOfScope,
    acceptanceCriteria: spec.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      required: criterion.required,
    })),
    testPlan: spec.testPlan,
    risks: spec.risks,
    assumptions: spec.assumptions,
    openQuestions: spec.openQuestions,
    riskLevel: spec.riskLevel,
  });

  return `sha256:${createHash("sha256").update(stablePayload).digest("hex")}`;
}

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function createPlanReviewSnapshot(params: {
  required: boolean;
  status: WorkflowPlanReviewSnapshot["status"];
  planDigest: string;
  requestedAt: string | null;
  suppliedDigest?: string;
  approvedAt?: string;
  approvedBy?: string;
  approvalSource?: string;
  approvalNote?: string;
}): WorkflowPlanReviewSnapshot {
  return {
    required: params.required,
    status: params.status,
    planDigest: params.planDigest,
    requestedAt: params.requestedAt,
    suppliedDigest: params.suppliedDigest ?? null,
    approvedAt: params.approvedAt ?? null,
    approvedBy: params.approvedBy ?? null,
    approvalSource: params.approvalSource ?? null,
    approvalNote: params.approvalNote ?? null,
  };
}

const PLAN_EDITABLE_FIELDS = [
  "summary",
  "scope",
  "outOfScope",
  "acceptanceCriteria",
  "testPlan",
  "risks",
  "assumptions",
  "openQuestions",
  "riskLevel",
] as const satisfies ReadonlyArray<keyof ExecutionSpec>;

function resolvePlanEditedFields(planEdit: Partial<ExecutionSpec> | undefined): string[] {
  if (!planEdit) {
    return [];
  }
  return PLAN_EDITABLE_FIELDS.filter((field) => planEdit[field] !== undefined);
}

function applyPlanEdit(
  run: WorkflowRun,
  params: {
    planEdit: Partial<ExecutionSpec>;
    actor?: string;
    note?: string;
    source?: string;
  },
  now: TimestampFactory,
): WorkflowRun {
  if (!run.executionSpec) {
    return run;
  }

  const editedFields = resolvePlanEditedFields(params.planEdit);
  if (editedFields.length === 0) {
    return run;
  }

  const appliedAt = now();
  const record: WorkflowPlanEditRecord = {
    appliedAt,
    source: trimText(params.source) ?? null,
    actor: trimText(params.actor) ?? null,
    note: trimText(params.note) ?? null,
    editedFields,
  };
  const updatedSpec: ExecutionSpec = {
    ...run.executionSpec,
    ...params.planEdit,
  };

  return appendWorkflowHandoffEntries(
    {
      ...run,
      executionSpec: updatedSpec,
      updatedAt: appliedAt,
      planEdits: [...(run.planEdits ?? []), record],
      history: [
        ...run.history,
        `Plan edited before code execution: ${editedFields.join(", ")}.`,
      ],
    },
    [
      {
        kind: "plan-edit",
        recordedAt: appliedAt,
        actor: record.actor ?? undefined,
        note: record.note ?? undefined,
        summary: [
          `Edited fields: ${editedFields.join(", ")}`,
          record.source ?? undefined,
        ]
          .filter(Boolean)
          .join(" | "),
      },
    ],
  );
}

function mapWorkflowBlueprintContext(
  blueprint: Awaited<ReturnType<typeof readProjectBlueprintDocument>>,
): WorkflowBlueprintContext | undefined {
  if (!blueprint.exists) {
    return undefined;
  }

  return {
    path: blueprint.blueprintPath,
    status: blueprint.status,
    revisionId: blueprint.revisionId,
    agreed: blueprint.hasAgreementCheckpoint,
    defaultedSectionCount: blueprint.defaultedSectionCount,
    workstreamCandidateCount: blueprint.workstreamCandidateCount,
    openQuestionCount: blueprint.openQuestionCount,
    humanGateCount: blueprint.humanGateCount,
  };
}

function mapWorkflowRoleRoutingSnapshot(params: {
  artifactExists: boolean;
  plan: Awaited<ReturnType<typeof deriveProjectRoleRoutingPlan>>;
}): WorkflowRoleRoutingSnapshot | undefined {
  if (!params.plan.blueprintExists) {
    return undefined;
  }

  return {
    artifactExists: params.artifactExists,
    blueprintRevisionId: params.plan.blueprintRevisionId,
    mixedMode: params.plan.mixedMode,
    fallbackConfigured: params.plan.fallbackConfigured,
    unresolvedRoleCount: params.plan.unresolvedRoleCount,
    routes: params.plan.routes.map((route) => ({
      roleId: route.roleId,
      adapterId: route.adapterId,
      source: route.source,
      configured: route.configured,
      fallbackChain: route.fallbackChain,
      runtimeCapable: route.runtimeCapable,
      rerouteCapable: route.rerouteCapable,
      resolvedBackend: route.resolvedBackend,
      resolvedAgentId: route.resolvedAgentId,
      appliedSource: route.appliedSource,
      stages: route.stages,
    })),
    stageRoutes: params.plan.stageRoutes.map((route) => ({
      stageId: route.stageId,
      roleId: route.roleId,
      adapterId: route.adapterId,
      resolvedAgentId: route.resolvedAgentId,
      source: route.source,
      fallbackChain: route.fallbackChain,
    })),
  };
}

function mapWorkflowStageGateSnapshot(params: {
  artifactExists: boolean;
  artifact: Awaited<ReturnType<typeof deriveProjectStageGateArtifact>>;
}): WorkflowStageGateSnapshot | undefined {
  if (!params.artifact.blueprintExists) {
    return undefined;
  }

  return {
    artifactExists: params.artifactExists,
    blueprintRevisionId: params.artifact.blueprintRevisionId,
    gateCount: params.artifact.gateCount,
    blockedGateCount: params.artifact.blockedGateCount,
    needsHumanDecisionCount: params.artifact.needsHumanDecisionCount,
    gates: params.artifact.gates.map((gate) => ({
      gateId: gate.gateId,
      readiness: gate.readiness,
      decisionRequired: gate.decisionRequired,
      blockerCount: gate.blockers.length,
      suggestionCount: gate.suggestions.length,
      latestDecision: gate.latestDecision
        ? {
            decision: gate.latestDecision.decision,
            note: gate.latestDecision.note,
            actor: gate.latestDecision.actor,
            recordedAt: gate.latestDecision.recordedAt,
          }
        : null,
    })),
  };
}

function appendWorkflowHandoffEntries(
  run: WorkflowRun,
  entries: WorkflowHandoffEntry[],
): WorkflowRun {
  if (entries.length === 0) {
    return run;
  }

  const merged = [...(run.handoffs?.entries ?? []), ...entries].toSorted((left, right) =>
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.kind.localeCompare(right.kind) ||
    left.summary.localeCompare(right.summary),
  );

  return {
    ...run,
    handoffs: {
      entries: merged,
    } satisfies WorkflowHandoffSnapshot,
  };
}

function mapStageGateDecisionHandoffs(
  artifact: Awaited<ReturnType<typeof deriveProjectStageGateArtifact>>,
): WorkflowHandoffEntry[] {
  return artifact.decisions.map((decision) => ({
    kind: "stage-gate-decision",
    recordedAt: decision.recordedAt,
    actor: decision.actor ?? undefined,
    gateId: decision.gateId,
    decision: decision.decision,
    note: decision.note ?? undefined,
    summary: [
      `${decision.gateId} ${decision.decision}`,
      decision.note?.trim() || undefined,
    ]
      .filter(Boolean)
      .join(" | "),
  }));
}

function buildRerunContextHandoffs(rerunContext: WorkflowRerunContext): WorkflowHandoffEntry[] {
  const entries: WorkflowHandoffEntry[] = [
    {
      kind: "rerun-request",
      recordedAt: rerunContext.requestedAt,
      summary: rerunContext.reason.trim() || "Manual rerun requested.",
      priorRunId: rerunContext.priorRunId,
      priorStage: rerunContext.priorStage,
      reviewDecision: rerunContext.reviewDecision,
      reviewSubmittedAt: rerunContext.reviewSubmittedAt,
    },
  ];

  if (rerunContext.requestedCoderAgentId || rerunContext.requestedVerifierAgentId) {
    entries.push({
      kind: "runtime-reroute",
      recordedAt: rerunContext.requestedAt,
      summary: [
        rerunContext.requestedCoderAgentId
          ? `coder=${rerunContext.requestedCoderAgentId}`
          : undefined,
        rerunContext.requestedVerifierAgentId
          ? `verifier=${rerunContext.requestedVerifierAgentId}`
          : undefined,
      ]
        .filter(Boolean)
        .join(", "),
      requestedCoderAgentId: rerunContext.requestedCoderAgentId,
      requestedVerifierAgentId: rerunContext.requestedVerifierAgentId,
    });
  }

  if (rerunContext.manualTakeoverRequestedAt || rerunContext.manualTakeoverWorktreePath) {
    entries.push({
      kind: "manual-takeover",
      recordedAt: rerunContext.manualTakeoverRequestedAt ?? rerunContext.requestedAt,
      actor: rerunContext.manualTakeoverActor,
      summary: rerunContext.manualTakeoverWorktreePath?.trim() || "Manual takeover recorded.",
      worktreePath: rerunContext.manualTakeoverWorktreePath,
    });
  }

  if (rerunContext.manualResumeNote?.trim()) {
    entries.push({
      kind: "manual-resume",
      recordedAt: rerunContext.requestedAt,
      actor: rerunContext.manualTakeoverActor,
      summary: rerunContext.manualResumeNote.trim(),
      worktreePath: rerunContext.manualTakeoverWorktreePath,
    });
  }

  return entries;
}

function buildRuntimeSteeringHandoffEntry(params: {
  stageId: "building" | "verifying";
  selection: WorkflowRuntimeRoleSelection;
  steering: Awaited<ReturnType<typeof readProjectRuntimeSteeringArtifact>>;
}): WorkflowHandoffEntry[] {
  const override = params.steering.overrides.find(
    (entry) => entry.stageId === params.stageId && entry.roleId === params.selection.roleId,
  );
  if (!override) {
    return [];
  }

  return [
    {
      kind: "runtime-steering",
      recordedAt: override.updatedAt,
      actor: override.actor ?? undefined,
      note: override.note ?? undefined,
      summary: [
        `stage=${params.stageId}`,
        `role=${params.selection.roleId}`,
        `adapter=${params.selection.adapterId ?? "unchanged"}`,
        `agent=${params.selection.appliedAgentId ?? "runner-default"}`,
      ].join(" | "),
      requestedCoderAgentId:
        params.selection.roleId === "coder" ? params.selection.appliedAgentId ?? undefined : undefined,
      requestedVerifierAgentId:
        params.selection.roleId === "verifier"
          ? params.selection.appliedAgentId ?? undefined
          : undefined,
    },
  ];
}

async function captureWorkflowPlanningContext(
  repoRootInput: string,
): Promise<Pick<WorkflowRun, "blueprintContext" | "roleRouting" | "stageGates" | "handoffs">> {
  const repoRoot = path.resolve(repoRootInput);
  const blueprint = await readProjectBlueprintDocument(repoRoot);

  if (!blueprint.exists) {
    return {};
  }

  const storedRoleRouting = await readProjectRoleRoutingPlan(repoRoot);
  const roleRoutingPlan = storedRoleRouting.exists
    ? storedRoleRouting
    : await deriveProjectRoleRoutingPlan(repoRoot);
  const storedStageGates = await readProjectStageGateArtifact(repoRoot);
  const stageGateArtifact = storedStageGates.exists
    ? storedStageGates
    : await deriveProjectStageGateArtifact(repoRoot);

  return {
    blueprintContext: mapWorkflowBlueprintContext(blueprint),
    roleRouting: mapWorkflowRoleRoutingSnapshot({
      artifactExists: storedRoleRouting.exists,
      plan: roleRoutingPlan,
    }),
    stageGates: mapWorkflowStageGateSnapshot({
      artifactExists: storedStageGates.exists,
      artifact: stageGateArtifact,
    }),
    handoffs:
      stageGateArtifact.decisions.length > 0
        ? {
            entries: mapStageGateDecisionHandoffs(stageGateArtifact),
          }
        : undefined,
  };
}

function formatRuntimeRoutingSelectionNote(selection: WorkflowRuntimeRoleSelection): string {
  const requestedAdapter = selection.adapterId ?? "runner-default";
  const appliedAgent =
    selection.appliedAgentId == null ? "the runner default agent" : selection.appliedAgentId;
  return [
    `Runtime routing for ${selection.roleId}:`,
    `requested ${requestedAdapter}`,
    `resolved via ${selection.agentSource}`,
    `using ${appliedAgent}.`,
  ].join(" ");
}

function upsertRuntimeRoutingSelection(
  run: WorkflowRun,
  selection: WorkflowRuntimeRoleSelection,
  now: TimestampFactory,
): WorkflowRun {
  const selections = [
    ...(run.runtimeRouting?.selections.filter((entry) => entry.roleId !== selection.roleId) ?? []),
    selection,
  ].toSorted((left, right) => left.roleId.localeCompare(right.roleId));

  return noteRun(
    {
      ...run,
      runtimeRouting: {
        selections,
      },
    },
    formatRuntimeRoutingSelectionNote(selection),
    now,
  );
}

function shouldAutoMerge(run: WorkflowRun): boolean {
  return resolveAutoMergePolicy(run).autoMergePolicyEligible;
}

function shouldSkipDraftPullRequest(run: WorkflowRun): boolean {
  return (run.buildResult?.changedFiles.length ?? 0) === 0;
}

function isNoCommitPullRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("No commits between");
}

function formatNoCommitPullRequestNote(run: WorkflowRun): string {
  const branchName = run.workspace?.branchName ?? "the issue branch";
  return `Draft PR skipped: no new commits were produced between the base branch and ${branchName}.`;
}

function formatClosedStalePullRequestNote(pullRequest: PullRequestRef): string {
  return `Closed stale pull request because the latest run produced no code changes: ${pullRequest.url}`;
}

function hasNoCommitPullRequestNote(run: WorkflowRun): boolean {
  return run.history.some((entry) =>
    entry.startsWith("Draft PR skipped: no new commits were produced"),
  );
}

function formatAutoMergeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Resource not accessible by personal access token")) {
    return [
      "Auto-merge failed: GitHub token cannot merge pull requests.",
      "Ensure GH_TOKEN/GITHUB_TOKEN has pull request and contents write access.",
      `Original error: ${message}`,
    ].join(" ");
  }
  return `Auto-merge failed: ${message}`;
}

function formatIssueClosedNote(issueNumber: number): string {
  return `Issue #${issueNumber} closed automatically after merge.`;
}

function formatCompletedWithoutChangesNote(): string {
  return "Workflow completed without code changes; no pull request was needed.";
}

function formatIssueClosedWithoutChangesNote(issueNumber: number): string {
  return `Issue #${issueNumber} closed automatically after verification determined no code changes were needed.`;
}

function formatIssueCloseFailure(issueNumber: number, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Resource not accessible by personal access token")) {
    return [
      `Issue close failed for #${issueNumber}: GitHub token cannot update issues.`,
      "Ensure GH_TOKEN/GITHUB_TOKEN has issues write access.",
      `Original error: ${message}`,
    ].join(" ");
  }
  return `Issue close failed for #${issueNumber}: ${message}`;
}

function formatExistingPullRequestNote(pullRequest: PullRequestRef): string {
  return `Reusing existing pull request: ${pullRequest.url}`;
}

function shouldCompleteWithoutChanges(
  run: WorkflowRun,
  publishedPullRequest: PullRequestRef | undefined,
): boolean {
  return (
    run.stage === "ready-for-human-review" &&
    !publishedPullRequest &&
    hasNoCommitPullRequestNote(run)
  );
}

async function pushIssueBranch(params: {
  shellRunner: ShellRunner;
  workspace: WorkflowWorkspace;
}): Promise<void> {
  const push = await params.shellRunner.run({
    cwd: params.workspace.worktreePath,
    command: `git push -u origin ${params.workspace.branchName}`,
  });
  if (push.code !== 0) {
    throw new Error(push.stderr || "Failed to push branch to origin");
  }
}

export class GitHubPullRequestPublisher implements PullRequestPublisher {
  constructor(
    private readonly github: GitHubIssueClient,
    private readonly shellRunner: ShellRunner,
  ) {}

  async publish(params: {
    run: WorkflowRun;
    repo: RepoRef;
    draft?: boolean;
  }): Promise<PullRequestRef> {
    if (!params.run.workspace || !params.run.draftPullRequest) {
      throw new Error("Run workspace and draft pull request are required before publishing.");
    }

    await pushIssueBranch({
      shellRunner: this.shellRunner,
      workspace: params.run.workspace,
    });

    return await this.github.createDraftPullRequest({
      owner: params.repo.owner,
      repo: params.repo.repo,
      title: params.run.draftPullRequest.title,
      body: params.run.draftPullRequest.body,
      head: params.run.workspace.branchName,
      base: params.run.draftPullRequest.baseBranch,
      draft: params.draft,
    });
  }
}

export class GitHubPullRequestMerger implements PullRequestMerger {
  constructor(private readonly github: GitHubIssueClient) {}

  async merge(params: {
    run: WorkflowRun;
    repo: RepoRef;
    pullRequest: PullRequestRef;
  }): Promise<void> {
    await this.github.mergePullRequest({
      owner: params.repo.owner,
      repo: params.repo.repo,
      pullNumber: params.pullRequest.number,
    });
  }
}

export async function runIssueWorkflow(
  request: IssueWorkflowRequest,
  deps: IssueWorkflowDeps,
): Promise<WorkflowRun> {
  const now = deps.now ?? (() => new Date().toISOString());
  const issue = await deps.github.fetchIssue({
    owner: request.owner,
    repo: request.repo,
    issueNumber: request.issueNumber,
  });

  let run = {
    ...createRun(issue, now),
    ...(await captureWorkflowPlanningContext(request.repoRoot)),
  };
  if (request.rerunContext) {
    run = attachRerunContext(run, request.rerunContext, now);
  }
  await deps.store.save(run);

  run = transitionRun(run, "planning", "Planning started", now);
  await deps.store.save(run);

  try {
    run = await executePlanning(run, deps.planner, now);
  } catch (error) {
    run = transitionRunToFailure(run, "Planning", error, now);
    await deps.store.save(run);
    throw error;
  }
  await deps.store.save(run);

  if (request.planEdit) {
    run = applyPlanEdit(
      run,
      {
        planEdit: request.planEdit,
        actor: request.planEditActor,
        note: request.planEditNote,
        source: request.planEditSource,
      },
      now,
    );
    await deps.store.save(run);
  }

  const requirePlanApproval = request.requirePlanApproval || request.approvePlanDigest != null;
  if (requirePlanApproval && run.executionSpec) {
    const planDigest = computeExecutionSpecDigest(run.executionSpec);
    const suppliedDigest = trimText(request.approvePlanDigest);
    const planReadyAt = run.updatedAt;

    if (suppliedDigest === planDigest) {
      run = noteRun(
        {
          ...run,
          planReview: createPlanReviewSnapshot({
            required: true,
            status: "approved",
            planDigest,
            requestedAt: planReadyAt,
            suppliedDigest,
            approvedAt: now(),
            approvedBy: trimText(request.planApprovalActor),
            approvalSource: trimText(request.planApprovalSource),
            approvalNote: trimText(request.planApprovalNote),
          }),
        },
        `Plan approved for code execution: ${planDigest}`,
        now,
      );
      await deps.store.save(run);
    } else {
      const haltedRun = transitionRun(
        run,
        "awaiting-plan-approval",
        suppliedDigest
          ? `Plan approval digest mismatch: supplied ${suppliedDigest} but current plan is ${planDigest}.`
          : "Plan approval required before workspace preparation and code execution.",
        now,
      );
      run = {
        ...haltedRun,
        planReview: createPlanReviewSnapshot({
          required: true,
          status: "awaiting-approval",
          planDigest,
          requestedAt: haltedRun.updatedAt,
          suppliedDigest,
          approvedBy: trimText(request.planApprovalActor),
          approvalSource: trimText(request.planApprovalSource),
          approvalNote: trimText(request.planApprovalNote),
        }),
      };
      await deps.store.save(run);
      return run;
    }
  }

  const suitability = assessIssueSuitability(run, now(), {
    override: request.suitabilityOverride,
  });
  run = noteRun(
    {
      ...run,
      suitability,
    },
    `Suitability assessed: ${suitability.summary}`,
    now,
  );
  if (suitability.overrideApplied) {
    run = appendWorkflowHandoffEntries(run, [
      {
        kind: "suitability-override",
        recordedAt: run.updatedAt,
        actor: suitability.overrideActor,
        note: suitability.overrideReason,
        summary: suitability.overrideReason?.trim() || suitability.summary,
      },
    ]);
  }
  await deps.store.save(run);

  if (suitability.decision === "escalate") {
    run = transitionRun(
      run,
      "escalated",
      `Suitability gate escalated the issue before branch mutation: ${suitability.summary}`,
      now,
    );
    await deps.store.save(run);
    return run;
  }

  let workspace: WorkflowWorkspace;
  try {
    workspace = await deps.worktreeManager.prepare({
      repoRoot: request.repoRoot,
      worktreeRoot: path.join(request.stateDir, "worktrees"),
      branchName: request.branchName ?? defaultBranchName(request.issueNumber),
      baseBranch: request.baseBranch,
      runId: run.id,
    });
  } catch (error) {
    run = transitionRunToFailure(run, "Workspace preparation", error, now);
    await deps.store.save(run);
    throw error;
  }
  run = noteRun(
    {
      ...run,
      workspace,
    },
    `Workspace prepared at ${workspace.worktreePath}`,
    now,
  );
  await deps.store.save(run);

  const runtimeSteering = await readProjectRuntimeSteeringArtifact(request.repoRoot);

  const buildRuntimeRoutingPreview = deps.builder.previewRuntimeRouting?.(run);
  const buildRuntimeRouting =
    buildRuntimeRoutingPreview == null
      ? undefined
      : applyRuntimeSteeringOverride({
          selection: buildRuntimeRoutingPreview,
          stageId: "building",
          steering: runtimeSteering,
        });
  if (buildRuntimeRouting) {
    run = appendWorkflowHandoffEntries(
      run,
      buildRuntimeSteeringHandoffEntry({
        stageId: "building",
        selection: buildRuntimeRouting,
        steering: runtimeSteering,
      }),
    );
    run = upsertRuntimeRoutingSelection(run, buildRuntimeRouting, now);
    await deps.store.save(run);
  }

  run = transitionRun(run, "building", "Build started", now);
  await deps.store.save(run);

  try {
    run = await executeBuild(run, deps.builder);
  } catch (error) {
    run = transitionRunToFailure(run, "Build", error, now);
    await deps.store.save(run);
    throw error;
  }
  await deps.store.save(run);

  let publishedPullRequest: PullRequestRef | undefined;
  const publishAsDraft = !request.mergeOnApprove;
  if (request.openPullRequest && deps.publisher) {
    if (!run.workspace) {
      throw new Error("Run workspace is required before publishing a pull request.");
    }
    if (shouldSkipDraftPullRequest(run)) {
      const existingPullRequest = await deps.github.findOpenPullRequestForBranch({
        owner: request.owner,
        repo: request.repo,
        head: run.workspace.branchName,
        base: request.baseBranch,
      });
      if (existingPullRequest) {
        try {
          await deps.github.closeIssue({
            owner: request.owner,
            repo: request.repo,
            issueNumber: existingPullRequest.number,
          });
          run = noteRun(run, formatClosedStalePullRequestNote(existingPullRequest), now);
        } catch (error) {
          run = noteRun(
            run,
            `Stale pull request close failed for #${existingPullRequest.number}: ${error instanceof Error ? error.message : String(error)}`,
            now,
          );
        }
      }
      run = noteRun(run, formatNoCommitPullRequestNote(run), now);
    } else {
      const existingPullRequest = await deps.github.findOpenPullRequestForBranch({
        owner: request.owner,
        repo: request.repo,
        head: run.workspace.branchName,
        base: request.baseBranch,
      });
      if (existingPullRequest) {
        await pushIssueBranch({
          shellRunner: deps.shellRunner,
          workspace: run.workspace,
        });
        publishedPullRequest = existingPullRequest;
        run = noteRun(
          {
            ...run,
            draftPullRequest: {
              ...run.draftPullRequest!,
              number: existingPullRequest.number,
              url: existingPullRequest.url,
            },
          },
          formatExistingPullRequestNote(existingPullRequest),
          now,
        );
      } else {
        try {
          publishedPullRequest = await deps.publisher.publish({
            run,
            repo: {
              owner: request.owner,
              repo: request.repo,
            },
            draft: publishAsDraft,
          });
          run = noteRun(
            {
              ...run,
              draftPullRequest: {
                ...run.draftPullRequest!,
                number: publishedPullRequest.number,
                url: publishedPullRequest.url,
                openedAt: now(),
              },
            },
            `${publishAsDraft ? "Draft PR" : "Pull request"} opened: ${publishedPullRequest.url}`,
            now,
          );
        } catch (error) {
          if (!isNoCommitPullRequestError(error)) {
            throw error;
          }
          run = noteRun(run, formatNoCommitPullRequestNote(run), now);
        }
      }
    }
    await deps.store.save(run);
  } else if (run.draftPullRequest) {
    run = {
      ...run,
      draftPullRequest: {
        ...run.draftPullRequest,
        body: buildPullRequestBody(run),
      },
    };
    await deps.store.save(run);
  }

  const verificationRuntimeRoutingPreview = deps.verifier.previewRuntimeRouting?.(run);
  const verificationRuntimeRouting =
    verificationRuntimeRoutingPreview == null
      ? undefined
      : applyRuntimeSteeringOverride({
          selection: verificationRuntimeRoutingPreview,
          stageId: "verifying",
          steering: runtimeSteering,
        });
  if (verificationRuntimeRouting) {
    run = appendWorkflowHandoffEntries(
      run,
      buildRuntimeSteeringHandoffEntry({
        stageId: "verifying",
        selection: verificationRuntimeRouting,
        steering: runtimeSteering,
      }),
    );
    run = upsertRuntimeRoutingSelection(run, verificationRuntimeRouting, now);
    await deps.store.save(run);
  }

  run = transitionRun(run, "verifying", "Verification started", now);
  await deps.store.save(run);

  try {
    run = await executeVerification(run, deps.verifier, now);
  } catch (error) {
    run = transitionRunToFailure(run, "Verification", error, now);
    await deps.store.save(run);
    throw error;
  }
  await deps.store.save(run);

  if (shouldCompleteWithoutChanges(run, publishedPullRequest)) {
    run = transitionRun(run, "completed-without-changes", formatCompletedWithoutChangesNote(), now);
    await deps.store.save(run);
    try {
      await deps.github.closeIssue({
        owner: request.owner,
        repo: request.repo,
        issueNumber: request.issueNumber,
      });
      run = noteRun(run, formatIssueClosedWithoutChangesNote(request.issueNumber), now);
    } catch (error) {
      run = noteRun(run, formatIssueCloseFailure(request.issueNumber, error), now);
    }
    await deps.store.save(run);
    return run;
  }

  if (
    request.mergeOnApprove &&
    publishedPullRequest &&
    run.stage === "ready-for-human-review" &&
    deps.merger
  ) {
    if (shouldAutoMerge(run)) {
      try {
        await deps.merger.merge({
          run,
          repo: {
            owner: request.owner,
            repo: request.repo,
          },
          pullRequest: publishedPullRequest,
        });
        run = transitionRun(run, "merged", "Pull request merged automatically", now);
        await deps.store.save(run);
        try {
          await deps.github.closeIssue({
            owner: request.owner,
            repo: request.repo,
            issueNumber: request.issueNumber,
          });
          run = noteRun(run, formatIssueClosedNote(request.issueNumber), now);
        } catch (error) {
          run = noteRun(run, formatIssueCloseFailure(request.issueNumber, error), now);
        }
      } catch (error) {
        run = noteRun(run, formatAutoMergeFailure(error), now);
      }
    } else {
      run = noteRun(
        run,
        `Auto-merge skipped: ${resolveAutoMergePolicy(run).autoMergePolicyReason}`,
        now,
      );
    }
    await deps.store.save(run);
  }

  return run;
}
