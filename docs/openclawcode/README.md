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

As of 2026-03-12, the repository includes a working `openclawcode` issue-driven
loop with:

- workflow state, persistence, and isolated worktree management
- a GitHub-backed issue webhook intake path with delivery-id deduplication
- durable queue ingestion and background execution in the bundled OpenClaw
  plugin
- chat-facing operator commands:
  - `/occode-intake`
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
- explicit chat-side issue drafting via `/occode-intake`, which can:
  - create a new GitHub issue from the bound chat
  - accept either a full issue draft or a single-line request and synthesize a
    minimal issue body automatically
  - queue low-risk issues immediately through the existing workflow path
  - precheck obvious high-risk issues into `escalated` snapshots before any
    branch mutation
- GitHub-side status healing for review, merged, and closed-without-merge PR
  outcomes
- explicit request-changes rerun control with rerun artifacts, review context,
  and existing-PR continuity
- failure-path recovery that now reconciles the latest local workflow artifact
  back into a tracked snapshot when a background run exits non-zero or returns
  unparsable stdout, so `/occode-rerun` can still target failed runs
- agent-backed builder/verifier runs now treat agent `stopReason=error` as a
  hard workflow failure instead of accepting the raw error text as a successful
  build summary
- transient provider failures such as `HTTP 400: Internal server error` now get
  one narrow retry window in the builder/verifier path before the workflow
  gives up
- provider-side `HTTP 400: Internal server error` retries now use a shorter
  outer wait window than timeout or overload retries, so repeated fresh
  failures surface faster while the workflow still preserves one recovery
  attempt
- openclawcode issue-worktree runs now disable the embedded Pi SDK's inner
  retry loop, so provider-side transient failures surface through the workflow
  retry policy instead of silently stretching one builder attempt
- live rerun proof on issue `#71` now confirms that repeated provider-side
  `HTTP 400` failures surface as `Build failed: HTTP 400: Internal server error`
  in `/occode-status` instead of drifting into a later verifier parse failure
- fresh live rerun proofs on issues `#71` and `#66` now confirm that:
  - each outer builder retry creates a fresh embedded session that records only
    one assistant `400 Internal server error`
  - repeated fresh failures still reactivate the queue-level provider pause
    instead of continuing to drain the queue during provider instability
- operator-facing provider-pause messaging is now visible beyond
  `/occode-inbox` too:
  - `/occode-start` and `/occode-rerun` now tell the operator when work was
    queued behind an active provider pause
  - `/occode-status` now appends the same pause window, failure count, and
    pause reason so a queued or failed issue can be interpreted without
    switching back to the inbox
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
- operator setup scripts that can now derive:
  - `openclawcode.env`
  - `openclaw.json`
  - `plugins/openclawcode/chatops-state.json`
    from a single `OPENCLAWCODE_OPERATOR_ROOT` override instead of requiring
    three independent file-path overrides
- a strict copied-root operator proof that now passes
  `scripts/openclawcode-setup-check.sh --strict` when the fresh root keeps its
  webhook repo and hook metadata in `openclawcode.env`
- a copied-root fresh gateway startup proof that now:
  - starts a second local gateway from `OPENCLAWCODE_OPERATOR_ROOT` on a
    non-default port
  - passes `scripts/openclawcode-setup-check.sh --strict` against that gateway
    with `14 pass`, `0 warn`, and `0 fail`
- a refreshed `main` baseline promoted from `sync/upstream-2026-03-11`, pushed
  to `origin/main`, and restarted under the local live gateway
- a repaired long-lived `main` merged proof through issue `#56`:
  - `PR #57` merged to `main`
  - issue `#56` closed after merge
  - local `main` fast-forwarded to merge commit
    `316ea9a5571159cc85e11f11cc4cccd87ffdd632`
- real end-to-end validation against this repository, including a webhook-driven
  issue run that opened, merged, and closed automatically
- a copied-root fresh-operator merged proof through issue `#51`, run
  `zhyongrui-openclawcode-51-1773297182598`, and merged `PR #52`
- an explicit suitability gate that now records `auto-run`,
  `needs-human-review`, or `escalate` before workspace preparation
- a real high-risk suitability proof through issue `#53`, run
  `zhyongrui-openclawcode-53-1773298188208`, which moved directly to
  `escalated` before worktree preparation or PR publication
