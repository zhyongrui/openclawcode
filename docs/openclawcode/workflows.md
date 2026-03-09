# OpenClaw Code Assistant Workflows

## Purpose

This document defines the operational workflow for OpenClaw Code Assistant, with special focus on failure branches, retry behavior, and escalation paths.

The main principle is simple:

The system should prefer clear state transitions over hidden improvisation.

## Primary Workflow

The main workflow for a suitable issue is:

`issue received -> classify -> plan -> retrieve context -> build -> open draft PR -> verify -> human review or escalation`

This is the default happy path, but every stage must also define what happens when things go wrong.

## Workflow Overview

### Happy Path

1. An issue is selected by a human or trigger
2. The classifier checks whether the issue is suitable
3. The planner creates an execution spec
4. The retriever collects relevant implementation context
5. The builder creates a branch and implements the change
6. The system opens a draft PR
7. The verifier evaluates the PR against the issue and acceptance criteria
8. If verification is strong enough, the result is marked ready for human review
9. A human decides whether to merge

This is only the successful path. The more important design work is what happens when the path breaks.

## State Model

Suggested workflow states:

- `issue_received`
- `classifying`
- `rejected`
- `planning`
- `plan_blocked`
- `retrieving_context`
- `context_blocked`
- `ready_to_build`
- `building`
- `build_blocked`
- `draft_pr_opened`
- `verifying`
- `changes_requested`
- `approved_for_human_review`
- `escalated`
- `completed`

Each transition should be logged with a reason.

## Step-by-Step Workflow

### 1. Issue Received

Entry conditions:

- a human manually selects an issue
- or a configured GitHub trigger selects the issue

Actions:

- store issue snapshot
- create workflow run id
- capture repository context
- move to `classifying`

Failure branch:

- if issue payload cannot be loaded, move to `escalated`
- reason: intake failure or repository access failure

## 2. Classification

Goal:

- decide whether the issue is suitable for autonomous handling

Checks:

- issue clarity
- likely scope size
- risk category
- expected file impact
- presence of testable acceptance conditions

Success branch:

- if suitable, move to `planning`

Failure branch:

- if unsuitable, move to `rejected`
- record reasons such as vague requirements, migration risk, auth risk, or excessive scope

Escalation branch:

- if issue might be valuable but needs a human decision, move to `escalated`
- example: issue mixes a small bug fix with a risky subsystem change

## 3. Planning

Goal:

- convert the issue into a structured execution spec

Planner output should include:

- summary
- problem statement
- acceptance criteria
- non-goals
- expected code areas
- required tests
- risk level
- unresolved questions

Success branch:

- if execution spec is credible, move to `retrieving_context`

Failure branch:

- if the planner cannot derive a useful execution spec, move to `plan_blocked`

Escalation branch:

- if unresolved questions materially affect correctness, move to `escalated`
- reason: human clarification required

Retry policy:

- planner may retry once with narrowed instructions or added context
- if still blocked, escalate rather than looping

## 4. Context Retrieval

Goal:

- gather the minimum useful context for implementation and verification

Retriever targets:

- likely source files
- nearby tests
- configs and schemas
- recent commits in the same area

Success branch:

- if context is relevant and bounded, move to `ready_to_build`

Failure branch:

- if retrieval is too broad or too weak, move to `context_blocked`

Escalation branch:

- if the retriever identifies too many candidate files or conflicting architecture signals, move to `escalated`
- reason: context ambiguity too high

Retry policy:

- allow one retrieval refinement pass
- if the candidate set is still too broad, stop and escalate

## 5. Build Preparation

Goal:

- set up a safe implementation environment

Actions:

- create or switch to a working branch
- prepare isolated workspace or worktree
- bind builder scope to planned file areas when possible

Success branch:

- move to `building`

Failure branch:

- if branch creation or workspace setup fails, move to `build_blocked`

Escalation branch:

- if repository state is unsafe or dirty in a way that prevents trustworthy work, move to `escalated`

## 6. Building

Goal:

- implement the planned change
n
Builder actions:

- edit code
- add or update tests
- keep modifications within expected scope
- generate implementation summary

Success branch:

- if a coherent change is produced, open a draft PR and move to `draft_pr_opened`

Failure branch:

- if implementation cannot be completed, move to `build_blocked`
- examples: repeated tool failures, contradictory code paths, inability to preserve expected behavior

Escalation branch:

- if changed files exceed planned scope significantly, move to `escalated`
- if builder detects hidden architecture coupling, move to `escalated`
- if the issue appears mis-specified during implementation, move to `escalated`

Retry policy:

- allow limited revision attempts inside the builder stage only for local, well-understood problems
- do not keep retrying if the builder is discovering new uncertainty each time

## 7. Draft PR Creation

Goal:

- surface the current implementation in a reviewable form

PR contents should include:

- issue link
- execution summary
- acceptance checklist
- tests run
- known risks or limitations

Success branch:

