# OpenClaw Capability Mapping And Blueprint-First Build Plan

## Purpose

This document answers two questions in one place:

1. which existing `openclaw` capabilities already support the intended
   blueprint-first autonomous development product
2. what still needs to be built, in what order, until that product is usable

It is the practical bridge between:

- the current `openclaw` substrate
- the current `openclawcode` issue-driven execution layer
- the intended blueprint-first, multi-agent, human-interruptible development
  system

## Product Goal

The target product should support this loop:

1. a user describes a project goal in chat
2. the system asks clarifying questions and proposes refinements
3. the agreed target is written into a fixed blueprint document
4. the system derives or discovers work items from that blueprint
5. the system chooses Codex, Claude Code, or both by execution role
6. the system implements, tests, opens a PR, reacts to review, and merges
   under policy
7. a human can intervene at every stage, but the system continues
   autonomously when the human does not intervene

## What OpenClaw Already Gives Us

The `openclaw` repository already provides a large part of the lower layers
that this product needs.

### 1. Multi-Channel Goal Intake

Already available:

- channel integrations for:
  - WhatsApp
  - Telegram
  - Slack
  - Discord
  - Google Chat
  - Signal
  - iMessage and BlueBubbles
  - IRC
  - Microsoft Teams
  - Matrix
  - Feishu
  - LINE
  - Mattermost
  - Nextcloud Talk
  - Nostr
  - Synology Chat
  - Tlon
  - Twitch
  - Zalo
  - WebChat
- message send/read/manage CLI
- channel-bound chat delivery and reply-back

Relevant code:

- `extensions/*`
- `src/channels/*`
- `src/cli/program/register.message.ts`

Why this matters:

- the blueprint discussion loop can start on existing chat surfaces
- the system does not need a new custom front end before it can start shaping
  user goals

### 2. Gateway Control Plane

Already available:

- a local gateway with a large method surface for:
  - chat
  - send
  - status
  - models
  - agents
  - sessions
  - cron
  - tools
  - config
  - approvals
  - browser
  - node invocation
  - wizard and doctor flows

Relevant code:

- `src/gateway/*`
- `src/gateway/server-methods-list.ts`

Why this matters:

- the blueprint-first product does not need a new RPC/control plane
- stage transitions, human handoff, and status surfaces can ride the existing
  gateway

### 3. Sessions And Multi-Agent Isolation

Already available:

- isolated agents
- agent workspaces
- agent auth profiles
- agent bindings to channels and accounts
- session inspection and mutation

Relevant code:

- `src/agents/*`
- `src/cli/program/register.agent.ts`
- `src/sessions/*`

Why this matters:

- blueprint discussion can stay isolated from coding execution
- planner, coder, reviewer, and verifier roles can be mapped onto distinct
  agent identities or runtime configs

### 4. Plugin And Extension Platform

Already available:

- plugin discovery
- bundle manifests
- plugin runtime API
- plugin HTTP routes
- plugin config schemas
- plugin-safe runtime wrappers for config, media, tools, channel, logging,
  events, and subagents

Relevant code:

- `src/plugins/discovery.ts`
- `src/plugins/runtime/index.ts`
- `src/plugin-sdk/index.ts`

Why this matters:

- Codex, Claude Code, or other execution backends can be integrated through
  the existing extension mechanism
- new orchestration layers do not need to be hard-coded into the core forever

### 5. Models, Providers, Auth, And Fallback Primitives

Already available:

- model inventory
- provider auth plumbing
- provider selection
- runtime auth helpers
- fallback chains and provider diagnostics

Relevant code:

- `src/providers/*`
- `src/agents/model-auth.ts`
- `src/openclawcode/runtime/agent-runner.ts`

Why this matters:

- the desired Codex/Claude mixed-mode system does not need a brand-new model
  stack
- what is missing is role-level orchestration, not raw provider connectivity

### 6. Automation Inputs

Already available:

- cron
- webhooks
- health checks
- logs
- doctor flows
- setup-check style diagnostics
- channel and gateway lifecycle signals

Relevant code:

- `src/cron/*`
- `src/hooks/*`
- `src/gateway/server-cron.ts`
- `src/gateway/server-maintenance.ts`
- `scripts/openclawcode-setup-check.sh`

Why this matters:

- these are enough to seed the first general discovery pipeline
- the product can discover problems from real signals instead of only waiting
  for manual issue creation

### 7. Rich Local Action Surface

Already available:

- browser control
- canvas and A2UI
- node pairing
- node invocation
- camera
- screen recording
- notifications
- voice wake and talk mode

Relevant code:

