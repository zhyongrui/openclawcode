# OpenClaw Code Assistant MVP

## Goal

The MVP should prove that OpenClaw can take a well-scoped GitHub issue, produce a plan, make code changes in an isolated branch, open a draft PR, and run an independent verification pass.

The MVP is not trying to fully automate software engineering. It is trying to validate the smallest reliable loop.

Core MVP loop:

`issue -> plan -> build -> draft PR -> verify -> human decision`

## MVP Product Thesis

If the system can reliably handle a narrow class of low-risk issues end to end, then it can later expand toward more autonomy.

The MVP succeeds if it can do the following for selected issues:

- understand the issue well enough to create an execution spec
- identify likely relevant files
- implement a bounded change
- add or update tests when appropriate
- open a draft PR with a clear description
- run checks and produce a useful review verdict
- stop and escalate when confidence is low

## What the MVP Should Include

### 1. GitHub Issue Intake

The system should be able to read:

- issue title
- issue body
- labels
- comments
- repository metadata

The intake layer should normalize this into an internal issue record.

### 2. Issue Suitability Check

Before doing any coding, the system should decide whether the issue is suitable for autonomous handling.

Initial suitability rules:

- issue is clearly scoped
- issue does not involve migrations, auth, or security-sensitive code
- issue does not require major architecture changes
- expected file impact is limited
- acceptance criteria can be inferred or defined

If unsuitable, the system should stop and explain why.

### 3. Planner

The planner should convert the issue into a structured execution spec.

Minimum planner output:

- issue summary
- problem statement
- acceptance criteria
- non-goals
- expected code areas
- required tests
- risk level
- clarification needed flag

If the planner cannot create a credible execution spec, the issue should be escalated.

### 4. Repository Context Retrieval

The system should retrieve enough context to support implementation.

Minimum retrieval targets:

- relevant files by path and keyword match
- test files near the implementation area
- related configuration files
- recent commits touching the same area if available

The MVP does not need perfect semantic search. Practical heuristics are enough.

### 5. Builder

The builder should:

- create a working branch
- edit files
- add or update tests when appropriate
- generate a concise implementation summary
- prepare a PR title and body draft

The builder should operate only inside a bounded file set unless explicitly expanded.

### 6. Draft PR Creation

The system should create a draft PR, not a final merge-ready PR.

The PR body should include:

- issue reference
- implementation summary
- acceptance criteria checklist
- tests run
- known limitations
- risk notes

### 7. Verifier

The verifier should independently review the result.

Minimum verifier duties:

- re-read the issue
- inspect the diff
- run configured checks
- compare the result against acceptance criteria
- produce a verdict

Allowed verdicts in the MVP:

- approve_for_human_review
- request_changes
- escalate

The verifier should not merge automatically in the MVP.

### 8. Human-in-the-Loop Final Decision

For the MVP, the final merge decision stays with the human.

This is important because the MVP is validating reliability, not proving full autonomy.

## What the MVP Should Explicitly Exclude

The MVP should not include:

- automatic merging to the default branch
- support for broad architectural refactors
- support for data migrations
- support for auth, permissions, or security-sensitive changes
- support for multi-repository orchestration
- support for ambiguous product requests
- self-directed issue picking without explicit policy
- autonomous issue comment negotiation with external collaborators

These are all later-phase features.

## Recommended First-Class Task Types

The MVP should start with a narrow set of issue categories.

Recommended issue types:

- small bug fixes
- targeted test additions
- documentation fixes tied to code behavior
- low-risk CLI or config fixes
- narrowly scoped refactors with clear acceptance criteria

Good examples:

- a config value is not persisted correctly
- a CLI flag is parsed incorrectly
- an error message is misleading
- a missing regression test should be added

Bad examples for the MVP:

- redesign the session architecture
- improve authentication flow
- add a complex new subsystem
- migrate storage formats
- redesign UX across multiple screens

## Minimal Role Model

The MVP can use three main roles instead of four.

### Planner

Produces the execution spec.

### Builder

Implements the change and opens the draft PR.

### Verifier

Evaluates the PR and produces a structured verdict.

The Gatekeeper role can remain human-controlled in the MVP.

## Suggested State Machine

A simple state machine keeps the workflow understandable.

States:

- `issue_received`
- `issue_rejected`
- `planning`
- `plan_failed`
- `ready_to_build`
- `building`
- `build_failed`
- `draft_pr_opened`
- `verifying`
- `changes_requested`
- `approved_for_human_review`
- `escalated`
- `completed`

This is enough for the first version.

## Acceptance Criteria for the MVP Itself

The MVP is successful if it can reliably do all of the following on a controlled set of test issues:

- reject unsuitable issues instead of forcing low-confidence work
- produce a structured plan for suitable issues
- generate a bounded implementation in a branch
- create a draft PR with a useful description
- run tests and checks
- produce a verifier decision with clear reasoning
- avoid infinite revision loops
- preserve traceability for each run

## Confidence and Escalation Rules

The MVP should prefer stopping over pretending.

Escalate when:

- issue requirements are unclear
- too many files appear relevant
- the builder cannot complete the change cleanly
- tests fail in unrelated areas and block interpretation
- the verifier cannot determine whether acceptance criteria are satisfied
- the same issue has already failed multiple automated attempts

A conservative system is better than an overconfident one.

## MVP Data to Capture

Each run should log structured artifacts.

Minimum artifacts:

- issue snapshot
- execution spec
- selected files and retrieved context summary
- patch or commit references
- tests and check results
- verifier report
- final status

These artifacts will be critical for later tuning.

## Suggested Interfaces

The MVP can be exposed through a simple command or workflow trigger.

Possible triggers:

- manually invoke on a GitHub issue
- trigger from an issue label such as `autofix-candidate`
- run from a local CLI against a repository and issue number

For the MVP, manual invocation is better than fully automatic triggering.

## Success Metrics

Useful MVP metrics:

- percentage of issues correctly rejected as unsuitable
- percentage of suitable issues reaching draft PR
- verifier agreement with human review
- percentage of runs needing escalation
- average number of revision loops per issue
- percentage of PRs that actually satisfy the issue on first pass

These metrics matter more than raw automation rate.

## Recommended MVP Rollout

### Stage 1

- manual issue selection
- planner only
- no code changes yet
- validate spec quality

### Stage 2

- planner plus builder
- local branch creation
- draft PR generation
- no automatic review decisions yet

### Stage 3

- planner plus builder plus verifier
- structured review verdicts
- human decides whether to merge

This lets the system earn trust in layers.

## Bottom Line

The MVP should focus on reliability, scope control, and traceability.

The right first version is not:

`fully autonomous coding agent`

It is:

`issue-driven draft-PR system with independent verification and human approval`
