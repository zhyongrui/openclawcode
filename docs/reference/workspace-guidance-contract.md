---
summary: "Authoritative contract for workspace bootstrap files, precedence, and prompt injection"
read_when:
  - You are debugging why workspace guidance did or did not apply
  - You need the exact bootstrap-file loading contract
title: Workspace Guidance Contract
---

# Workspace guidance contract

This document is the authoritative contract for how `openclawcode` loads and
interprets workspace guidance files.

It exists to make one thing unambiguous:

`openclawcode` has a richer workspace-memory model than plain `AGENTS.md`, but
that richness still needs a crisp loading contract.

## Scope

This contract covers:

- workspace bootstrap files
- fallback filenames
- session-type loading differences
- hook-injected extra bootstrap files
- precedence expectations for prompt interpretation

It does not cover:

- transcript history replay rules
- memory search/ranking behavior
- nested per-directory automatic instruction discovery

## Recognized bootstrap files

Recognized workspace bootstrap basenames are:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`
- `memory.md` as a lowercase fallback for `MEMORY.md`

Important notes:

- `MEMORY.md` is preferred when present.
- `memory.md` is only used when `MEMORY.md` is absent.
- `BOOTSTRAP.md` is a first-run ritual file, not a permanent required file.

## Session-type loading matrix

### Normal main/direct sessions

Normal sessions may inject the workspace bootstrap set, including:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md` or `memory.md`

### Subagent sessions

Subagent sessions intentionally use a narrower bootstrap set:

- `AGENTS.md`
- `TOOLS.md`

This is a product boundary, not an accident. Subagents inherit operational
rules and local tool notes, but they do not automatically inherit the full
persona/memory bootstrap set.

### Heartbeat sessions

Heartbeat runs use the configured heartbeat prompt plus workspace context:

- normal heartbeat mode keeps the standard bootstrap behavior
- lightweight heartbeat mode keeps only `HEARTBEAT.md`

## Precedence contract

Within a running session, guidance should be interpreted in this order:

1. system/developer/runtime instructions
2. session-specific invocation constraints and runtime flags
3. injected workspace bootstrap files
4. hook-injected extra bootstrap files
5. normal conversation/transcript history
6. on-demand memory/tool retrieval

Inside the bootstrap layer, the intended semantic roles are:

1. `AGENTS.md`: operational rules, standing orders, red lines
2. `SOUL.md`: persona, tone, style, identity guardrails
3. `TOOLS.md`: local operational notes, host details, environment conventions
4. `IDENTITY.md`: agent identity metadata
5. `USER.md`: who the agent serves
6. `HEARTBEAT.md`: periodic-check checklist, mainly relevant to heartbeat turns
7. `BOOTSTRAP.md`: first-run ritual/setup instructions
8. `MEMORY.md` / `memory.md`: durable long-term memory

This is a semantic contract, not a parser-level hard override system. If two
workspace files conflict, the higher-priority file above should win.

## Extra bootstrap files

`agent:bootstrap` hooks may inject additional bootstrap files.

Current contract:

- only recognized bootstrap basenames are accepted
- hook-injected files extend the bootstrap context
- they do not create a new automatic directory-scoped precedence tree

This is where monorepo-local `AGENTS.md` / `TOOLS.md`-class files can be added
today.

## Injection limits and truncation

OpenClaw currently uses budgeted prompt injection rather than a fixed
user-facing per-file byte cap.

Current behavior:

- large bootstrap files may be truncated before injection
- prompt diagnostics report truncation
- the file on disk remains authoritative even when the injected excerpt is
  shortened

This means:

- concise bootstrap files are still strongly preferred
- current runtime behavior is budget-based, not Codex-style fixed
  `project_doc_max_bytes` configuration

## Explicit non-feature: nested automatic directory precedence

OpenClaw does not currently implement Codex-style automatic nested
directory-tree precedence for `AGENTS.md`.

Today, if you want narrower local guidance, use one of:

- the agent workspace root bootstrap files
- hook-injected extra bootstrap files
- explicit task/session instructions

If nested project-doc precedence is added later, it must be documented as a new
contract instead of being implied silently.
