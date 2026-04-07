import type { SystemRunEscalationOutcome } from "../infra/system-run-outcome.js";

export type SystemRunApprovalGuardError = {
  ok: false;
  message: string;
  details: Record<string, unknown>;
};

export function systemRunApprovalGuardError(params: {
  code: string;
  message: string;
  outcome?: Exclude<SystemRunEscalationOutcome, "run">;
  details?: Record<string, unknown>;
}): SystemRunApprovalGuardError {
  const details = params.details ? { ...params.details } : {};
  return {
    ok: false,
    message: params.message,
    details: {
      code: params.code,
      outcome: params.outcome ?? "deny",
      ...details,
    },
  };
}

export function systemRunApprovalRequired(runId: string): SystemRunApprovalGuardError {
  return systemRunApprovalGuardError({
    code: "APPROVAL_REQUIRED",
    message: "approval required",
    outcome: "approval_required",
    details: { runId },
  });
}
