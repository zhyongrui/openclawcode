# Upstream Sync Policy

## Purpose

This document defines how `openclawcode` should stay aligned with upstream
OpenClaw while continuing product development in this repository.

The goal is not zero divergence.
The goal is controlled divergence with manageable merge cost.

## Repository Model

The intended model is:

- `openclawcode` is the main product repository
- upstream OpenClaw is tracked as `upstream`
- product-specific logic is concentrated in clearly owned areas
- upstream sync happens regularly instead of being delayed for long periods

## Conflict Reduction Rules

To reduce merge conflicts:

- keep product code concentrated in dedicated directories
- avoid large style-only edits to upstream-derived files
- avoid broad renames in shared platform areas
- keep OpenClaw core patches small and easy to explain
- record why each direct OpenClaw-core touchpoint exists

## Directory Discipline

Preferred ownership pattern:

- upstream-derived platform areas: keep changes minimal
- `src/integrations/openclaw-plugin/`: OpenClaw-facing adapter code
- workflow core modules: product-specific logic
- product docs: strategy, policy, and workflow semantics

This reduces the surface area that collides with upstream updates.

## Sync Cadence

Recommended cadence:

- sync upstream `main` 1 to 2 times per week by default
- sync sooner when upstream changes touch areas this repository also changes
- always sync before major releases

Do not wait for very large divergence.
Do not merge every upstream commit immediately unless a hotfix requires it.

## Merge Strategy

Default strategy:

- `git fetch upstream`
- merge `upstream/main` into a dedicated sync branch
- resolve conflicts there
- run validation
- merge the sync branch into this repository's `main`

Prefer merge over routine rebase for upstream syncing unless there is a
specific reason to rewrite history.

## Validation After Each Sync

At minimum, after each upstream sync:

- run type checks
- run core workflow tests
- run OpenClaw adapter tests
- inspect any files with direct OpenClaw-core edits

## Change Classification

Every non-trivial OpenClaw-touching change should be mentally classified as one
of:

- `low-friction`: mostly isolated product code or additive extension points
- `upstream-candidate`: generally useful capability worth proposing upstream later
- `high-friction`: direct core modification that is likely to conflict again

The project should minimize `high-friction` changes.

## Decision Rule

When adding a feature, ask:

- can this live in product-owned modules instead of shared core files?
- does this need a direct OpenClaw core change?
- if upstream changes next week, will this be painful to merge?
- is this actually product logic rather than platform logic?

If it is product logic, keep it in product-owned modules whenever possible.
