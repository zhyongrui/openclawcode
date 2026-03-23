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
  counts, per-repo loop-health counts, and recent incident-learning summaries
  derived from persisted issue snapshots.
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
- each `issueSnapshots[*]` entry may also carry stable pre-code discipline
  fields:
  - `preCodeDisciplineStatus`
  - `preCodeDisciplineSummary`
  - `preCodeDisciplineBlockingReasons`
  - `preCodeDisciplineWarningReasons`
  - `preCodeDisciplinePlanStatus`
  - `preCodeDisciplineExecutionSpecPresent`
  - `preCodeDisciplineTestIntentPresent`
  - `preCodeDisciplineTestIntentCount`
  - `preCodeDisciplinePlanApprovalRequired`
  - `preCodeDisciplinePlanEdited`
  - `preCodeDisciplineIsolatedWorktreePrepared`
  - `preCodeDisciplineModeSpecificContextsPresent`
  - `preCodeDisciplineFreshRoleExecutionPresent`
- each `issueSnapshots[*]` entry may also carry stable loop-health fields:
  - `loopHealthStatus`
  - `loopHealthSummary`
  - `loopHealthBlockingReasons`
  - `loopHealthWarningReasons`
  - `loopHealthFailureSummary`
  - `loopHealthPromptFootprintChars`
  - `loopHealthBootstrapWarningShown`
  - `loopHealthInjectedWorkspaceFileCount`
  - `loopHealthLastCallUsageTotal`
- each `repos[*]` entry may also carry stable incident-learning summary fields:
  - `preCodeDisciplineReadyCount`
  - `preCodeDisciplineWarnCount`
  - `preCodeDisciplineBlockedCount`
  - `preCodeDisciplinePendingCount`
  - `preCodeDisciplineGapCounts`
  - `preCodeDisciplineGapSummary`
  - `preCodeDisciplineNextActionCode`
  - `preCodeDisciplineNextActionSummary`
  - `preCodeDisciplineRepairActions`
  - `preCodeDisciplineRepairSummary`
  - `operatorProgramAvailable`
  - `operatorProgramArtifactPath`
  - `operatorProgramUpdatedAt`
  - `operatorProgramTitle`
  - `operatorProgramSummary`
  - `operatorProgramMutableSurfaceMode`
  - `operatorProgramMutableSurfacePathCount`
  - `operatorProgramMutableSurfacePathsPresent`
  - `operatorProgramValidationBudgetSummary`
  - `operatorProgramValidationBudgetMaxPrimaryCommands`
  - `operatorProgramRequireOneExecutableProof`
  - `operatorProgramAdvancementRuleSummary`
  - `operatorProgramKeepCriteriaCount`
  - `operatorProgramDiscardCriteriaCount`
  - `operatorProgramRetryCriteriaCount`
  - `operatorProgramSimplificationBias`
  - `operatorProgramAttemptLedgerRequired`
  - `operatorProgramNextActionCode`
  - `operatorProgramNextActionSummary`
  - `operatorProgramLinkedBlueprintPath`
  - `operatorProgramLinkedWorkItemsPath`
  - `operatorProgramLinkedStageGatesPath`
  - `loopHealthHealthyCount`
  - `loopHealthWarnCount`
  - `loopHealthBlockedCount`
  - `loopHealthPendingCount`
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
- `repos[*].preCodeDisciplineRepairSummary`, when present, is an ordered
  human-readable repair summary. It may include multiple actions joined with
  `; then ` in priority order.
- `repos[*].preCodeDisciplineRepairActions`, when present, is the structured
  ordered list form of the same repo-level repair guidance.
- `repos[*].preCodeDisciplineGapCounts`, when present, provides the structured
  per-gap counts behind `preCodeDisciplineGapSummary`.
- `repos[*].preCodeDisciplineNextActionCode`, when present, is the stable enum
  form of the top-priority next action:
  - `prepare-isolated-worktrees`
  - `enforce-mode-specific-contexts`
  - `split-fresh-role-execution`
- `repos[*].operatorProgram*` fields, when present, mirror the repo-local
  `.openclawcode/operator-program.json` artifact for repos whose operator state
  can still resolve a stable `repoRoot` from current/queued work or persisted
  setup bootstrap state.
- `repos[*].operatorProgramMutableSurfacePathCount`, when present, is the
  stable numeric count of currently declared narrower mutable-surface paths.
- `repos[*].operatorProgramMutableSurfacePathsPresent`, when present, is the
  stable boolean shorthand for whether the operator program currently narrows
  mutation with an explicit allowlist.
- `repos[*].operatorProgramKeepCriteriaCount`,
  `repos[*].operatorProgramDiscardCriteriaCount`, and
  `repos[*].operatorProgramRetryCriteriaCount`, when present, are stable
  machine-readable counts for the current keep/discard/retry ledger policy.
- `repos[*].operatorProgramNextActionCode`, when present, is the stable enum
  form of the repo-level execution-policy follow-up:
  - `narrow-mutation-scope`
  - `define-validation-budget`
  - `record-advancement-rules`

Usage:

```bash
openclaw code operator-status-snapshot-show --json
openclaw code operator-status-snapshot-show --state-dir ~/.openclaw --json
```
