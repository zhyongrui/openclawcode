# OpenClawCode Operator Setup

Use this runbook to stand up one local OpenClaw gateway as the operator entrypoint
for the current `openclawcode` loop:

- GitHub issue webhook intake
- chat approval or auto-enqueue
- background workflow execution
- draft PR / review / merge lifecycle notifications

This is the supported local setup path for the current fork.

For direct CLI-only workflow trials, see `mvp-runbook.md`.
For the temporary `trycloudflare` ingress helper only, see `webhook-operations.md`.

## Prerequisites

Before wiring the plugin, make sure you already have:

- one local checkout of this repository
- `pnpm install` completed in that checkout
- a Node runtime new enough for the current branch you are operating:
  - the refreshed upstream integration branch now expects Node `>=22.16.0`
    for CLI startup
  - this workstation now runs the operator on local Node `22.16.0`
  - the built `dist/index.js` entrypoint refuses to start below the new floor
- one chat surface already connected to the local gateway
- a GitHub token with:
  - repo read/write access for issue fetch, PR publish, and merge operations
  - repo webhook admin access if you want the tunnel script to rewrite the webhook URL
- `cloudflared` installed if you plan to use temporary public ingress

## 1. Build The Local Entrypoint

Build the repo before starting the gateway or background runner:

```bash
pnpm build
```

The current setup check expects the built CLI entrypoint at:

```text
dist/index.js
```

## 2. Create The Operator Env File

Optional fresh-operator mode:

```bash
export OPENCLAWCODE_OPERATOR_ROOT=/tmp/openclawcode-fresh/.openclaw
mkdir -p "$OPENCLAWCODE_OPERATOR_ROOT"
```

When `OPENCLAWCODE_OPERATOR_ROOT` is set, the local operator scripts derive
their default file paths from that root instead of `~/.openclaw`. That is the
recommended way to prove a fresh operator environment without mutating the
long-lived local state directory.

Create `${OPENCLAWCODE_OPERATOR_ROOT:-~/.openclaw}/openclawcode.env` with the
GitHub token and webhook secret used by both the gateway and the tunnel helper:

```bash
GH_TOKEN=<github-token>
OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=<shared-webhook-secret>
OPENCLAWCODE_GITHUB_REPO=<owner>/<repo>
OPENCLAWCODE_GITHUB_HOOK_ID=<existing-webhook-id>
OPENCLAWCODE_GITHUB_HOOK_EVENTS=issues,pull_request,pull_request_review
```

Notes:

- `GH_TOKEN` is the supported input for `scripts/openclawcode-webhook-tunnel.sh`.
- `scripts/openclawcode-setup-check.sh` accepts either `GH_TOKEN` or `GITHUB_TOKEN`
  for health checks, but keeping one canonical env file is simpler.
- The webhook secret must match the GitHub repo webhook configuration exactly.
- keeping repo and hook metadata in the same env file lets
  `openclawcode-setup-check.sh --strict` verify a copied fresh operator root
  without relying on extra shell exports
- optional provider-resilience proof knob:
  - set `OPENCLAWCODE_MODEL_FALLBACKS=provider/model,provider/model` when you
    want issue-worktree runs to inject an explicit fallback chain without
    editing the shared agent config permanently
  - leave it unset during normal operation if you want the runtime to keep
    using only the configured primary model path

## 3. Enable The Bundled Plugin

Add or update the bundled plugin entry in
`${OPENCLAWCODE_OPERATOR_ROOT:-~/.openclaw}/openclaw.json`:

```json5
{
  gateway: {
    mode: "local",
    port: 18789,
  },
  plugins: {
    enabled: true,
    allow: ["openclawcode"],
    entries: {
      openclawcode: {
        enabled: true,
        config: {
          githubWebhookSecretEnv: "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET",
          repos: [
            {
              owner: "<owner>",
              repo: "<repo>",
              repoRoot: "/path/to/openclaw",
              baseBranch: "main",
              triggerMode: "approve",
              notifyChannel: "<chat-channel>",
              notifyTarget: "<bootstrap-target>",
              builderAgent: "main",
              verifierAgent: "main",
              testCommands: [
                "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
              ],
              openPullRequest: true,
              mergeOnApprove: false,
            },
          ],
        },
      },
    },
  },
}
```

