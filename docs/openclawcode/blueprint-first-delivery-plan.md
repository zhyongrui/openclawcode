# Blueprint-First Delivery Plan

## Purpose

This is the execution plan for moving `openclawcode` from an issue-first coding
operator to a blueprint-first autonomous development system.

It translates the gap analysis in `blueprint-first-orchestration.md` into
implementation phases that can be shipped, tested, and documented one slice at
a time.

For the lower-level mapping of existing `openclaw` capabilities onto those
phases, see `openclaw-capability-mapping.md`.

## Target End State

The finished system should support this loop:

1. a user describes a project goal
2. the system asks clarifying questions when needed
3. the agreed target is written into a fixed project blueprint document
4. the system derives or discovers work items from that blueprint
5. the execution layer chooses Codex, Claude Code, or both by role
6. humans can intervene at any major stage, but the system continues
   autonomously when they do not

## Delivery Phases

### Phase B1: Blueprint Foundation

Status: in progress and partially landed

Deliverables:

- fixed blueprint file path: `PROJECT-BLUEPRINT.md`
- stable blueprint lifecycle statuses:
  - `draft`
  - `clarified`
  - `agreed`
  - `active`
  - `superseded`
- repo-local CLI surface:
  - `openclaw code blueprint-init`
  - `openclaw code blueprint-show`
  - `openclaw code blueprint-set-status`
- machine-readable blueprint inspection through `--json`

Acceptance:

- a repo can create the blueprint scaffold without manual copy-paste
- operators can inspect the blueprint path and lifecycle state
- operators can record an explicit `agreed` checkpoint

### Phase B2: Goal Discussion Loop

Status: partially landed through repo-local and chat-native goal capture

Deliverables:

- chat or CLI-native goal intake before issue creation
- clarification prompts when the goal is underspecified
- proactive suggestions while the goal is still forming
- explicit confirmation that the blueprint is ready to become active

Acceptance:

- the system does not need a pre-written GitHub issue to start shaping work
- an ambiguous request can be clarified into a blueprint without manual docs
  editing

Current foothold:

- `openclaw code blueprint-clarify` now produces deterministic clarification
  questions and proactive suggestions from the current blueprint scaffold
- `openclaw code blueprint-show --json` now exposes revision and defaulted
  section metadata that downstream discussion surfaces can consume directly
- `openclaw code blueprint-set-section` now updates one blueprint section
  without opening `PROJECT-BLUEPRINT.md` manually
- `/occode-goal` now captures repo-level goals from chat before issue creation
- `/occode-blueprint-agree` now records the explicit agreed checkpoint from chat
- `/occode-blueprint-edit` now lets operators answer clarifications or update
  sections directly from chat
- ambiguous one-line `/occode-intake` now produces a pending draft with:
  - clarification prompts
  - `/occode-intake-edit`
  - `/occode-intake-confirm`
  - `/occode-intake-reject`

### Phase B3: Work Item Decomposition

Status: partially landed through repo-local decomposition and artifact
persistence

Deliverables:

- first internal work-item abstraction broader than GitHub issues
- blueprint-to-work-item decomposition
- support for planned work items and discovered work items
- projection from work items into GitHub issues when needed

Acceptance:

- the system can derive work items from the blueprint instead of assuming they
  already exist on GitHub

Current foothold:

- `openclaw code blueprint-decompose` now derives `.openclawcode/work-items.json`
- `openclaw code work-items-show --json` now reports persisted/stale work-item
  inventory state
- each planned work item already carries a GitHub issue draft projection

### Phase B4: Discovery Pipeline

Status: partially landed through repo-local blueprint/work-item discovery

Deliverables:

- first non-validation discovery source
- evidence capture and dedupe
- priority and severity scoring
- draft work-item creation from incidents or drift

Candidate inputs:

- failing tests
- setup-check regressions
- provider pauses
- upstream sync conflicts
- docs drift

Current foothold:

- `openclaw code discover-work-items` now persists the first non-validation
  discovery artifact
- discovery evidence currently covers:
  - missing work-item artifacts
  - stale work-item artifacts after blueprint changes
  - unresolved blueprint open questions
- each evidence record already includes:
  - a stable dedupe key
  - severity and priority
  - a discovered work-item draft

### Phase B5: Provider Role Routing

Status: partially landed through repo-local role-routing artifacts

Deliverables:

- provider-neutral role model:
  - planner
  - coder
  - reviewer
  - verifier
  - doc-writer
- adapters for Codex and Claude Code
- routing and fallback rules by role

Acceptance:

- one stage can use Codex while another uses Claude Code without changing the
  higher-level orchestration model

Current foothold:

- `openclaw code role-routing-refresh` now persists `.openclawcode/role-routing.json`
- `openclaw code role-routing-show --json` now exposes:
  - first-class planner/coder/reviewer/verifier/doc-writer roles
  - normalized Codex and Claude Code adapters
  - mixed-mode detection
  - unresolved-role blockers
  - fallback-chain visibility

### Phase B6: Stage-Level Human Handoff

Status: partially landed

Deliverables:

- plan approval or edit
- manual worktree takeover
- provider switch mid-run
- structured resume after manual edits
- explicit merge or promotion override flow

Acceptance:

- every major stage has a documented human intervention path
- autonomous execution can resume from that intervention without losing state

