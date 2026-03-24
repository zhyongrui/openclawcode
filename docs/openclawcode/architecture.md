# OpenClaw Code Assistant Architecture

## Purpose

This document describes a practical architecture for an issue-driven coding assistant built on top of OpenClaw concepts.

The system goal is to move from a GitHub issue to a verified pull request while keeping autonomy bounded, decisions auditable, and high-risk work gated.

For the newer blueprint-first target that goes beyond issue-driven execution,
see `blueprint-first-orchestration.md`.

For the phased delivery order of that blueprint-first track, see
`blueprint-first-delivery-plan.md`.

For the implementation path that maps this architecture onto the current
OpenClaw codebase, see `docs/openclaw-implementation-plan.md`.

## High-Level Architecture

At a high level, the system has six major layers:

1. Trigger and orchestration
2. Issue understanding and planning
3. Context retrieval
4. Code execution
5. Verification and policy gating
6. Persistence and audit

A simple flow looks like this:

`GitHub Issue -> Orchestrator -> Planner -> Context Retriever -> Builder -> Draft PR -> Verifier -> Human or Gatekeeper`

## Main Components

### 1. Trigger Layer

This layer decides when a workflow starts.

Possible triggers:

- manual CLI invocation
- issue label added on GitHub
- issue comment command
- scheduled queue scan

For the first versions, manual or label-based triggering is safest.

Responsibilities:

- receive trigger
- load repository and issue identifiers
- create a workflow run record
- hand off to the orchestrator

## 2. Orchestrator

The orchestrator is the central state manager.

Responsibilities:

- track workflow state
- call each stage in order
- apply retry limits
- stop on policy violations
- persist run metadata
- route failures to escalation

The orchestrator should be deterministic and policy-driven. It should not invent implementation decisions. It only coordinates the specialized components.

Suggested responsibilities by stage:

- create run context
- call suitability classifier
- call planner
- call retrieval
- call builder
- create draft PR
- call verifier
- decide next state

## 3. Suitability Classifier

Before spending resources on implementation, the system should classify whether the issue is suitable for autonomous handling.

Inputs:

- issue title
- issue body
- labels
- comments
- repository metadata

Outputs:

- suitable or unsuitable
- task category
- risk level
- reasons
- recommended next action

Typical unsuitable classes:

- architecture redesign
- auth or permission changes
- security-sensitive work
- data migration
- vague feature requests

This module is one of the most important guardrails.

## 4. Planner

The planner turns issue text into a structured execution spec.

Inputs:

- normalized issue record
- repository metadata
- optional relevant docs

Outputs:

- issue summary
- problem statement
- acceptance criteria
- non-goals
- likely file areas
- required test types
- assumptions
- open questions
- risk level

The planner should aim for structured output, not just narrative analysis.

## 5. Context Retriever

The context retriever gathers implementation context for the builder and verifier.

Inputs:

- execution spec
- repository path

Outputs:

- ranked relevant files
- nearby tests
- related configs
- recent commits in the same area
- optionally similar issues or PRs

Retrieval strategies can include:

- path heuristics
- keyword search
- symbol matching
- git history sampling
- simple embeddings later if needed

The retriever should also cap context volume so the builder is not flooded.

## 6. Builder

The builder is the implementation engine.

Responsibilities:

- create or switch to a working branch
- edit code in the repository
- add or update tests
- keep changes within expected scope when possible
- generate implementation notes
- prepare commit and PR metadata

Inputs:

- execution spec
- retrieved context
- repository path

Outputs:

- changed files
- patch or commit refs
- test changes
- implementation summary
- unresolved concerns

The builder should not have merge authority.

## 7. PR Publisher

Once the builder has produced a coherent change set, the system creates a draft PR.

Responsibilities:

- generate PR title
- generate PR body
- include issue links
- include acceptance checklist
- include tests run
- include warnings or limitations

Draft PRs are valuable because they surface work for review without over-claiming readiness.

## 8. Verifier

The verifier independently evaluates whether the PR actually addresses the issue.

Inputs:

- original issue
- execution spec
- PR diff
- test results
- repository context if needed

Responsibilities:

- re-read the issue independently
- compare implementation to acceptance criteria
- inspect code quality and change scope
- run or inspect checks
- identify missing tests or regressions
- produce a structured verdict

Outputs:

- acceptance criteria pass or fail map
- findings
- confidence score or confidence level
- decision: approve_for_human_review, request_changes, escalate

The verifier must be as independent as practical from builder reasoning.

## 9. Policy Gate

The policy gate determines what actions are allowed after verification.

Responsibilities:

- apply merge policy
- enforce risk thresholds
- require human approval when necessary
- prevent auto-merge in restricted scenarios

In the MVP, the policy gate should always require human final approval.

Later, it can support selective auto-merge for low-risk tasks.

