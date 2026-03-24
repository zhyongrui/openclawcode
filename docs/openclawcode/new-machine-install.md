# OpenClawCode New-Machine Install

This is the shortest practical setup path for bringing `openclawcode` onto a
fresh machine and using it against a real target repository.

Use this when you want a direct operator runbook, not the broader product or
roadmap docs.

Important constraint:

- install `zhyongrui/openclawcode`
- do not look for a separate standalone `openclawcode` package repository

`openclawcode` currently lives inside this OpenClaw fork.

## What You Need

Before you start, make sure the machine has:

- `git`
- `Node >= 22.16.0`
- `pnpm`
- host GitHub auth, preferably through `gh auth login`

Optional, depending on how you want to operate:

- `cloudflared`, if you want bootstrap to auto-start a temporary public webhook
  tunnel
- chat platform credentials, if you want ChatOps instead of CLI-only runs

## 1. Clone The Correct Repository

```bash
git clone https://github.com/zhyongrui/openclawcode.git ~/pros/openclawcode
cd ~/pros/openclawcode
```

Sanity-check that this is the correct checkout:

```bash
test -f scripts/openclawcode-setup-check.sh
test -f docs/openclawcode/operator-setup.md
```

If either file is missing, stop. You cloned the wrong repository.

## 2. Install Dependencies And Build

```bash
pnpm install
pnpm build
```

The current operator path assumes the built CLI exists at:

```text
dist/index.js
```

## 3. Establish GitHub Auth

Preferred:

```bash
gh auth login
gh auth status
```

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

Minimum practical capability for the first full repo flow:

- issue read/write
- pull request read/write
- webhook admin if bootstrap should create or update the GitHub webhook

## 4. Run Bootstrap For The Target Repository

For the shortest first proof, use the CLI-oriented bootstrap:

```bash
openclaw code bootstrap --repo <owner>/<repo> --json
```

What this bootstrap already handles on a healthy host:

- clone or attach the target repo
- materialize operator env and bundled plugin config
- seed repo-local blueprint, discovery, routing, and stage-gate artifacts
- attempt gateway startup
- run strict setup-check and built-startup proof
- emit machine-readable readiness booleans
- emit exact handoff commands for the next step

If bootstrap needs a public webhook URL and `cloudflared` is available, it can
now try to start the managed tunnel automatically.

If you already know the public ingress URL, prefer the explicit form:

```bash
openclaw code bootstrap \
  --repo <owner>/<repo> \
  --webhook-url https://example.trycloudflare.com \
  --json
```

If you want bootstrap to skip managed tunnel startup:

```bash
openclaw code bootstrap \
  --repo <owner>/<repo> \
  --no-start-tunnel \
  --json
```

## 5. Choose Your First Validation Path

Do not start with unattended webhook auto-mode on a brand-new machine. First
prove one narrow path manually.

### Path A: CLI-only

Use this when you want the fastest proof that the host works:

```bash
openclaw code blueprint-init \
  --title "Project Blueprint" \
  --goal "Describe the target goal"

openclaw code run \
  --issue 123 \
  --owner <owner> \
  --repo <repo> \
  --repo-root <absolute-path-to-target-repo>
```

Expected outcomes for a healthy first proof:

- `ready-for-human-review`
- `completed-without-changes`
- or a clearly explained `escalated`

### Path B: ChatOps

Use this when the machine already has the desired chat surface credentials:

```bash
openclaw code bootstrap \
  --repo <owner>/<repo> \
  --mode chatops \
  --channel feishu \
  --chat-target auto \
  --json
```

Then, from the real conversation that should receive workflow updates:

```text
/occode-bind <owner>/<repo>
```

Typical follow-up commands:

```text
/occode-intake
/occode-start <owner>/<repo>#<issue>
/occode-status <owner>/<repo>#<issue>
/occode-inbox
```

Use `--chat-target <target>` instead of `auto` when you already know the exact
destination and do not want bootstrap to infer it.

## 6. Run The Health Check

After bootstrap, rerun the local health check explicitly:

```bash
./scripts/openclawcode-setup-check.sh --strict --json
```

If you also want the isolated built-startup proof:

```bash
./scripts/openclawcode-setup-check.sh --strict --probe-built-startup --json
```

Useful signals to confirm before trusting the machine:

- gateway is reachable
- webhook route probe succeeds
- repo binding or repo mapping exists
- built startup proof succeeds
- the target repo can reach a narrow low-risk run outcome

## Common Failures

- wrong repository cloned
- Node runtime below `22.16.0`
- `pnpm build` never completed, so `dist/index.js` is missing
- GitHub token lacks repo or webhook permissions
- bootstrap cannot obtain a public webhook URL
- the chat surface is connected, but the repo was never bound with
  `/occode-bind`

## Recommended Minimal Session Transcript

On a fresh machine, this is the smallest sane sequence:

```bash
git clone https://github.com/zhyongrui/openclawcode.git ~/pros/openclawcode
cd ~/pros/openclawcode
pnpm install
pnpm build
gh auth login
openclaw code bootstrap --repo <owner>/<repo> --json
./scripts/openclawcode-setup-check.sh --strict --json
```

Then choose one:

- CLI-only: run one narrow `openclaw code run`
- ChatOps: bind the repo in chat, then run one narrow issue

## Related Docs

- `docs/openclawcode/README.md`
- `docs/openclawcode/fresh-host-install.md`
- `docs/openclawcode/codex-openclawcode-install.md`
- `docs/openclawcode/operator-setup.md`
- `docs/openclawcode/sample-operator-config.md`
