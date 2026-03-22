# Third-Party Skill Evaluation

This note captures the current evaluation of selected skills from
`mattpocock/skills` and whether they should be absorbed into
`openclawcode`.

Source repo cloned locally at:

- `/home/zyr/pros/skills`

## Summary

The most relevant skills are the ones that strengthen the existing
`openclawcode` blueprint -> work-item -> issue -> execution chain.

Recommended priority:

1. `tdd`
2. `prd-to-plan`
3. `prd-to-issues`
4. `triage-issue`
5. `write-a-prd`
6. `request-refactor-plan`
7. `improve-codebase-architecture`

Do not import these skills verbatim. The right move is to absorb their
decision rules and interaction patterns into existing `openclawcode`
surfaces.

## Time Horizon

### Short-Term

These are the highest-value near-term imports because they directly improve
the existing blueprint -> issue -> execution path:

- `tdd`
- `prd-to-plan`
- `prd-to-issues`
- `triage-issue`

Short-term intent:

- improve execution policy
- improve work-item and issue shaping
- improve bug-intake quality

### Medium-Term

These are valuable once the main autonomy path is steadier and the product
needs stronger requirement intake and controlled structural work:

- `write-a-prd`
- `request-refactor-plan`

Medium-term intent:

- improve structured feature intake
- improve safe refactor planning

### Long-Term

These are more useful as governance and codebase-quality layers after the
core operator loop is more mature:

- `improve-codebase-architecture`

Long-term intent:

- deepen shallow orchestration modules
- improve AI navigability and testability
- reduce future coordination and maintenance cost

## High-Value Skills To Absorb

### `prd-to-issues`

Why it fits:

- `openclawcode` already has:
  - blueprint capture
  - work-item decomposition
  - next-work selection
  - issue materialization
- this skill is directly aligned with converting a high-level product request
  into thin, independently executable vertical slices

Best use inside `openclawcode`:

- treat it as the policy layer above issue generation
- use its tracer-bullet rules to improve blueprint -> work-item -> issue
  decomposition
- preserve AFK/HITL distinctions as future execution metadata

Recommended integration direction:

- feed blueprint-backed workstreams into issue slicing
- keep each generated issue demoable and end-to-end
- avoid horizontal front-end / back-end / tests-only slices

### `prd-to-plan`

Why it fits:

- it improves the phase between product intent and work-item generation
- it emphasizes tracer-bullet vertical slices instead of layer-by-layer plans
- that matches `openclawcode`'s need for thin, autonomous execution units

Best use inside `openclawcode`:

- apply it between blueprint authoring and work-item decomposition
- use it to produce better phase boundaries for multi-step work

Recommended integration direction:

- absorb its vertical-slice planning rules into blueprint planning
- keep durable decisions separate from volatile implementation details
- use it to prevent over-large or vague workstreams

### `tdd`

Why it fits:

- this is the cleanest execution-policy import for `openclawcode`
- it already matches the desired run loop:
  - small slices
  - observable behavior
  - test-first or test-guided implementation
  - refactor only after green

Best use inside `openclawcode`:

- coder prompt policy
- verifier prompt policy
- issue acceptance and completion policy

Recommended integration direction:

- bias execution toward one vertical slice at a time
- verify via public behavior, not internal implementation details
- keep red-green-refactor as the preferred implementation loop

### `triage-issue`

Why it fits:

- `openclawcode` already supports GitHub/chat issue intake
- what is still valuable is a stronger path for vague bug reports:
  - investigate
  - identify root cause
  - create a better-scoped issue
  - attach a TDD-oriented fix plan

Best use inside `openclawcode`:

- bug intake from chat
- bug intake from GitHub issues that are too vague to execute safely

Recommended integration direction:

- add a root-cause triage mode before execution when the issue is underspecified
- generate stronger issue bodies for bug-fix work
- treat triage as a pre-execution shaping step, not just a docs feature

### `request-refactor-plan`

Why it fits:

