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
  - other internal nested workflow structures

Consumers should prefer the documented top-level fields instead of unpacking
those nested objects.

## Stable Top-Level Fields

### Identity And Stage

- `contractVersion`
- `id`
- `issue`
- `stage`
- `stageLabel`
- `runSummary`

### Attempt Counters

- `totalAttemptCount`
- `planningAttemptCount`
- `buildAttemptCount`
- `verificationAttemptCount`

### Change And Scope Signals

- `changedFiles`
- `changedFileCount`
- `changeDisposition`
- `changeDispositionReason`
- `issueClassification`
- `scopeCheck`
- `scopeCheckSummary`
- `scopeCheckSummaryPresent`
- `scopeCheckPassed`
- `scopeCheckHasBlockedFiles`
- `scopeBlockedFiles`
- `scopeBlockedFileCount`

### Build/Test Summary

- `testCommandCount`
- `testResultCount`
- `noteCount`

### Failure Diagnostics

- `failureDiagnostics`
- `failureDiagnosticsSummary`
- `failureDiagnosticProvider`
- `failureDiagnosticModel`
- `failureDiagnosticSystemPromptChars`
- `failureDiagnosticSkillsPromptChars`
- `failureDiagnosticToolSchemaChars`
- `failureDiagnosticSkillCount`
- `failureDiagnosticInjectedWorkspaceFileCount`
- `failureDiagnosticBootstrapWarningShown`
- `failureDiagnosticToolCount`
- `failureDiagnosticUsageTotal`

### Suitability Signals

- `suitabilityDecision`
- `suitabilitySummary`
- `suitabilityReasons`
- `suitabilityReasonCount`
- `suitabilityClassification`
- `suitabilityRiskLevel`
- `suitabilityEvaluatedAt`

### Planning Metadata Counts

- `acceptanceCriteriaCount`
- `openQuestionCount`
- `riskCount`
- `assumptionCount`
- `testPlanCount`
- `scopeItemCount`
- `outOfScopeCount`

### Pull Request And Merge State

- `draftPullRequestBranchName`
- `draftPullRequestBaseBranch`
- `draftPullRequestTitle`
- `draftPullRequestBody`
- `draftPullRequestOpenedAt`
- `draftPullRequestNumber`
- `draftPullRequestUrl`
- `draftPullRequestDisposition`
- `draftPullRequestDispositionReason`
- `publishedPullRequestNumber`
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
- `verificationApprovedForHumanReview`
- `verificationSummary`
- `verificationHasFindings`
- `verificationHasMissingCoverage`
- `verificationHasSignals`
- `verificationHasFollowUps`
- `verificationFindingCount`
- `verificationMissingCoverageCount`
- `verificationFollowUpCount`

### Workflow History And Records

- `stageRecordCount`
- `historyEntryCount`

### Rerun Signals

- `rerunRequested`
- `rerunHasReviewContext`
- `rerunReason`
- `rerunRequestedAt`
- `rerunPriorRunId`
- `rerunPriorStage`
- `rerunReviewDecision`
- `rerunReviewSubmittedAt`
- `rerunReviewSummary`
- `rerunReviewUrl`

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

## Consumer Guidance

Prefer this pattern:

1. branch on `contractVersion`
2. read documented top-level fields only
3. treat unknown extra top-level fields as additive

Avoid this pattern:

1. reaching into nested internal objects for routine automation
2. assuming undocumented nested shapes are stable
