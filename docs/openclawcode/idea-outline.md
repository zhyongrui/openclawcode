# OpenClaw Code Assistant Idea Outline

## Vision

Build OpenClaw into a code-focused private assistant that can work around GitHub issues and pull requests.

The core workflow is:

1. Read a GitHub issue
2. Turn the issue into an executable implementation plan
3. Make code changes on a branch
4. Open a pull request
5. Have another assistant review and test the pull request
6. If the change is correct, merge it
7. If the change is incomplete or risky, send structured feedback and continue iterating

This is not just "automatic coding". The more valuable goal is an end-to-end software delivery loop with traceability, testing, review, and controlled autonomy.

## Why This Direction Makes Sense

This idea is strong because it connects OpenClaw to a real engineering workflow instead of treating it as a general chat agent.

Potential value:

- Turn GitHub issues into actionable engineering work
- Reduce the overhead of small and medium-sized software tasks
- Keep implementation, review, and testing connected in one loop
- Create a practical autonomous workflow for personal projects or small teams
- Make work auditable through issues, PRs, test logs, and review comments

## Core Workflow

A robust version of the workflow should look like this:

1. Issue ingestion
2. Planning and spec generation
3. Implementation in an isolated branch
4. Pull request creation
5. Independent review and verification
6. Revision loop if needed
7. Merge or human escalation

In short:

`issue -> plan -> build -> PR -> verify -> merge or escalate`

## Major Risks and Gaps

The biggest problem is not whether an agent can write code. The real problem is how to prevent the system from confidently producing the wrong answer.

### 1. Issues Are Often Too Ambiguous

Many GitHub issues are not executable specifications. They are often incomplete, under-scoped, or written as rough ideas.

Risk:

- The development agent builds something that sounds reasonable but does not match the real intent

Required improvement:

- Convert every issue into a structured execution spec before implementation starts

### 2. Review Can Become Superficial

If the review agent only reads the PR diff and does not independently read the original issue, comments, and related files, it may perform only a shallow review.

Risk:

- The system checks style and syntax while missing that the implementation does not solve the issue

Required improvement:

- The review agent must independently re-read the original issue and evaluate the PR against the acceptance criteria

### 3. Existing Tests Are Not Enough

Passing the current test suite does not prove that the issue was fixed correctly.

Risk:

- The agent changes behavior without covering the new scenario
- Existing tests miss regressions in untested paths

Required improvement:

- Require issue-linked tests, not just green CI
- For bug fixes, reproduce the bug and add a regression test

### 4. Shared Wrong Assumptions Across Agents

If both development and review agents rely on the same mistaken interpretation, they can reinforce the same error.

Risk:

- Incorrect work gets approved because all agents inherited the same flawed context

Required improvement:

- Keep the verifier as independent as possible from the builder

### 5. Infinite or Low-Value Iteration Loops

The dev agent and review agent can end up bouncing the same feedback back and forth without converging.

Risk:

- Wasted cycles
- Busy-looking work without progress

Required improvement:

- Add retry limits and escalation rules

### 6. Dangerous Permissions

If the system can directly push, merge, or alter high-risk code without guardrails, mistakes become expensive.

Risk:

- Incorrect changes land on main
- Security-sensitive areas are modified without review

Required improvement:

- Use staged permissions and risk-based merge policies

### 7. Context Selection Problems

Real repositories have too much code and history. Poor context retrieval will lead to poor implementation.

Risk:

- The agent edits the wrong files
- The review misses relevant architecture or historical decisions

Required improvement:

- Add context retrieval for related files, past issues, PRs, and commits

### 8. Non-Code Judgments Are Hard

Architecture tradeoffs, compatibility decisions, migration plans, and product choices are often not testable in a simple way.

Risk:

- The agent makes product or system design choices that should have stayed human-controlled

Required improvement:

- Route high-ambiguity or high-risk work to humans

### 9. Gaming the Tests

An agent may optimize for passing tests rather than solving the actual issue.

Risk:

- Weak or misleading tests
- Changed assertions to force green CI
- Real behavior still broken

Required improvement:

- Separate functionality validation from test status
- Verify that test additions are meaningful

### 10. Hidden Regressions

Some regressions are not easy to detect with unit tests alone.

Examples:

- performance regressions
- UI regressions
- concurrency issues
- security and permission bugs

Required improvement:

- Add layered verification rather than relying on one test type

## Recommended Agent Roles

A stronger model is not just two agents. It should use at least four roles with explicit responsibilities.

### Planner

Responsibilities:

- Read the issue and comments
- Understand scope and constraints
- Produce a structured execution plan
- Identify ambiguities and risks
- Define acceptance criteria

### Builder

Responsibilities:

- Implement the planned changes
- Add or update tests
- Prepare commits and PR content
- Report unresolved risks or assumptions

### Verifier

Responsibilities:

- Independently read the issue and the PR
- Run tests and checks
- Compare implementation against acceptance criteria
- Approve, request changes, or escalate

### Gatekeeper

Responsibilities:

- Enforce policy
- Decide whether the PR can merge automatically
- Escalate higher-risk changes to a human

This creates a cleaner system:

`Planner -> Builder -> Verifier -> Gatekeeper`

## Input and Output Contracts

