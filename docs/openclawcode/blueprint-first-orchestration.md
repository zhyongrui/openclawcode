# Blueprint-First Orchestration Gap Analysis

## Purpose

This document captures the current gap between the existing `openclawcode`
implementation and the intended product direction:

- a user can discuss a project goal with the system first
- the agreed goal is written into a fixed blueprint document
- the system can then link to a GitHub repository and operate proactively
- each phase can run autonomously unless a human chooses to intervene
- the execution layer can use Codex, Claude Code, or both through a shared
  provider abstraction

This is the bridge between today's issue-driven coding operator and the
intended blueprint-driven autonomous development system.

Status note:

- the first follow-up slice since this gap capture has already landed a fixed
  `PROJECT-BLUEPRINT.md` scaffold plus CLI commands to create, inspect, and
  update blueprint lifecycle state
- the remaining gaps below describe what is still missing beyond that
  foundation

## New Product Target

The intended product is no longer just:

`GitHub issue -> isolated run -> PR -> review -> merge`

The intended product is:

`goal discussion -> agreed blueprint -> repo binding -> discovered or planned work items -> execution runs -> PRs -> review/merge -> repeat`

The key change is the source of truth.

- today, the primary source of truth is a GitHub issue
- in the target system, the primary source of truth is a project blueprint
- GitHub issues become execution units derived from that blueprint or from
  later discovery

## What Already Exists

The current codebase already covers a meaningful part of the back half of the
target system.

### 1. Issue-Driven Execution Core

Already implemented:

- durable workflow runs
- isolated worktrees and branches
- builder/verifier execution
- draft PR publication
- review/rerun/merge lifecycle handling
- persisted run artifacts and operator snapshots

Relevant code:

- `src/openclawcode/app/run-issue.ts`
- `src/openclawcode/orchestrator/run.ts`
- `src/openclawcode/contracts/types.ts`
- `src/integrations/openclaw-plugin/store.ts`

Current status:

- this is the strongest part of the product today
- the system can already take a scoped issue and drive it through an isolated
  implementation workflow

### 2. Chatops Control Surface

Already implemented:

- `/occode-intake`
- `/occode-start`
- `/occode-rerun`
- `/occode-status`
- `/occode-inbox`
- `/occode-sync`
- `/occode-bind`
- `/occode-unbind`

Relevant code:

- `extensions/openclawcode/index.ts`
- `src/integrations/openclaw-plugin/chatops.ts`

Current status:

- humans can already intervene at several coarse-grained control points
- chat-native issue creation exists
- one-line intake already narrows the gap to more natural goal entry

### 3. Suitability And Risk Gating

Already implemented:

- issue scope classification
- auto-run vs needs-human-review vs escalate decisions
- high-risk precheck before branch mutation
- suitability summaries persisted into run artifacts and operator status

Relevant code:

- `src/openclawcode/roles/suitability.ts`
- `src/openclawcode/roles/scope.ts`

Current status:

- the system already has the beginnings of human-in-the-loop policy
- but the policy is still issue-centric, not blueprint-centric

### 4. Embedded Agent Runtime And Provider Resilience

Already implemented:

- embedded agent runner abstraction
- structured provider failure diagnostics
- issue-worktree prompt trimming
- model fallback injection via `OPENCLAWCODE_MODEL_FALLBACKS`
- setup-check model inventory and readiness reporting

Relevant code:

- `src/openclawcode/runtime/agent-runner.ts`
- `scripts/openclawcode-setup-check.sh`

Current status:

- there is already enough infrastructure to support multiple model backends
- but the system does not yet expose a formal provider role model such as
  planner/coder/reviewer mapped onto Codex or Claude Code

### 5. Proactive Validation-Issue Loop

Already implemented:

- local CLI seeding of validation issues
- inventory and reconciliation of validation issues
- automatic closing of already-implemented command-layer issues

Relevant code:

- `src/openclawcode/validation-issues.ts`
- `src/commands/openclawcode.ts`

Current status:

- the system can already create and consume a narrow class of self-generated
  issues
- this is the closest existing capability to "self-discovery", but it is still
  limited to validation-pool maintenance, not general product or repository
  discovery

## What Is Missing

These are the major gaps between the current product and the intended system.

### 1. Goal Discussion Loop

Missing:

- an explicit first-class conversation stage where the system discusses a
  project goal with the user before issue creation
- active clarification when the goal is ambiguous
- proactive suggestions from the system while shaping the goal
- a clear "we now agree on the target" checkpoint

Current state:

- `/occode-intake` can create an issue from chat
- suitability can reject or defer under-specified issues
- but there is no dedicated goal-shaping conversation model yet

### 2. Fixed Blueprint Document

Missing:

- a fixed blueprint document path and schema
- a documented lifecycle for that blueprint:
  - draft
  - clarified
  - agreed
  - active
  - superseded
