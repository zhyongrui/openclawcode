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

1. ingest a GitHub issue
2. decide whether the issue is suitable for autonomous work
3. plan the implementation
4. create an isolated worktree and branch
5. implement the change
6. run targeted validation
7. open a draft PR
8. run an independent review and verification pass
9. either escalate, request changes, or mark ready for human review
10. optionally support guarded merge automation later

The key constraint is that `openclawcode` is not just a prompt wrapper.
It needs durable workflow state, explicit policy, reproducible isolation, and
observable artifacts.

## Current Baseline

As of 2026-03-09, the repository already has a meaningful MVP slice:

- workflow contracts and stage transitions
- persisted workflow runs
- git worktree preparation and changed-file collection
- GitHub issue intake
- builder and verifier adapters backed by the OpenClaw runtime
- `openclaw code run ...` CLI execution
- draft PR publishing hooks
- optional merge hook plumbing
- real-run validation against this repository

The current bottleneck is no longer basic execution. The current bottleneck is
control quality:

- issue classification is still too weak
- builder scope drift is still possible on small CLI issues
- verification policy is still shallow
- run persistence is present, but not yet rich enough for retries, resumption,
  and operator visibility

## Next Iteration Plan

As of 2026-03-10, the immediate next stage is no longer workflow bring-up.
The next stage is making the current issue-driven loop usable for day-to-day
repository work in this fork.

The short-term objective is:

- keep using real GitHub issues as the driver
- keep validating each slice end-to-end against this repository
- move from "observable workflow state" toward "usable PR and review
  automation"

### Current Checkpoint

The current repository state already supports:

- persisted run records
- isolated worktrees
- builder/verifier execution
- stable top-level JSON fields for:
  - changed files
  - issue classification
  - scope-check status
  - draft PR number and URL
  - draft PR branch and base branch
  - verification decision and summary
  - auto-merge policy eligibility and reason

This means the next iteration can shift from output surfacing to workflow
closure.

### Near-Term Delivery Streams

The next iteration should run across three delivery streams in parallel.

#### Stream 1: Output Contract Completion

Objective:

- finish the top-level JSON contract so downstream automation does not need to
  keep parsing nested workflow objects

Priority backlog:

1. expose published PR metadata as stable top-level fields
2. expose merge-decision and merge-disposition fields as stable top-level fields
3. add a concise top-level run summary that is readable by both humans and
   scripts

Validation rule:

- every new output field must be covered by command-layer tests and then
  validated through a real GitHub issue run

#### Stream 2: Real PR Lifecycle Validation

Objective:

- prove that `openclawcode` can move from issue execution to real PR handling
  in this repository, not just simulated local state

Priority backlog:

1. run a real issue with `--open-pr`
2. verify branch push, draft PR creation, and run-record backfill
3. verify that real PR metadata is preserved in the final JSON output
4. trial guarded `--merge-on-approve` only after `--open-pr` is stable
5. confirm that auto-merge remains restricted to the intended command-layer
   policy

Validation rule:

- do not broaden merge automation until draft PR publication is reliable under
  repeated real runs

#### Stream 3: Review and Checkpoint Hardening

Objective:

- make the verifier useful as an actual reviewer instead of only a summary step

Priority backlog:

1. structure verifier findings by category
2. distinguish scope violations, test failures, and review objections
3. define explicit human checkpoint rules
4. improve the request-changes loop so follow-up runs preserve continuity

Validation rule:

- verifier outputs must be specific enough to drive a retry without manual
  interpretation of raw transcripts

### Recommended Issue Sequence

The next concrete issue order should be:

1. published PR top-level fields
2. merge decision and disposition top-level fields
3. real `--open-pr` workflow validation
4. real `--merge-on-approve` workflow validation
5. structured verifier findings

This order is deliberate:

- first complete the machine-readable contract
- then validate real PR publication
- only then test real merge behavior
- finally harden review quality once the surrounding control loop is stable

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

