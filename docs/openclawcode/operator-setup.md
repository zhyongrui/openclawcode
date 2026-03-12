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
node dist/index.js gateway run --bind loopback --port 18789
```

If you use a service wrapper or local launcher script, keep these rules:

- source `~/.openclaw/openclawcode.env` before the gateway starts
- restart the gateway after changing `openclaw.json`
- keep the plugin route on the same local port that the tunnel helper targets

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

- `/occode-unbind` removes the saved repo-to-chat binding
- `/occode-inbox` shows pending approvals, queue state, and recent lifecycle activity
- `/occode-status <owner>/<repo>#<issue>` shows the latest tracked status for one issue

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
```

Use `--strict` when you want warnings to fail the check.
Use `--skip-route-probe` only during partial setup work when the local route is
intentionally unavailable.

Fresh-root note:

- `openclawcode-setup-check.sh` derives
  `openclawcode.env`, `openclaw.json`, and
  `plugins/openclawcode/chatops-state.json` from `OPENCLAWCODE_OPERATOR_ROOT`
  unless you explicitly override the individual file paths
- `openclawcode-webhook-tunnel.sh` also derives its default env file from the
  same root, so one exported variable is enough for both scripts

## 9. First Live Validation

After the health check passes:

1. redeliver or create a real GitHub issue event
2. confirm the webhook receives `202`
3. verify the chat receives the approval prompt or auto-start notification
4. run `/occode-start <owner>/<repo>#<issue>` if the repo is in approve mode
5. confirm `/occode-inbox` shows the issue moving through queued or running state

At that point the supported setup is complete.
The next validation target should be a real `pull_request` or `pull_request_review`
event replay against the same route.

## 10. Keep The Validation Pool Seeded

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
