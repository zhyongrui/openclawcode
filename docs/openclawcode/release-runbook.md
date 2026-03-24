# OpenClaw Code Release Runbook

## First Install

1. Prepare the host with the prerequisites from `fresh-host-install.md`.
2. Configure tokens, webhook secrets, and channel bindings.
3. Run:
   - `./scripts/openclawcode-setup-check.sh --strict --json`
   - `./scripts/openclawcode-setup-check.sh --strict --probe-built-startup --json`
4. Confirm `promotionReady` and `builtStartupProofReady`.

## First Proof

Run one narrow proof before trusting automation:

1. bind the repo
2. create or select one low-risk command-layer issue
3. run:
   - chat path: `/occode-start ...`
   - or CLI path: `openclaw code run ... --json`
4. confirm:
   - worktree created
   - build and verification succeeded
   - draft PR opened or merge path explained

## Promotion

1. refresh:
   - `openclaw code promotion-gate-refresh --json`
2. review:
   - `openclaw code promotion-gate-show --json`
   - `openclaw code operator-status-snapshot-show --json`
3. if the sync branch is acceptable, record:
   - `openclaw code promotion-receipt-record ...`
4. promote with the git procedure in `sync-promotion-runbook.md`

## Rollback

1. refresh rollback recommendation:
   - `openclaw code rollback-suggestion-refresh --json`
2. inspect:
   - `openclaw code rollback-suggestion-show --json`
3. restore the chosen ref
4. record:
   - `openclaw code rollback-receipt-record ...`

## Disaster Recovery

Use this when queue state or operator state is inconsistent:

1. stop the plugin/service
2. capture:
   - `.openclawcode/`
   - operator state dir
   - latest promotion / rollback receipts
3. restore the last known-good branch and receipt pair
4. rerun strict setup-check
5. re-bind and resume only after queue/state audit passes
