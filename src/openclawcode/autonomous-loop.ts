import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RepoRef } from "./github/index.js";
import { writeProjectIssueMaterializationArtifact } from "./issue-materialization.js";
import {
  parseRepoRefFromRepoKey,
  resolveChatNextSuggestedCommand,
} from "./next-suggested-command.js";
import { readProjectOperatorProgram } from "./operator-program.js";
import type { OpenClawCodeOperatorStatusSnapshot } from "./operator-status.js";
import { buildOperatorProgramSummary, writeProjectProgressArtifact } from "./project-progress.js";
import type { ProjectProgressOperatorProgramSummary } from "./project-progress.js";
import type { ProjectRoleRoute } from "./role-routing.js";

export const PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION = 1;

export interface ProjectAutonomousLoopIteration {
  iteration: number;
  status: "disabled" | "blocked" | "missing-repo" | "materialized-only" | "materialized-and-queued";
  nextWorkDecision: string;
  selectedWorkItemId: string | null;
  selectedIssueNumber: number | null;
  queuedIssueKey: string | null;
  stopReason: string | null;
  message: string | null;
  activeWorkstreamSummary: string | null;
}

export interface ProjectAutonomousLoopQueueIssueResult {
  outcome: "queued" | "gated" | "already-tracked";
  issueKey: string | null;
}

export interface ProjectAutonomousLoopArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  repoKey: string | null;
  enabled: boolean;
  mode: "once" | "repeat" | "off" | "status";
  status: "disabled" | "blocked" | "missing-repo" | "materialized-only" | "materialized-and-queued";
  requestedIterationCount: number;
  completedIterationCount: number;
  iterations: ProjectAutonomousLoopIteration[];
  stopReason: string | null;
  nextWorkDecision: string;
  nextWorkBlockingGateId: string | null;
  nextWorkPrimaryBlocker: string | null;
  activeWorkstreamIndex: number | null;
  activeWorkstreamCount: number;
  activeWorkstreamTitle: string | null;
  activeWorkstreamSummary: string | null;
  nextSuggestedCommand: string | null;
  nextSuggestedChatCommand: string | null;
  selectedWorkItemId: string | null;
  selectedWorkItemExecutionMode: string | null;
  roleRoutes: ProjectRoleRoute[];
  roleRouteSummary: string[];
  selectedIssueNumber: number | null;
  selectedIssueUrl: string | null;
  queuedIssueKey: string | null;
  providerPauseActive: boolean;
  queuedRunCount: number;
  currentRunPresent: boolean;
  currentRunIssueKey: string | null;
  currentRunStage: string | null;
  currentRunBranchName: string | null;
  currentRunPullRequestNumber: number | null;
  currentRunPullRequestUrl: string | null;
  operatorProgram: ProjectProgressOperatorProgramSummary;
  message: string | null;
}

function resolveProjectAutonomousLoopArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "autonomous-loop.json");
}

function parseOperatorProgramSummary(
  repoRoot: string,
  parsed: Partial<ProjectAutonomousLoopArtifact>,
): ProjectProgressOperatorProgramSummary {
  return {
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
  };
}

