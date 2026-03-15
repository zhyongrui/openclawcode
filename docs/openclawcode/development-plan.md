# OpenClawCode Development Plan

## Purpose

This document is the working implementation roadmap for `openclawcode`.

It is intentionally broader than a single issue. It defines:

- the product target
- the delivery phases
- the near-term engineering backlog
- the test strategy
- the operating rules for implementation slices

The goal is to make it possible to keep building for long stretches without
losing architectural direction.

For the exhaustive cross-track backlog that runs all the way to the intended
operator end-state, see `full-program-roadmap.md`.

For the checkbox-driven master execution queue that is meant to survive many
future sessions, see `master-delivery-checklist.md`.

## Final Delivery Plan

The work should now converge on a public-usable operator, not an endless
sequence of isolated fixes.

The remaining program is:

1. keep `main` green after the `sync/upstream-2026-03-14` promotion and keep
   the documented repo-local gateway entrypoint healthy on Node `>=22.16.0`,
   including the first-start Control UI auto-build path
2. re-prove the long-lived `main` Feishu operator with one merged low-risk
   path, one no-op completion path, and one blocked or escalated path
3. finish chat-native intake so a teammate can draft, confirm, and launch work
   from Feishu without hand-writing GitHub issue bodies
4. finish the stable machine-readable contract:
   - `openclaw code run --json`
   - setup-check JSON
   - validation-pool inventory
     so external automation and other AI sessions can reason about state without
     parsing history strings
5. finish install, upgrade, promotion, and rollback docs so a fresh operator
   host can stand the system up from scratch
6. prove that fresh-host path with one real low-risk merged run
7. package release-facing docs that explain prerequisites, supported scope,
   policy, known limits, and rollback

Every completed slice should either:

- remove one blocker from that path
- harden a proof already on that path
- or improve the docs or machine-readable surfaces needed to repeat that path

## Product Target

`openclawcode` should become a GitHub-driven coding assistant built on the
OpenClaw runtime base.

The intended loop is:

1. ingest a GitHub issue or issue event
2. notify the configured chat surface for the target repository
3. let a human approve, skip, or defer the run from chat
4. decide whether the issue is suitable for autonomous work
5. plan the implementation
6. create an isolated worktree and branch
7. implement the change
8. run targeted validation
9. open a draft PR
10. run an independent review and verification pass
11. either escalate, request changes, or mark ready for human review
12. optionally support guarded merge automation later
13. notify humans of the final outcome in chat

The key constraint is that `openclawcode` is not just a prompt wrapper.
It needs durable workflow state, explicit policy, reproducible isolation, and
observable artifacts.

## Current Baseline

As of 2026-03-14, the repository already has a working issue-driven core plus a
real bundled OpenClaw chatops adapter:

- workflow contracts and stage transitions
- persisted workflow runs and isolated git worktrees
- GitHub issue webhook intake with delivery-id deduplication
- builder and verifier adapters backed by the OpenClaw runtime
- `openclaw code run ...` CLI execution
- draft PR publishing hooks and guarded merge plumbing
- bundled OpenClaw plugin command surface:
  - `/occode-intake`
  - `/occode-start`
  - `/occode-status`
  - `/occode-inbox`
  - `/occode-skip`
  - `/occode-sync`
  - `/occode-bind`
  - `/occode-unbind`
- repository notification bindings for chat delivery
- explicit chat-side issue drafting that can create a GitHub issue from the
  current chat and route it through the same suitability precheck and queue
  path as webhook-created issues
- `/occode-intake` now also accepts a single-line request and synthesizes a
  minimal issue body automatically, which narrows the gap toward more natural
  chat-native intake
- persisted plugin queue state with structured workflow status snapshots
- local-run reconciliation from `.openclawcode/runs`, including PR continuity
  recovery when a newer rerun artifact omits draft PR metadata
- failure-path recovery that now records the latest local failed run artifact as
  a tracked snapshot when background execution exits non-zero or returns
  unparsable stdout
- agent-backed builder/verifier execution now treats agent `stopReason=error`
  as a hard workflow failure instead of accepting the raw error payload as a
  successful build summary
- transient provider failures such as `HTTP 400: Internal server error` now get
  one narrow builder/verifier retry window before the workflow gives up
- that outer retry window is now shorter for provider-side
  `HTTP 400: Internal server error` failures than it is for timeout or overload
  retries, so repeated fresh failures surface faster without removing the
  recovery attempt entirely
- openclawcode issue-worktree runs now disable the embedded Pi SDK's inner
  retry loop so provider-side transient failures surface through the workflow's
  own builder/verifier retry policy instead of silently stretching a single
  build attempt
- GitHub-side healing for:
  - merged PRs
  - approved reviews
  - changes-requested reviews
  - closed-without-merge PRs
- rerun continuity that reuses an existing open PR for the same issue branch
- background issue execution through the built CLI entrypoint
- operator runbooks for:
  - local gateway and repo binding setup
  - temporary webhook ingress
- a repo-local setup verification script for gateway, webhook, binding, tunnel
  health, and required GitHub webhook event subscriptions
- that same setup verification script can now also run a bounded built-startup
  proof for the bundled `openclawcode` plugin through
  `--probe-built-startup`, using the same allowlisted diagnostic config that
  was previously only documented as a manual field procedure
- a built bundled entry for `openclawcode` at
  `dist/extensions/openclawcode/index.js`
- copied bundled plugin manifests inside `dist/extensions/*` so the built
  runtime can resolve bundled plugin schemas and metadata without falling back
  to the source tree for everything
- real live lifecycle replay for one tracked PR covering:
  - `pull_request_review` changes requested
  - `pull_request_review` approved
  - `pull_request` closed without merge

The repository has already proven several real production-style checkpoints:

- real GitHub issues can drive code changes in this repository
- real draft PRs can be opened from workflow runs
- a full issue-driven run can reach merged state and close the issue
- chatops-triggered background execution can complete and persist results
- operator-facing recovery commands can heal local state after interruptions

The current bottleneck is no longer basic execution. The current bottleneck is
turning the working loop into a cleanly operable product:

- issue intake, lifecycle updates, rerun control, operator ledger visibility,
  and setup verification now exist, and the real review or close-without-merge
  lifecycle path has now been replayed successfully
- the preflight blockers found during live replay are now fixed, and the live
  route has now validated:
  - real review replay
  - closed-without-merge replay
  - one fresh `/occode-rerun` path through issue `#40`
- live rerun validation also forced one more worktree hardening pass so stale
  issue branches now merge the latest base before publication instead of
  reopening dirty PRs from outdated branch state
- the validated sync-branch hardening has now been promoted back to `main`,
  pushed to `origin/main`, and the live gateway has been restarted on commit
  `7d4d6ec`
- a direct live rerun attempt for issue `#44` on refreshed `main` exposed a new
  builder/workspace integrity failure:
  - the agent-backed builder can corrupt a file inside the isolated issue
    worktree when its file-edit bridge drifts away from the real worktree path
  - the current observed failure mode was an unexpected truncation of
    `src/commands/openclawcode.ts` inside the issue worktree, followed by a
    stalled run and host lint failure
- the builder/workspace response to that failure is now in place:
  - `AgentBackedBuilder` fails fast when an existing tracked file becomes empty
    in the isolated issue worktree
  - `runIssueWorkflow` now persists stage-specific `failed` artifacts instead
    of leaving the run stranded behind later shell or lint failures
  - a fresh direct live rerun of issue `#44` on refreshed `main` no longer
    reproduced the corruption and completed as a no-op
    `ready-for-human-review` run
- the live merged-PR proof on refreshed `main` is now complete through issue
  `#45` and `PR #46`
- the builder now has two additional mitigations around the remaining sandbox
  edit bridge bug:
  - host and sandbox edit recovery both verify alias-based edit calls using
    `file_path`, `old_string`, and `new_string`
  - `OpenClawAgentRunner` now keeps the default runtime tool deny focused on
    `write` while sandbox `edit` stays enabled by default after live proof on
    `sync/upstream-2026-03-12`
- the low-risk merged live proof under
  `OPENCLAWCODE_ENABLE_FS_TOOLS=write` is now complete through issue `#48` and
  `PR #49`
