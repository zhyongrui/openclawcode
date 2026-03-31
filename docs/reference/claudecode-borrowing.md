---
summary: "Comparison notes on what openclawcode can borrow from the uploaded ClaudeCode source snapshot"
read_when:
  - You are evaluating ClaudeCode ideas for openclawcode
  - You want a migration-oriented comparison instead of a raw code dump
title: ClaudeCode Borrowing Notes
---

# ClaudeCode borrowing notes

This document records what is worth borrowing from the uploaded
`/home/zyr/pros/ClaudeCode` source snapshot into `openclawcode`, and what is
not worth copying.

The goal is not code transplant. The goal is to identify product patterns,
interaction models, and subsystem boundaries that can improve `openclawcode`
without regressing its stronger platform pieces.

---

## Scope and caveats

This review was done against the uploaded `ClaudeCode/src` tree only.

Important limits:

- the snapshot does not include package manifests, lockfiles, build scripts, or
  the original repository metadata
- some conclusions are therefore architectural rather than build-verified
- `openclawcode` already has stronger plugin, channel, and durable task
  infrastructure in several areas, so "borrow" usually means "adapt the idea"
  rather than "copy the implementation"

Files inspected during comparison included:

- `ClaudeCode/src/tools.ts`
- `ClaudeCode/src/history.ts`
- `ClaudeCode/src/server/types.ts`
- `ClaudeCode/src/tasks/types.ts`
- `ClaudeCode/src/tasks/LocalMainSessionTask.ts`
- `ClaudeCode/src/bootstrap/state.ts`
- `ClaudeCode/src/bridge/bridgeMain.ts`
- `ClaudeCode/src/bridge/remoteBridgeCore.ts`

Compared primarily with:

- `openclawcode/src/tasks/task-registry.ts`
- `openclawcode/src/tasks/task-registry.types.ts`
- `openclawcode/src/plugin-sdk/facade-runtime.ts`
- bundled plugin entrypoints under `openclawcode/extensions/*/index.ts`
- session, context, and gateway surfaces under `openclawcode/src`

---

## Executive summary

`openclawcode` should borrow more from `ClaudeCode`'s product ergonomics than
from its implementation details.

The highest-value ideas are:

1. a cleaner tool-pool assembly layer
2. first-class "background the current session" UX
3. stronger operator-facing history and session-recovery experience
4. clearer bridge and remote-control boundary definitions

The lowest-value ideas to borrow are:

1. its plugin model, because `openclawcode` is already ahead here
2. its task persistence model, because `openclawcode` already has a more
   durable registry
3. direct code lifts from `ClaudeCode/src`, because the snapshot is missing its
   build and dependency context

---

## Detailed comparison

## 1. Tool pool assembly

### ClaudeCode

`ClaudeCode/src/tools.ts` is a single assembly layer for built-in tools. It
does several things in one place:

- declares the full built-in tool set
- gates tools behind feature flags
- chooses optional tools lazily
- assembles built-in plus MCP tools into a single pool
- applies deny rules before exposure
- exposes presets and mode-specific filtering

Strengths:

- there is a clear source of truth for "what tools exist"
- feature-flagged rollout is easy
- MCP and built-in tools are merged through one path
- mode filtering is explicit instead of emergent

Weaknesses:

- the file is large and operationally dense
- environment-flag branching is mixed directly into registration
- the pattern is good, but the concrete implementation is not especially
  reusable without the missing surrounding config/runtime

### openclawcode

`openclawcode` already has a stronger long-term plugin story:

- bundled plugin public-surface loading in
  `openclawcode/src/plugin-sdk/facade-runtime.ts`
- explicit plugin entrypoints under
  `openclawcode/extensions/*/index.ts`
- a much broader concept of "capabilities" than a single local tool list

Strengths:

- better extensibility boundary
- better isolation between core and bundled capabilities
- cleaner path for external providers and channels

Weaknesses:

- operator-facing tool exposure is less obviously assembled from one place
- it is harder to answer "what exact tool surface is active in this mode"
- rollout and capability slicing can become diffuse across core and plugins

### Recommendation

Borrow the pattern, not the file.

Concrete direction:

- add a single "tool surface assembly" layer in `openclawcode` that produces
  the active agent tool pool after considering:
  - core tools
  - bundled plugin tools
  - external plugin tools
  - permission context
  - mode-specific policy
- keep plugin discovery and loading where they are
- do not collapse plugin runtime back into a monolithic local tool registry

Expected benefit:

- easier operator introspection
- safer feature rollout
- clearer support for "minimal mode", "coding mode", "browser mode", and
  "remote mode" style profiles

Judgment: high-value to adapt.

### Implementation status

The first tool-surface adaptation slice is now in place in `openclawcode`.

Implemented:

- `resolveEffectiveToolSurface(...)` now assembles the runtime tool surface in
  one place before projecting it into the existing inventory view
- the effective tool result now includes `assembly` metadata describing:
  - counts by source (`core`, `plugin`, `channel`, `total`)
  - runtime context (`messageProvider`, `modelProvider`, `modelId`,
    `replyToMode`, `senderIsOwner`)
  - runtime flags (`allowGatewaySubagentBinding`,
    `requireExplicitMessageTarget`, `disableMessageTool`)
- the gateway `tools.effective` schema now exposes that runtime assembly data
  to callers instead of only returning grouped tool names
- `/tools` output now shows a compact runtime summary line so operators can see
  which channel/model/profile context produced the current tool surface
- the coding-tool assembly path now consistently honors the
  `allowGatewaySubagentBinding` runtime switch during surface resolution

Not implemented yet:

- a dedicated operator UI for tool-source diffs across sessions or agents
- rollout/preset management beyond the current policy- and profile-driven
  assembly
- a richer "why this tool is absent" explanation surface for denied or gated
  capabilities

This keeps the adaptation narrow and verifiable: establish one concrete
runtime-assembly boundary first, then layer stronger rollout and comparison UX
on top of it.

---

## 2. Backgrounding the current session

### ClaudeCode

`ClaudeCode/src/tasks/LocalMainSessionTask.ts` treats "background the current
foreground query" as a first-class task type.

Notable ideas:

- the current session can be pushed into the background instead of only
  spawning side tasks
- task output is linked to isolated transcript storage
- the user gets a fresh prompt immediately
- completion notification depends on whether the task remained backgrounded

This is a product interaction pattern, not just a task model.

### openclawcode

`openclawcode` already has a more durable task foundation:

- `openclawcode/src/tasks/task-registry.ts`
- `openclawcode/src/tasks/task-registry.types.ts`
- maintenance, audit, reconciliation, and delivery layers around that registry

This is stronger than `ClaudeCode`'s ad hoc task-state union model for
durability and operator inspection.

What `openclawcode` does not currently foreground as clearly is the UX of
"convert my current live session into a detached tracked task without changing
mental context".

### Recommendation

Borrow the UX and map it onto `openclawcode`'s existing registry.

Concrete direction:

- introduce a "background current session" command or control-UI affordance
- represent the backgrounded foreground run as a regular `TaskRecord`
- preserve a link to the originating session key
- reuse current delivery and terminal-update machinery instead of inventing a
  second notification system

Do not borrow:

- `ClaudeCode`'s task implementation shape
- its union-heavy task-state model

Expected benefit:

- better multitasking
- smoother operator experience for long-running requests
- a clearer path toward "continue working while the previous thing finishes"

Judgment: very high-value to adapt.

### Implementation status

The first adaptation slice is now in place in `openclawcode`.

Implemented:

- `TaskRecord` and `FlowRecord` now carry `originKind` and
  `originSessionKey`
- ACP-created detached/background runs stamp themselves as
  `originKind: "detached_session"`
