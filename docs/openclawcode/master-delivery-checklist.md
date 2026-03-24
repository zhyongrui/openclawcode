# OpenClawCode Master Delivery Checklist

This is the canonical long-running execution checklist for `openclawcode`.

For a much longer list of seed-ready low-risk command-layer issue candidates,
see `command-layer-backlog.md`.

For the long-form blueprint-first phase plan, see
`blueprint-first-delivery-plan.md`.

For the mapping from current `openclaw` substrate capabilities to the intended
blueprint-first product, see `openclaw-capability-mapping.md`.

Use it when the goal is not just "finish the next slice", but "keep shipping
until the product is genuinely usable by other people".

## Status Legend

- `[x]` completed and already proven
- `[ ]` still open

## North Star

The finished product should let a teammate do this with bounded operator work:

1. describe a task from Feishu or GitHub
2. let the operator decide whether the task is safe and suitable
3. create or accept a scoped issue
4. run an isolated implementation workflow
5. test and verify the result
6. open and manage a PR
7. react to review and rerun requests
8. merge only when policy allows
9. keep the chat thread and persisted state accurate the whole time
10. let a fresh operator host repeat the same flow from docs and machine-readable checks

## Exit Criteria

The program is only "done enough to hand to other people" when all of these are true:

- [x] a fresh operator host can be configured from docs without private tribal knowledge
- [x] a low-risk issue can run from Feishu to merged PR without manual repair
- [x] a no-op issue can complete cleanly without creating a noisy PR
- [x] a blocked or escalated issue is clearly surfaced without branch mutation
- [x] provider failures are diagnosable from saved artifacts and chat surfaces
- [x] setup, promotion, rollback, and copied-root proofs are routine and documented
- [x] the machine-readable contracts are intentionally versioned and documented
- [x] upstream sync can be repeated without putting the long-lived operator at risk
- [x] release-facing docs explain scope, prerequisites, support policy, and known limits

## Phase -1: Blueprint-First Control Plane

- [x] define a fixed project blueprint document path and schema
- [x] support a goal-discussion loop before issue creation
- [x] support clarification questions when the goal is underspecified
- [x] support proactive system suggestions while refining the goal
- [x] support an explicit "blueprint agreed" checkpoint
- [x] derive execution work items from the blueprint instead of assuming GitHub issues already exist
- [x] add a first general discovery pipeline beyond validation-pool seeding
- [x] define a provider-neutral role model for planner, coder, reviewer, verifier, and doc-writer
- [x] map Codex and Claude Code into that shared role model
- [x] persist runtime-applied coder and verifier routing selections in workflow artifacts
- [x] allow structured rerun-time coder and verifier overrides from chat and CLI
- [x] support stage-level human handoff, edit, resume, and provider switching
- [x] persist blueprint and stage-gate decisions in machine-readable artifacts

## Phase 0: Already-Proven Foundations

- [x] define the issue-driven workflow model and stage transitions
- [x] persist workflow runs under `.openclawcode/runs`
- [x] create isolated issue worktrees and branches
- [x] support CLI execution through `openclaw code run`
- [x] wire builder execution through the embedded OpenClaw runtime
- [x] wire verifier execution through the embedded OpenClaw runtime
- [x] publish draft PRs from workflow runs
- [x] support guarded merge plumbing in the workflow service
- [x] ingest GitHub issue webhooks with delivery-id deduplication
- [x] expose bundled plugin commands for chat operations
- [x] persist queue state and structured snapshots in the plugin store
- [x] reconcile local run artifacts back into operator snapshots
- [x] recover failed background runs into rerunnable tracked state
- [x] react to `pull_request_review` approved events
- [x] react to `pull_request_review` changes-requested events
- [x] react to `pull_request` merged events
- [x] react to `pull_request` closed-without-merge events
- [x] prove live rerun continuity with review context and existing PR reuse
- [x] prove one full merged live path on the long-lived operator
- [x] prove one escalated or blocked path on the long-lived operator
- [x] prove one completed-without-changes path on the long-lived operator