- fresh-operator-environment proof is now complete through copied-root issue
  `#51`, run `zhyongrui-openclawcode-51-1773297182598`, and merged `PR #52`
- the workflow now records explicit suitability decisions before workspace
  preparation and can escalate high-risk issues before any branch mutation
- webhook and chat intake now honor an explicit high-risk precheck before
  approval or auto-queue
- operator-facing status and inbox views now surface suitability decisions and
  summaries
- the long-lived `main` operator baseline is now revalidated through merged
  issue `#56` / `PR #57`, restored `approve` trigger mode, and a strict setup
  health check returning `15 pass`, `0 warn`, `0 fail`
- the webhook high-risk precheck path is now revalidated on the long-lived
  `main` operator through issue `#58`, including accepted delivery reason
  `precheck-escalated`, run id `intake-precheck-58`, and no pending approval or
  queued run
- operator health checks now retry transient gateway reachability and signed
  webhook probe failures during short restart windows
- validation-pool upkeep now has a repo-native CLI surface through:
  - `openclaw code seed-validation-issue`
  - `openclaw code list-validation-issues`
- operator-facing inbox and status views now surface that same validation-pool
  taxonomy directly from chat:
  - `/occode-inbox` appends the live open validation pool
  - `/occode-inbox` now also summarizes the live pool by validation class and
    template before listing the individual issues
  - `/occode-status <issue>` annotates validation issues with class and
    template metadata
- `openclaw code list-validation-issues` now reports template-level counts in
  both text and JSON output, so pool upkeep no longer requires manual counting
- `openclaw code reconcile-validation-issues` now turns validation-pool drift
  into a first-class surface:
  - it classifies open validation issues as `implemented`, `pending`, or
    `manual-review`
  - it can close already-implemented command-layer issues directly from the
    repo-local CLI
  - it emits a next-step hint so later sessions know whether to close stale
    issues or seed a fresh command-layer proof
- current live inventory is now:
  - docs/operator issue `#60`
  - docs/operator issue `#86`
  - command-layer issue `#117` for `issueUrl`
- duplicate seeding attempts now reuse an existing open issue with the same
  template and title instead of creating a fresh duplicate
- duplicate issue `#59` was detected via the new inventory command and then
  closed to restore a clean pool
- command-layer issues `#54` and `#50` have now been implemented on `main` and
  closed, proving the consume-and-reseed loop on two consecutive real issues
- command-layer issue `#55` has now also been implemented on `main` and closed
- command-layer issues `#61` and `#62` have now also been implemented on
  `main` and closed
- command-layer issues `#63` and `#64` have now also been implemented on
  `main` and closed
- command-layer issues `#65` and `#68` have now also been implemented on
  `main` and closed through the live Feishu operator path
- command-layer issue `#66` has now also been implemented on `main` and closed
- command-layer issue `#72` has now also been implemented on `main` and closed
- command-layer issue `#73` has now also been implemented on `main` and closed
- stale command-layer validation issues `#74` through `#82` are now closed via
  the reconcile command rather than left hanging after their fields landed
- command-layer issue `#89` for `failureDiagnosticToolCount` has now also been
  implemented, documented, and auto-closed through that same reconcile path
- command-layer issue `#91` for `failureDiagnosticUsageTotal` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issue `#93` for `failureDiagnosticSystemPromptChars` has now
  also been implemented, documented, and auto-closed through the same path
- command-layer issue `#96` for `failureDiagnosticSkillsPromptChars` has now
  also been implemented, documented, and auto-closed through the same path
- command-layer issue `#97` for `failureDiagnosticToolSchemaChars` has now
  also been implemented, documented, and auto-closed through the same path
- command-layer issue `#98` for `failureDiagnosticSkillCount` has now also
  been implemented, documented, and auto-closed through the same path
- command-layer issue `#99` for `failureDiagnosticInjectedWorkspaceFileCount`
  has now also been implemented, documented, and auto-closed through the same
  path
- command-layer issue `#100` for `failureDiagnosticBootstrapWarningShown` has
  now also been implemented, documented, and auto-closed through the same path
- validation-pool tooling now also supports `command-json-string`, so the
  replenished command-layer pool continues with issue `#111` for `workspaceRepoRoot`
- command-layer issues `#101` and `#102` have now also been implemented,
  documented, and auto-closed through the same path
- command-layer issue `#103` for `draftPullRequestTitle` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issues `#104` and `#105` for `draftPullRequestOpenedAt` and
  `draftPullRequestBody` have now also been implemented, documented, and
  auto-closed through the same path
- command-layer issue `#106` for `issueTitle` has now also been implemented,
  documented, and auto-closed through the same path
- command-layer issue `#107` for `issueRepo` has now also been implemented,
  documented, and auto-closed through the same path
- command-layer issue `#108` for `issueOwner` has now also been implemented,
  documented, and auto-closed through the same path
- command-layer issue `#109` for `workspaceBaseBranch` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issue `#110` for `workspaceBranchName` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issue `#111` for `workspaceRepoRoot` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issue `#112` for `workspacePreparedAt` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issue `#113` for `workspaceWorktreePath` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issue `#114` for `runCreatedAt` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issue `#115` for `runUpdatedAt` has now also been
  implemented, documented, and auto-closed through the same path
- command-layer issue `#116` for `issueNumber` has now also been
  implemented, documented, and auto-closed through the same path
- validation-pool tooling now continues with command-layer issue `#117` for
  `issueUrl`
- the `failureDiagnostics` family is now effectively mirrored at the top level
  for:
  - summary
  - provider
  - model
  - prompt footprint
  - tool/schema footprint
  - skill/file counts
- stable draft PR metadata mirroring now also includes the nested
  `draftPullRequest.title` field at the top level via `draftPullRequestTitle`
- stable draft PR metadata mirroring now also includes the nested
  `draftPullRequest.body` and `draftPullRequest.openedAt` fields at the top
  level via `draftPullRequestBody` and `draftPullRequestOpenedAt`
- stable workflow identity mirroring now also includes the nested `issue.title`
  field at the top level via `issueTitle`
- stable workflow identity mirroring now also includes the nested `issue.repo`
  field at the top level via `issueRepo`
- stable workflow identity mirroring now also includes the nested `issue.owner`
  field at the top level via `issueOwner`
- stable workspace mirroring now also includes the nested
  `workspace.baseBranch` field at the top level via `workspaceBaseBranch`
- stable workspace mirroring now also includes the nested
  `workspace.branchName` field at the top level via `workspaceBranchName`
- stable workspace mirroring now also includes the nested
  `workspace.repoRoot` field at the top level via `workspaceRepoRoot`
- stable workspace mirroring now also includes the nested
  `workspace.preparedAt` field at the top level via `workspacePreparedAt`
- stable workspace mirroring now also includes the nested
  `workspace.worktreePath` field at the top level via `workspaceWorktreePath`
  - bootstrap-warning signal
  - usage total
- a fresh explicit chat-intake live proof is now complete through issue `#70`:
  - `/occode-intake` created the GitHub issue and queued it from chat-facing
    operator state
  - the new failed-run snapshot recovery path allowed `/occode-rerun #70` to
    target the failed run after reconciliation
  - both live attempts on `#70` were blocked by repeated upstream provider
    `400 Internal server error` responses rather than workflow state loss or
    queue corruption
- a fresh operator-surface live proof now confirms validation-pool visibility
  from chat-facing state too:
  - `/occode-inbox` lists open validation issues `#60` and `#66`
  - `/occode-status #66` annotates the issue as
    `command-layer / command-json-number`
- a refreshed upstream integration branch,
  `sync/upstream-2026-03-12-refresh`, now merges `upstream/main` through
  `c965049dc6` and still passes:
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads`
  - `pnpm build`
- the next sync branch, `sync/upstream-2026-03-13`, now cleanly merges
  `upstream/main` through `80e7da92ce` and still passes:
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1`
  - `pnpm build`
- `sync/upstream-2026-03-13` has now been promoted back to `main`
- `main` is once again both the active engineering baseline and the long-lived
  Feishu operator target branch
