# Code Assistant Specs

## Objective

Build a GitHub-native engineering workflow layer that uses OpenClaw as the execution substrate while keeping planning, building, verification, and documentation explicit.

For the stricter MVP boundary and delivery model, see `docs/mvp-spec-v1.md`.
For the recommended implementation path on top of the current OpenClaw
codebase, see `docs/openclaw-implementation-plan.md`.

## Core Workflow

1. Intake a GitHub issue.
2. Convert it into an internal `WorkflowRun`.
3. Generate an `ExecutionSpec`.
4. Execute implementation work.
5. Run verification.
6. Produce a PR-ready result.
7. Escalate to human review where needed.

## Core Types

### `IssueRef`

Represents the source GitHub issue.

### `ExecutionSpec`

Defines implementation summary, scope, out-of-scope items, acceptance criteria, test plan, and risks.

### `BuildResult`

Captures branch information, commits, changed files, tests, and notes.

### `VerificationReport`

Captures the verifier decision, findings, missing coverage, and follow-up work.

### `WorkflowRun`

The canonical execution object that moves through all workflow stages.
It now also carries timestamps, transition history, attempt counters, and draft PR metadata so runs can be audited and resumed.

### `WorkflowWorkspace`

Represents the isolated repository context prepared for a workflow run, including repository root, base branch, run branch, and worktree path.

## Stage Model

- `intake`
- `planning`
- `building`
- `draft-pr-opened`
- `verifying`
- `changes-requested`
- `awaiting-human`
- `ready-for-human-review`
- `merged`
- `escalated`
- `failed`

## OpenClaw Integration Direction

`openclawcode` is the main product repository.
The current implementation direction is to evolve it as a controlled
OpenClaw-derived product while keeping the OpenClaw-facing adapter in this same
repository.

That means:

- product-specific workflow logic lives here
- OpenClaw-facing adapter code lives here
- upstream OpenClaw should be synced into this repository deliberately and often enough to avoid large drift
- any OpenClaw-side shim should stay thin

The likely landing areas in the OpenClaw repository are:

- command entrypoints for workflow execution
- agent or skill integration points
- plugin-facing adapters for GitHub issue ingestion
- delivery/reporting hooks for status updates and PR generation

## Current MVP Boundary

Current implementation work is limited to:

- stable workflow domain model
- orchestrator scaffold
- GitHub payload mapping
- PR summary generation
- run persistence and audit-friendly stage tracking
- isolated run workspace preparation
- in-repo OpenClaw adapter scaffolding
- documentation and testability groundwork

The next product-level target is to formalize:

- suitability gating
- independent verification
- merge gating
- OpenClaw runtime bridging
