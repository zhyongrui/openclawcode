import type {
  RiskLevel,
  SuitabilityAssessment,
  SuitabilityDecision,
  WorkflowRun,
} from "../contracts/index.js";
import { collectSuitabilityPolicySignals } from "../policy.js";
import { classifyIssueScope } from "./scope.js";

function buildAcceptedReasons(riskLevel: RiskLevel): string[] {
  return [
    "Issue stays within command-layer scope.",
    `Planner risk level is ${riskLevel}.`,
    "No high-risk issue signals were detected in the issue text or labels.",
  ];
}

function buildSummary(decision: SuitabilityDecision, reasons: string[]): string {
  const detail = reasons[0] ?? "No specific suitability reasons were recorded.";
  if (decision === "auto-run") {
    return `Suitability accepted for autonomous execution. ${detail}`;
  }
  if (decision === "needs-human-review") {
    return `Suitability recommends human review before autonomous execution. ${detail}`;
  }
  return `Suitability escalated the issue before branch mutation. ${detail}`;
}

export interface SuitabilityOverrideRequest {
  actor?: string;
  reason?: string;
}

export function assessIssueSuitability(
  run: WorkflowRun,
  evaluatedAt: string,
  options?: {
    override?: SuitabilityOverrideRequest;
  },
): SuitabilityAssessment {
  const classification = classifyIssueScope(run);
  const riskLevel = run.executionSpec?.riskLevel ?? "medium";
  const policySignals = collectSuitabilityPolicySignals(run.issue);
  const reasons: string[] = [];

  if (riskLevel === "high") {
    reasons.push("Planner marked this issue as high risk.");
  }
  if (policySignals.matchedHighRiskLabels.length > 0) {
    reasons.push(
      `Issue labels matched denylisted high-risk labels: ${policySignals.matchedHighRiskLabels.join(", ")}.`,
    );
  }
  if (policySignals.matchedHighRiskKeywords.length > 0) {
    reasons.push(
      `Issue text references high-risk areas: ${policySignals.matchedHighRiskKeywords.join(", ")}.`,
    );
  }
  if (policySignals.allowlisted) {
    reasons.push("Issue matched the low-risk allowlist used for autonomous execution review.");
  }
  if ((run.executionSpec?.openQuestions.length ?? 0) > 0) {
    reasons.push("Planner left open questions that still need human confirmation.");
  }
  if (!run.issue.body?.trim()) {
    reasons.push("Issue body is empty or missing, so the request is under-specified.");
  }
  if (classification === "workflow-core") {
    reasons.push("Issue is classified as workflow-core instead of command-layer.");
  } else if (classification === "mixed") {
    reasons.push("Issue is classified as mixed scope instead of command-layer.");
  }

  let decision: SuitabilityDecision;
  if (riskLevel === "high" || policySignals.denylisted) {
    decision = "escalate";
  } else if (
    classification !== "command-layer" ||
    (run.executionSpec?.openQuestions.length ?? 0) > 0 ||
    !run.issue.body?.trim()
  ) {
    decision = "needs-human-review";
  } else {
    decision = "auto-run";
  }

  const normalizedReasons =
    decision === "auto-run"
      ? [
          ...buildAcceptedReasons(riskLevel),
          ...(policySignals.allowlisted
            ? ["Issue matched the low-risk allowlist used for autonomous execution review."]
            : []),
        ]
      : reasons;
  const overrideApplied = Boolean(options?.override && decision !== "auto-run");
  const effectiveDecision = overrideApplied ? "auto-run" : decision;
  const summary = overrideApplied
    ? [
        "Suitability override accepted for this run.",
        `Original decision: ${decision}.`,
        buildSummary(decision, normalizedReasons),
        options?.override?.reason?.trim()
          ? `Override reason: ${options.override.reason.trim()}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" ")
    : buildSummary(effectiveDecision, normalizedReasons);
  return {
    decision: effectiveDecision,
    summary,
    reasons: normalizedReasons,
    classification,
    riskLevel,
    evaluatedAt,
    allowlisted: policySignals.allowlisted,
    denylisted: policySignals.denylisted,
    matchedLowRiskLabels: policySignals.matchedLowRiskLabels,
    matchedLowRiskKeywords: policySignals.matchedLowRiskKeywords,
    matchedHighRiskLabels: policySignals.matchedHighRiskLabels,
    matchedHighRiskKeywords: policySignals.matchedHighRiskKeywords,
    originalDecision: overrideApplied ? decision : undefined,
    overrideApplied,
    overrideActor: options?.override?.actor?.trim() || undefined,
    overrideReason: options?.override?.reason?.trim() || undefined,
  };
}