Agents should not communicate only through loose prose. Each role should have a structured input and output contract.

### Planner Output

Suggested fields:

- issue summary
- problem statement
- acceptance criteria
- non-goals
- expected file areas
- risks
- unclear questions
- recommended task type
- risk level
- whether human clarification is required

### Builder Output

Suggested fields:

- files changed
- implementation summary
- tests added or updated
- known limitations
- assumptions made
- PR title and description draft

### Verifier Output

Suggested fields:

- acceptance criteria evaluation
- test results summary
- code review findings
- risk assessment
- final decision: approve, request changes, escalate

These contracts reduce drift and make the workflow auditable.

## Turn Issues into Execution Specs

This is one of the most important design improvements.

Instead of sending raw issue text directly into coding, first convert it into an execution spec.

Example:

```yaml
issue_id: 123
goal: Fix session timeout not persisting after restart
acceptance_criteria:
  - timeout setting survives restart
  - existing default behavior remains unchanged when unset
  - config validation rejects negative values
non_goals:
  - no UI redesign
  - no config format migration
files_expected:
  - src/config/*
  - src/session/*
required_tests:
  - unit tests for config parsing
  - integration test for restart persistence
risk_level: medium
human_clarification_needed: false
```

This gives both builder and verifier a concrete target.

## Quality Gates Before Merge

A PR should not merge because it merely looks fine. It should pass explicit gates.

Suggested gates:

- acceptance criteria are satisfied one by one
- required tests were added or updated
- lint, typecheck, and test commands are green
- restricted areas were not modified unexpectedly
- PR description explains what changed, what did not change, and what risks remain
- medium or high-risk changes require human confirmation

Possible scoring dimensions:

- feature completeness
- test quality
- requirement alignment
- code change reasonableness
- risk level

## Permission Model

Do not start with full autonomy.

Use staged permissions.

### Level 0

- read issues
- read code
- produce plans

### Level 1

- create branches
- edit code
- commit changes
- open draft PRs

### Level 2

- automatically merge low-risk PRs that satisfy strict gates

Recommended starting point:

- Stop at Level 1 first
- Allow auto-merge only later and only for a narrow class of low-risk issues

## Failure and Escalation Rules

The system should not loop forever.

Recommended rules:

- set a maximum number of automatic revision rounds, such as 2 or 3
- escalate to a human if the same class of feedback repeats
- escalate if changed files exceed the planned scope significantly
- escalate if the issue remains ambiguous after planning
- escalate immediately for risky or security-sensitive modifications

## Independence of Review

The verifier should not simply inherit the builder's reasoning.

A better order is:

1. Read the issue independently
2. Read the PR diff independently
3. Run checks
4. Only then consult the builder's explanation if needed

This reduces correlated mistakes.

## Testing Strategy

Testing should be layered.

Suggested layers:

- unit tests for local logic
- integration tests for workflow correctness
- regression tests tied directly to the issue
- static checks such as linting and type checking
- optional security, performance, or snapshot checks where relevant

For bug fixes, the best pattern is:

1. reproduce the bug
2. add a failing test
3. implement the fix
4. make the test pass

## Best Task Types for Early Automation

Start with low-risk, high-clarity tasks.

Good first targets:

- small bug fixes
- documentation fixes
- missing test coverage
- limited-scope refactors
- low-risk dependency updates
- narrow CLI or config changes

Avoid full automation at first for:

- large architectural refactors
- security-sensitive features
- permissions or auth systems
- data migrations
- broad cross-module changes
- product requests with unclear requirements

## Refined Product Framing

A better framing for the system is:

OpenClaw Code Assistant is a GitHub-native autonomous engineering workflow that turns issues into structured plans, implements changes in isolated branches, opens PRs, verifies them against acceptance criteria, runs tests, and either merges low-risk work or escalates to humans.

This is stronger than positioning it as an automatic coder. It is an automated software delivery loop with human-aware controls.

## Three Extra Capabilities Worth Adding

### 1. Task Classifier

Purpose:

- determine whether an issue is suitable for autonomous handling
- route unsuitable work to humans early

### 2. Context Retriever

Purpose:

- find relevant files
- find similar past issues and PRs
- retrieve related commits and architecture notes

### 3. Audit Log

Purpose:

- record what context the system used
- record what decisions were made
- show why a PR was approved, rejected, or escalated

These improve reliability and explainability.

## Suggested Rollout Plan

### Phase 1

- issue to plan
- plan to code changes
- open draft PR
- no automatic merge

### Phase 2

- add independent verifier
- allow automatic request-changes feedback
- still no automatic merge for most work

### Phase 3

- allow auto-merge only for low-risk tasks with strict gates

### Phase 4

- add better retrieval, historical learning, and multi-agent optimization

This phased rollout is safer than trying to automate everything from day one.

## Bottom Line

The idea is good, but it should be built as an engineering system, not just a pair of agents writing and reviewing code.

The most important additions are:

- structured issue-to-spec conversion
- explicit acceptance criteria
- independent verification
- quality gates
- staged permissions
- escalation rules
- traceability and auditability

In short, the real goal is not just:

`issue -> code`

It is:

`issue -> spec -> build -> verify -> gate -> merge or escalate`