- task and flow persistence stores preserve that metadata
- operator-facing `tasks` and `flows` commands now show origin metadata
- detached ACP runs now render with a clearer default label,
  `"Detached ACP session"`

Not implemented yet:

- a top-level "background this current foreground session" user command
- session transcript handoff and recovery UX matching ClaudeCode's
  `LocalMainSessionTask` pattern
- completion-routing behavior that depends on whether a detached task was
  later reattached

This keeps the first step deliberately narrow: make detached-session provenance
durable and inspectable first, then build the foreground-to-background
interaction on top of that stable substrate.

---

## 3. History and session-local UX

### ClaudeCode

`ClaudeCode/src/history.ts` is careful about command and prompt history:

- global history file with project-aware filtering
- current-session entries prioritized ahead of other sessions
- lazy resolution of stored pasted content
- explicit handling of inline paste references and image references
- lock-based flush and retry behavior

The code is opinionated about history as a user experience feature, not only as
storage.

### openclawcode

`openclawcode` already has deep session and context machinery, but it is more
runtime/platform oriented than command-history oriented.

The strongest comparison point is not one file; it is the overall session and
context stack under `openclawcode/src`, including:

- session storage and cleanup commands
- context-engine lifecycle
- task-linked session inspection

This is good infrastructure, but it does not automatically give a polished
history UX for an operator sitting in the CLI or TUI.

### Recommendation

Borrow the user-facing history product ideas:

- current-session-first history reads
- project-scoped history views
- durable pasted-content references instead of blindly inlining large payloads
- better separation between transcript storage and command-history storage

Do not assume the exact storage format from `ClaudeCode` is right for
`openclawcode`.

Expected benefit:

- better recall in multi-session workflows
- better interactive CLI ergonomics
- lower token waste when replaying large pasted payloads

Judgment: medium-high value to adapt.

---

## 4. Stable server session index and detached session resume

### ClaudeCode

`ClaudeCode/src/server/types.ts` explicitly models:

- server session state
- stable session keys
- a persistent `SessionIndex`
- detached/resumable server sessions

What matters here is not the type file itself but the product stance: detached
sessions are part of the normal runtime model.

### openclawcode

`openclawcode` has robust session concepts already, plus durable tasks and
session maintenance. It is not missing session identity. What is less obvious
at the product edge is a unified "detached remote session lifecycle" concept
that operators can reason about independently of task internals.

### Recommendation

Borrow the modeling discipline:

- make detached or resumable session identity more explicit in operator-facing
  surfaces
- keep stable `sessionKey -> resumable session metadata` visible where remote or
  UI clients need it
- keep session recovery distinct from task recovery, but linked

This is especially useful if `openclawcode` keeps growing:

- remote control UI
- browser control
- phone-control and voice-control sessions
- long-running background work

Judgment: medium value to adapt.

### Implementation status

The first detached-session resume-presentation slice is now in place in
`openclawcode`.

Implemented:

- `tasks show` now renders explicit resume metadata for `childSessionKey`
  sessions when a background task spawned a resumable child session
- resume presentation now includes:
  - the stable `resumeSessionKey`
  - the stored `resumeSessionId` when available
  - a concrete `openclaw agent --session-id/--session-key ...` continuation
    command
  - ACP-native resume hints such as `codex resume ...` when the child session
    has ACP identity metadata
- `flows show` now groups linked child sessions and prints the same resume
  hints instead of forcing operators to inspect task internals or session
  stores manually

Not implemented yet:

- current-session-first history browsing or project-local history views
- a first-class reattach UI beyond CLI inspection surfaces
- a "background this session now" operator action that directly creates the
  detached session being resumed later

This keeps the scope narrow: detached sessions are now easier to continue once
they exist, while the actual foreground-to-background handoff flow remains a
separate next step.

---

## 5. Bridge and remote-control boundaries

### ClaudeCode

