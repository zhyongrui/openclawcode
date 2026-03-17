# OpenClaw Code Run JSON Contract

This document defines the stable top-level JSON contract for:

```bash
openclaw code run --json
```

## Contract Version

- current contract version: `1`
- top-level field: `contractVersion`

Compatibility rule:

- adding new top-level fields is backward-compatible within the same
  `contractVersion`
- renaming, removing, or changing the meaning of documented top-level fields
  requires a new `contractVersion`

## Stability Boundary

Stable surface:

- documented top-level fields in this file

Not yet promised as stable:

- nested workflow objects that happen to be mirrored from the internal run
  artifact, such as:
  - `buildResult`
  - `verificationReport`
  - `draftPullRequest`
  - `blueprintContext`
  - `roleRouting`
  - `runtimeRouting`
  - `stageGates`
  - other internal nested workflow structures

Consumers should prefer the documented top-level fields instead of unpacking
those nested objects.

## Stable Top-Level Fields

### Identity And Stage

- `contractVersion`
- `runCreatedAt`
- `runUpdatedAt`
- `runHasUpdatedAt`
- `runAgeSeconds`
- `id`
- `issueNumber`
- `issueLabelCount`
- `issueHasLabels`
- `issueLabelListPresent`
- `issueFirstLabel`
- `issueLastLabel`
- `issueHasBody`
- `issueBodyLength`
- `issueUrl`
- `issue`
- `issueTitle`
- `issueTitleLength`
- `issueRepo`
- `issueOwner`
- `issueRepoOwnerPair`
- `stage`
- `stageLabel`
- `runSummary`

### Attempt Counters

- `totalAttemptCount`
- `planningAttemptCount`
- `buildAttemptCount`
- `verificationAttemptCount`

### Change And Scope Signals

- `buildSummary`
- `buildHasSignals`
- `buildSummaryPresent`
- `changedFiles`
- `changedFilesPresent`
- `changedFileListStable`
- `changedFileCount`
- `buildPolicySignals`
- `buildPolicySignalsPresent`
- `buildChangedLineCount`
- `buildChangedDirectoryCount`
- `buildBroadFanOut`
- `buildLargeDiff`
- `buildGeneratedFilesPresent`
- `buildGeneratedFiles`
- `buildGeneratedFileCount`
- `changeDisposition`
- `changeDispositionReason`
- `issueClassification`
- `scopeCheck`
- `scopeCheckSummary`
- `scopeCheckSummaryPresent`
- `scopeCheckPassed`
- `scopeCheckHasBlockedFiles`
- `scopeBlockedFilesPresent`
- `scopeBlockedFiles`
- `scopeBlockedFileCount`
- `scopeBlockedFirstFile`
- `scopeBlockedLastFile`

### Build/Test Summary

- `testCommandsPresent`
- `testCommandCount`
- `testResultsPresent`
- `testResultCount`
- `notesPresent`
- `noteCount`

### Failure Diagnostics

- `failureDiagnostics`
- `failureDiagnosticsPresent`
- `failureDiagnosticsSummary`
- `failureDiagnosticSummaryPresent`
- `failureDiagnosticProvider`
- `failureDiagnosticProviderPresent`
- `failureDiagnosticModel`
- `failureDiagnosticModelPresent`
- `failureDiagnosticSystemPromptChars`
- `failureDiagnosticSkillsPromptChars`
- `failureDiagnosticToolSchemaChars`
- `failureDiagnosticSkillCount`
- `failureDiagnosticInjectedWorkspaceFileCount`
- `failureDiagnosticBootstrapWarningShown`
- `failureDiagnosticToolCount`
- `failureDiagnosticUsageTotal`

### Blueprint-First Control Plane Signals

- `blueprintStatus`
- `blueprintRevisionId`
- `blueprintAgreed`
- `blueprintDefaultedSectionCount`
- `blueprintWorkstreamCandidateCount`
- `blueprintOpenQuestionCount`
- `blueprintHumanGateCount`
- `roleRoutingMixedMode`
- `roleRoutingFallbackConfigured`
- `roleRoutingUnresolvedRoleCount`
- `roleRoutingPlannerAdapter`
- `roleRoutingCoderAdapter`
- `roleRoutingReviewerAdapter`
- `roleRoutingVerifierAdapter`
- `roleRoutingDocWriterAdapter`
- `runtimeRoutingSelectionCount`
- `runtimeRoutingCoderAgentId`
- `runtimeRoutingCoderAgentSource`
- `runtimeRoutingVerifierAgentId`
- `runtimeRoutingVerifierAgentSource`
- `stageGateBlockedGateCount`
- `stageGateNeedsHumanDecisionCount`
- `goalAgreementStageGateReadiness`
- `workItemProjectionStageGateReadiness`
- `executionRoutingStageGateReadiness`
- `executionStartStageGateReadiness`
- `mergePromotionStageGateReadiness`

### Suitability Signals

- `suitabilityDecision`
- `suitabilityDecisionIsAutoRun`
- `suitabilityDecisionIsNeedsHumanReview`
- `suitabilityDecisionIsEscalate`
- `suitabilitySummary`
- `suitabilitySummaryPresent`
- `suitabilityReasons`
- `suitabilityReasonsPresent`
- `suitabilityReasonCount`
- `suitabilityClassification`
- `suitabilityRiskLevel`
- `suitabilityEvaluatedAt`
- `suitabilityAllowlisted`
- `suitabilityDenylisted`
- `suitabilityOverrideApplied`
- `suitabilityOriginalDecision`

