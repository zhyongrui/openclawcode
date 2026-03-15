# OpenClawCode Full Program Roadmap

This is the long-horizon backlog for `openclawcode`.

For the checkbox-based master execution list that tracks completed versus open
work at a finer granularity, see `master-delivery-checklist.md`.

Use it to answer three questions quickly:

1. what the finished product should do
2. what major work remains
3. what the next slice should be after the current one lands

## North Star

`openclawcode` should become a repo-bound coding operator that can:

1. accept work from GitHub issues and chat-native requests
2. decide whether the work is suitable for autonomous execution
3. prepare an isolated worktree and branch
4. implement the change
5. run bounded validation
6. publish a PR
7. react to review, rerun, merge, and close events
8. keep humans informed from the bound chat surface

## Final User Story

The finished product should support this loop without ad hoc operator repair:

1. a teammate sends a chat-native request in Feishu
2. the operator turns that request into a scoped GitHub issue draft
3. the operator asks for clarification or blocks the request if it is risky
4. once approved, the operator implements the change in an isolated worktree
5. the operator runs bounded tests and verification
6. the operator opens a PR, reacts to review, reruns when needed, and merges
   only when policy allows
7. the bound chat thread stays current with queue state, failures, reruns,
   PR lifecycle, and final outcome

## Program Completion Checklist

The program is not done until all of these are true:

1. chat-native intake can preview, edit, and create scoped issues safely
2. low-risk issues can run from chat or GitHub issue intake without manual file
   repair or state surgery
3. provider failures are visible both while a pause is active and after the
   pause clears
4. rerun, review, and merge flows are first-class in chat surfaces
5. operator install, promotion, rollback, and copied-root proofs are routine
6. the JSON contract is documented and intentionally versioned
7. the refreshed upstream branch can be promoted back to `main` with a live
   proof and a rollback path
8. the long-lived `main` operator baseline can be trusted as the real demo path
9. provider or model instability is diagnosable from persisted workflow
   artifacts instead of only raw CLI stderr
10. onboarding and preflight checks are machine-readable enough to plug into CI
    or external operator rollout automation
11. operators can inject a bounded model fallback chain for live proofs without
    rewriting the shared agent config by hand
12. public-facing docs explain how a fresh host gets from zero to a first live
    proof and how to roll back when promotion fails

## Launch Readiness Ladder

The backlog should end in a public-use path, not only more slices.

1. refreshed branch is green in tests and can pass one low-risk live proof
2. refreshed branch is promoted back to `main` with rollback notes recorded
3. long-lived `main` re-proves one merged low-risk path and one blocked or
   escalated path
4. copied-root setup, strict health checks, and promotion gates all work from
   docs and machine-readable output
5. chat-native intake supports a bounded confirmation path for ambiguous
   requests
6. policy and merge rules are documented as stable operator behavior
7. a fresh external-style operator host can stand up the system from docs and
   complete one low-risk proof
8. release-facing docs spell out prerequisites, supported scope, known limits,
   upgrade steps, and rollback steps

## Final Delivery Program

The remaining work should be consumed in this order:

1. refreshed-branch readiness
   - finish provider-resilience and machine-readable failure surfaces on
     `sync/upstream-2026-03-14`
   - prove one low-risk merged run there again
2. promotion readiness
   - promote the refreshed branch back to `main`
   - record rollback notes and restart the long-lived operator on the promoted
     build
3. long-lived operator re-proof
   - prove one merged low-risk path and one blocked or escalated path on
     `main`
4. chat-native operator completion
   - let Feishu users draft, confirm, and launch work without manually
     formatting GitHub issues
