# OpenClaw Plugin Integration

## Purpose

`openclawcode` remains the main repository.
The OpenClaw adapter also lives in this repository, but it stays as a thin
integration layer instead of becoming a second workflow core.

This is intentionally not a third repository, and it should not depend on
upstream `openclaw` accepting custom product logic.

## What The Existing OpenClaw Code Already Gives Us

After reading the current codebase, the important seams are already present:

- plugin HTTP routes:
  - `src/plugins/types.ts`
  - `src/gateway/server/plugins-http.ts`
- plugin startup services:
  - `src/plugins/types.ts`
  - `src/plugins/services.ts`
- plugin commands that bypass the LLM:
  - `src/plugins/commands.ts`
  - `src/auto-reply/reply/commands-plugin.ts`
- plugin subagent runtime for controlled agent execution:
  - `src/gateway/server-plugins.ts`
  - `src/plugins/runtime/types.ts`
- system events / heartbeat wakeups:
  - `src/plugins/runtime/runtime-system.ts`

This means the desired product loop does not require broad `openclaw` core
rewrites.

## Recommended Boundary

- `src/openclawcode/`: workflow core, orchestrator, persistence, policy, worktree
- `src/integrations/openclaw-plugin/`: OpenClaw-facing adapter code

That boundary keeps product rules in one place while allowing chat-driven
operation from the forked OpenClaw runtime.

## Minimal-Core-Change Architecture

The recommended implementation path is:

1. GitHub sends an issue webhook to a plugin HTTP route
2. the plugin validates repo/action/labels and creates a pending approval item
3. the plugin notifies the user in the configured chat channel
4. the user replies with an explicit command such as:
   - `/occode-start owner/repo#123`
   - `/occode-skip owner/repo#123`
   - `/occode-status owner/repo#123`
5. the plugin converts `/occode-start` into an `openclawcode` run request
6. the workflow core executes the issue run in an isolated worktree
7. the plugin posts status back to chat:
   - started
   - changes requested
   - ready for review
   - merged
   - failed

This deliberately avoids the first version depending on per-channel interactive
buttons. Plain commands are more portable across Telegram, Discord, Slack,
Signal, WhatsApp, and future channels.

## Why This Matches The Product Goal

The user-facing product stays the same:

- GitHub issue appears
- user gets a chat notification
- user decides whether to start now
- `openclawcode` implements the issue
- tests run
- PR is opened
- review/verifier runs
- merge happens under policy
- chat gets the final notification

The only adjustment is implementation strategy:

- `openclawcode` remains the execution engine
- the OpenClaw plugin provides the webhook, command, notification, and approval shell

## What Lives In The Plugin Adapter

- GitHub webhook ingress
- repo-to-chat routing config
- pending approval records
- plugin commands for approve / skip / status
- queue or background service for long-running execution
- chat notification formatting

## What Does Not Live In The Plugin Adapter

- issue planning policy
- build / verify domain model
- merge policy
- worktree orchestration logic
- PR drafting rules
- issue-to-stage state machine

Those stay in `src/openclawcode/`.

## First Concrete Adapter Slice

The first adapter slice should be small and deterministic:

1. define repo config for one repository
2. accept GitHub `issues` webhooks for:
   - `opened`
   - `reopened`
   - `labeled`
3. filter by trigger labels and skip labels
4. send a plain-text approval prompt into chat
5. accept `/occode-start`, `/occode-skip`, and `/occode-status`
6. translate `/occode-start` into a stable workflow launch request

This is enough to prove the complete chat approval loop without committing yet
to channel-specific button UIs.

## Suggested Config Shape

The adapter config should stay plugin-scoped and repo-scoped.

Example direction:

```json5
{
  plugins: {
    entries: {
      openclawcode: {
        enabled: true,
        github: {
          webhookSecretEnv: "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET",
        },
        repos: [
          {
            owner: "zhyongrui",
            repo: "openclawcode",
            repoRoot: "/home/zyr/pros/openclawcode",
            baseBranch: "main",
            triggerMode: "approve",
            notifyChannel: "telegram",
            notifyTarget: "chat:123456",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
            triggerLabels: ["openclawcode:auto"],
            skipLabels: ["openclawcode:manual-only"],
            openPullRequest: true,
            mergeOnApprove: true,
          },
        ],
      },
    },
  },
}
```

`triggerMode` currently supports:

- `approve`
  - webhook notifies chat and waits for `/occode-start`
- `auto`
  - webhook immediately queues the issue run and sends a status notification

## Implemented So Far

The repository now includes:

- `src/integrations/openclaw-plugin/chatops.ts`
  - webhook intake decisions
  - chat command parsing
  - run-request shaping
  - run-command argv generation
  - workflow JSON extraction
  - status-message formatting
- `extensions/openclawcode/index.ts`
  - bundled plugin entrypoint
  - GitHub issue webhook route at `/plugins/openclawcode/github`
  - `/occode-start`, `/occode-status`, `/occode-skip`
  - sequential background runner service
- `extensions/openclawcode/openclaw.plugin.json`
  - plugin config schema for repo mappings

This is still an early slice, but it is now runtime-facing code instead of
only a design note.

## Planned Next Modules

These modules are the right first landing points:

- `src/integrations/openclaw-plugin/chatops.ts`
  - webhook intake decisions
  - chat command parsing
  - run-request shaping
  - status-message formatting
- `src/integrations/openclaw-plugin/store.ts`
  - future pending approvals / queue records
- `src/integrations/openclaw-plugin/github-webhook.ts`
  - future signature verification and route handler

The bundled extension now persists queue and status state on disk.

Current behavior:

- pending approvals survive gateway restarts
- queued runs survive gateway restarts
- current in-flight runs are recovered back to the queue on restart
- latest per-issue status survives restart
- latest per-issue workflow metadata also survives restart:
  - run id
  - stage
  - updated time
  - branch name
  - PR number / URL when known
- startup reconciles missing status entries from local `.openclawcode/runs`
  records for each configured repository
- `/occode-status` can fall back to the latest local workflow run record even if
  the plugin state file does not have that issue yet

`/occode-start` now promotes a persisted pending approval into the durable run
queue through an atomic store transition, and `/occode-skip` can cancel either
a pending approval or a queued run.

The next hardening step is GitHub-side reconciliation against those persisted
snapshots, so state can also heal when issue or PR state changes externally
from the local process.

The first GitHub-side reconciliation slice is now implemented:

- `/occode-status` uses the persisted PR number from the latest issue snapshot
- if GitHub reports that PR as merged, the plugin heals the local issue status
  to `merged` immediately

This keeps the first remote sync path demand-driven and cheap while still
fixing the most important stale-status case: a human merges the PR outside the
local workflow process.

The bundled extension now also has direct plugin-behavior tests in:

- `extensions/openclawcode/index.test.ts`

Those tests cover real registered route/command behavior for the first webhook
and chat-command flows.

## Release Model

The release model should be:

1. maintain `openclawcode` as the primary product repository
2. keep the OpenClaw adapter in this same repository
3. keep any OpenClaw-side shim as thin as possible
4. sync upstream OpenClaw changes into this repository with a controlled cadence

If a later phase needs packaging separation, this adapter can move into a
subpackage without creating a third repository.