Operator guidance:

- `triggerMode: "approve"` is the safer default while the repo is still being validated.
- `notifyTarget` is only a bootstrap default.
  After the gateway is connected to the real chat, bind the repo from chat with
  `/occode-bind` so notifications stay anchored to the actual conversation.
- Keep the repo mapping to one repository per entry.
  That makes lifecycle routing and `/occode-inbox` output easier to reason about.

## 4. Start The Local Gateway

Start the gateway from the repo root after sourcing the env file:

```bash
source ~/.openclaw/openclawcode.env
/home/zyr/.local/node-v22.16.0/bin/node dist/index.js gateway run --bind loopback --port 18789
```

If you use a service wrapper or local launcher script, keep these rules:

- source `~/.openclaw/openclawcode.env` before the gateway starts
- restart the gateway after changing `openclaw.json`
- keep the plugin route on the same local port that the tunnel helper targets
- use a Node runtime that satisfies the current startup floor (`>=22.16.0`)
- on a fresh built checkout, the first startup may spend about five seconds on
  `Control UI assets missing; building ...` before `ws://127.0.0.1:18789`
  begins listening
- direct diagnostics now support
  `OPENCLAW_DISABLE_LAZY_SUBCOMMANDS=1 ... dist/index.js gateway run ...`
  against the same entrypoint without breaking command registration

### Built Startup Isolation Proof

When you need to prove that the built bundled `openclawcode` plugin can start
under `dist/index.js` without the rest of the live operator config, constrain
the proof config more aggressively than "disable Feishu":

- set `channels = {}`
- set `bindings = []`
- keep only `plugins.entries.openclawcode`
- add `plugins.allow = ["openclawcode"]`
- add `plugins.slots.memory = "none"`

That extra allowlist matters. Bundled defaults such as `device-pair`,
`ollama`, `phone-control`, `sglang`, `talk-voice`, `vllm`, and `memory-core`
still enable themselves by default unless plugin loading is constrained
explicitly.

As of 2026-03-14, the repaired built path was proven with:

```bash
OPENCLAW_SKIP_CANVAS_HOST=1 \
OPENCLAW_CONFIG_PATH=/tmp/openclawcode-only-allowlist.json \
OPENCLAW_STATE_DIR=/tmp/openclawcode-proof-state \
/home/zyr/.local/node-v22.16.0/bin/node dist/index.js gateway run \
  --bind loopback \
  --port 18890 \
  --allow-unconfigured \
  --verbose
```

Expected proof signal:

- `listening on ws://127.0.0.1:18890, ws://[::1]:18890`

## 5. Bind The Repo To The Real Chat Target

Once the gateway is online in the desired chat surface, bind the repo from the
actual conversation that should receive updates:

```text
/occode-bind
```

If you have multiple configured repos, use the explicit repo form:

```text
/occode-bind <owner>/<repo>
```

Useful follow-up commands:

- `/occode-intake` creates a new GitHub issue directly from the bound chat and
  queues low-risk work immediately
- `/occode-unbind` removes the saved repo-to-chat binding
- `/occode-inbox` shows pending approvals, queue state, recent lifecycle activity,
  and the live open validation pool
- `/occode-status <owner>/<repo>#<issue>` shows the latest tracked status for one
  issue and annotates seeded validation issues with class/template metadata

Do not hand-edit
`${OPENCLAWCODE_OPERATOR_ROOT:-~/.openclaw}/plugins/openclawcode/chatops-state.json`
unless you are repairing corruption. Normal routing changes should go through
`/occode-bind` and `/occode-unbind`.

## 6. Create Or Reuse The GitHub Repo Webhook

Create one repository webhook in GitHub with:

- content type: `application/json`
- secret: the same value as `OPENCLAWCODE_GITHUB_WEBHOOK_SECRET`
- events:
  - `issues`
  - `pull_request`
  - `pull_request_review`

