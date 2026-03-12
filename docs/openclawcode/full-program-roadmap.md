# OpenClawCode Full Program Roadmap

This is the long-horizon backlog for `openclawcode`.

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

## Current Operating Baseline

As of 2026-03-12:

- active feature branch:
  - `sync/upstream-2026-03-12-refresh`
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

## Work Tracks

### Track 1: Command JSON Contract

Goal:

- make `openclaw code run --json` stable enough that downstream tooling can
  rely on top-level fields instead of unpacking nested workflow data

Remaining work:

- finish any remaining non-duplicative JSON convenience fields
- document the supported JSON contract once the surface stabilizes

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

- provider-aware rerun summaries in chat surfaces
- explicit queue-start or queue-resume feedback after a pause window clears
- another real rerun proof on the refreshed branch once provider stability
  allows it

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

### Track 7: Upstream Sync Discipline

Goal:

- keep the fork close enough to upstream that feature work does not drift into
  a separate runtime product

Remaining work:

- keep syncing `upstream/main` into dedicated branches
- record recurring conflict hotspots
- promote only after tests and a live proof

### Track 8: Real Full-Loop Proofs

Goal:

- keep proving the product in the real operator, not only in mocks

Remaining work:

- run a fresh low-risk merged proof from the refreshed sync branch
- promote the refreshed sync branch back to `main`
- rerun a Feishu proof on promoted `main`
- close another docs or operator validation issue

## Ordered Backlog

Preferred near-to-mid-term order:

1. rerun refreshed-branch proof issue `#87` now that queued reruns can explain
   whether they are waiting behind an active pause or probing recovery after a
   cleared pause
2. if `#87` is still noisy, mint the next equivalent low-risk validation issue
   and keep the same provider-aware rerun path
3. run one more low-risk refreshed-branch live proof after that rerun-path
   improvement lands
4. promote the refreshed sync branch back to `main`
5. restart the long-lived operator on promoted `main`
6. rerun a low-risk Feishu proof on promoted `main`
7. close or refresh the remaining docs/operator validation issue `#60`
8. finish the current command-layer JSON count series if any non-duplicative
   fields remain
9. write the first explicit JSON contract reference doc for `openclaw code run --json`
10. add preview and edit steps for chat-native issue drafts before creation
11. add clarification loops for ambiguous chat-native requests
12. add explicit operator overrides for suitability-gated work
13. tighten auto-merge eligibility into a documented narrow policy
14. add rollback instructions for failed refreshed-branch promotions
15. record recurring upstream merge conflict hotspots in the sync policy docs
16. run another real PR-review-rerun proof after the next promotion
17. add richer rerun lineage and reason summaries to operator surfaces
18. add another copied-root fresh-operator live proof after the next major sync
19. add a chat-native "request -> issue draft preview -> approve -> run" proof
20. keep seeding and consuming low-risk validation issues so the proof pool
    never goes empty

## Session Handoff

If a new session starts cold, it should read:

1. `docs/openclawcode/development-plan.md`
2. this file
3. `docs/openclawcode/dev-log/YYYY-MM-DD.md`
4. `docs/openclawcode/operator-setup.md`

As of this revision:

- active feature branch:
  - `sync/upstream-2026-03-12-refresh`
- next planned slice after the current one:
  - rerun refreshed-branch proof issue `#87` with the new provider-aware rerun
    summary path, then promote if the live proof is finally clean
