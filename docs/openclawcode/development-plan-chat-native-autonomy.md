# Development Plan: Chat-Native Autonomous Engineering

This is the execution companion to
`chat-native-autonomous-engineering.md`.

It turns the product direction into a near-term implementation sequence that
can be consumed in slices.

## Objective

Move `openclawcode` from:

- issue-driven execution with blueprint scaffolding

to:

- a blueprint-driven, chat-supervised, multi-agent engineering loop that can
  keep advancing a repository toward its agreed target.

## Near-Term Milestones

### Milestone 1: Empty-Repo Blueprint Bootstrap

Problem:

- empty repos currently need a placeholder test command to survive bootstrap

Outcome:

- bootstrap handles empty repos as a first-class blueprint-first case

Tasks:

- detect empty repo state during bootstrap
- stop requiring inferred test commands for empty repos
- persist an explicit empty-repo / blueprint-first signal in bootstrap output
- update onboarding handoff text for new repos
- add tests for empty repo bootstrap behavior

Exit signal:

- a new repo can be onboarded and bootstrapped without fake test commands

Status:

- landed on 2026-03-19 across bootstrap and chat-native onboarding

### Milestone 2: Blueprint-Driven Next-Work Selection

Problem:

- the system can execute a chosen issue, but not yet sustain forward motion

Outcome:

- the system can select the next work item from blueprint-backed state

Tasks:

- inspect blueprint, work-items, discovery, and gates together
- define "next actionable work item" selection rules
- distinguish:
  - ready to execute
  - blocked on human
  - blocked on missing clarification
  - blocked on policy
- expose the decision in machine-readable output

Exit signal:

- the system can explain why a specific next work item was chosen or why it
  cannot continue

Status:

- landed on 2026-03-19 through `openclaw code next-work-show`,
  `.openclawcode/next-work.json`, and `/occode-next`

### Milestone 3: Issue Materialization From Work Items

Problem:

- work items and GitHub issues are not yet treated as separate layers

Outcome:

- blueprint-backed work items can become execution issues when needed

Tasks:

- define when a work item needs a GitHub issue
- add issue materialization rules
- avoid duplicate issue creation
- persist the link between work item id and GitHub issue id

Exit signal:

- the system can create or reuse the correct issue for the selected work item

Status:

- landed on 2026-03-20 through
  `openclaw code issue-materialize`,
  `openclaw code issue-materialization-show`,
  `.openclawcode/issue-materialization.json`,
  and `/occode-materialize`

### Milestone 4: Role-Based Agent Routing

Problem:

- Codex and Claude Code are not yet fully formalized as first-class role
  backends

Outcome:

- planner / coder / reviewer / verifier become normal configurable roles

Tasks:

- lock the role contracts
- define per-role backend configuration
- persist which role used which backend
- support safe reroute and rerun behavior
- document role routing for operators

Exit signal:

- one real workflow run can use different backends for different roles while
  remaining fully auditable

Status:

- partially landed on 2026-03-20 by extending role-routing artifacts and
  workflow snapshots with runtime/reroute capability, resolved backend, and
  resolved agent audit fields

### Milestone 5: Chat-Native Project Progress

Problem:

- current status surfaces are stronger at run reporting than project reporting

Outcome:

- chat surfaces show blueprint-aware project progress

Tasks:

- expose active workstream summary
- expose current blueprint status and revision
- expose active issue and assigned role backends
- expose blockers and next steps

Exit signal:

- a user in chat can understand where the project stands without opening the
  repo or reading raw artifacts

Status:

- partially landed on 2026-03-20 through
  `openclaw code project-progress-show`,
  `.openclawcode/project-progress.json`,
  and `/occode-progress`
- active-run context was deepened later the same day so progress/autopilot now
  also expose:
  - active workstream summary
  - current run stage
  - current run branch / PR
  - resolved role-route summary

### Milestone 6: Autonomous Progress Loop

Problem:

- the system still depends on a human to keep handing it work

Outcome:

- the system can keep going until it hits a real gate

Tasks:

- add a loop that:
  - reads blueprint-backed state
  - chooses next work
  - creates or selects the issue
  - executes
  - updates artifacts
  - repeats
- stop automatically on any unresolved gate
- surface loop status in chat and machine-readable artifacts

Exit signal:

- the operator can leave the system running and return to meaningful progress
  or a precise blocked state

Status:

- first loop-control slice landed on 2026-03-20 through
  `openclaw code autonomous-loop-run --once`,
  `openclaw code autonomous-loop-show`,
  `.openclawcode/autonomous-loop.json`,
  and `/occode-autopilot`

### Milestone 7: Proactive Chat Setup Kickoff

Problem:

- installing `openclawcode` already signals intent to use it, but the operator
  still had to know to send `/occode-setup` before GitHub auth could even
  begin

Outcome:

- the plugin proactively opens the full setup chain when it already knows a
  concrete notification target:
  - push pairing first when DM pairing is still required
  - then push GitHub device auth automatically after pairing approval