The current tunnel helper rewrites an existing webhook URL.
It does not create the webhook for you, so keep the numeric webhook id available.

Recommended persistent env-file values when using the helper:

```bash
OPENCLAWCODE_GITHUB_REPO=<owner>/<repo>
OPENCLAWCODE_GITHUB_HOOK_ID=<existing-webhook-id>
OPENCLAWCODE_GITHUB_HOOK_EVENTS=issues,pull_request,pull_request_review
```

## 7. Start Temporary Public Ingress

If you do not have a fixed public domain yet, start the bundled tunnel helper:

```bash
./scripts/openclawcode-webhook-tunnel.sh start
```

That helper:

- starts a `trycloudflare` tunnel to `http://127.0.0.1:18789`
- extracts the current public URL
- rewrites the configured GitHub repo webhook to
  `https://<public-host>/plugins/openclawcode/github`
- re-applies the shared secret from `~/.openclaw/openclawcode.env`
- re-applies the required GitHub event set so the webhook stays subscribed to:
  - `issues`
  - `pull_request`
  - `pull_request_review`

For the dedicated ingress commands and operational caveats, see `webhook-operations.md`.

## 8. Run The Setup Health Check

Use the repo-local health check before replaying real GitHub traffic:

```bash
./scripts/openclawcode-setup-check.sh
```

What it verifies by default:

- repo root exists and `dist/index.js` is present
- env/config/state files are present
- webhook secret is loaded
- GitHub token is available
- local gateway TCP reachability
- signed local webhook probe against `/plugins/openclawcode/github`
- saved repo binding for the configured repository
- GitHub webhook event subscription, when `OPENCLAWCODE_GITHUB_HOOK_ID` is set
- current `trycloudflare` tunnel status, when the helper is in use

Useful flags:

```bash
./scripts/openclawcode-setup-check.sh --strict
./scripts/openclawcode-setup-check.sh --skip-route-probe
./scripts/openclawcode-setup-check.sh --probe-built-startup
./scripts/openclawcode-setup-check.sh --json
```

Use `--strict` when you want warnings to fail the check.
Use `--skip-route-probe` only during partial setup work when the local route is
intentionally unavailable.

Additional operator notes:

- if your default shell `node` is older than the CLI startup floor, run the
  health check with:
  - `OPENCLAWCODE_SETUP_NODE_BIN=/path/to/node>=22.16.0 ./scripts/openclawcode-setup-check.sh --strict`
- the setup check now bounds direct CLI probes such as `models list --json` to
  avoid hanging forever on a broken host
- when the configured Node runtime is already below the CLI startup floor, the
  setup check now reports that failure and skips the model-inventory probe
  instead of trying to run the built CLI with a known-bad runtime
- `--probe-built-startup` now runs a bounded isolated startup proof for the
  bundled built `openclawcode` plugin:
  - it synthesizes a temporary config with:
    - `channels = {}`
    - `bindings = []`
    - `plugins.allow = ["openclawcode"]`
    - `plugins.slots.memory = "none"`
  - it then runs `dist/index.js gateway run` on a non-default proof port and
    waits for a real listener line instead of trusting a dry static check
- if the long-lived gateway is intentionally down or restarting and you only
  want the isolated startup proof, combine:
  - `--skip-route-probe --probe-built-startup`
  - otherwise `--strict` will still fail on the live route probe even if the
    isolated built startup proof succeeds
- use `--json` when another script, CI job, or external operator host needs a
  machine-readable readiness report instead of human-readable shell lines

The JSON output now also includes:

- `modelInventory.available`
- `modelInventory.keys`
- `modelInventory.configuredFallbacks`
- `modelInventory.missingConfiguredFallbacks`
- `modelInventory.fallbackReady`
- `readiness.basic`
- `readiness.strict`
- `readiness.lowRiskProofReady`
- `readiness.fallbackProofReady`
- `readiness.promotionReady`
- `readiness.gatewayReachable`
- `readiness.routeProbeReady`
- `readiness.routeProbeSkipped`
- `readiness.builtStartupProofRequested`
- `readiness.builtStartupProofReady`
- `readiness.nextAction`

