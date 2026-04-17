# Development Plan: Pre-Code Blueprint Alignment

## Purpose

This document defines how `openclawcode` should evolve from having
blueprint-first primitives into behaving like a highly experienced engineering
partner that proactively guides the operator to an agreed blueprint before any
code-writing work begins.

The target behavior is not:

- user gives a vague request
- system waits for a fully formed issue
- coding starts too early

The target behavior is:

- user gives a goal, symptom, or rough instinct
- system inspects repo context first
- system proposes a default direction
- system asks only the questions that materially change scope, architecture, or
  proof
- system updates a visible draft blueprint while the conversation is happening
- system reaches an explicit agreement checkpoint
- only then does issue projection or coding begin

This is the missing front-end behavior layer for the existing
blueprint-first control plane.

## Why This Matters

`openclawcode` already has many of the downstream mechanics:

- `PROJECT-BLUEPRINT.md`
- `openclaw code recommend`
- `openclaw code spec-draft`
- `openclaw code blueprint-clarify`
- `openclaw code blueprint-set-status --status agreed`
- work-item decomposition
- stage gates and explicit plan-approval checks

What is still weaker than it should be is the operator experience before code:

- a vague request can still feel like "now I must manually shape the spec"
- clarification is present, but not yet a first-class proactive agreement loop
- the system can recommend, but does not yet consistently drive the
  conversation toward blueprint agreement
- terminology can drift across chat, blueprint, and issue drafts
- there is not yet one compact artifact that explains:
  - what the system thinks the user wants
  - what approach it recommends
  - what is still unresolved
  - what exact agreement is needed before coding

The product should feel like a senior engineer who reduces ambiguity, not a
polite issue form.

## Product Goal

Before code starts, `openclawcode` should be able to turn an underspecified
request into an agreed blueprint through a compact, high-signal conversation.

Success means:

- the user does not need to hand-author a full implementation plan
- the system makes a recommendation instead of only collecting input
- only high-value questions are asked
- each answer updates visible blueprint state
- agreement is explicit and reviewable
- coding remains blocked until the blueprint is materially aligned

## Borrowed Patterns From `mattpocock/skills`

The relevant source repo is:

- `https://github.com/mattpocock/skills`

The most relevant skills are not templates to import directly. They are
behavior and workflow references to absorb into `openclawcode`'s existing
artifacts and chat surfaces.

### `write-a-prd`

Borrow:

- start from the user's problem, not from a guessed implementation
- inspect the repo before asking avoidable questions
- interview until the plan is actually understood
- sketch modules and test boundaries before implementation

Adaptation for `openclawcode`:

- do not create a second persistent PRD source of truth
- map the interview output into `PROJECT-BLUEPRINT.md`
- treat module/test discussions as blueprint-supporting rationale, not a
  parallel document model

### `prd-to-plan`

Borrow:

- identify durable decisions before slicing implementation
- prefer thin tracer-bullet vertical slices
- keep plans end-to-end and demoable

Adaptation for `openclawcode`:

- use this discipline while moving from agreed blueprint to work items
- keep the durable parts inside the blueprint and the executable slices inside
  repo-local work-item artifacts

### `prd-to-issues`

Borrow:

- create independently executable vertical slices
- distinguish dependency order clearly
- make the granularity reviewable before execution

Adaptation for `openclawcode`:

- use issue projection only after blueprint agreement
- keep issue drafts derived from work items, not from raw chat alone

### `grill-me`

Borrow:

- walk the design tree until the real decision points are resolved
- ask one high-impact question at a time
- prefer repo exploration over unnecessary user interruption

Adaptation for `openclawcode`:

- this should become the agreement-loop questioning strategy
- it should not become a standalone operator-visible "grill me" product mode
- questioning should remain compact and recommendation-first

### `ubiquitous-language`

Borrow:

- define canonical terms early
- identify ambiguous or overloaded language
- keep terminology consistent across conversation and artifacts

Adaptation for `openclawcode`:

- use a lightweight repo-local glossary when terms drift or product language is
  new
- make terminology alignment part of blueprint agreement for larger work

### `tdd`

Borrow:

- behavior-first proof
- red -> green -> refactor discipline
- verify public behavior, not internal implementation details

Adaptation for `openclawcode`:

- this belongs after blueprint agreement as execution policy
- it should influence acceptance criteria and proof-of-success wording during
  alignment, but not dominate the pre-code conversation

### `triage-issue`

Borrow:

- investigate before asking too many follow-up questions
- identify root cause and shape a better execution target

Adaptation for `openclawcode`:

- when the user reports a bug, the pre-code agreement loop should infer whether
  this is a bugfix path and then ask for reproduction/proof only if repo
  context cannot answer it

### `request-refactor-plan`

Borrow:

- explicit scope
- preserved invariants
- tiny safe steps

Adaptation for `openclawcode`:

- when the request is structural, the agreement loop should steer toward
  refactor-specific scope and invariant questions before coding is allowed

## Product Thesis

`openclawcode` should treat pre-code alignment as its own first-class product
loop:

`goal -> repo-informed recommendation -> focused clarification -> blueprint draft -> agreement checkpoint -> work items -> execution`

This should reuse existing artifacts instead of inventing a separate planning
stack.

The canonical persisted truth remains:

- `PROJECT-BLUEPRINT.md`
- `.openclawcode/work-items.json`
- `.openclawcode/stage-gates.json`

The missing layer is the live agreement process that gets the operator there
with less friction and more technical judgment.

## Proposed UX Contract

For an underspecified request, the default system response should be:

1. inferred goal
2. recommended approach
3. when to choose a different approach
4. the single highest-value next question
5. the blueprint sections that will change if the user agrees

Example shape:

- I think you want the product to do `X`.
- I recommend `A` because it keeps `B` stable and makes `C` measurable.
- If `D` is true, switch to `E` instead.
- The biggest unresolved decision is `F`.
- If you agree so far, I will update the draft blueprint's `Goal`,
  `Success Criteria`, and `Scope` sections.

This must feel opinionated and forward-moving, not like a questionnaire.

## Proposed Agreement Model

Before code, the system should drive the user toward explicit alignment across
these dimensions:

### 1. Goal

- what outcome the user actually wants
- which actor benefits
- why this matters now

### 2. Success Proof

- what operator-visible or user-visible evidence proves success
- what would count as "good enough" for the first slice

### 3. Scope

- what is included in the first delivery slice
- what is deliberately not included

### 4. Constraints

- rollout limits
- compatibility requirements
- channel, repo, provider, or platform restrictions

### 5. Risk Shape

- whether the request is a feature, bugfix, refactor, or research path
- whether architecture, public contracts, data, auth, or deletion are touched

### 6. Terminology

- which terms are canonical
- which terms are overloaded or ambiguous

### 7. Handoff Readiness

- whether the blueprint is ready to be agreed
- whether issue projection or spec drafting is the next best step

The agreement loop should stop asking questions once the unresolved decisions no
longer materially change the recommended first slice.

## Proposed Artifact Additions

The existing blueprint remains canonical, but the pre-code loop needs one
supporting repo-local artifact:

- `.openclawcode/blueprint-alignment.json`

This should capture the live front-end state before agreement:

- request summary and input class
- recommended default approach
- meaningful alternatives with switching conditions
- current unresolved questions
- answered clarifications
- canonical terminology candidates
- affected blueprint sections
- confidence and readiness summary
- explicit next recommended action

This artifact should be short-lived and easy to discard once the blueprint is
agreed, but durable enough that a long chat does not lose planning context.

## Proposed Command And Chat Surface

The plan should reuse existing commands where possible and add only the minimum
new surface.

### Reused surfaces

- `openclaw code recommend`
- `openclaw code spec-draft`
- `openclaw code blueprint-clarify`
- `openclaw code blueprint-set-status --status agreed`
- `/occode-blueprint`
- `/occode-blueprint-edit`
- `/occode-blueprint-agree`

### New recommended surfaces

- `openclaw code blueprint-align`
  - starts or refreshes the alignment loop from a raw user request
- `openclaw code blueprint-align-show`
  - shows the current pre-code agreement state
- `openclaw code blueprint-align-answer`
  - records a clarification answer and recomputes recommendation/readiness
- `openclaw code blueprint-terms-show`
  - exposes the currently accepted canonical terminology when the request needs
    it

Chat equivalents should follow the same model:

- `/occode-align`
- `/occode-align-answer`
- `/occode-terms`

The command surface should stay narrow. The important thing is the behavior, not
the number of verbs.

## Internal Decision Engine

The agreement engine should run in this order:

### Step 1: Classify input shape

Classify the request as:

- goal-only
- problem
- partial-solution
- execution-ready
- bugfix
- refactor
- research

### Step 2: Inspect repo and current blueprint

Before asking questions:

- inspect the current repo state
- read `PROJECT-BLUEPRINT.md` if it exists
- read work-item and gate artifacts if they exist
- infer whether the request is extending, correcting, or replacing current
  direction

### Step 3: Produce a default recommendation

Always produce:

- one default path
- zero to two alternatives only when materially different
- concrete reasons and switching conditions

### Step 4: Ask the highest-value next question

Choose the single question that most changes:

- architecture
- scope
- success proof
- rollout risk
- public contract shape

### Step 5: Update blueprint draft state

Each accepted answer should update a visible draft summary for:

- `Goal`
- `Success Criteria`
- `Scope`
- `Non-Goals`
- `Constraints`
- `Risks`
- `Assumptions`
- `Open Questions`

