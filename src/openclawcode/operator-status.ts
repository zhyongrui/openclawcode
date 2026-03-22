import fs from "node:fs/promises";
import path from "node:path";
import type {
  OpenClawCodeChatopsRepoRef,
  OpenClawCodeChatopsRunRequest,
} from "../integrations/openclaw-plugin/chatops.js";
import {
  OpenClawCodeChatopsStore,
  type OpenClawCodeDeferredRuntimeReroute,
  type OpenClawCodeIssueStatusSnapshot,
  type OpenClawCodePendingApproval,
  type OpenClawCodePendingIntakeDraft,
  type OpenClawCodeManualTakeover,
  type OpenClawCodeProviderPause,
  type OpenClawCodeQueueState,
  type OpenClawCodeRepoNotificationBinding,
} from "../integrations/openclaw-plugin/store.js";

export const OPENCLAWCODE_OPERATOR_STATUS_CONTRACT_VERSION = 1;

export interface OpenClawCodeOperatorRepoSummary {
  repoKey: string;
  bindingPresent: boolean;
  trackedIssueCount: number;
  pendingApprovalCount: number;
  pendingIntakeDraftCount: number;
  manualTakeoverCount: number;
  deferredRuntimeRerouteCount: number;
  queuedRunCount: number;
  currentRunCount: number;
  readyForHumanReviewCount: number;
  mergedCount: number;
  failedCount: number;
  qualityGatePassCount: number;
  qualityGateWarnCount: number;
  qualityGateFailCount: number;
  qualityGatePendingCount: number;
}

export interface OpenClawCodeOperatorStatusSnapshot {
  contractVersion: 1;
  generatedAt: string;
  stateDir: string;
  statePath: string;
  exists: boolean;
  pendingApprovalCount: number;
  manualPendingApprovalCount: number;
  executionStartGatedApprovalCount: number;
  pendingIntakeDraftCount: number;
  manualTakeoverCount: number;
  deferredRuntimeRerouteCount: number;
  queuedRunCount: number;
  currentRunPresent: boolean;
  trackedIssueCount: number;
  repoBindingCount: number;
  githubDeliveryCount: number;
  providerPauseActive: boolean;
  currentRun: OpenClawCodeQueueState["currentRun"] | null;
  providerPause: OpenClawCodeProviderPause | null;
  pendingApprovals: OpenClawCodePendingApproval[];
  pendingIntakeDrafts: OpenClawCodePendingIntakeDraft[];
  manualTakeovers: OpenClawCodeManualTakeover[];
  deferredRuntimeReroutes: OpenClawCodeDeferredRuntimeReroute[];
  repoBindings: OpenClawCodeRepoNotificationBinding[];
  issueSnapshots: OpenClawCodeIssueStatusSnapshot[];
  repos: OpenClawCodeOperatorRepoSummary[];
}

export function resolveOpenClawCodeChatopsStatePath(stateDir: string): string {
  return path.join(stateDir, "plugins", "openclawcode", "chatops-state.json");
}

function compareByString(left: string, right: string): number {
  return left.localeCompare(right);
}

function parseIssueKey(issueKey: string): OpenClawCodeChatopsRepoRef | null {
  const match = /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)#\d+$/.exec(issueKey.trim());
  if (!match?.groups) {
    return null;
  }
  return {
    owner: match.groups.owner,
    repo: match.groups.repo,
  };
}