- prefer command-layer slices until the PR lifecycle path is proven stable
- treat real issue runs as the primary acceptance test
- sync `upstream/main` only at clean checkpoints, not mid-slice
- keep `openclawcode` workflow logic isolated from broad upstream runtime edits

### Exit Criteria For This Iteration

This iteration is complete when:

- the JSON output is rich enough for downstream automation to consume directly
- a real draft PR can be opened from an issue run in this repository
- guarded merge automation has been trialed on a real issue
- verifier output is structured enough to support repeatable review loops
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

### Slice A: Issue #3 Scope Guardrails

Deliverables:

- issue classification helper
- command-layer prompt guardrails
- changed-file scope checker
- regression coverage for classification and blocked-file detection
- real rerun of issue `#2` after the guardrail lands

Why this first:

- it addresses the main failure mode observed in real runs
- it improves completion quality without expanding the architecture much

### Slice B: Persist Richer Run Metadata

Deliverables:

- persist issue classification in workflow run output
- persist scope-check findings and reasons
- improve run notes for operator debugging

Why next:

- once scope policy exists, its decisions need to be visible in stored runs and
  JSON output

### Slice C: Verifier Upgrade

Deliverables:

- acceptance-criteria-aware verification prompt
- scope-drift findings in verifier context
- missing-coverage findings tied to changed files

Why next:

- the verifier should confirm the builder stayed within policy, not just review
  code generally

### Slice D: Human-in-the-Loop Checkpoints

Deliverables:

- explicit stage for human approval when issue class is risky or mixed
- optional pause before PR publication or before merge
- clear operator messaging in run output

Why next:

- this turns the system from a raw pipeline into a controllable assistant

### Slice E: PR Draft Quality

Deliverables:

- stronger PR summary
- acceptance checklist
- change summary grouped by behavior
- explicit unresolved concerns section

Why next:

- even a technically correct run is weak if the PR is hard to review

### Slice F: Resume and Retry Semantics

Deliverables:

- retry metadata per stage
- rerun support that preserves the right worktree and branch continuity
- operator guidance when a rerun is safe vs unsafe

Why next:

- real usage will involve retries; the system needs first-class rerun behavior

## Detailed Plan for the Immediate Next Slice

The next implementation slice should follow this order:

1. add an issue scope module that classifies a run as `command-layer`,
   `workflow-core`, or `mixed`
2. move prompt logic in the builder to use that classification instead of ad hoc
   keyword checks
3. add a post-build scope checker that inspects changed files before tests and
   before auto-commit
4. fail command-layer builds when they edit blocked workflow-core areas such as
   contracts, orchestrator, persistence, or workflow internals without explicit
   issue justification
5. expose classification and scope-check notes in build output
6. add focused tests for classification, prompt generation, and builder failure
   behavior
7. rerun the real issue flow against issue `#2`
8. inspect run artifacts and update the dev log
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
- prompt targeting quality
- sandbox and worktree behavior
- changed-file output
- run artifact correctness

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

## Test Commands

The default validation path for current `openclawcode` work should remain
targeted:

- `pnpm exec vitest run --config vitest.openclawcode.config.mjs`
- focused single-file tests for modules under active change
- real `openclaw code run ... --json` reruns for workflow validation

Whole-repo validation should be postponed unless a slice clearly touches shared
OpenClaw surfaces beyond `openclawcode`.

## Commit and Documentation Policy

Each completed slice should follow this order:

1. implement code
2. add or update tests
3. run targeted validation
4. update `docs/openclawcode/dev-log/2026-03-09.md`
5. commit with one clear message for one coherent slice

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
- it can complete a narrow accepted issue in an isolated worktree
- it can run targeted tests and record them
- it can open a readable draft PR
- it can run an independent verification pass
- it can preserve run history and operator-visible artifacts
- it can survive reruns without manual cleanup
- it keeps small issues scoped to small diffs

Until then, the right approach is controlled real-world testing against this
repository, with each discovered failure converted into code, tests, and notes.
