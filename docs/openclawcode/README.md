# OpenClaw Code Docs

This directory contains product-specific documents for `openclawcode`.

Recommended reading order:

1. `idea-outline.md`
2. `mvp.md`
3. `mvp-spec-v1.md`
4. `architecture.md`
5. `development-plan.md`
6. `workflows.md`
7. `specs.md`
8. `openclaw-strategy.md`
9. `openclaw-implementation-plan.md`
10. `upstream-sync-policy.md`
11. `mvp-runbook.md`

Development logs live in `dev-log/`.

## Current Status

As of 2026-03-09, the repository includes a working `openclawcode` MVP slice with:

- workflow state, persistence, and isolated worktree management
- a GitHub-backed issue intake path
- a local builder/verifier runtime adapter built on top of OpenClaw's embedded agent entrypoint
- a `openclaw code run ...` CLI path for issue-driven execution
- draft PR publishing and optional merge hooks in the workflow service layer

Still pending for a fuller product loop:

- queue ingestion and background workers
- stronger suitability/risk gating ahead of autonomous execution
- richer verifier policy and human checkpoint enforcement
- broader repository-aware test selection
