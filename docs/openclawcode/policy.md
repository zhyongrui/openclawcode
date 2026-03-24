# OpenClaw Code Policy

This document defines the current operator-facing policy for autonomous
execution, merge behavior, escalation, reruns, and provider failure handling.

## Autonomous Execution Policy

Autonomous execution is currently optimized for narrow command-layer and docs
work, not broad product changes.

Low-risk suitability allowlist:

- labels:
  - `cli`
  - `json`
  - `command-layer`
  - `docs`
  - `operator-docs`
  - `validation`
- keywords:
  - `openclaw code run`
  - `--json`
  - `cli`
  - `command-layer`
  - `docs-only`
  - `operator doc`
  - `validation issue`

High-risk suitability denylist:

- labels:
  - `auth`
  - `authentication`
  - `billing`
  - `database`
  - `infra`
  - `migration`
  - `permissions`
  - `rbac`
  - `secret`
  - `secrets`
  - `security`
- keywords:
  - `auth`
  - `authentication`
  - `authorization`
  - `oauth`
  - `login`
  - `secret`
  - `credential`
  - `password`
  - `api key`
  - `private key`
  - `security`
  - `vulnerability`
  - `encryption`
  - `decrypt`
  - `migration`
  - `schema`
  - `database`
  - `backfill`
  - `billing`
  - `payment`
  - `invoice`
  - `subscription`
  - `permission`
  - `access control`
  - `rbac`
  - `infra`
  - `terraform`
  - `kubernetes`
  - `iam`

Current autonomous decision model:

- `auto-run`:
  - command-layer scope
  - no planner open questions
  - issue body is present
  - no denylisted labels or keywords
- `needs-human-review`:
  - mixed or workflow-core scope
  - planner open questions remain
  - issue body is missing or underspecified
- `escalate`:
  - planner marks the issue high risk
  - denylisted labels or keywords are present

## Suitability Override Policy

Suitability overrides are explicit operator actions. They do not silently
downgrade risk.

Supported paths:

- chat:
  - `/occode-start-override owner/repo#123`
- CLI:
  - `openclaw code run --suitability-override-actor ... --suitability-override-reason ...`

Override behavior:

- the original suitability decision is preserved in workflow artifacts
- the effective decision becomes `auto-run` for that run only
- the operator actor and reason are persisted
- auto-merge remains blocked after a suitability override

## Merge Policy

Auto-merge is allowed only when all of the following are true:

- verification approved the run for human review
- suitability accepted autonomous execution without a manual override
- the build is classified as `command-layer`
- the scope check passed
- no generated files were changed
- the change set did not trip the large-diff guardrail
- the change set did not trip the broad fan-out guardrail

Auto-merge is blocked when:

- suitability is `needs-human-review` or `escalate`
- a manual suitability override was used
- the run is not command-layer
- the scope check failed
- generated files changed
- the change set is too large or too broad

Merge-policy exceptions remain explicit human actions through the
`merge-promotion` gate.

The narrow auto-merge eligibility contract is documented separately in
`auto-merge-policy.md`.

## Builder Guardrails

Current repo-local guardrails:

- broad fan-out:
  - `>= 8` changed files, or
  - `>= 4` changed directories
- large diff:
  - `>= 300` changed lines, or
  - `>= 12` changed files
- generated-file detection:
  - paths under `dist/`, `build/`, `coverage/`, `generated/`, `__snapshots__/`
  - files ending in `.generated.*`, `.gen.ts`, `.gen.js`, `.g.ts`, `.g.js`

These signals are persisted in the build artifact and mirrored into
`openclaw code run --json`.

## Rerun And Runtime Routing Policy

Supported reroute paths:

- pre-run role routing from blueprint/provider strategy
- rerun-time overrides:
  - `/occode-reroute-run`
  - `--rerun-coder-agent`
  - `--rerun-verifier-agent`
- active-run deferred reroutes:
  - stored while a run is active
  - replayed automatically on the next rerun if the active run fails

Not yet supported:

- true in-flight hot-swapping inside the same active build/verifier attempt

## Provider Failure Policy

Provider failure classes that auto-pause the queue:

- `provider-internal-error`

Provider failure classes that do not auto-pause the queue:

- `timeout`
- `rate-limit`
- `overload`
- `validation-failure`

Fallback routing:

- fallback chains can be injected with `OPENCLAWCODE_MODEL_FALLBACKS`
- this is currently intended for controlled operator proofs, not blind
  production failover

## Machine-Readable Surface

Current machine-readable policy surfaces:

- `openclaw code policy-show --json`
- `openclaw code run --json`
- `openclaw code operator-status-snapshot-show --json`

The stable policy snapshot schema is documented in `policy-contract.md`.