## Phase 1: Core Operator Runtime

- [x] keep workflow state durable across process restarts
- [x] keep worktree preparation deterministic for reusable issue branches
- [x] merge the latest base into reused issue branches before publication
- [x] abort issue-branch reuse cleanly when branch refresh conflicts
- [x] persist stage-specific failed artifacts instead of losing terminal state
- [x] record rerun metadata in saved run artifacts
- [x] record PR continuity metadata in saved run artifacts
- [x] expose stage labels as stable top-level JSON
- [x] expose attempt counters as stable top-level JSON
- [x] expose change-disposition signals as stable top-level JSON
- [x] expose scope-check signals as stable top-level JSON
- [x] expose verification signals as stable top-level JSON
- [x] expose rerun signals as stable top-level JSON
- [x] expose auto-merge policy signals as stable top-level JSON
- [x] expose draft PR publication signals as stable top-level JSON
- [x] expose merged PR signals as stable top-level JSON
- [x] expose remaining useful issue identity mirrors without requiring nested object reads
- [x] expose remaining useful draft PR mirrors without requiring nested object reads
- [x] expose remaining useful verification mirrors without requiring nested object reads
- [x] expose remaining useful suitability mirrors without requiring nested object reads
- [x] expose remaining useful build-result mirrors without requiring nested object reads

## Phase 2: Chatops And Operator Surfaces

- [x] provide `/occode-bind`
- [x] provide `/occode-unbind`
- [x] provide `/occode-intake`
- [x] provide `/occode-start`
- [x] provide `/occode-rerun`
- [x] provide `/occode-status`
- [x] provide `/occode-inbox`
- [x] provide `/occode-blueprint`
- [x] provide `/occode-goal`
- [x] provide `/occode-blueprint-agree`
- [x] provide `/occode-blueprint-edit`
- [x] provide `/occode-gates`
- [x] provide `/occode-gate-decide`
- [x] provide `/occode-intake-confirm`
- [x] provide `/occode-intake-edit`
- [x] provide `/occode-intake-reject`
- [x] provide `/occode-takeover`
- [x] provide `/occode-resume-after-edit`
- [x] provide `/occode-skip`
- [x] provide `/occode-sync`
- [x] show suitability decisions in `/occode-status`
- [x] show suitability summaries in `/occode-status`
- [x] show validation-pool inventory in `/occode-inbox`
- [x] show validation-pool class and template counts in `/occode-inbox`
- [x] show validation issue annotations in `/occode-status`
- [x] show structured failure diagnostics in `/occode-status`
- [x] show structured failure diagnostics in `/occode-inbox`
- [x] show blueprint work-item backlog summaries in `/occode-inbox`
- [x] show blueprint status and revision in `/occode-status`
- [x] show provider-role routing decisions in `/occode-status`
- [x] show stage-gate readiness summaries in `/occode-status`
- [x] show provider pause information while a pause is active
- [x] allow `/occode-intake` to accept a single-line request
- [x] synthesize a minimal issue body from one-line intake
- [x] add a confirmation step for ambiguous chat-native intake
- [x] allow editing a generated issue draft before creation
- [x] support clarification prompts when a one-line request is underspecified
- [x] show blueprint summary and clarification prompts in chat
- [x] show active manual takeover state in `/occode-status`
- [x] allow stage-gate decisions to be recorded from chat
- [x] make `/occode-start` respect execution-start gate decisions
- [x] make auto webhook intake respect execution-start gate decisions
- [x] make `/occode-intake` respect execution-start gate decisions
- [x] auto-resume execution-start-held work after chat gate approval
- [x] allow pre-run provider-role reroute updates from chat
- [x] allow active runs to capture deferred coder or verifier reroutes for automatic post-failure replay
- [x] show policy explanation when auto-merge is disallowed
- [x] show policy explanation when suitability blocks autonomous execution
- [x] show promotion-readiness and rollback-readiness in chat-facing operator views
- [x] show current branch or release baseline in chat-facing operator views
- [x] show the current operator config profile or root in status output
- [x] add a compact promotion checklist command for operators

