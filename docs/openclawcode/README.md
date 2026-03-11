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
11. `operator-setup.md`
12. `mvp-runbook.md`
13. `webhook-operations.md`

Development logs live in `dev-log/`.

## Current Status

As of 2026-03-11, the repository includes a working `openclawcode` issue-driven
loop with:

- workflow state, persistence, and isolated worktree management
- a GitHub-backed issue webhook intake path with delivery-id deduplication
- durable queue ingestion and background execution in the bundled OpenClaw
  plugin
- chat-facing operator commands:
  - `/occode-start`
  - `/occode-rerun`
  - `/occode-status`
  - `/occode-inbox`
  - `/occode-skip`
  - `/occode-sync`
  - `/occode-bind`
  - `/occode-unbind`
- a local builder/verifier runtime adapter built on top of OpenClaw's embedded
  agent entrypoint
- an `openclaw code run ...` CLI path for issue-driven execution
- draft PR publishing and guarded merge hooks in the workflow service layer
- event-driven `pull_request` / `pull_request_review` webhook intake with chat
  notifications for tracked lifecycle changes
- GitHub-side status healing for review, merged, and closed-without-merge PR
  outcomes
- explicit request-changes rerun control with rerun artifacts, review context,
  and existing-PR continuity
- local-run reconciliation that can recover tracked PR linkage from older run
  artifacts when a newer rerun artifact omits draft PR metadata
- a compact `/occode-inbox` operator ledger for recent lifecycle events, final
  disposition, rerun lineage, and last notification metadata
- a repeatable operator setup runbook plus a repo-local setup verification
  script for gateway, webhook, binding, tunnel health, and required GitHub
  webhook event subscriptions
- real end-to-end validation against this repository, including a webhook-driven
  issue run that opened, merged, and closed automatically

Still pending for a fuller product loop:

- stronger suitability/risk gating ahead of autonomous execution
- a full live PR/review webhook replay after the lifecycle, rerun, ledger, and
  setup slices
- broader policy-doc polish
