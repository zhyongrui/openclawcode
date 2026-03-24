import type {
  VerificationReport,
  WorkflowAttemptSummary,
  WorkflowRun,
  WorkflowStage,
} from "../contracts/index.js";

const ALLOWED_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  intake: ["planning", "failed"],
  planning: ["awaiting-plan-approval", "building", "failed", "escalated"],
  "awaiting-plan-approval": ["building", "failed", "escalated"],
  building: ["draft-pr-opened", "failed", "changes-requested"],
  "draft-pr-opened": ["verifying", "changes-requested", "failed"],
  verifying: ["ready-for-human-review", "changes-requested", "escalated", "failed"],
  "changes-requested": ["building", "failed", "escalated"],
  "ready-for-human-review": [
    "completed-without-changes",
    "merged",
    "changes-requested",
    "escalated",
  ],
  "completed-without-changes": [],
  merged: [],
  escalated: [],
  failed: [],
};

export type TimestampFactory = () => string;

function nowIso(): string {
  return new Date().toISOString();
}

function incrementAttempts(
  attempts: WorkflowAttemptSummary,
  nextStage: WorkflowStage,
): WorkflowAttemptSummary {
  switch (nextStage) {
    case "planning":
      return {
        ...attempts,
        total: attempts.total + 1,
        planning: attempts.planning + 1,
      };
    case "building":
      return {
        ...attempts,
        total: attempts.total + 1,
        building: attempts.building + 1,
      };
    case "verifying":
      return {
        ...attempts,
        total: attempts.total + 1,
        verifying: attempts.verifying + 1,
      };
    default:
      return attempts;
  }
}

export function transitionRun(
  run: WorkflowRun,
  nextStage: WorkflowStage,
  note: string,
  now: TimestampFactory = nowIso,
): WorkflowRun {
  const allowed = ALLOWED_TRANSITIONS[run.stage];
  if (!allowed.includes(nextStage)) {
    throw new Error(`Invalid workflow transition: ${run.stage} -> ${nextStage}`);
  }

  const enteredAt = now();

  return {
    ...run,
    stage: nextStage,
    updatedAt: enteredAt,
    attempts: incrementAttempts(run.attempts, nextStage),
    history: [...run.history, note],
    stageRecords: [
      ...run.stageRecords,
      {
        fromStage: run.stage,
        toStage: nextStage,
        note,
        enteredAt,
      },
    ],
  };
}

export function applyVerificationDecision(
  run: WorkflowRun,
  report: VerificationReport,
  now?: TimestampFactory,
): WorkflowRun {
  switch (report.decision) {
    case "approve-for-human-review":
      return {
        ...transitionRun(
          run,
          "ready-for-human-review",
          "Verification approved for human review",
          now,
        ),
        verificationReport: report,
      };
    case "request-changes":
      return {
        ...transitionRun(run, "changes-requested", "Verification requested changes", now),
        verificationReport: report,
      };
    case "escalate":
      return {
        ...transitionRun(run, "escalated", "Verification escalated to human", now),
        verificationReport: report,
      };
  }
}