- a copied-root webhook precheck proof for synthetic issue `#9053`, which now:
  - returns `reason: "precheck-escalated"`
  - writes an `escalated` snapshot instead of `pendingApprovals` or `queue`
- a long-lived `main` webhook precheck proof through issue `#58`, which now:
  - returns `reason: "precheck-escalated"`
  - writes an `escalated` snapshot with run id `intake-precheck-58`
  - leaves `pendingApprovals` and `queue` untouched
- suitability is now visible in operator-facing surfaces too:
  - run status messages include suitability decision and summary
  - `/occode-inbox` recent ledger entries include a `suitability:` line
- validation-pool inventory is now visible in operator-facing surfaces too:
  - `/occode-inbox` appends the live open validation pool
  - `/occode-inbox` now also summarizes the pool by class and template before
    listing individual issues
  - `/occode-status <issue>` annotates validation issues with their class and
    template when the issue matches the seeded validation taxonomy
- operator setup health checks that now retry transient gateway reachability and
  signed webhook probe failures during short restart windows
- a repo-native validation-pool CLI surface:
  - `openclaw code seed-validation-issue`
  - `openclaw code list-validation-issues`
  - `openclaw code list-validation-issues` now reports template-level counts in
    both text and JSON output
  - seeded issue creation now reuses an existing open match instead of creating
    a duplicate
  - current live inventory is visible without opening GitHub manually and
    includes:
    - command-layer issue `#66`
    - docs/operator issue `#60`
  - duplicate issue `#59` was detected through the new inventory path and then
    closed
  - command-layer issues `#54` and `#50` have now been consumed and closed on
    `main`
  - command-layer issue `#55` has now been consumed and closed on `main`, and
    the pool has been replenished with:
    - `#63` for `totalAttemptCount`
    - `#64` for `buildAttemptCount`
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
- a fifth sync-branch live proof on issue `#36`:
  - `zhyongrui-openclawcode-36-1773284933205` reached
    `ready-for-human-review` with `OPENCLAWCODE_ENABLE_FS_TOOLS=write`
  - the live builder tool list now exposes `write` again alongside `read` and
    `edit`, and the run stayed stable under the expanded fs-tool surface
- builder prompt hardening that now explicitly tells sandboxed issue runs not
  to use package-manager or formatter commands for validation
- a sixth sync-branch live proof on issue `#36`:
  - `zhyongrui-openclawcode-36-1773285317777` reached
    `ready-for-human-review` with `OPENCLAWCODE_ENABLE_FS_TOOLS=write`
  - the builder summary explicitly records that it avoided sandbox
    package-manager, formatter, and full-test commands, leaving validation to
    the workflow host
- a docker-gated sandbox write e2e regression that now proves
  `createSandboxedWriteTool(...)` can:
  - create a new mounted workspace file through alias-style `file_path` params
  - keep linked-worktree writes visible through both `/workspace` and the
    absolute worktree mount path used by live issue runs
- a fresh direct live rerun of issue `#44` on refreshed `main` that completed
  as a no-op `ready-for-human-review` run instead of reproducing the earlier
  stalled-planning corruption path
- a fresh live merged-PR validation on refreshed `main` through issue `#45`,
  including:
  - two failed reruns that were captured as persisted `failed` artifacts
  - recovery through the earlier runner-level `edit`/`write` deny mitigation
  - real PR publication to `PR #46`
  - automatic verification, merge, and issue closure on the live route
- a fresh sync-branch merged live validation under
  `OPENCLAWCODE_ENABLE_FS_TOOLS=write` through issue `#48`, including:
  - direct GitHub API seeding of a new low-risk validation issue when the
    command-layer validation pool was empty
  - real PR publication to `PR #49`
  - automatic verification, merge, and issue closure on the expanded fs-tool
    surface
  - stable top-level JSON output for downstream tooling via
    `verificationHasFindings`

Still pending for a fuller product loop:

- surfacing active provider pause and recovery expectations even more clearly
  across operator-facing status surfaces
- tightening outer retry latency during provider-instability windows now that
  the embedded SDK retry loop is clamped for openclawcode worktrees
- consuming the replenished validation pool through new live proofs, then
  reseeding it before it runs dry again
- lifting chat intake from explicit command syntax to a more natural
  conversation-driven issue-drafting path
- broadening the remaining command-layer pool beyond one still-open issue after
  consuming `#54`, `#50`, and `#55`
- broader packaging and install proof beyond the current local operator
  environments