### Step 6: Decide readiness

The loop should decide whether the blueprint is:

- still exploratory
- needs one more key decision
- ready for explicit agreement
- ready for decomposition into work items

## Recommended Rollout Slices

### Slice 1: Shared pre-code alignment artifact

Deliver:

- `.openclawcode/blueprint-alignment.json`
- CLI surface to create/show the artifact
- machine-readable recommendation, questions, and readiness summary

Why first:

- this creates one explicit state layer for the new behavior
- chat and CLI can both reuse it

### Slice 2: Recommendation-first agreement loop

Deliver:

- raw request -> inferred goal -> recommended approach -> one critical question
- repo-first questioning rules
- mode-specific question heuristics for:
  - feature
  - bugfix
  - refactor
  - research

Why second:

- this is the first user-visible behavior change
- it directly absorbs `grill-me`, `write-a-prd`, and `triage-issue`

### Slice 3: Draft blueprint mutation from alignment state

Deliver:

- accepted alignment answers map into blueprint section updates
- diff-like preview of what changed in the blueprint draft
- explicit "ready to agree" signal

Why third:

- it closes the loop between conversation and persistent artifact
- it prevents chat-only planning drift

### Slice 4: Terminology alignment

Deliver:

- lightweight ubiquitous-language extraction for ambiguous requests
- canonical term suggestions
- flagged alias collisions

Why fourth:

- this is high-value but should stay optional
- only larger or domain-heavy projects need it

### Slice 5: Agreement gate hardening

Deliver:

- stronger readiness logic before `blueprint-set-status --status agreed`
- explicit blockers such as:
  - unresolved success proof
  - multiple competing goals
  - unresolved scope split
  - risky public-contract ambiguity
- operator-visible explanation for why coding is still blocked

Why fifth:

- this prevents premature execution
- it turns pre-code discipline into a durable product contract

### Slice 6: Work-item and execution-spec handoff

Deliver:

- agreed alignment state feeds directly into:
  - `spec-draft`
  - blueprint decomposition
  - issue materialization
- preserve rationale for why the chosen slice was recommended

Why sixth:

- this turns alignment into execution without manual restatement

## UX Rules

The system should follow these rules consistently:

- inspect the repo before asking avoidable questions
- ask one high-value question at a time
- give a recommendation before giving homework
- update visible draft state after each meaningful answer
- prefer agreement on the first slice, not on every future possibility
- do not force a giant PRD ritual for small requests
- do not open coding just because some text exists in the blueprint

## Validation Strategy

The feature should be considered successful only if it can prove these flows:

### Flow 1: Goal-only request

Input:

- "Make the setup flow feel smarter."

Proof:

- system infers likely product goal
- system recommends a default path
- system asks one critical question
- blueprint draft sections update
- agreement can be recorded without the user writing a manual issue

### Flow 2: Bug report

Input:

- "Users give vague requests and the bot stalls."

Proof:

- system recognizes bug/problem framing
- system asks for reproduction/proof only when repo context is insufficient
- blueprint or execution-spec draft reflects bugfix shape

### Flow 3: Refactor request

Input:

- "We should probably clean up the orchestration layer."

Proof:

- system does not allow generic coding start
- system asks for invariant behavior and scope boundaries
- stage-gate readiness stays blocked until those are explicit

### Flow 4: Existing repo with current blueprint

Input:

- operator revisits an existing agreed blueprint with a new direction

Proof:

- system detects current blueprint state
- system identifies what changes versus what stays stable
- agreement is revision-aware, not full-reset by default

## Open Questions

These should be resolved during implementation, not before approving this plan:

- should ubiquitous-language persist as a separate file or stay embedded in the
  alignment artifact until agreement
- should the alignment artifact survive blueprint agreement for audit purposes
  or be reduced to a small historical summary
- should `recommend` and `spec-draft` be folded into `blueprint-align`, or
  should they remain separate commands backed by the same internal engine

## Recommended First Delivery Sequence

The recommended near-term implementation order is:

1. land `.openclawcode/blueprint-alignment.json` and a machine-readable CLI
   surface
2. teach the engine to emit a recommendation plus a single next question from a
   raw request
3. connect accepted answers to draft blueprint section updates
4. harden the readiness rules that control "ready to agree"
5. expose the same loop through chat-native `/occode-*` commands
6. only after that, extend glossary support and richer alternatives

## Bottom Line

The feature should not be "ask more questions before coding."

The feature should be:

- infer the user's real goal
- recommend the best path like a senior engineer would
- ask only the few questions that change the design
- turn the answers into a visible draft blueprint
- require explicit agreement before coding

That is the missing product behavior between today's recommendation surfaces and
the existing blueprint-first execution engine.
