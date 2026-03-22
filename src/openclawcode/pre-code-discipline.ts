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

  if (!summary.testIntentPresent) {
    summary.warningReasons.push("no explicit test intent recorded before execution");
  }

  if (summary.planEdited) {
    summary.warningReasons.push("plan edited before execution");
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
