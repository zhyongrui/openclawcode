---
summary: "Comparison notes on what openclawcode can borrow from the openai/codex repository"
read_when:
  - You are evaluating Codex ideas for openclawcode
  - You want concrete borrowing guidance instead of a vague repo comparison
title: OpenAI Codex Borrowing Notes
---

# OpenAI Codex borrowing notes

This document records what is worth borrowing from the `openai/codex`
repository into `openclawcode`, and what is not worth copying.

The goal is not code transplant. The goal is to identify design choices,
operator-facing patterns, and subsystem boundaries that can improve
`openclawcode` without regressing its stronger existing platform pieces.

---

## Scope and caveats

This review was done against the local clone at:

- `/home/zyr/pros/codex`

Snapshot inspected during comparison:

- local `codex` HEAD: `285f4ea81`

Important limits:

- `codex` is a Rust-heavy monorepo with a very different build and runtime
  shape from `openclawcode`
- some of its public docs intentionally defer to hosted OpenAI documentation,
  so code and schema files were used as the primary source of truth
- `openclawcode` already has stronger channel, plugin, gateway, and durable
  execution-host policy machinery in several areas, so "borrow" usually means
  "adapt the idea" rather than "copy the implementation"

Files inspected during comparison included:

- `codex/README.md`
- `codex/codex-cli/README.md`
- `codex/codex-rs/core/prompt.md`
- `codex/codex-rs/instructions/src/fragment.rs`
- `codex/codex-rs/core/config.schema.json`
- `codex/codex-rs/core/README.md`
- `codex/codex-rs/sandboxing/src/manager.rs`
- `codex/codex-rs/shell-escalation/README.md`
- `codex/codex-rs/config/src/skills_config.rs`

Compared primarily with:

- `openclawcode/docs/tools/skills.md`
- `openclawcode/docs/tools/exec-approvals.md`
- `openclawcode/docs/gateway/sandboxing.md`
- `openclawcode/docs/start/openclaw.md`
- `openclawcode/src`

---

## Executive summary

`openclawcode` should borrow from `Codex` mostly at the level of:

1. instruction and project-doc contract clarity
2. sandbox selection and transformation boundaries
3. escalation protocol shape
4. small, explicit configuration surfaces

`openclawcode` should not borrow from `Codex` at the level of:

1. overall Rust/Bazel monorepo shape
2. simpler approval policy semantics where `openclawcode` is already stricter
3. docs patterns that offload too much detail to an external website

The highest-value lesson is this:

`Codex` is strong at expressing boundaries cleanly.
`openclawcode` is already stronger in several runtime capabilities, but some of
those capabilities are harder to understand because their contracts are more
diffuse.

---

## Detailed comparison

## 1. AGENTS.md and project-doc contract

### Codex

`Codex` is unusually explicit about how `AGENTS.md` works.

Notable strengths:

- scope is defined by directory tree, not by vague "project context"
- deeper files override shallower files
- only files actually touched need to obey relevant scoped instructions
- project-doc fragments are wrapped into a clearly delimited injected message
- config allows fallback filenames and byte caps for project-doc loading

Relevant files:

- `codex/codex-rs/core/prompt.md`
- `codex/codex-rs/instructions/src/fragment.rs`
- `codex/codex-rs/core/config.schema.json`

### openclawcode

`openclawcode` already has a richer workspace-memory concept:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `TOOLS.md`
- `HEARTBEAT.md`
- daily memory files

That is a stronger product concept than plain `AGENTS.md`, but the exact
contract is spread across docs and prompt behavior rather than concentrated in
one crisp spec.

### Recommendation

Borrow the clarity, not the reduced feature set.

Concrete direction:

- document a single authoritative precedence contract for workspace guidance
- add explicit config for:
  - fallback project-doc filenames
  - byte caps per injected doc
  - maybe per-doc-type enable/disable controls
