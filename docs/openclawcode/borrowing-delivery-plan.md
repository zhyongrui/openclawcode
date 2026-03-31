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

Staged next:

- diff views across agents/sessions
- named rollout presets beyond current policy/profile controls

### 2. Background current-session UX

Status: `shipped` baseline, `staged` for richer UI handoff

Shipped already:

- durable detached-session provenance on tasks/flows
- detached-session resume hints in `tasks show` and `flows show`
- `openclaw agent --background`
- explicit `--session-key <key>` targeting

Staged next:

- TUI / Control UI affordance for backgrounding the currently interactive turn
- transcript handoff semantics for reattach versus stay-detached completion

### 3. History and session-local operator UX

Status: `staged`

Current substrate already exists:

- durable transcripts
- session inspection
- detached-session resume metadata

Staged next:

- current-session-first history views
- project-local history filters
- durable large-paste references rather than eager inline replay

### 4. Detached-session identity and resume discipline

Status: `shipped` baseline

Shipped already:

- explicit `resumeSessionKey` / `resumeSessionId` presentation
- stable accepted-response session identity for background agent runs

Staged next:

- non-CLI reattach affordances
- clearer remote-session lifecycle views in operator UIs

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

Staged next:

- converge more call sites onto one shared effective execution request shape
- expose typed escalation outcomes more uniformly in operator-facing flows

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

## Explicit non-goals

- rewriting core subsystems into Rust/Bazel
- weakening approval semantics to match a simpler CLI
- collapsing plugins/skills into one monolithic tool file
- pretending staged work is already shipped