## Phase 3: Suitability And Policy

- [x] classify issues before workspace mutation
- [x] precheck obvious high-risk issues before queueing
- [x] escalate high-risk issues before branch creation
- [x] persist suitability summaries in workflow runs
- [x] persist suitability summaries in operator snapshots
- [x] require command-layer scope for current auto-merge policy
- [x] require verification approval for current auto-merge policy
- [x] require suitability acceptance for current auto-merge policy
- [x] formalize a stable allowlist of low-risk categories for autonomous merge
- [x] formalize a stable denylist of high-risk categories for autonomous execution
- [x] add explicit operator override flow for suitability exceptions
- [x] add explicit operator override flow for merge-policy exceptions
- [x] document supported labels and keywords that affect suitability
- [x] document supported labels and keywords that affect merge policy
- [x] make policy decisions machine-readable enough for external automation

## Phase 4: Builder, Verifier, And Workspace Integrity

- [x] fail fast when tracked files become empty unexpectedly
- [x] harden host-side edit recovery for issue worktrees
- [x] harden sandbox-side edit recovery for issue worktrees
- [x] replace unstable sandbox writes with deterministic bridge-backed edits
- [x] re-enable sandbox `edit` behind a controlled rollout
- [x] re-enable sandbox `write` behind a controlled rollout
- [x] prove sandbox edit on live low-risk runs
- [x] prove sandbox write on live low-risk runs
- [x] keep package-manager and formatter commands on the host side during live runs
- [x] trim issue-worktree bootstrap context to reduce prompt bloat
- [x] trim skill footprint for issue-worktree runs
- [x] surface structured embedded agent failure diagnostics
- [x] persist provider/model diagnostics into workflow artifacts
- [x] add more explicit guardrails around large generated diffs
- [x] add more explicit guardrails around broad file fan-out
- [x] add a dedicated diff-size or changed-lines policy signal
- [x] add a dedicated generated-file policy signal
- [x] add regression tests for pathological large-worktree prompts

## Phase 5: Provider Resilience

- [x] treat agent `stopReason=error` as a workflow failure
- [x] add bounded outer retry windows for provider-side `HTTP 400` failures
- [x] shorten retry waits for fresh provider-side `HTTP 400` failures
- [x] disable the inner embedded retry loop so outer workflow retries remain observable
- [x] persist compact provider diagnostics in failed workflow notes
- [x] mirror provider diagnostics into top-level JSON fields
- [x] mirror provider diagnostics into operator snapshots
- [x] expose provider diagnostics in chat surfaces
- [x] add fallback-chain injection support via `OPENCLAWCODE_MODEL_FALLBACKS`
- [x] expose model inventory and fallback readiness in setup-check JSON
- [x] configure and prove a second discoverable model on the live operator host
- [x] run a real fallback proof on the long-lived operator
- [x] decide whether fallback should remain proof-only or become supported operator behavior
- [x] document supported provider/model combinations
- [x] document provider failure classes that should auto-pause the queue
- [x] document provider failure classes that should not auto-pause the queue

## Phase 6: Machine-Readable Contracts

- [x] establish `contractVersion: 1` for `openclaw code run --json`
- [x] write `run-json-contract.md`
- [x] define a stability boundary for top-level vs nested fields
- [x] expose validation-pool inventory in JSON
- [x] expose validation-pool template counts in JSON
- [x] expose validation-pool implementation states in JSON
- [x] expose setup-check readiness in JSON
- [x] expose setup-check model inventory in JSON
- [x] expose setup-check built-startup proof readiness in JSON
- [x] expose runtime-applied coder and verifier routing in top-level run JSON
- [x] expose a machine-readable promotion gate artifact that combines:
  - latest setup-check result
  - branch name
  - commit SHA
  - low-risk-proof readiness
  - fallback-proof readiness
  - promotion readiness
