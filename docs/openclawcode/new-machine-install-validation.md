# OpenClawCode New-Machine Install Validation

Use this document when you want a real cold-start proof on a new machine, not
just a best-effort install.

This runbook is stricter than `new-machine-install.md`:

- it assumes the machine starts with no trusted OpenClawCode state
- it prefers repo-local commands over any global CLI install
- it defines explicit pass/fail checkpoints
- it tells you what evidence to capture before calling the host usable

Important repository constraint:

- clone `zhyongrui/openclawcode`
- do not look for a separate standalone `openclawcode` repository or package

`openclawcode` currently lives inside this OpenClaw fork.

## Success Definition

Call the install test successful only when all of the following are true:

1. the repo clones cleanly on the new machine
2. `pnpm install` and `pnpm build` both succeed
3. bootstrap completes for a real target repository
4. strict setup-check passes
5. one narrow validation path succeeds:
   - CLI-only, or
   - ChatOps bind plus one read command

Do not treat "the process started" as success.

## Inputs You Need Before Starting

- a fresh machine or a shell environment that can simulate one
- `git`
- `Node >= 22.16.0`
- `pnpm`
- host GitHub auth, preferably through `gh auth login`
- a real target repository in `<owner>/<repo>` form

Optional:

- `cloudflared`, if bootstrap should auto-start a temporary public tunnel
- chat platform credentials, if you want ChatOps proof on this machine

## Phase 0: Keep The Test Clean

On a literally new machine, you can usually skip extra cleanup. If you are
reusing a host, isolate the operator state first so old bindings do not pollute
the result:

```bash
export OPENCLAW_STATE_DIR="$HOME/.openclaw-new-machine-test"
mkdir -p "$OPENCLAW_STATE_DIR"
```

If you want a fully disposable workspace, also choose a new checkout path:

```bash
mkdir -p ~/pros
```

## Phase 1: Verify Host Prerequisites

Record the exact tool versions before cloning:

```bash
git --version
node --version
pnpm --version
```

The repo-local CLI expects a supported Node runtime. If `node --version` is
below `22.16.0`, stop and fix the machine first.

## Phase 2: Clone The Correct Repository

```bash
git clone https://github.com/zhyongrui/openclawcode.git ~/pros/openclawcode
cd ~/pros/openclawcode
git rev-parse HEAD
```

Sanity-check that the checkout is the right one:

```bash
test -f scripts/openclawcode-setup-check.sh
test -f docs/openclawcode/new-machine-install.md
test -f docs/openclawcode/operator-setup.md
```

If any of those files are missing, stop. The wrong repository was cloned.

## Phase 3: Install Dependencies And Build

Use repo-local commands only:

```bash
pnpm install
pnpm build
```

Then confirm the built entrypoints exist:

```bash
test -f dist/entry.js
test -f dist/index.js
```

This is the first real pass/fail gate. If `pnpm build` fails, the machine is
not ready.

## Phase 4: Establish GitHub Auth

Preferred on a real operator host:

```bash
gh auth login
gh auth status
```

If this validation is exercising the chat-native onboarding path, it is also
valid to let OpenClaw/OpenClaw Code drive the host-side device flow first and
then verify the resulting host auth with `gh auth status`.

Fallback only when interactive `gh` auth is unavailable:

```bash
export GH_TOKEN=your_token_here
```

or:

```bash
export GITHUB_TOKEN=your_token_here
```

Treat `GH_TOKEN` / `GITHUB_TOKEN` as compatibility fallback, not the preferred
operator path.

Minimum practical capability for the first end-to-end proof:

- repository read/write
- issue read/write
- pull request read/write
- webhook admin if bootstrap should manage the GitHub webhook

## Phase 5: Bootstrap A Real Target Repository

Prefer the repo-local CLI through `pnpm exec` so the test does not depend on a
global install:

