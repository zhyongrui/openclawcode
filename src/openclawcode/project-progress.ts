import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readProjectBlueprintDocument } from "./blueprint.js";
import type { RepoRef } from "./github/index.js";
import {
  readProjectIssueMaterializationArtifact,
  writeProjectIssueMaterializationArtifact,
} from "./issue-materialization.js";
import {
  parseRepoRefFromRepoKey,
  resolveChatNextSuggestedCommand,
} from "./next-suggested-command.js";
import { readProjectNextWorkSelection, writeProjectNextWorkSelection } from "./next-work.js";
import { readProjectOperatorProgram } from "./operator-program.js";
import type { OpenClawCodeOperatorStatusSnapshot } from "./operator-status.js";
import { writeProjectRoleRoutingPlan, type ProjectRoleRoute } from "./role-routing.js";
import { writeProjectStageGateArtifact } from "./stage-gates.js";
import { writeProjectWorkItemInventory } from "./work-items.js";

export const PROJECT_PROGRESS_SCHEMA_VERSION = 1;

export interface ProjectProgressOperatorSummary {
  available: boolean;
  repoKey: string | null;
  bindingPresent: boolean;
  pendingApprovalCount: number;
  queuedRunCount: number;
  currentRunCount: number;
  currentRunIssueKey: string | null;
  currentRunStage: string | null;
  currentRunBranchName: string | null;
  currentRunPullRequestNumber: number | null;
  currentRunPullRequestUrl: string | null;
  currentRunStatusUpdatedAt: string | null;
  providerPauseActive: boolean;
}

export interface ProjectProgressOperatorProgramSummary {
  available: boolean;
  artifactPath: string;
  updatedAt: string | null;
  title: string | null;
  summary: string | null;
  mutableSurfaceMode: string | null;
  mutableSurfacePathCount: number;
  mutableSurfacePathsPresent: boolean;
  validationBudgetSummary: string | null;
  validationBudgetMaxPrimaryCommands: number | null;
  requireOneExecutableProof: boolean;
  advancementRuleSummary: string | null;
  keepCriteriaCount: number;
  discardCriteriaCount: number;
  retryCriteriaCount: number;
  simplificationBias: boolean;
  attemptLedgerRequired: boolean;
  nextActionCode: string | null;
  nextActionSummary: string | null;
  linkedBlueprintPath: string;
  linkedWorkItemsPath: string;
  linkedStageGatesPath: string;
}

export interface ProjectProgressArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  repoKey: string | null;
  blueprintPath: string;
  blueprintStatus: string | null;
  blueprintRevisionId: string | null;
  workItemCount: number;
  plannedWorkItemCount: number;
  nextWorkDecision: string;
  nextWorkBlockingGateId: string | null;
  nextWorkPrimaryBlocker: string | null;
  activeWorkstreamIndex: number | null;
  activeWorkstreamCount: number;
  activeWorkstreamTitle: string | null;
  activeWorkstreamSummary: string | null;
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  selectedWorkItemExecutionMode: string | null;
  selectedIssueNumber: number | null;
  selectedIssueUrl: string | null;
  selectedIssueTitle: string | null;
  issueMaterializationOutcome: string | null;
  roleRoutingMixedMode: boolean;
  roleRoutes: ProjectRoleRoute[];
  roleRouteSummary: string[];
  unresolvedRoleCount: number;
  blockedGateCount: number;
  needsHumanDecisionCount: number;
  nextSuggestedCommand: string | null;
  nextSuggestedChatCommand: string | null;
  operator: ProjectProgressOperatorSummary;
  operatorProgram: ProjectProgressOperatorProgramSummary;
}

function resolveProjectProgressArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "project-progress.json");
}

