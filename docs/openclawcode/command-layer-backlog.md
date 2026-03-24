# OpenClawCode Command-Layer Backlog

This file is the long-form seed-ready backlog for low-risk command-layer work.

Use it when the goal is to keep shipping many narrow slices without having to
rediscover the next field family each time.

Rules:

- `[x]` means the field is already implemented, tested, documented, and the
  corresponding validation issue has been consumed or proven equivalent.
- `[ ]` means the field or slice is still open and can be seeded into GitHub.
- Keep the live GitHub validation pool small. This file can be long even when
  only one or two command-layer issues are open on GitHub at a time.
- Prefer fields that are:
  - stable
  - low-risk
  - useful to simple JSON consumers
  - derivable from already-persisted workflow metadata

## Current Live Queue

- [x] `publishedPullRequestUrl`
- [x] `publishedPullRequestBaseBranch`
- [x] `publishedPullRequestBranchName`
- [x] `publishedPullRequestTitle`
- [x] `publishedPullRequestBody`
- [x] `publishedPullRequestHasNumber`
- [x] `publishedPullRequestHasUrl`
- [x] `publishedPullRequestHasOpenedAt`
- [x] `publishedPullRequestHasTitle`
- [x] `publishedPullRequestHasBody`

## Published Pull Request Mirrors

- [x] `publishedPullRequestNumber`
- [x] `publishedPullRequestOpenedAt`
- [x] `publishedPullRequestUrl`
- [x] `publishedPullRequestBaseBranch`
- [x] `publishedPullRequestBranchName`
- [x] `publishedPullRequestTitle`
- [x] `publishedPullRequestBody`
- [x] `publishedPullRequestHasNumber`
- [x] `publishedPullRequestHasUrl`
- [x] `publishedPullRequestHasOpenedAt`
- [x] `publishedPullRequestHasTitle`
- [x] `publishedPullRequestHasBody`

## Draft Pull Request Convenience Signals

- [x] `draftPullRequestBranchName`
- [x] `draftPullRequestBaseBranch`
- [x] `draftPullRequestTitle`
- [x] `draftPullRequestBody`
- [x] `draftPullRequestOpenedAt`
- [x] `draftPullRequestNumber`
- [x] `draftPullRequestUrl`
- [x] `draftPullRequestDisposition`
- [x] `draftPullRequestDispositionReason`
- [x] `draftPullRequestHasNumber`
- [x] `draftPullRequestHasUrl`
- [x] `draftPullRequestHasOpenedAt`
- [x] `draftPullRequestHasTitle`
- [x] `draftPullRequestHasBody`

## Issue Metadata Mirrors

- [x] `issueNumber`
- [x] `issueUrl`
- [x] `issueTitle`
- [x] `issueRepo`
- [x] `issueOwner`
- [x] `issueLabelCount`
- [x] `issueHasLabels`
- [x] `issueHasBody`
- [x] `issueBodyLength`
- [x] `issueTitleLength`
- [x] `issueRepoOwnerPair`
- [x] `issueLabelListPresent`
- [x] `issueFirstLabel`
- [x] `issueLastLabel`

## Workspace Metadata Mirrors

- [x] `workspaceBaseBranch`
- [x] `workspaceBranchName`
- [x] `workspaceRepoRoot`
- [x] `workspacePreparedAt`
- [x] `workspaceWorktreePath`
- [x] `workspaceHasPreparedAt`
- [x] `workspaceHasWorktreePath`
- [x] `workspaceRepoRootPresent`
- [x] `workspaceBranchMatchesIssue`

## Run Lifecycle Mirrors

- [x] `runCreatedAt`
- [x] `runUpdatedAt`
- [x] `runHasUpdatedAt`
- [x] `runAgeSeconds`
- [x] `runLastStageEnteredAt`
- [x] `runHasHistory`
- [x] `runHasStageRecords`
- [x] `runHistoryTextPresent`

## Build Result Mirrors

- [x] `changedFileCount`
- [x] `testCommandCount`
- [x] `testResultCount`
- [x] `noteCount`
- [x] `buildSummary`
- [x] `buildSummaryPresent`
- [x] `changedFilesPresent`
- [x] `testCommandsPresent`
- [x] `testResultsPresent`
- [x] `notesPresent`
- [x] `changedFileListStable`

