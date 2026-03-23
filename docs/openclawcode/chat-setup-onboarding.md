# Chat-Driven OpenClawCode Setup

## Goal

Let an operator finish the first `openclawcode` setup steps from chat after
`openclaw` itself is already installed and connected to a real conversation
surface such as Feishu.

The first user-visible milestone is:

1. OpenClaw identifies a concrete setup chat target
2. if that target is a configured concrete DM such as `user:<open_id>`, setup
   is trusted for that chat and does not stop on DM pairing first
3. OpenClaw checks whether GitHub auth is already ready on the host
4. if auth is missing, OpenClaw starts the host-side GitHub device flow
5. OpenClaw sends the verification URL and one-time code back into chat
6. the operator completes approval in the browser
7. OpenClaw resumes setup from chat without asking the operator to paste a
   token into chat

That target can come from either:

- the operator sending `/occode-setup`
- the plugin service starting with a configured repo notification target and no
  saved setup session yet
- a preferred operator DM target that OpenClaw previously learned from the chat
  surface itself

## Why This Matters

The current low-touch bootstrap is already much better than manual setup, but
the operator still has to leave chat, think in terms of local shell commands,
and manually bridge the GitHub login step.

That is not the right long-term surface for a chat-native operator product.

If `openclaw` is already the runtime living in chat, then `openclawcode`
configuration should start there too.

## Product Contract

### What chat should own

- starting the setup session
- proactively starting the auth step when the target chat is already known
- showing the exact next human action
- remembering which chat is doing setup
- remembering whether GitHub auth is still pending or already ready
- guiding the handoff into repo selection and bootstrap

### What the host should own

- running the local GitHub authentication flow
- storing the resulting GitHub credential in the local `gh` auth store
- executing `openclaw code bootstrap`
- writing local operator state and repo state

## MVP Command Surface

### `/occode-setup new-project`

Start a blueprint-first setup draft for a brand-new project before creating
the repo.

Behavior:

- do not require GitHub auth yet
- persist a setup-local blueprint draft in the current chat session
- guide the operator to fill goal, MVP, scope, non-goals, and constraints
- hand off into repo-name choice only after blueprint agreement

### `/occode-setup existing owner/repo`

Select an existing GitHub repository for this chat-native setup session.

Behavior:

- if GitHub auth is missing:
  - remember the chosen existing repo
  - start the GitHub device flow
  - continue after browser approval
- if GitHub auth is ready:
  - validate that the repo is accessible with the current login
  - persist it as the selected repo for this chat
  - hand off into bootstrap

### `/occode-setup new repo-name`

Create a new GitHub repo for this setup session.

Behavior:

- if GitHub auth is missing:
  - remember the requested repo name
  - start the GitHub device flow
  - continue after browser approval
- if GitHub auth is ready:
  - resolve the authenticated GitHub owner
  - create the repo on the host through `gh repo create`
  - persist the created repo for this chat
  - hand off into bootstrap

### `/occode-setup [owner/repo]`

Starts or resumes setup for the current chat.

Behavior:

- treat plain `owner/repo` as the `existing` path for backward compatibility
- when no project selection is given, only handle the auth step
- when the plugin already knows one configured repo target for the chat, the
  same session can now start proactively on service start before the operator
  sends this command
- when that configured target is a Feishu pairing-gated DM, `/occode-setup`
  and the other setup recovery commands are still allowed through for that
  same configured operator DM instead of getting bounced back to pairing

### `/occode-setup-status`

Shows the current setup session for the current chat.

Behavior:

- if auth is still pending:
  - show the current device-flow URL and code again
  - tell the operator to finish approval in the browser
- if auth is now ready:
  - transition the session to authenticated
  - complete any pending existing-repo validation or new-repo creation
  - show the next repo/bootstrap action
- if no setup session exists:
  - explain how to start with `/occode-setup`

### Setup-aware blueprint commands

When the active setup session is a `new-project` draft, these commands operate
on the setup draft before any repo exists yet:

- `/occode-goal <goal text>`
- `/occode-blueprint-edit <section>` with a multiline body
- `/occode-blueprint-agree`
- `/occode-blueprint`

After agreement:

- `/occode-blueprint-agree` derives 3-5 repo-name suggestions
- `/occode-setup new <repo-name>` continues through auth, repo creation, and
  bootstrap

### Recovery controls

- `/occode-setup-cancel` discards the active setup session for the current chat
- `/occode-setup-retry` resumes or retries the active setup session

## Session Model

Persist one setup session per `(notifyChannel, notifyTarget)`.

Current setup state:

- `drafting-blueprint`
- `awaiting-repo-choice`
- `awaiting-chat-pairing`
- `awaiting-github-device-auth`
- `github-authenticated`
- `bootstrap-complete`

Persisted fields:

- `notifyChannel`
- `notifyTarget`
- `projectMode`
- `repoKey`
- `pendingRepoName`
- `stage`
- `githubAuthSource`
- `createdAt`
- `updatedAt`
- `blueprintDraft`
  - `status`
  - `agreedAt`
  - `repoNameSuggestions`
  - section content keyed by blueprint section
- `lastFailure`
  - `step`
  - `reason`
  - `occurredAt`
- `githubDeviceAuth`
  - `pid`
  - `logPath`
  - `userCode`
  - `verificationUri`
  - `startedAt`
  - `completedAt`
  - `failureReason`
- `bootstrap`
  - `repoRoot`
  - `checkoutAction`
  - `blueprintPath`
  - blueprint summary fields
  - work-item / gate counts
  - `nextAction`
  - `proofReadiness`
  - auto-bind status
  - handoff commands

This belongs in the existing ChatOps store so chat setup survives process
restart and uses the same durability model as approvals, reroutes, and intake
drafts.

## GitHub Auth Design

### Desired operator experience

The operator should not be told to manually open a terminal and run
`gh auth login`.

Instead:

1. OpenClaw starts the device flow on the host
2. OpenClaw extracts the GitHub verification URL and one-time code
3. OpenClaw sends both back into the active chat
4. the operator chooses the GitHub account in the browser
5. OpenClaw detects when host auth is now ready

### MVP implementation choice

The MVP should still use the host `gh` credential store as the source of truth,
because the existing onboarding code already detects readiness from:

- `GH_TOKEN`
- `GITHUB_TOKEN`
- `gh auth token`

For the first implementation, the practical requirement is:

- the host process launches `gh auth login --web`
- the plugin captures the emitted device-flow instructions
- the chat command replays those instructions safely

The operator never pastes tokens into chat.

## State Machine

1. `idle`
   - no setup session yet
2. `drafting-blueprint`
   - `new-project` goal discussion is active
   - the setup-local blueprint draft is still incomplete or not yet agreed
3. `awaiting-repo-choice`
   - the setup-local blueprint draft is agreed
   - repo-name suggestions are ready
   - repo creation can start after the operator chooses a name
4. `awaiting-chat-pairing`
   - the target chat is known
   - DM pairing is still required before setup can proceed
   - OpenClaw has already pushed the pairing code into that chat
5. `awaiting-github-device-auth`
   - GitHub auth not ready
   - device flow started on host
   - chat shows verification URL and code
6. `github-authenticated`
   - host auth is now ready
   - chat can validate an existing repo or create a new repo
   - chat can then move into bootstrap execution
7. `bootstrap-complete`
   - bootstrap JSON has been captured into setup state
   - chat can show the exact blueprint, work-item, gate, and proof handoff
     commands
   - chat can summarize the current blueprint goal, counts, clarification
     questions, auto-bind status, and next suggested command for the operator
   - chat can hand off into `/occode-next owner/repo` once the repo-local
     work-item artifact exists

Future states can extend this into:

- `bootstrap-blocked`
- `ready-for-intake`

## Security Rules

- do not ask the user to paste a GitHub token into chat
- prefer a private or direct chat for setup commands
- do not copy the device code into long-term docs or dev logs
- store only the minimum temporary session data needed for resume or poll
- clear temporary device-flow state after auth succeeds

## Current landed scope

The setup flow now covers the first end-to-end operator path:

1. start from chat with `/occode-setup`, `/occode-setup existing owner/repo`,
   `/occode-setup new-project`, or an automatic setup kickoff on service start
   when the plugin already has one concrete chat target
2. if needed, complete GitHub device auth without pasting tokens into chat
3. receive an automatic chat push after browser-side GitHub auth succeeds or
   fails, without relying on `/occode-setup-status` as the only continuation
4. for `new-project`, draft and agree the initial blueprint directly in chat
5. derive repo-name suggestions and continue with `/occode-setup new <repo>`
6. run bootstrap automatically after repo selection
7. sync the setup draft into the repo-local `PROJECT-BLUEPRINT.md`
8. refresh work items and stage gates
9. auto-bind the active chat when safe
10. surface plugin activation and chat-setup-routing readiness directly in the
   bootstrap summary and setup-check output
11. surface the next suggested command and proof readiness directly in chat
12. hand off into `/occode-materialize owner/repo` once the selected work item
    is ready for issue projection

## Remaining Delivery Tasks