- the next refreshed integration branch, `sync/upstream-2026-03-14`, now
  cleanly merges `upstream/main` through `c08317203d` and still passes:
  - `pnpm exec vitest run src/agents/sandbox/fs-bridge.shell.test.ts src/infra/safe-open-sync.test.ts --pool threads`
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1`
  - `pnpm build`
  - `./scripts/openclawcode-setup-check.sh --strict --json`
- `main` remains the long-lived Feishu operator baseline, but active
  integration work now continues on `sync/upstream-2026-03-14` until that
  branch completes another low-risk live proof
- `sync/upstream-2026-03-14` has now also cleared that low-risk proof gate:
  - issue `#87`
  - run `zhyongrui-openclawcode-87-1773494823680`
  - `PR #95`
  - merged automatically against `sync/upstream-2026-03-14`
- the next promotion step is now concrete rather than speculative:
  - fast-forward `main` to `sync/upstream-2026-03-14`
  - re-prove the long-lived `main` baseline on the promoted build
- that promotion is now complete:
  - `main` fast-forwarded to `362374a0d0`
  - `origin/main` now matches that promoted baseline
- field note from that sync:
  - a clean merge can still leave the local dependency install stale enough to
    report missing packages or missing bins
  - immediately rerun `pnpm install --frozen-lockfile` before treating those
    failures as source regressions
- field note from the live proof:
  - `#87` merged even though the verifier still reported one
    `missingCoverage` item because no explicit repo checks were recorded
  - future policy-hardening work should decide whether that is acceptable
    steady-state behavior or whether docs-only auto-merge needs a stricter gate
- upstream also raised the runtime floor to Node `>=22.16.0`:
  - this workstation now runs local Node `22.16.0`
  - the built CLI entrypoint refuses to start below that floor
  - refreshed-branch promotion planning now needs to keep that floor green in
    setup checks rather than treating it as a soft warning
- the built-runtime startup blocker around the bundled `openclawcode` plugin is
  now fixed on `main`:
  - bundled plugin discovery now prefers `<packageRoot>/extensions`, so a
    partial `dist/extensions` tree no longer shadows the full bundled plugin
    set
  - built runtime now selectively redirects bundled `openclawcode` to
    `dist/extensions/openclawcode/index.js` when the compiled entry and
    manifest are present
  - direct `jiti()` loading of the compiled `openclawcode` entry now completes
    instead of stalling in the old TS-loader path
- a real built `dist/index.js gateway run` proof is now complete on `main`
  with a sanitized allowlisted config:
  - `channels = {}`
  - `bindings = []`
  - `plugins.allow = ["openclawcode"]`
  - `plugins.slots.memory = "none"`
  - `plugins.entries.openclawcode.enabled = true`
  - listener reached `ws://127.0.0.1:18890`
- the allowlist note matters:
  - a naive "openclawcode-only" config still leaves bundled defaults like
    `device-pair`, `ollama`, `phone-control`, `sglang`, `talk-voice`, `vllm`,
    and `memory-core` enabled unless `plugins.allow` and the memory slot are
    constrained explicitly
- issue `#71` exposed a workflow-fidelity bug after a one-line chat intake
  proof:
  - builder accepted agent `stopReason=error` output as a successful build
    summary
  - `/occode-status` then surfaced the stale build summary instead of the true
    failing stage note
  - both behaviors are now fixed
- a fresh live rerun proof on issue `#71` is now complete:
  - rerun `zhyongrui-openclawcode-71-1773319180096` failed directly in the
    build stage on the same repeated provider-side `HTTP 400` condition
  - `/occode-status #71` now surfaces
    `Build failed: HTTP 400: Internal server error`
    instead of the old stale verification-path summary
  - this confirms the remaining blocker is upstream model stability, not local
    workflow-fidelity drift
- a second live provider-instability proof is now complete on the updated
  operator build:
  - rerun `zhyongrui-openclawcode-71-1773321945403` failed in the build stage
    after two outer builder attempts, with each embedded builder session
    emitting only one assistant `400 Internal server error`
  - rerun `zhyongrui-openclawcode-66-1773322176634` behaved the same way and
    reactivated the queue-level provider pause with two fresh failures in the
    rolling window
  - this confirms both halves of the guardrail now hold live:
    - single builder attempts no longer burn multiple hidden provider retries
    - repeated fresh workflow failures still pause queue consumption
- provider-pause state is now visible from the main interactive operator
  commands too:
  - `/occode-start` and `/occode-rerun` now append the active pause window and
    reason when work is queued behind a provider pause
  - `/occode-status` now appends the same pause context so queued or failed
    issues can be interpreted without first opening `/occode-inbox`
- provider-failure context now persists per issue even after the active global
  pause clears:
  - `/occode-status` and `/occode-inbox` keep the last transient failure time,
    failure count, and pause reason on the affected issue snapshot
  - those surfaces now explicitly distinguish `active pause until ...` from
    `pause cleared after ...`, which closes the earlier ambiguity where the
    pause banner disappeared and operators had to guess whether context was
    lost or the provider had recovered
- `/occode-rerun` queue replies now reuse that same operator context:
  - active pauses still render the active pause window
  - cleared pauses now render as a recovery probe so the operator can see that
    the rerun is intentionally testing whether provider-side build failures
    have recovered
- refreshed-branch direct reruns on issue `#87` now prove that the new
  lightweight bootstrap path is active for
  `/.openclawcode/worktrees/...` runs:
  - the earlier `workspace bootstrap file AGENTS.md ... truncating` warning is
    gone
  - `systemPromptReport.bootstrapTruncation.warningShown` stays `false`
  - `systemPromptReport.injectedWorkspaceFiles` is now empty on the live
    builder session
  - the remaining blocker is still provider
    `HTTP 400: Internal server error`, but it now survives after the bootstrap
    fix, which means the next slice should target prompt budget or provider
    behavior instead of more bootstrap-file filtering
- a second prompt-budget slice on the same issue now proves that local issue
  worktree sessions are materially slimmer than before:
  - tool schemas are down to the four core coding tools:
    `read`, `edit`, `exec`, `process`
  - a temporary agent entry is now upserted when the real operator config only
    has `agents.defaults`, so the coding-only skill filter still applies live
  - live `systemPromptReport.systemPrompt.chars` dropped from `12366` to `8629`
  - live `systemPromptReport.skills.promptChars` dropped from `4982` to `1245`
  - provider `HTTP 400: Internal server error` still remained after that drop,
    so the next slice should move from prompt-budget trimming toward
    provider/model-specific diagnostics or fallback behavior
- a provider-resilience follow-up is now defined around persisted failure
  diagnostics instead of more blind reruns:
  - compact provider/model/system-prompt diagnostics should live in the failed
    workflow note itself
  - the next rerun on refreshed-branch issue `#87` should make that compact
    diagnostic line visible from the saved run artifact and chat status
- policy docs are now in sync with the live-tested guarded auto-merge behavior
- the next engineering priority is now consume-and-reseed workflow plus
  broader chat-native intake behavior
- packaging and installation are now documented locally, but still need more
  proof under a fresh operator environment
- setup-check now also retries transient GitHub webhook subscription probe
  failures, so one TLS/API flap does not falsely block promotion or live-proof
  preflight on an otherwise healthy operator host
- the next startup investigation is now narrower:
  - the repaired built openclawcode-only startup path is healthy
  - any remaining full-config startup stall should be debugged as another
    live-config component rather than a regression in the bundled
    `openclawcode` loader path

## Next Iteration Plan

As of 2026-03-14, the immediate next stage is no longer workflow bring-up. The
next stage is turning the already-working loop into a repeatable delivery
system that can keep shipping on the same branch that the live runner uses.

The short-term objective is:

- keep `main` as both the active engineering baseline and the stable
  long-lived Feishu operator target branch after the
  `sync/upstream-2026-03-14` promotion
- keep using real GitHub issues as the driver
- keep validating each slice end-to-end against this repository
- move from "observable workflow state" toward "live repository automation with
  repeatable baseline promotion"
- make chat the normal operator entrypoint instead of a side-channel demo
- keep the new explicit `/occode-intake` path stable while it serves as the
  bridge toward more natural chat-driven issue drafting
- keep operator-facing validation-pool surfaces stable so the pool can be
  maintained without dropping into CLI
- keep the repaired failed-run summaries stable so provider-side errors stay
  attributable to the build/verifier stage that actually failed
- keep the refreshed-branch live proofs focused on the actual remaining blocker:
  provider-side build failures after bootstrap-lightweight context and
  coding-only issue-worktree prompt trimming have already removed the obvious
  local prompt inflation signals
