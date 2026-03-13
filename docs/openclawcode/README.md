# OpenClaw Code Docs

This directory contains product-specific documents for `openclawcode`.

Recommended reading order:

1. `idea-outline.md`
2. `mvp.md`
3. `mvp-spec-v1.md`
4. `architecture.md`
5. `development-plan.md`
6. `full-program-roadmap.md`
7. `workflows.md`
8. `specs.md`
9. `openclaw-strategy.md`
10. `openclaw-implementation-plan.md`
11. `run-json-contract.md`
12. `upstream-sync-policy.md`
13. `operator-setup.md`
14. `mvp-runbook.md`
15. `webhook-operations.md`

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
- a versioned top-level JSON contract for `openclaw code run --json`, anchored
  by `contractVersion: 1` and documented in `run-json-contract.md`
- persisted structured workflow failure diagnostics that now surface in both
  saved run artifacts and the top-level JSON contract as:
  - `failureDiagnostics`
  - `failureDiagnosticsSummary`
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
- those persisted failure diagnostics now flow through operator state too:
  - `/occode-status` can show structured failed-run diagnostics after a run is
    recorded
  - `/occode-inbox` recent ledger entries can show the same structured
    diagnostics without parsing the last history line
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
- refreshed-branch direct reruns on issue `#87` now confirm that the new
  lightweight bootstrap path is active for issue worktrees:
  - the earlier oversized `AGENTS.md` truncation warning is gone from the live
    builder session
  - `systemPromptReport.injectedWorkspaceFiles` is now empty on that rerun
  - `HTTP 400: Internal server error` still remains as the blocking live build
    failure, so the next provider-resilience slice now targets prompt budget or
    provider behavior rather than more bootstrap-file filtering
- a follow-up live rerun on the same issue now confirms that prompt trimming
  reached the next layer too:
  - only the four core coding tools remain in the live worktree session
  - the coding-only skill filter now applies even when the real operator config
    has only `agents.defaults` and no `agents.list`
  - live `systemPromptReport.systemPrompt.chars` dropped from `12366` to `8629`
  - live `systemPromptReport.skills.promptChars` dropped from `4982` to `1245`
  - provider `HTTP 400: Internal server error` still remained after that drop,
    which makes the next slice provider/model-focused rather than prompt-budget
    focused
- the next provider-resilience slice is now in place in code too:
  - when the embedded runner surfaces `stopReason=error`, the workflow can now
    preserve compact provider/model diagnostics with the failed note itself
  - those compact diagnostics include provider/model id, prompt footprint,
    tool-schema footprint, usage total, and bootstrap-warning state
  - a direct refreshed-branch proof has now confirmed those diagnostics really
    do land in the saved failed note for issue `#87`, so future sessions no
    longer need raw builder stdout to see the remaining provider signal
- refreshed-branch provider follow-up now also has a bounded fallback escape
  hatch:
  - issue-worktree runs can read `OPENCLAWCODE_MODEL_FALLBACKS` from the
    operator environment and inject that fallback chain into the temporary
    session-scoped runtime config
  - this is meant for provider-resilience proofs, so another operator can test
    fallback behavior without rewriting the shared agent config first
- operator-facing provider-pause messaging is now visible beyond
  `/occode-inbox` too:
  - `/occode-start` and `/occode-rerun` now tell the operator when work was
    queued behind an active provider pause
  - `/occode-rerun` now also distinguishes an active pause from a cleared pause
    and explicitly says when the rerun is probing recovery after the pause
    window has elapsed
  - `/occode-status` now appends the same pause window, failure count, and
    pause reason so a queued or failed issue can be interpreted without
    switching back to the inbox
- provider-failure context now persists on the affected issue snapshot even
  after the active global pause clears:
  - `/occode-status` and `/occode-inbox` keep the last transient failure time,
    failure count, and provider-pause reason on failed issues
  - those surfaces now distinguish `active pause until ...` from
    `pause cleared after ...`, which makes it clear whether the provider has
    recovered or the run is still blocked behind an active pause window
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
- that setup verification script now also supports `--json`, so another
  operator host or CI job can consume a machine-readable readiness report
- setup verification now also inspects local model inventory through
  `models list --json`:
  - JSON output now includes `modelInventory`
  - JSON output now also includes `readiness` with an explicit next proof or
    rollout action for automation
  - human-readable output now tells the operator how many discoverable models
    are available for fallback proofs
  - if `OPENCLAWCODE_MODEL_FALLBACKS` is configured, setup-check now fails when
    any requested fallback model is not actually discoverable on that host
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
- the long-lived local operator rooted at `~/.openclaw` is now also proven as
  a real Feishu-driven control plane for `zhyongrui/openclawcode`:
  - repo notifications and commands are bound to one real Feishu conversation
  - `./scripts/openclawcode-setup-check.sh --strict` passes there with
    `17 pass`, `0 warn`, and `0 fail`
  - after code changes, restarting the long-lived gateway is required before
    trusting chat-visible behavior updates