- `openclawcode` itself will need controlled refactors as orchestration grows
- the skill's best idea is not the GitHub issue template, but the demand for:
  - explicit scope
  - tiny commits
  - working-state refactors

Best use inside `openclawcode`:

- refactor planning mode
- architecture cleanup requests
- internal roadmap items where risk is structural rather than feature-level

Recommended integration direction:

- use it when work is too broad for a normal execution issue
- keep the output as small-step implementation slices

### `improve-codebase-architecture`

Why it fits:

- `openclawcode` is already accumulating orchestration complexity
- this skill is specifically useful for AI-facing codebases because it looks for:
  - shallow modules
  - seam-heavy flows
  - poor testability
  - poor navigability

Best use inside `openclawcode`:

- periodic architecture review
- identifying where orchestration logic should be deepened into better modules

Recommended integration direction:

- use it for medium-term codebase governance, not the core execution loop
- target areas like:
  - `extensions/openclawcode/index.ts`
  - artifact orchestration
  - setup / queue / gate / progress / loop interactions

## Skills Worth Absorbing Carefully

### `write-a-prd`

Conclusion:

- worth adding
- should not become a second long-lived source of truth beside
  `PROJECT-BLUEPRINT.md`

Why it matters:

- it provides a structured way to interview the operator and turn a vague
  feature request into a concrete product spec
- that is highly relevant to blueprint-first onboarding and feature discovery

Why it should not be imported verbatim:

- `openclawcode` already has a canonical planning surface:
  - `PROJECT-BLUEPRINT.md`
- adding a separate PRD document model would create duplication and drift

Recommended integration direction:

- turn `write-a-prd` into a blueprint interview mode
- keep the final persisted truth in existing artifacts

Suggested mapping into the current blueprint model:

- `Problem Statement` -> `Goal`
- `Solution` -> `Scope` and `Success Criteria`
- `User Stories` -> upstream input for `Workstreams`
- `Implementation Decisions` -> `Constraints`, policy, and execution notes
- `Testing Decisions` -> acceptance and verifier strategy
- `Out of Scope` -> `Non-Goals`

Product implication:

- this should become the structured requirement intake layer for new work
- it should feed:
  - `PROJECT-BLUEPRINT.md`
  - `.openclawcode/work-items.json`
  - eventual GitHub issues

Not recommended:

- do not introduce a fully separate PRD file format as another primary source

### `grill-me`

Conclusion:

- do not import as a standalone major feature
- do absorb its questioning strategy into clarification logic

Why it matters:

- its core value is not a workflow artifact
- its value is the behavior:
  - relentlessly clarify unresolved decisions
  - walk each branch of the decision tree
  - prefer codebase exploration over unnecessary user questions

Why it should not be a first-class standalone command:

- used directly, it risks making `openclawcode` too verbose
- it can over-block autonomous progress
- it conflicts with the product goal of minimizing unnecessary operator
  interruption

Recommended integration direction:

- embed it into the clarification engine rather than exposing it as a main
  product surface

Best internal uses:

- blueprint clarification when the goal is too vague
- `blocked-on-missing-clarification` follow-up question generation
- `new-project` setup interview tightening
- work-item ambiguity resolution before issue materialization

Preferred behavior model:

- ask one high-impact question at a time
- if the repo can answer it, inspect the repo first
- only escalate to the operator when the ambiguity is genuinely product intent

Not recommended:

- do not build `/occode-grill-me` as a core operator command right now

## Skills Not Worth Prioritizing

These may be useful later, but they are not strong immediate investments for
`openclawcode`'s current roadmap:

- `design-an-interface`
  - useful for focused API design work, but not a core autonomy gap right now
- `setup-pre-commit`
  - generally useful repo hygiene, but not a product capability multiplier
- `git-guardrails-claude-code`
  - environment-specific and more relevant to Claude Code than to the product
  surface itself
- `write-a-skill`
  - useful only if `openclawcode` starts curating its own public/internal skill
  library