`ClaudeCode/src/bridge/bridgeMain.ts` and
`ClaudeCode/src/bridge/remoteBridgeCore.ts` show a clear separation between:

- session spawning
- bridge transport lifecycle
- token refresh
- work dispatch
- remote transport failure handling

The files are large, but the boundary is visible: bridge logic is a subsystem,
not random utilities spread through the app.

`ClaudeCode/src/bootstrap/state.ts` also makes remote mode a first-class global
state concept, which is messy in one sense but honest in another sense: remote
control affects the whole runtime.

### openclawcode

`openclawcode` has multiple adjacent systems:

- gateway
- control UI
- child-process bridge
- channel delivery
- detached task delivery
- browser and voice related extensions

The capability breadth is better than `ClaudeCode`, but the conceptual boundary
between "session runtime", "gateway transport", "remote control", and
"operator-facing delivery" can still become blurry over time.

### Recommendation

Borrow the subsystem discipline:

- keep bridge code isolated from feature code
- define one narrow boundary for session transport and remote-control lifecycle
- keep auth refresh, transport rebuild, and session spawn concerns together
- avoid letting channel plugins own remote-session orchestration directly

This matters more as `openclawcode` adds:

- mobile or browser handoff
- remote coding surfaces
- external trigger driven session resurrection

Judgment: high value to adapt at the architecture level.

---

## 6. Skills and operator-product behavior

### ClaudeCode

The source snapshot shows explicit `SkillTool`, `AgentTool`, and user-facing
mode switches in the tool layer. Even from a partial snapshot, the product is
clearly trying to expose:

- skills as callable/operator-visible capabilities
- agents as an explicit interaction primitive
- plan/work mode distinctions at the tool surface

### openclawcode

`openclawcode` already has stronger infrastructure for:

- plugins
- bundled capabilities
- channels
- tasks
- background delivery

But the product story can still feel infrastructure-first instead of
operator-first.

### Recommendation

Borrow the presentation layer ideas:

- make "what abilities are currently active" easier to inspect
- keep plan mode, execution mode, and background work visible as explicit modes
- expose skills and tools in a more legible way to the operator

Judgment: medium value to adapt.

---

## 7. What openclawcode should not borrow

## Plugin architecture

`openclawcode` is ahead.

Reasons:

- bundled plugin loading is already more explicit and reusable
- plugin entrypoints are stable and well-structured
- provider and channel capabilities are first-class, not bolted on

Do not regress toward a single monolithic local tool file as the primary
extension mechanism.

## Task persistence model

`openclawcode` is ahead.

Reasons:

- durable registry
- delivery state
- maintenance and audit layers
- explicit runtime categorization

Borrow task UX, not task storage implementation.

## Bootstrap global state sprawl

`ClaudeCode/src/bootstrap/state.ts` is useful as evidence of what the runtime
cares about, but it is also a warning sign.

`openclawcode` should not grow a similarly oversized global state hub unless
there is no better boundary available.

---

## 7. Kairos assistant mode

### ClaudeCode

`Kairos` is not just a flag. In the visible snapshot it acts like an
assistant-mode policy bundle layered across several subsystems:

- main-thread activation and trust gating in `ClaudeCode/src/main.tsx`
- cron scheduling and durable reminder behavior in
  `ClaudeCode/src/tools/ScheduleCronTool/prompt.ts`
- fire-and-forget slash-command execution in
  `ClaudeCode/src/utils/processUserInput/processSlashCommand.tsx`
- background bash budgeting and responsiveness hints in
  `ClaudeCode/src/tools/BashTool/BashTool.tsx`

What matters is the product shape:

- long-running work is pushed off the foreground path
- scheduled/proactive work can continue without blocking the operator
- completion is routed back into the main conversation loop
- "assistant mode" changes runtime behavior coherently instead of as a bag of
  unrelated toggles

### openclawcode

`openclawcode` already has several ingredients that overlap with this:

- durable tasks and flows
- cron and gateway control surfaces
- chat-native workflow delivery
- blueprint/work-item/workflow orchestration

What it does not yet present as clearly is a single operator-facing mode that
means:

- keep making progress in the background
- schedule or defer follow-up work safely
- re-surface results through one consistent inbox/status path

### Recommendation

Borrow the assistant-mode product contract, not the feature-flag plumbing.

Concrete direction:

- define an `openclawcode` "autonomous execution mode" above existing tasks,
  flows, and cron
- let that mode opt into background-first execution for long-running work
- route all deferred completions back through the existing operator status and
  notification surfaces
- keep the policy explicit and inspectable instead of scattering it across
  unrelated booleans

Do not borrow:

- ClaudeCode's GrowthBook/feature-gate wiring
- hidden environment-variable behavior as a primary control plane
- any assumption that assistant mode should live in one giant bootstrap path

Expected benefit:

- clearer autonomous-product behavior
- better responsiveness under long-running or scheduled work
- a cleaner path from blueprint-first orchestration to "keep going unless a
  human intervenes"

Judgment: high-value to adapt at the product-policy layer.

### Claim review

The broad takeaway is directionally right, but several headline claims are too
loose unless they are tightened to what the snapshot actually shows.

What the code clearly supports:

- `Kairos` is a real assistant-mode concept with explicit activation and
  trust-gating in `ClaudeCode/src/main.tsx`
- autonomous/proactive prompting is real:
  - the model is told it will receive `<tick>` prompts
  - it is told to use `Sleep` when idle
  - it is told to stay responsive while continuing background work
- assistant-mode bash auto-backgrounding is real:
  - `ClaudeCode/src/tools/BashTool/BashTool.tsx` sets an
    `ASSISTANT_BLOCKING_BUDGET_MS` of `15_000`
  - commands exceeding that budget can be moved to the background
- memory consolidation is real:
  - `autoDream` exists
  - it runs as a forked/backgrounded agent
  - default thresholds are `24` hours and `5` sessions
- `MEMORY.md` line/byte caps are real:
  - `ClaudeCode/src/memdir/memdir.ts` sets `MAX_ENTRYPOINT_LINES = 200`
  - the system truncates overlong entrypoints when loading them
- assistant-mode or Kairos-gated tools for user-facing output are real at the
  registration layer:
  - `SendUserFileTool`
  - `PushNotificationTool`
  - `SubscribePRTool`

What is overstated or needs caution:

- "7x24 always-on AI Jarvis" is an interpretation, not a literal guarantee in
  the visible code. The snapshot shows autonomous/proactive loops and
  scheduling primitives, but not enough host/service infrastructure to prove a
  universal always-on deployment model by itself.
- "the system gives it a heartbeat and it decides whether to act" is mostly
  fair, but the visible prompt contract is `<tick>`-driven proactive behavior,
  not a single standalone daemon design document.
- "it will optimize your code while you sleep" overreaches. The prompt
  explicitly says the first wake-up should greet the user and ask what to work
  on, not start changing code unprompted.
- "it maintains a 200-line MEMORY.md" is directionally right but imprecise:
  the code enforces a 200-line load cap and separately describes nightly
  distillation from append-only logs into `MEMORY.md` and topic files.
- "it has three tools that can proactively message the user" is only partially
  verified from this snapshot. Tool registration is visible, but the actual
  tool implementations are not present in the uploaded tree, so exact behavior
  should not be overstated from registration alone.

Borrowing conclusion for `openclawcode`:

- borrow the explicit autonomous-mode contract
- borrow the tick/sleep/background-budget interaction model
- borrow memory-maintenance as a bounded background task
- do not borrow the exaggerated product narrative without matching operator
  controls, trust boundaries, and observability

---

## 8. Multi-agent coordination and swarm model

### ClaudeCode

