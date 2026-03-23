# Feishu QR Operator Binding Design

## Goal

Let OpenClaw bind a concrete Feishu operator target during setup by asking the
operator to scan and approve a Feishu/Lark login flow, instead of relying only
on a later in-chat interaction such as tapping the bot's Quick actions menu.

The outcome we want is:

1. OpenClaw learns the operator's Feishu identity in a durable way
2. OpenClaw stores that identity as the preferred operator chat target
3. OpenClaw optionally auto-trusts that operator for setup commands when the
   channel DM policy is `pairing`
4. OpenClaw Code can proactively push setup status and GitHub device login into
   that chat without waiting for a manual `/occode-setup` retry

## Why This Exists

The current Feishu setup already proves the bot credentials and WebSocket
transport, but it does not identify which human should receive follow-up setup
messages.

Today that last step is learned through a bot-menu event:

- the operator opens the Feishu bot
- the operator taps **Quick actions**
- OpenClaw receives `application.bot.menu_v6`
- OpenClaw stores `user:<open_id>` as the preferred operator target

That works, but it has two product drawbacks:

1. onboarding copy sounds more proactive than the actual behavior
2. it still requires one extra in-chat interaction before OpenClaw Code can
   start talking first

## Current Implementation

### Existing binding path

The current Feishu binding path lives in:

- `extensions/feishu/src/setup-surface.ts`
- `extensions/feishu/src/monitor.account.ts`
- `src/operator-chat-targets/store.ts`

The current logic is:

1. onboarding verifies the Feishu app credentials
2. onboarding tells the operator to tap **Quick actions** once
3. the Feishu plugin receives `application.bot.menu_v6`
4. the plugin extracts `event.operator.operator_id.open_id`
5. the plugin persists:

```ts
await setPreferredOperatorChatTarget({
  channel: "feishu",
  accountId,
  target: `user:${operatorOpenId}`,
  source: "feishu-quick-actions-menu",
});
```

### Existing proactive OpenClaw Code path

OpenClaw Code already has the machinery to proactively continue setup once a
concrete target exists:

- `extensions/openclawcode/index.ts`
- `src/openclawcode/operator-chat-targets.ts`

The important behavior is:

- bind-pending repo notify targets can be resolved through the preferred
  operator target store
- proactive GitHub device auth startup already exists
- proactive pairing messages already exist
- auto-allowing a configured setup DM for setup lifecycle commands already
  exists

This means the missing piece is not "how to send setup messages"; the missing
piece is "how to discover the operator target earlier and more reliably".

## Core Constraint

Feishu `App ID` and `App Secret` alone are not enough to identify the human
operator.

OpenClaw needs one of the following:

- a real chat event from that human, such as the current Quick actions menu
  event
- or an explicit Feishu login / authorization step that returns the human's
  identity

So the QR-based design must be an identity-binding flow, not just a bot config
flow.

## Feasible QR-Based Design

### Summary

Use a dedicated Feishu/Lark OAuth or SSO authorization flow during onboarding:

1. OpenClaw creates a short-lived operator-binding session
2. OpenClaw generates a Feishu authorization URL for that session
3. OpenClaw shows it as a QR code and clickable URL
4. the operator scans and approves in Feishu / browser
5. OpenClaw receives the callback, exchanges `code` for a user token, and
   fetches the operator identity
6. OpenClaw stores the resulting `open_id` as the preferred operator target
7. OpenClaw optionally auto-adds that `open_id` to the pairing allowlist
8. OpenClaw Code immediately starts proactive setup and GitHub auth in that DM

### Why `open_id` is the right target

The existing Feishu send path already supports user-addressable targets and
preserves explicit user routing:

- `extensions/feishu/src/send-target.ts`
- `extensions/feishu/src/send.ts`

The preferred operator target store also already expects the target in the same
shape used by the Quick actions flow:

- `user:<open_id>`

So the QR bind path should write the same target shape and reuse the same store.

## Recommended Product Behavior

### Bind choices shown during setup

After Feishu credentials verify successfully, onboarding should show:

1. `Scan QR to bind operator` (recommended when a public callback URL exists)
2. `Use Quick actions in chat` (works on loopback-only/local setups)
3. `Skip for now`

### Environment-aware guidance

