# OpenClaw Strategy

## Purpose

This document defines how `openclawcode` should be built while using OpenClaw
as the platform base and continuing to absorb upstream improvements.

The selected strategy is:

- `openclawcode` is the main product repository
- OpenClaw remains the platform baseline
- upstream OpenClaw is tracked and merged into this repository regularly
- product logic stays concentrated in product-owned modules

This is a controlled fork strategy, not an unmanaged deep fork.

## Strategic Goal

The goal is to ship a GitHub-native engineering workflow product without
depending on upstream OpenClaw to accept product-specific code.

At the same time, the project should avoid drifting so far from OpenClaw that
upstream updates become prohibitively painful to adopt.

## Core Positioning

The relationship is:

- OpenClaw provides the assistant platform and execution substrate
- `openclawcode` provides the software-delivery workflow product

That means:

- platform capabilities should be reused where practical
- product-specific behavior should remain in product-owned modules
- upstream contribution is optional and selective, not a prerequisite for
  product progress

## Selected Repository Model

The chosen repository model is:

- keep one main product repository: `openclawcode`
- keep OpenClaw-facing adapter code in this same repository
- track upstream OpenClaw as an external source of platform updates

This avoids:

- depending on upstream merge decisions
- maintaining a third repository just for plugin glue
- scattering product logic across unrelated OpenClaw core files

## Architectural Layers

The system should still be treated as layered even inside one repository.

### Layer 1: Platform-Derived Base

Responsibilities:

- agent and session runtime concepts
- tool execution model
- sandbox and workspace concepts
- CLI and service control surfaces

This layer should stay as close to upstream OpenClaw as practical.

### Layer 2: OpenClaw Adapter Layer

Responsibilities:

- `openclaw code ...` ingress
- queue persistence and lifecycle transitions
- background queue draining
- thin runtime bridge into workflow logic

This layer should live in dedicated adapter modules, not spread through the
workflow core.

### Layer 3: Workflow Product Layer

Responsibilities:

- issue suitability policy
- execution spec generation
- worktree preparation
- builder / verifier orchestration
- PR drafting
- escalation and merge policy

This is the heart of the product.

## Module Ownership

Recommended ownership split:

### Keep Close to the OpenClaw Base

- generic runtime concepts
- platform configuration behavior
- broad execution primitives
- reusable CLI plumbing

### Keep in Product-Owned Modules

- GitHub issue and PR semantics
- engineering workflow states
- planner / builder / verifier contracts
- coding-specific acceptance criteria rules
- merge and escalation policy
- workflow persistence model

## Repository Discipline

To keep upstream syncing manageable:

- add new product code in dedicated directories whenever possible
- avoid broad edits to upstream-derived files
- avoid style-only rewrites in shared areas
- keep direct platform-touching patches small and well motivated

The practical rule is:

- additive changes are cheap
- invasive rewrites are expensive

## Sync Strategy

`openclawcode` should follow an explicit upstream sync policy.

Recommended cadence:

- sync upstream 1 to 2 times per week by default
- sync earlier when upstream changes touch overlapping areas
- sync before release branches or major milestones

Recommended method:

- fetch `upstream`
- merge `upstream/main` into a dedicated sync branch
- resolve conflicts there
- run validation
- merge back into `main`

Prefer routine merge-based syncing over frequent history rewriting.

## What to Upstream Later

Only consider upstreaming capabilities that are:

- general
- stable
- reusable beyond this product

Good upstream candidates later may include:

- reusable workflow run tracking
- generic worktree helpers
- general verification interfaces
- platform-level long-running task primitives

## What Not to Upstream Prematurely

Do not try to upstream early:

- GitHub-specific planning rules
- repository-specific merge policy
- product-specific verifier behavior
- issue suitability heuristics tuned to this workflow

These should mature inside `openclawcode` first.

## Risks

The main risks of this strategy are:

- too many direct edits in upstream-derived areas
- delayed syncing that creates large merge bursts
- weak boundaries between adapter code and workflow logic
- product logic leaking into platform-touching files

Each of these raises future merge cost.

## Bottom Line

The right strategy is:

- build `openclawcode` as the product repository
- keep OpenClaw as the platform base
- keep boundaries explicit inside the repository
- sync upstream regularly
- minimize high-friction platform edits

That gives the project product independence without giving up the ability to
benefit from OpenClaw upstream improvements.