- [x] expose a machine-readable rollback suggestion artifact
- [x] define a stable contract for chat-visible operator status snapshots
- [x] define a stable contract for validation-pool reconciliation output
- [x] define a stable contract for promotion and rollback docs metadata

## Phase 7: Validation-Pool Governance

- [x] seed low-risk validation issues from the repo-local CLI
- [x] list validation issues from the repo-local CLI
- [x] classify validation issues as `implemented`, `pending`, or `manual-review`
- [x] close implemented command-layer validation issues automatically
- [x] prevent duplicate validation issue creation by reusing matching open issues
- [x] support boolean validation template
- [x] support number validation template
- [x] support string validation template
- [x] keep the pool replenished after each consumed command-layer issue
- [x] add dedicated templates for timestamp-like string fields if the generic string template becomes ambiguous
- [x] add dedicated templates for URL string fields if the generic string template becomes ambiguous
- [x] add dedicated templates for enum string fields if the generic string template becomes ambiguous
- [x] decide and document the minimum pool size for:
  - command-layer issues
  - operator-doc issues
  - high-risk validation issues
- [x] add a CLI option to enforce that minimum pool size automatically
- [x] add a CLI option to seed a balanced pool in one command
- [x] document the validation-pool maintenance cadence

## Phase 8: Setup, Install, And Promotion

- [x] maintain `scripts/openclawcode-setup-check.sh`
- [x] maintain `scripts/openclawcode-webhook-tunnel.sh`
- [x] verify required GitHub webhook event subscriptions
- [x] verify gateway reachability
- [x] verify signed route probes
- [x] verify built-startup proofs
- [x] distinguish route readiness from built-startup readiness
- [x] support copied-root and alternate operator-root checks
- [x] sanitize model inventory probes to avoid plugin or channel noise
- [x] retry transient GitHub webhook subscription transport failures
- [x] support explicit Node binary selection for setup-check
- [x] add a documented install path for a completely fresh external host
- [x] add an upgrade path from one release tag to the next
- [x] add a rollback path from a broken promotion to the previous good baseline
- [x] add a promotion checklist tied to exact commands and expected outputs
- [x] add an explicit disaster-recovery checklist for a broken long-lived operator
- [x] add a machine-readable promotion receipt saved on successful promotion
- [x] add a machine-readable rollback receipt saved on rollback
- [x] document required secrets, environment variables, and least-privilege scopes
- [x] document how to rotate webhook secrets and operator tokens safely
- [x] document how to rotate Feishu bindings safely

## Phase 9: Fresh-Host Reproducibility

- [x] prove a copied-root setup path
- [x] prove copied-root strict health checks
- [x] prove a copied-root merged low-risk run
- [x] prove a fully fresh external-style host from zero to first successful bind
- [x] prove a fully fresh external-style host from zero to one merged low-risk run
- [x] prove a fully fresh external-style host from zero to one escalated path
- [x] prove a fully fresh external-style host from zero to one rerun path
- [x] document exact host prerequisites:
  - Node version
  - pnpm version
  - git version
  - GitHub token scopes
  - model provider configuration
  - Feishu app/bot configuration
- [x] document exact expected outputs for each proof gate on a fresh host
- [x] document common failure signatures and first recovery steps for fresh hosts

## Phase 10: Upstream Sync Discipline

- [x] keep upstream syncs off the long-lived `main` branch while validating
- [x] use dated `sync/upstream-*` branches as the integration path
- [x] validate sync branches with `pnpm build`
- [x] validate sync branches with the `vitest.openclawcode` suite
- [x] promote validated sync branches back to `main`
- [x] record sync conflict hotspots in docs and dev logs
- [x] define the preferred sync cadence
- [x] define a hard threshold for "behind upstream" that forces a sync slice
- [x] document the promotion checklist after each successful sync
- [x] document the rollback checklist if a promoted sync regresses the live operator
- [x] keep a short conflict-history appendix for recurring hotspots

## Phase 11: Low-Risk Live-Proof Ladder

