import type { WorkflowQualityGateSummary, WorkflowRun } from "./contracts/index.js";

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function buildWarningFragments(summary: WorkflowQualityGateSummary): string[] {
  const fragments: string[] = [];
  if (summary.findingCount > 0) {
    fragments.push(
      `${summary.findingCount} ${pluralize(summary.findingCount, "finding")}`,
    );
  }
  if (summary.missingCoverageCount > 0) {
    fragments.push(
      `${summary.missingCoverageCount} missing coverage ${pluralize(summary.missingCoverageCount, "item")}`,
    );
  }
  if (summary.followUpCount > 0) {
    fragments.push(
      `${summary.followUpCount} ${pluralize(summary.followUpCount, "follow-up")}`,
    );
  }
  if (summary.generatedFileCount > 0) {
    fragments.push(
      `${summary.generatedFileCount} generated ${pluralize(summary.generatedFileCount, "file")}`,
    );
  }
  if (summary.largeDiff) {
    fragments.push("large diff");
  }
  if (summary.broadFanOut) {
    fragments.push("broad fan-out");
  }
  return fragments;
}

export function deriveWorkflowQualityGate(run: WorkflowRun): WorkflowQualityGateSummary {
  const findingCount = run.verificationReport?.findings.length ?? 0;
  const missingCoverageCount = run.verificationReport?.missingCoverage.length ?? 0;
  const followUpCount = run.verificationReport?.followUps.length ?? 0;
  const generatedFileCount = run.buildResult?.policySignals?.generatedFiles.length ?? 0;
  const largeDiff = run.buildResult?.policySignals?.largeDiff ?? false;
  const broadFanOut = run.buildResult?.policySignals?.broadFanOut ?? false;
  const scopeCheckPassed = run.buildResult?.scopeCheck?.ok ?? null;
  const verificationDecision = run.verificationReport?.decision ?? null;
  const failureSummary = run.failureDiagnostics?.summary ?? null;

  const summary: WorkflowQualityGateSummary = {
    status: "pending",
    summary: "workflow has not reached a stable quality checkpoint yet",
    blockingReasons: [],
    warningReasons: [],
    scopeCheckPassed,
    verificationDecision,
    findingCount,
    missingCoverageCount,
    followUpCount,
    generatedFileCount,
    largeDiff,
    broadFanOut,
    testCommandCount: run.buildResult?.testCommands.length ?? 0,
    testResultCount: run.buildResult?.testResults.length ?? 0,
    failureSummary,
  };

  if (run.stage === "failed") {
    summary.blockingReasons.push(failureSummary ?? "workflow failed before the quality gate passed");
  } else if (run.stage === "escalated") {
    summary.blockingReasons.push("run escalated for human intervention");
  }

  if (scopeCheckPassed === false) {
    summary.blockingReasons.push(run.buildResult?.scopeCheck?.summary ?? "scope check failed");
  }

  if (verificationDecision === "request-changes") {
    summary.blockingReasons.push("verification requested changes");
  } else if (verificationDecision === "escalate") {
    summary.blockingReasons.push("verification escalated");
  }

  summary.warningReasons.push(...buildWarningFragments(summary));

  if (summary.blockingReasons.length > 0) {
    summary.status = "fail";
    summary.summary = [
      summary.blockingReasons[0],
      ...summary.warningReasons,
    ].join(" | ");
    return summary;
  }

  if (run.stage === "completed-without-changes") {
    summary.status = "pass";
    summary.summary = "completed without code changes";
    return summary;
  }

  if (run.stage === "merged") {
    summary.status = summary.warningReasons.length > 0 ? "warn" : "pass";
    summary.summary =
      summary.warningReasons.length > 0
        ? ["merged with residual warnings", ...summary.warningReasons].join(" | ")
        : "merged with no outstanding warnings";
    return summary;
  }

  if (verificationDecision === "approve-for-human-review") {
    summary.status = summary.warningReasons.length > 0 ? "warn" : "pass";
    summary.summary =
      summary.warningReasons.length > 0
        ? ["verifier approved with warnings", ...summary.warningReasons].join(" | ")
        : "verifier approved with no outstanding warnings";
    return summary;
  }

  if (run.stage === "awaiting-plan-approval") {
    summary.summary = "awaiting plan approval";
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

  summary.summary = "workflow is still in progress";
  return summary;
}