The remaining setup-specific work is now hardening rather than missing basic
control-plane steps.

### 1. live operator proof

- run the full `new-project` path against a real chat surface and GitHub host
- capture exactly where the operator still has to leave chat

### 2. failure recovery polish

- `/occode-setup-retry` now replays the current setup session instead of
  forcing a fresh start
- setup failures now report the failed step, reason, and retry command in chat
- real operator proof is still needed for:
  - expired GitHub auth
  - repo-create failures on the host
  - bootstrap failures
  - blueprint-sync failures

### 3. plugin activation visibility and readiness

- this hardening is now landed
- local onboarding now also writes the default `openclawcode` plugin
  activation state so chat slash-command routing is available immediately after
  install/setup, not only after bootstrap
- remote-mode onboarding remains a handoff path and does not pretend to enable
  `openclawcode` on the remote host from the local client config
- bootstrap summaries, chat setup summaries, and setup-check now all surface:
  - whether `plugins.enabled` is on
  - whether `plugins.allow` includes `openclawcode`
  - whether `plugins.entries.openclawcode.enabled` is on
  - whether chat setup slash-command routing should actually be expected to
    work
- setup-check now emits an explicit `repair-plugin-activation` next action when
  `/occode-setup` would still be blocked by plugin activation state
- bootstrap and chat setup summaries now also show the concrete repair path for
  that state:
  - restart the host gateway with `openclaw gateway restart`
  - then retry setup progress from chat with `/occode-setup-status`
- this remains a visibility and proof-of-readiness fix, not a second
  auto-enable mechanism

### 4. proactive GitHub auth completion feedback

- this hardening is now landed
- the plugin service now polls saved setup sessions that are still in
  `awaiting-github-device-auth`
- the same setup-session sync path now runs in the background after browser
  approval completes
- when GitHub auth succeeds or fails, the originating chat receives the next
  setup message automatically
- `/occode-setup-status` and `/occode-setup-retry` remain available as manual
  recovery controls, but they are no longer the only way the operator can see
  progress
- in Feishu pairing mode, unauthorized slash-style setup messages such as
  `/occode-setup` now also trigger pairing guidance even before the command can
  be routed to the plugin, so the operator is told to approve pairing and then
  resend the same command instead of seeing silence

### 5. proactive GitHub auth kickoff

- this hardening is now landed
- when the plugin service starts without GitHub auth, it now inspects the
  configured repo notification targets
- the same runner loop now keeps re-checking configured targets after startup,
  so newly written operator config does not require a gateway restart before
  proactive setup can begin
- once a concrete target chat is configured, the service now starts one
  host-side `gh auth login --web` flow and pushes the verification URL plus
  device code to that chat immediately, even when the channel's DM policy is
  still `pairing`
- existing saved sessions that were already left in `awaiting-chat-pairing`
  are also promoted forward automatically on the next background loop instead
  of waiting for pairing approval forever
- when exactly one repo is mapped to that chat target, the saved setup session
  also pins that repo up front so setup can continue into repo validation and
  bootstrap automatically after auth completes
- if bootstrap still only has a `bind-pending:*` placeholder, but OpenClaw has
  already saved one preferred operator DM target for that channel, the plugin
  now resolves that placeholder through the saved target and starts setup there
- when multiple repos share the same target, the auth step still starts
  proactively, but repo selection stays explicit after auth so the system does
  not guess the wrong repository

### 6. handoff into autonomous progress

- `openclaw code next-work-show` now persists `.openclawcode/next-work.json`
  and explains:
  - ready to execute
  - blocked on human
  - blocked on missing clarification
  - blocked on policy
- `/occode-next owner/repo` now exposes the same decision in chat
- `openclaw code issue-materialize` now persists
  `.openclawcode/issue-materialization.json`
- `/occode-materialize owner/repo` now creates or reuses the GitHub issue for
  the selected work item and hands off into the existing gate/queue logic
- `openclaw code project-progress-show` and `/occode-progress owner/repo` now
  summarize blueprint status, selected work, issue state, routing, and queue
  context in one place
- `openclaw code autonomous-loop-run --once` and
  `/occode-autopilot once owner/repo` now provide the first supervised
  single-iteration autopilot slice
- `openclaw code autonomous-loop-run --iterations <n>` and
  `/occode-autopilot repeat [count] owner/repo` now provide the first bounded
  repeat-loop slice with iteration history and queue-aware stop conditions

### Recommended build order

1. live operator proof
2. live-proof the new failure recovery paths
3. live-proof the proactive auth-completion push and plugin-activation
   readiness on the real operator host
4. live-proof the bounded repeat-loop autopilot on the real operator host