Current foothold:

- `openclaw code stage-gates-refresh` now persists `.openclawcode/stage-gates.json`
- `openclaw code stage-gates-show --json` now exposes:
  - five repo-local stage gates
  - gate readiness and blocker summaries
  - linked blueprint, work-item, discovery, and role-routing availability
- `openclaw code stage-gates-decide` now records durable human decisions for:
  - `approved`
  - `changes-requested`
  - `blocked`
- issue-driven workflow runs now capture the current blueprint, role-routing,
  and stage-gate snapshot so the first blueprint-first state also reaches
  `.openclawcode/runs/*` and `openclaw code run --json`
- chat surfaces now expose:
  - `/occode-blueprint`
  - `/occode-routing`
  - `/occode-route-set`
  - `/occode-gates`
  - `/occode-gate-decide`
  - blueprint backlog and routing summaries in `/occode-inbox` and `/occode-status`
- `execution-start` now actively steers live execution:
  - `/occode-start` refuses to queue when the gate is not ready
  - auto webhook intake and `/occode-intake` hold execution behind the same gate
  - once a human records `execution-start approved`, held execution-start work resumes automatically
- provider reroute now has a first live write path:
  - one blueprint provider-role assignment can be changed from CLI or chat
  - role-routing and stage-gate artifacts refresh immediately after the change
- runtime routing now reaches executable roles:
  - builder/coder and verifier roles resolve agent selection before execution
  - routing honors structured rerun overrides first, then explicit CLI
    overrides, then role/env and adapter/env mappings
  - the applied selections are persisted in workflow run artifacts and `openclaw code run --json`
- rerun-time executable reroute now has a first structured path:
  - chat users can queue `/occode-reroute-run owner/repo#123 <coder|verifier> <agent-id>`
  - CLI callers can pass `--rerun-coder-agent` and `--rerun-verifier-agent`
  - rerun context preserves requested coder/verifier agent ids
  - executable runtime routing records those selections as `rerun-request`
- active-run reroute now has a first deferred replay path:
  - if the issue is already running, `/occode-reroute-run` records a deferred
    coder/verifier reroute instead of rejecting the request
  - `/occode-status` shows that pending reroute while the current run is still
    active
  - if the active run finishes in `Failed`, openclawcode automatically queues a
    rerun with the deferred override
- manual human handoff now has a first structured worktree path:
  - `/occode-takeover owner/repo#123 [note]` records the active human takeover
  - `/occode-status` shows the active takeover with worktree path and actor
  - `/occode-resume-after-edit owner/repo#123 [note]` queues a structured rerun
    after manual edits
  - rerun artifacts now preserve manual takeover metadata
- release-readiness artifacts now have a first machine-readable path:
  - `openclaw code promotion-gate-refresh --json` persists branch, commit,
    setup-check readiness, merge-promotion readiness, and rollback baseline
  - `openclaw code rollback-suggestion-refresh --json` persists the current
    rollback target recommendation
- the remaining gap is deeper runtime integration:
  - true live mid-run provider switching is still missing
  - current support is deferred replay after a failed active run, not an
    in-flight handoff inside the same execution attempt
  - promotion override still needs fuller lifecycle wiring beyond receipts
- the operator-side contract surface is now one step stronger too:
  - `openclaw code operator-status-snapshot-show --json` exposes a stable
    contract for the queue, bindings, tracked issue snapshots, and repo-level
    chat status summaries
- the policy/productization slice now also has a stable repo-local surface:
  - `openclaw code policy-show --json`
  - explicit suitability allowlist / denylist rules
  - explicit build guardrails for large diffs, broad fan-out, and generated files
  - suitability override persistence in runs and operator snapshots

### Phase B7: Proofs And Productization

Status: open

Deliverables:

- blueprint-first live proof on the long-lived operator
- promotion and rollback guidance for blueprint-aware releases
- release-facing docs for external operators

Acceptance:

- another operator can stand the system up, write a blueprint, and run the
  same flow without tribal knowledge

## Current Slice Sequence

The near-term implementation order is:

1. finish Phase B1 foundation
2. add the first goal-discussion surface
3. add blueprint-to-work-item decomposition
4. add provider-role routing
5. add the first general discovery source
6. add stage-level human handoff controls

## Done In The Current Slice

- fixed the project blueprint path at `PROJECT-BLUEPRINT.md`
- defined the first markdown schema and lifecycle statuses
- added CLI commands to create, inspect, and update blueprint state
- added repo-local work-item decomposition and discovery artifacts
- added provider-neutral role routing and stage-gate artifacts
- persisted blueprint-first snapshots into workflow run artifacts
- surfaced blueprint status, role routing, and stage-gate summaries in
  operator-facing status messages
- surfaced blueprint work-item backlog summaries in `/occode-inbox`
- exposed blueprint summary and clarification prompts through `/occode-blueprint`
- exposed stage-gate inspection and decision recording through
  `/occode-gates` and `/occode-gate-decide`
- made `/occode-start` honor execution-start gate readiness and approval
- made auto webhook intake and `/occode-intake` honor execution-start gate
  readiness and approval
- made chat gate approval automatically resume held execution-start work
- added CLI/chat provider-role reroute controls that mutate blueprint routing
  and refresh downstream artifacts