5. external automation surfaces
   - keep `openclaw code run --json`, setup-check JSON, and validation-pool
     inventory stable enough for other AI sessions, CI, and operator tooling
   - keep those surfaces opinionated enough to say what the next rollout or
     proof action should be, not just dump raw counters
   - keep validation-pool inventory able to distinguish `implemented`,
     `pending`, and `manual-review` issues so stale low-risk proofs do not
     masquerade as active backlog
   - specifically, keep setup-check able to distinguish "built startup proof
     passed" from "live gateway is still down" so promotion automation does
     not misclassify a route restart as a startup regression
6. fresh-host reproducibility
   - stand up the operator from docs on a clean root or host
   - pass strict checks
   - complete one low-risk merged proof
7. release packaging
   - finish support matrix, policy docs, rollout notes, and rollback notes for
     other teams

## Ordered Endgame Backlog

This is the ordered queue from the current state to the intended finished
product. Each item should be consumed as one or more narrow slices.

1. finish refreshed-branch provider resilience
   - keep issue-worktree builder and verifier runs inside the real prompt
     budget of the current model
   - persist provider/model prompt diagnostics into workflow failure notes so
     `/occode-status`, `/occode-inbox`, and saved run artifacts expose the
     same failure signal without raw log digging
   - rerun or replace issue `#87` until a refreshed-branch low-risk proof can
     merge again
   - if raw prompt trimming stops moving the live failure, shift to provider or
     model fallback behavior instead of continuing local prompt surgery
   - keep recording the exact remaining live failure signal after each repair
2. promote the refreshed branch back to `main`
   - require a green strict setup check, one real low-risk live proof, and a
     rollback note before promotion
   - restart the long-lived Feishu operator on the promoted build
3. re-prove the long-lived `main` baseline
   - run one more merged low-risk chat-visible proof
   - run one more high-risk or clarification-path proof
4. deepen chat-native intake
   - preview and edit generated issues before creation
   - support clarification loops for ambiguous requests
   - keep one-line intake as the fast path for low-risk requests
5. add operator-grade policy override flows
   - explicit override path for suitability or merge-policy exceptions
   - clearer auto-merge eligibility explanations in chat surfaces
6. finish and document the stable JSON contract
   - complete the remaining useful top-level convenience fields
   - document the supported contract as intentional API surface
7. keep install, promotion, rollback, and copied-root proofs routine
   - update the runbook whenever a new live proof changes the real steps
   - expose setup and promotion gates in a machine-readable form so other
     operators and CI jobs can consume them
8. keep upstream drift bounded
   - continue regular sync branches before conflict hotspots grow expensive
   - record conflict hotspots and promotion decisions in docs and dev logs
9. package the external operator release path
   - publish a support matrix for supported repo profile, chat path, and
     experimental surfaces
   - capture promotion, rollback, and first-proof expectations in release docs
10. prove a fresh external-style host

- stand up `openclawcode` from docs on a new operator root or fresh host
- pass strict checks and complete one low-risk live proof without ad hoc
  repair

## Current Operating Baseline

As of 2026-03-14:

- active feature branch:
  - `main`
- long-lived live operator baseline:
  - `main`
- long-lived local operator root:
  - `~/.openclaw`
- long-lived chat surface:
  - one real Feishu conversation bound to `zhyongrui/openclawcode`
- current runtime constraint:
  - refreshed branches now expect Node `>=22.16.0` for CLI startup
  - the operator host now satisfies that floor with local Node `22.16.0`
- current live-proof note:
  - issue `#85` showed that "queued but not running yet" can be a provider
    pause or service-start visibility problem rather than queue corruption
  - the refreshed branch now kicks the queue consumer immediately when the
    runner service is already active and surfaces active provider-pause details
    directly in auto-queued intake messages
  - issue `#86` then exposed a second live-proof gap: seeded low-risk
    validation issues needed a marker-aware scope short-circuit so
    `operator-doc-note` issues do not drift into `workflow-core` solely because
    their prose references queue or runtime behavior
- issue `#87` confirmed that the marker-aware scope fix works in a real
  refreshed-branch run artifact; the remaining blocker on that proof is now
  provider `HTTP 400` failure during build rather than suitability drift
