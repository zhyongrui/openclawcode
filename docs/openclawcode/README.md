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
- merge-based reusable worktree refresh that:
  - fast-forwards stale issue branches that have no unique commits
  - merges the latest base branch into reusable issue branches that do have
    unique commits
  - aborts instead of continuing with a conflicted reusable branch refresh
- a compact `/occode-inbox` operator ledger for recent lifecycle events, final
  disposition, rerun lineage, and last notification metadata
- a repeatable operator setup runbook plus a repo-local setup verification
  script for gateway, webhook, binding, tunnel health, and required GitHub
  webhook event subscriptions
- a refreshed `main` baseline promoted from `sync/upstream-2026-03-11`, pushed
  to `origin/main`, and restarted under the local live gateway
- real end-to-end validation against this repository, including a webhook-driven
  issue run that opened, merged, and closed automatically
- real live lifecycle replay against `PR #37`, covering:
  - `pull_request_review` changes requested
  - `pull_request_review` approved
  - `pull_request` closed without merge
- a real live `/occode-rerun` validation against issue `#40`, including:
  - explicit rerun lineage persisted into the tracked snapshot
  - reusable issue-branch continuity through the live runner
  - real draft PR publication to `PR #43`
  - final `ready-for-human-review` completion with notification delivery
  - follow-up hardening so reusable issue branches merge the latest base before
    rerun publication instead of reopening dirty PRs from stale branch state
- stable rerun JSON output from `openclaw code run --json`, including:
  - `rerunRequested`
  - `rerunHasReviewContext`
  - rerun review decision, timestamp, summary, and URL fields when present
- builder/workspace integrity guardrails that now:
  - fail fast when an existing tracked file becomes empty inside the isolated
    issue worktree
  - persist stage-specific `failed` workflow artifacts instead of leaving the
    run stranded behind a later shell or lint failure
- edit-recovery hardening for agent-backed builder sessions that now:
  - verifies host and sandbox edit recovery even when upstream edit calls use
    `file_path`, `old_string`, and `new_string`
  - restores the original sandbox worktree file through the resolved host path
    when the bridge still reports success but keeps leaving the mounted file
    empty on disk
  - replaces the sandbox-side edit write path with a deterministic bridge-backed
    exact-replace implementation instead of trusting the upstream sandbox edit
    mutation path
  - verifies deterministic edits against the expected final file contents so
    exact replacements no longer false-negative when the inserted block embeds
    the old block as a prefix
  - keeps the default `OpenClawAgentRunner` runtime deny focused on `write`
    while the remaining filesystem-tool rollout continues
- a staged runner re-enable switch for live validation:
  - default behavior now allows `edit` after live proof on
    `sync/upstream-2026-03-12`
  - `OPENCLAWCODE_ENABLE_FS_TOOLS=write` removes the remaining runner-added
    `write` deny for controlled live validation
  - `OPENCLAWCODE_ENABLE_FS_TOOLS=edit,write` remains accepted as a
    backward-compatible synonym for the same full fs-tool replay
- a refreshed upstream integration branch, `sync/upstream-2026-03-12`, that now
  merges `upstream/main` through `841ee24340` and still passes:
  - `pnpm build`
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads`
- a docker-gated sandbox edit end-to-end regression that exercises alias-style
  edit parameters through the real workspace mount path before the runner-level
  deny is removed
- a second docker-gated linked-worktree regression that proves the rewritten
  sandbox edit path keeps large mounted files non-empty and visible through
  both `/workspace` and the absolute worktree mount used by live issue runs
- two fresh sync-branch live proofs on issue `#36`:
  - `zhyongrui-openclawcode-36-1773282645164` reached
    `ready-for-human-review` with deterministic sandbox `edit` succeeding
    end to end under `OPENCLAWCODE_ENABLE_FS_TOOLS=edit`
  - `zhyongrui-openclawcode-36-1773282908481` reached
    `ready-for-human-review` again after `edit` was re-enabled by default in
    `OpenClawAgentRunner`
- a third sync-branch live proof on issue `#36`:
  - `zhyongrui-openclawcode-36-1773283954561` reached
    `ready-for-human-review` after sandbox `read` learned to page in-boundary
    directories such as `/workspace/docs/openclawcode`
  - the builder no longer emitted the earlier boundary-check warning for that
    directory path during the live run
- a fourth sync-branch live proof on issue `#36`:
  - `zhyongrui-openclawcode-36-1773284400697` reached
    `ready-for-human-review` after the builder prompt was tightened to hint the
    real `docs/openclawcode/openclaw-plugin-integration.md` path
  - the live builder stopped chasing the nonexistent
    `docs/openclawcode/plugin-integration.md` file name
- a fresh direct live rerun of issue `#44` on refreshed `main` that completed
  as a no-op `ready-for-human-review` run instead of reproducing the earlier
  stalled-planning corruption path
- a fresh live merged-PR validation on refreshed `main` through issue `#45`,
  including:
  - two failed reruns that were captured as persisted `failed` artifacts
  - recovery through the earlier runner-level `edit`/`write` deny mitigation
  - real PR publication to `PR #46`
  - automatic verification, merge, and issue closure on the live route

Still pending for a fuller product loop:

- staged validation of the remaining runner-level `write` deny before broader
  filesystem-tool rollout
- stronger suitability/risk gating ahead of autonomous execution
- proof under a fresh operator environment using docs and scripts only
- broader policy-doc polish