- persist provider/model diagnostics in failed workflow notes before choosing
  the next fallback behavior
- keep those same diagnostics visible in operator surfaces and snapshots so
  chat-visible failure triage does not regress once a provider pause clears
- keep operator preflight and promotion checks consumable by automation so a
  different operator host can gate rollout without parsing human-only text
- treat `pnpm install --frozen-lockfile` as the first post-sync recovery step
  when a fresh merge branch surfaces missing-package or missing-bin failures
- keep the new openclawcode-worktree retry clamp stable so the outer workflow
  owns provider backoff instead of the embedded SDK
- keep provider-pause activation observable and predictable after fresh
  transient failures
- keep `main` usable as the live validation base instead of letting the real
  runner drift behind the latest integration work
- keep the repaired built `dist/index.js` startup path healthy on `main`
  instead of drifting back to a TS-only plugin-loading path
- keep the startup-proof recipe explicit:
  openclawcode-only diagnostics need an allowlist plus
  `plugins.slots.memory = "none"` or bundled default plugins will pollute the
  result
- keep the now-proven merged-PR path stable on refreshed integration branches
  while proving fresh-operator reproducibility
- keep the repaired sandbox edit and write paths stable without reintroducing
  runtime-only mitigations
- align the roadmap and setup docs with the behavior already proved in code
- keep a renewable queue of low-risk validation issues available so the next
  live proof does not stall on missing repository traffic
- absorb upstream runtime movement continuously, but only through explicit sync
  branches with targeted validation and promotion checkpoints
- keep current docs-only auto-merge behavior explicit in the docs until policy
  is tightened: missing coverage alone does not currently block a low-risk
  docs proof from merging

### Rolling Execution Loop

The next several development cycles should now follow one repeating loop:

1. refresh `upstream/main` into a dedicated `sync/upstream-*` branch whenever
   the local branch is materially behind
2. keep feature work on that refreshed sync branch until the next operator
   proof is ready
3. land one narrow slice at a time with:
   - code
   - tests
   - build validation
   - dev-log updates
   - operator or runbook notes when the slice changes real operating behavior
4. consume one low-risk validation issue and immediately reseed the next one
   before the pool runs dry
5. run a real proof on the refreshed branch once a coherent batch of low-risk
   slices is ready
6. only then promote the refreshed branch back to `main` and restart the
   long-lived operator there

This keeps upstream sync, feature work, and live operator promotion separate
enough that failures stay attributable.

### Long-Range Program Update

The longer-range delivery program should now run in six rolling phases instead
of only chasing the next single live fix.

#### Phase 1: Stable Live Baseline

Status:

- complete as of 2026-03-12 via issue `#48`, run
  `zhyongrui-openclawcode-48-1773286729110`, and merged `PR #49`

Goal:

- finish the remaining live-proof gap under
  `OPENCLAWCODE_ENABLE_FS_TOOLS=write`
- keep the same branch usable for repeated real issue runs without manual
  cleanup between slices

Exit criteria:

- one low-risk command-layer issue reaches PR publication, verification,
  guarded merge, and issue closure under the expanded fs-tool surface
- operator-visible status and chat output stay coherent for that merged path

#### Phase 2: Fresh-Operator Reproducibility

Status:

- complete as of 2026-03-12 via copied-root issue `#51`, run
  `zhyongrui-openclawcode-51-1773297182598`, and merged `PR #52`
- copied-root setup verification is now working through a single
  `OPENCLAWCODE_OPERATOR_ROOT`
- a copied-root fresh gateway startup proof is now complete on a secondary
  local port
- a copied-root end-to-end issue run is now complete from that fresh
  environment

Goal:

- prove that a fresh operator environment can be stood up from docs and scripts
  instead of local tribal knowledge

Exit criteria:

- a fresh `.openclaw` state root can be configured from the documented steps
- setup verification passes without hand-edited hidden state
- one end-to-end issue run can be triggered from that fresh environment

#### Phase 3: Autonomous Suitability Gating

Status:

- complete as of 2026-03-12 on the long-lived `main` operator baseline
- explicit suitability assessments now persist `auto-run`,
  `needs-human-review`, or `escalate` decisions before workspace preparation
- a real high-risk direct CLI proof is now complete through issue `#53`, run
  `zhyongrui-openclawcode-53-1773298188208`
- webhook and chat intake now precheck obvious high-risk issues into
  `precheck-escalated` snapshots instead of `pendingApprovals` or `queue`
- operator-facing status and inbox views now expose suitability decisions and
  summaries for both workflow runs and webhook prechecks
- the long-lived `main` operator baseline is now revalidated through issue
  `#58`, which produced accepted delivery reason `precheck-escalated`, run id
  `intake-precheck-58`, and no pending approval or queued run

Goal:

- make the system better at deciding which issues should auto-run, wait for a
  human, or be rejected as too risky

Exit criteria:

- issue suitability rules are explicit, testable, and visible in workflow
  artifacts
- unsafe or ambiguous issues are routed to humans before branch mutation starts

#### Phase 4: Runtime Simplification

Goal:

- reduce temporary builder mitigations, sandbox-specific edge cases, and prompt
  workarounds as the underlying tool path becomes stable

Exit criteria:

- the live runner no longer depends on prompt-only guardrails for basic safety
- sandbox and host tool behavior stay aligned across edit, write, and read
  paths

#### Phase 5: Operator Productization

Goal:

- treat `openclawcode` as an installable operator product, not just a local
  validated branch

Exit criteria:

- install, upgrade, rollback, and upstream-sync workflows are documented and
  repeatable
- policy docs match the guarded merge behavior already enforced in code

#### Phase 6: Continuous Validation Loop

Goal:

- keep a renewable pool of small real issues available so regression proofs do
  not stall on missing validation traffic

Exit criteria:

- there is always at least one low-risk command-layer validation issue and one
  low-risk docs/operator issue available
- when the validation pool is empty, Codex replenishes it through
  `openclaw code seed-validation-issue` instead of an ad hoc GitHub API call
- the current live inventory is explicit and reusable:
  - command-layer issues `#74`, `#75`, `#76`, `#77`, `#78`, `#79`, `#80`
  - docs/operator issue `#60`
- duplicate seed attempts are absorbed back into the existing pool instead of
  creating another open issue with the same title

### Current Checkpoint

The current repository state already supports:

- persisted run records
- isolated worktrees
- builder/verifier execution
- real draft PR publication in this repository
- webhook-backed chatops intake plumbing
- event-driven PR/review lifecycle webhook intake with chat notifications
- queue persistence and background execution
- chat-visible operator commands and recovery commands
- structured status snapshots for workflow runs and tracked PRs
- repo-to-chat binding commands for notification routing
- on-demand GitHub healing for review, merge, and closed-without-merge states
- reruns that reuse an already-open PR for the same issue branch
- explicit rerun control with persisted rerun context in workflow artifacts
- stable top-level JSON fields for downstream automation, including:
  - changed files
  - issue classification
  - scope-check status and blocked files
  - draft PR metadata and disposition
  - published PR and merged PR status
  - verification decision, summary, boolean findings flag, and counts
  - auto-merge policy eligibility and disposition
- operator runbooks for local setup, repo binding, and temporary webhook ingress
- a repo-local setup verification script for gateway, webhook, binding, tunnel
  health, and required GitHub webhook event subscriptions
- operator setup scripts that now derive env, config, and plugin state from a
  single `OPENCLAWCODE_OPERATOR_ROOT` override instead of requiring separate
  file-path overrides for each script
- a strict copied-root operator health-check proof that now passes when the
  fresh root persists webhook repo and hook metadata in `openclawcode.env`
- a copied-root fresh gateway startup proof that now:
  - launches a second local gateway from that copied root on port `18889`
  - passes `scripts/openclawcode-setup-check.sh --strict` against the copied
    root and alternate gateway URL with `14 pass`, `0 warn`, and `0 fail`
- a copied-root end-to-end issue proof on that fresh operator root:
  - issue `#51` was accepted from a copied-root webhook intake and auto-enqueued
  - run `zhyongrui-openclawcode-51-1773297182598` opened `PR #52`
  - `PR #52` merged at `2026-03-12T06:35:52Z`
  - issue `#51` closed at `2026-03-12T06:35:54Z`
