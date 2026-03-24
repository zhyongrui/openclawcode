# Validation-Pool Maintenance

The validation-pool CLI now has an explicit minimum-pool policy and a balanced
seeding path for keeping the repo-local queue useful without over-seeding it.

## Minimum Pool Policy

Current minimum open-issue targets:

- `command-layer`: `0`
  - the current seed-ready command-layer backlog is intentionally exhausted, so
    an empty command-layer pool is a valid steady state until a new candidate is
    identified
- `operator-docs`: `1`
  - keep one docs/operator-note validation issue available so docs-only flows
    remain easy to re-prove
- `high-risk-validation`: `1`
  - keep one webhook precheck escalation issue available so high-risk routing
    remains easy to re-prove

## Commands

List the current pool and see the minimum-pool deficits:

```bash
openclaw code list-validation-issues --json
```

Preview balanced seeding from the current minimum-pool policy:

```bash
openclaw code seed-validation-issue --balanced --dry-run --json
```

Actually seed the missing balanced-pool issues:

```bash
openclaw code seed-validation-issue --balanced --json
```

Close implemented command-layer issues and then enforce the minimum-pool policy
in one pass:

```bash
openclaw code reconcile-validation-issues --close-implemented --enforce-minimum-pool-size --json
```

## Dedicated String Templates

The CLI now includes dedicated string-template variants for fields that would be
ambiguous under the generic string template:

- `command-json-string-timestamp`
- `command-json-string-url`
- `command-json-string-enum`

Use these when the downstream consumer benefits from a more specific issue
description than the plain `command-json-string` template.

## Maintenance Cadence

Recommended operator cadence:

1. run `openclaw code reconcile-validation-issues --close-implemented --json`
   after landing or syncing a batch of validation-related changes
2. if `nextAction = "enforce-minimum-pool-size"`, run either:
   - `openclaw code reconcile-validation-issues --close-implemented --enforce-minimum-pool-size --json`
   - or `openclaw code seed-validation-issue --balanced --json`
3. keep the pool small and intentional:
   - do not backfill command-layer issues when the seed-ready backlog is empty
   - do keep one operator-doc note and one high-risk validation issue available
4. record any live validation consumption or replenishment in the dev log so a
   later operator can understand why the pool changed
