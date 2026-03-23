import type { WorkflowRun } from "./contracts/index.js";

export type WorkflowPreCodeDisciplineStatus = "ready" | "warn" | "blocked" | "pending";

export interface WorkflowPreCodeDisciplineSummary {
  status: WorkflowPreCodeDisciplineStatus;
  summary: string;
  blockingReasons: string[];
  warningReasons: string[];
  planStatus: "not-required" | "awaiting-approval" | "approved" | "missing";
  executionSpecPresent: boolean;
  testIntentPresent: boolean;
  testIntentCount: number;
  planApprovalRequired: boolean;
  planEdited: boolean;
  isolatedWorktreePrepared: boolean;
  modeSpecificContextsPresent: boolean;
  freshRoleExecutionPresent: boolean;
}

const OPENCLAWCODE_WORKTREE_SEGMENT = "/.openclawcode/worktrees/";

function resolveIsolatedWorktreePrepared(run: WorkflowRun): boolean {
  const worktreePath = run.workspace?.worktreePath;
  return typeof worktreePath === "string" && worktreePath.includes(OPENCLAWCODE_WORKTREE_SEGMENT);
}

function hasReachedCodeExecution(run: WorkflowRun): boolean {
  return (
    run.workspace != null ||
    run.buildResult != null ||
    run.draftPullRequest != null ||
    run.verificationReport != null ||
    run.stage === "opening-pull-request" ||
    run.stage === "verifying" ||
    run.stage === "ready-for-human-review" ||
    run.stage === "changes-requested" ||
    run.stage === "merged" ||
    run.stage === "completed-without-changes"
  );
}

function resolveModeSpecificContextsPresent(run: WorkflowRun): boolean {
  if (run.roleRouting?.mixedMode === true) {
    return true;
  }
  const roleAdapters = (run.roleRouting?.routes ?? [])
    .filter((route) =>
      route.roleId === "planner" ||
      route.roleId === "coder" ||
      route.roleId === "reviewer" ||
      route.roleId === "verifier",
    )
    .map((route) => route.adapterId)
    .filter((adapterId) => adapterId !== "openclaw-default");
  return new Set(roleAdapters).size > 1;
}

function resolveFreshRoleExecutionPresent(run: WorkflowRun): boolean {
  const coder = run.runtimeRouting?.selections.find((selection) => selection.roleId === "coder");
  const verifier = run.runtimeRouting?.selections.find(
    (selection) => selection.roleId === "verifier",
  );
  if (!coder || !verifier) {
    return false;
  }
  if (coder.appliedAgentId && verifier.appliedAgentId) {
    return coder.appliedAgentId !== verifier.appliedAgentId;
  }
  return coder.adapterId !== verifier.adapterId;
}

function resolvePlanStatus(run: WorkflowRun): WorkflowPreCodeDisciplineSummary["planStatus"] {
  if (!run.executionSpec) {
    return "missing";
  }
  if (!run.planReview?.required) {
    return "not-required";
  }
  if (run.planReview.status === "approved") {
    return "approved";
  }
  if (run.planReview.status === "awaiting-approval") {
    return "awaiting-approval";
  }
  return "missing";
}

export function deriveWorkflowPreCodeDiscipline(
  run: WorkflowRun,
): WorkflowPreCodeDisciplineSummary {
  const testIntentCount = Math.max(
    run.executionSpec?.testPlan.length ?? 0,
    run.buildResult?.testCommands.length ?? 0,
  );
  const summary: WorkflowPreCodeDisciplineSummary = {
    status: "ready",
    summary: "plan approved or not required, with explicit test intent recorded",
    blockingReasons: [],
    warningReasons: [],
    planStatus: resolvePlanStatus(run),
    executionSpecPresent: run.executionSpec != null,
    testIntentPresent: testIntentCount > 0,
    testIntentCount,
    planApprovalRequired: run.planReview?.required ?? false,
    planEdited: (run.planEdits?.length ?? 0) > 0,
    isolatedWorktreePrepared: resolveIsolatedWorktreePrepared(run),
    modeSpecificContextsPresent: resolveModeSpecificContextsPresent(run),
    freshRoleExecutionPresent: resolveFreshRoleExecutionPresent(run),
  };

  if (!summary.executionSpecPresent) {
    if (run.stage === "planning") {
      summary.status = "pending";
      summary.summary = "planning has not produced an execution spec yet";
      return summary;
    }
    summary.blockingReasons.push("execution plan missing before code execution");
  }

  if (summary.planApprovalRequired && summary.planStatus !== "approved") {
    summary.blockingReasons.push("awaiting explicit plan approval before code execution");
  }

  if (hasReachedCodeExecution(run) && !summary.isolatedWorktreePrepared) {
    summary.blockingReasons.push("isolated issue worktree missing before code execution");
  }

  if (!summary.testIntentPresent) {
    summary.warningReasons.push("no explicit test intent recorded before execution");
  }

  if (summary.planEdited) {
    summary.warningReasons.push("plan edited before execution");
  }

  if (run.executionSpec && !summary.modeSpecificContextsPresent) {
    summary.warningReasons.push("mode-specific planner/coder/verifier contexts not explicit");
  }

  if (hasReachedCodeExecution(run) && !summary.freshRoleExecutionPresent) {
    summary.warningReasons.push("fresh role execution units not explicit for coder/verifier");
  }

  if (summary.blockingReasons.length > 0) {
    summary.status = "blocked";
    summary.summary = [...summary.blockingReasons, ...summary.warningReasons].join(" | ");
    return summary;
  }

  if (summary.warningReasons.length > 0) {
    summary.status = "warn";
    summary.summary = summary.warningReasons.join(" | ");
    return summary;
  }

  if (run.stage === "awaiting-plan-approval") {
    summary.status = "blocked";
    summary.summary = "awaiting explicit plan approval before code execution";
    summary.blockingReasons.push(summary.summary);
    return summary;
  }

  return summary;
}
