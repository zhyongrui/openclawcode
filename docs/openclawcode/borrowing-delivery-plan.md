---
summary: "Master delivery plan for ClaudeCode and OpenAI Codex borrowing work in openclawcode"
read_when:
  - You want one place that tracks all borrowing workstreams
  - You need to know what has shipped versus what is only staged
title: Borrowing Delivery Plan
---

# Borrowing delivery plan

This plan turns the two borrowing reviews into one execution document:

- [ClaudeCode borrowing notes](/reference/claudecode-borrowing)
- [OpenAI Codex borrowing notes](/reference/openai-codex-borrowing)

The goal is not to copy either product. The goal is to adapt the parts that
improve `openclawcode`'s operator UX and subsystem boundaries while preserving
its stronger runtime model.

## Delivery rule

Borrowing work is tracked as:

- `shipped`: code or docs already landed in `main`
- `current wave`: concrete work completed in this delivery pass
- `staged`: next implementation candidate, not yet shipped
- `do not borrow`: explicitly rejected direction

## Workstreams

### 1. Tool-surface assembly and visibility

Status: `shipped`, expanded in the current wave

Shipped already:

- one runtime assembly layer via `resolveEffectiveToolSurface(...)`
- `tools.effective` assembly metadata
- `/tools` runtime summary output

Completed in this wave:

- structured tool-availability notes for active runtime restrictions
- `/tools` output now explains why some capabilities are hidden or gated
- shared tool-surface diffing across two effective runtime inventories
- `/tools compare <agent-id|session-key>` now shows operator-facing diffs across
  agents or sessions instead of only listing the current surface
- gateway `tools.diff` now exposes the same comparison as machine-readable
  structured output for operator UIs and automation
- named rollout presets (`browser`, `delegate`, `remote`) now layer on top of
  existing profile policy so operators can expose targeted capability bundles
  without redefining whole profiles

### 2. Background current-session UX

Status: `shipped` baseline, `current wave` for reattach-aware handoff

Shipped already:

- durable detached-session provenance on tasks/flows
- detached-session resume hints in `tasks show` and `flows show`
- `openclaw agent --background`
- explicit `--session-key <key>` targeting
- background acceptance output now also prints a direct
  `openclaw sessions continue ...` handoff alongside low-level wait/resume hints
- `openclaw agent --background --json` now exposes the same wait/continue/resume
  handoff hints as structured fields for automation callers

Completed in this wave:

- detached-session resume/handoff surfaces now expose explicit completion
  routing so operators and automation can tell whether completion will stay in
  detached delivery or remain with a foreground-reattached session
- detached task terminal delivery now suppresses detached delivery after a
  foreground reattach and records that terminal state as reattached instead of
  queueing another detached notification
- detached-session resume/handoff surfaces now also expose transcript handoff
  semantics, so operators and automation can distinguish a still-live detached
  transcript from a reattached history-only transcript snapshot or a missing
  recovery artifact
- Control UI Sessions now exposes a detached-session detail panel with
  transcript preview, shared resume/handoff lines, related task/TaskFlow
  context, detached follow-up, and first-class foreground reattach actions via
  gateway `sessions.inspect` / `sessions.reattach`
- Control UI chat now exposes a first-class `Background` action plus
  `/background <message>`, and the client suppresses transcript/tool streaming
  for those accepted runs while keeping Sessions as the operator handoff lane
- TUI now exposes `/background <message>` plus `Ctrl+B` to detach the current
  draft, and it suppresses transcript/tool/lifecycle updates for those accepted
  background runs so the foreground session stays interactive

### 3. History and session-local operator UX

Status: `current wave`

Current substrate already exists:

- durable transcripts
- session inspection
- detached-session resume metadata

Completed in this wave:

- repo-local workflow history artifact at `.openclawcode/workflow-history.json`
- `openclaw code workflow-history-show` for project-scoped history inspection
- current-session-first ordering driven by the operator snapshot when available
- bounded run-history tails with durable run artifact references instead of
  replaying full histories