- a refreshed `main` baseline promoted from `sync/upstream-2026-03-11`, pushed
  to `origin/main`, and restarted under the local live gateway
- a repaired long-lived `main` merged proof through issue `#56`:
  - `PR #57` merged to `main`
  - issue `#56` closed after merge
  - local `main` fast-forwarded to merge commit
    `316ea9a5571159cc85e11f11cc4cccd87ffdd632`
- real end-to-end validation against this repository, including a webhook-driven
  issue run that opened, merged, and closed automatically
- real Feishu-commanded live proofs on the long-lived operator:
  - `/occode-start zhyongrui/openclawcode#65` reached merged state through
    build, test, PR publication, verification, and merge
  - `/occode-start zhyongrui/openclawcode#68` reached the same merged path
  - one-line `/occode-intake` created real issue `#71` and synthesized the
    minimal issue body automatically before queueing work
  - the resulting `#71` failure confirmed that `HTTP 400: Internal server error`
    is currently a provider-side build failure mode, not a chat-intake bug
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
    - command-layer issue `#74`
    - command-layer issue `#75`
    - command-layer issue `#76`
    - command-layer issue `#77`
    - command-layer issue `#78`
    - command-layer issue `#79`
    - command-layer issue `#80`
    - command-layer issue `#81`
    - command-layer issue `#82`
    - ops issue `#83`
    - ops issue `#84`
    - docs/operator issue `#60`
  - duplicate issue `#59` was detected through the new inventory path and then
    closed
  - command-layer issues `#54` and `#50` have now been consumed and closed on
    `main`
  - command-layer issue `#55` has now been consumed and closed on `main`, and
    the pool has been replenished with:
    - `#63` for `totalAttemptCount`
    - `#64` for `buildAttemptCount`
- command-layer issue `#66` has now been consumed on `main` too:
  - `openclaw code run --json` now exposes `stageRecordCount`
  - the command-layer pool was replenished with `#72` for
    `acceptanceCriteriaCount`
- command-layer issue `#72` has now been consumed on `main` too:
  - `openclaw code run --json` now exposes `acceptanceCriteriaCount`
  - the command-layer pool was replenished with `#73` for `openQuestionCount`
- command-layer issue `#73` has now been consumed on `main` too:
  - `openclaw code run --json` now exposes `openQuestionCount`
  - the command-layer pool was replenished with `#74` for `riskCount`
- the refreshed sync branch has now consumed more `BuildResult` count slices too:
  - `openclaw code run --json` now exposes `testCommandCount`
  - `openclaw code run --json` now exposes `testResultCount`
  - `openclaw code run --json` now exposes `noteCount`
  - `openclaw code run --json` now exposes `changedFileCount`
  - `scripts/openclawcode-setup-check.sh` now reads `minimumNodeVersion` from
    `dist/cli-startup-metadata.json` and checks the local Node runtime against
    the CLI startup floor
  - the operator host has now been upgraded to local Node `22.16.0`, and a
    real strict proof passes end-to-end again
  - queued runs now kick the queue consumer immediately whenever the bundled
    runner service is already active, so auto-mode intake and chat approvals do
    not have to wait for the next poll interval before starting
  - auto-mode webhook intake and chat-native `/occode-intake` now append active
    provider-pause details directly to the queued message when work is waiting
    behind a transient provider pause
  - seeded low-risk validation issues now short-circuit scope classification
    from their validation marker before the usual text heuristics run, so
    `operator-doc-note` issues like `#86` do not drift into
    `workflow-core`/`needs-human-review` classification just because the prose
    mentions queue or runtime behavior
  - refreshed-branch live proof issue `#87` now confirms that fix in a real
    run artifact:
    - suitability reached `auto-run`
    - classification stayed `command-layer`
    - the run still failed later with provider `HTTP 400`, so the remaining
      blocker there is provider stability rather than suitability drift
  - operator docs now include a refreshed-branch promotion checklist and
    copied-root teardown guidance
  - the next refreshed-branch ops slice is a real low-risk live proof on the
    refreshed branch before promotion
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
- the next refreshed integration branch,
  `sync/upstream-2026-03-12-refresh`, now merges `upstream/main` through
  `c965049dc6` and still passes the same validation set
- the latest sync branch, `sync/upstream-2026-03-13`, now cleanly merges
  `upstream/main` through `80e7da92ce` and still passes:
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1`
  - `pnpm build`
- `sync/upstream-2026-03-13` is now the active feature branch while `main`
  remains the long-lived Feishu operator baseline until the next live
  promotion
- upstream now expects Node `>=22.16.0` for CLI startup:
  - this workstation now runs the refreshed branch under `22.16.0`
  - the built CLI entrypoint no longer starts below the new floor
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

Additional rollout note from the latest refreshed-branch proof:

- issue-worktree builder runs now default to `300` seconds
- issue-worktree verifier runs now default to `180` seconds
- operator overrides:
  - `OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS`
  - `OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS`
- generic non-provider failures now also persist
  `failureDiagnostics.summary`, so timeout-style failures stay visible in saved
  workflow artifacts and chat-visible status output