New rollout distinction:

- if `readiness.builtStartupProofReady = true` but
  `readiness.gatewayReachable = false`, the built entrypoint is healthy and the
  next repair is to start or restart the long-lived live gateway
- that case now reports
  `readiness.nextAction = "start-or-restart-live-gateway"`
  instead of the older generic `fix-failing-checks`

Fresh-root note:

- `openclawcode-setup-check.sh` derives
  `openclawcode.env`, `openclaw.json`, and
  `plugins/openclawcode/chatops-state.json` from `OPENCLAWCODE_OPERATOR_ROOT`
  unless you explicitly override the individual file paths

## 9. Promotion Checklist For Refreshed Sync Branches

Use this checklist before promoting a refreshed sync branch back to the
long-lived `main` operator baseline.

1. Build the refreshed branch and run:

```bash
pnpm build
./scripts/openclawcode-setup-check.sh --strict
./scripts/openclawcode-setup-check.sh --strict --probe-built-startup --json
```

2. Confirm the local Node runtime satisfies the CLI startup floor recorded in
   `dist/cli-startup-metadata.json`.
   On this workstation the refreshed branch currently reports:
   - required floor: `22.16.0`
   - current local runtime: `22.16.0`
   - expected strict result: pass once the target host is also using a Node
     runtime at or above that floor

3. Keep the long-lived `main` operator on the pre-promotion baseline until the
   refreshed branch passes `setup-check --strict` on the host that will run it.

4. Run at least one low-risk real proof on the refreshed branch before
   promotion:
   - webhook intake still reaches chat
   - one issue completes through PR publication and merge or a deliberate
     escalation
   - `/occode-inbox` and `/occode-status` reflect the new branch behavior

5. Promote only after the refreshed branch has both:
   - passing focused tests plus `pnpm build`
   - a passing isolated built-startup proof from setup-check
   - a passing real operator proof on the same runtime floor that will run `main`

6. After promotion to `main`, restart the long-lived gateway and rerun:

```bash
./scripts/openclawcode-setup-check.sh --strict
```

7. If the promoted operator misbehaves, roll back immediately:
   - switch the working tree back to the last known-good `main` commit
   - rebuild with `pnpm build`
   - restart the gateway on that known-good commit
   - rerun `./scripts/openclawcode-setup-check.sh --strict`

## 10. Copied-Root Teardown After Fresh Validation

When you validate a copied or temporary operator root, treat it as disposable.

After the proof completes:

- stop the temporary gateway or tunnel processes tied to that copied root
- delete or archive the copied `OPENCLAWCODE_OPERATOR_ROOT` instead of reusing
  it as the new long-lived baseline
- remove temporary tunnel pid/log files that were only meant for the copied
  root proof
- keep the canonical long-lived operator state in `~/.openclaw` until a
  deliberate promotion step says otherwise

The copied-root proof is there to reduce promotion risk, not to replace the
long-lived operator root by accident.

- `openclawcode-webhook-tunnel.sh` also derives its default env file from the
  same root, so one exported variable is enough for both scripts

## 9. First Live Validation

After the health check passes:

1. redeliver or create a real GitHub issue event
2. confirm the webhook receives `202`
3. verify the chat receives the approval prompt or auto-start notification
4. run `/occode-start <owner>/<repo>#<issue>` if the repo is in approve mode
5. confirm `/occode-inbox` shows the issue moving through queued or running state

You can also validate the explicit chat-side intake path directly from the
bound conversation:

```text
/occode-intake
[Feature]: Small low-risk issue title
Detailed issue body...
```

That should create the GitHub issue, queue low-risk work immediately, and still
precheck obviously high-risk text into an `escalated` snapshot.

For lighter-weight intake, a single request line is now enough too:

```text
/occode-intake
Expose stageRecordCount in openclaw code run --json output
```

That path synthesizes a minimal issue body automatically before creating the
GitHub issue.

