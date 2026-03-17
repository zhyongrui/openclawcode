# OpenClaw Code Docs

This directory contains product-specific documents for `openclawcode`.

Recommended reading order:

1. `idea-outline.md`
2. `mvp.md`
3. `mvp-spec-v1.md`
4. `architecture.md`
5. `blueprint-first-orchestration.md`
6. `openclaw-capability-mapping.md`
7. `blueprint-first-delivery-plan.md`
8. `project-blueprint-schema.md`
9. `development-plan.md`
10. `master-delivery-checklist.md`
11. `full-program-roadmap.md`
12. `workflows.md`
13. `specs.md`
14. `openclaw-strategy.md`
15. `openclaw-implementation-plan.md`
16. `run-json-contract.md`
17. `operator-status-snapshot-contract.md`
18. `validation-pool-contract.md`
19. `validation-pool-maintenance.md`
20. `release-artifacts-contract.md`
21. `policy.md`
22. `policy-contract.md`
23. `support-matrix.md`
24. `fresh-host-install.md`
25. `single-login-bootstrap-proposal.md`
26. `fresh-host-readiness-audit.md`
27. `upgrade-and-rotation.md`
28. `release-runbook.md`
29. `operator-proof-routine.md`
30. `troubleshooting.md`
31. `proof-matrix.md`
32. `sample-operator-config.md`
33. `sample-automation-integration.md`
34. `chat-intake-styles.md`
35. `security-and-retention.md`
36. `sync-conflict-history.md`
37. `upstream-sync-policy.md`
38. `operator-setup.md`
39. `sync-promotion-runbook.md`
40. `mvp-runbook.md`
41. `webhook-operations.md`

Development logs live in `dev-log/`.

For a fresh-machine bootstrap driven by Codex itself, see
`codex-openclawcode-install.md`.

For the product direction that should reduce fresh-host setup to one GitHub
login plus one repo choice, see `single-login-bootstrap-proposal.md`.

## Current Status

As of 2026-03-17, the repository includes a working `openclawcode` issue-driven
loop with:

- workflow state, persistence, and isolated worktree management
- a GitHub-backed issue webhook intake path with delivery-id deduplication
- durable queue ingestion and background execution in the bundled OpenClaw
  plugin
- chat-facing operator commands:
  - `/occode-intake`
  - `/occode-intake-confirm`
  - `/occode-intake-edit`
  - `/occode-intake-choose`
  - `/occode-intake-reject`
  - `/occode-start`
  - `/occode-start-override`
  - `/occode-rerun`
  - `/occode-takeover`
  - `/occode-resume-after-edit`
  - `/occode-status`
  - `/occode-inbox`
  - `/occode-blueprint`
  - `/occode-goal`
  - `/occode-blueprint-agree`
  - `/occode-blueprint-edit`
  - `/occode-routing`
  - `/occode-route-set`
  - `/occode-gates`
  - `/occode-gate-decide`
  - `/occode-skip`
  - `/occode-sync`
  - `/occode-bind`
  - `/occode-unbind`
- a local builder/verifier runtime adapter built on top of OpenClaw's embedded
  agent entrypoint
- an `openclaw code run ...` CLI path for issue-driven execution
- an `openclaw code bootstrap --repo owner/repo` CLI path for low-touch target
  repo bootstrap, including:
  - target repo clone/attach
  - operator env/config materialization
  - bootstrap repo binding persistence
  - blueprint / role-routing / discovery / stage-gate seeding
  - gateway startup attempt
  - strict setup-check and built-startup proof summary
- a versioned top-level JSON contract for `openclaw code run --json`, anchored
  by `contractVersion: 1` and documented in `run-json-contract.md`
- a versioned machine-readable policy contract for:
  - `openclaw code policy-show --json`
  - suitability allowlist / denylist rules
  - build guardrail thresholds for large diffs, broad fan-out, and generated
    files
  - provider failure classes that do and do not auto-pause the queue