If OpenClaw cannot expose a callback URL reachable from the scanning device,
onboarding should not pretend mobile QR binding will work.

Instead it should say:

- QR bind on a phone requires a callback URL reachable from that phone
- if the gateway is loopback-only, use Quick actions instead
- if the operator is scanning on the same machine, a local browser callback may
  still work

This avoids the "setup looked complete but nothing happened" failure mode.

## Network and Callback Requirement

This is the most important implementation detail.

### What works

- public HTTPS callback URL
- trusted reverse proxy URL that forwards back into the OpenClaw gateway
- a local desktop browser callback flow when the same machine opens the auth URL

### What does not work for mobile scan

- `127.0.0.1` or `localhost` callback URLs shown as QR codes for a phone to scan

If the operator scans on a phone, the callback happens on the phone. The phone
cannot complete a callback to the developer workstation's `localhost`.

So the design must explicitly support two modes:

1. `qr-public-callback`
2. `quick-actions-fallback`

## Proposed Architecture

### New Feishu operator-binding session store

Add a small store for binding sessions, for example:

- `extensions/feishu/src/operator-bind.store.ts`

Suggested persisted fields:

- `sessionId`
- `accountId`
- `channel`
- `state`
- `nonce`
- `createdAt`
- `expiresAt`
- `returnTarget`
- `status` (`pending`, `completed`, `expired`, `failed`)
- `resolvedOpenId`

### New OAuth helper

Add a focused helper, for example:

- `extensions/feishu/src/operator-bind.oauth.ts`

Responsibilities:

- build Feishu/Lark auth URL
- exchange callback `code` for user token
- fetch operator identity
- normalize identity into:
  - `openId`
  - `userId`
  - `unionId`

### New HTTP callback route

Add a gateway HTTP route, for example:

- `extensions/feishu/src/operator-bind.routes.ts`

Responsibilities:

- validate `state`
- load the pending bind session
- exchange auth code
- fetch user identity
- persist preferred operator target
- render a human confirmation page in the browser

OpenClaw already has a plugin-owned HTTP route pattern that can be copied:

- `extensions/openclawcode/index.ts`

### Setup UI integration

Update:

- `extensions/feishu/src/setup-surface.ts`

Add a new step after the connection test:

- if a reachable callback base URL is available:
  - offer QR binding
  - show QR + URL
  - poll for bind completion
- otherwise:
  - explain why QR bind is unavailable
  - point the operator to Quick actions

## Persistence and Reuse

The bind flow should write into the existing preferred operator target store:

```ts
await setPreferredOperatorChatTarget({
  channel: "feishu",
  accountId,
  target: `user:${openId}`,
  source: "feishu-qr-bind",
  replace: true,
});
```

This is important because it keeps the QR flow compatible with all current
OpenClaw Code logic that already consumes preferred operator targets.

## Pairing Behavior

If the Feishu DM policy remains `pairing`, the bind flow should optionally add
the bound operator to the allowlist immediately.

That logic can reuse the same allow-from path already used by OpenClaw Code's
proactive setup auto-allow flow.

Pseudo-shape:

```ts
await addChannelAllowFromStoreEntry({
  channel: "feishu",
  accountId,
  entry: openId,
  env: {
    ...process.env,
    OPENCLAW_STATE_DIR: stateDir,
  },
});
```

Without this, QR bind would still leave the operator stuck behind a pairing
gate before setup commands can continue.

## OpenClaw Code Handoff

After a successful QR bind, OpenClaw should do one of these immediately:

1. directly kick the existing proactive OpenClaw Code setup path
2. or create/update the setup session and send the first setup message itself

The cleaner option is to reuse the existing proactive setup pipeline:

- resolve the preferred operator target
- auto-allow it if pairing is enabled
- call the same proactive GitHub device flow used today

That keeps one source of truth for:

- setup session state
- GitHub device flow lifecycle
- retry and status messaging

## Suggested Code Touchpoints

### Feishu plugin

- `extensions/feishu/src/setup-surface.ts`
  - add the operator-binding mode selection
  - add QR bind instructions and polling
- `extensions/feishu/src/monitor.account.ts`
  - keep Quick actions as the fallback binding path
- `extensions/feishu/src/send-target.ts`
  - likely no change required
- `extensions/feishu/src/send.ts`
  - likely no change required

