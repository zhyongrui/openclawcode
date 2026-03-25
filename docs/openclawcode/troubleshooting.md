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

## Source Plugin Runtime Mismatch

Symptoms:

- `openclaw onboard` or gateway startup logs show plugin source entries such as
  `extensions/feishu/index.ts` or `extensions/openclawcode/index.ts`
- multiple plugins fail during load with the same `TypeError`
- one real example:
  - `Cannot read properties of undefined (reading 'resolveEmbeddedSessionLane')`

When this usually happens:

- development is running from a local repo checkout
- the `openclaw` executable on `PATH` comes from a different installation
  root than that checkout
- plugin entry / SDK alias resolution uses the local checkout, but plugin
  runtime resolution accidentally comes from the global install

Check:

- confirm which binary is running:
  - `which openclaw`
- confirm the checkout you expected to use:
  - `pwd`
- if logs reference local source plugin entries from the repo checkout but
  fail inside newer runtime helpers, suspect host/runtime skew first
- update to a build that includes the workspace-runtime fix
  (`fix(plugins): prefer workspace runtime for source plugins`)

Prevention:

- during development, prefer running the repo-local build/entrypoint instead of
  assuming the global `openclaw` binary matches the checkout
- keep plugin entry resolution, plugin SDK alias resolution, and plugin runtime
  resolution aligned to the same workspace/package root