- [x] prove at least one merged low-risk run on `main`
- [x] prove at least one merged low-risk run on a refreshed sync branch
- [x] prove at least one completed-without-changes path
- [x] prove at least one escalated or blocked path
- [x] prove at least one review-changes-requested lifecycle replay
- [x] prove at least one review-approved lifecycle replay
- [x] prove at least one closed-without-merge lifecycle replay
- [x] re-prove a merged low-risk run on the latest long-lived `main` baseline after the most recent upstream promotion
- [x] re-prove a no-op completion path on the latest long-lived `main` baseline after the most recent upstream promotion
- [x] re-prove a blocked or escalated path on the latest long-lived `main` baseline after the most recent upstream promotion
- [x] prove one live fallback-model run if a second model becomes available
- [x] document the exact proof matrix required before calling the operator "externally usable"

## Phase 12: Chat-Native Product Completion

- [x] support one-line Feishu intake
- [x] create a GitHub issue from chat
- [x] queue a low-risk issue directly from chat
- [x] precheck high-risk chat-intake issues
- [x] preview a generated issue before submission
- [x] allow the operator to ask for clarification before issue creation
- [x] allow the operator to propose multiple scoped issue drafts for ambiguous requests
- [x] allow a teammate to confirm or reject the generated issue draft in chat
- [x] allow a teammate to edit title or summary in chat before creation
- [x] document the supported prompt styles for chat-native intake
- [x] document the unsupported or intentionally blocked prompt styles for chat-native intake

## Phase 13: Release Docs And Public Usability

- [x] publish a support matrix:
  - repo shapes that are safe today
  - repo shapes that are experimental
  - repo shapes that are unsupported
- [x] publish a policy document:
  - autonomous execution policy
  - merge policy
  - escalation policy
  - rerun policy
- [x] publish a release runbook:
  - first install
  - first proof
  - promotion
  - rollback
  - disaster recovery
- [x] publish a troubleshooting guide:
  - webhook failures
  - provider pauses
  - queue stalls
  - worktree conflicts
  - model inventory problems
  - Feishu binding problems
- [x] publish a "what this is not" section so operators do not over-trust the tool
- [x] publish known limits for large changes, secrets work, permissions changes, and infrastructure work
- [x] publish a sample operator config for an external repo
- [x] publish a sample CI or automation integration that consumes machine-readable contracts

## Phase 14: Security And Operational Hygiene

- [x] document secret handling expectations for operator hosts
- [x] document least-privilege GitHub token expectations
- [x] document least-privilege Feishu app expectations
- [x] document redaction expectations for stored workflow diagnostics
- [x] review saved run artifacts for accidental sensitive data leakage
- [x] review chat-surface status output for accidental sensitive data leakage
- [x] define retention expectations for old workflow artifacts
- [x] define retention expectations for operator queue and snapshot state
- [x] define retention expectations for validation-pool history

## Phase 15: Completion Sweep

- [x] verify every item in this checklist that should be `[x]` is reflected in docs and machine-readable output
- [x] verify every remaining `[ ]` item is either still real or intentionally removed
- [x] verify the README reading order still points to the right canonical documents
- [x] verify the release docs are internally consistent
- [x] verify the promotion docs match the actual commands used by the operator
- [x] verify the rollback docs match the actual commands used by the operator
- [x] verify the machine-readable contracts match real command output
- [x] verify the current live proof matrix is recorded in dev logs and long-term docs
- [x] verify a fresh AI session can resume work from docs and memory without hidden context

## Immediate Next Queue

These are the next narrow slices that should be consumed from the current state.