- move to `verifying`

Failure branch:

- if PR publishing fails but the branch exists, move to `escalated`
- reason: publish failure requiring human inspection

## 8. Verification

Goal:

- independently determine whether the issue is actually solved

Verifier actions:

- re-read the issue
- inspect the diff
- inspect or run checks
- map implementation to acceptance criteria
- identify defects, omissions, and risks

Success branch:

- if criteria are met with sufficient confidence, move to `approved_for_human_review`

Failure branch:

- if fix is incomplete or incorrect, move to `changes_requested`

Escalation branch:

- if verifier cannot determine correctness with confidence, move to `escalated`
- examples: missing observability, flaky tests, unclear acceptance target, suspicious side effects

Important rule:

- verifier approval means only "good enough for human final review" in the MVP
- verifier approval does not mean automatic merge

## 9. Revision Loop

The revision loop starts when the verifier returns `changes_requested`.

Flow:

1. verifier produces structured findings
2. orchestrator checks retry count
3. if retries remain, builder receives targeted feedback
4. builder revises the implementation
5. updated draft PR returns to verification

Success branch:

- revised change passes verification and moves to `approved_for_human_review`

Failure branch:

- revision still fails verification and retries are exhausted

Escalation branch:

- repeated or contradictory findings move the run to `escalated`

Recommended retry policy:

- maximum 2 full revision rounds after the first verification failure
- escalate earlier if the same issue category appears twice

Examples of escalate-now conditions:

- the verifier keeps reporting that the issue itself is underspecified
- each revision expands file scope further
- tests pass but acceptance criteria remain unmet
- builder and verifier disagree about core expected behavior

## 10. Human Review

Goal:

- give a human the final merge decision in the MVP

Inputs to the human reviewer:

- issue
- execution spec
- PR
- verifier report
- test results
- risk notes

Possible outcomes:

- merge manually
- request manual follow-up changes
- close or abandon the run
- relabel the issue as not suitable for automation

## Failure Branch Summary

The system should treat the following as first-class failure branches.

### Rejected

Use when:

- issue is clearly unsuitable from the start
- no amount of iteration would make it a safe autonomous target

Examples:

- major migration
- auth redesign
- vague feature request

### Blocked

Use when:

- the current stage cannot proceed, but the issue itself may still be valid

Blocked states:

- `plan_blocked`
- `context_blocked`
- `build_blocked`

These states should preserve enough data for later human or system retry.

### Changes Requested

Use when:

- the build exists, but the verifier found fixable shortcomings
- there is still a plausible path to convergence within retry limits

### Escalated

Use when:

- uncertainty is too high
- risk is too high
- retries are exhausted
- the issue requires human judgment
- infrastructure or repository conditions prevent reliable automation

Escalation is not failure. It is a controlled transfer of responsibility.

## Escalation Triggers

The system should escalate on any of the following:

- issue ambiguity prevents a trustworthy execution spec
- retrieval returns an unbounded or conflicting file set
- builder change scope exceeds planned scope materially
- repository state is unsafe or inconsistent
- tests are inconclusive or flaky in a way that blocks confidence
- verifier cannot map the implementation to acceptance criteria
- repeated revision loops do not converge
- security-sensitive or policy-restricted code is touched

## Logging Requirements Per State

Each state transition should capture:

- prior state
- next state
- timestamp
- reason code
- short human-readable explanation
- artifact references produced by the stage

This makes the workflow auditable and debuggable.

## Example Failure Scenarios

### Scenario A: Vague Issue

- issue received
- classifier marks issue as borderline suitable
- planner cannot define concrete acceptance criteria
- workflow moves to `escalated`
- output asks for human clarification

### Scenario B: Good Plan, Bad Verification

- issue classified as suitable
- planner produces strong execution spec
- builder implements change and opens draft PR
- verifier finds that one acceptance criterion is still unmet
- workflow moves to `changes_requested`
- builder gets targeted revision task
- second verification passes
- workflow moves to `approved_for_human_review`

### Scenario C: Scope Explosion

- issue looks small initially
- retriever identifies many relevant modules
- builder touches far more files than planned
- orchestrator detects scope drift
- workflow moves to `escalated`

### Scenario D: Non-Converging Loop

- verifier requests changes
- builder revises
- verifier requests changes again on the same core behavior
- retry budget is exhausted
- workflow moves to `escalated`

## Practical Rule of Thumb

At every step, the system should ask:

- do we know enough to continue?
- is the current scope still bounded?
- is the next action reversible?
- if we are wrong here, who catches it?

If those questions do not have strong answers, the workflow should stop and escalate.

## Bottom Line

A reliable workflow is defined as much by its failure handling as by its happy path.

For this project, the most important operational behaviors are:

- reject unsuitable work early
- block cleanly when a stage cannot proceed
- revise only within clear retry limits
- escalate when ambiguity, risk, or repeated failure crosses a threshold
- keep every transition explicit and auditable