- a fixed repo-local blueprint foundation at `PROJECT-BLUEPRINT.md`, with:
  - `openclaw code blueprint-init`
  - `openclaw code blueprint-show`
  - `openclaw code blueprint-clarify`
  - `openclaw code blueprint-set-status`
  - `openclaw code blueprint-set-section`
  - `openclaw code blueprint-set-provider-role`
  - `openclaw code blueprint-decompose`
  - `openclaw code work-items-show`
  - `openclaw code discover-work-items`
  - `openclaw code role-routing-refresh`
  - `openclaw code role-routing-show`
  - `openclaw code stage-gates-refresh`
  - `openclaw code stage-gates-show`
  - `openclaw code stage-gates-decide`
  - `openclaw code promotion-gate-refresh`
  - `openclaw code promotion-gate-show`
  - `openclaw code rollback-suggestion-refresh`
  - `openclaw code rollback-suggestion-show`
  - `openclaw code promotion-receipt-record`
  - `openclaw code promotion-receipt-show`
  - `openclaw code rollback-receipt-record`
  - `openclaw code rollback-receipt-show`
  - machine-readable lifecycle inspection, revision metadata, and work-item
    inventory output through `--json`
  - repo-local discovery and provider-role routing artifacts under
    `.openclawcode/`
  - repo-local stage-gate decisions persisted under `.openclawcode/stage-gates.json`
  - repo-local promotion and rollback artifacts persisted under:
    - `.openclawcode/promotion-gate.json`
    - `.openclawcode/rollback-suggestion.json`
    - `.openclawcode/promotion-receipt.json`
    - `.openclawcode/rollback-receipt.json`
- stable workflow identity metadata now also includes top-level mirrors for:
  - `issueTitle`
  - `issueRepo`
  - `issueOwner`
- guarded merge policy now also blocks:
  - manual suitability overrides
  - large diffs
  - broad fan-out
  - generated-file changes
- persisted structured workflow failure diagnostics that now surface in both
  saved run artifacts and the top-level JSON contract as:
  - `failureDiagnostics`
  - `failureDiagnosticsSummary`
  - `failureDiagnosticProvider`
  - `failureDiagnosticModel`
  - `failureDiagnosticSystemPromptChars`
  - `failureDiagnosticSkillsPromptChars`
  - `failureDiagnosticToolSchemaChars`
  - `failureDiagnosticSkillCount`
  - `failureDiagnosticInjectedWorkspaceFileCount`
  - `failureDiagnosticBootstrapWarningShown`
- stable draft PR metadata now also includes a top-level
  `draftPullRequestTitle` mirror for consumers that should not unpack the
  nested `draftPullRequest` object
- stable draft PR metadata now also includes top-level mirrors for:
  - `draftPullRequestBody`
  - `draftPullRequestOpenedAt`
- stable workspace metadata now also includes a top-level
  `workspaceBaseBranch` mirror for consumers that should not unpack the nested
  `workspace` object
- stable workspace metadata now also includes a top-level
  `workspaceBranchName` mirror for consumers that should not unpack the nested
  `workspace` object
- stable workspace metadata now also includes a top-level
  `workspaceRepoRoot` mirror for consumers that should not unpack the nested
  `workspace` object
- stable workspace metadata now also includes a top-level
  `workspacePreparedAt` mirror for consumers that should not unpack the nested
  `workspace` object
- stable workspace metadata now also includes a top-level
  `workspaceWorktreePath` mirror for consumers that should not unpack the
  nested `workspace` object
- draft PR publishing and guarded merge hooks in the workflow service layer
- event-driven `pull_request` / `pull_request_review` webhook intake with chat
  notifications for tracked lifecycle changes
- explicit chat-side issue drafting via `/occode-intake`, which can:
  - create a new GitHub issue from the bound chat
  - accept either a full issue draft or a single-line request and synthesize a
    minimal issue body automatically
  - hold ambiguous one-line requests behind a pending draft confirmation step
  - let the operator refine that pending draft through `/occode-intake-edit`
  - let the operator create the draft later through `/occode-intake-confirm`
  - queue low-risk issues immediately through the existing workflow path
  - precheck obvious high-risk issues into `escalated` snapshots before any
    branch mutation
  - explicit blueprint-first goal discussion and section editing from chat:
  - `/occode-goal` captures or refines the repo-level goal before issue creation
  - `/occode-blueprint-agree` records the explicit agreed checkpoint from chat
  - `/occode-blueprint-edit` updates a named blueprint section without opening
    `PROJECT-BLUEPRINT.md` manually
  - `/occode-intake-reject` lets a teammate discard an ambiguous pending draft
    instead of forcing issue creation
- structured manual handoff now also exists for worktree edits:
  - `/occode-takeover` records a human takeover against the current tracked
    worktree
  - `/occode-resume-after-edit` queues a structured rerun after the human is done
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
- machine-readable release-readiness artifacts for sync and promotion work:
  - `openclaw code promotion-gate-refresh --json` persists the current branch,
    commit, setup-check readiness, merge-promotion gate state, and rollback
    baseline into `.openclawcode/promotion-gate.json`
  - `openclaw code rollback-suggestion-refresh --json` persists the current
    rollback candidate into `.openclawcode/rollback-suggestion.json`
  - their stable `schemaVersion: 1` contract is documented in
    `release-artifacts-contract.md`