The strongest part of the snapshot is not merely "multiple agents exist." It is
that the system defines explicit coordination rules across:

- a coordinator role in `ClaudeCode/src/coordinator/coordinatorMode.ts`
- in-process subagent identity and isolation in
  `ClaudeCode/src/utils/agentContext.ts`
- in-process teammate execution in
  `ClaudeCode/src/utils/swarm/inProcessRunner.ts`
- permission bridging in
  `ClaudeCode/src/utils/swarm/permissionSync.ts`
- multiple backends for teammates in
  `ClaudeCode/src/utils/swarm/backends/*`
- file-backed team state in
  `ClaudeCode/src/utils/swarm/teamHelpers.ts`

The high-value ideas are:

- coordinator vs worker separation is explicit
- delegation discipline is encoded in prompts and tool filtering
- concurrent workers have isolated identity and attribution
- permission prompts are bridged back to the leader instead of becoming
  ungoverned worker side effects
- the system distinguishes cheap in-process workers from heavier pane/process
  teammates

### openclawcode

`openclawcode` is already directionally aligned at the product level:

- planner/coder/reviewer/verifier role routing already exists in docs and
  workflow artifacts
- subagent runtime, task registry, flow registry, and channel delivery already
  exist
- multi-agent isolation at the gateway/agent level is stronger than the
  ClaudeCode swarm snapshot

The main missing piece is not "spawn more agents." It is a firmer orchestration
contract for:

- when to fan out research
- when writes must serialize
- how role outputs are handed back to a coordinator
- how approvals and delivery stay centralized while workers remain isolated

### Recommendation

Borrow the orchestration contract, not the swarm shell.

Concrete direction:

- add a first-class coordinator/worker execution policy for `openclawcode`
  workflows
- encode role-specific fan-out rules:
  - planner/research can parallelize
  - code edits serialize by write scope
  - verifier stays independent from builder reasoning
- carry worker identity and lineage through task/flow artifacts
- centralize approvals, operator messaging, and policy decisions at the
  coordinator layer
- prefer the existing durable task/flow model over tmux-pane or ad hoc team
  file orchestration

Do not borrow:

- tmux/iTerm-specific swarm UX as a core dependency
- file-based team membership as the primary execution substrate
- a second parallel orchestration stack beside `openclawcode` workflows

Expected benefit:

- better parallelism without losing operator control
- clearer separation of planner/coder/verifier responsibilities
- a realistic path to the intended blueprint-first multi-agent product

Judgment: very high-value to adapt conceptually, low-value to transplant
literally.

### Claim review

The multi-agent interpretation is substantially correct, and the strongest
evidence is in the coordinator prompt plus the teammate/subagent execution
stack.

What the code clearly supports:

- `Coordinator Mode` is explicit and prompt-driven in
  `ClaudeCode/src/coordinator/coordinatorMode.ts`
- the system defines a concrete four-part work shape:
  - research
  - synthesis
  - implementation
  - verification
- the prompt explicitly says:
  - workers are async
  - independent work should be launched concurrently
  - "Parallelism is your superpower"
- worker identity and isolation are explicit:
  - subagent identity uses AsyncLocalStorage in
    `ClaudeCode/src/utils/agentContext.ts`
  - teammates can run in-process or via pane/process backends
- permission escalation from workers back to the leader is explicit in
  `ClaudeCode/src/utils/swarm/permissionSync.ts`
- remote long-horizon planning is real:
  - `ultraplan` launches a remote session
  - the visible timeout constant is `30 * 60 * 1000`
  - the poller watches remote session state and feeds results back into the
    local session

What is overstated or needs caution:

- "AI指挥 AI 干活" is fair as shorthand, but the snapshot shows an
  operator-supervised orchestration model, not an unconstrained autonomous
  swarm.
- `ULTRAPLAN` is not just "think very hard for 30 minutes." The visible code
  shows a remote planning session with approval/polling/teleport behavior and
  specific browser-session workflow, not a generic deep-thought black box.