You can also validate the operator-facing validation inventory from the same
conversation:

```text
/occode-inbox
/occode-status <owner>/<repo>#66
```

That should show the open validation pool directly in chat and annotate issue
`#66` as a `command-layer` / `command-json-number` validation issue.

At that point the supported setup is complete.
The next validation target should be a real `pull_request` or `pull_request_review`
event replay against the same route.

## 10. Current Known-Good Local State

The long-lived local operator on this workstation has already been proven
against `zhyongrui/openclawcode` with:

- operator root `~/.openclaw`
- one bound Feishu conversation for repo notifications and command handling
- webhook route `/plugins/openclawcode/github`
- strict health check passing with:
  - `./scripts/openclawcode-setup-check.sh --strict`
  - `19 pass / 0 warn / 0 fail`

Live operator proofs on that setup now include:

- GitHub issue webhook intake reaching Feishu with an approval prompt
- `/occode-start zhyongrui/openclawcode#65` completing through build, test,
  PR publication, verification, merge, and issue closure
- `/occode-start zhyongrui/openclawcode#68` completing through the same merged
  path from the bound Feishu conversation
- one-line `/occode-intake` creating a real GitHub issue and synthesizing the
  minimal issue body automatically before queueing work

If you are reusing the same local operator root, do not re-bootstrap the repo
binding from scratch unless you intentionally want to replace the saved chat
target. A single `/occode-bind <owner>/<repo>` from the desired Feishu
conversation is enough to retarget notifications safely.

## 11. Live Testing Notes

The recent full-loop proofs exposed a few operator rules that are worth keeping
in the runbook instead of rediscovering them in chat:

- after rebuilding the repo, restart the long-lived gateway before trusting
  chat-visible changes; the validation-pool summary rollout only appeared in
  `/occode-inbox` after the gateway was restarted onto the new build
- `HTTP 400: Internal server error` during build is currently a provider-side
  failure mode, not a chat-intake formatting bug
- when those provider failures repeat, use `/occode-rerun <owner>/<repo>#<issue>`
  after the pause window clears; the workflow now preserves a stage-specific
  failed artifact so reruns target the real failed run
- if a low-risk refreshed-branch proof keeps failing with the same compact
  provider diagnostic line, you can run a bounded fallback proof by exporting
  `OPENCLAWCODE_MODEL_FALLBACKS=provider/model,provider/model` before
  restarting the gateway or running a direct `openclaw code run ...` workflow
- `openclawcode-setup-check.sh` now inspects `models list --json`, so it can
  tell you whether the host actually exposes more than one discoverable model
  before you attempt that fallback proof
- when `OPENCLAWCODE_MODEL_FALLBACKS` is set, setup-check now fails if any
  requested fallback model is not discoverable on the current host
- unset `OPENCLAWCODE_MODEL_FALLBACKS` after that proof window if you want to
  return the long-lived operator to its normal single-primary configuration
- `/occode-status` and `/occode-inbox` now keep recent provider-failure
  context on the affected issue even after the active pause clears:
  - active windows render as `active pause until ...`
  - recovered windows render as `pause cleared after ...`
  - that distinction is useful during rerun decisions because it shows whether
    the system is still paused or has already resumed queue drain
- `/occode-rerun` now reuses that same distinction in its queued reply:
  - active pauses are rendered inline in the rerun confirmation
  - cleared pauses are rendered as a recovery probe, which makes it obvious
    that the rerun is testing whether the provider has recovered
- one-line `/occode-intake` is now the fastest safe smoke test for the bound
  Feishu path because it exercises:
  - chat command parsing
  - GitHub issue creation
  - minimal body synthesis
  - queue handoff

## 12. Keep The Validation Pool Seeded

Do not wait for a human to create a perfect low-risk issue when the validation
pool runs dry. The preferred replenishment path is the repo-local CLI:

```bash
openclaw code seed-validation-issue --template command-json-boolean --field-name verificationHasMissingCoverage --source-path verificationReport.missingCoverage
openclaw code seed-validation-issue --template operator-doc-note --doc-path docs/openclawcode/mvp-runbook.md --summary "copied-root teardown expectations after fresh-operator validation"
openclaw code list-validation-issues --json
```

