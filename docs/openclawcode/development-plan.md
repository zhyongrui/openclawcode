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

As of 2026-03-10, the repository already has a working issue-driven core plus a
real bundled OpenClaw chatops adapter:

- workflow contracts and stage transitions
- persisted workflow runs
- git worktree preparation and changed-file collection
- GitHub issue intake
- builder and verifier adapters backed by the OpenClaw runtime
- `openclaw code run ...` CLI execution
- draft PR publishing hooks
- optional merge hook plumbing
- real-run validation against this repository
- bundled OpenClaw plugin command surface:
  - `/occode-start`
  - `/occode-status`
  - `/occode-inbox`
  - `/occode-skip`
  - `/occode-sync`
- repository notification bindings for chat delivery
- persisted plugin queue state with structured workflow status snapshots
- local-run and GitHub-side status reconciliation for operator recovery
- background issue execution through the built CLI entrypoint

The repository has already proven several real production-style checkpoints:

- real GitHub issues can drive code changes in this repository
- real draft PRs can be opened from workflow runs
- chatops-triggered background execution can complete and persist results
- operator-facing recovery commands can heal local state after interruptions

The current bottleneck is no longer basic execution. The current bottleneck is
closing the operational loop cleanly:

- webhook-to-chat intake still needs broader real-world validation
- review and merge state are not yet reconciled deeply enough from GitHub
- request-changes and retry continuity are still shallow
- packaging and installation still feel like a development environment, not a
  clean product setup
- notification policy is present, but not yet polished for daily unattended use

## Next Iteration Plan

As of 2026-03-10, the immediate next stage is no longer workflow bring-up or
single-command validation. The next stage is making the issue-to-chat-to-PR
loop usable for day-to-day repository work in this fork.

The short-term objective is:

- keep using real GitHub issues as the driver
- keep validating each slice end-to-end against this repository
- move from "observable workflow state" toward "usable unattended repository
  automation"
- make chat the normal operator entrypoint instead of a side-channel demo

### Current Checkpoint

The current repository state already supports:

- persisted run records
- isolated worktrees
- builder/verifier execution
- real draft PR publication in this repository
- webhook-backed chatops intake plumbing
- queue persistence and background execution
- chat-visible operator commands and recovery commands
- structured status snapshots for workflow runs and tracked PRs
- stable top-level JSON fields for downstream automation, including:
  - changed files
  - issue classification
  - scope-check status and blocked files
  - draft PR metadata and disposition
  - published PR and merged PR status
  - verification decision, summary, and counts
  - auto-merge policy eligibility and disposition

This means the next iteration can shift from output surfacing to full loop
closure and operator trust.

### Near-Term Delivery Streams

The next iteration should run across four delivery streams in parallel.

#### Stream 1: GitHub Intake and Chat Routing

Objective:

- make issue events arrive at the right chat target with the right amount of
  operator context and without duplicate execution

Priority backlog:

1. validate repository binding behavior against more than one issue source event
2. deduplicate repeated GitHub deliveries for the same issue action
3. improve chat notification copy for approval, running, failure, and success
4. bind issue, PR, and review events back to the same conversation target
5. document the operator setup path clearly enough that the repo can be used
   without reverse-engineering local state files

Validation rule:

- every intake rule must be exercised by replayed webhook payload tests and at
  least one real issue event or chat-triggered run in this repository

#### Stream 2: Workflow Lifecycle and State Consistency

Objective:

- make repeated runs, retries, restarts, and background execution behave like a
  durable service rather than an optimistic prototype

Priority backlog:

1. harden issue state transitions around retries and request-changes loops
2. add reconciliation for review outcomes, merge outcomes, and closed-without-merge PRs
3. add explicit idempotency rules for stale worker completions and duplicate
   queue promotions
4. improve run-record linking between workflow runs, plugin state, and PR state
5. expose a compact operator-facing run ledger for recent activity

Validation rule:

- every state-healing or retry rule must get a regression test that proves the
  latest known good state cannot be clobbered by stale data

#### Stream 3: Review, Request-Changes, and Merge Control

Objective:

- make the reviewer/approver path usable as a real control loop instead of only
  a terminal summary

Priority backlog:

1. reconcile GitHub PR reviews back into local workflow state
2. support request-changes follow-up runs that preserve issue and branch
   continuity intentionally
3. define explicit merge gates based on issue class, verifier outcome, and test
   status
4. notify chat when human action is required, when review changed the state,
   and when merge completed or failed
5. keep auto-merge narrow and policy-driven instead of broadening it by prompt

Validation rule:

- verifier outputs must be specific enough to drive a retry without manual
  interpretation of raw transcripts
- merge policy changes must be proven first on low-risk real issues in this
  repository

#### Stream 4: Packaging, Install, and Operator Experience

Objective:

- make `openclawcode` installable and operable as a product, not only as a
  development checkout

Priority backlog:

1. define the supported install path and required GitHub/OpenClaw config
2. add one-command or low-friction setup documentation for repo mapping,
   webhook secret, and chat binding
