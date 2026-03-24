# OpenClaw Code Troubleshooting

## Webhook Failures

Symptoms:

- no new issue activity lands in the queue
- GitHub delivery retries continue

Check:

- webhook route is reachable
- shared secret matches
- `setup-check --strict --json`

## Provider Pauses

Symptoms:

- `/occode-inbox` or `/occode-status` shows an active pause
- queue intake succeeds but execution does not resume

Check:

- recent failed runs for provider-side internal errors
- `openclaw code policy-show --json`
- model inventory / fallback readiness in setup-check output

## Queue Stalls

Symptoms:

- pending approvals or queued runs do not drain

Check:

- operator-status snapshot current run / queue state
- stage-gate readiness
- execution-start holds
- provider pause state

## Worktree Conflicts

Symptoms:

- builder fails before code changes
- takeover or resume-after-edit paths stop progressing

Check:

- worktree path exists and is writable
- tracked files were not truncated unexpectedly
- rerun context and manual takeover metadata

## Model Inventory Problems

Symptoms:

- setup-check says model inventory not ready
- fallback proof cannot start

Check:

- operator config for provider/model auth
- `models list --json`
- adapter env vars for rerouted roles

## Feishu Binding Problems

Symptoms:

- `/occode-bind` or `/occode-status` surfaces do not reflect the expected repo

Check:

- current repo bindings in operator-status snapshot
- plugin config repo list
- token and app permissions from `upgrade-and-rotation.md`