### Planning Metadata

- `acceptanceCriteriaPresent`
- `acceptanceCriteriaCount`
- `openQuestionsPresent`
- `openQuestionCount`
- `risksPresent`
- `riskCount`
- `assumptionsPresent`
- `assumptionCount`
- `testPlanPresent`
- `testPlanCount`
- `scopeItemsPresent`
- `scopeItemCount`
- `outOfScopePresent`
- `outOfScopeCount`

### Workspace Metadata

- `workspaceBaseBranch`
- `workspaceBranchName`
- `workspaceBranchMatchesIssue`
- `workspaceRepoRoot`
- `workspaceRepoRootPresent`
- `workspaceHasPreparedAt`
- `workspacePreparedAt`
- `workspaceHasWorktreePath`
- `workspaceWorktreePath`

### Pull Request And Merge State

- `draftPullRequestBranchName`
- `draftPullRequestBaseBranch`
- `draftPullRequestHasTitle`
- `draftPullRequestTitle`
- `draftPullRequestHasBody`
- `draftPullRequestBody`
- `draftPullRequestHasOpenedAt`
- `draftPullRequestOpenedAt`
- `draftPullRequestHasNumber`
- `draftPullRequestNumber`
- `draftPullRequestHasUrl`
- `draftPullRequestUrl`
- `draftPullRequestDisposition`
- `draftPullRequestDispositionReason`
- `publishedPullRequestNumber`
- `publishedPullRequestHasNumber`
- `publishedPullRequestHasUrl`
- `publishedPullRequestHasOpenedAt`
- `publishedPullRequestHasTitle`
- `publishedPullRequestHasBody`
- `publishedPullRequestTitle`
- `publishedPullRequestBody`
- `publishedPullRequestBranchName`
- `publishedPullRequestBaseBranch`
- `publishedPullRequestUrl`
- `pullRequestPublished`
- `publishedPullRequestOpenedAt`
- `pullRequestMerged`
- `mergedPullRequestMergedAt`
- `autoMergeDisposition`
- `autoMergeDispositionReason`
- `autoMergePolicyEligible`
- `autoMergePolicyReason`

### Verification Signals

- `verificationDecision`
- `verificationDecisionIsApprove`
- `verificationDecisionIsRequestChanges`
- `verificationDecisionIsEscalate`
- `verificationApprovedForHumanReview`
- `verificationSummary`
- `verificationSummaryPresent`
- `verificationHasFindings`
- `verificationFindingsPresent`
- `verificationHasMissingCoverage`
- `verificationMissingCoveragePresent`
- `verificationHasSignals`
- `verificationHasFollowUps`
- `verificationFollowUpsPresent`
- `verificationFindingCount`
- `verificationMissingCoverageCount`
- `verificationFollowUpCount`

### Workflow History And Records

- `runLastStageEnteredAt`
- `runHasHistory`
- `runHasStageRecords`
- `runHistoryTextPresent`
- `stageRecordCount`
- `historyEntryCount`

### Rerun Signals

- `rerunRequested`
- `rerunHasReviewContext`
- `rerunReason`
- `rerunReasonPresent`
- `rerunRequestedAt`
- `rerunPriorRunId`
- `rerunPriorStage`
- `rerunReviewDecision`
- `rerunReviewDecisionPresent`
- `rerunReviewSubmittedAt`
- `rerunReviewSummary`
- `rerunReviewSummaryPresent`
- `rerunReviewUrl`
- `rerunReviewUrlPresent`
- `rerunRequestedCoderAgentId`
- `rerunRequestedVerifierAgentId`
- `rerunManualTakeoverRequestedAt`
- `rerunManualTakeoverActor`
- `rerunManualTakeoverWorktreePath`
- `rerunManualResumeNote`

## Nullability Rules

- count fields use `null` when the underlying metadata does not exist
- derived numeric fields such as `failureDiagnosticSystemPromptChars`, `failureDiagnosticSkillsPromptChars`, `failureDiagnosticToolSchemaChars`, `failureDiagnosticSkillCount`, `failureDiagnosticInjectedWorkspaceFileCount`, and `failureDiagnosticToolCount` mirror documented nested metadata when present and otherwise use `null`
- boolean summary fields such as `verificationHasFindings` default to `false`
  when the corresponding section is absent
- derived boolean fields such as `failureDiagnosticBootstrapWarningShown`
  default to `false` when the nested diagnostic signal is absent
- string or timestamp fields use `null` when the underlying value is absent
- `failureDiagnostics` uses `null` when no structured workflow failure metadata
  was recorded for the run
- blueprint-first count and string mirrors use `null` when the current
  workflow run did not capture blueprint-first context
- blueprint-first readiness booleans such as `blueprintAgreed` use `null` when
  no blueprint snapshot was attached to the run

## Consumer Guidance

Prefer this pattern:

1. branch on `contractVersion`
2. read documented top-level fields only
3. treat unknown extra top-level fields as additive

Avoid this pattern:

1. reaching into nested internal objects for routine automation
2. assuming undocumented nested shapes are stable