- a requirement that future issue creation and discovery work anchor back to
  the blueprint

Current state:

- there are many design documents in `docs/openclawcode/`
- but there is no single canonical per-project blueprint file that acts as the
  source of truth for autonomous execution

### 3. Blueprint -> Work Item Decomposition

Missing:

- a way to derive execution work items from the blueprint
- a stable internal object that is broader than a GitHub issue
- decomposition logic for:
  - planned feature slices
  - docs work
  - sync work
  - bugfix work
  - validation work

Current state:

- the system assumes the work item already exists as a GitHub issue
- it does not yet create a planned issue graph from a higher-level goal

### 4. General Self-Discovery

Missing:

- automatic discovery from:
  - test failures
  - lint or typecheck regressions
  - provider or queue incidents
  - upstream sync conflicts
  - docs drift
  - repeated manual interventions
- dedupe logic and prioritization for discovered problems

Current state:

- validation issue seeding is proactive, but narrow
- there is no general discovery pipeline that turns evidence into a work item

### 5. Provider-Neutral Agent Roles

Missing:

- a formal role model such as:
  - planner
  - coder
  - reviewer
  - verifier
  - doc-writer
- a provider adapter layer that maps those roles to Codex, Claude Code, or
  other future backends
- routing rules and fallback rules by phase

Current state:

- `agent-runner.ts` already gives a useful execution substrate
- fallback chains exist
- but the system does not yet treat Codex and Claude Code as interchangeable
  role providers inside one orchestration model

### 6. Stage-Level Human Handoff

Missing:

- human intervention at every major stage
- the ability to:
  - approve a generated plan
  - edit the plan
  - take over a worktree
  - switch providers mid-run
  - continue after manual edits
  - override merge or suitability policy in a structured way

Current state:

- the user can currently intervene at coarse run-control points
- the system is not yet a full human-in-the-loop orchestrator

## Target Architecture

The intended architecture should add six layers above or alongside the current
issue-driven workflow.

### 1. Blueprint Layer

Responsibilities:

- hold the agreed project goal
- capture scope, non-goals, risks, assumptions, and success criteria
- define what kinds of work the system may proactively create
- define which stages require human confirmation

Suggested artifact:

- a fixed project blueprint file under the repository root or a fixed
  `.openclawcode/` path

### 2. Discovery Layer

Responsibilities:

- watch for implementation gaps and incidents
- convert evidence into draft work items
- deduplicate repeated discoveries
- rank discoveries by urgency and expected value

Inputs:

- CI or test failures
- setup-check failures
- provider failures
- validation-pool drift
- upstream sync conflicts
- docs drift

### 3. Work Item Layer

Responsibilities:

- define a generic internal work item abstraction
- support projected GitHub issues without making GitHub the only source
- let both blueprint-planned work and discovered work use the same workflow

### 4. Execution Layer

Responsibilities:

- keep the existing isolated run engine
- continue to produce durable workflow artifacts
- keep verification and PR publication bounded and auditable

Current implementation base:

- the existing `runIssueWorkflow` and related workflow contracts

### 5. Provider Role Layer

Responsibilities:

- map system roles to available agent providers
- support:
  - Codex only
  - Claude Code only
  - mixed mode
- define fallback behavior by role, not only by model string

### 6. Human Intervention Policy Layer

Responsibilities:

- decide whether a stage is autonomous or gated
- define the exact user intervention affordances per stage
- persist those decisions into run artifacts and chat-visible state

## Practical Migration Path

The shortest path from today's codebase to the target system is:

1. add a blueprint document and blueprint schema
2. add chat-native blueprint discussion and confirmation
3. add blueprint-to-work-item decomposition
4. add provider role adapters for Codex and Claude Code
5. add a general discovery pipeline
6. add stage-level handoff controls

This order keeps the existing issue-driven engine intact while adding the
missing upstream control plane.

## Recommended Next Concrete Slices

1. finish and harden the fixed blueprint document path and schema now landed at
   `PROJECT-BLUEPRINT.md`
2. add a chat-native blueprint confirmation loop before issue creation
3. add a first internal `work item` abstraction separate from GitHub issues
4. add a provider-role config surface for planner/coder/reviewer
5. add a first narrow self-discovery source beyond validation-pool seeding

## Summary

Today, `openclawcode` is already a credible issue-driven coding operator.

It is not yet a full blueprint-driven autonomous project developer.

The existing codebase already solves much of the difficult execution backend:

- workflow state
- isolation
- builder/verifier execution
- PR lifecycle handling
- chatops status
- provider diagnostics

The remaining work is mostly about adding the missing upstream control plane:

- blueprint as source of truth
- discovery as a first-class stage
- provider-neutral agent roles
- human intervention at every stage

That is the shortest accurate description of the current gap.
