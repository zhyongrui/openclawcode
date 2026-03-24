# OpenClaw Code Policy Contract

This document defines the stable machine-readable contract for:

```bash
openclaw code policy-show --json
```

## Contract Version

- top-level field: `contractVersion`
- current value: `1`

Compatibility rule:

- adding fields is backward-compatible within `contractVersion: 1`
- renaming or changing the meaning of documented fields requires a new
  contract version

## Stable Top-Level Shape

```json
{
  "contractVersion": 1,
  "suitability": {
    "lowRiskLabels": ["cli", "json"],
    "highRiskLabels": ["security", "secrets"],
    "lowRiskKeywords": ["openclaw code run", "--json"],
    "highRiskKeywords": ["auth", "migration", "database"]
  },
  "buildGuardrails": {
    "broadFanOutFileThreshold": 8,
    "broadFanOutDirectoryThreshold": 4,
    "largeDiffLineThreshold": 300,
    "largeDiffFileThreshold": 12,
    "generatedFileHints": ["dist/", "generated/"]
  },
  "providerFailureHandling": {
    "autoPauseClasses": ["provider-internal-error"],
    "nonPauseClasses": ["timeout", "rate-limit", "overload", "validation-failure"]
  }
}
```

## Stable Fields

### Suitability

- `suitability.lowRiskLabels`
- `suitability.highRiskLabels`
- `suitability.lowRiskKeywords`
- `suitability.highRiskKeywords`

### Build Guardrails

- `buildGuardrails.broadFanOutFileThreshold`
- `buildGuardrails.broadFanOutDirectoryThreshold`
- `buildGuardrails.largeDiffLineThreshold`
- `buildGuardrails.largeDiffFileThreshold`
- `buildGuardrails.generatedFileHints`

### Provider Failure Handling

- `providerFailureHandling.autoPauseClasses`
- `providerFailureHandling.nonPauseClasses`

## Intended Consumers

This contract is meant for:

- operator wrappers that want to display current policy
- CI or automation that needs to reason about repo-local limits
- release tooling that wants to compare live behavior against documented policy