- "project manager + development team one-body" is directionally useful as a
  metaphor, but the implementation is still heavily mediated by tool policy,
  prompt rules, and leader-controlled approvals.

Borrowing conclusion for `openclawcode`:

- borrow the explicit coordinator/worker contract
- borrow the phase discipline:
  - parallel research
  - coordinator synthesis
  - scoped implementation
  - independent verification
- borrow lineage and permission-bridge concepts
- borrow remote deep-planning as a specialized capability only if it reuses
  `openclawcode`'s existing task/flow/runtime substrate
- do not borrow tmux/team-file swarm mechanics as the core execution model

## Direct code lifts

Do not directly transplant code from the uploaded `ClaudeCode/src` snapshot.

Reasons:

- missing package and dependency context
- missing build assumptions
- likely hidden environment feature flags
- unclear runtime invariants outside the visible files

---

## Priority ranking for openclawcode

## Tier 1: should actively borrow

- foreground session -> background task UX
- tool-pool assembly and visibility
- bridge and remote-control subsystem boundaries
- coordinator/worker orchestration rules

## Tier 2: should borrow selectively

- history ergonomics
- detached session resume presentation
- operator-facing ability/mode presentation
- assistant-mode policy bundling

## Tier 3: should mostly ignore

- plugin implementation model
- task persistence implementation
- large bootstrap-global-state patterns

---

## Concrete migration ideas

## A. Add a "background current session" operator flow

Target in `openclawcode`:

- a command, slash command, or control-UI action that converts the active
  foreground run into a tracked detached task

Reuse:

- `task-registry`
- existing task delivery policy
- existing session identifiers

Do not add:

- a second task system
- a parallel notification channel just for backgrounding

## B. Add a dedicated tool-surface assembly layer

Target in `openclawcode`:

- one place that materializes the active tool pool for a given agent/run mode

Inputs should include:

- core tools
- plugin tools
- channel-scoped tools
- mode policy
- permission policy

## C. Strengthen remote-session lifecycle boundaries

Target in `openclawcode`:

- isolate session spawn, transport rebuild, auth refresh, and remote delivery
  from higher-level feature code

This reduces future coupling between:

- control UI
- browser bridge
- phone-control
- voice-call
- detached task delivery

## D. Improve operator-facing history

Target in `openclawcode`:

- project-local history
- current-session-first recall
- better handling of large pasted payload references

## E. Add an explicit coordinator execution layer

Target in `openclawcode`:

- one orchestration surface that owns fan-out, role routing, approval routing,
  and worker-result synthesis

Reuse:

- role-routing artifacts
- task and flow registries
- existing planner/coder/verifier workflow stages

Do not add:

- tmux-backed team state as a product dependency
- a second worker/task abstraction unrelated to workflow runs

## F. Add an autonomous-mode policy bundle

Target in `openclawcode`:

- one explicit mode that turns on background-first execution, deferred result
  delivery, and safe scheduled follow-up behavior

Reuse:

- cron
- task/flow delivery
- operator inbox and status views

Do not add:

- hidden feature-flag-only behavior with weak operator visibility

---

## Final judgment

`ClaudeCode` is more useful to `openclawcode` as a source of product patterns
than as a source of reusable code.

The strongest borrowable ideas are:

- make active capabilities easier to assemble and inspect
- let the operator background the current session as a first-class workflow
- make remote and bridge lifecycles more explicit subsystems
- make coordinator/worker orchestration rules explicit
- bundle autonomous/background behavior into a visible mode instead of
  scattered toggles

The strongest reason not to over-borrow is that `openclawcode` is already ahead
in the two hardest foundations:

- extensible plugin architecture
- durable task and delivery infrastructure

The right strategy is therefore:

1. keep `openclawcode`'s foundation
2. borrow `ClaudeCode`'s operator ergonomics
3. avoid direct implementation transplants
