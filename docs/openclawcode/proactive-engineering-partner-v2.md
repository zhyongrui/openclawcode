# OpenClawCode Proactive Engineering Partner V2

## Purpose

This document defines the next product step for `openclawcode` after the
current issue-driven MVP.

The goal is not to replace the existing execution engine.

The goal is to add a stronger front-end behavior layer so the product behaves
less like a passive issue runner and more like a highly experienced software
engineering partner.

The intended evolution is:

`user goal -> clarification -> recommendation -> execution spec -> implementation -> verification -> PR / review`

instead of only:

`issue -> implementation -> verification -> PR / review`

## Product Positioning

`openclawcode` should act like a senior or staff-level engineer who:

- quickly identifies what the user is actually trying to achieve
- asks a small number of high-value clarification questions when needed
- recommends an implementation path instead of waiting for full instructions
- explains when a different path would be better
- then turns the agreed direction into executable work

The product should feel:

- proactive
- opinionated
- technically strong
- bounded by clear policy

It should not feel:

- passive
- endlessly inquisitive
- generic
- overconfident about ambiguous requests

## Core Thesis

The system should not treat every user input as already-formed execution input.

In many real software conversations, the human provides:

- a desired outcome
- a symptom
- a rough instinct
- a partial solution

and expects the stronger engineer in the room to do the rest:

- infer the likely real problem
- propose the best implementation path
- identify tradeoffs
- ask only the missing questions that materially affect the solution

That is the behavior `openclawcode` should adopt.

## What Changes In V2

V1 core loop:

- receive issue
- judge suitability
- plan
- implement
- verify
- open draft PR

V2 core loop:

- receive user goal, issue, or partial request
- classify input shape
- clarify only what is missing
- recommend one default approach and optional alternatives
- explain recommendation conditions
- convert the recommendation into an execution spec or issue
- run the existing implementation / verification loop

The existing issue-driven engine remains the delivery core.

V2 adds a stronger discovery and recommendation layer in front of it.

## Input Classes

The first new capability is recognizing what kind of input the operator gave.

### 1. Goal-Only Input

Examples:

- "Make it more proactive"
- "I want the setup flow to feel smarter"
- "Can this help users decide how to implement features?"

System behavior:

- infer the likely product problem
- propose one recommended implementation direction
- ask a few missing questions only if needed

### 2. Problem Input

Examples:

- "Operators do not know what to ask for"
- "Users give vague requests and the bot stalls"
- "It can execute issues, but it does not guide product decisions"

System behavior:

- identify likely root causes
- propose fixes at the interaction and architecture levels
- explain recommended first slice

### 3. Partial-Solution Input

Examples:

- "Maybe we need a recommendation engine"
- "Maybe add a planner before issue creation"
- "Maybe make it ask follow-up questions"

System behavior:

- evaluate the proposed direction
- improve it, narrow it, or reject it
- explain what conditions make it the right choice

### 4. Execution-Ready Input

Examples:

- "Implement issue #12345"
- "Add `foo` to `openclaw code run --json`"

System behavior:

- skip most discovery
- confirm assumptions only if risk is non-trivial
- move directly into execution

## The New Interaction Contract

The product should default to a compact but structured response model.

For underspecified requests, the default output should have five parts:

1. inferred goal
2. recommended approach
3. when to choose a different approach
4. critical questions
5. next execution step

Example shape:

- I think you want X.
- I recommend approach A because of B.
- If condition C is true, choose approach D instead.
- I still need answer E before implementation.
- If you agree, I will turn this into a spec / issue / implementation slice.

This should become the standard behavior for chat-native product and technical
discussions.

## Recommendation Engine Behavior

The recommendation layer is the heart of V2.

It should always try to produce:

- one default recommendation
- one or two alternatives only when meaningful
- explicit switching conditions

The product should not dump a flat list of options without judgment.

### Default Recommendation

The system should say which path it would choose if it were the responsible
engineer on the project.

Examples:

- recommend the smallest safe patch when speed matters
- recommend extracting a shared seam when reuse is likely
- recommend a compatibility layer when contracts are already public
- recommend a spec-first path when ambiguity is still too high

### Conditional Alternatives

Alternatives should only appear when they are materially different.

Good alternative framing:

- If this is a one-off fix, use A.
- If this will spread across several providers, use B.
- If the interface is public and already depended on, use C.

Bad alternative framing:

- "You could do A, B, C, D, or E."

### Tradeoff Explanation

Tradeoffs should be explicit and concrete.

Examples:

- A is faster, but creates duplication.
- B is slower now, but reduces future merge friction.
- C is safer for compatibility, but leaves more legacy code in place.

## When To Ask Questions

V2 should ask fewer but better questions.

The rule is:

- ask only when the answer changes architecture, risk, cost, or scope
- do not ask for information that can be inferred from the repo
- do not ask multiple low-value questions just to look thoughtful

### Ask Immediately When

- success criteria are unclear
- the request mixes multiple goals
- the choice affects architecture or public contracts
- the task may touch security, auth, migration, or deletion surfaces
- the expected implementation path depends on rollout constraints

### Do Not Ask First When

- repo context already strongly suggests the right path
- the change is narrow and low risk
- the user already expressed a preference
- the clarification would not materially change the plan

## Modes

V2 should explicitly support three operator-facing modes.

### 1. Discover Mode

Used when the user is exploring a problem or desired product outcome.

Behavior:

- infer intent
- recommend approach
- ask a few key questions
- stop before coding unless the user asks to proceed