export async function setProjectAutonomousLoopDisabled(params: {
  repoRoot: string;
  repo?: RepoRef;
}): Promise<ProjectAutonomousLoopArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectAutonomousLoopArtifactPath(repoRoot);
  const artifact: ProjectAutonomousLoopArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoKey: params.repo ? `${params.repo.owner}/${params.repo.repo}` : null,
    enabled: false,
    mode: "off",
    status: "disabled",
    requestedIterationCount: 0,
    completedIterationCount: 0,
    iterations: [],
    stopReason: "Autonomous loop is disabled until it is started again.",
    nextWorkDecision: "no-actionable-work-item",
    nextWorkBlockingGateId: null,
    nextWorkPrimaryBlocker: null,
    activeWorkstreamIndex: null,
    activeWorkstreamCount: 0,
    activeWorkstreamTitle: null,
    activeWorkstreamSummary: null,
    nextSuggestedCommand: null,
    nextSuggestedChatCommand: null,
    selectedWorkItemId: null,
    selectedWorkItemExecutionMode: null,
    roleRoutes: [],
    roleRouteSummary: [],
    selectedIssueNumber: null,
    selectedIssueUrl: null,
    queuedIssueKey: null,
    providerPauseActive: false,
    queuedRunCount: 0,
    currentRunPresent: false,
    currentRunIssueKey: null,
    currentRunStage: null,
    currentRunBranchName: null,
    currentRunPullRequestNumber: null,
    currentRunPullRequestUrl: null,
    operatorProgram: buildOperatorProgramSummary(await readProjectOperatorProgram(repoRoot)),
    message: "Autonomous loop disabled.",
  };
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectAutonomousLoopArtifact(
  repoRootInput: string,
): Promise<ProjectAutonomousLoopArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectAutonomousLoopArtifactPath(repoRoot);
  const raw = await readFile(artifactPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!raw) {
    return {
      repoRoot,
      artifactPath,
      exists: false,
      schemaVersion: null,
      generatedAt: null,
      repoKey: null,
      enabled: false,
      mode: "status",
      status: "disabled",
      requestedIterationCount: 0,
      completedIterationCount: 0,
      iterations: [],
      stopReason: null,
      nextWorkDecision: "no-actionable-work-item",
      nextWorkBlockingGateId: null,
      nextWorkPrimaryBlocker: null,
      activeWorkstreamIndex: null,
      activeWorkstreamCount: 0,
      activeWorkstreamTitle: null,
      activeWorkstreamSummary: null,
      nextSuggestedCommand: null,
      nextSuggestedChatCommand: null,
      selectedWorkItemId: null,
      selectedWorkItemExecutionMode: null,
      roleRoutes: [],
      roleRouteSummary: [],
      selectedIssueNumber: null,
      selectedIssueUrl: null,
      queuedIssueKey: null,
      providerPauseActive: false,
      queuedRunCount: 0,
      currentRunPresent: false,
      currentRunIssueKey: null,
      currentRunStage: null,
      currentRunBranchName: null,
      currentRunPullRequestNumber: null,
      currentRunPullRequestUrl: null,
      operatorProgram: buildOperatorProgramSummary(await readProjectOperatorProgram(repoRoot)),
      message: null,
    };
  }
  const parsed = JSON.parse(raw) as Partial<ProjectAutonomousLoopArtifact>;
  return {
    repoRoot,
    artifactPath,
    exists: parsed.exists ?? true,
    schemaVersion: parsed.schemaVersion ?? PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION,
    generatedAt: parsed.generatedAt ?? null,
    repoKey: parsed.repoKey ?? null,
    enabled: parsed.enabled ?? false,
    mode:
      parsed.mode === "once" || parsed.mode === "repeat" || parsed.mode === "off"
        ? parsed.mode
        : "status",
    status:
      parsed.status === "disabled" ||
      parsed.status === "blocked" ||
      parsed.status === "missing-repo" ||
      parsed.status === "materialized-only" ||
      parsed.status === "materialized-and-queued"
        ? parsed.status
        : "disabled",
    requestedIterationCount: parsed.requestedIterationCount ?? 0,
    completedIterationCount: parsed.completedIterationCount ?? 0,
    iterations: Array.isArray(parsed.iterations) ? parsed.iterations : [],
    stopReason: parsed.stopReason ?? null,
    nextWorkDecision: parsed.nextWorkDecision ?? "no-actionable-work-item",
    nextWorkBlockingGateId: parsed.nextWorkBlockingGateId ?? null,
    nextWorkPrimaryBlocker: parsed.nextWorkPrimaryBlocker ?? null,
    activeWorkstreamIndex: parsed.activeWorkstreamIndex ?? null,
    activeWorkstreamCount: parsed.activeWorkstreamCount ?? 0,
    activeWorkstreamTitle: parsed.activeWorkstreamTitle ?? null,
    activeWorkstreamSummary: parsed.activeWorkstreamSummary ?? null,
    nextSuggestedCommand: parsed.nextSuggestedCommand ?? null,
    nextSuggestedChatCommand:
      parsed.nextSuggestedChatCommand ??
      resolveChatNextSuggestedCommand({
        repo: parseRepoRefFromRepoKey(parsed.repoKey),
        command: parsed.nextSuggestedCommand ?? null,
      }),
    selectedWorkItemId: parsed.selectedWorkItemId ?? null,
    selectedWorkItemExecutionMode: parsed.selectedWorkItemExecutionMode ?? null,
    roleRoutes: Array.isArray(parsed.roleRoutes) ? parsed.roleRoutes : [],
    roleRouteSummary: Array.isArray(parsed.roleRouteSummary) ? parsed.roleRouteSummary : [],
    selectedIssueNumber: parsed.selectedIssueNumber ?? null,
    selectedIssueUrl: parsed.selectedIssueUrl ?? null,
    queuedIssueKey: parsed.queuedIssueKey ?? null,
    providerPauseActive: parsed.providerPauseActive ?? false,
    queuedRunCount: parsed.queuedRunCount ?? 0,
    currentRunPresent: parsed.currentRunPresent ?? false,
    currentRunIssueKey: parsed.currentRunIssueKey ?? null,
    currentRunStage: parsed.currentRunStage ?? null,
    currentRunBranchName: parsed.currentRunBranchName ?? null,
    currentRunPullRequestNumber: parsed.currentRunPullRequestNumber ?? null,
    currentRunPullRequestUrl: parsed.currentRunPullRequestUrl ?? null,
    operatorProgram: parseOperatorProgramSummary(repoRoot, parsed),
    message: parsed.message ?? null,
  };
}

