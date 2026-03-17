# Single-Login Bootstrap Proposal

## Goal

Reduce fresh-host setup to one GitHub login plus one repo choice.

Target operator experience:

```bash
openclaw onboard
openclaw code bootstrap --repo owner/repo
```

After that, the system should handle the rest:

- reuse or obtain GitHub authorization
- verify repo and webhook permissions
- generate and store a webhook secret
- create or reuse the GitHub webhook
- clone or attach the target repository
- write the bundled `openclawcode` repo config into operator state
- choose a safe first-run mode
- run setup-check and report exact next actions

The user should not need to hand-edit:

- `GH_TOKEN`
- `OPENCLAWCODE_GITHUB_WEBHOOK_SECRET`
- `OPENCLAWCODE_GITHUB_HOOK_ID`
- `openclaw.json`
- plugin state files such as `chatops-state.json`

## Why This Is Needed

The current operator flow still asks the user to assemble too many pieces by
hand:

- token and webhook env values in `~/.openclaw/openclawcode.env`
- bundled plugin repo config inside `openclaw.json`
- manual webhook creation plus manual webhook id capture
- manual choice of CLI-only versus ChatOps bootstrap
- manual repo binding after chat is connected

That is workable for an expert operator, but it is not the right product
surface for a fresh machine or a new repo.

## Current Reality

The repo now includes a first bootstrap command:

```bash
openclaw code bootstrap --repo owner/repo
```

The implemented MVP already does these pieces automatically:

- clone or attach the target repo
- persist `GH_TOKEN`, repo key, and a generated webhook secret into
  `~/.openclaw/openclawcode.env`
- materialize the bundled plugin repo entry inside `openclaw.json`
- persist a bootstrap repo binding in `chatops-state.json`
- seed `PROJECT-BLUEPRINT.md`, role-routing, discovery, and stage-gate artifacts
- try to start the local gateway
- run strict setup-check plus built-startup proof by default
- emit a machine-readable bootstrap summary through `--json`

What is still manual or only partially automated:

- `docs/openclawcode/operator-setup.md`
  - explicit `OPENCLAWCODE_GITHUB_HOOK_ID`
- provider credentials still come from the surrounding OpenClaw/operator login
- `scripts/openclawcode-webhook-tunnel.sh`
  - rewrites an existing webhook
  - does not create the webhook for the operator
- runtime repo binding
  - `/occode-bind` exists and works
  - bootstrap can seed a placeholder or explicit binding, but cannot yet
    discover the active chat target on its own

So the desired experience is now partially productized as one command, but it
still stops short of the full single-login end state.

## Product Split

### OpenClaw Responsibilities

`openclaw` should own the platform-level bootstrap primitives:

- GitHub login and token refresh
- secure credential storage
- secret generation and storage
- doctor/onboard checks
- optional channel login and session discovery

### OpenClawCode Responsibilities

`openclawcode` should own repository-specific bootstrap:

- repo inspection and clone/attach
- repo-level operator config materialization
- webhook create or reuse policy
- initial binding defaults
- setup-check and first-run readiness
- deciding whether the first proof should be CLI-only or ChatOps

## Target User Flow

On a fresh machine, the near-zero-touch path should look like this:

1. Codex installs the repo and builds it.
2. The user completes one GitHub login.
3. The user names the target repo.
4. `openclaw code bootstrap --repo owner/repo` does the rest.

If chat is already connected, the bootstrap command should also offer:

- detect the active chat conversation
- set a bootstrap notify target automatically
- suggest or perform `/occode-bind`

If chat is not connected yet, bootstrap should stop at:

- CLI-only ready
- webhook ready when permissions exist
- exact next command to connect chat later

## Minimum User Actions On A Fresh Host

The product target should be to reduce user work to these decisions only:

1. sign in to GitHub once
2. choose `owner/repo`
3. choose:
   - `--mode cli-only`
   - `--mode chatops`
   - or let bootstrap auto-decide
4. if ChatOps is desired, approve the first chat binding in the real
   conversation

Everything else should be automatic.

## Target Command Surface

### GitHub Login

Preferred:

```bash
openclaw onboard
```

Acceptable if login is split out:

```bash
openclaw auth github login
```

### Repo Bootstrap

```bash
openclaw code bootstrap --repo owner/repo
```

Recommended optional flags:

```bash
openclaw code bootstrap \
  --repo owner/repo \
  --repo-root ~/pros/owner-repo \
  --mode auto \
  --channel feishu \
  --chat-target auto
```

### Machine-Readable Output

Bootstrap should support:

```bash
openclaw code bootstrap --repo owner/repo --json
```

And report:

- credential source
- repo clone/attach result
- webhook mode:
  - created
  - reused
  - skipped
- operator config path
- repo config path
- setup-check summary
- next action

## Bootstrap State Machine

1. `collect-auth`
   - reuse existing GitHub login if present
   - otherwise trigger GitHub login
2. `inspect-repo`
   - verify repo exists
   - verify repo permissions
   - detect empty repo versus existing project
3. `materialize-config`
   - write operator env values
   - write bundled plugin repo entry
   - choose initial trigger mode and merge policy
4. `configure-ingress`
   - create or reuse webhook
   - record secret and hook metadata
5. `prepare-workspace`
   - clone repo if absent
   - attach existing checkout if already present
6. `verify`
   - run strict setup-check
   - run built-startup proof when appropriate
7. `handoff`
   - print the exact next command
   - or start in CLI-only / ChatOps mode immediately

## Safe Defaults

The first bootstrap should prefer safety over autonomy:

- `triggerMode = approve`
- `mergeOnApprove = false`
- first proof = one narrow CLI-only or chat-started low-risk run
- only promote to auto webhook mode after one successful proof

## Simplest Practical Path Today

With the current bootstrap MVP, the lowest-touch real workflow is:

1. Codex clones and builds `zhyongrui/openclawcode`.
2. The user provides one GitHub token.
3. Codex runs:
   - `openclaw code bootstrap --repo owner/repo --json`
4. If chat is already connected, the user sends one bind or verification
   command from the real conversation.

That is the shortest currently achievable path before webhook creation and chat
target discovery are automated too.

## MVP Delivery Plan

### Phase 1: CLI-Only Bootstrap

Status: shipped as MVP.

Delivered:

- repo clone/attach
- repo config materialization
- operator env persistence
- placeholder or explicit repo binding persistence
- strict setup-check and built-startup proof
- `--json` output
- blueprint + role-routing + discovery + stage-gate seeding

Still missing inside this phase:

- GitHub login handoff from `openclaw onboard`
- zero-touch provider credential reuse

### Phase 2: Webhook Bootstrap

Ship:

- webhook secret generation
- GitHub webhook create or reuse
- event reconciliation
- tunnel-helper integration without manual hook id entry

### Phase 3: Chat-Aware Bootstrap

Ship:

- channel detection
- suggested or automatic bootstrap notify target
- repo binding handoff
- first-proof recommendation based on available chat state

## Definition Of Done

This proposal is complete when a fresh machine can reach first proof with only:

- one GitHub login
- one repo choice
- optional one-time chat approval

And without any user editing of raw operator config files or secret env files.