- durable large-paste references for oversized or multiline history-tail items,
  so repo-local workflow history can point at persisted tail artifacts instead
  of replaying pasted payloads inline
- non-CLI session history and transcript handoff affordances in Control UI via
  session inspect previews and shared resume metadata instead of CLI-only
  `sessions show` output

### 4. Detached-session identity and resume discipline

Status: `current wave`

Shipped already:

- explicit `resumeSessionKey` / `resumeSessionId` presentation
- stable accepted-response session identity for background agent runs

Completed in this wave:

- `openclaw sessions show <lookup>` for one operator-facing session lifecycle
  view
- `openclaw sessions continue <lookup> --message ...` so the operator can
  resolve and continue a detached session without rewriting the resume command
- session lookup by exact session key or stable session id with ambiguity
  surfacing
- transcript path/existence, related tasks, related TaskFlows, and resume hints
  gathered in one place for detached-session inspection
- `sessions show` now classifies the detached-session lifecycle state
  (`running`, `waiting`, `blocked`, `missing transcript`, `resumable`) instead
  of leaving the operator to infer it from raw task/flow rows
- `sessions` list now includes the same lifecycle status at table/list level so
  operators can triage detached sessions before drilling into `show`
- `tasks list` now reuses that detached-session lifecycle language for
  child-session rows, so the task ledger and session ledger speak the same
  operator-facing state model
- `flows list` now reuses the same detached-session lifecycle language, so all
  three detached triage ledgers line up before drilling into detail views
- `tasks show` and `flows show` now surface the same detached-session
  lifecycle state in their detail views, so operators keep the same state model
  after drilling in from list triage
- detached-session detail views now also expose structured resume metadata in
  JSON payloads, so scripts and operator UIs do not have to parse raw help text
- that structured detached-session resume metadata now also carries transcript
  path and transcript existence snapshot fields, so handoff/reattach callers
  can tell whether durable history is still present without making a second
  lookup
- detached-session text resume/handoff blocks now also print transcript path
  and transcript existence hints, so operators get the same history-presence
  signal in `tasks show`, `flows show`, `sessions show`, and `sessions continue`
- `openclaw agent --background` accepted handoff now also carries transcript
  path/existence snapshot hints in both text and JSON, so the very first
  detached-run acknowledgment exposes the same durable-history signal
- the `sessions`, `tasks list`, and `flows list` JSON ledgers now also carry
  structured resume metadata, so scripts can continue or inspect detached work
  directly from list surfaces without a second `show` lookup
- `openclaw agent --background --json` now also embeds the same shared
  structured `resume` object inside its handoff payload, so accepted-run
  automation can reuse the exact schema exposed by sessions/tasks/flows
- `openclaw agent --background` text output now also prints the shared
  `Resume:` block, so accepted-run operators see the same resumeSessionKey,
  transcript hints, and ACP-native resume lines as later detached-session views
- `sessions continue --json` now wraps the resolved session lookup and continue
  request metadata around the returned agent result, so automation can see both
  what was targeted and what happened next
- that `sessions continue --json` envelope now also carries the target
  session's lifecycle and resume snapshot before the continue call, so callers
  do not need a separate `sessions show` round-trip just to capture state
- `sessions continue` text output now also prints the resolved session target
  and pre-continue lifecycle snapshot before dispatching the next turn
- that `sessions continue` text preamble now also prints the pre-continue
  resume/handoff metadata, so operators can copy the same continuation hints
  they would see in `sessions show`
- `tasks show` / `flows show` now also expose `lookup` and `resolvedBy`, so
  detail views explain which operator token matched the underlying durable
  record
- foreground `sessions continue` now stamps related task and TaskFlow records
  with durable `reattachedAt` metadata, so detached work can later distinguish
  "still backgrounded" from "brought back to the foreground"
- that reattach metadata now shows up in `tasks show`, `flows show`, and
  `sessions show` related-record payloads, giving operator views a first
  durable hook for later completion-routing behavior