- `src/browser/*`
- `src/canvas-host/*`
- `src/node-host/*`
- `src/gateway/server-methods/nodes.ts`

Why this matters:

- the product can later expose human handoff, approvals, and review state
  through richer interfaces without rebuilding the runtime

### 8. Existing Coding Execution Layer

Already available in `openclawcode`:

- issue-driven planning
- isolated worktrees
- builder and verifier execution
- PR publication
- rerun and review handling
- merge policy
- operator chat surfaces
- validation-pool upkeep

Relevant code:

- `src/openclawcode/*`
- `extensions/openclawcode/*`

Why this matters:

- the blueprint-first system does not need a new coding engine
- it should reuse the existing issue-driven workflow as the execution layer

## What The Current Stack Does Not Yet Give Us

The missing work is mostly above the substrate layer.

### 1. Goal Discussion As A First-Class Stage

Missing:

- a dedicated conversation stage before issue creation
- structured clarification requests
- structured proactive suggestions
- a durable transcript or artifact for that agreement process

Current status:

- partial foothold via `openclaw code blueprint-clarify`
- blueprint summaries now expose revision ids, defaulted sections, provider
  role assignments, and workstream/open-question counts
- still no chat-native discussion loop that updates the blueprint directly

### 2. Blueprint-Centered Source Of Truth

Missing:

- automatic repo bootstrap around the blueprint
- stronger guarantees that issue creation and discovery are anchored back to
  the blueprint
- machine-readable blueprint state beyond simple lifecycle inspection

Current status:

- `PROJECT-BLUEPRINT.md` exists
- lifecycle statuses exist
- explicit `agreed` checkpoint exists
- repo-local work-item decomposition now exists through
  `.openclawcode/work-items.json`
- workflow runs now snapshot blueprint, routing, and stage-gate state too

### 3. Work Item Decomposition

Missing:

- first internal `work item` abstraction broader than GitHub issues
- blueprint-to-work-item planning
- work-item projection into GitHub issues
- support for planned, discovered, docs, sync, and policy work items

Current status:

- first repo-local `work item` abstraction has landed
- `openclaw code blueprint-decompose` now derives planned work items from the
  `Workstreams` section
- each work item already includes a GitHub issue draft projection
- discovered work items and incremental re-decomposition still need to be built

### 4. General Discovery Pipeline

Missing:

- evidence collection across test, provider, setup, docs, and sync signals
- dedupe and prioritization
- work-item generation from those signals

Current status:

- only validation-pool seeding is proactive today
- the first repo-local non-validation discovery artifact now exists for:
  - missing work-item artifacts
  - stale work-item artifacts
  - unresolved blueprint open questions

### 5. Provider-Neutral Role Routing

Missing:

- explicit roles:
  - planner
  - coder
  - reviewer
  - verifier
  - doc-writer
- mapping from those roles to Codex, Claude Code, or mixed mode
- fallback policy by role instead of only by model string

Current status:

- the first repo-local provider-neutral role plan now exists
- Codex and Claude Code both normalize into shared adapter ids
- mixed-mode routing visibility exists before live run integration
- role decisions still do not flow into runtime run artifacts yet

### 6. Stage-Level Human Handoff

Current status:

- the first repo-local stage-gate artifact now exists
- explicit human decisions can now be persisted as durable gate records
- the current gate ids are:
  - `goal-agreement`
  - `work-item-projection`
  - `execution-routing`
  - `execution-start`
  - `merge-promotion`
- the current decisions are:
  - `approved`
  - `changes-requested`
  - `blocked`
- the remaining gap is runtime and chat integration rather than durable state

Missing:

- pause/edit/resume at each major stage
- manual worktree takeover
- provider switching mid-run
- runtime steering from durable gate decisions

## Reuse Strategy

The right strategy is not to replace `openclaw` or replace `openclawcode`.

The right strategy is:

1. keep `openclaw` as the substrate
2. keep `openclawcode` as the execution engine
3. add a blueprint-first orchestration layer above the existing issue-driven
   workflow

That means:

- reuse channel, session, plugin, model, and automation plumbing
- reuse the existing coding workflow for implementation runs
- build only the missing upstream control-plane layers

## Complete Detailed Build Plan

The remaining delivery plan should be executed in the following order.

### Phase M1: Blueprint Source Of Truth

Status:

- `[x]` fixed blueprint path
- `[x]` initial schema
- `[x]` explicit `agreed` checkpoint
- `[x]` richer machine-readable blueprint state
- `[x]` blueprint state propagation into downstream work items and runs

Tasks:

- `[x]` fix the canonical blueprint path at `PROJECT-BLUEPRINT.md`
- `[x]` define lifecycle states
- `[x]` add CLI commands to create, inspect, and update blueprint lifecycle
- `[x]` add a stable machine-readable blueprint contract
- `[x]` persist blueprint fingerprints or content hashes
- `[x]` persist blueprint revision metadata into work items and workflow runs
- `[x]` add validation for incomplete or contradictory blueprint states

Acceptance:

- every repo has one canonical blueprint file
- every downstream execution unit can point back to the blueprint revision
  that produced it

### Phase M2: Goal Discussion Loop

Status:

- `[x]` repo-local clarification reporting exists
- `[x]` chat-native discussion loop
- `[x]` write-back from discussion into blueprint sections
- `[x]` final confirmation before work decomposition

Tasks:

- `[x]` add deterministic clarification questions from the blueprint scaffold
- `[x]` add deterministic proactive suggestions from the blueprint scaffold
- `[x]` add a chat-facing discussion command or flow before issue creation
- `[x]` let the system update blueprint sections from accepted clarifications
- `[x]` support explicit user confirmation that the blueprint is now agreed
- `[x]` keep an auditable history of clarifications that changed the blueprint

Acceptance:

- the user can stay in chat while shaping the goal
- the system can ask questions instead of guessing
- the agreed result is written back into the blueprint

### Phase M3: Work Item Model

Status:

- `[x]` first repo-local work-item model landed
- `[x]` GitHub projection and richer classes landed for blueprint-backed work

Tasks:

- `[x]` define a first internal `work item` type independent from GitHub
- `[x]` support work-item classes:
  - feature
  - bugfix
  - docs
  - sync
  - validation
  - incident
- `[x]` store work items under repo-local state
- `[x]` give work items durable ids and statuses
- `[x]` map work items to GitHub issue drafts when external tracking is needed
- `[x]` map work items to live GitHub issues when external tracking is needed

Acceptance:

- the system no longer assumes GitHub issues already exist
- GitHub becomes one projection target, not the only internal object

### Phase M4: Blueprint To Work Item Decomposition

Status:

- `[x]` first planned work-item decomposition landed
- `[x]` incremental decomposition landed
- `[x]` broader discovered decomposition landed

Tasks:

- `[x]` derive workstreams from `PROJECT-BLUEPRINT.md`
- `[x]` generate work items from each workstream
- `[x]` classify initial blueprint-derived items as planned
- `[x]` support decomposition of:
  - feature slices
  - docs slices
  - rollout work
  - validation work
  - sync work
- `[x]` support incremental decomposition when the blueprint changes

Acceptance:

- a newly agreed blueprint can produce an initial backlog without manual issue
  authoring
- discovery evidence can now also be synchronized back into the same
  repo-local backlog artifact instead of living only in a parallel discovery
  file

### Phase M5: Discovery Pipeline

Status:

- `[x]` validation-only discovery exists
- `[x]` first repo-local discovery source landed
- `[x]` broader runtime discovery landed

Tasks:

- `[x]` define discovery evidence records
- `[x]` add the first non-validation discovery source
- `[x]` start with one or more of:
  - failing tests
  - setup-check regressions
  - provider pause incidents
  - upstream sync failures
  - docs drift
- `[x]` add dedupe keys
- `[x]` add severity and priority scoring
- `[x]` turn evidence into draft work items
- `[x]` prevent noisy duplicate issue creation

Acceptance:

- the system can notice important problems without a human typing a new issue
- runtime discovery now also includes tracked operator failure/review-blocked
  snapshots, not only static artifact drift and setup state

### Phase M6: Provider Role Model

Status:

- `[x]` model access exists
- `[x]` first repo-local role-routing plan landed
- `[x]` first runtime artifact integration landed
- `[x]` per-stage runtime steering landed

Tasks:

- `[x]` define first-class roles:
  - planner
  - coder
  - reviewer
  - verifier
  - doc-writer
- `[x]` define a provider-neutral adapter contract for each role
- `[x]` implement Codex role adapters
- `[x]` implement Claude Code role adapters
- `[x]` support mixed-mode routing by stage
- `[x]` support fallback by role
- `[x]` persist selected role/provider decisions into run artifacts

Acceptance:

- one run can use different providers for different stages without changing
  the top-level orchestration model

### Phase M7: Stage-Level Human Handoff

Status:

- `[x]` coarse run controls already exist
- `[x]` first repo-local stage-gate artifact landed
- `[x]` first workflow-run stage-gate snapshot landed
- `[x]` explicit plan approval before code execution landed
- `[x]` explicit plan editing before code execution landed
- `[x]` runtime-aware handoff landed

Tasks:

- `[x]` persist gate decisions in a repo-local artifact
- `[x]` expose stage-gate readiness and blockers through CLI
- `[x]` persist current stage-gate snapshots into workflow run artifacts
- `[x]` allow structured rerun-time coder/verifier overrides from chat and CLI
- `[x]` allow plan approval before code execution
- `[x]` allow plan editing before code execution
- `[x]` allow manual worktree takeover
- `[x]` allow provider switching after a failed or paused stage
- `[x]` allow structured resume after manual edits
- `[x]` allow explicit override of suitability and merge-policy decisions
- `[x]` persist all handoff and override decisions in workflow run artifacts

Acceptance:

- a human can intervene at any important stage without breaking continuity
- current foothold:
  - a failed or review-blocked run can now be re-queued with an explicit
    coder/verifier override and keep that override in the rerun artifact
  - `openclaw code reroute-run` now mirrors the chat reroute surface for:
    - queued runs before execution starts
    - active runs through deferred reroute records
    - failed or paused tracked snapshots, including `awaiting-plan-approval`
  - `openclaw code run --require-plan-approval` can now stop after planning,
    emit a stable plan digest, and only continue when the matching digest is
    explicitly approved
  - `openclaw code run --plan-edit-file <path>` can now apply a repo-local
    execution-spec patch before code execution, persist edit audit metadata,
    and regenerate the approval digest from the edited plan
  - workflow runs and operator snapshots now also persist a unified handoff
    ledger for:
    - stage-gate decisions
    - suitability overrides
    - rerun requests
    - runtime reroutes
    - stage-level runtime steering
    - manual takeover / manual resume context
  - run status and `/occode-status` now surface structured runtime-routing
    summaries alongside the handoff ledger, so operator handoffs stay legible
    after the run leaves the CLI

### Phase M8: Chatops Integration

Status:

- `[x]` issue-driven chatops exists
- `[x]` first blueprint-first status slice has landed
- `[x]` first chat-side handoff action has landed
- `[x]` blueprint-first chatops complete

Tasks:

- `[x]` expose blueprint discussion in existing chat surfaces
- `[x]` expose blueprint status in operator status views
- `[x]` expose work-item backlog in chat
- `[x]` expose stage gates and pending approvals in chat
- `[x]` expose provider-role decisions in chat
- `[x]` expose stage-gate approval recording in chat
- `[x]` let approved execution-start gates unblock chat-started execution
- `[x]` hold autonomous intake paths behind execution-start when human signoff is still required
- `[x]` expose first handoff and automatic execution-start resume actions in chat
- `[x]` expose first provider-role reroute controls in chat and CLI
- `[x]` carry coder/verifier runtime routing selections into workflow artifacts
- `[x]` expose repo-local runtime steering in chat
- `[x]` let chat operators set or clear per-stage runtime steering without leaving chat

Acceptance:

- the user can run the blueprint-first loop from chat, not only from local CLI

### Phase M9: Proofs And Operationalization

Status:

- `[x]` docs and repo-local proof contracts landed
- `[x]` live blueprint-first operator proofs landed

Tasks:

- `[x]` run one blueprint-first proof on the refreshed sync branch
- `[x]` run one blueprint-first proof on the long-lived baseline
- `[x]` document install, promotion, and rollback for blueprint-aware releases
- `[x]` define machine-readable promotion and rollback artifacts
- `[x]` document supported provider combinations and limits
- `[x]` document when humans should intervene

Acceptance:

- another operator can stand the system up from docs and repeat a full
  blueprint-first flow

## Immediate Next Slices

The next concrete slices should be:

1. live-proof the chat-native setup path on a real operator host after the new
   plugin-activation and auth-completion hardening
2. close the remaining runtime-steering and handoff persistence gaps in
   Phases M6 and M7
3. run the first blueprint-first end-to-end proof on the refreshed sync branch
4. repeat the same proof on the long-lived baseline

## Short Summary

OpenClaw already provides most of the substrate:

- channels
- gateway
- sessions
- plugins
- models
- automation
- device and browser surfaces

OpenClawCode already provides the coding execution layer:

- issue-driven runs
- worktrees
- builder and verifier
- PR and rerun lifecycle

The major remaining work is the missing upstream control plane:

- blueprint-first goal discussion
- blueprint-centered state
- work-item decomposition
- discovery
- provider-role routing
- stage-level human handoff

Recent repo-local closures that now reduce that gap:

- explicit policy and guardrail snapshot via `openclaw code policy-show --json`
- documented support matrix, release runbook, troubleshooting, and fresh-host install path
- repo-local suitability override flow and machine-readable build guardrails