- [x] implement `#107` for `issueRepo`
- [x] implement `#108` for `issueOwner`
- [x] implement `#109` for `workspaceBaseBranch`
- [x] implement `#110` for `workspaceBranchName`
- [x] implement `#111` for `workspaceRepoRoot`
- [x] implement `#112` for `workspacePreparedAt`
- [x] implement `#113` for `workspaceWorktreePath`
- [x] implement the workspace convenience mirrors for `workspaceHasPreparedAt`
- [x] implement the workspace convenience mirrors for `workspaceHasWorktreePath`
- [x] implement the workspace convenience mirrors for `workspaceRepoRootPresent`
- [x] implement the workspace convenience mirrors for `workspaceBranchMatchesIssue`
- [x] implement `#114` for `runCreatedAt`
- [x] implement `#115` for `runUpdatedAt`
- [x] implement `#116` for `issueNumber`
- [x] implement `#117` for `issueUrl`
- [x] implement `#118` for `issueLabelCount`
- [x] implement `#119` for `issueHasLabels`
- [x] implement `#120` for `publishedPullRequestUrl`
- [x] replenish the command-layer validation pool with the next low-risk string mirror
- [x] implement `#121` for `publishedPullRequestBaseBranch`
- [x] implement `#122` for `publishedPullRequestBranchName`
- [x] implement `#123` for `publishedPullRequestTitle`
- [x] implement `#124` for `publishedPullRequestBody`
- [x] implement `#126` for `publishedPullRequestHasNumber`
- [x] implement `#127` for `publishedPullRequestHasUrl`
- [x] implement `#128` for `publishedPullRequestHasOpenedAt`
- [x] implement `#129` for `publishedPullRequestHasTitle`
- [x] implement the next published-PR convenience mirror for `publishedPullRequestHasBody`
- [x] implement the draft-PR convenience mirrors for `draftPullRequestHasNumber`
- [x] implement the draft-PR convenience mirrors for `draftPullRequestHasUrl`
- [x] implement the draft-PR convenience mirrors for `draftPullRequestHasOpenedAt`
- [x] implement the draft-PR convenience mirrors for `draftPullRequestHasTitle`
- [x] implement the draft-PR convenience mirrors for `draftPullRequestHasBody`
- [x] implement the issue convenience mirrors for `issueHasBody`
- [x] implement the issue convenience mirrors for `issueBodyLength`
- [x] implement the issue convenience mirrors for `issueTitleLength`
- [x] implement the build convenience mirrors for `buildSummary`
- [x] implement the build convenience mirrors for `buildSummaryPresent`
- [x] implement the build convenience mirrors for `changedFilesPresent`
- [x] implement the build convenience mirrors for `testCommandsPresent`
- [x] implement the build convenience mirrors for `testResultsPresent`
- [x] implement the build convenience mirrors for `notesPresent`
- [x] implement the build convenience mirror for `changedFileListStable`
- [x] implement the scope convenience mirrors for `scopeBlockedFilesPresent`
- [x] implement the scope convenience mirrors for `scopeBlockedFirstFile`
- [x] implement the scope convenience mirrors for `scopeBlockedLastFile`
- [x] implement the verification convenience mirror for `verificationSummaryPresent`
- [x] implement the verification convenience mirror for `verificationDecisionIsApprove`
- [x] implement the verification convenience mirror for `verificationDecisionIsRequestChanges`
- [x] implement the verification convenience mirror for `verificationDecisionIsEscalate`
- [x] implement the verification convenience mirrors for `verificationFindingsPresent`
- [x] implement the verification convenience mirrors for `verificationMissingCoveragePresent`
- [x] implement the verification convenience mirrors for `verificationFollowUpsPresent`
- [x] implement the suitability convenience mirrors for `suitabilitySummaryPresent`
- [x] implement the suitability convenience mirrors for `suitabilityReasonsPresent`
- [x] implement the suitability convenience mirrors for `suitabilityDecisionIsAutoRun`
- [x] implement the suitability convenience mirrors for `suitabilityDecisionIsNeedsHumanReview`
- [x] implement the suitability convenience mirrors for `suitabilityDecisionIsEscalate`
- [x] keep `run-json-contract.md` aligned with each new top-level field
- [x] keep `development-plan.md` and `full-program-roadmap.md` aligned with the latest pool state
- [x] decide whether the next productization slice after the current command-layer queue should be:
  - chat-native draft confirmation
  - fallback-model live proof
  - fresh-host external install proof
  - release-facing docs