- a fresh live merged-PR proof on refreshed `main` for issue `#45`:
  - two failed reruns persisted cleanly as `failed` artifacts
  - recovery after runtime tool hardening
  - `PR #46` published, verified, auto-merged, and the issue closed
- a fresh sync-branch merged live proof under
  `OPENCLAWCODE_ENABLE_FS_TOOLS=write` for issue `#48`:
  - the validation pool was empty, so a new low-risk command-layer issue was
    seeded directly through the GitHub API
  - run `zhyongrui-openclawcode-48-1773286729110` stayed scoped to
    `src/commands/openclawcode.ts` and `src/commands/openclawcode.test.ts`
  - `PR #49` published, verified, auto-merged, and issue `#48` closed
  - the merged run added stable top-level JSON output
    `verificationHasFindings`
- an explicit suitability gate before workspace preparation that now:
  - records a structured `suitability` assessment in workflow artifacts and
    `openclaw code run --json`
  - escalates high-risk issues before worktree preparation or PR publication
  - keeps non-auto-run suitability decisions out of the guarded auto-merge path
- a fresh direct suitability proof through issue `#53`, including:
  - run `zhyongrui-openclawcode-53-1773298188208`
  - stage `escalated` before workspace preparation
  - no changed files, no worktree, and no PR publication
- a copied-root webhook precheck proof for synthetic issue `#9053`, including:
  - local signed webhook delivery to the copied gateway on `127.0.0.1:18889`
  - accepted delivery reason `precheck-escalated`
  - an `escalated` snapshot with run id `intake-precheck-9053`
  - no `pendingApprovals` entry and no queued run
- a long-lived `main` baseline merged proof for issue `#56`, including:
  - `PR #57` merged to `main`
  - issue `#56` closed after merge
  - local `main` fast-forwarded to merge commit `316ea9a5571159cc85e11f11cc4cccd87ffdd632`
- a long-lived `main` webhook precheck proof through issue `#58`, including:
  - accepted delivery reason `precheck-escalated`
  - an `escalated` snapshot with run id `intake-precheck-58`
  - no `pendingApprovals` entry and no queued run
- operator-facing suitability surfaces that now:
  - include suitability decision and summary in run status messages
  - include a `suitability:` ledger line in `/occode-inbox` recent activity
- operator health-check resilience that now:
  - retries transient gateway reachability failures during restart windows
  - retries transient signed webhook probe failures during the same window
- runner-level tool hardening that originally removed `edit` and `write` from
  live `openclawcode` agent sessions while the sandbox edit bridge was being
  repaired
- sandbox edit recovery that now:
  - verifies the real host-side worktree file instead of trusting the bridge
    readback alone
  - restores the original file contents through the resolved host path when the
    bridge write path still leaves the mounted file empty
- a deterministic sandbox edit path that now performs the exact replacement
  through the bridge directly instead of delegating the mutation step to the
  upstream sandbox edit implementation
- a docker-gated sandbox edit e2e regression that exercises alias-style edit
  params against a real workspace mount before the temporary runtime deny is
  removed
- a second docker-gated linked-worktree edit e2e regression that proves the
  rewritten sandbox edit path keeps large files visible through both
  `/workspace` and the absolute worktree mount shape used in live issue runs
- a staged runner re-enable switch:
  - default now allows `edit` after live proof on
    `sync/upstream-2026-03-12`
  - `OPENCLAWCODE_ENABLE_FS_TOOLS=write` allows the remaining full fs-tool
    replay
  - `OPENCLAWCODE_ENABLE_FS_TOOLS=edit,write` remains accepted as a
    backward-compatible synonym for the same full fs-tool replay
- a refreshed upstream integration branch, `sync/upstream-2026-03-12`, that
  cleanly merges `upstream/main` through `841ee24340` and still passes:
  - `pnpm build`
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads`
- a fresh sync-branch live validation on issue `#36` that reached
  `ready-for-human-review` and exposed three real follow-ups that are now fixed:
  - the setup health-check must require
    `OPENCLAWCODE_GITHUB_WEBHOOK_SECRET` in the configured env file instead of
    accepting an inherited process secret
  - draft PR metadata must preserve a non-`main` workflow base branch instead
    of hard-coding `main`
  - the sandbox fs pinned mutation helper must preserve stdin payloads for
    writes instead of consuming stdin for the embedded Python script itself
- a local shell regression for the pinned sandbox write helper plus rerun proof
  through:
  - `src/agents/sandbox/fs-bridge.e2e-docker.test.ts`
  - `src/agents/pi-tools.read.sandbox-edit.e2e-docker.test.ts`
- a follow-up sandbox edit verification repair that now compares the mounted
  file contents against the exact expected post-edit text instead of requiring
  `oldText` to disappear as a raw substring
- a targeted sandbox edit recovery regression that proves exact replacements
  still verify successfully when the inserted block embeds the old block as a
  prefix

The last local blockers found while preparing the live replay are now closed:

- `scripts/openclawcode-webhook-tunnel.sh sync-hook` keeps the subscribed
  GitHub event set aligned with the plugin's required lifecycle events:
  - `issues`
  - `pull_request`
  - `pull_request_review`
- local reconciliation can recover a tracked pull request number and URL from
  older run artifacts when the newest rerun record missed that metadata

The sync-branch live rerun gap is now closed:

- `PR #47` was retargeted to `sync/upstream-2026-03-12` and collapsed back to
  the expected one-file README diff
- run `zhyongrui-openclawcode-36-1773282645164` reached
  `ready-for-human-review` with deterministic sandbox `edit` succeeding end to
  end under `OPENCLAWCODE_ENABLE_FS_TOOLS=edit`
- run `zhyongrui-openclawcode-36-1773282908481` reached
  `ready-for-human-review` again after `edit` was re-enabled by default in
  `OpenClawAgentRunner`
- run `zhyongrui-openclawcode-36-1773283954561` then reached
  `ready-for-human-review` after sandbox `read` learned to page in-boundary
  directories instead of treating them as invalid file reads
- run `zhyongrui-openclawcode-36-1773284400697` then reached
  `ready-for-human-review` after issue-context prompt hints were tightened to
  name `docs/openclawcode/openclaw-plugin-integration.md`
- the live builder no longer emits the earlier
  `/workspace/docs/openclawcode` boundary-check warning and no longer spends a
  first read on the nonexistent `docs/openclawcode/plugin-integration.md`
- a new docker-gated write regression now proves `createSandboxedWriteTool(...)`
  can create and surface mounted files correctly through the linked-worktree
  mount shape used by live runs
- run `zhyongrui-openclawcode-36-1773284933205` then reached
  `ready-for-human-review` with `OPENCLAWCODE_ENABLE_FS_TOOLS=write`, and the
  live builder tool list exposed `write` again without destabilizing the run
- builder prompts now explicitly forbid sandbox package-manager or formatter
  commands and push that validation responsibility back to the workflow host
- run `zhyongrui-openclawcode-36-1773285317777` then reached
  `ready-for-human-review` with `OPENCLAWCODE_ENABLE_FS_TOOLS=write`, and the
  builder summary explicitly recorded that it avoided sandbox package-manager,
  formatter, and full-test commands

This means the next iteration can shift from expanded fs-tool rollout proof to
fresh-environment setup proof, validation-pool upkeep, and broader operator
hardening.

### Near-Term Delivery Streams

The next iteration should run across five delivery streams in parallel.

#### Stream 0: Baseline Promotion and Branch Discipline

Objective:

- keep the code validated on the same branch that the live runner actually
  executes

Priority backlog:

1. finish the remaining sync-branch fixes that were discovered by live rerun
   validation
2. promote validated slices from `sync/upstream-2026-03-11` back to `main`
   before starting the next live issue run
3. treat upstream sync and fork-only feature work as separate checkpoints
4. document when live validation should run on `main` versus an integration
   branch
5. keep `origin/main` and the local operator environment aligned after each
   validated checkpoint

Validation rule:

- no new live GitHub issue validation should start from stale `main` once the
  relevant fix has already been validated on the sync branch

#### Stream 1: GitHub Lifecycle Intake and Chat Routing

Objective:

- make issue, pull-request, and review events arrive at the right chat target
  with the right amount of operator context and without duplicate execution

Priority backlog:

1. accept `pull_request` and `pull_request_review` webhook events for tracked
   repositories
2. deduplicate repeated lifecycle deliveries without re-announcing the same
   state transition
3. bind issue, PR, and review events back to the same conversation target
4. improve chat notification copy for approval, running, review, failure, and
   final disposition
5. keep `/occode-sync` as a recovery tool instead of the primary freshness path

Validation rule:

- every lifecycle intake rule must be exercised by replayed webhook payload
  tests and at least one real issue, PR, or review event in this repository

#### Stream 2: Workflow Lifecycle and Rerun Consistency

Objective:

- make repeated runs, request-changes loops, restarts, and background
  execution behave like a durable service rather than an optimistic prototype

Priority backlog:

1. use the staged runner switch to validate sandbox-backed builder edits now
   that the mutation step is deterministic locally
2. keep corrupt-success verification, rollback coverage, and docker-gated e2e
   coverage for both host and sandbox edit wrappers, including alias-based edit
   calls and linked-worktree mounts
3. preserve rerun continuity after failed builder attempts without reopening
   file-corruption paths in reusable issue worktrees
4. harden stale worker completions and duplicate queue promotions across reruns
5. expose rerun chains in operator-visible status output
6. remove the temporary runner-level tool carveout only after a fresh live
   issue run proves the deterministic edit path on refreshed `main`

Validation rule:

- every rerun or state-healing rule must get a regression test that proves the
  latest known good state cannot be clobbered by stale data or silent
  worktree corruption

#### Stream 3: Operator Visibility and Notification Delivery

Objective:

- let chat operators understand what changed without reading raw state files or
  manually polling each issue

Priority backlog:

1. expand `/occode-inbox` into a compact operator ledger for recent activity
2. surface recent external GitHub events and final disposition in chat-visible
   status output
3. record notification timing and delivery failures in a compact operator view
4. expose enough metadata to explain ignored or deduplicated webhook events
5. keep notification routing anchored to repo bindings instead of ad-hoc local
   state knowledge

Validation rule:

- operators should be able to answer "what happened?" from chat output and the
  compact ledger without reading raw JSON artifacts

#### Stream 4: Packaging, Install, and Policy Alignment

Objective:

- make `openclawcode` installable and operable as a product, with docs that
  match the guarded behavior already in the code

Priority backlog:

1. define the supported install path and required GitHub/OpenClaw config
2. add one-command or low-friction setup documentation for repo mapping,
   webhook secret, chat binding, and webhook tunnel startup
3. add a setup verification checklist that proves the route, secret, and chat
   target are all correct
4. align `README.md`, this plan, and policy docs around guarded auto-merge and
   human checkpoints
5. document a repeatable upgrade, rollback, and upstream-sync workflow
6. expose setup or promotion results in a machine-readable form for automation

Validation rule:

- a fresh operator should be able to configure the repository and trigger a
  full issue run using docs only

#### Stream 6: External Rollout

Objective:

- make `openclawcode` usable by another operator without relying on local chat
  scrollback or manual shell interpretation

Priority backlog:

1. expose setup-check results in a machine-readable form
2. keep promotion and rollback prerequisites explicit in the runbook
3. prove one external-style operator bring-up from docs after the next
   promotion
4. keep supported-vs-experimental surfaces explicit for other users

Validation rule:

- another operator should be able to decide whether a host is ready from docs
  plus machine-readable preflight output alone

#### Stream 5: Real Workflow Validation and Merge Confidence

Objective:

- keep proving the product on real repository traffic instead of stopping at
  unit and integration coverage

Priority backlog:

1. promote the validated suitability behavior back to the long-lived `main`
   operator baseline and re-run both the safe and high-risk live proofs there
2. keep the webhook/chat intake routing aligned with the workflow-level
   suitability gate as heuristics evolve
3. keep a small pool of low-risk validation issues ready so real failures can
   be reproduced quickly
4. if that pool is empty, create a narrowly scoped command-layer or docs
   validation issue directly through GitHub CLI/API so the next live proof does
   not stall on missing repository traffic
5. turn every live failure into either a regression test, a workflow rule, or
   an operator runbook update
6. after the promotion back to `main`, run one low-risk merged proof and one
   high-risk escalated proof through the long-lived live operator path

Validation rule:

- every materially new workflow slice must be closed by at least one real issue
  run or real lifecycle replay before the iteration is considered stable

### Recommended Issue Sequence

The next concrete issue order should be:

1. promote the suitability changes back to the long-lived `main` operator
   baseline
2. keep webhook/chat intake prechecks aligned with the workflow-level
   suitability rules as they expand
3. prove the new routing with:

- one low-risk command-layer merged issue
- one high-risk escalated issue

4. align README, this plan, and policy docs with the live-tested suitability
   model and guarded merge policy
5. only then move deeper into broader operator productization or additional
   issue-class routing

This order is deliberate:

- first switch the long-lived operator to the now-validated suitability branch
- then prove both the safe merged path and the high-risk escalated path on the
  long-lived live route
- then lock the docs to the actually validated operating model
- only after that resume broader product slices

### Execution Rules For The Next Iteration

Keep the current working pattern:

1. create one GitHub issue for one bounded slice
2. implement only the smallest change needed for that issue
3. run targeted local tests first
4. commit the feature slice
5. if the slice was developed on a sync branch, promote that validated base
   before switching the long-lived live runner to it
6. push the validated base branch used by the live runner
7. run the real `openclaw code run` workflow against that issue
8. record the result in the dev log

Additional rules:

- prefer slices that close real operational gaps over adding more output fields
- treat real issue runs as the primary acceptance test
- sync `upstream/main` only at clean checkpoints, not mid-slice
- do not leave live validation pinned to stale `main` after a fix is already
  validated on the integration branch
- keep `openclawcode` workflow logic isolated from broad upstream runtime edits
- do not trust plugin-state text alone when a structured snapshot exists;
  always reconcile toward the newest structured state
- every real failure mode found in chatops must become either:
  - a regression test
  - a reconciliation rule
  - an operator-facing recovery command

### Exit Criteria For This Iteration

This iteration is complete when:

- the live operator path is running on a refreshed `main` that includes the
  latest validated sync-branch hardening
- a new GitHub issue can notify the configured chat target automatically
- a human can approve the run from chat without touching the terminal
- the workflow can open a draft PR, survive retries, and keep state consistent
- review changes and merge outcomes are reflected back into chat-visible status
- guarded merge automation has been trialed on a real low-risk issue
- the repository can continue issue-driven development after an upstream sync
  without rework

## Guiding Principles

Development should follow these rules:

1. Keep workflow policy in `src/openclawcode/`, not scattered across generic
   upstream-derived runtime files.
2. Prefer deterministic code paths over prompt-only behavior whenever a rule can
   be enforced structurally.
3. Keep builder and verifier authority separate.
4. Add tests with every workflow capability, especially when the feature is a
   guardrail.
5. Validate each completed slice before committing.
6. Keep upstream-sync conflict surface small by favoring additive modules and
   narrow seams.
7. Optimize first for trust and bounded autonomy, not maximum automation.

## Long-Range Plan

The product should be built in the following phases.

### Phase 1: Workflow Core Stabilization

Objective:

- make the issue-to-run state machine reliable enough that later automation is
  built on firm ground

Scope:

- stabilize workflow contracts
- keep stage transitions deterministic
- enrich run persistence
- tighten run history and audit artifacts
- strengthen retry and failure semantics

Exit criteria:

- every run leaves a trustworthy persisted record
- workflow stages can be retried or resumed without guessing
- orchestration tests cover approval, change-request, escalation, and failure
  paths

### Phase 2: Issue Suitability and Classification

Objective:

- stop treating every issue as equally executable

Scope:

- add issue suitability classification before build execution
- distinguish command-layer, workflow-core, and mixed issues
- flag risky issue classes such as auth, secrets, migrations, or broad refactor
- store classification and rationale in workflow artifacts

Exit criteria:

- the workflow can reject or triage obviously unsafe issues
- the builder receives explicit task type and scope guidance
- issue class affects prompt construction and policy

### Phase 3: Scope Guardrails and Change-Boundary Enforcement