3. separate runtime artifacts from committed project files more cleanly
4. document a repeatable upgrade and upstream-sync workflow
5. add an operator runbook for day-to-day use, recovery, and rollback

Validation rule:

- a fresh operator should be able to configure the repository and trigger a
  full issue run using docs only

### Recommended Issue Sequence

The next concrete issue order should be:

1. webhook intake idempotency and duplicate-delivery protection
2. review-state reconciliation from GitHub PR reviews
3. request-changes rerun continuity
4. merge-state reconciliation and final chat notification
5. installation and operator setup hardening
6. guarded real merge validation on a low-risk issue

This order is deliberate:

- first make intake trustworthy
- then make review and rerun loops coherent
- then close the merge and notification loop
- finally harden product packaging once the behavior is stable

### Execution Rules For The Next Iteration

Keep the current working pattern:

1. create one GitHub issue for one bounded slice
2. implement only the smallest change needed for that issue
3. run targeted local tests first
4. commit the feature slice
5. push to `origin/main`
6. run the real `openclaw code run` workflow against that issue
7. record the result in the dev log

Additional rules:

- prefer slices that close real operational gaps over adding more output fields
- treat real issue runs as the primary acceptance test
- sync `upstream/main` only at clean checkpoints, not mid-slice
- keep `openclawcode` workflow logic isolated from broad upstream runtime edits
- do not trust plugin-state text alone when a structured snapshot exists;
  always reconcile toward the newest structured state
- every real failure mode found in chatops must become either:
  - a regression test
  - a reconciliation rule
  - an operator-facing recovery command

### Exit Criteria For This Iteration

This iteration is complete when:

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

### Slice A: Webhook Intake Idempotency

Deliverables:

- normalize GitHub issue-event identity for deduplication
- ignore repeated deliveries that should not create a second pending approval
- persist enough event metadata to explain why an event was accepted or ignored
- regression coverage for duplicate webhook deliveries and repeated approvals
- real validation with a GitHub issue event against this repository

Why this first:

- duplicate intake is the fastest way to make automation noisy and untrusted
- it protects every downstream stage without requiring broad architectural work

### Slice B: Review-State Reconciliation

Deliverables:

- persist PR review state in plugin snapshots
- reconcile approved / changes-requested review outcomes from GitHub
- reflect review outcomes in `/occode-status` and chat notifications
- regression coverage for review-sync transitions and stale review data

Why next:

- review is the next real external signal after PR creation
- without review sync, the chat and plugin state will drift from GitHub quickly

### Slice C: Request-Changes Continuity

Deliverables:

- define how a request-changes rerun links to the prior run and PR
- preserve branch continuity when rerunning the same issue intentionally
- store the follow-up reason and latest review findings in run artifacts
- regression coverage for safe rerun semantics

Why next:

- request-changes is the core loop that turns this from one-shot automation
  into a usable coding assistant

### Slice D: Merge-State Reconciliation and Final Notifications

Deliverables:

- reconcile merged, closed-without-merge, and merge-failed PR outcomes
- send final chat notifications for merged, blocked, and abandoned states
- record final disposition in workflow snapshots and operator status output
- regression coverage for merge-state healing

Why next:

- the user-facing promise is not just "opened a PR" but "finished the issue
  loop and told me what happened"

### Slice E: Operator Install and Setup Hardening

Deliverables:

- document the supported install path as a first-class workflow
- document repo binding, webhook setup, chat target setup, and required tokens
- reduce manual state-file editing in favor of documented commands or config
- add a setup verification checklist

Why next:

- once the loop works, setup friction becomes the next blocker to real use

### Slice F: Guarded Real Merge Validation

Deliverables:

- choose one low-risk issue in this repository
- validate the merge gate path end-to-end with the current token policy
- document the exact required GitHub permissions and failure handling
- keep the merge policy narrow and reversible

Why next:

- merge is the highest-risk action and should only be exercised once intake,
  review, rerun, and notifications are already coherent

## Detailed Plan for the Immediate Next Slice

The next implementation slice should follow this order:

1. inspect the current GitHub webhook handler and identify which event fields
   are stable enough to build a delivery idempotency key
2. add a persisted webhook-delivery ledger or equivalent dedupe mechanism inside
   the plugin state layer
3. reject duplicate issue events that would otherwise recreate the same pending
   approval or queue entry
4. expose the dedupe decision in logs or operator-visible state so ignored
   events are explainable
5. add focused tests for duplicate webhook deliveries and duplicate approval
   attempts
6. replay a realistic webhook payload locally against the plugin route
7. validate against a real GitHub issue event in this repository if practical
8. update the dev log with the observed failure mode and final behavior
9. commit the slice only after targeted tests pass

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
4. update `docs/openclawcode/dev-log/2026-03-09.md`
5. update `docs/openclawcode/dev-log/2026-03-10.md` when the work lands on the
   current day
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
- it can reconcile review and merge outcomes back into its own state
- it can notify humans of final outcomes without terminal intervention
- it keeps small issues scoped to small diffs

Until then, the right approach is controlled real-world testing against this
repository, with each discovered failure converted into code, tests, and notes.
