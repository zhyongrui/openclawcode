# OpenClaw Code Auto-Merge Policy

This document defines the current narrow auto-merge policy used by
`openclawcode`.

## Goal

Auto-merge is intentionally conservative.

The current policy is designed for low-risk command-layer runs where:

- verification already approved the run
- suitability already accepted autonomous execution
- the change set stayed narrow enough to avoid hidden blast radius

If any one of those conditions is not true, auto-merge is blocked and a human
merge or promotion decision is required.

## Eligible Runs

`openclawcode` currently allows auto-merge only when all of the following are
true:

1. the workflow reached `ready-for-human-review` or is already `merged`
2. verification decision is `approve-for-human-review`
3. suitability decision is `auto-run`
4. no manual suitability override was used
5. build classification is `command-layer`
6. the scope check passed
7. no generated files changed
8. the change set did not trigger the large-diff guardrail
9. the change set did not trigger the broad fan-out guardrail

When every condition above is satisfied, the current derived reason is:

- `Eligible for auto-merge under the current command-layer policy.`

## Block Reasons

The current implementation blocks auto-merge for these exact classes of
reasons:

- verification has not approved the run
- suitability did not accept autonomous execution
- a manual suitability override was used
- the run is not classified as `command-layer`
- the scope check did not pass
- generated files were changed
- the large-diff threshold was exceeded
- the change set touched too many files or directories
- the run completed without code changes or a pull request

## Operator Consequences

When auto-merge is blocked:

- `/occode-status owner/repo#issue` shows the current block reason
- `/occode-policy owner/repo#issue` shows the same issue-specific block reason
- `/occode-policy owner/repo` shows the default baseline policy and override
  entrypoints
- merge exceptions remain explicit human actions through:
  - `/occode-gate-decide owner/repo merge-promotion approved [note]`

## Why This Is Narrow

This policy explicitly excludes:

- manual suitability exceptions
- mixed-scope or workflow-core runs
- generated output refreshes
- broad refactors
- large fan-out edits

That keeps auto-merge aligned with “small, command-layer, policy-clean”
changes rather than making it a general-purpose merge shortcut.

## Source Of Truth

The runtime source of truth is:

- [workflow-derived.ts](/home/zyr/pros/openclawcode/src/openclawcode/workflow-derived.ts)

The chat-visible policy surface is:

- `/occode-policy`
