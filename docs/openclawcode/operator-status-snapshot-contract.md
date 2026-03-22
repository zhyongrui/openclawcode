# Operator Status Snapshot Contract

`openclaw code operator-status-snapshot-show --json` exposes a stable
machine-readable view of the operator chat state that backs `/occode-status`,
`/occode-inbox`, and related gate-driven controls.

Contract version:

- `contractVersion: 1`

Current top-level fields:

- `contractVersion`
- `generatedAt`
- `stateDir`
- `statePath`
- `exists`
- `pendingApprovalCount`
- `manualPendingApprovalCount`
- `executionStartGatedApprovalCount`
- `pendingIntakeDraftCount`
- `manualTakeoverCount`
- `deferredRuntimeRerouteCount`
- `queuedRunCount`
- `currentRunPresent`
- `trackedIssueCount`
- `repoBindingCount`
- `githubDeliveryCount`
- `providerPauseActive`
- `currentRun`
- `providerPause`
- `pendingApprovals`
- `pendingIntakeDrafts`
- `manualTakeovers`
- `deferredRuntimeReroutes`
- `repoBindings`
- `issueSnapshots`
- `repos`

Semantics:

- `pendingApprovals` reflects issues waiting for either explicit manual approval
  or an `execution-start` gate decision.
- `issueSnapshots` is the stable sorted list form of the tracked
  `statusSnapshotsByIssue` map and is ordered by newest `updatedAt` first.
- `repos` summarizes the per-repo operator state visible in chat:
  tracked issues, pending approvals, intake drafts, takeovers, deferred runtime
  reroutes, queued/current work, final issue stages, per-repo quality-gate
  counts, and recent incident-learning summaries derived from persisted issue
  snapshots.
- `currentRun` mirrors the queued run request currently being executed, when
  one exists.
- `providerPause` mirrors the active provider-pause record when the queue is
  paused after repeated transient provider failures.
- `deferredRuntimeReroutes` mirrors pending coder/verifier reroute requests
  that were captured while an issue was already running.
- each `issueSnapshots[*]` entry may also carry stable quality-gate summary
  fields:
  - `qualityGateStatus`
  - `qualityGateSummary`
  - `qualityGateBlockingReasons`
  - `qualityGateWarningReasons`
  - `qualityGateFindingCount`
  - `qualityGateMissingCoverageCount`
  - `qualityGateFollowUpCount`
- each `repos[*]` entry may also carry stable incident-learning summary fields:
  - `incidentLearningSummary`
  - `providerFailureLearningCount`
  - `reviewRerunLearningCount`
  - `manualRecoveryLearningCount`
  - `runtimeRerouteLearningCount`

Stability boundary:

- top-level field names listed above are part of the stable contract
- array entry object shapes are also intentionally stable for `contractVersion: 1`
- human-readable `status` strings inside `issueSnapshots` remain descriptive
  text and should not be parsed for automation when a structured field already
  exists

Usage:

```bash
openclaw code operator-status-snapshot-show --json
openclaw code operator-status-snapshot-show --state-dir ~/.openclaw --json
```