- `openclaw sessions reattach <lookup>` now provides a first-class foreground
  reattach command with the same shared resume message and lookup semantics as
  `sessions continue`
- `tasks show`, `flows show`, `sessions show`, shared resume blocks, and
  `sessions continue --json` now also expose completion-routing metadata, so
  callers can see whether detached completion stays detached or is now owned by
  the reattached foreground session
- detached completion routing now reacts to foreground reattach state instead
  of only exposing the underlying metadata: once a detached run was brought
  back to the foreground, terminal delivery is suppressed from the detached
  lane and marked as reattached
- gateway `sessions.reattach` now brings that foreground reattach behavior into
  non-CLI operator flows, so Control UI can take over detached work without
  shelling out to the CLI
- Control UI Sessions detail now exposes the same detached lifecycle,
  completion-routing, transcript-handoff, and related-work state model that the
  CLI `sessions show` / `sessions continue` views already use

### 5. Bridge and remote-control subsystem boundaries

Status: `staged`, specified in docs this wave

Completed in this wave:

- explicit contract doc for sandbox/execution/escalation boundaries

Staged next:

- isolate remote-control/session-transport lifecycle into a clearer subsystem seam
- separate transport rebuild, auth refresh, and session spawn orchestration

### 6. Workspace guidance and project-doc contract

Status: `current wave`

Completed in this wave:

- one authoritative workspace-guidance contract doc
- clear statement of bootstrap file precedence, fallback names, and session-type
  loading rules
- explicit note that OpenClaw does not yet implement Codex-style nested
  directory precedence automatically

Staged next:

- optional config for fallback bootstrap filenames and injection limits
- stronger subagent inheritance controls

### 7. Sandbox selection and escalation boundary discipline

Status: `current wave`

Completed in this wave:

- one contract doc that defines the effective execution request model
- explicit escalation outcomes: `run`, `approval_required`, `deny`
- documented role of `systemRunPlan` for node-host approvals
- typed escalation outcomes now propagate through node-host `exec.denied`
  payloads and gateway approval-guard errors instead of staying implicit in
  per-call denial messages
- operator-facing system events now distinguish `Exec approval required ...`
  from `Exec denied ...`, so UI and terminal operators can tell a retryable
  approval boundary from a hard policy denial

Staged next:

- converge more call sites onto one shared effective execution request shape
- expose typed escalation outcomes more uniformly in the remaining
  operator-facing flows

### 8. Config-surface discipline

Status: `staged`

Current position:

- `openclawcode` already has rich config and schema generation

Staged next:

- add small high-level control points before introducing more nested one-off
  flags
- publish schema-level docs whenever a subsystem becomes operator-tunable

### 9. Skills model and operator-product clarity

Status: `staged`

Shipped already:

- stronger skills/runtime/plugin model than either borrowed source

Staged next:

- thinner top-level skill enablement controls for common cases
- clearer separation between discovery, eligibility, configuration, and install
  metadata

### 10. Approval reviewer role

Status: `staged carefully`

Current rule:

- high-risk execution still ends with the human operator

Staged next:

- optional subagent-prepared approval context, never silent self-approval

## Completed tasks for this delivery wave

- [x] Publish the borrowing master plan.
- [x] Ship a tool-availability explanation surface in `tools.effective` and
  `/tools`.
- [x] Publish an authoritative workspace-guidance contract.
- [x] Publish an authoritative sandbox and escalation contract.
- [x] Sync the borrowing notes and dev log to reflect the new shipped slices.
- [x] Ship the first repo-local workflow history slice for ClaudeCode borrowing.
- [x] Ship the first operator-facing detached-session lifecycle view.
- [x] Ship first-class detached-session reattach and reattach-aware completion
  routing.
- [x] Ship transcript handoff semantics for detached versus reattached session
  recovery surfaces.
- [x] Ship cross-agent and cross-session tool-surface diff views.

## Explicit non-goals

- rewriting core subsystems into Rust/Bazel
- weakening approval semantics to match a simpler CLI
- collapsing plugins/skills into one monolithic tool file
- pretending staged work is already shipped