- operator surfaces on the refreshed branch now preserve recent provider
  failure history per issue, so `/occode-status` and `/occode-inbox` can still
  explain a failed run after the active global provider pause has already
  cleared
- those same surfaces now distinguish:
  - active pause
  - pause cleared after <timestamp>
  - last transient failure timestamp
    so operators no longer have to infer whether pause state disappeared because
    the system recovered or because status reconciliation dropped context
- refreshed-branch operator surfaces now also preserve structured
  `failureDiagnostics` inside status snapshots, so `/occode-status` and
  `/occode-inbox` can show provider/model prompt telemetry after the active
  pause has already cleared
- direct reruns of refreshed-branch issue `#87` now prove that the lightweight
  bootstrap context fix is active:
  - the oversized `AGENTS.md` truncation warning is gone
  - `systemPromptReport.bootstrapTruncation.warningShown = false`
  - `systemPromptReport.injectedWorkspaceFiles = []`
  - the remaining blocker after that fix is still provider
    `HTTP 400: Internal server error` during build
- a follow-up rerun on that same issue now proves the next prompt-budget slice
  is active too:
  - issue-worktree runs now keep only the four core coding tools:
    `read`, `edit`, `exec`, `process`
  - issue-worktree runs now upsert a temporary agent entry when the live config
    only has `agents.defaults`, so the coding-only skill filter still applies
  - live `systemPromptReport.systemPrompt.chars` dropped again, from `12366` to
    `8629`
  - live `systemPromptReport.skills.promptChars` dropped from `4982` to `1245`
  - the remaining blocker is still provider `HTTP 400`, which now points more
    strongly at provider or model behavior than local prompt inflation
- the next provider-resilience slice is now defined more narrowly:
  - provider/model prompt diagnostics must persist into workflow failure notes
    and chat-visible status snapshots
  - a direct refreshed-branch proof has now confirmed those diagnostics are
    visible in the persisted failed note without opening raw builder stdout
  - the current live operator config still has no configured fallback chain, so
    the next repair should move to provider or model fallback behavior instead
    of more prompt-budget trimming
  - a fresh inventory check on the long-lived operator currently exposes only
    one discoverable model:
    - `crs/gpt-5.4`
    - fallback override support is now ready in code, but a real live fallback
      proof still needs another discoverable model on that host
- a new sync branch, `sync/upstream-2026-03-14`, now cleanly merges
  `upstream/main` through `c08317203d` and still passes:
  - `pnpm exec vitest run src/agents/sandbox/fs-bridge.shell.test.ts src/infra/safe-open-sync.test.ts --pool threads`
  - `pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads --maxWorkers 1`
  - `pnpm build`
  - `./scripts/openclawcode-setup-check.sh --strict --json`
- that sync did surface one operational field note worth keeping:
  - immediately after the merge, the local install was stale enough to report:
    - missing `@modelcontextprotocol/sdk`
    - `Command "tsdown" not found`
    - `Command "vitest" not found`
  - the required recovery step was:
    - `pnpm install --frozen-lockfile`
  - future sync branches should do that install pass before treating missing
    package or missing bin failures as source regressions
- the refreshed branch is now locally promotion-ready in setup-check terms:
  - `readiness.lowRiskProofReady = true`
  - `readiness.promotionReady = true`
  - `readiness.nextAction = "ready-for-low-risk-proof"`
- that branch has now also passed the next real low-risk merged proof:
  - issue `#87`
  - run `zhyongrui-openclawcode-87-1773494823680`
  - `PR #95`
  - merged automatically against `sync/upstream-2026-03-14`
- live policy field note from that proof:
  - the verifier still recorded one `missingCoverage` item because the docs
    run had no explicit repo checks
  - current policy nonetheless allowed auto-merge because there were no
    findings and the issue remained policy-eligible