Operator rules:

- keep at least one low-risk command-layer issue and one low-risk docs/operator
  issue open for future live proofs
- use `--dry-run --json` first if you want to review the title and body before
  creating the issue on GitHub
- use `openclaw code list-validation-issues` before and after a live proof to
  see whether the pool needs replenishment
- use this command instead of ad hoc GitHub API calls when the pool is empty
- repeated seeding of the same template/title now reuses the existing open issue
  instead of creating a duplicate
- reseed the pool immediately after a live proof consumes the last issue in one
  category

Staged fs-tool validation note:

- default live behavior still denies the runner-added `edit` and `write` tools
- when validating the deterministic sandbox edit path, export
  `OPENCLAWCODE_ENABLE_FS_TOOLS=edit` before restarting the gateway or running a
  direct `openclaw code run ...` workflow
- only use `OPENCLAWCODE_ENABLE_FS_TOOLS=edit,write` when you explicitly want a
  broader fs-tool replay
- unset the variable after the validation window if you want to return to the
  conservative default

Operator caveat for live review replay:

- the author of a GitHub pull request cannot submit `Request changes` on their
  own PR
- to validate the `changes requested` path, use a second reviewer account or a
  collaborator account
- if you do not want to merge the PR, validating `closed without merge` is a
  safer real-world `pull_request` lifecycle check than merging a nontrivial PR

More live-proof notes worth carrying into new sessions:

- the long-lived real operator root is `~/.openclaw`
- the long-lived real chat surface is one Feishu conversation bound to
  `zhyongrui/openclawcode`
- after changing chat-visible plugin behavior, restart the long-lived gateway
  before trusting `/occode-inbox`, `/occode-status`, or `/occode-rerun`
- refreshed-branch issue-worktree reruns now use lightweight bootstrap context:
  - the earlier oversized `AGENTS.md` truncation warning is gone in live
    `#87` reruns
  - if a rerun still fails with `HTTP 400: Internal server error` after that,
    treat it as the current provider-resilience blocker rather than a
    bootstrap file-injection bug
- the long-lived real operator config currently uses `agents.defaults` without
  an `agents.list`, so issue-worktree skill-filter overrides need to upsert a
  temporary agent entry if you want them to apply live
- after that upsert path landed, live `#87` reruns slimmed further:
  - `systemPromptReport.systemPrompt.chars` dropped to `8629`
  - `systemPromptReport.skills.promptChars` dropped to `1245`
  - the live session now keeps only `coding-agent` plus the four core coding
    tools
- the long-lived `~/.openclaw` operator currently exposes only one
  discoverable model through `models list --json`:
  - `crs/gpt-5.4`
  - fallback override support is now in code, but another discoverable model
    still needs to exist before a real fallback proof can succeed on that host
- one heavier openclawcode suite run on refreshed branches can still time out
  under parallel pressure; the stable proof command remains:
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1`
- bounded workflow timeout knobs are now available for issue-worktree runs:
  - `OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS=<positive-integer>`
  - `OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS=<positive-integer>`
  - defaults are `300` seconds for builder and `180` seconds for verifier
  - use these when a provider or model needs tighter or looser bounds than the
    generic host agent timeout during live proofs
- after promoting `sync/upstream-2026-03-13` back to `main`, this host exposed
  a narrower operator-only regression:
  - `node dist/index.js gateway run --bind loopback --port 18789` printed
    plugin initialization logs but did not bind `127.0.0.1:18789`
  - direct `tsx`-driven `openclaw code run ...` proofs on `main` still worked,
    so workflow validation could continue while gateway startup was isolated
- the old `systemd` unit on this host is not the canonical repo-local baseline:
  - `openclaw-gateway.service` still points at a global install under
    `~/.npm-global/lib/node_modules/openclaw/dist/index.js`
  - use the repo-local build and operator root under `~/.openclaw` when
    debugging `openclawcode` rollout behavior
