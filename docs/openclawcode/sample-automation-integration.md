# Sample Automation Integration

The simplest downstream automation should consume the stable contracts instead
of parsing chat text.

## Policy Snapshot

```bash
openclaw code policy-show --json | jq .
```

Use this to confirm:

- current suitability allowlist / denylist
- build guardrail thresholds
- provider pause classes

## Run Snapshot

```bash
openclaw code run --issue 123 --repo-root . --json | jq '
  {
    stage: .stage,
    suitability: .suitabilityDecision,
    overrideApplied: .suitabilityOverrideApplied,
    largeDiff: .buildLargeDiff,
    broadFanOut: .buildBroadFanOut,
    generatedFiles: .buildGeneratedFiles,
    autoMergeEligible: .autoMergePolicyEligible
  }'
```

## Operator Snapshot

```bash
openclaw code operator-status-snapshot-show --json | jq '
  {
    repoCount: .repoCount,
    queuedRunCount: .queuedRunCount,
    providerPauseActive: .providerPauseActive
  }'
```