- a stable machine-readable operator-state contract now exists for chat-visible
  status surfaces:
  - `openclaw code operator-status-snapshot-show --json` reads the live
    chatops store and persists nothing new
  - its schema is documented in `operator-status-snapshot-contract.md`
- approved review webhooks can now complete the merge path directly when
  `mergeOnApprove` is enabled:
  - policy-eligible runs merge automatically after GitHub review approval
  - blocked runs can still merge when the operator explicitly approves the
    `merge-promotion` stage gate
- that setup verification script can now also run an isolated built-startup
  proof for the bundled `openclawcode` plugin through
  `--probe-built-startup`, using the same allowlisted diagnostic config that
  previously existed only as a manual field proof
- that setup verification script now also supports `--json`, so another
  operator host or CI job can consume a machine-readable readiness report
- setup verification now also inspects local model inventory through
  `models list --json`:
  - JSON output now includes `modelInventory`
  - JSON output now also includes `readiness` with an explicit next proof or
    rollout action for automation
  - readiness now also distinguishes:
    - live gateway reachability
    - route-probe success
    - whether the isolated built-startup proof was requested
    - whether that built-startup proof actually passed
  - that makes it possible to tell "restart the live gateway" apart from
    "repair the built startup path" without scraping raw check messages
  - human-readable output now tells the operator how many discoverable models
    are available for fallback proofs
  - if `OPENCLAWCODE_MODEL_FALLBACKS` is configured, setup-check now fails when
    any requested fallback model is not actually discoverable on that host
- setup-check now also retries transient GitHub webhook subscription probe
  failures before failing strict mode, which prevents one GitHub TLS/API flap
  from falsely blocking promotion preflight on an otherwise healthy host
- operator setup scripts that can now derive:
  - `openclawcode.env`
  - `openclaw.json`
  - `plugins/openclawcode/chatops-state.json`
    from a single `OPENCLAWCODE_OPERATOR_ROOT` override instead of requiring
    three independent file-path overrides
- a strict copied-root operator proof that now passes
  `scripts/openclawcode-setup-check.sh --strict` when the fresh root keeps its
  webhook repo and hook metadata in `openclawcode.env`
- a repaired built-runtime loader path for the bundled `openclawcode` plugin:
  - the build now ships `dist/extensions/openclawcode/index.js`
  - bundled plugin manifests are now copied into `dist/extensions`
  - built runtime now selectively redirects bundled `openclawcode` to the
    compiled dist entry without letting `dist/extensions` shadow the full
    bundled plugin tree
- a real built `dist/index.js gateway run` proof on `main` with an allowlisted
  diagnostic config:
  - the proof required `plugins.allow = ["openclawcode"]` and
    `plugins.slots.memory = "none"`
  - without that constraint, bundled defaults like `device-pair`, `ollama`,
    `phone-control`, `sglang`, `talk-voice`, `vllm`, and `memory-core` still
    join the load path
  - with that constraint in place, the built gateway reached
    `listening on ws://127.0.0.1:18890`
- a copied-root fresh gateway startup proof that now:
  - starts a second local gateway from `OPENCLAWCODE_OPERATOR_ROOT` on a
    non-default port
  - passes `scripts/openclawcode-setup-check.sh --strict` against that gateway
    with `14 pass`, `0 warn`, and `0 fail`