### New files

- `extensions/feishu/src/operator-bind.store.ts`
- `extensions/feishu/src/operator-bind.oauth.ts`
- `extensions/feishu/src/operator-bind.routes.ts`
- optionally `extensions/feishu/src/operator-bind.qr.ts`

### Shared OpenClaw logic

- `src/operator-chat-targets/store.ts`
  - reuse as-is
- `src/openclawcode/operator-chat-targets.ts`
  - reuse as-is

### OpenClaw Code

- `extensions/openclawcode/index.ts`
  - possibly add one explicit hook to re-run proactive setup right after a fresh
    operator bind finishes

## Minimal End-to-End Flow

### Happy path with public callback

1. operator finishes Feishu credential setup
2. onboarding offers `Scan QR to bind operator`
3. OpenClaw generates a binding session and QR
4. operator scans and authorizes
5. callback returns to OpenClaw
6. OpenClaw resolves `open_id`
7. OpenClaw stores `user:<open_id>` as the preferred operator target
8. OpenClaw auto-allows that `open_id` if pairing is enabled
9. OpenClaw Code proactively sends:
   - "OpenClaw is now bound to this Feishu account"
   - GitHub device URL + code

### Happy path on loopback-only setups

1. operator finishes Feishu credential setup
2. onboarding explains that mobile QR bind is unavailable on loopback-only
   gateway setups
3. operator opens the bot and taps Quick actions
4. OpenClaw stores `user:<open_id>` through the existing event path
5. OpenClaw Code proactively starts from that learned target

## Implementation Notes

### QR rendering

OpenClaw already has QR rendering code:

- `src/cli/qr-cli.ts`

That can be reused to show the Feishu auth URL as:

- terminal QR
- plain URL fallback

### HTTP route registration

OpenClaw plugins already support plugin-owned HTTP routes through:

- `api.registerHttpRoute(...)`

So the Feishu callback endpoint should be implemented as a plugin route rather
than as a standalone side server.

## Testing Plan

### Unit tests

Add focused tests for:

- auth URL generation
- callback state validation
- bind session persistence and expiry
- identity normalization
- preferred operator target write
- pairing allowlist write

### Integration tests

Add integration coverage for:

- successful QR bind writes `user:<open_id>` into the preferred operator store
- loopback-only setup falls back to Quick actions guidance
- QR bind completion triggers proactive OpenClaw Code setup
- pairing-gated Feishu DMs become setup-ready after bind

### Manual validation

Validate four manual scenarios:

1. local loopback-only gateway + Quick actions fallback
2. public callback URL + mobile QR bind
3. pairing DM policy enabled
4. OpenClaw Code proactive GitHub auth after bind

## Rollout Recommendation

Implement this in two stages.

### Stage 1

Ship the design with:

- QR bind only when a reachable callback URL exists
- Quick actions retained as the default fallback
- explicit onboarding copy that explains which mode is available and why

### Stage 2

Refine the product with:

- better callback URL discovery
- stronger operator-facing success/failure feedback
- direct "binding complete, starting setup now" push into chat

## Recommendation

Build this as a hybrid system:

- **primary**: QR-based operator binding through Feishu/Lark auth
- **fallback**: existing Quick actions event binding

That is the lowest-risk path because:

- it solves the proactive-setup UX problem when a callback URL is available
- it keeps local new-machine testing viable when only loopback is available
- it reuses the existing preferred-operator target store and proactive
  OpenClaw Code setup machinery

## Official Documentation Entry Points

These are the relevant Feishu/Lark documentation entry points for the bind flow:

- Feishu obtain user access token:
  `https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/obtain-user-access-token`
- Feishu web application SSO identity information:
  `https://open.feishu.cn/document/common-capabilities/sso/web-application-sso/obtain-identity-information`
- Lark obtain user access token:
  `https://open.larksuite.com/document/server-docs/authentication-management/login-state-management/obtain-user-access-token`
- Lark web application SSO identity information:
  `https://open.larksuite.com/document/common-capabilities/sso/web-application-sso/obtain-identity-information`

The exact auth URL, scopes, and callback parameters should be confirmed against
the current Feishu/Lark OAuth docs when implementation starts, but the overall
engineering shape above is compatible with the current OpenClaw Feishu and
OpenClaw Code architecture.
