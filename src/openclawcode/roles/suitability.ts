import type {
  IssueRef,
  RiskLevel,
  SuitabilityAssessment,
  SuitabilityDecision,
  WorkflowRun,
} from "../contracts/index.js";
import { classifyIssueScope } from "./scope.js";

const HIGH_RISK_SIGNALS: Array<{ name: string; patterns: string[] }> = [
  { name: "auth", patterns: ["auth", "authentication", "oauth", "login", "sign-in", "signin"] },
  { name: "secrets", patterns: ["secret", "credential", "password", "api key", "private key"] },
  { name: "security", patterns: ["security", "vulnerability", "encryption", "decrypt"] },
  { name: "migrations", patterns: ["migration", "schema", "database", "backfill"] },
  { name: "billing", patterns: ["billing", "payment", "invoice", "subscription"] },
  {
    name: "permissions",
    patterns: ["permission", "access control", "rbac", "authorization"],
  },
];

function buildIssueText(issue: Pick<IssueRef, "title" | "body" | "labels">): string {
  return [issue.title, issue.body ?? "", ...(issue.labels ?? [])].join("\n").toLowerCase();
}

export function collectIssueRiskSignals(
  issue: Pick<IssueRef, "title" | "body" | "labels">,
): string[] {
  const text = buildIssueText(issue);
  const matches: string[] = [];
  for (const signal of HIGH_RISK_SIGNALS) {
    if (signal.patterns.some((pattern) => text.includes(pattern))) {
      matches.push(signal.name);
    }
  }
  return matches;
}

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

export function assessIssueSuitability(
  run: WorkflowRun,
  evaluatedAt: string,
): SuitabilityAssessment {
  const classification = classifyIssueScope(run);
  const riskLevel = run.executionSpec?.riskLevel ?? "medium";
  const riskSignals = collectIssueRiskSignals(run.issue);
  const reasons: string[] = [];

  if (riskLevel === "high") {
    reasons.push("Planner marked this issue as high risk.");
  }
  if (riskSignals.length > 0) {
    reasons.push(`Issue text references high-risk areas: ${riskSignals.join(", ")}.`);
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
  if (riskLevel === "high" || riskSignals.length > 0) {
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

  const normalizedReasons = decision === "auto-run" ? buildAcceptedReasons(riskLevel) : reasons;
  return {
    decision,
    summary: buildSummary(decision, normalizedReasons),
    reasons: normalizedReasons,
    classification,
    riskLevel,
    evaluatedAt,
  };
}
