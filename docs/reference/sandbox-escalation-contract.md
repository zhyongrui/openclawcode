---
summary: "Contract for sandbox selection, effective execution requests, and escalation outcomes"
read_when:
  - You are debugging exec routing or approvals
  - You want a transport-neutral model for run vs approval vs deny
title: Sandbox And Escalation Contract
---

# Sandbox and escalation contract

This document defines the contract that `openclawcode` should follow when
routing tool execution across direct host, sandbox, and node-host paths.

It adapts the borrowing lesson from OpenAI Codex:

separate policy intent from transport-specific launch details.

## Effective execution request

Reason about command execution in two stages:

1. resolve the effective execution request
2. transform that request into a concrete backend launch

The effective execution request should answer:

- what the operator/model asked to run
- which runtime owns the execution
- whether the session is sandboxed
- whether approval is required before launch
- which canonical command/cwd/env binding is authoritative

Conceptually, the request shape is:

- session identity: `sessionKey`, optional `sessionId`, optional `runId`
- execution target: `host`, `sandbox`, or `node`
- sandbox state: `sandboxed=true|false`, effective sandbox backend, effective
  mode
- canonical command: normalized command text and/or argv
- canonical cwd
- environment binding summary
- approval context, when required

## Stage 1: policy resolution

Before anything launches, OpenClaw should resolve:

- runtime sandbox state
- target host/runtime
- visibility restrictions
- approval requirements
- whether the request is allowed at all

This is the policy stage.

At this point the system should know whether the result is:

- `run`
- `approval_required`
- `deny`

## Stage 2: backend transformation

Only after policy resolution should OpenClaw build the concrete transport
request.

Examples:

- host exec on the gateway host
- sandbox exec through Docker / SSH / OpenShell backend adapters
- node-host system run with canonical `systemRunPlan`

This stage is backend-specific and should not redefine policy.

## Escalation outcomes

Operator-facing execution outcomes should be modeled as:

### `run`

The request is allowed as-is and can be launched immediately in the selected
runtime.

Examples:

- direct host exec in an unsandboxed session
- sandbox exec in a sandboxed session
- already-approved node-host action

### `approval_required`

The request is structurally valid but requires a human approval checkpoint
before it can launch.

Examples:

- node-host system run with `systemRunPlan`
- elevated host execution from a sandboxed runtime when policy requires
  confirmation

### `deny`

The request must not launch.

Examples:

- sandboxed session trying to spawn an unsandboxed child where policy forbids it
- node-host approval request missing canonical `systemRunPlan`
- target/runtime combination explicitly blocked by current policy

## `systemRunPlan` contract

For node-host approvals, `systemRunPlan` is the canonical execution payload.

It exists so that:

- approval UIs see the exact command/cwd/env binding being requested
- caller tampering cannot redefine the execution after approval
- node-host transport receives one normalized request shape

Current rule:

- `host=node` approval requests without `systemRunPlan` are rejected

## Reviewer role contract

Current reviewer role:

- the human operator remains the final reviewer for dangerous execution

Future-safe extension:

- a subagent may prepare approval context
- a subagent may not silently self-approve dangerous host execution

That means reviewer-role borrowing from Codex is allowed only as context
preparation, not as silent authorization.

## Boundary rules

- sandbox choice is a runtime-selection concern
- approvals are an execution-authorization concern
- backend launch details are a transport concern
- backend adapters must not silently widen permissions
- operator messaging should distinguish `blocked`, `needs approval`, and
  `running elsewhere`

## Current implementation alignment

Today this contract maps onto existing OpenClaw behavior such as:

- `resolveSandboxRuntimeStatus(...)` for runtime sandbox state
- sandbox backend adapters for Docker / SSH / OpenShell
- node-host execution guarded by canonical `systemRunPlan`
- explicit sandbox inheritance guards for subagent and ACP spawn flows

The architecture is already stronger than the borrowed source in many areas.
The value of this contract is making the boundary easier to reason about and
easier to evolve.