Tasks:

- inspect configured repo notification targets on plugin service start
- skip targets that already have a saved setup session
- skip proactive kickoff when host GitHub auth is already ready
- when DM pairing is required for that chat target, issue the pairing challenge
  proactively instead of waiting for `/occode-setup`
- after pairing approval, launch one host-side `gh auth login --web` flow and
  push the verification URL plus device code into the configured chat target
- when exactly one repo maps to that target, pre-pin the repo so setup can
  continue through repo validation and bootstrap after auth completes

Exit signal:

- a newly installed operator sees either:
  - a pairing code when chat approval is still required
  - or the GitHub login URL and code when pairing is already satisfied
- neither step requires guessing that `/occode-setup` must be sent first

Status:

- initial proactive auth kickoff landed on 2026-03-21
- proactive pairing-before-auth landed on 2026-03-22 in the plugin service
  startup path and the chat setup onboarding flow

## Validation Strategy

Each milestone should include:

- focused unit or command tests
- machine-readable output assertions where relevant
- at least one updated operator-facing doc
- a dev-log entry with exact validation commands

Live proofs should be added when the milestone changes real operator behavior.

## Guardrails

The plan must preserve:

- explicit human gates around risky work
- auditable GitHub-backed execution units
- deterministic reruns and artifact history
- role-specific boundaries between planning, coding, review, and verification

## Recommendation

Milestones 1, 2, and 3 are now complete.

The next implementation slice should deepen Milestones 4, 5, and 6:

- role-routing proof and operator docs
- richer project-progress reporting during active runs
- promoting the single-iteration loop into a repeatable supervised autopilot
  - first bounded repeat-loop slice is now landed:
    - `openclaw code autonomous-loop-run --iterations <n>`
    - `/occode-autopilot repeat [count]`
    - repeat-loop artifacts now record iteration history and stop cleanly when
      a queued/current run or another legal blocker is encountered

## Setup Track Addendum

The chat-native setup track now has a concrete operator-facing foundation:

- GitHub device auth can start from chat
- chat can validate an existing repo, create a new repo, or start a
  blueprint-first `new-project` flow
- chat can draft and agree the initial blueprint before repo creation
- repo-name suggestions are derived from the agreed blueprint draft
- chat can run bootstrap, sync the setup draft into the real
  `PROJECT-BLUEPRINT.md`, refresh work items and stage gates, and surface the
  first follow-up command
- chat and CLI can now explain the next blueprint-backed work item through
  `/occode-next` and `openclaw code next-work-show`
- chat and CLI can now create or reuse the GitHub issue for that selected work
  item through `/occode-materialize` and `openclaw code issue-materialize`
- chat and CLI can now persist a blueprint-aware progress summary through
  `/occode-progress` and `openclaw code project-progress-show`
- chat and CLI now expose a supervised autopilot surface through
  `/occode-autopilot` and `openclaw code autonomous-loop-run`
  - one-shot mode remains available through `--once` and `/occode-autopilot once`
  - bounded repeat mode is now available through
    `--iterations <n>` and `/occode-autopilot repeat [count]`
- bootstrap can auto-bind the active chat when safe
- setup sessions now have cancel/retry controls and persisted failure context

The remaining setup-specific hardening sequence should be:

1. live-proof the full `new-project` flow on a real chat + GitHub operator host
2. live-proof the new recovery messaging for expired auth, repo-create
   failures, bootstrap failures, and blueprint-sync failures
3. plugin activation visibility/readiness hardening is now landed for
   chat-native setup
   - bootstrap remains the single writer of:
     - `plugins.allow += ["openclawcode"]`
     - `plugins.entries.openclawcode.enabled = true`
   - bootstrap output, chat setup summaries, and setup-check readiness now all
     surface plugin activation explicitly
   - setup-check now reports an explicit `repair-plugin-activation` next action
     when slash-command routing is not actually ready
4. proactive GitHub auth completion feedback is now landed for chat-native setup
   - while a setup session is in `awaiting-github-device-auth`, the plugin
     service now polls the saved device-auth session in the background
   - browser approval success/failure now pushes the next setup status back to
     the originating chat automatically
   - `/occode-setup-status` remains as a manual recovery/status command, not
     the only way to continue
5. proactive pairing-before-auth is now landed for chat-native setup
   - service-start setup kickoff no longer assumes an unpaired DM can jump
     straight to GitHub auth
   - pairing-gated `user:*` targets now receive a pairing code first
   - once pairing is approved, the background setup loop automatically starts
     GitHub auth without waiting for `/occode-setup`
6. live-proof the bounded repeat-loop behavior on the real operator host and
   decide whether it is ready for longer unattended runs

This setup track remains the operator-surface prerequisite for the later
autonomous loop milestones, because it turns onboarding from a CLI-heavy
handoff into a real chat-native control plane.