- the next ordered step is now to promote `sync/upstream-2026-03-14` back to
  `main` and then re-prove the long-lived operator there
- that promotion is now complete:
  - `main` now points at `362374a0d0`
  - the next ordered step is the long-lived operator re-proof on promoted
    `main`
- `main` now carries the built bundled startup repair for `openclawcode`:
  - the build emits `dist/extensions/openclawcode/index.js`
  - bundled manifest files are copied into `dist/extensions/*`
  - bundled discovery now prefers `<packageRoot>/extensions` so partial
    `dist/extensions` output does not shadow the full bundled plugin tree
  - built runtime now selectively redirects bundled `openclawcode` to the
    compiled dist entry
- a real built `dist/index.js gateway run` proof is now complete on `main`
  with a sanitized allowlisted config:
  - `plugins.allow = ["openclawcode"]`
  - `plugins.slots.memory = "none"`
  - listener reached `ws://127.0.0.1:18890`
- that built-startup proof is now repeatable through
  `./scripts/openclawcode-setup-check.sh --strict --probe-built-startup --json`,
  so promotion no longer depends on replaying the proof by hand
- validation-pool reconciliation is now repo-native too:
  - `openclaw code reconcile-validation-issues --close-implemented --json`
    can close stale command-layer validation issues whose fields already exist
    in command output, tests, and `run-json-contract.md`
  - a real proof on `main` closed stale command-layer issues `#74` through
    `#82`, then later auto-closed `#89` after `failureDiagnosticToolCount`
    landed
  - the same reconcile path has now also auto-closed `#91` after
    `failureDiagnosticUsageTotal` landed
  - the same reconcile path has now also auto-closed `#93` after
    `failureDiagnosticSystemPromptChars` landed
  - the same reconcile path has now also auto-closed `#96` after
    `failureDiagnosticSkillsPromptChars` landed
  - the same reconcile path has now also auto-closed `#97` after
    `failureDiagnosticToolSchemaChars` landed
  - the same reconcile path has now also auto-closed `#98` after
    `failureDiagnosticSkillCount` landed
  - the same reconcile path has now also auto-closed `#99` after
    `failureDiagnosticInjectedWorkspaceFileCount` landed
  - the same reconcile path has now also auto-closed `#100` after
    `failureDiagnosticBootstrapWarningShown` landed
  - validation tooling now also supports `command-json-string`, so the next
    command-layer proof no longer has to be forced into number/boolean shape
  - the same reconcile path has now also auto-closed `#101` after
    `failureDiagnosticProvider` landed
  - the same reconcile path has now also auto-closed `#102` after
    `failureDiagnosticModel` landed
  - the same reconcile path has now also auto-closed `#103` after
    `draftPullRequestTitle` landed
  - the same reconcile path has now also auto-closed `#104` after
    `draftPullRequestOpenedAt` landed
  - the same reconcile path has now also auto-closed `#105` after
    `draftPullRequestBody` landed
  - the same reconcile path has now also auto-closed `#106` after
    `issueTitle` landed
  - the same reconcile path has now also auto-closed `#107` after
    `issueRepo` landed
  - the same reconcile path has now also auto-closed `#108` after
    `issueOwner` landed
  - the same reconcile path has now also auto-closed `#109` after
    `workspaceBaseBranch` landed
  - the same reconcile path has now also auto-closed `#110` after
    `workspaceBranchName` landed
  - the same reconcile path has now also auto-closed `#111` after
    `workspaceRepoRoot` landed
  - the same reconcile path has now also auto-closed `#112` after
    `workspacePreparedAt` landed
  - the same reconcile path has now also auto-closed `#113` after
    `workspaceWorktreePath` landed
  - the same reconcile path has now also auto-closed `#114` after
    `runCreatedAt` landed
  - the same reconcile path has now also auto-closed `#115` after
    `runUpdatedAt` landed
  - the same reconcile path has now also auto-closed `#116` after
    `issueNumber` landed
  - the same reconcile path has now also auto-closed `#117` after
    `issueUrl` landed
  - the same reconcile path has now also auto-closed `#118` after
    `issueLabelCount` landed
  - the same reconcile path has now also auto-closed `#119` after
    `issueHasLabels` landed
  - the same reconcile path has now also auto-closed `#120` after
    `publishedPullRequestUrl` landed
  - the same reconcile path has now also auto-closed `#121` after
    `publishedPullRequestBaseBranch` landed
  - the same reconcile path has now also auto-closed `#122` after
    `publishedPullRequestBranchName` landed
  - current open validation pool is now narrower and more honest:
    - docs/operator issues `#60`, `#86`
    - command-layer issue `#123` for `publishedPullRequestTitle`
