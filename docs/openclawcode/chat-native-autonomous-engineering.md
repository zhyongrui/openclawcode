# Chat-Native Autonomous Engineering

## Purpose

This document captures the intended product direction for `openclawcode` as a
 persistent engineering system built on top of OpenClaw.

It records the current architectural framing, the product constraints that
matter, and the next development plan for turning today's issue runner into a
7x24 blueprint-driven engineering operator that can be supervised from chat.

## Product Thesis

The target product is not just "a coding bot in chat".

The target product is:

- chat-native for operator control and project visibility
- blueprint-first for long-lived product direction
- GitHub-native for execution, audit, and collaboration
- agent-orchestrated for planning, coding, review, and verification
- long-running so it can keep advancing work without a human watching every run

The intended system shape is:

`goal discussion -> blueprint -> work-item / issue selection -> implementation -> review -> verification -> PR / merge -> blueprint progress update -> repeat`

## Why This Direction Is Correct

### 1. Chat Is The Right Control Surface

OpenClaw already supports many chat surfaces and long-running agents. That
makes chat the natural place for:

- project status
- gate decisions
- issue intake
- reruns and overrides
- policy explanations
- "what is happening now?"
- "what should happen next?"

The user should not need to live in a terminal or dashboard to supervise a
long-running development loop.

### 2. GitHub Is The Right Execution Ledger

Issue / PR / review / merge is already the strongest auditable collaboration
loop for software work. OpenClawCode should keep using GitHub as the durable
execution record for:

- scoped implementation units
- diffs and review conversations
- test and verification evidence
- approval and merge state
- artifact links for later debugging

### 3. Blueprint Must Be The Long-Lived Source Of Truth

If the system only reacts to the latest issue or the latest chat message, it
will drift. The project blueprint is what keeps the long-running agent aligned
with:

- the actual product goal
- success criteria
- scope boundaries
- explicit non-goals
- human gates

In the target system, GitHub issues are execution units derived from the
blueprint rather than the primary source of truth.

### 4. OpenClaw And OpenClawCode Have Different Jobs

The product split should stay clear.

OpenClaw owns:

- long-running runtime
- chat connectors
- plugin system
- control UI and gateway
- background execution substrate

OpenClawCode owns:

- blueprint-first engineering workflow
- work-item and issue orchestration
- repo bootstrap and operator binding
- policy and gate enforcement
- PR / review / merge workflow
- machine-readable engineering artifacts

### 5. The Real Product Is Continuous Engineering Progress

The moat is not "code generation in chat".

The moat is:

- a blueprint-driven system that keeps moving a repo forward
- visible from chat
- auditable through GitHub
- resumable after failures
- bounded by policy and human gates

That is closer to a persistent software delivery operator than to a one-shot
coding assistant.

## Core System Model

The product should be understood as three linked control loops.

### 1. Goal Loop

This loop keeps the project aligned.

Inputs:

- user discussion
- blueprint edits
- stage-gate decisions
- changed priorities

Outputs:

- current blueprint status
- clarified project direction
- approved scope boundaries

### 2. Execution Loop

This loop turns blueprint intent into engineering work.

Inputs:

- blueprint
- work-item inventory
- discovered problems
- GitHub issues and PRs

Outputs:

- issue selection or issue creation
- implementation runs
- verification results
- draft or final PRs

### 3. Feedback Loop

This loop tells humans what is happening and where intervention is needed.

Inputs:

- run artifacts
- PR reviews
- failures
- stage-gate blocks

Outputs:

- chat-visible progress
- next-step summaries
- blocking decisions
- rerun / takeover / routing changes

If any one of these loops is missing, the system degrades:

- no goal loop -> issue bot
- no execution loop -> planning toy
- no feedback loop -> opaque automation

## Product Boundaries

The target system should be highly autonomous inside a clearly bounded area and
conservative at the edges.

Human-led by default:

- defining or changing the project goal
- approving major scope changes
- allowing high-risk execution
- approving sensitive merges or promotions

Agent-led by default:

- low-risk issue implementation
- review and verification passes
- issue / PR state reconciliation
- blueprint progress updates when they are mechanically justified

This boundary is essential for a 7x24 system. Unbounded autonomy would make
the runtime powerful but not trustworthy.

## Multi-Agent Direction

Codex and Claude Code should not be treated as "just more chat models". They
should be integrated as role-specific engineering agents inside one workflow.

### Recommended Role Model

The initial shared role model should stay small:

- planner
- coder
- reviewer
- verifier

Later roles can extend this model:

- doc-writer
- release operator
- sync operator

### Why Roles Matter

Different agents are strong at different tasks. The system should route by
role, not by a global "best model" setting.

Examples:

- planner -> produce execution specs from blueprint or issue context
- coder -> edit the worktree and implement the scoped task
- reviewer -> inspect the diff and find risks or regressions
- verifier -> judge whether the change met acceptance criteria with evidence

### OpenClawCode's Role In A Multi-Agent System

OpenClawCode should be the orchestration layer, not the competing agent.

Its job is to:

- choose the next unit of work
- route each stage to the right role backend
- persist what happened
- enforce policy
- expose status back to chat and CLI

That means OpenClawCode grows in value as more capable external coding agents
become available.

## What Chat Should Eventually Show

Chat should evolve from a run-status surface into a project-status surface.

It should be able to answer:

- what blueprint goal is active?
- what workstream is currently being advanced?
- what issue is running now?
- what just finished?
- what is blocked?
- what human decision is needed?
- what is the next planned step?

This is the difference between "chat coding" and "chat-supervised engineering".

## Immediate Gaps

The current implementation has strong issue-driven execution, but the target
product still needs several important upgrades.

### 1. Empty Repo -> True Blueprint-First Startup

Current onboarding and bootstrap can create or attach a repo and seed a
blueprint, but new empty repos still rely on a placeholder test command to get
through bootstrap safely.

Target:

- empty repo bootstrap should not require a fake test command
- bootstrap should explicitly understand "empty repo / blueprint-first startup"
- the next action should be blueprint clarification and work-item creation

### 2. Blueprint-Driven Continuous Progress Loop

The system can already execute a scoped issue, but it does not yet run a true
"choose the next work item and keep going" loop from blueprint state.

Target:

- inspect blueprint + work-item inventory
- choose the next best task
- create or select an execution issue when needed
- run it
- update progress
- repeat unless blocked

### 3. Formal Role Routing For External Coding Agents

The docs and code already point toward planner / coder / reviewer / verifier,
but the next product step is to make that role system the normal execution
contract rather than only a background design idea.

Target:

- stable role config
- role-specific backend selection
- role-specific fallback selection
- persisted role-routing evidence in artifacts and status output

### 4. Chat-Native Project Progress Summaries

Today the system is better at run-centric status than project-centric status.

Target:

- blueprint progress summaries
- active workstream summaries
- "why this issue now?" explanations
- blocked-gate summaries
- next-step projections

### 5. Stable Long-Running Recovery

A 7x24 engineering operator is only as good as its recovery behavior.

Target:

- queue healing after provider failures
- deterministic reruns
- reproducible agent routing
- clean pause / resume semantics
- durable state transitions around takeover and review

## Development Plan

The next development plan should focus on system shape, not just isolated
commands.

### Phase A: Blueprint-First New Repo Startup

Goal:

- make a new empty repo a first-class bootstrap case

Deliverables:

- detect empty repo state during bootstrap
- remove the need for placeholder `echo no-tests-yet`
- persist an explicit blueprint-first startup mode
- emit exact next actions for:
  - blueprint clarification
  - blueprint agreement
  - first work-item decomposition

Validation:

- focused command tests
- one real empty-repo bootstrap proof
- updated install docs and dev log

### Phase B: Continuous Blueprint Progress Loop

Goal:

- let the system keep advancing toward the blueprint instead of waiting for a
  human to hand-create every issue

Deliverables:

- inspect role-routing, discovery, and stage-gate artifacts to choose the next
  actionable work item
- create or select a GitHub issue from that work item
- schedule the next run automatically when policy allows
- stop cleanly when a gate or ambiguity requires human input

Validation:

- machine-readable progress decisions
- replayable tests for work-item selection
- one real multi-step proof from blueprint to more than one completed issue

### Phase C: Role-Based External Agent Routing

Goal:

- make Codex and Claude Code first-class interchangeable engineering agents

Deliverables:

- stable contracts for planner / coder / reviewer / verifier
- provider selection per role
- routing persistence in run artifacts and operator snapshots
- rerun-time role overrides from chat and CLI where safe

Validation:

- focused role-routing tests
- at least one proof where different roles use different backends
- documented fallback and failure behavior

### Phase D: Chat-Native Project Control Surface

Goal:

- make chat reflect project progress, not just run status

Deliverables:

- blueprint progress summaries
- active workstream summaries
- blocked-gate summaries
- next-step summaries
- explicit "who is doing what now?" role reporting

Validation:

- snapshot tests for chat-facing summaries
- live proof from a real chat thread

### Phase E: Long-Running Stability Sweep

Goal:

- make the continuous loop trustworthy enough to run unattended for long
  stretches

Deliverables:

- recovery around provider pauses and stuck runs
- stronger idempotence around reruns and bootstrap retries
- clearer operator alerts when the loop cannot legally continue

Validation:

- deterministic failure-path tests
- long-running operator proof with at least one interruption and successful
  recovery

## Working Principles

While implementing the plan above, the product should keep these principles:

- blueprint over issue
- GitHub over hidden state
- chat as control plane, not as the only execution log
- role routing over one-model-for-everything
- bounded autonomy over uncontrolled automation
- exact artifacts over vague summaries

## Summary

The target is coherent:

- OpenClaw is the always-on runtime and chat substrate
- OpenClawCode is the engineering orchestration layer
- Codex / Claude Code / future coding agents are role-specific workers inside
  that orchestration model

That product direction is not off target. It is the correct north star for a
chat-native, blueprint-first, GitHub-backed autonomous engineering operator.