Objective:

- reduce builder drift and keep small issues small

Scope:

- map issue classes to preferred file areas
- add post-build changed-file inspection
- fail or retry when command-layer issues drift into contracts, persistence, or
  orchestrator files without justification
- surface scope findings in workflow artifacts and verifier context

Exit criteria:

- small CLI issues reliably stay within command-layer files and tests
- unrelated workflow-core edits are caught before verification
- reruns converge faster with smaller diffs

### Phase 4: Retrieval and Context Precision

Objective:

- improve the quality of builder context without falling back to repo-wide scans

Scope:

- add a context retrieval module
- rank likely relevant files from issue text and planner output
- capture nearby tests, configs, and docs
- optionally sample recent commits for the touched area
- cap context volume to prevent prompt sprawl

Exit criteria:

- builder and verifier start from focused context sets
- prompt tokens are spent on relevant files, not broad searches
- real runs show less wasted exploration

### Phase 5: Verification Hardening

Objective:

- make the verifier a real gate instead of a lightweight summary step

Scope:

- require acceptance-criteria-aware verification
- add scope-drift checks, missing-test checks, and unresolved-risk checks
- separate builder-produced notes from verifier conclusions
- expand verification decisions and structured findings

Exit criteria:

- verifier output is specific enough to drive retries
- change requests include actionable findings
- verification meaningfully improves merge confidence

### Phase 6: Run Persistence, Resume, and Operator Visibility

Objective:

- make long-running and repeated workflows manageable

Scope:

- persist richer run records and stage artifacts
- attach planner, builder, verifier prompt artifacts
- track retries, resumable stages, and operator notes
- expose summary views for recent runs and their outcomes

Exit criteria:

- an interrupted run can be inspected and resumed intentionally
- operators can answer what happened without reading raw transcripts
- runtime artifacts are useful rather than noisy

### Phase 7: PR Delivery and Human Checkpoints

Objective:

- make the output usable in day-to-day repository work

Scope:

- improve PR title and body generation
- attach acceptance checklist, tests run, and verifier summary
- define explicit human checkpoint rules
- support request-changes loops cleanly

Exit criteria:

- draft PRs are readable and reviewable without extra manual reconstruction
- humans know when and why intervention is required
- request-changes reruns preserve continuity

### Phase 8: Background Execution and Queueing

Objective:

- move from ad hoc CLI invocation to repeatable workflow operation

Scope:

- add queued workflow requests
- add background worker or service loop
- support issue-trigger ingestion later
- keep CLI as an operator control plane

Exit criteria:

- workflows can be enqueued and processed without manual terminal babysitting
- queue state and run state remain consistent
- failures do not silently disappear

### Phase 9: GitHub Event Integration

Objective:

- reduce manual triggering while keeping control

Scope:

- label-based issue intake
- comment-based commands
- PR status updates
- eventual webhook-driven automation

Exit criteria:

- GitHub can trigger bounded workflows safely
- issue and PR state stay synchronized with local workflow state
- automation remains auditable and opt-in

### Phase 10: Safe Merge Automation

Objective:

- only after trust is earned, allow limited automatic merge behavior

Scope:

- define merge policy thresholds
- require clean verification and passing checks
- restrict auto-merge to low-risk issue classes
- leave high-risk and ambiguous issues human-gated

Exit criteria:

- auto-merge is policy-driven, not prompt-driven
- failed assumptions are visible before merge
- humans can disable or override merge automation easily

## Near-Term Execution Backlog

This is the concrete backlog that should be worked next, in order.

### Slice A: PR and Review Webhook Intake

Status:

- implemented on 2026-03-11

Deliverables:

- accept `pull_request` and `pull_request_review` webhook payloads for tracked
  repositories
- normalize delivery identity for non-issue lifecycle events
- persist enough event metadata to explain why a lifecycle event was accepted,
  ignored, or deduplicated
- regression coverage for duplicate lifecycle deliveries
- real validation with a PR or review event against this repository

Why this first:

- issue intake is already good enough to drive work
- the biggest remaining freshness gap is that review and merge outcomes still
  rely mainly on operator-triggered syncs

### Slice B: Event-Driven Snapshot Updates and Notifications

Status:

- implemented on 2026-03-11

Deliverables:

- update tracked issue snapshots immediately from PR and review webhook events
- send chat notifications for approved, changes-requested, merged, and
  closed-without-merge outcomes
- record final disposition consistently in snapshot state and status output
- regression coverage for event-driven state transitions and duplicate
  notifications

Why next:

- webhook intake alone is not enough unless it changes operator-visible state
- this is the slice that turns lifecycle sync from a repair tool into a normal
  operating path

### Slice C: Request-Changes Rerun Control

Status:

- implemented on 2026-03-11

Deliverables:

- add an explicit rerun command or equivalent operator control path
- preserve issue, branch, and PR continuity when rerunning intentionally
- store the follow-up reason and latest review findings in run artifacts
- regression coverage for safe rerun semantics and stale completion handling

Why next:

- request-changes is the core loop that turns this from one-shot automation
  into a usable coding assistant

### Slice D: Operator Ledger and Final Disposition Visibility

Status:

- implemented on 2026-03-11

Deliverables:

- expand `/occode-inbox` into a compact ledger for recent activity
- surface final disposition, recent external events, and rerun chains
- record last notification timing and failed delivery attempts in operator
  status output
- regression coverage for ledger formatting and status consistency

Why next:

- the user-facing promise is not just "the state healed eventually"
- operators need a compact answer to "what changed and what should I do now?"

### Slice E: Operator Install and Setup Hardening

Status:

- implemented on 2026-03-11

Deliverables:

- document the supported install path as a first-class workflow
- document repo binding, webhook setup, chat target setup, and required tokens
- document the local gateway and temporary tunnel startup path explicitly
- reduce manual state-file editing in favor of documented commands or config
- add a setup verification checklist

Why next:

- once the loop works, setup friction becomes the next blocker to real use

### Slice F: Full-Loop Real Validation

Deliverables:

- choose one low-risk issue in this repository
- validate the issue -> review -> rerun -> merge path end-to-end with the
  current token policy
- document the exact required GitHub permissions and failure handling
- keep the merge policy narrow and reversible

Why next:

- the full loop is the real product promise
- it should only be exercised once lifecycle intake, rerun semantics, and
  notifications are already coherent

## Detailed Plan for the Immediate Next Slice

The next implementation slice should follow this order:

1. use the green `./scripts/openclawcode-setup-check.sh --strict` result as the
   live preflight gate on the refreshed branch
2. use `./scripts/openclawcode-setup-check.sh --strict --probe-built-startup`
   as the built-startup promotion gate on the same branch so the repaired
   bundled-plugin startup path stays machine-verifiable
3. keep direct rerun proof issue `#87` as the standing refreshed-branch probe
   until the post-trim failure signal is no longer just provider
   `HTTP 400`
4. keep the persisted compact provider/model/system-prompt diagnostics in the
   failed workflow note as the default way to interpret live failures; a direct
   refreshed-branch proof has already confirmed they surface on issue `#87`
   without raw stdout inspection
5. add an explicit issue-worktree fallback override path so refreshed-branch
   live proofs can try a bounded fallback chain without rewriting the shared
   operator config by hand
6. use setup-check's model-inventory output to confirm whether the target host
   actually exposes a discoverable fallback candidate before rerunning `#87`
7. rerun `#87` again after each provider-resilience slice and record the new
   live signal rather than guessing
8. if that rerun still fails with the same compact diagnostic line even after a
   configured fallback chain, switch the next slice from prompt trimming to
   deeper provider/model diagnostics
9. promote only after the refreshed branch can pass both strict setup checks
   and a real low-risk live proof on the target runtime
10. after promotion, rerun the same strict check and one chat-visible proof on
    `main`
11. keep docs/operator issue `#60` open as the standing docs-side proof target
    only until the copied-root teardown guidance is judged complete
12. keep setup-check output machine-readable so rollout can plug into CI or
    other operator automation, and use the same release path to drive external
    operator rollout later
13. keep `run-json-contract.md` aligned with `contractVersion` so external
    automation has one explicit reference point instead of scraping dev logs
14. keep setup-check readiness opinionated enough to tell future sessions
    whether the next action is "repair the built startup path" or "restart the
    live gateway" when isolated startup and live route health diverge