- the remaining startup blocker is now narrower than "openclawcode plugin
  startup":
  - the built openclawcode-only path is healthy
  - any remaining full-config stall should be debugged as another live-config
    startup component instead of the bundled loader path itself

## Execution Loop

Every slice should follow this order:

1. pick one narrow task
2. implement it on the active sync branch
3. add or update tests
4. run focused validation
5. update docs and dev log
6. commit and push
7. seed the next low-risk validation issue if the pool would otherwise shrink
8. only promote back to `main` after a real operator proof

## Program Phases

### Phase 1: Stable Core Loop

Exit criteria:

- GitHub issue intake, isolated execution, verification, PR publication, merge,
  and tracked status snapshots all work on a real repository

State:

- substantially complete

### Phase 2: Operator Surfaces

Exit criteria:

- chat operators can bind repos, inspect queue state, start work, rerun failed
  work, and understand lifecycle changes without reading raw state files

State:

- substantially complete, but still improving around provider pauses, rerun
  clarity, and validation-pool visibility

### Phase 3: Fresh Install And Upgrade Discipline

Exit criteria:

- a new operator root can be brought up from docs and scripts alone
- strict health checks gate promotion and rollback decisions

State:

- in progress

### Phase 4: Chat-Native Intake

Exit criteria:

- operators can draft work from chat with minimal friction
- low-risk requests can turn into GitHub issues and queue cleanly
- ambiguous or risky requests stay on the clarification or escalation path

State:

- in progress

### Phase 5: Policy And Safety

Exit criteria:

- suitability, risk, and merge policy are explicit, visible, and overrideable
- high-risk work is blocked before branch mutation

State:

- in progress

### Phase 6: Provider Resilience

Exit criteria:

- provider failures degrade predictably
- queue pauses are visible and explainable
- retries stay bounded and do not hide broken runs

State:

- in progress

### Phase 7: Contract And Tooling Surface

Exit criteria:

- `openclaw code run --json` has a documented stable top-level contract
- validation-pool tooling can seed, list, consume, and replenish low-risk
  proof issues repeatably

State:

- in progress

### Phase 8: Promotion And Upstream Sync Discipline

Exit criteria:

- refreshed sync branches can be proven, promoted, and rolled back repeatably
- upstream drift is kept bounded by regular sync branches and recorded conflict
  hotspots

State:

- in progress

### Phase 9: External Rollout And Public Use

Exit criteria:

- another operator can stand up `openclawcode` without chat-scroll tribal
  knowledge
- setup, promotion, and rollback checks can run from docs and automation
- release-facing docs explain what is stable, what is experimental, and what
  proof is required before promotion

State:

- in progress

### Phase 10: Release Packaging And Operator Docs

Exit criteria:

- release-facing docs describe supported setup, upgrade, rollback, and proof
  requirements end-to-end
- the supported public operator path does not depend on unpublished local
  context

State:

- not started

### Phase 11: Multi-Host Proof And Public Beta

Exit criteria:

- at least one fresh external-style operator host can pass setup checks and a
  first low-risk live proof from docs alone