async function runProjectAutonomousLoopIteration(params: {
  repoRoot: string;
  repo?: RepoRef;
  operatorSnapshot?: OpenClawCodeOperatorStatusSnapshot;
  queueIssue?: (args: { issueNumber: number }) => Promise<ProjectAutonomousLoopQueueIssueResult>;
}): Promise<ProjectAutonomousLoopArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectAutonomousLoopArtifactPath(repoRoot);
  const progress = await writeProjectProgressArtifact({
    repoRoot,
    repo: params.repo,
    operatorSnapshot: params.operatorSnapshot,
  });
  const queuedRunCount = progress.operator.queuedRunCount;
  const currentRunPresent = progress.operator.currentRunCount > 0;
  const providerPauseActive = progress.operator.providerPauseActive;
  let nextSuggestedCommand: string | null = null;
  let nextSuggestedChatCommand: string | null = null;

  let status: ProjectAutonomousLoopArtifact["status"] = "blocked";
  let stopReason: string | null = null;
  let queuedIssueKey: string | null = null;
  let message: string | null = null;

  if (!params.repo) {
    status = "missing-repo";
    stopReason =
      "Resolve the GitHub owner/repo before autonomous issue materialization can continue.";
  } else if (providerPauseActive) {
    stopReason = "Provider pause is active.";
    nextSuggestedCommand = `openclaw code project-progress-show --repo-root ${repoRoot}`;
  } else if (queuedRunCount > 0) {
    stopReason = "A run is already queued for this repository.";
    nextSuggestedCommand = `openclaw code project-progress-show --repo-root ${repoRoot}`;
  } else if (currentRunPresent) {
    stopReason = "A run is already active for this repository.";
    nextSuggestedCommand = `openclaw code project-progress-show --repo-root ${repoRoot}`;
  } else if (progress.nextWorkDecision !== "ready-to-execute") {
    stopReason = `Autonomous progress is blocked at ${progress.nextWorkDecision}.`;
    nextSuggestedCommand = progress.nextSuggestedCommand;
    nextSuggestedChatCommand = progress.nextSuggestedChatCommand;
  } else {
    const issueMaterialization = await writeProjectIssueMaterializationArtifact({
      repoRoot,
      owner: params.repo.owner,
      repo: params.repo.repo,
    });
    if (params.queueIssue && issueMaterialization.selectedIssueNumber != null) {
      const queued = await params.queueIssue({
        issueNumber: issueMaterialization.selectedIssueNumber,
      });
      queuedIssueKey = queued.issueKey;
      if (queued.outcome === "queued") {
        status = "materialized-and-queued";
        message = `Queued ${queued.issueKey} after issue materialization.`;
        nextSuggestedCommand = `openclaw code project-progress-show --repo-root ${repoRoot}`;
      } else if (queued.outcome === "gated") {
        status = "blocked";
        stopReason = "Execution-start gate approval is still required for this repository.";
        message = "Held by execution-start gate.";
        nextSuggestedCommand = `openclaw code stage-gates-show --repo-root ${repoRoot}`;
      } else {
        status = "blocked";
        stopReason = "The selected issue is already queued or running for this repository.";
        message = "Selected issue was already tracked, so queue state stayed unchanged.";
        nextSuggestedCommand = `openclaw code project-progress-show --repo-root ${repoRoot}`;
      }
    } else {
      status = "materialized-only";
      message = "Materialized the next issue.";
      if (issueMaterialization.selectedIssueNumber != null) {
        nextSuggestedCommand = `openclaw code run --issue ${issueMaterialization.selectedIssueNumber} --repo-root ${repoRoot}`;
      }
    }
    nextSuggestedChatCommand = resolveChatNextSuggestedCommand({
      repo: params.repo,
      command: nextSuggestedCommand,
    });
    const artifact: ProjectAutonomousLoopArtifact = {
      repoRoot,
      artifactPath,
      exists: true,
      schemaVersion: PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      repoKey: `${params.repo.owner}/${params.repo.repo}`,
      enabled: true,
      mode: "once",
      status,
      requestedIterationCount: 1,
      completedIterationCount: 1,
      iterations: [],
      stopReason,
      nextWorkDecision: progress.nextWorkDecision,
      nextWorkBlockingGateId: progress.nextWorkBlockingGateId,
      nextWorkPrimaryBlocker: progress.nextWorkPrimaryBlocker,
      activeWorkstreamIndex: progress.activeWorkstreamIndex,
      activeWorkstreamCount: progress.activeWorkstreamCount,
      activeWorkstreamTitle: progress.activeWorkstreamTitle,
      activeWorkstreamSummary: progress.activeWorkstreamSummary,
      nextSuggestedCommand,
      nextSuggestedChatCommand,
      selectedWorkItemId: issueMaterialization.selectedWorkItemId,
      selectedWorkItemExecutionMode: issueMaterialization.selectedWorkItemExecutionMode,
      roleRoutes: progress.roleRoutes,
      roleRouteSummary: progress.roleRouteSummary,
      selectedIssueNumber: issueMaterialization.selectedIssueNumber,
      selectedIssueUrl: issueMaterialization.selectedIssueUrl,
      queuedIssueKey,
      providerPauseActive,
      queuedRunCount,
      currentRunPresent,
      currentRunIssueKey: progress.operator.currentRunIssueKey,
      currentRunStage: progress.operator.currentRunStage,
      currentRunBranchName: progress.operator.currentRunBranchName,
      currentRunPullRequestNumber: progress.operator.currentRunPullRequestNumber,
      currentRunPullRequestUrl: progress.operator.currentRunPullRequestUrl,
      operatorProgram: progress.operatorProgram,
      message,
    };
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return artifact;
  }
  nextSuggestedChatCommand = resolveChatNextSuggestedCommand({
    repo: params.repo,
    command: nextSuggestedCommand,
  });

  const artifact: ProjectAutonomousLoopArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_AUTONOMOUS_LOOP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoKey: params.repo ? `${params.repo.owner}/${params.repo.repo}` : null,
    enabled: true,
    mode: "once",
    status,
    requestedIterationCount: 1,
    completedIterationCount: 1,
    iterations: [],
    stopReason,
    nextWorkDecision: progress.nextWorkDecision,
    nextWorkBlockingGateId: progress.nextWorkBlockingGateId,
    nextWorkPrimaryBlocker: progress.nextWorkPrimaryBlocker,
    activeWorkstreamIndex: progress.activeWorkstreamIndex,
    activeWorkstreamCount: progress.activeWorkstreamCount,
    activeWorkstreamTitle: progress.activeWorkstreamTitle,
    activeWorkstreamSummary: progress.activeWorkstreamSummary,
    nextSuggestedCommand,
    nextSuggestedChatCommand,
    selectedWorkItemId: progress.selectedWorkItemId,
    selectedWorkItemExecutionMode: progress.selectedWorkItemExecutionMode,
    roleRoutes: progress.roleRoutes,
    roleRouteSummary: progress.roleRouteSummary,
    selectedIssueNumber: progress.selectedIssueNumber,
    selectedIssueUrl: progress.selectedIssueUrl,
    queuedIssueKey,
    providerPauseActive,
    queuedRunCount,
    currentRunPresent,
    currentRunIssueKey: progress.operator.currentRunIssueKey,
    currentRunStage: progress.operator.currentRunStage,
    currentRunBranchName: progress.operator.currentRunBranchName,
    currentRunPullRequestNumber: progress.operator.currentRunPullRequestNumber,
    currentRunPullRequestUrl: progress.operator.currentRunPullRequestUrl,
    operatorProgram: progress.operatorProgram,
    message,
  };
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