function resolveActiveWorkstreamDetails(params: {
  selectedWorkItem: Awaited<ReturnType<typeof readProjectNextWorkSelection>>["selectedWorkItem"];
  plannedWorkItemCount: number;
}): {
  index: number | null;
  count: number;
  title: string | null;
  summary: string | null;
} {
  const count = Math.max(0, params.plannedWorkItemCount);
  if (!params.selectedWorkItem) {
    return {
      index: null,
      count,
      title: null,
      summary: null,
    };
  }
  if (
    params.selectedWorkItem.selectedFrom === "discovery" ||
    params.selectedWorkItem.workstreamIndex == null
  ) {
    return {
      index: null,
      count,
      title: params.selectedWorkItem.title,
      summary: `Discovery follow-up | ${params.selectedWorkItem.title}`,
    };
  }
  return {
    index: params.selectedWorkItem.workstreamIndex,
    count: Math.max(count, params.selectedWorkItem.workstreamIndex),
    title: params.selectedWorkItem.title,
    summary: `Workstream ${params.selectedWorkItem.workstreamIndex}/${Math.max(count, params.selectedWorkItem.workstreamIndex)} | ${params.selectedWorkItem.title}`,
  };
}

function buildOperatorSummary(params: {
  repo?: RepoRef;
  snapshot?: OpenClawCodeOperatorStatusSnapshot;
}): ProjectProgressOperatorSummary {
  if (!params.repo || !params.snapshot) {
    return {
      available: false,
      repoKey: params.repo ? `${params.repo.owner}/${params.repo.repo}` : null,
      bindingPresent: false,
      pendingApprovalCount: 0,
      queuedRunCount: 0,
      currentRunCount: 0,
      currentRunIssueKey: null,
      currentRunStage: null,
      currentRunBranchName: null,
      currentRunPullRequestNumber: null,
      currentRunPullRequestUrl: null,
      currentRunStatusUpdatedAt: null,
      providerPauseActive: false,
    };
  }

  const repoKey = `${params.repo.owner}/${params.repo.repo}`;
  const repoSummary = params.snapshot.repos.find((entry) => entry.repoKey === repoKey);
  const currentRunIssueKey =
    params.snapshot.currentRun &&
    params.snapshot.currentRun.request.owner === params.repo.owner &&
    params.snapshot.currentRun.request.repo === params.repo.repo
      ? `${params.snapshot.currentRun.request.owner}/${params.snapshot.currentRun.request.repo}#${params.snapshot.currentRun.request.issueNumber}`
      : null;
  const currentRunSnapshot = currentRunIssueKey
    ? (params.snapshot.issueSnapshots.find((entry) => entry.issueKey === currentRunIssueKey) ??
      null)
    : null;

  return {
    available: true,
    repoKey,
    bindingPresent: Boolean(repoSummary?.bindingPresent),
    pendingApprovalCount: repoSummary?.pendingApprovalCount ?? 0,
    queuedRunCount: repoSummary?.queuedRunCount ?? 0,
    currentRunCount: repoSummary?.currentRunCount ?? 0,
    currentRunIssueKey,
    currentRunStage: currentRunSnapshot?.stage ?? null,
    currentRunBranchName:
      currentRunSnapshot?.branchName ?? params.snapshot.currentRun?.request.branchName ?? null,
    currentRunPullRequestNumber: currentRunSnapshot?.pullRequestNumber ?? null,
    currentRunPullRequestUrl: currentRunSnapshot?.pullRequestUrl ?? null,
    currentRunStatusUpdatedAt: currentRunSnapshot?.updatedAt ?? null,
    providerPauseActive: params.snapshot.providerPauseActive,
  };
}

export function buildOperatorProgramSummary(
  artifact: Awaited<ReturnType<typeof readProjectOperatorProgram>>,
): ProjectProgressOperatorProgramSummary {
  return {
    available: artifact.exists,
    artifactPath: artifact.artifactPath,
    updatedAt: artifact.updatedAt,
    title: artifact.title,
    summary: artifact.summary,
    mutableSurfaceMode: artifact.mutableSurfaceMode,
    mutableSurfacePathCount: artifact.mutableSurfacePaths.length,
    mutableSurfacePathsPresent: artifact.mutableSurfacePaths.length > 0,
    validationBudgetSummary: artifact.validationBudgetSummary,
    validationBudgetMaxPrimaryCommands: artifact.validationBudgetMaxPrimaryCommands,
    requireOneExecutableProof: artifact.requireOneExecutableProof,
    advancementRuleSummary: artifact.advancementRuleSummary,
    keepCriteriaCount: artifact.keepCriteria.length,
    discardCriteriaCount: artifact.discardCriteria.length,
    retryCriteriaCount: artifact.retryCriteria.length,
    simplificationBias: artifact.simplificationBias,
    attemptLedgerRequired: artifact.attemptLedgerRequired,
    nextActionCode: artifact.nextActionCode,
    nextActionSummary: artifact.nextActionSummary,
    linkedBlueprintPath: artifact.linkedArtifacts.blueprintPath,
    linkedWorkItemsPath: artifact.linkedArtifacts.workItemsPath,
    linkedStageGatesPath: artifact.linkedArtifacts.stageGatesPath,
  };
}