- promotion gates and rollback instructions are proven on that host too

State:

- not started

### Phase 12: General Availability Discipline

Exit criteria:

- `main` is the documented supported baseline
- sync/promote/rollback cadence is routine
- release notes and known limits are maintained as part of each promotion

State:

- not started

## Work Tracks

### Track 1: Command JSON Contract

Goal:

- make `openclaw code run --json` stable enough that downstream tooling can
  rely on top-level fields instead of unpacking nested workflow data

Remaining work:

- finish any remaining non-duplicative JSON convenience fields
- keep `contractVersion` and the contract reference doc in sync as the surface
  grows

Immediate queue:

- refreshed-branch live proof on the upgraded operator host
- promotion back to `main` once that proof holds
- follow with a `main`-baseline chat-visible proof

### Track 2: Chat-Native Intake

Goal:

- move from explicit slash-command issue drafting toward natural chat requests

Remaining work:

- preview generated issues before creation
- support clarification loops for ambiguous requests
- keep high-risk requests on the escalation path

### Track 3: Suitability And Policy

Goal:

- make safety policy explicit, overrideable, and observable

Remaining work:

- richer classifications
- explicit operator override flows
- clearer auto-merge eligibility policy

### Track 4: Provider Resilience

Goal:

- make provider failures predictable and recoverable

Remaining work:

- persist provider/model prompt diagnostics into workflow notes and chat status
- keep one narrow provider or model follow-up ready now that prompt pressure is
  materially lower
- allow issue-worktree runs to inject an explicit fallback chain for live
  proofs without forcing a full manual config rewrite
- explicit queue-start or queue-resume feedback after a pause window clears
- another real rerun or low-risk proof on the refreshed branch now that the
  oversized bootstrap injection warning is gone
- prepare a provider or model fallback plan if diagnostics prove the failure is
  no longer driven by local prompt budget

### Track 5: Review And Rerun Loop

Goal:

- make review feedback and reruns feel first-class

Remaining work:

- richer rerun summaries in chat
- clearer rerun lineage in inbox or status
- another live review or rerun proof after the next promotion

### Track 6: Operator Productization

Goal:

- make install, upgrade, rollback, and resync repeatable

Remaining work:

- Node floor checks in setup verification
- branch-promotion checklist
- rollback checklist for failed live promotions
- machine-readable setup and promotion outputs for CI or external rollout

### Track 7: Upstream Sync Discipline

Goal:

- keep the fork close enough to upstream that feature work does not drift into
  a separate runtime product

Remaining work:

- keep syncing `upstream/main` into dedicated branches
- record recurring conflict hotspots
- promote only after tests and a live proof

### Track 8: External Launch

Goal:

- make the fork operable by someone other than the current long-lived local
  operator owner

Remaining work:

- keep setup and promotion checks consumable from automation as JSON or other
  stable output
- document the supported external operator path end-to-end
- add one explicit "new operator from docs" proof after the next promotion
- keep release-facing prerequisites, limits, and proof requirements explicit

### Track 9: Real Full-Loop Proofs

Goal:

- keep proving the product in the real operator, not only in mocks

Remaining work:

- run a fresh low-risk merged proof from the refreshed sync branch
- promote the refreshed sync branch back to `main`
- rerun a Feishu proof on promoted `main`
- close another docs or operator validation issue

## Ordered Backlog

Preferred near-to-mid-term order:

1. add explicit issue-worktree model fallback overrides and retry refreshed-
   branch proof issue `#87` with a configured fallback chain
2. if `#87` is still noisy after that retry, switch the next slice to deeper
   provider or model diagnostics instead of more prompt trimming
3. if needed, mint the next equivalent low-risk validation issue and keep the
   same provider-aware rerun path
4. run one more low-risk refreshed-branch live proof after that provider slice
   lands