- the long-lived local operator rooted at `~/.openclaw` is now also proven as
  a real Feishu-driven control plane for `zhyongrui/openclawcode`:
  - repo notifications and commands are bound to one real Feishu conversation
  - `./scripts/openclawcode-setup-check.sh --strict` passes there with
    `19 pass`, `0 warn`, and `0 fail`
  - after code changes, restarting the long-lived gateway is required before
    trusting chat-visible behavior updates
  - for built-startup diagnostics, use an explicit plugin allowlist plus
    `plugins.slots.memory = "none"` so you are proving `openclawcode` itself
    instead of a bundle of default plugins
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
  - `openclaw code reconcile-validation-issues`
  - `openclaw code seed-validation-issue --balanced`
  - `openclaw code reconcile-validation-issues --enforce-minimum-pool-size`
  - `list-validation-issues --json` and `reconcile-validation-issues --json`
    now expose `contractVersion: 1`, documented in
    `docs/openclawcode/validation-pool-contract.md`
  - `docs/openclawcode/validation-pool-maintenance.md` now documents:
    - the minimum-pool targets
    - the balanced-pool seeding path
    - the maintenance cadence
  - `openclaw code list-validation-issues` now reports template-level counts in
    both text and JSON output
  - `openclaw code reconcile-validation-issues` now classifies validation
    issues as `implemented`, `pending`, or `manual-review` and can close
    already-implemented command-layer issues directly from the repo-local CLI
  - `openclaw code list-validation-issues` now also reports minimum-pool
    targets and per-class deficits
  - `openclaw code seed-validation-issue` now also supports
    `command-json-string`, `command-json-string-timestamp`,
    `command-json-string-url`, and `command-json-string-enum`
  - `docs/openclawcode/command-layer-backlog.md` now keeps a much longer
    seed-ready queue than the tiny live GitHub validation pool
  - seeded issue creation now reuses an existing open match instead of creating
    a duplicate
  - current live inventory is visible without opening GitHub manually and
    includes:
    - docs/operator issue `#60`
    - docs/operator issue `#86`
    - command-layer issue `#129` until `publishedPullRequestHasTitle` is
      reconciled on top of the refreshed sync branch
  - duplicate issue `#59` was detected through the new inventory path and then
    closed
  - command-layer issues `#124`, `#126`, `#127`, and `#128` have now also been
    consumed and auto-closed through the same reconcile path
  - stale command-layer issues `#74` through `#82` are now also auto-closable
    through the new reconcile path once their fields have already landed
  - command-layer issue `#91` has now also been consumed and auto-closed
    through the same reconcile path after `failureDiagnosticUsageTotal` landed
  - command-layer issue `#93` has now also been consumed and auto-closed
    through the same reconcile path after `failureDiagnosticSystemPromptChars`
    landed
  - command-layer issue `#96` has now also been consumed and auto-closed
    through the same reconcile path after `failureDiagnosticSkillsPromptChars`
    landed
  - command-layer issue `#97` has now also been consumed and auto-closed
    through the same reconcile path after `failureDiagnosticToolSchemaChars`
    landed
  - command-layer issue `#98` has now also been consumed and auto-closed
    through the same reconcile path after `failureDiagnosticSkillCount`
    landed
  - command-layer issue `#99` has now also been consumed and auto-closed
    through the same reconcile path after
    `failureDiagnosticInjectedWorkspaceFileCount` landed
  - command-layer issue `#100` has now also been consumed and auto-closed
    through the same reconcile path after
    `failureDiagnosticBootstrapWarningShown` landed
  - command-layer issues `#101` and `#102` have now also been consumed and
    auto-closed through the same reconcile path after
    `failureDiagnosticProvider` and `failureDiagnosticModel` landed
  - command-layer issue `#103` has now also been consumed and auto-closed
    through the same reconcile path after `draftPullRequestTitle` landed
  - command-layer issues `#104` and `#105` have now also been consumed and
    auto-closed through the same reconcile path after
    `draftPullRequestOpenedAt` and `draftPullRequestBody` landed
  - command-layer issue `#106` has now also been consumed and auto-closed
    through the same reconcile path after `issueTitle` landed
  - command-layer issue `#107` has now also been consumed and auto-closed
    through the same reconcile path after `issueRepo` landed
  - command-layer issue `#108` has now also been consumed and auto-closed
    through the same reconcile path after `issueOwner` landed
  - command-layer issue `#109` has now also been consumed and auto-closed
    through the same reconcile path after `workspaceBaseBranch` landed
  - command-layer issue `#110` has now also been consumed and auto-closed
    through the same reconcile path after `workspaceBranchName` landed
  - command-layer issue `#111` has now also been consumed and auto-closed
    through the same reconcile path after `workspaceRepoRoot` landed
  - command-layer issue `#112` has now also been consumed and auto-closed
    through the same reconcile path after `workspacePreparedAt` landed
  - command-layer issue `#113` has now also been consumed and auto-closed
    through the same reconcile path after `workspaceWorktreePath` landed
  - command-layer issue `#114` has now also been consumed and auto-closed
    through the same reconcile path after `runCreatedAt` landed
  - command-layer issue `#115` has now also been consumed and auto-closed
    through the same reconcile path after `runUpdatedAt` landed
  - command-layer issue `#116` has now also been consumed and auto-closed
    through the same reconcile path after `issueNumber` landed
  - command-layer issue `#117` has now also been consumed and auto-closed
    through the same reconcile path after `issueUrl` landed
  - command-layer issue `#118` has now also been consumed and auto-closed
    through the same reconcile path after `issueLabelCount` landed
  - command-layer issue `#119` has now also been consumed and auto-closed
    through the same reconcile path after `issueHasLabels` landed
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
  - `openclaw code run --json` now exposes `failureDiagnosticToolCount`
  - `openclaw code run --json` now exposes `failureDiagnosticUsageTotal`
  - `openclaw code run --json` now exposes
    `failureDiagnosticSkillsPromptChars`
  - `openclaw code run --json` now exposes
    `failureDiagnosticToolSchemaChars`
  - `openclaw code run --json` now exposes `failureDiagnosticSkillCount`
  - `openclaw code run --json` now exposes
    `failureDiagnosticInjectedWorkspaceFileCount`
  - `openclaw code run --json` now exposes
    `failureDiagnosticBootstrapWarningShown`
  - `openclaw code run --json` now exposes `failureDiagnosticProvider`
  - `openclaw code run --json` now exposes `failureDiagnosticModel`
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
- `sync/upstream-2026-03-13` has now been promoted back to `main`
- `main` is again the long-lived Feishu operator target branch
- the next sync branch, `sync/upstream-2026-03-14`, now cleanly merges
  `upstream/main` through `c08317203d` and still passes:
  - `pnpm exec vitest run src/agents/sandbox/fs-bridge.shell.test.ts src/infra/safe-open-sync.test.ts --pool threads`
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1`
  - `pnpm build`
  - `./scripts/openclawcode-setup-check.sh --strict --json`
- the refreshed integration baseline is now:
  - `sync/upstream-2026-03-14` for active engineering
  - `main` for the long-lived Feishu operator
- real sync field note:
  - if a fresh sync branch reports missing packages or missing bins right after
    merge, run `pnpm install --frozen-lockfile` before treating it as a source
    regression
  - that exact recovery was required here for:
    - `@modelcontextprotocol/sdk`
    - `tsdown`
    - `vitest`
- the refreshed branch now also passes strict repo-local promotion preflight on
  the live operator root:
  - `summary.pass = 19`
  - `summary.warn = 0`
  - `summary.fail = 0`
  - `readiness.lowRiskProofReady = true`
  - `readiness.promotionReady = true`
  - `readiness.nextAction = "ready-for-low-risk-proof"`
- the refreshed branch has now also cleared the next real low-risk merged
  proof:
  - issue `#87`
  - run `zhyongrui-openclawcode-87-1773494823680`
  - `PR #95`
  - merged automatically against `sync/upstream-2026-03-14`