```bash
pnpm exec openclaw code bootstrap --repo <owner>/<repo> --json
```

If you already know the public webhook URL, use the explicit form:

```bash
pnpm exec openclaw code bootstrap \
  --repo <owner>/<repo> \
  --webhook-url https://example.trycloudflare.com \
  --json
```

If you want bootstrap to skip managed tunnel startup:

```bash
pnpm exec openclaw code bootstrap \
  --repo <owner>/<repo> \
  --no-start-tunnel \
  --json
```

What you want to see from bootstrap:

- target repo clone or attach succeeds
- operator env/config is materialized
- blueprint, routing, discovery, and stage-gate artifacts are seeded
- bootstrap emits readiness booleans in JSON
- bootstrap prints exact handoff commands for the next proof step

Do not move on until the bootstrap JSON is saved somewhere you can inspect
later.

## Phase 6: Run Strict Health Checks

After bootstrap, run the repo-local proof script directly:

```bash
./scripts/openclawcode-setup-check.sh --strict --json
```

If you also want the built-startup proof:

```bash
./scripts/openclawcode-setup-check.sh --strict --probe-built-startup --json
```

The healthy path should confirm:

- gateway reachable
- route probe ready
- binding or repo mapping is present when expected
- built startup proof passes when requested

## Phase 7: Choose One Narrow Validation Path

Do not start with full unattended webhook automation on a brand-new machine.
First prove one small path manually.

### Path A: CLI-Only Validation

Use this when you want the fastest cold-start proof:

```bash
pnpm exec openclaw code blueprint-init \
  --repo-root <absolute-path-to-target-repo> \
  --title "Project Blueprint" \
  --goal "Describe the target goal"
```

Then run one real issue:

```bash
pnpm exec openclaw code run \
  --issue 123 \
  --owner <owner> \
  --repo <repo> \
  --repo-root <absolute-path-to-target-repo>
```

Healthy first outcomes:

- `ready-for-human-review`
- `completed-without-changes`
- or a clearly explained `escalated`

### Path B: ChatOps Validation

Use this only if the machine already has the required chat credentials:

```bash
pnpm exec openclaw code bootstrap \
  --repo <owner>/<repo> \
  --mode chatops \
  --channel feishu \
  --chat-target auto \
  --json
```

Then, from the real chat destination:

```text
/occode-bind <owner>/<repo>
/occode-status <owner>/<repo>#<issue>
```

This is enough for the first chat-side proof. You do not need to begin with a
full autonomous run.

## Evidence To Capture

Before you call the machine ready, save:

- `node --version`
- `pnpm --version`
- `git rev-parse HEAD` for the installed checkout
- bootstrap JSON output
- strict setup-check JSON output
- built-startup proof JSON output, if you ran it
- the exact command or chat message used for the narrow proof
- the final status from that proof

If the machine fails later, this is the minimum evidence set you will want.

## Common Failure Signatures

- wrong repository cloned
- Node version too old for the repo-local CLI
- `pnpm build` failed, so `dist/entry.js` or `dist/index.js` is missing
- GitHub auth lacks repo, issue, PR, or webhook permissions
- bootstrap could not obtain a public webhook URL
- ChatOps was connected, but `/occode-bind` never ran against the repo
- stale operator state from an older install polluted the test

## Recommended Minimal Transcript

This is the shortest sane cold-start sequence:

```bash
export OPENCLAW_STATE_DIR="$HOME/.openclaw-new-machine-test"
mkdir -p "$OPENCLAW_STATE_DIR"
git clone https://github.com/zhyongrui/openclawcode.git ~/pros/openclawcode
cd ~/pros/openclawcode
node --version
pnpm --version
pnpm install
pnpm build
gh auth login
pnpm exec openclaw code bootstrap --repo <owner>/<repo> --json
./scripts/openclawcode-setup-check.sh --strict --json
```

Only after that should you run one narrow CLI or ChatOps proof.
