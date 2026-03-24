# OpenClaw Code Support Matrix

## Safe Today

These repo and task shapes are the current target:

- Node/TypeScript repos with a working git checkout
- repos where `pnpm` or the equivalent project runner is already healthy
- narrow command-layer or docs changes
- stable JSON/CLI/status contract changes
- repos with deterministic targeted tests
- one operator repo binding at a time with explicit base branch control

Supported adapter roles today:

- planner:
  - `claude-code`
  - `openclaw-default`
  - `custom`
- coder:
  - `codex`
  - `claude-code`
  - `openclaw-default`
  - `custom`
- reviewer:
  - `claude-code`
  - `openclaw-default`
  - `custom`
- verifier:
  - `codex`
  - `claude-code`
  - `openclaw-default`
  - `custom`
- doc-writer:
  - `codex`
  - `claude-code`
  - `openclaw-default`
  - `custom`

## Experimental

- blueprint-first goal discussion and work-item decomposition
- provider rerouting through chat or rerun metadata
- active-run deferred reroutes
- merge overrides through stage gates
- fallback-chain injection for provider proofs
- release-control artifacts and receipts

## Unsupported

Do not treat these as autonomous-safe today:

- auth or secret rotation work
- billing and payment flows
- schema migrations or database backfills
- permissions / RBAC / IAM changes
- infrastructure or Kubernetes / Terraform changes
- broad generated-file churn
- large multi-package monorepo fan-out
- blind binary or media asset rewrites

## What This Is Not

OpenClaw Code is not:

- a general-purpose autonomous refactoring engine for any repo
- a secret-management system
- a policy engine for production infrastructure
- a substitute for human approval on high-risk changes
- a guarantee that fallback models are safe for continuous unattended use

## Known Limits

- large diffs and broad fan-out are intentionally slowed or blocked from
  auto-merge
- suitability overrides still require human merge decisions
- in-flight provider hot-swap is not implemented; active runs only support
  deferred reroute replay
- live fallback behavior is still proof-oriented, not fully productized
- fresh-host and long-lived operator proofs still need real external runs

## Fallback Decision

Current decision as of 2026-03-17:

- fallback remains **proof-only** operator behavior
- the live operator now has a second discoverable model and a real fallback proof
  trail, but fallback still should not be treated as generally supported
  unattended production behavior
- current live evidence:
  - long-lived operator inventory reported `openai-codex/gpt-5.4` as
    discoverable
  - run `zhyongrui-openclawcode-129-1773741126413` proved a real fallback chain
    failure path on the long-lived operator
  - run `zhyongrui-openclawcode-134-1773741968419` proved a real fallback-model
    handoff from `anthropic/claude-opus-4-6` to `crs/gpt-5.4`
- fallback remains proof-only because the fallback-engaged run still uncovered a
  separate sandbox-path issue; it is not yet a clean unattended production path