- useful live policy note from that proof:
  - the verifier still reported one `missingCoverage` item because no explicit
    repo checks were recorded for the docs-only run
  - current policy still allowed auto-merge because the run had no findings
    and remained eligible under the low-risk policy
- that promotion is now complete:
  - `main` and `origin/main` now point at `362374a0d0`
  - the next live slice is to re-prove the long-lived Feishu operator on that
    promoted baseline
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
- refreshed-branch promotion gate is now also satisfied by a real merged proof:
  - issue `#85`
  - run `zhyongrui-openclawcode-85-1773416913744`
  - `PR #88`
  - merged automatically against `sync/upstream-2026-03-13`
- a new terminal workflow state now covers already-satisfied low-risk issues:
  - `completed-without-changes`
  - verification can now finish a run without a PR when no commits were
    produced between the issue branch and the base branch
  - the workflow closes the GitHub issue automatically after verification
- promoted-`main` direct proof now confirms that no-op closeout path:
  - issue `#44`
  - run `zhyongrui-openclawcode-44-1773418941601`
  - final stage `completed-without-changes`
  - GitHub issue `#44` closed automatically without opening a PR
- the repo-local built gateway path on promoted `main` is now re-proved:
  - `/home/zyr/.local/node-v22.16.0/bin/node dist/index.js gateway run --bind loopback --port 18789 --allow-unconfigured --verbose`
    binds `ws://127.0.0.1:18789`
  - `OPENCLAW_DISABLE_LAZY_SUBCOMMANDS=1` now also works against that direct
    `dist/index.js` entrypoint without hitting either `unknown command
'gateway'` or duplicate command registration failures
  - the first startup on this host may spend about five seconds printing
    `Control UI assets missing; building ...` before the gateway listener
    appears
- operator preflight is now tighter too:
  - `scripts/openclawcode-setup-check.sh` accepts
    `OPENCLAWCODE_SETUP_NODE_BIN=/path/to/node>=22.16.0`
  - direct CLI probes such as `models list --json` are now bounded, and the
    script skips model inventory entirely when the selected Node runtime is
    already below the CLI startup floor
- the remaining live-ops blocker after that hardening is now narrower:
  - the minimal direct `dist/index.js gateway run --allow-unconfigured` proofs
    are healthy on `main`
  - sourcing the real long-lived `~/.openclaw` operator environment can still
    stall before the listener appears, so the next slice should debug that
    real-config startup path rather than the generic built entrypoint
