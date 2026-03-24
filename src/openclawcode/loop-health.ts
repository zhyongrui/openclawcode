import type { WorkflowLoopHealthSummary, WorkflowRun } from "./contracts/index.js";

const HIGH_PROMPT_FOOTPRINT_CHARS = 12_000;

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function resolvePromptFootprintChars(run: WorkflowRun): number | null {
  const values = [
    run.failureDiagnostics?.systemPromptChars,
    run.failureDiagnostics?.skillsPromptChars,
    run.failureDiagnostics?.toolSchemaChars,
  ].filter((value): value is number => typeof value === "number");
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0);
}

export function deriveWorkflowLoopHealth(run: WorkflowRun): WorkflowLoopHealthSummary {
  const failureSummary = run.failureDiagnostics?.summary ?? null;
  const promptFootprintChars = resolvePromptFootprintChars(run);
  const injectedWorkspaceFileCount = run.failureDiagnostics?.injectedWorkspaceFileCount ?? 0;
  const bootstrapWarningShown = run.failureDiagnostics?.bootstrapWarningShown === true;
  const lastCallUsageTotal =
    typeof run.failureDiagnostics?.lastCallUsageTotal === "number"
      ? run.failureDiagnostics.lastCallUsageTotal
      : null;
  const summary: WorkflowLoopHealthSummary = {
    status: "pending",
    summary: "workflow has not reached a stable loop-health checkpoint yet",
    blockingReasons: [],
    warningReasons: [],
    failureSummary,
    promptFootprintChars,
    bootstrapWarningShown,
    injectedWorkspaceFileCount,
    lastCallUsageTotal,
  };

  if (run.stage === "failed") {
    summary.blockingReasons.push(failureSummary ?? "workflow failed before the loop recovered");
  } else if (run.stage === "escalated") {
    summary.blockingReasons.push("run escalated for human intervention");
  }

  if (bootstrapWarningShown) {
    summary.warningReasons.push("bootstrap truncation warning shown");
  }

  if (injectedWorkspaceFileCount > 0) {
    summary.warningReasons.push(
      `${injectedWorkspaceFileCount} injected workspace ${pluralize(
        injectedWorkspaceFileCount,
        "file",
      )}`,
    );
  }

  if (
    typeof promptFootprintChars === "number" &&
    promptFootprintChars >= HIGH_PROMPT_FOOTPRINT_CHARS
  ) {
    summary.warningReasons.push(`high prompt footprint (${promptFootprintChars} chars)`);
  }

  if (lastCallUsageTotal === 0 && run.failureDiagnostics) {
    summary.warningReasons.push("provider reported zero usage on the last call");
  }

  if (summary.blockingReasons.length > 0) {
    summary.status = "blocked";
    summary.summary = [summary.blockingReasons[0], ...summary.warningReasons].join(" | ");
    return summary;
  }

  if (summary.warningReasons.length > 0) {
    summary.status = "warn";
    summary.summary = summary.warningReasons.join(" | ");
    return summary;
  }

  if (run.stage === "awaiting-plan-approval") {
    summary.summary = "awaiting plan approval before execution resumes";
    return summary;
  }

  if (run.stage === "completed-without-changes") {
    summary.status = "healthy";
    summary.summary = "completed without loop-health warnings";
    return summary;
  }

  if (run.stage === "merged" || run.stage === "ready-for-human-review") {
    summary.status = "healthy";
    summary.summary = "no loop-health warnings recorded";
    return summary;
  }

  if (!run.buildResult) {
    summary.summary = "build has not finished yet";
    return summary;
  }

  if (!run.verificationReport) {
    summary.summary = "verification has not finished yet";
    return summary;
  }

  summary.status = "healthy";
  summary.summary = "no loop-health warnings recorded";
  return summary;
}
