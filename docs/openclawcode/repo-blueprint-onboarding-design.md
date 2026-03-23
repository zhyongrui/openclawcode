# Repo and Blueprint Onboarding Design

## Problem

After GitHub auth becomes ready, OpenClaw Code still needs to decide what kind
of project setup it is entering.

GitHub login alone is not enough to start development. The system also needs to
know:

- whether the target repository already exists
- whether that repository has already been onboarded into OpenClaw Code
- whether a shared project blueprint already exists
- whether the operator and OpenClaw Code have actually reached agreement on the
  project goal, scope, and constraints

Today, these cases are easy to blur together. That creates the risk of starting
bootstrap or development too early, before the operator and OpenClaw Code have a
shared blueprint.

## What "Bootstrap" Means Here

In OpenClaw Code, `bootstrap` is the repo-preparation phase that happens after
GitHub auth and after blueprint-level agreement.

It is not the same thing as login, repo selection, or project alignment.

In practice, bootstrap means preparing the chosen repository for OpenClaw Code
to operate on it, for example by:

- cloning or attaching the repo locally
- materializing repo-local OpenClaw Code state under `.openclawcode/`
- ensuring the canonical `PROJECT-BLUEPRINT.md` exists in the managed repo
- wiring chat setup / plugin activation / webhook handoff metadata
- writing the first operator-facing receipts and next-step commands

So bootstrap should be treated as:

- after login
- after repo classification
- after blueprint agreement

not as the first thing that happens immediately after GitHub auth succeeds.

## Product Rule

OpenClaw Code should not move into active development until project intent is
explicitly aligned.

In practice, that means:

- repo existence is not enough
- GitHub auth readiness is not enough
- missing blueprint consensus should block development, even if the repo already
  exists

A simple rule captures this:

> If OpenClaw Code cannot find or establish blueprint-level agreement, it should
> stay in blueprint-first setup rather than moving into bootstrap or execution.

## The Three Primary Project States

### A. Existing repo + existing OpenClaw Code blueprint

This is the "resume an existing OpenClaw Code project" path.

Characteristics:

- the repo already exists
- OpenClaw Code artifacts already exist, for example:
  - `PROJECT-BLUEPRINT.md`
  - `.openclawcode/`
  - known stage-gate or runtime-steering artifacts
- the repo likely has prior OpenClaw Code development history

Desired system behavior:

1. bind the repo to the current chat
2. inspect the existing blueprint and repo-local artifacts
3. summarize the current project state back to the operator, including the
   current blueprint goal, status, and high-level counts when the canonical
   `PROJECT-BLUEPRINT.md` can be read
4. ask whether to continue with the existing blueprint or revise it first
5. continue to bootstrap or execution only after the operator confirms the
   existing blueprint is still the intended baseline

This path should feel like resume, not fresh setup.

### B. Existing repo + no OpenClaw Code blueprint

This is the "adopt an existing repo into OpenClaw Code" path.

Characteristics:

- the repo already exists
- there is no standard OpenClaw Code blueprint yet
- the project may already have useful materials such as:
  - `README.md`
  - docs
  - issues
  - package metadata
  - architecture notes
- the project likely predates OpenClaw Code usage

Desired system behavior:

1. bind the repo to the current chat
2. detect that no OpenClaw Code blueprint exists yet
3. scan the repo for existing intent and context materials
4. auto-seed a first blueprint draft from stable repo materials such as repo
   description, `README.md`, and package metadata
5. tell the operator that development should not begin yet
6. let the operator edit, clarify, and explicitly agree to the blueprint
7. only then continue into bootstrap / execution readiness

This path should feel like adoption, not immediate automation.

### C. New project + no repo yet

This is the "blueprint-first greenfield project" path.

Characteristics:

- the repo does not exist yet, or the operator has not chosen one yet
- there is no codebase to scan
- there is no shared blueprint yet
- the operator and OpenClaw Code have not reached agreement on scope

Desired system behavior:

1. begin with project discussion, clarification, and blueprint drafting
2. establish project goal, scope, constraints, and success criteria
3. get explicit operator agreement on the blueprint
4. only after agreement, create or choose the repo
5. then run bootstrap against the newly chosen repo target

This path should feel like creation, not repo-first setup.

## Important Sub-Case: Existing repo + non-standard docs

A common real-world case is:

- repo exists
- there is no `PROJECT-BLUEPRINT.md`
- but there are design docs, product notes, or issue threads that clearly carry
  useful intent

This should still be treated as case B, not case A.

The system should not assume alignment just because useful documentation exists.
Instead, it should say:

- useful project material was found
- no standard OpenClaw Code blueprint was found
- OpenClaw Code can auto-seed a blueprint draft from the existing materials
- the operator still needs to agree before execution begins

## Proposed State Machine

After GitHub auth becomes ready, the setup flow should enter a repo/blueprint
classification stage.

Suggested setup states:

- `repo-unbound`
- `repo-access-check-pending`
- `repo-missing-blueprint-required`
- `repo-existing-blueprint-detected`
- `repo-nonstandard-context-detected`
- `blueprint-drafting`
- `blueprint-awaiting-agreement`
- `repo-creation-pending`
- `bootstrap-ready`
- `bootstrap-running`
- `development-ready`

This makes `/occode-setup-status` much more precise.

Example outputs:

- state: `repo-existing-blueprint-detected`
  - repo is already managed by OpenClaw Code
  - next step: confirm whether to continue with the existing blueprint
- state: `repo-missing-blueprint-required`
  - repo exists, but no OpenClaw Code blueprint exists yet
  - next step: generate or draft a blueprint first