## Recommended Integration Order

1. absorb `tdd` into coder/verifier execution policy
2. absorb `prd-to-plan` into blueprint planning rules
3. absorb `prd-to-issues` into work-item and issue-generation policy
4. absorb `triage-issue` into bug-intake shaping
5. absorb `write-a-prd` into blueprint interview mode
6. absorb `request-refactor-plan` into structured refactor planning
7. use `improve-codebase-architecture` for periodic internal architecture review

## Short Conclusion

- `tdd`, `prd-to-plan`, `prd-to-issues`, and `triage-issue` are the most
  immediately useful imports
- `write-a-prd` should become the requirement-intake layer for blueprint-first
  work
- `grill-me` should become an internal clarification strategy, not a standalone
  operator-facing feature

## First Landed Integration Slice

The first direct absorption into `openclawcode` is now:

- blueprint clarification now exposes a single `priorityQuestion` so chat/CLI
  surfaces can lead with the highest-impact next decision
- clarification suggestions now include:
  - PRD-style user-story prompting
  - proof-oriented success-criteria prompting
  - warnings for layer-only workstreams
  - bug-triage prompts
  - refactor-safety prompts
- blueprint-derived work items now classify execution mode as:
  - `feature`
  - `bugfix`
  - `refactor`
  - `research`
- blueprint-derived GitHub issue drafts now carry:
  - vertical-slice delivery policy
  - TDD-oriented testing policy
  - bug-triage expectations for fixes
  - refactor guardrails for structural changes

The second direct absorption into `openclawcode` is now:

- chat intake now classifies one-line requests as:
  - `feature`
  - `bugfix`
  - `refactor`
  - `research`
- synthesized intake drafts now use mode-specific scaffolds instead of one
  generic body
  - bug-fix drafts ask for observed behavior, expected behavior, reproduction,
    and regression proof
  - refactor drafts ask for invariant behavior and safe checkpoints
  - research drafts ask for evidence and an executable exit condition
- pending intake replies now lead with the highest-value next question for the
  detected work type
- issue materialization now preserves execution mode in the artifact and uses
  the full blueprint-derived issue draft body during suitability precheck
  instead of evaluating only the title

Why this matters:

- it absorbs the useful part of `triage-issue` into chat-native bug shaping
- it absorbs the useful part of `request-refactor-plan` into intake and issue
  generation without creating another parallel planning document

The third direct absorption into `openclawcode` is now:

- next-work selection now carries `executionMode` through the selected
  candidate
- execution mode now affects autonomy policy:
  - `feature`
    - can remain `ready-to-execute`
  - `bugfix`
    - can remain autonomous, but with explicit regression-proof guidance
  - `refactor`
    - now pauses at `execution-start`
  - `research`
    - now pauses at `execution-start`
- stage-gate derivation now uses execution mode to explain *why* a work item is
  paused, instead of treating every selected item as equally safe

Why this matters:

- it pushes `request-refactor-plan` beyond issue text and into actual control
  flow
- it prevents structural work from being treated like routine tracer-bullet
  feature slices

The fourth direct absorption into `openclawcode` is now:

- project-progress and autonomous-loop artifacts now carry:
  - `selectedWorkItemExecutionMode`
  - `nextWorkBlockingGateId`
  - `nextWorkPrimaryBlocker`
- chat and CLI progress surfaces now explain not only that work is blocked, but
  which gate is stopping it and the first blocker to resolve

Why this matters:

- it closes the operator-feedback loop for execution-mode-aware planning
- it makes refactor/research pauses legible in normal status views instead of
  only inside raw stage-gate artifacts

## Additional Framework Evaluation

This second evaluation pass covers broader agent-engineering repos rather than
single skills:

- `obra/superpowers`
- `affaan-m/everything-claude-code`

Local research clones used for this review:

- `/tmp/openclaw-research/superpowers`
- `/tmp/openclaw-research/everything-claude-code`

