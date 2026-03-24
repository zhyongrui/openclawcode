# Chat-Native Intake Styles

## Supported Prompt Styles

These are the styles that the current chat intake flow is meant to handle well:

- one-line narrow requests
  - example: "Expose `buildSummaryPresent` in `openclaw code run --json`"
- short request plus short body
  - example:
    - first line: "Clarify provider pause behavior in operator docs"
    - following lines: one or two concrete constraints
- issue-title-first requests that already name the repo and scope
- docs-only requests that point to one specific document
- command-layer JSON mirror requests that already identify:
  - field name
  - nested source path
  - expected scalar/boolean shape
- bug-fix requests when the operator can at least name:
  - the observed failure
  - the expected behavior
  - the smallest known reproduction
- targeted refactor requests when the operator can at least name:
  - the module or flow to reshape
  - the behavior that must remain unchanged
  - the first safe checkpoint

## Supported But Human-Reviewed

These are accepted, but should be expected to pause for clarification or manual
approval:

- mixed-scope requests
- requests with open questions
- requests that mention policy changes
- requests that are broad enough to require multiple work items
  - the current intake flow now proposes multiple scoped draft variants when it
    can split an ambiguous one-line request safely

## Unsupported Or Intentionally Blocked Styles

These should not be treated as direct autonomous-safe intake:

- secret rotation or credential work
- auth, permissions, RBAC, billing, or infra changes
- "refactor the whole repo" requests
- vague requests with no repo-local target
- requests that require hidden organizational context
- requests that bundle multiple unrelated tasks into one ambiguous block

## Current Narrowing Flow

When a one-line intake request is narrow enough, `openclawcode` will generate a
single pending draft and ask for confirmation.

The current synthesized-draft flow now also classifies one-line requests into:

- `feature`
- `bugfix`
- `refactor`
- `research`

That classification changes both the generated body scaffold and the
clarification prompts shown in chat.

When a one-line intake request is obviously mixed-scope, the current flow can
also propose multiple scoped variants. In chat, the operator can:

- reopen the current pending draft with `/occode-intake-preview owner/repo`
- answer the next clarification directly with
  `/occode-intake-answer owner/repo [index] <answer...>`
- inspect the suggested variants in the pending draft message
- pick one with `/occode-intake-choose owner/repo <index>`
- keep refining with `/occode-intake-edit`
- confirm with `/occode-intake-confirm`

## Escalated Intake Requests

High-risk intake requests still create the GitHub issue, but `openclawcode`
keeps them on an explicit escalation path instead of queueing execution.

The current operator flow is:

- inspect the tracked escalation with `/occode-status owner/repo#issue`
- only use `/occode-start-override owner/repo#issue` after a human accepts a
  one-run exception
