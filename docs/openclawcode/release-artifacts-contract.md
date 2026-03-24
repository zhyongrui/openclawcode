# Release Artifacts Contract

The repo-local release-readiness artifacts already persist stable schema
versions and are intended for operator automation.

Artifacts covered:

- `.openclawcode/promotion-gate.json`
- `.openclawcode/rollback-suggestion.json`
- `.openclawcode/promotion-receipt.json`
- `.openclawcode/rollback-receipt.json`

Schema versions:

- `promotion-gate.json` uses `schemaVersion: 1`
- `rollback-suggestion.json` uses `schemaVersion: 1`
- `promotion-receipt.json` uses `schemaVersion: 1`
- `rollback-receipt.json` uses `schemaVersion: 1`

Primary commands:

- `openclaw code promotion-gate-refresh --json`
- `openclaw code promotion-gate-show --json`
- `openclaw code rollback-suggestion-refresh --json`
- `openclaw code rollback-suggestion-show --json`
- `openclaw code promotion-receipt-record --json`
- `openclaw code promotion-receipt-show --json`
- `openclaw code rollback-receipt-record --json`
- `openclaw code rollback-receipt-show --json`

Stable top-level fields for `promotion-gate.json`:

- `repoRoot`
- `artifactPath`
- `exists`
- `schemaVersion`
- `generatedAt`
- `branchName`
- `commitSha`
- `baseBranch`
- `rollbackTargetBranch`
- `rollbackTargetCommitSha`
- `setupCheckScriptPath`
- `setupCheckAvailable`
- `setupCheckOk`
- `setupCheckStrict`
- `operatorRoot`
- `lowRiskProofReady`
- `fallbackProofReady`
- `promotionReady`
- `gatewayReachable`
- `routeProbeReady`
- `routeProbeSkipped`
- `builtStartupProofRequested`
- `builtStartupProofReady`
- `nextAction`
- `summaryPass`
- `summaryWarn`
- `summaryFail`
- `stageGateArtifactExists`
- `mergePromotionGateReadiness`
- `mergePromotionLatestDecision`
- `ready`
- `blockerCount`
- `blockers`
- `suggestionCount`
- `suggestions`

Stable top-level fields for `rollback-suggestion.json`:

- `repoRoot`
- `artifactPath`
- `exists`
- `schemaVersion`
- `generatedAt`
- `branchName`
- `commitSha`
- `baseBranch`
- `targetBranch`
- `targetCommitSha`
- `targetRef`
- `recommended`
- `reason`
- `promotionArtifactPath`
- `promotionArtifactExists`
- `promotionReady`
- `mergePromotionGateReadiness`
- `blockerCount`
- `blockers`
- `suggestionCount`
- `suggestions`

Stable top-level fields for `promotion-receipt.json`:

- `repoRoot`
- `artifactPath`
- `exists`
- `schemaVersion`
- `recordedAt`
- `actor`
- `note`
- `sourceBranch`
- `sourceCommitSha`
- `promotedBranch`
- `promotedCommitSha`
- `promotedRef`
- `promotionArtifactPath`
- `promotionArtifactExists`
- `promotionReady`
- `mergePromotionGateReadiness`
- `setupCheckOk`
- `lowRiskProofReady`
- `fallbackProofReady`
- `rollbackSuggestionArtifactPath`
- `rollbackSuggestionArtifactExists`
- `rollbackTargetBranch`
- `rollbackTargetCommitSha`
- `rollbackTargetRef`
- `blockerCount`
- `blockers`
- `suggestionCount`
- `suggestions`

Stable top-level fields for `rollback-receipt.json`:

- `repoRoot`
- `artifactPath`
- `exists`
- `schemaVersion`
- `recordedAt`
- `actor`
- `note`
- `sourceBranch`
- `sourceCommitSha`
- `restoredBranch`
- `restoredCommitSha`
- `restoredRef`
- `rollbackSuggestionArtifactPath`
- `rollbackSuggestionArtifactExists`
- `recommended`
- `reason`
- `promotionArtifactPath`
- `promotionArtifactExists`
- `promotionReady`
- `mergePromotionGateReadiness`
- `blockerCount`
- `blockers`
- `suggestionCount`
- `suggestions`

Stability boundary:

- the top-level fields listed above are stable for `schemaVersion: 1`
- nested `mergePromotionLatestDecision` keeps the stage-gate decision shape
  from the stage-gate artifact and is treated as stable for `schemaVersion: 1`
- human-oriented `blockers`, `suggestions`, and `reason` are descriptive text;
  automation should prefer the structured booleans, counts, and refs first
