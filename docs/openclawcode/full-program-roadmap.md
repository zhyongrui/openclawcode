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
  - this workstation still builds under Node `22.12.0` with warnings

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

## Work Tracks

### Track 1: Command JSON Contract

Goal:

- make `openclaw code run --json` stable enough that downstream tooling can
  rely on top-level fields instead of unpacking nested workflow data

Remaining work:

- finish any remaining non-duplicative JSON convenience fields
- document the supported JSON contract once the surface stabilizes

Immediate queue:

- `#82` `changedFileCount`
- `#83` Node floor setup-check gate
- follow with the next live proof on the refreshed sync branch

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

- better provider-pause history in operator surfaces
- clearer pause-cleared signaling
- local Node upgrade to satisfy the new upstream CLI floor

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

1. finish the current command-layer JSON count series on the active sync branch
2. add the next `BuildResult` count fields
3. add a setup-check gate for the new Node floor
4. run one low-risk live proof on the sync branch
5. promote the refreshed sync branch back to `main`
6. restart the long-lived operator on the promoted branch
7. rerun a low-risk Feishu proof on promoted `main`
8. resume chat-intake UX improvements
9. improve provider-pause and rerun operator surfaces
10. close another docs or operator validation issue

## Session Handoff

If a new session starts cold, it should read:

1. `docs/openclawcode/development-plan.md`
2. this file
3. `docs/openclawcode/dev-log/YYYY-MM-DD.md`
4. `docs/openclawcode/operator-setup.md`

As of this revision:

- active feature branch:
  - `sync/upstream-2026-03-12-refresh`
- next command-layer slice after the current one:
  - `#83` Node floor setup-check gate