## 10. Persistence and Audit Layer

Every workflow run should leave behind a structured audit trail.

Artifacts to persist:

- workflow run id
- issue snapshot
- execution spec
- retrieved context summary
- builder output summary
- PR metadata
- test results
- verifier report
- final decision and timestamps

This layer is critical for debugging, evaluation, and trust.

## Core Data Objects

The architecture becomes easier to reason about if the system uses explicit data objects.

### IssueRecord

Suggested fields:

- repository
- issue number
- title
- body
- labels
- comments
- author
- timestamps

### ExecutionSpec

Suggested fields:

- issue id
- summary
- acceptance criteria
- non-goals
- expected files
- required tests
- risk level
- clarification needed

### RetrievalPack

Suggested fields:

- relevant files
- supporting snippets
- nearby tests
- recent commits
- retrieval reasoning summary

### BuildResult

Suggested fields:

- branch name
- changed files
- commit ids
- test modifications
- implementation summary
- known limitations

### VerificationReport

Suggested fields:

- acceptance evaluation
- findings
- test summary
- risk notes
- verdict
- confidence

### WorkflowRun

Suggested fields:

- run id
- current state
- retries used
- timestamps
- artifact references

## State Machine

A bounded state machine helps prevent chaos.

Suggested states:

- `queued`
- `classifying`
- `rejected`
- `planning`
- `plan_blocked`
- `retrieving_context`
- `building`
- `build_blocked`
- `draft_pr_opened`
- `verifying`
- `changes_requested`
- `approved_for_human_review`
- `escalated`
- `merged`
- `closed`

Transitions should be explicit, logged, and policy-checked.

## Revision Loop Design

The revision loop should be controlled.

Recommended behavior:

- verifier returns structured feedback
- orchestrator checks retry count
- builder receives only the necessary revision context
- after a small number of retries, escalate to human review

This avoids endless cycles.

## Trust and Independence Design

One key architectural principle is independence between builder and verifier.

Recommended practice:

- verifier reads issue and diff first
- verifier reads builder notes only after its first-pass evaluation
- verifier uses its own acceptance mapping

This reduces shared blind spots.

## Security and Permission Design

Permissions should be split by capability.

Suggested capability buckets:

- read issue and repository
- create branch
- edit files
- commit changes
- push branch
- create draft PR
- merge PR
- modify labels or comments

The system should be able to operate with less than full repository authority.

MVP recommendation:

- allow read, branch, edit, commit, push, and draft PR
- do not allow auto-merge
- do not allow unrestricted issue comment spam

## Repository Isolation

Implementation should happen in a controlled workspace.

Recommended isolation approaches:

- per-run working directory
- dedicated branch naming convention
- optional disposable clone or worktree
- clean reset between runs

This reduces cross-run contamination.

## Testing and Checks Layer

The architecture should treat test execution as a first-class subsystem.

Possible checks:

- unit tests
- integration tests
- lint
- type checking
- formatting validation
- targeted regression tests
- optional security or performance checks

The system should distinguish:

- checks that failed because of the new change
- checks that were already failing
- checks that could not be run

That distinction matters for verifier quality.

## GitHub Integration Points

The system will likely need the following GitHub capabilities:

- read issue details
- read issue comments
- read repository metadata
- create branches or push commits
- open draft PRs
- read PR diffs and statuses
- optionally post review comments
- optionally merge PRs later

The architecture should isolate GitHub API access behind a dedicated adapter so the rest of the system is easier to test.

## Observability

This system needs strong observability because failures will often be subtle.

Recommended signals:

- state transition logs
- model call summaries
- retrieval summaries
- changed file counts
- test execution results
- verifier verdict distribution
- escalation reasons

This will help tune the workflow over time.

## Recommended Repository Structure

A practical repository structure for this project could look like this:

```text
openclaw-code-assistant/
  docs/
    idea-outline.md
    mvp.md
    architecture.md
  src/
    orchestrator/
    planner/
    classifier/
    retriever/
    builder/
    verifier/
    github/
    policy/
    models/
    audit/
  tests/
  scripts/
```

This structure aligns code organization with the workflow roles.

## Evolution Path

The architecture should evolve in stages.

### Early Stage

- manual trigger
- planner, builder, verifier
- human-controlled merge
- simple retrieval
- local audit records

### Mid Stage

- better issue classification
- richer retrieval and git-history awareness
- structured GitHub comments and feedback loops
- more reliable test routing

### Later Stage

- selective low-risk auto-merge
- repository-specific policy tuning
- historical learning from past runs
- multi-repo orchestration if needed

## Bottom Line

The architecture should optimize for bounded autonomy, independent verification, and full traceability.

The key architectural principle is simple:

Do not build a single agent that does everything.

Build a workflow system where each stage has a narrow responsibility, explicit inputs and outputs, and clear stopping conditions.
