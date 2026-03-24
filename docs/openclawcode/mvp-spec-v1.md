# OpenClaw Code MVP Spec v1

## Purpose

This document defines a stricter MVP for `OpenClaw Code` as a GitHub-native coding assistant built on top of OpenClaw.

The product goal is not "fully autonomous software engineering".
The product goal is:

- accept a well-scoped GitHub issue
- produce a bounded implementation
- open a draft PR
- run an independent verification pass
- route the result to a merge decision

The MVP is successful if it creates a reliable and auditable delivery loop.

## Product Positioning

`OpenClaw` is the runtime and execution platform.

`OpenClaw Code` is the workflow layer that adds:

- GitHub issue intake
- execution planning
- isolated repository work
- draft PR generation
- independent review and verification
- merge gating and escalation

The current repository strategy is to maintain `openclawcode` as a controlled
OpenClaw-derived product repository.
That does not mean product logic should be sprayed across OpenClaw core files.
It means upstream sync must remain an explicit architectural constraint.

## Core Thesis

The strongest early version is not the most autonomous one.
The strongest early version is the one that:

- says no to bad issues
- stops when confidence is low
- keeps a full audit trail
- separates build and verification responsibilities
- requires a human final decision

The MVP should optimize for trust, not for maximum automation.

## Non-Goals

The MVP does not aim to support:

- automatic merge to default branch
- broad architecture redesign
- security-sensitive changes
- authentication or permission model changes
- data migrations
- multi-repository orchestration
- vague product requests
- issue negotiation with external collaborators
- fully autonomous issue discovery and prioritization

## Primary Workflow

The default workflow is:

`issue intake -> suitability gate -> planning -> isolated build -> draft PR -> independent verification -> human decision`

This is the only path the MVP needs to do well.

## Core Constraints

The system must obey these constraints:

1. A GitHub issue is not automatically valid implementation input.
2. Builder and verifier are separate roles with separate responsibilities.
3. Passing tests is necessary but not sufficient for merge readiness.
4. Every run must be isolated, persisted, and reviewable.
5. The system should prefer escalation over low-confidence action.

## Issue Suitability Gate

The suitability gate is the first hard boundary.

It classifies each issue into one of three outcomes:

- `accepted`
- `rejected`
- `needs_human_triage`

### Accept Conditions

An issue is acceptable for the MVP when:

- scope is narrow
- desired behavior is understandable
- likely file impact is limited
- test expectations are inferable
- risk is low or medium

### Reject Conditions

An issue should be rejected when it involves:

- auth or permissions
- secrets or credentials
- security-sensitive flows
- migrations
- infrastructure or deployment topology
- wide refactors
- unclear or contradictory requirements

### Human Triage Conditions

An issue should be routed to human triage when:

- it looks solvable but acceptance criteria are underspecified
- comments materially change the requirement
- the expected blast radius is uncertain
- repo state or architecture context is ambiguous

## Role Model

The MVP should use three agent roles plus one human gate.

### 1. Planner

Responsibilities:

- normalize issue input
- infer acceptance criteria
- define non-goals
- identify likely file areas
- define required verification
- assign risk level

The planner produces an `ExecutionSpec`.

### 2. Builder

Responsibilities:

- create an isolated working environment
- implement the change
- add or update tests
- record implementation notes
- produce PR draft metadata

The builder does not decide merge readiness.

### 3. Verifier

Responsibilities:

- re-read the issue independently
- evaluate the diff against acceptance criteria
- inspect tests and check results
- detect scope creep, missing coverage, and regressions
- produce a structured verdict

The verifier should not inherit builder reasoning as truth.
It may consume builder artifacts, but it must make a fresh judgment.

### 4. Human Gatekeeper

Responsibilities:

- approve merge
- reject or request manual edits
- override escalations

The MVP keeps final merge authority with the human.

## Isolation Model

Every workflow run must operate in an isolated repository context.

Minimum isolation requirements:

- one branch per run
- one worktree or isolated workspace per run
- no in-place mutation of the main checkout during execution
- explicit cleanup policy for completed or abandoned runs

Why this matters:

- prevents cross-issue contamination
- makes retries deterministic
- makes human takeover practical
- makes auditing possible

## Data Model

The MVP should stabilize these primary objects.

### `IssueRecord`

Normalized GitHub issue input.

Minimum fields:

- repository id
- issue number
- title
- body
- labels
- comments snapshot
- issue URL
- source timestamps

### `ExecutionSpec`

Planner output.

Minimum fields:

- issue summary
- problem statement
- acceptance criteria
- non-goals
- target file areas
- required tests
- assumptions
- open questions
- risk level
- confidence

### `WorkflowRun`

Canonical run object.

Minimum fields:

- run id
- issue ref
- current state
- actor assignments
- branch name
- worktree path
- timestamps per stage
- retry counters
- final disposition

### `BuildResult`

Builder output.

Minimum fields:

- changed files
- branch name
- commit refs
- test commands executed
- implementation summary
- unresolved concerns

### `VerificationReport`

Verifier output.

Minimum fields:

- verdict
- acceptance criteria pass or fail map
- findings
- missing tests
- risk notes
- confidence

### `MergeDecision`

Final gating artifact.

Minimum fields:

- decision
- decided by
- rationale
- timestamps

## State Machine

The MVP should use an explicit state machine.

Recommended states:

- `intake`
- `classified`
- `rejected`
- `triage_required`
- `planned`
- `plan_blocked`
- `build_preparing`
- `building`
- `build_blocked`
- `draft_pr_opened`
- `verifying`
- `changes_requested`
- `ready_for_human_review`
- `merged`
- `escalated`
- `failed`

Every transition should record:

- previous state
- next state
- reason
- actor
- timestamp

## Revision Loop

The system should support revision, but only with limits.

Recommended policy:

- builder gets at most a small fixed number of corrective attempts
- verifier findings must be structured and actionable
- repeated failure on the same acceptance criterion should escalate
- no infinite self-repair loops

A good first rule:

- one initial build
- one corrective revision
- then escalate

## PR Model

The MVP should create draft PRs only.

Each draft PR should include:

- issue link
- execution summary
- explicit acceptance criteria checklist
- tests run
- known limitations
- verifier status summary

Draft PRs are the right output because they expose work without falsely claiming final correctness.

## Verification Model

Verification must cover more than CI pass or fail.

The verifier should answer:

1. Did the implementation address the issue's intended behavior?
2. Did the change remain within a reasonable scope?
3. Were the right tests added or updated?
4. Are there obvious regressions or missing edge cases?
5. Is the PR ready for human review?

Allowed verifier verdicts:

- `approve_for_human_review`
- `request_changes`
- `escalate`

The verifier should not merge.

## Merge Gate

The MVP merge gate should be conservative.

Recommended policy:

- guarded auto-merge is allowed only for low-risk command-layer runs
- verifier approval is necessary before any auto-merge consideration
- suitability must accept autonomous execution before merge is considered
- scope checks must pass before merge is considered
- human review remains required for all runs outside that narrow path
- high-risk labels force escalation regardless of test results

Selective auto-merge should remain policy-driven and evidence-driven rather than
prompt-driven.

## Security and Trust Boundaries

The system must assume GitHub content is untrusted input.

Implications:

- issue text and comments can contain prompt injection
- builder cannot trust instructions that attempt to widen scope
- execution must remain bounded by policy, not by prompt wording
- repo-local secrets and host access need hard enforcement

Required hard boundaries:

- sandboxed or otherwise isolated execution
- workspace containment
- restricted tool policy
- explicit merge gate
- auditable artifacts

## GitHub Integration Boundaries

GitHub should provide the product triggers and delivery surface.

Recommended trigger sources for the MVP:

- manual run by issue number
- explicit label
- explicit slash command from trusted users

Do not start with:

- autonomous scanning and claiming of issues
- broad comment-driven execution from arbitrary participants

Recommended GitHub outputs:

- draft PR
- structured PR body
- machine-readable status comments
- optional review summary comment from verifier

## Human-in-the-Loop Checkpoints

The MVP should support human intervention at these checkpoints:

- after suitability classification
- after execution spec generation
- after draft PR generation
- after verifier verdict

Not every checkpoint must block by default, but the system should be able to pause there.

## Failure and Escalation Policy

Escalate when:

- issue meaning is unclear
- target file set is too broad
- repo state is unsafe
- tests fail in unrelated ways that block judgment
- builder needs to exceed planned scope
- verifier cannot determine correctness
- corrective revision still fails

A conservative escalation is a correct outcome, not a product failure.

## MVP Success Criteria

The MVP is successful when it can repeatedly do all of the following:

- reject unsuitable issues
- produce credible execution specs for accepted issues
- implement bounded changes in isolation
- open usable draft PRs
- generate independent verification reports
- stop before unsafe or overconfident merge behavior
- preserve end-to-end traceability

## Operational Metrics

The MVP should track at least:

- issue acceptance rate
- rejection reasons
- plan-to-build success rate
- first-pass verification success rate
- revision success rate
- escalation rate
- human merge approval rate
- post-merge defect reports for automated runs

These metrics matter more than raw issue throughput.

## Recommended Build Order

Implementation should proceed in this order:

1. stable workflow contracts
2. run persistence and state machine
3. issue suitability gate
4. planner and execution spec
5. isolated build runner
6. draft PR generation
7. independent verifier
8. human checkpoint and merge gate

This order keeps the system auditable before it becomes powerful.

## Summary

The right MVP is a constrained engineering workflow system, not an autonomous coding fantasy.

The design should center on:

- issue selection discipline
- execution isolation
- independent verification
- auditable state
- human-controlled merge authority

If those five properties hold, OpenClaw Code can expand safely later.