- keep the richer `openclawcode` memory model, but describe it with the same
  precision that `Codex` uses for `AGENTS.md`

Expected benefit:

- fewer prompt-surface ambiguities
- easier debugging when a session seems to "ignore" a workspace instruction
- simpler future work on subagent instruction inheritance

Judgment: very high-value to adapt.

---

## 2. Sandbox selection and transformation boundaries

### Codex

`Codex` splits sandboxing into two distinct decisions:

1. choose whether a platform sandbox is needed
2. transform the command into a concrete platform-specific execution request

The split is visible in:

- `codex/codex-rs/sandboxing/src/manager.rs`
- `codex/codex-rs/core/README.md`

Strengths:

- platform differences are normalized behind one manager boundary
- call sites do not need to know all argument-rewrite details
- sandbox policy becomes a first-class data object, not ad hoc flags
- the code clearly separates "policy intent" from "how to launch it"

### openclawcode

`openclawcode` already supports more real-world sandbox backends and operator
config than `Codex`:

- Docker sandbox
- SSH sandbox
- OpenShell sandbox
- browser sandbox integration
- host-vs-sandbox routing through exec tools and policies

That is a broader capability surface than `Codex`.
The tradeoff is that the conceptual boundary is harder to explain quickly.

### Recommendation

Borrow the abstraction shape, not the implementation language or backend set.

Concrete direction:

- define one internal "effective sandbox execution request" type for
  `openclawcode`
- make backend selection a distinct step from backend-specific command rewrite
- unify "host", "sandbox", "node", and "gateway" routing into a more explicit
  transformation pipeline where possible

Do not borrow:

- the reduced backend model
- the assumption that platform-native sandboxing is the main story

Expected benefit:

- easier reasoning about exec routing
- simpler future additions like external sandbox adapters
- less policy logic leaking into many tool call sites

Judgment: high-value to adapt.

---

## 3. Shell escalation protocol

### Codex

`Codex` has a very crisp model for shell escalation.

Its Unix escalation wrapper delegates decisions over a socket and gets one of
three outcomes:

- `Run`
- `Escalate`
- `Deny`

Relevant file:

- `codex/codex-rs/shell-escalation/README.md`

What is good here is not the zsh patching itself. It is the protocol boundary:

- in-sandbox execution stays in-band
- out-of-sandbox execution is explicit and stateful
- denial is first-class, not an error side effect

### openclawcode

`openclawcode` already has much stronger execution-host approval hardening for
real operator workflows:

- allowlists
- ask policies
- cwd binding
- exact argv binding
- interpreter/script operand binding
- drift rejection before execution

This is more operationally mature than the simple `Codex` public description.

### Recommendation

Borrow the protocol framing, not the approval simplification.

Concrete direction:

- make escalation outcomes more explicitly typed in operator-facing docs and
  internal boundaries
- continue keeping `openclawcode`'s stronger approval binding semantics
- consider formalizing a transport-neutral escalation protocol so host exec,
  sandbox escape, and future remote runtimes feel like variants of one system

Expected benefit:

- easier reasoning across gateway, node-host, and sandbox escape flows
- less ambiguity between "blocked", "needs approval", and "rerun elsewhere"

Judgment: medium-to-high value to adapt.

---

## 4. Config surface discipline

### Codex

`Codex` uses a very explicit schema for config, with many fields documented in
one place.

Interesting examples:

- `project_doc_fallback_filenames`
- `project_doc_max_bytes`
- `approval_mode`
- `approvals_reviewer`
- `skills`

Relevant file:

- `codex/codex-rs/core/config.schema.json`

One especially useful idea is that even advanced features often expose a small,
opinionated top-level surface.

### openclawcode

`openclawcode` is much richer in runtime capability, but some subsystems have a
larger and more emergent config surface because features evolved organically.

This is especially visible around:

- workspace guidance files
- skills
- sandbox routing
- exec approvals

### Recommendation

Borrow the habit of adding smaller declarative control points before adding
more special cases.

