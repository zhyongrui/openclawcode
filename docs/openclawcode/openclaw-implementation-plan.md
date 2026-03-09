# OpenClaw Implementation Plan

## Purpose

This document describes the implementation path for `openclawcode` under the
selected repository strategy:

- `openclawcode` is the main product repository
- OpenClaw remains the platform base
- OpenClaw adapter code lives in this repository
- upstream OpenClaw is synced into this repository over time

## Implementation Decision

The implementation model is:

- keep workflow core in `openclawcode`
- keep the OpenClaw adapter in `src/integrations/openclaw-plugin/`
- keep any OpenClaw-side shim as thin as possible
- avoid turning product progress into an upstream dependency

In practice:

- `openclawcode` owns workflow state, policy, persistence, worktree handling,
  PR drafting, and verification logic
- OpenClaw-derived runtime surfaces are reused as the execution substrate
- adapter code translates OpenClaw runtime events into workflow operations

## Why This Fits the Current Direction

OpenClaw already provides the runtime concepts needed for this product:

- session and subagent execution
- coding tool paths
- sandbox and working directory control
- CLI and service control surfaces

That means the product can evolve quickly without inventing a new base runtime.

At the same time, keeping the adapter in this repository avoids:

- waiting on upstream merges
- maintaining a separate glue repository
- duplicating product contracts across multiple codebases

## Recommended Repository Layout

The repository should be organized like this:

- `src/contracts/`: workflow domain objects
- `src/workflow/`: state machine and transitions
- `src/orchestrator/`: deterministic coordination
- `src/persistence/`: run store and audit artifacts
- `src/worktree/`: per-run repository isolation
- `src/integrations/openclaw-plugin/`: OpenClaw-facing adapter layer
- `docs/`: architecture, strategy, sync policy, and operating guidance

## Ownership Boundary

### Workflow Core Owns

- issue suitability
- execution spec generation
- branch and worktree lifecycle
- PR draft generation
- verification result model
- escalation and merge policy
- workflow persistence

### OpenClaw Adapter Owns

- CLI ingress such as `openclaw code ...`
- queue persistence for runtime-triggered work
- queue-drain service behavior
- thin runtime registration surface

The adapter should not become the place where core workflow policy lives.

## Trigger Model

The first implementation should support:

- manual CLI trigger
- queued background execution
- later GitHub-triggered workflows

Recommended early entrypoint:

- `openclaw code queue --repo <owner/repo> --issue <number>`

## Execution Model

The execution model should be:

1. a trigger enters through the OpenClaw adapter layer
2. the adapter creates or queues a workflow request
3. the workflow core creates or resumes a `WorkflowRun`
4. the orchestrator decides the next stage
5. runtime-backed execution performs the stage in an isolated worktree
6. artifacts are persisted after every major transition
7. the result is surfaced to human review or the next policy gate

## Role Execution Strategy

The runtime should still follow role separation:

- planner
- builder
- verifier

Recommended behavior:

- planner operates with read-heavy context
- builder operates in a bounded writable worktree
- verifier does not inherit builder authority

Builder and verifier should never collapse into one mutable reasoning loop.

## Worktree and Isolation Strategy

Every workflow run should use:

- one branch per run
- one worktree or isolated working directory per run
- persisted workspace metadata
- explicit cleanup rules

This logic belongs in the workflow core, not in prompt text.

## Persistence Strategy

Persistence should stay in `openclawcode`.

Minimum persisted artifacts:

- run metadata
- stage history
- issue snapshot
- execution spec
- worktree metadata
- build result
- verification report
- final human or policy disposition

## Upstream Sync Strategy

This implementation plan assumes regular upstream syncing.

Practical rules:

- keep platform-touching edits small
- prefer additive modules over broad rewrites
- sync upstream on a regular cadence
- run validation after every sync

See `docs/upstream-sync-policy.md` for the operating rules.

## Recommended Phase Order

Implement in this order.

### Phase 1: Workflow Core

- stabilize contracts
- strengthen the state machine
- add persistence
- add worktree handling
- add suitability gate

### Phase 2: In-Repo OpenClaw Adapter

- keep building `src/integrations/openclaw-plugin/`
- support queue ingress
- support queue service behavior
- keep the boundary thin and explicit

### Phase 3: Runtime Bridge

- connect queued runs to the orchestrator
- bind planner / builder / verifier execution to runtime-backed sessions
- pass worktree-scoped execution context into runtime calls

### Phase 4: GitHub Delivery

- load and normalize GitHub issue state
- generate draft PR payloads
- publish verification outputs

### Phase 5: Operational Hardening

- add webhook or label triggers
- add reconciliation and retry flows
- add sync-safe operational tooling

## What Not to Do

Do not:

- spread product policy across many upstream-derived files
- depend on one giant prompt to emulate orchestration
- let builder also serve as verifier
- delay upstream syncing until drift becomes large
- turn the adapter layer into the real workflow core

## Immediate Next Step

The next concrete implementation step should be:

- keep extending the workflow core
- bridge the OpenClaw adapter queue into the orchestrator
- keep documenting and enforcing the upstream sync boundary

That path supports product momentum while keeping future upstream adoption
manageable.