## Scope Check Mirrors

- [x] `scopeCheck`
- [x] `scopeCheckSummary`
- [x] `scopeCheckSummaryPresent`
- [x] `scopeCheckPassed`
- [x] `scopeCheckHasBlockedFiles`
- [x] `scopeBlockedFileCount`
- [x] `scopeBlockedFilesPresent`
- [x] `scopeBlockedFirstFile`
- [x] `scopeBlockedLastFile`

## Verification Mirrors

- [x] `verificationDecision`
- [x] `verificationApprovedForHumanReview`
- [x] `verificationSummary`
- [x] `verificationHasFindings`
- [x] `verificationHasMissingCoverage`
- [x] `verificationHasSignals`
- [x] `verificationHasFollowUps`
- [x] `verificationFindingCount`
- [x] `verificationMissingCoverageCount`
- [x] `verificationFollowUpCount`
- [x] `verificationSummaryPresent`
- [x] `verificationDecisionIsEscalate`
- [x] `verificationDecisionIsRequestChanges`
- [x] `verificationDecisionIsApprove`
- [x] `verificationFindingsPresent`
- [x] `verificationMissingCoveragePresent`
- [x] `verificationFollowUpsPresent`

## Suitability Mirrors

- [x] `suitabilityDecision`
- [x] `suitabilitySummary`
- [x] `suitabilityReasons`
- [x] `suitabilityReasonCount`
- [x] `suitabilityClassification`
- [x] `suitabilityRiskLevel`
- [x] `suitabilityEvaluatedAt`
- [x] `suitabilitySummaryPresent`
- [x] `suitabilityReasonsPresent`
- [x] `suitabilityDecisionIsAutoRun`
- [x] `suitabilityDecisionIsNeedsHumanReview`
- [x] `suitabilityDecisionIsEscalate`

## Failure Diagnostic Mirrors

- [x] `failureDiagnosticsSummary`
- [x] `failureDiagnosticProvider`
- [x] `failureDiagnosticModel`
- [x] `failureDiagnosticSystemPromptChars`
- [x] `failureDiagnosticSkillsPromptChars`
- [x] `failureDiagnosticToolSchemaChars`
- [x] `failureDiagnosticToolCount`
- [x] `failureDiagnosticSkillCount`
- [x] `failureDiagnosticInjectedWorkspaceFileCount`
- [x] `failureDiagnosticBootstrapWarningShown`
- [x] `failureDiagnosticUsageTotal`
- [x] `failureDiagnosticsPresent`
- [x] `failureDiagnosticProviderPresent`
- [x] `failureDiagnosticModelPresent`
- [x] `failureDiagnosticSummaryPresent`

## Execution Spec Mirrors

- [x] `acceptanceCriteriaCount`
- [x] `openQuestionCount`
- [x] `riskCount`
- [x] `assumptionCount`
- [x] `testPlanCount`
- [x] `scopeItemCount`
- [x] `outOfScopeCount`
- [x] `acceptanceCriteriaPresent`
- [x] `openQuestionsPresent`
- [x] `risksPresent`
- [x] `assumptionsPresent`
- [x] `testPlanPresent`
- [x] `scopeItemsPresent`
- [x] `outOfScopePresent`

## History And Rerun Mirrors

- [x] `stageRecordCount`
- [x] `historyEntryCount`
- [x] `rerunRequested`
- [x] `rerunHasReviewContext`
- [x] `rerunReason`
- [x] `rerunRequestedAt`
- [x] `rerunPriorRunId`
- [x] `rerunPriorStage`
- [x] `rerunReviewDecision`
- [x] `rerunReviewSubmittedAt`
- [x] `rerunReviewSummary`
- [x] `rerunReviewUrl`
- [x] `rerunReasonPresent`
- [x] `rerunReviewSummaryPresent`
- [x] `rerunReviewUrlPresent`
- [x] `rerunReviewDecisionPresent`

## Queueing Notes

- [ ] keep one active command-layer GitHub issue open at a time unless a second
      issue is needed to avoid idle operator time
- [ ] prefer staying within one field family for 3-5 slices before switching
      domains
- [ ] when a family is nearly complete, seed the next family here before the
      live GitHub pool runs dry
- [ ] update this backlog whenever a future slice reveals a better low-risk
      mirror candidate than the ones listed above