Concrete direction:

- prefer adding a few explicit high-level config keys before exposing more
  nested special-case flags
- publish schema-level descriptions whenever a subsystem becomes operator-tuned
- add config fields only when they correspond to a stable user-facing concept

Expected benefit:

- lower operator confusion
- easier validation and migration behavior
- fewer "hidden contract" settings

Judgment: high-value to adapt.

---

## 5. Skills model

### Codex

`Codex` keeps the core skill config model intentionally small:

- bundled skills on/off
- individual skill selectors by name/path
- explicit enable/disable state

Relevant file:

- `codex/codex-rs/config/src/skills_config.rs`

This is less powerful than `openclawcode`, but it has one real advantage:
the config contract is easy to understand and validate.

### openclawcode

`openclawcode` has a much more advanced skills story already:

- bundled skills
- managed skills
- workspace and agent-local skills
- metadata gating
- install flows
- env/config injection
- plugin-shipped skills

Relevant file:

- `openclawcode/docs/tools/skills.md`

This is a strength, not a weakness.

### Recommendation

Do not simplify `openclawcode` down to `Codex`'s skills model.

What is worth borrowing:

- a thinner top-level "skill enablement" layer for common cases
- clearer separation between:
  - skill discovery
  - skill eligibility
  - skill configuration
  - skill install metadata

Expected benefit:

- better first-run UX
- simpler operator mental model for the common case
- fewer docs needed to explain "just disable this skill"

Judgment: medium value to adapt.

---

## 6. Approval reviewer as a configurable role

### Codex

`Codex`'s schema includes the idea that approval review can be routed either to
the user or to a `guardian_subagent`.

Relevant file:

- `codex/codex-rs/core/config.schema.json`

Even if the exact implementation is product-specific, the design direction is
important: approval review is treated as a pluggable reviewer role.

### openclawcode

`openclawcode` already has subagents, task machinery, and strong approval
surfaces, but does not present approval review as a small configurable role in
quite this way.

### Recommendation

Borrow the concept carefully.

Concrete direction:

- explore a future reviewer mode where a subagent prepares risk context for the
  human instead of replacing the human
- keep final approval with the operator for high-risk host execution
- avoid creating a silent self-approval path for dangerous operations

Expected benefit:

- better operator experience under heavy approval load
- more consistent rationale attached to approval prompts

Judgment: promising, but should be staged carefully.

---

## What openclawcode already does better

It is important not to misread `Codex` as strictly "ahead" of
`openclawcode`.

In the compared areas, `openclawcode` already appears stronger in:

- channel and gateway architecture
- plugin and extension surface
- multi-backend sandbox support
- execution-host approval hardening
- durable task and operator workflow infrastructure
- richer workspace memory model

That means `openclawcode` should borrow mainly:

- boundary clarity
- contract wording
- a few abstraction shapes

It should not borrow by flattening itself into a simpler single-user CLI model.

---

## Recommended follow-up work

Short-term:

1. write one authoritative internal spec for workspace-guidance precedence and
   project-doc injection limits
2. define a cleaner internal type for effective sandbox execution requests
3. normalize escalation outcomes across host, node, and sandbox execution paths

Medium-term:

1. add simpler top-level skill enablement controls without removing advanced
   metadata gating
2. explore reviewer-role configuration for approval triage
3. audit which operator-facing config areas need schema-level documentation

Do not do:

1. rewrite core subsystems into Rust/Bazel because `Codex` does
2. weaken `openclawcode` approval semantics to match a simpler public CLI model
3. replace detailed local docs with thin redirect pages

---

## Bottom line

The main thing `openclawcode` should borrow from `Codex` is disciplined
boundary design.

`Codex` often makes the contract clearer.
`openclawcode` often makes the capability stronger.

The best path is to keep `openclawcode`'s stronger runtime model while making
its instruction, sandbox, escalation, and config boundaries easier to
understand and easier to evolve.