These repos are not direct drop-in dependencies for `openclawcode`. The value
is in extracting workflow and operational patterns that strengthen the existing
blueprint-first operator.

## What `superpowers` Gets Right

`superpowers` is most useful as a workflow-discipline reference, not as a
feature catalog.

Strongest ideas:

- do not jump from vague request directly into code
- make `brainstorm -> spec -> plan -> code -> review` explicit
- treat TDD and review as required execution stages rather than optional style
- keep workflow skills small and composable instead of hiding everything inside
  one giant prompt

Why this matters for `openclawcode`:

- `openclawcode` already has:
  - blueprint discussion
  - work-item decomposition
  - plan approval
  - stage gates
  - handoff persistence
- the remaining gap is not missing primitives; it is making the pre-code stages
  more consistently enforced and legible to operators

Recommended absorption:

- strengthen the no-code-before-approved-plan contract
- tighten TDD-first behavior for implementation work, especially bugfixes and
  narrow feature slices
- expose smaller reusable workflow skills or runtime roles for planner, coder,
  verifier, and reviewer behavior
- use the blueprint/chat intake surfaces as the equivalent of
  `brainstorm -> spec`, rather than inventing a parallel planning system

Not worth copying directly:

- deprecated or wrapper-style command shells
- any repo-specific command naming that does not map cleanly onto the existing
  `openclawcode` command surface

## What `everything-claude-code` Gets Right

`everything-claude-code` is more useful as an operator-harness reference than
as a product-workflow reference.

Strongest ideas:

- clear command -> capability -> agent mapping
- explicit quality-gate behavior
- continuous learning from repeated fixes and failures
- token and context budgeting as a first-class engineering concern
- harness and loop auditing so a stalled run explains *why* it is stalled

Why this matters for `openclawcode`:

- `openclawcode` already has the core autonomy loop, but several operator
  surfaces still depend on log reading or developer context when something goes
  wrong
- the next product gains should make the system more self-explanatory and more
  repeatable under long-lived autonomous use

Recommended absorption:

- add a compact repo-local quality-gate surface that summarizes lint, type,
  test, coverage, and security outcomes for a run
- document a stable command/capability map tying together:
  - chat commands
  - CLI commands
  - workflow artifacts
  - runtime roles
- turn repeated operator incidents into durable learning artifacts and guidance
- surface loop-health, stall-reason, and context-budget diagnostics through
  normal operator channels instead of raw traces only

Not worth copying directly:

- the very large generic command catalog
- harness-specific hook mechanics that do not fit the OpenClaw plugin/runtime
  model
- broad framework abstractions that add surface area without directly reducing
  operator friction

## Best Cross-Repo Imports For `openclawcode`

The highest-value ideas from these two repos are:

1. mandatory pre-code stage discipline
2. a first-class quality-gate summary
3. a stable command/capability map
4. continuous learning and pattern extraction from real operator incidents
5. loop-health and context-budget diagnostics

These are good fits because they strengthen the current product direction
without replacing its architecture:

- keep `PROJECT-BLUEPRINT.md` as the canonical planning artifact
- keep `openclawcode`'s existing issue/workflow engine as the execution layer
- improve operator visibility, execution discipline, and repeatability on top
  of that base

## Priority Order

Recommended integration order from this second evaluation pass:

1. add a compact `quality gate` surface shared by chat and CLI
2. add continuous learning / pattern-extraction from run failures and manual
   repairs
3. publish a stable command/capability map for operators and future refactors
4. harden mandatory pre-code stage discipline on top of existing blueprint and
   plan approval behavior
5. surface loop-stall and context-budget diagnostics in normal operator status

## Short Conclusion

- `superpowers` is most worth absorbing as a development-method discipline
- `everything-claude-code` is most worth absorbing as an operator and harness
  hardening reference
- `openclawcode` should not copy either repo wholesale
- the right move is to absorb the smallest set of ideas that directly improve:
  - operator visibility
  - execution discipline
  - run repeatability
  - autonomous failure recovery