export async function writeProjectProgressArtifact(params: {
  repoRoot: string;
  repo?: RepoRef;
  operatorSnapshot?: OpenClawCodeOperatorStatusSnapshot;
  materializeIssues?: boolean;
}): Promise<ProjectProgressArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectProgressArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const workItems = await writeProjectWorkItemInventory(repoRoot);
  const nextWork = await writeProjectNextWorkSelection(repoRoot);
  const roleRouting = await writeProjectRoleRoutingPlan(repoRoot);
  const stageGates = await writeProjectStageGateArtifact(repoRoot);
  const operatorProgram = await readProjectOperatorProgram(repoRoot);
  const issueMaterialization =
    params.materializeIssues && params.repo
      ? await writeProjectIssueMaterializationArtifact({
          repoRoot,
          owner: params.repo.owner,
          repo: params.repo.repo,
        })
      : await readProjectIssueMaterializationArtifact(repoRoot);
  const roleRouteSummary = roleRouting.routes.map((route) => {
    const roleLabel = route.roleId === "docWriter" ? "doc-writer" : route.roleId;
    return `${roleLabel}=${route.resolvedBackend}${route.resolvedAgentId ? `@${route.resolvedAgentId}` : ""}`;
  });

  const nextSuggestedCommand =
    nextWork.decision === "ready-to-execute"
      ? params.repo
        ? `openclaw code issue-materialize --repo-root ${repoRoot}`
        : "openclaw code issue-materialize --repo-root <repo-root>"
      : nextWork.blockingGateId
        ? `openclaw code stage-gates-show --repo-root ${repoRoot}`
        : null;
  const nextSuggestedChatCommand = resolveChatNextSuggestedCommand({
    repo: params.repo,
    command: nextSuggestedCommand,
  });
  const activeWorkstream = resolveActiveWorkstreamDetails({
    selectedWorkItem: nextWork.selectedWorkItem,
    plannedWorkItemCount: workItems.plannedWorkItemCount,
  });

  const artifact: ProjectProgressArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_PROGRESS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoKey: params.repo ? `${params.repo.owner}/${params.repo.repo}` : null,
    blueprintPath: blueprint.blueprintPath,
    blueprintStatus: blueprint.status,
    blueprintRevisionId: blueprint.revisionId,
    workItemCount: workItems.workItemCount,
    plannedWorkItemCount: workItems.plannedWorkItemCount,
    nextWorkDecision: nextWork.decision,
    nextWorkBlockingGateId: nextWork.blockingGateId,
    nextWorkPrimaryBlocker: nextWork.blockers[0] ?? null,
    activeWorkstreamIndex: activeWorkstream.index,
    activeWorkstreamCount: activeWorkstream.count,
    activeWorkstreamTitle: activeWorkstream.title,
    activeWorkstreamSummary: activeWorkstream.summary,
    selectedWorkItemId: nextWork.selectedWorkItem?.id ?? null,
    selectedWorkItemTitle: nextWork.selectedWorkItem?.title ?? null,
    selectedWorkItemExecutionMode: nextWork.selectedWorkItem?.executionMode ?? null,
    selectedIssueNumber: issueMaterialization.selectedIssueNumber,
    selectedIssueUrl: issueMaterialization.selectedIssueUrl,
    selectedIssueTitle: issueMaterialization.selectedIssueTitle,
    issueMaterializationOutcome: issueMaterialization.outcome,
    roleRoutingMixedMode: roleRouting.mixedMode,
    roleRoutes: roleRouting.routes,
    roleRouteSummary,
    unresolvedRoleCount: roleRouting.unresolvedRoleCount,
    blockedGateCount: stageGates.blockedGateCount,
    needsHumanDecisionCount: stageGates.needsHumanDecisionCount,
    nextSuggestedCommand,
    nextSuggestedChatCommand,
    operator: buildOperatorSummary({
      repo: params.repo,
      snapshot: params.operatorSnapshot,
    }),
    operatorProgram: buildOperatorProgramSummary(operatorProgram),
  };

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectProgressArtifact(
  repoRootInput: string,
): Promise<ProjectProgressArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectProgressArtifactPath(repoRoot);
  const raw = await readFile(artifactPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!raw) {
    const blueprint = await readProjectBlueprintDocument(repoRoot);
    return {
      repoRoot,
      artifactPath,
      exists: false,
      schemaVersion: null,
      generatedAt: null,
      repoKey: null,
      blueprintPath: blueprint.blueprintPath,
      blueprintStatus: blueprint.status,
      blueprintRevisionId: blueprint.revisionId,
      workItemCount: 0,
      plannedWorkItemCount: 0,
      nextWorkDecision: "no-actionable-work-item",
      nextWorkBlockingGateId: null,
      nextWorkPrimaryBlocker: null,
      activeWorkstreamIndex: null,
      activeWorkstreamCount: 0,
      activeWorkstreamTitle: null,
      activeWorkstreamSummary: null,
      selectedWorkItemId: null,
      selectedWorkItemTitle: null,
      selectedWorkItemExecutionMode: null,
      selectedIssueNumber: null,
      selectedIssueUrl: null,
      selectedIssueTitle: null,
      issueMaterializationOutcome: null,
      roleRoutingMixedMode: false,
      roleRoutes: [],
      roleRouteSummary: [],
      unresolvedRoleCount: 0,
      blockedGateCount: 0,
      needsHumanDecisionCount: 0,
      nextSuggestedCommand: null,
      nextSuggestedChatCommand: null,
      operator: buildOperatorSummary({}),
      operatorProgram: buildOperatorProgramSummary(await readProjectOperatorProgram(repoRoot)),
    };
  }
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const parsed = JSON.parse(raw) as Partial<ProjectProgressArtifact>;
  return {
    repoRoot,
    artifactPath,
    exists: parsed.exists ?? true,
    schemaVersion: parsed.schemaVersion ?? PROJECT_PROGRESS_SCHEMA_VERSION,
    generatedAt: parsed.generatedAt ?? null,
    repoKey: parsed.repoKey ?? null,
    blueprintPath: parsed.blueprintPath ?? blueprint.blueprintPath,
    blueprintStatus: parsed.blueprintStatus ?? blueprint.status,
    blueprintRevisionId: parsed.blueprintRevisionId ?? blueprint.revisionId,
    workItemCount: parsed.workItemCount ?? 0,
    plannedWorkItemCount: parsed.plannedWorkItemCount ?? 0,
    nextWorkDecision: parsed.nextWorkDecision ?? "no-actionable-work-item",
    nextWorkBlockingGateId: parsed.nextWorkBlockingGateId ?? null,
    nextWorkPrimaryBlocker: parsed.nextWorkPrimaryBlocker ?? null,
    activeWorkstreamIndex: parsed.activeWorkstreamIndex ?? null,
    activeWorkstreamCount: parsed.activeWorkstreamCount ?? 0,
    activeWorkstreamTitle: parsed.activeWorkstreamTitle ?? null,
    activeWorkstreamSummary: parsed.activeWorkstreamSummary ?? null,
    selectedWorkItemId: parsed.selectedWorkItemId ?? null,
    selectedWorkItemTitle: parsed.selectedWorkItemTitle ?? null,
    selectedWorkItemExecutionMode: parsed.selectedWorkItemExecutionMode ?? null,
    selectedIssueNumber: parsed.selectedIssueNumber ?? null,
    selectedIssueUrl: parsed.selectedIssueUrl ?? null,
    selectedIssueTitle: parsed.selectedIssueTitle ?? null,
    issueMaterializationOutcome: parsed.issueMaterializationOutcome ?? null,
    roleRoutingMixedMode: parsed.roleRoutingMixedMode ?? false,
    roleRoutes: Array.isArray(parsed.roleRoutes) ? parsed.roleRoutes : [],
    roleRouteSummary: Array.isArray(parsed.roleRouteSummary) ? parsed.roleRouteSummary : [],
    unresolvedRoleCount: parsed.unresolvedRoleCount ?? 0,
    blockedGateCount: parsed.blockedGateCount ?? 0,
    needsHumanDecisionCount: parsed.needsHumanDecisionCount ?? 0,
    nextSuggestedCommand: parsed.nextSuggestedCommand ?? null,
    nextSuggestedChatCommand:
      parsed.nextSuggestedChatCommand ??
      resolveChatNextSuggestedCommand({
        repo: parseRepoRefFromRepoKey(parsed.repoKey),
        command: parsed.nextSuggestedCommand ?? null,
      }),
    operator: {
      available: parsed.operator?.available ?? false,
      repoKey: parsed.operator?.repoKey ?? parsed.repoKey ?? null,
      bindingPresent: parsed.operator?.bindingPresent ?? false,
      pendingApprovalCount: parsed.operator?.pendingApprovalCount ?? 0,
      queuedRunCount: parsed.operator?.queuedRunCount ?? 0,
      currentRunCount: parsed.operator?.currentRunCount ?? 0,
      currentRunIssueKey: parsed.operator?.currentRunIssueKey ?? null,
      currentRunStage: parsed.operator?.currentRunStage ?? null,
      currentRunBranchName: parsed.operator?.currentRunBranchName ?? null,
      currentRunPullRequestNumber: parsed.operator?.currentRunPullRequestNumber ?? null,
      currentRunPullRequestUrl: parsed.operator?.currentRunPullRequestUrl ?? null,
      currentRunStatusUpdatedAt: parsed.operator?.currentRunStatusUpdatedAt ?? null,
      providerPauseActive: parsed.operator?.providerPauseActive ?? false,
    },
    operatorProgram: {
      available: parsed.operatorProgram?.available ?? false,
      artifactPath:
        parsed.operatorProgram?.artifactPath ??
        path.join(repoRoot, ".openclawcode", "operator-program.json"),
      updatedAt: parsed.operatorProgram?.updatedAt ?? null,
      title: parsed.operatorProgram?.title ?? null,
      summary: parsed.operatorProgram?.summary ?? null,
      mutableSurfaceMode: parsed.operatorProgram?.mutableSurfaceMode ?? null,
      mutableSurfacePathCount: parsed.operatorProgram?.mutableSurfacePathCount ?? 0,
      mutableSurfacePathsPresent: parsed.operatorProgram?.mutableSurfacePathsPresent ?? false,
      validationBudgetSummary: parsed.operatorProgram?.validationBudgetSummary ?? null,
      validationBudgetMaxPrimaryCommands:
        parsed.operatorProgram?.validationBudgetMaxPrimaryCommands ?? null,
      requireOneExecutableProof: parsed.operatorProgram?.requireOneExecutableProof ?? false,
      advancementRuleSummary: parsed.operatorProgram?.advancementRuleSummary ?? null,
      keepCriteriaCount: parsed.operatorProgram?.keepCriteriaCount ?? 0,
      discardCriteriaCount: parsed.operatorProgram?.discardCriteriaCount ?? 0,
      retryCriteriaCount: parsed.operatorProgram?.retryCriteriaCount ?? 0,
      simplificationBias: parsed.operatorProgram?.simplificationBias ?? false,
      attemptLedgerRequired: parsed.operatorProgram?.attemptLedgerRequired ?? false,
      nextActionCode: parsed.operatorProgram?.nextActionCode ?? null,
      nextActionSummary: parsed.operatorProgram?.nextActionSummary ?? null,
      linkedBlueprintPath: parsed.operatorProgram?.linkedBlueprintPath ?? "PROJECT-BLUEPRINT.md",
      linkedWorkItemsPath:
        parsed.operatorProgram?.linkedWorkItemsPath ?? ".openclawcode/work-items.json",
      linkedStageGatesPath:
        parsed.operatorProgram?.linkedStageGatesPath ?? ".openclawcode/stage-gates.json",
    },
  };
}