### 2. Spec Mode

Used when the user wants the direction turned into a concrete task.

Behavior:

- convert discussion into a structured execution spec
- define acceptance criteria
- define non-goals
- define first implementation slice

### 3. Build Mode

Used when the task is already concrete enough to implement.

Behavior:

- run the existing issue / worktree / verification loop

These modes can be explicit in CLI and chat, or inferred from context.

## Internal Object Model

V2 should introduce a normalized front-end object before issue execution.

Recommended object:

```ts
type RecommendationSpec = {
  sourceKind: "goal" | "problem" | "partial-solution" | "issue" | "direct-task";
  userGoal: string;
  inferredProblem?: string;
  recommendedApproach: {
    summary: string;
    rationale: string;
    implementationShape: "patch" | "refactor" | "new-slice" | "spec-first" | "research";
  };
  alternatives: Array<{
    summary: string;
    chooseWhen: string;
    tradeoff: string;
  }>;
  openQuestions: Array<{
    question: string;
    whyItMatters: string;
    blocking: boolean;
  }>;
  acceptanceCriteriaDraft: string[];
  nonGoalsDraft: string[];
  nextStep: "ask-user" | "draft-spec" | "create-issue" | "start-build";
};
```

This object should become the bridge between chat-native discussion and the
existing issue-driven execution engine.

## CLI And Chat Surface Changes

The product should expose this new layer directly.

### Chat

Add a conversation path where the operator can say things like:

- "I want to build X"
- "What is the best way to implement Y?"
- "Should this be a refactor or a new subsystem?"

The response should be recommendation-first, not issue-first.

### CLI

Add a command family such as:

- `openclaw code recommend`
- `openclaw code spec-draft`
- `openclaw code ask`

Example:

```bash
openclaw code recommend "Make openclawcode feel like a senior engineer in chat"
```

Expected output:

- inferred goal
- recommended approach
- alternatives
- critical questions
- suggested first slice

Then:

```bash
openclaw code spec-draft "Make openclawcode feel like a senior engineer in chat"
```

would produce a structured execution artifact that can later be confirmed,
edited, issue-ified, or executed.

## Policy Rules For Proactivity

Proactivity must stay bounded.

Recommended policy:

- proactive recommendation is always allowed
- proactive clarification is allowed when it stays inside the current repo and
  project context
- proactive issue drafting is allowed
- proactive execution still requires the same suitability and policy gates as
  today

This distinction matters.

The system should become more proactive in reasoning and suggestion before it
becomes more proactive in taking irreversible actions.

## Recommendation Heuristics

The system should route recommendations using explicit heuristics.

### Prefer Patch

When:

- bug is narrow
- behavior is already correct elsewhere
- low fan-out
- no contract change

### Prefer Refactor

When:

- duplication already exists
- same logic appears in multiple modules
- future changes will likely touch the same seam again

### Prefer New Slice

When:

- request introduces new user-visible capability
- there is no stable existing seam
- the product needs a new bounded subsystem

### Prefer Spec-First

When:

- request is broad
- scope is ambiguous
- architecture tradeoffs are real
- execution without agreement would create churn

### Prefer Research

When:

- root cause is still unclear
- evidence conflicts
- external system behavior is uncertain

## Success Criteria

V2 succeeds if users begin to feel that `openclawcode`:

- helps them figure out what to build
- helps them choose the right implementation path
- does not require perfectly written issues
- reduces low-value back-and-forth
- still hands off to the existing execution engine cleanly

The key product metric is not "more words in chat".

The key metric is "better default technical direction with less operator effort".

## Anti-Goals

V2 should not become:

- a generic brainstorming chatbot
- a design-document factory with no execution path
- an always-ask-first assistant
- an architecture astronaut that avoids coding

The product is still an execution system.

The recommendation layer exists to make execution start from a stronger place.

## Suggested Rollout

### Phase 1: Recommendation Replies

Add recommendation-first replies for underspecified chat requests.

Deliverables:

- input classification
- recommended approach output
- alternatives with choose-when conditions
- small set of clarification prompts

### Phase 2: RecommendationSpec Artifacts

Persist recommendation outputs as structured records.

Deliverables:

- JSON schema
- CLI renderers
- chat renderers
- promotion into issue/spec drafts

### Phase 3: Spec-Draft To Execution

Allow accepted recommendations to become execution specs or issues directly.

Deliverables:

- recommendation -> spec transition
- recommendation -> issue draft transition
- recommendation -> work-item draft transition

### Phase 4: Learning Loop

Use completed runs and review outcomes to refine future recommendations.

Deliverables:

- recommended-path feedback capture
- common failure-class memory
- repo-local preference tuning

## Recommended First Implementation Slice

The smallest meaningful V2 slice is:

- add a `recommend` command and matching chat-native behavior
- support goal/problem/partial-solution classification
- output:
  - inferred goal
  - recommended approach
  - alternatives
  - open questions
  - suggested first slice
- stop short of automatic execution

This gives immediate product value while keeping risk low.

## Bottom Line

`openclawcode` should evolve from:

- an issue-driven autonomous builder

into:

- an issue-driven autonomous builder with a senior-engineer front end

That front end should:

- infer what the user really needs
- recommend the most appropriate implementation path
- explain when another path is better
- ask only the questions that materially affect the decision
- then hand the result into the existing execution workflow

That is the right next step if the product is meant to feel like a genuinely
strong engineering partner rather than a passive coding bot.
