import type { OpenClawCodeIssueStatusSnapshot } from "./store.js";

export interface OpenClawCodeIncidentLearningSummary {
  summary: string;
  providerFailureCount: number;
  reviewRerunCount: number;
  manualRecoveryCount: number;
  runtimeRerouteCount: number;
}

function hasHandoffKind(
  snapshot: OpenClawCodeIssueStatusSnapshot,
  kinds: readonly string[],
): boolean {
  return snapshot.handoffEntries?.some((entry) => kinds.includes(entry.kind)) ?? false;
}

function isProviderFailureSnapshot(snapshot: OpenClawCodeIssueStatusSnapshot): boolean {
  if ((snapshot.providerFailureCount ?? 0) > 0 || snapshot.providerPauseUntil || snapshot.providerPauseReason) {
    return true;
  }
  const summary = snapshot.failureDiagnostics?.summary?.toLowerCase();
  return Boolean(summary && (summary.includes("provider") || summary.includes("http 400")));
}

function isReviewRerunSnapshot(snapshot: OpenClawCodeIssueStatusSnapshot): boolean {
  return Boolean(
    snapshot.rerunPriorRunId ||
      snapshot.rerunPriorStage ||
      snapshot.rerunReason ||
      snapshot.latestReviewDecision === "changes-requested",
  );
}

function isManualRecoverySnapshot(snapshot: OpenClawCodeIssueStatusSnapshot): boolean {
  return Boolean(
    snapshot.rerunManualTakeoverRequestedAt ||
      snapshot.rerunManualTakeoverActor ||
      snapshot.rerunManualTakeoverWorktreePath ||
      snapshot.rerunManualResumeNote ||
      hasHandoffKind(snapshot, ["manual-takeover", "manual-resume"]),
  );
}

function isRuntimeRerouteSnapshot(snapshot: OpenClawCodeIssueStatusSnapshot): boolean {
  return Boolean(
    snapshot.rerunRequestedCoderAgentId ||
      snapshot.rerunRequestedVerifierAgentId ||
      hasHandoffKind(snapshot, ["runtime-reroute", "runtime-steering"]),
  );
}

export function deriveRepoIncidentLearningSummary(
  snapshots: readonly OpenClawCodeIssueStatusSnapshot[],
): OpenClawCodeIncidentLearningSummary | null {
  const providerFailureCount = snapshots.filter(isProviderFailureSnapshot).length;
  const reviewRerunCount = snapshots.filter(isReviewRerunSnapshot).length;
  const manualRecoveryCount = snapshots.filter(isManualRecoverySnapshot).length;
  const runtimeRerouteCount = snapshots.filter(isRuntimeRerouteSnapshot).length;

  const fragments = [
    providerFailureCount > 0 ? `provider-failures=${providerFailureCount}` : undefined,
    reviewRerunCount > 0 ? `review-reruns=${reviewRerunCount}` : undefined,
    manualRecoveryCount > 0 ? `manual-recoveries=${manualRecoveryCount}` : undefined,
    runtimeRerouteCount > 0 ? `runtime-reroutes=${runtimeRerouteCount}` : undefined,
  ].filter((value): value is string => Boolean(value));

  if (fragments.length === 0) {
    return null;
  }

  return {
    summary: fragments.join(" | "),
    providerFailureCount,
    reviewRerunCount,
    manualRecoveryCount,
    runtimeRerouteCount,
  };
}