function shouldContinueAutonomousLoop(params: {
  artifact: ProjectAutonomousLoopArtifact;
  iteration: number;
  maxIterations: number;
}): { continue: boolean; stopReason?: string } {
  if (params.iteration >= params.maxIterations) {
    return {
      continue: false,
      stopReason: params.artifact.stopReason ?? undefined,
    };
  }
  if (
    params.artifact.status === "blocked" ||
    params.artifact.status === "missing-repo" ||
    params.artifact.status === "disabled"
  ) {
    return {
      continue: false,
      stopReason: params.artifact.stopReason ?? undefined,
    };
  }
  if (params.artifact.status === "materialized-only") {
    return {
      continue: false,
      stopReason:
        params.artifact.queuedIssueKey == null
          ? "Autonomous loop stopped after materialization because no queue handoff is configured."
          : (params.artifact.stopReason ?? undefined),
    };
  }
  return { continue: true };
}

export async function runProjectAutonomousLoop(params: {
  repoRoot: string;
  repo?: RepoRef;
  operatorSnapshot?: OpenClawCodeOperatorStatusSnapshot;
  readOperatorSnapshot?: () => Promise<OpenClawCodeOperatorStatusSnapshot | undefined>;
  queueIssue?: (args: { issueNumber: number }) => Promise<ProjectAutonomousLoopQueueIssueResult>;
  maxIterations?: number;
}): Promise<ProjectAutonomousLoopArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectAutonomousLoopArtifactPath(repoRoot);
  const maxIterations = Math.max(1, Math.trunc(params.maxIterations ?? 1));
  const iterations: ProjectAutonomousLoopIteration[] = [];
  let latest = await runProjectAutonomousLoopIteration({
    repoRoot,
    repo: params.repo,
    operatorSnapshot: params.operatorSnapshot,
    queueIssue: params.queueIssue,
  });

  iterations.push({
    iteration: 1,
    status: latest.status,
    nextWorkDecision: latest.nextWorkDecision,
    selectedWorkItemId: latest.selectedWorkItemId,
    selectedIssueNumber: latest.selectedIssueNumber,
    queuedIssueKey: latest.queuedIssueKey,
    stopReason: latest.stopReason,
    message: latest.message,
    activeWorkstreamSummary: latest.activeWorkstreamSummary,
  });

  for (let iteration = 2; iteration <= maxIterations; iteration += 1) {
    const decision = shouldContinueAutonomousLoop({
      artifact: latest,
      iteration: iteration - 1,
      maxIterations,
    });
    if (!decision.continue) {
      latest = {
        ...latest,
        requestedIterationCount: maxIterations,
        completedIterationCount: iterations.length,
        iterations,
        mode: maxIterations > 1 ? "repeat" : "once",
        stopReason: decision.stopReason ?? latest.stopReason,
      };
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
      return latest;
    }

    const operatorSnapshot = params.readOperatorSnapshot
      ? await params.readOperatorSnapshot()
      : params.operatorSnapshot;
    latest = await runProjectAutonomousLoopIteration({
      repoRoot,
      repo: params.repo,
      operatorSnapshot,
      queueIssue: params.queueIssue,
    });
    iterations.push({
      iteration,
      status: latest.status,
      nextWorkDecision: latest.nextWorkDecision,
      selectedWorkItemId: latest.selectedWorkItemId,
      selectedIssueNumber: latest.selectedIssueNumber,
      queuedIssueKey: latest.queuedIssueKey,
      stopReason: latest.stopReason,
      message: latest.message,
      activeWorkstreamSummary: latest.activeWorkstreamSummary,
    });
  }

  latest = {
    ...latest,
    requestedIterationCount: maxIterations,
    completedIterationCount: iterations.length,
    iterations,
    mode: maxIterations > 1 ? "repeat" : "once",
  };
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
  return latest;
}

export async function runProjectAutonomousLoopOnce(params: {
  repoRoot: string;
  repo?: RepoRef;
  operatorSnapshot?: OpenClawCodeOperatorStatusSnapshot;
  queueIssue?: (args: { issueNumber: number }) => Promise<ProjectAutonomousLoopQueueIssueResult>;
}): Promise<ProjectAutonomousLoopArtifact> {
  return await runProjectAutonomousLoop({
    ...params,
    maxIterations: 1,
  });
}