## Test Strategy

Testing should be layered.

### 1. Unit Tests

Purpose:

- validate pure policy logic quickly

Targets:

- issue classification
- file-scope matching
- blocked-file detection
- PR body generation helpers
- run-state transitions

Expected cadence:

- run on every feature slice

### 2. Component Tests

Purpose:

- validate behavior at a module boundary with fakes

Targets:

- `AgentBackedBuilder`
- `AgentBackedVerifier`
- worktree manager
- filesystem run store
- GitHub app workflow runner

Expected cadence:

- run on every workflow feature slice

### 3. Workflow Integration Tests

Purpose:

- ensure the issue-to-run pipeline still behaves coherently

Targets:

- publish + approve flow
- request-changes flow
- rerun / worktree reuse flow
- merge-on-approve policy path

Expected cadence:

- run before each commit that changes orchestration or policy

### 4. Real-Run Validation

Purpose:

- catch failures that mocks cannot reveal

Targets:

- real `openclaw code run --issue ...` execution against this repository
- real plugin-route execution when a slice changes webhook or chatops behavior
- prompt targeting quality
- sandbox and worktree behavior
- changed-file output
- run artifact correctness
- plugin-state and chat-status reconciliation

Expected cadence:

- after each meaningful runtime/prompt/policy change
- not necessarily after every tiny refactor

### 5. Regression Tracking

Purpose:

- convert every discovered failure mode into a durable test or guardrail

Known regression classes to keep covering:

- sandbox path mismatch
- worktree reuse failures
- builder hanging on full test commands inside sandbox
- command-layer issues drifting into workflow-core files
- JSON output shape regressions
- stale worker writes clobbering newer persisted status
- duplicate webhook deliveries creating duplicate queued work
- GitHub review/merge state drifting away from local plugin snapshots

## Test Commands

The default validation path for current `openclawcode` work should remain
targeted:

- `pnpm exec vitest run --config vitest.openclawcode.config.mjs`
- focused single-file tests for modules under active change
- real `openclaw code run ... --json` reruns for workflow validation
- local plugin-route replay when the slice changes chatops or webhook behavior

Whole-repo validation should be postponed unless a slice clearly touches shared
OpenClaw surfaces beyond `openclawcode`.

## Commit and Documentation Policy

Each completed slice should follow this order:

1. implement code
2. add or update tests
3. run targeted validation
4. update the current day's `docs/openclawcode/dev-log/YYYY-MM-DD.md`
5. if the work depends on validation from a previous day, append the relevant
   cross-day note there too
6. commit with one clear message for one coherent slice

Commits should stay narrow. A guardrail feature, a persistence feature, and a
PR-draft feature should not be collapsed into one commit unless they are
technically inseparable.

## Operational Notes for Overnight Autonomous Work

While continuing work without immediate human feedback, prefer this order:

1. finish a narrow slice completely
2. test it
3. commit it
4. update the dev log
5. move to the next slice only if the current one is stable

If a slice depends on an unclear product decision, stop at a stable boundary,
document the question, and continue on adjacent work that does not require that
decision.

## Definition of “Usable for Daily Development”

`openclawcode` will be ready for regular issue-driven use in this repository
when all of the following are true:

- it can reject unsuitable issues
- it can ingest a new issue event and notify chat automatically
- it can let a human approve from chat
- it can complete a narrow accepted issue in an isolated worktree
- it can run targeted tests and record them
- it can open a readable draft PR
- it can run an independent verification pass
- it can preserve run history and operator-visible artifacts
- it can survive reruns without manual cleanup
- it can ingest or recover review and merge outcomes back into its own state
- it can notify humans of final outcomes without terminal intervention or
  manual polling
- it keeps small issues scoped to small diffs

Until then, the right approach is controlled real-world testing against this
repository, with each discovered failure converted into code, tests, and notes.

## Timeout Guardrails

The refreshed-branch live proof on issue `#85` exposed a failure mode distinct
from the earlier provider `HTTP 400` responses:

- the run could stall in `building`
- the saved artifact stopped at `Build started`
- no bounded failed artifact appeared until the outer proof wrapper timed out

That gap is now explicitly closed:

- issue-worktree builder runs default to `300` seconds
- issue-worktree verifier runs default to `180` seconds
- operator overrides now exist:
  - `OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS`
  - `OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS`
- generic non-provider workflow failures now persist
  `failureDiagnostics.summary`, so timeout-style failures remain visible in the
  stable JSON contract and operator surfaces

## Promoted Main Baseline

`sync/upstream-2026-03-13` cleared its low-risk proof gate and has now been
promoted back to `main`:

- real proof issue:
  - `#85`
- real proof run:
  - `zhyongrui-openclawcode-85-1773416913744`
- real proof PR:
  - `#88`
- real outcome:
  - merged automatically against `sync/upstream-2026-03-13`

That promotion also exposed the next real `main`-specific tasks:

- keep the built gateway startup path healthy again on `127.0.0.1:18789`
- re-prove the long-lived chat-visible operator after the gateway restart path
  is repaired
- keep the new no-op completion path as a first-class live proof, not just a
  unit-tested branch

## No-Op Completion Proof On `main`

The first direct proof on promoted `main` found a product gap that is now
closed in code.

- proof issue:
  - `#44`
- direct proof run:
  - `zhyongrui-openclawcode-44-1773418941601`
- final stage:
  - `completed-without-changes`
- final effect:
  - verification approved the no-op result
  - no PR was opened because no new commits were produced against `main`
  - issue `#44` closed automatically at `2026-03-13T16:28:24Z`

The workflow now treats that "no commits between base and issue branch" result
as a first-class terminal state instead of leaving the run at
`ready-for-human-review`.

## Repo-Local Gateway Direct Proof On `main`

The repo-local built gateway path is now re-proved on promoted `main`.

- direct built command:
  - `/home/zyr/.local/node-v22.16.0/bin/node dist/index.js gateway run --bind loopback --port 18789 --allow-unconfigured --verbose`
- direct no-lazy command:
  - `OPENCLAW_DISABLE_LAZY_SUBCOMMANDS=1 /home/zyr/.local/node-v22.16.0/bin/node dist/index.js gateway run --bind loopback --port 18789 --allow-unconfigured --verbose`
- real result:
  - both entry paths now bind `ws://127.0.0.1:18789`
  - the first startup on this host may spend about five seconds printing
    `Control UI assets missing; building ...` before the listener appears
  - the direct `dist/index.js` entry now delegates to `runCli`, so its command
    registration behavior matches the primary wrapper path instead of drifting
    behind it
  - eager subcommand registration behind
    `OPENCLAW_DISABLE_LAZY_SUBCOMMANDS=1` is now awaitable, which removes both
    the earlier `unknown command 'gateway'` failure and the later duplicate
    registration error

That moves the next `main`-specific work back to product behavior:

- restart and re-prove the long-lived chat-visible Feishu operator on the
  repaired `main` build
- continue provider fallback or diagnostics work without carrying a local CLI
  startup caveat in parallel

One follow-up infrastructure hardening slice is now also complete:

- `scripts/openclawcode-setup-check.sh` now accepts
  `OPENCLAWCODE_SETUP_NODE_BIN=/path/to/node>=22.16.0`
- the setup check now bounds direct CLI probes such as `models list --json`
  instead of letting them hang indefinitely
- if the selected Node runtime is already below the CLI startup floor, the
  setup check now reports that failure and skips model-inventory probing
  entirely

The remaining live-ops startup gap is therefore narrower:

- minimal direct built-entry proofs on `main` are healthy
- the long-lived repo-local operator can still stall before binding when the
  real `~/.openclaw` environment is sourced, so the next startup slice should
  debug that real-config path rather than the generic built entrypoint
- targeted config isolation now points at the plugin layer specifically:
  - disabling `openclawcode` while keeping the rest of the real
    `~/.openclaw` config allows the gateway to bind and Feishu to reach
    WebSocket readiness
  - disabling `feishu` while leaving `openclawcode` enabled stalls before the
    listener and before normal gateway startup logs appear
- the next code slice should therefore inspect `openclawcode` plugin startup
  under a missing or delayed live chat surface instead of treating this as a
  generic gateway bootstrap problem
