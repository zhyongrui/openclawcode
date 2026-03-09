# OpenClaw Plugin Integration

## Purpose

`openclawcode` remains the main repository.
The OpenClaw adapter lives in this repository as an integration layer.

This is intentionally not a third repository.
It is also intentionally not the main place for product logic.

## Recommended Boundary

- `src/`: workflow core, orchestrator, persistence, policy, worktree
- `src/integrations/openclaw-plugin/`: OpenClaw-facing adapter code

This keeps one product repository while still avoiding uncontrolled spreading
of OpenClaw-specific wiring into the workflow core.

## What Lives In The Plugin Adapter

- queue ingress from `openclaw code ...`
- queue persistence and lifecycle transitions
- background queue drain service
- plugin definition and manifest template

## What Does Not Live In The Plugin Adapter

- issue planning policy
- build / verify domain model
- merge policy
- worktree orchestration logic

Those stay in the core `openclawcode` modules.

## Release Model

The release model should be:

1. maintain `openclawcode` as the primary product repository
2. keep the OpenClaw adapter in this same repository
3. keep any OpenClaw-side shim as thin as possible
4. sync upstream OpenClaw changes into this repository with a controlled cadence

If a later phase needs packaging separation, this adapter can move into a
subpackage without creating a third repository.