- state: `repo-creation-pending`
  - no repo exists yet
  - next step: finalize blueprint and then create the repo

## Repo Classification Logic

After GitHub auth is ready and the operator provides a repo target or asks to
start a new setup, OpenClaw Code should evaluate in this order:

### Step 1: Does the repo exist?

If no:

- classify as greenfield
- enter `repo-creation-pending`
- start blueprint-first setup

If yes:

- continue to step 2

### Step 2: Does the repo already contain OpenClaw Code blueprint artifacts?

Examples to check:

- `PROJECT-BLUEPRINT.md`
- `.openclawcode/`
- stage-gate artifacts
- runtime steering artifacts
- OpenClaw Code repo-local bootstrap receipts

If yes:

- classify as existing OpenClaw Code project
- enter `repo-existing-blueprint-detected`
- summarize and resume

If no:

- continue to step 3

### Step 3: Does the repo contain usable non-standard intent material?

Examples:

- `README.md`
- `docs/`
- architecture notes
- issue templates
- roadmap docs
- package metadata

If yes:

- classify as adopt-existing-repo
- enter `repo-nonstandard-context-detected`
- offer to generate a blueprint draft from current repo materials

If no:

- still classify as adopt-existing-repo
- enter `repo-missing-blueprint-required`
- begin blueprint drafting mostly from chat conversation

## Chat UX Design

## Command Semantics

To keep the setup flow legible in chat, the commands should separate
"report current state" from "continue execution":

- `/occode-setup-status`
  - reports the current setup stage
  - reports the current blocker or next required agreement
  - should not silently create repos, run bootstrap, or advance classification
- `/occode-setup-retry`
  - is the explicit operator signal to continue
  - may retry repo classification, repo creation, or bootstrap depending on the
    saved stage

This distinction matters because the operator should be able to inspect the
current state without accidentally causing setup to move forward.

### Existing repo path

Operator sends:

```text
/occode-setup existing owner/repo
```

Possible system replies:

#### Reply variant 1: blueprint already exists

- repo found: `owner/repo`
- OpenClaw Code blueprint detected
- this looks like an existing OpenClaw Code project
- next:
  - review blueprint summary
  - confirm whether to continue with the current blueprint

#### Reply variant 2: repo exists but blueprint is missing

- repo found: `owner/repo`
- no OpenClaw Code blueprint detected
- this looks like an existing repo that has not been onboarded into OpenClaw
  Code yet
- OpenClaw Code seeds a first draft from repo summary and any stable repo
  metadata it can read
- next:
  - review and revise the seeded blueprint draft in chat
  - agree to it if the baseline already looks correct

#### Reply variant 3: repo exists and non-standard context is present

- repo found: `owner/repo`
- no standard OpenClaw Code blueprint detected
- useful project context was found in the repo
- OpenClaw Code seeds a first draft from those materials
- next:
  - review and revise the seeded draft
  - then ask the operator to agree before development starts

### New project path

Operator sends one of:

```text
/occode-setup new repo-name
```

or

```text
/occode-setup new-project
```

Desired behavior:

- do not treat repo creation as the first real milestone
- instead begin blueprint-first setup immediately
- if a repo name was provided, treat it as a pending target, not as permission
  to skip blueprint agreement

Suggested reply:

- we have not created the repo yet
- first we should agree on the project blueprint
- after you approve the blueprint, I will create or bind the repo and continue

## Command Design Guidance

The existing command surface already points in the right direction. The product
should lean into these explicit paths:

- `/occode-setup existing owner/repo`
- `/occode-setup new repo-name`
- `/occode-setup new-project`
- `/occode-blueprint`
- `/occode-blueprint-init`
- `/occode-blueprint-agree`
- `/occode-setup-status`

The important behavior change is not only new commands; it is better branching
logic and clearer state reporting after GitHub auth succeeds.

## `/occode-setup-status` Should Explain the Real Blocker

The status command should report all three layers independently:

- GitHub auth state
- repo binding / repo existence state
- blueprint agreement state
- the exact next chat commands for the current blocker

Example:

- GitHub: ready as `zhyongrui`
- Repo: `owner/repo` found and bound to this chat
- Blueprint: missing
- State: `repo-missing-blueprint-required`
- Next:
  - `/occode-goal`
  - `/occode-blueprint-edit`
  - `/occode-blueprint-agree`
  - `/occode-setup-retry`

This is much more actionable than a generic "setup incomplete" message.

## Why This Matters

Without this design, the system is tempted to treat all post-auth repo flows as
simple repo bootstrap. That is risky because it ignores the difference between:

- resuming a known OpenClaw Code project
- adopting an old repo that never used OpenClaw Code
- inventing a brand-new project from scratch

Those are different product moments and need different onboarding behavior.

## Recommended Product Principle

Use this rule consistently:

> Existing code is not the same as existing alignment.
>
> If blueprint agreement is missing, OpenClaw Code should stay in setup and
> blueprinting mode rather than proceeding into development.

## Ideal Operator Experience

The ideal end-to-end experience is:

1. operator finishes GitHub auth
2. operator chooses an existing repo or a new project path
3. OpenClaw Code classifies the project shape correctly
4. OpenClaw Code either:
   - resumes the existing blueprint
   - generates a blueprint draft from repo materials
   - or starts a greenfield blueprint discussion
5. operator explicitly agrees on the blueprint
6. only then does OpenClaw Code move into bootstrap and active development

That preserves the core promise that OpenClaw Code development starts from a
shared blueprint, not from guesswork.
