---
summary: "Concise summary of which external projects openclawcode evaluated and what ideas were worth borrowing"
read_when:
  - You want a quick index of external borrowing work without rereading every source note
  - You need a compact explanation of what TDD means in the openclawcode roadmap
title: Borrowed Projects Summary
---

# Borrowed projects summary

This document summarizes which external projects were explicitly evaluated for
`openclawcode`, and what ideas were worth borrowing from each one.

The goal is not code transplant. The goal is to keep one compact reference for
the highest-value product, workflow, and architecture ideas that were extracted
from earlier evaluation notes.

The longer source notes remain:

- [Third-Party Skill Evaluation](/openclawcode/third-party-skill-evaluation)
- [ClaudeCode Borrowing Notes](/reference/claudecode-borrowing)
- [OpenAI Codex Borrowing Notes](/reference/openai-codex-borrowing)
- [Borrowing Delivery Plan](/openclawcode/borrowing-delivery-plan)

## At a glance

### `obra/superpowers`

Main borrowing direction:

- stronger pre-code workflow discipline
- explicit `brainstorm -> spec -> plan -> code -> review` stages
- TDD-first implementation behavior
- isolated worktrees and fresh subagents as normal execution practice

What this means for `openclawcode`:

- do not jump from a vague request directly into code
- make plan approval visible before execution starts
- keep implementation slices small and verifiable

### `affaan-m/everything-claude-code`

Main borrowing direction:

- clearer command -> capability -> agent mapping
- explicit quality-gate behavior
- continuous learning from repeated failures and manual recoveries
- loop-health and context-budget diagnostics
- mode-specific contexts for development, review, and research

What this means for `openclawcode`:

- make operator status surfaces more self-explanatory
- expose quality, failure, and recovery signals in normal chat and CLI paths
- keep runtime roles legible instead of hiding everything behind one prompt

### `karpathy/autoresearch`

Main borrowing direction:

- smaller mutable execution surfaces
- fixed evaluation budgets
- explicit keep/discard/advance rules
- durable attempt ledgers
- treat the autonomous loop itself as a versioned program artifact

What this means for `openclawcode`:

- narrow scope whenever a safe file or directory allowlist is possible
- make retry, rejection, and advancement decisions inspectable
- keep autonomous execution policy explicit instead of implicit

### `ClaudeCode`

Main borrowing direction:

- one clearer tool-surface assembly layer
- first-class "background the current session" UX
- stronger session history and recovery ergonomics
- clearer bridge and remote-control subsystem boundaries
- explicit coordinator/worker multi-agent orchestration rules

What this means for `openclawcode`:

- operators should be able to see which tool surface is active and why
- detached/background sessions should be easy to inspect and continue
- planner, coder, verifier, and coordinator roles should have clearer contracts

### `openai/codex`

Main borrowing direction:

- clearer workspace-guidance and project-doc contracts
- cleaner sandbox selection and execution-routing boundaries
- typed escalation outcomes such as run, approval-required, and deny
- smaller and more explicit config surfaces
- skill enablement and approval-reviewer concepts with tighter contracts

What this means for `openclawcode`:

- keep the richer runtime model, but describe it more precisely
- make approval and execution routing easier to reason about
- prefer explicit config concepts over growing special-case flags

## TDD

`TDD` means `test-driven development`.

In the simplest form, it is the habit of:

1. write or define a failing test for the behavior you want
2. make the smallest code change that makes the test pass
3. clean up the implementation while keeping the tests green

This is often described as `red -> green -> refactor`:

- `red`: the new test fails, proving the behavior is not implemented yet
- `green`: the smallest change makes the test pass
- `refactor`: improve the code without changing behavior

Why it matters in the borrowing notes:

- it pushes work toward small, verifiable slices
- it reduces vague "I think this should work" changes
- it makes bugfixes prove the regression is actually covered
- it gives verifier/reviewer stages a clearer behavioral target

In `openclawcode`, the borrowed meaning of TDD is not "write huge test suites
first no matter what." It is mainly:

- define observable expected behavior before broad edits
- prefer behavior-level proof over internal guesswork
- keep each execution slice small enough that a failing test or check can guide
  the implementation

## Practical reading

If you only need the shortest mapping:

- `superpowers`: workflow discipline
- `everything-claude-code`: operator harness and quality visibility
- `autoresearch`: minimal autonomous-loop discipline
- `ClaudeCode`: product ergonomics and multi-agent orchestration
- `Codex`: boundary clarity and contract design

## Boundary

These projects were treated as idea sources, not templates to clone.

The recurring rule across all evaluations is:

- borrow the contract or product pattern
- adapt it onto `openclawcode`'s stronger runtime/task/plugin model
- avoid direct code lifts when the surrounding runtime assumptions differ