5. promote the refreshed sync branch back to `main`
6. restart the long-lived operator on promoted `main`
7. rerun a low-risk Feishu proof on promoted `main`
8. close or refresh the remaining docs/operator validation issue `#60`
9. finish the current command-layer JSON count series if any non-duplicative
   fields remain
10. write the first explicit JSON contract reference doc for `openclaw code run --json`
11. add preview and edit steps for chat-native issue drafts before creation
12. add clarification loops for ambiguous chat-native requests
13. add explicit operator overrides for suitability-gated work
14. tighten auto-merge eligibility into a documented narrow policy
15. add rollback instructions for failed refreshed-branch promotions
16. record recurring upstream merge conflict hotspots in the sync policy docs
17. run another real PR-review-rerun proof after the next promotion
18. add richer rerun lineage and reason summaries to operator surfaces
19. add another copied-root fresh-operator live proof after the next major sync
20. add a chat-native "request -> issue draft preview -> approve -> run" proof
21. keep setup-check and promotion gates machine-readable so rollout can be
    automated outside the current local shell workflow
22. keep seeding and consuming low-risk validation issues so the proof pool
    never goes empty
23. write a release-facing support matrix covering:
    - supported repo profile
    - supported chat path
    - experimental paths
    - known provider limitations
24. add a promotion checklist artifact that records:
    - sync branch head
    - strict-check result
    - live proof ids
    - rollback target
25. add a rollback helper or documented rollback command path for failed
    operator promotions
26. run one copied-root or fresh-host proof from the public operator docs after
    the next promotion
27. publish the first stable `openclaw code run --json` contract reference
    - initial `contractVersion: 1` reference now exists
    - future slices should update the doc and bump version only for breaking
      changes
28. package the minimum external operator environment variables and config
    knobs into one supported section of the runbook
29. run a public-beta style proof on a repo other than `zhyongrui/openclawcode`
30. only call the program externally ready once a fresh host can go from docs
    to first merged low-risk issue without ad hoc local repair

## Session Handoff

If a new session starts cold, it should read:

1. `docs/openclawcode/development-plan.md`
2. this file
3. `docs/openclawcode/dev-log/YYYY-MM-DD.md`
4. `docs/openclawcode/operator-setup.md`

As of this revision:

- active engineering branch:
  - `main`
- current live-ops baseline after the promotion:
  - the documented repo-local gateway entrypoint now binds
    `127.0.0.1:18789` again when run on Node `>=22.16.0`
  - the first startup on a fresh built checkout may spend about five seconds
    printing `Control UI assets missing; building ...` before the listener
    appears
  - direct no-lazy diagnostics through
    `OPENCLAW_DISABLE_LAZY_SUBCOMMANDS=1` now work against `dist/index.js`
  - `scripts/openclawcode-setup-check.sh` now supports
    `OPENCLAWCODE_SETUP_NODE_BIN` and bounds direct CLI probes so setup
    diagnostics no longer hang indefinitely on a bad runtime
- next planned slice after the current one:
  - debug why the real `~/.openclaw` operator environment can still stall
    before the listener appears, even though the generic built entrypoint is
    healthy on `main`
  - start with the now-isolated plugin signal:
    - `openclawcode-disabled` boots cleanly under the real config
    - `feishu-disabled` while keeping `openclawcode` enabled stalls before the
      listener
  - restart the long-lived Feishu operator on the repaired build
  - run one more low-risk merged proof, one no-op completion proof, and one
    blocked or escalated proof on `main`

Fresh proof result carried forward:

- `sync/upstream-2026-03-13` now has a real low-risk merged proof through:
  - issue `#85`
  - run `zhyongrui-openclawcode-85-1773416913744`
  - `PR #88`
  - promoted into `main`
- `main` now also has a direct no-op completion proof through:
  - issue `#44`
  - run `zhyongrui-openclawcode-44-1773418941601`
  - final stage `completed-without-changes`
  - issue closed automatically without opening a PR
