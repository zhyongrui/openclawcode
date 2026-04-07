export type SystemRunEscalationOutcome = "run" | "approval_required" | "deny";

export type SystemRunDeniedReason =
  | "security=deny"
  | "approval-required"
  | "allowlist-miss"
  | "execution-plan-miss"
  | "companion-unavailable"
  | "permission:screenRecording";

export function resolveSystemRunDeniedOutcome(
  reason: string | null | undefined,
): Exclude<SystemRunEscalationOutcome, "run"> {
  return reason === "approval-required" ? "approval_required" : "deny";
}

export function normalizeSystemRunEscalationOutcome(
  value: unknown,
): SystemRunEscalationOutcome | null {
  return value === "run" || value === "approval_required" || value === "deny" ? value : null;
}