function formatRepoKey(repo: OpenClawCodeChatopsRepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

function collectRepoKeySet(state: OpenClawCodeQueueState): Set<string> {
  const repoKeys = new Set<string>();
  for (const repoKey of Object.keys(state.repoBindingsByRepo)) {
    repoKeys.add(repoKey);
  }
  for (const snapshot of Object.values(state.statusSnapshotsByIssue)) {
    repoKeys.add(formatRepoKey({ owner: snapshot.owner, repo: snapshot.repo }));
  }
  for (const pending of state.pendingApprovals) {
    const repo = parseIssueKey(pending.issueKey);
    if (repo) {
      repoKeys.add(formatRepoKey(repo));
    }
  }
  for (const takeover of state.manualTakeovers) {
    const repo = parseIssueKey(takeover.issueKey);
    if (repo) {
      repoKeys.add(formatRepoKey(repo));
    }
  }
  for (const deferred of state.deferredRuntimeReroutes) {
    const repo = parseIssueKey(deferred.issueKey);
    if (repo) {
      repoKeys.add(formatRepoKey(repo));
    }
  }
  for (const draft of state.pendingIntakeDrafts) {
    repoKeys.add(draft.repoKey);
  }
  for (const queuedRun of state.queue) {
    repoKeys.add(formatRepoKey({ owner: queuedRun.request.owner, repo: queuedRun.request.repo }));
  }
  if (state.currentRun) {
    repoKeys.add(
      formatRepoKey({
        owner: state.currentRun.request.owner,
        repo: state.currentRun.request.repo,
      }),
    );
  }
  return repoKeys;
}

function buildRepoSummary(params: {
  repoKey: string;
  state: OpenClawCodeQueueState;
}): OpenClawCodeOperatorRepoSummary {
  const { repoKey, state } = params;
  const snapshotEntries = Object.values(state.statusSnapshotsByIssue).filter(
    (snapshot) => formatRepoKey({ owner: snapshot.owner, repo: snapshot.repo }) === repoKey,
  );
  const pendingApprovals = state.pendingApprovals.filter((entry) => {
    const repo = parseIssueKey(entry.issueKey);
    return repo ? formatRepoKey(repo) === repoKey : false;
  });
  const pendingIntakeDrafts = state.pendingIntakeDrafts.filter(
    (entry) => entry.repoKey === repoKey,
  );
  const manualTakeovers = state.manualTakeovers.filter((entry) => {
    const repo = parseIssueKey(entry.issueKey);
    return repo ? formatRepoKey(repo) === repoKey : false;
  });
  const deferredRuntimeReroutes = state.deferredRuntimeReroutes.filter((entry) => {
    const repo = parseIssueKey(entry.issueKey);
    return repo ? formatRepoKey(repo) === repoKey : false;
  });
  const queuedRuns = state.queue.filter(
    (entry) => formatRepoKey({ owner: entry.request.owner, repo: entry.request.repo }) === repoKey,
  );
  const currentRunCount =
    state.currentRun &&
    formatRepoKey({
      owner: state.currentRun.request.owner,
      repo: state.currentRun.request.repo,
    }) === repoKey
      ? 1
      : 0;
  return {
    repoKey,
    bindingPresent: Boolean(state.repoBindingsByRepo[repoKey]),
    trackedIssueCount: snapshotEntries.length,
    pendingApprovalCount: pendingApprovals.length,
    pendingIntakeDraftCount: pendingIntakeDrafts.length,
    manualTakeoverCount: manualTakeovers.length,
    deferredRuntimeRerouteCount: deferredRuntimeReroutes.length,
    queuedRunCount: queuedRuns.length,
    currentRunCount,
    readyForHumanReviewCount: snapshotEntries.filter(
      (entry) => entry.stage === "ready-for-human-review",
    ).length,
    mergedCount: snapshotEntries.filter((entry) => entry.stage === "merged").length,
    failedCount: snapshotEntries.filter((entry) => entry.stage === "failed").length,
    qualityGatePassCount: snapshotEntries.filter((entry) => entry.qualityGateStatus === "pass").length,
    qualityGateWarnCount: snapshotEntries.filter((entry) => entry.qualityGateStatus === "warn").length,
    qualityGateFailCount: snapshotEntries.filter((entry) => entry.qualityGateStatus === "fail").length,
    qualityGatePendingCount: snapshotEntries.filter((entry) => entry.qualityGateStatus === "pending").length,
  };
}

export function buildOpenClawCodeOperatorStatusSnapshot(params: {
  stateDir: string;
  statePath: string;
  exists: boolean;
  state: OpenClawCodeQueueState;
  generatedAt?: string;
}): OpenClawCodeOperatorStatusSnapshot {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const pendingApprovals = [...params.state.pendingApprovals].toSorted((left, right) =>
    compareByString(left.issueKey, right.issueKey),
  );
  const pendingIntakeDrafts = [...params.state.pendingIntakeDrafts].toSorted((left, right) =>
    compareByString(left.repoKey, right.repoKey),
  );
  const manualTakeovers = [...params.state.manualTakeovers].toSorted((left, right) =>
    compareByString(left.issueKey, right.issueKey),
  );
  const deferredRuntimeReroutes = [...params.state.deferredRuntimeReroutes].toSorted(
    (left, right) => compareByString(left.issueKey, right.issueKey),
  );
  const repoBindings = Object.values(params.state.repoBindingsByRepo).toSorted((left, right) =>
    compareByString(left.repoKey, right.repoKey),
  );
  const issueSnapshots = Object.values(params.state.statusSnapshotsByIssue).toSorted(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      compareByString(left.issueKey, right.issueKey),
  );
  const repoKeys = [...collectRepoKeySet(params.state)].toSorted(compareByString);

  return {
    contractVersion: OPENCLAWCODE_OPERATOR_STATUS_CONTRACT_VERSION,
    generatedAt,
    stateDir: params.stateDir,
    statePath: params.statePath,
    exists: params.exists,
    pendingApprovalCount: pendingApprovals.length,
    manualPendingApprovalCount: pendingApprovals.filter(
      (entry) => entry.approvalKind !== "execution-start-gated",
    ).length,
    executionStartGatedApprovalCount: pendingApprovals.filter(
      (entry) => entry.approvalKind === "execution-start-gated",
    ).length,
    pendingIntakeDraftCount: pendingIntakeDrafts.length,
    manualTakeoverCount: manualTakeovers.length,
    deferredRuntimeRerouteCount: deferredRuntimeReroutes.length,
    queuedRunCount: params.state.queue.length,
    currentRunPresent: Boolean(params.state.currentRun),
    trackedIssueCount: issueSnapshots.length,
    repoBindingCount: repoBindings.length,
    githubDeliveryCount: Object.keys(params.state.githubDeliveriesById).length,
    providerPauseActive: Boolean(params.state.providerPause),
    currentRun: params.state.currentRun ?? null,
    providerPause: params.state.providerPause ?? null,
    pendingApprovals,
    pendingIntakeDrafts,
    manualTakeovers,
    deferredRuntimeReroutes,
    repoBindings,
    issueSnapshots,
    repos: repoKeys.map((repoKey) =>
      buildRepoSummary({
        repoKey,
        state: params.state,
      }),
    ),
  };
}

export async function readOpenClawCodeOperatorStatusSnapshot(
  stateDir: string,
): Promise<OpenClawCodeOperatorStatusSnapshot> {
  const statePath = resolveOpenClawCodeChatopsStatePath(stateDir);
  const exists = await fs
    .access(statePath)
    .then(() => true)
    .catch(() => false);
  const store = OpenClawCodeChatopsStore.fromStateDir(stateDir);
  const state = await store.snapshot();
  return buildOpenClawCodeOperatorStatusSnapshot({
    stateDir,
    statePath,
    exists,
    state,
  });
}

export function formatOperatorStatusRunSummary(
  run: OpenClawCodeQueueState["currentRun"] | OpenClawCodeChatopsRunRequest | null,
): string {
  if (!run) {
    return "none";
  }
  const request = "request" in run ? run.request : run;
  return `${request.owner}/${request.repo}#${request.issueNumber} (${request.branchName})`;
}
