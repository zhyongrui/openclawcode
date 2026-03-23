# Feishu QR Binding Design

## Goal

Turn the first Feishu operator binding step into a scan flow that feels
proactive and immediate.

The intended user experience is:

1. the user finishes entering Feishu `app id` and `app secret`
2. OpenClaw immediately shows a QR code in the local setup surface
3. the user scans it with Feishu
4. OpenClaw binds that Feishu identity to the setup flow
5. OpenClaw Code proactively continues in Feishu DM
6. if GitHub auth is still missing, OpenClaw Code starts the host-side GitHub
   device flow and sends the verification URL plus code into that DM

The QR step is not the setup itself. It is the first-user binding step that
lets the product become proactive without asking the user to remember chat
commands.

## Product Positioning

Primary user-facing text should stay simple:

- `用飞书扫码绑定`

Avoid internal language such as:

- operator chat
- preferred target
- pairing allow-from

Those are implementation details, not the product surface.

## Why QR Binding

The product wants to proactively message the user as soon as Feishu is
configured and the gateway is coming online.

The missing piece is not GitHub auth. The missing piece is identity:

- who should receive the first proactive DM
- how to identify that person reliably
- how to do that without falling back to `/occode-setup`

QR binding solves that first-identity problem cleanly:

- it does not require the user to know their `open_id`
- it does not require manual slash commands as the primary path
- it avoids guessing the wrong Feishu user
- it can happen before the gateway is fully ready, while still completing
  safely only after readiness is reached

## Core Product Rule

After Feishu credentials are saved, OpenClaw should show the QR code
immediately.

That does not mean the system must complete the binding immediately. It means:

- the next action is visible right away
- the user can start scanning while OpenClaw is still finishing startup
- binding completes automatically when the gateway is ready

So the design is:

- show QR early
- claim later

not:

- wait to show QR until everything is ready

## User Experience

### Setup surface after Feishu credentials are saved

The local setup surface should immediately render:

- title: `用飞书扫码绑定`
- QR code
- optional short link next to the QR code
- one short supporting line:
  - `OpenClaw 正在完成启动，绑定会在可用后自动继续`

No command guidance should be the main path here.

### After the user scans

If the gateway is already ready:

- bind immediately
- start or resume OpenClaw Code setup in DM

If the gateway is not ready yet:

- show a holding page:
  - `OpenClaw 正在完成启动`
  - `扫码已收到，准备好后会自动继续`
- once readiness is reached, finish the binding automatically

### First proactive Feishu DM

After successful binding, the first proactive DM should feel like the natural
continuation of the scan flow:

- `OpenClaw Code setup 已准备好`
- if GitHub auth is missing:
  - `Open: <verification-uri>`
  - `Code: <user-code>`
- the message should not ask the user to rerun local shell commands

## Scope

This design covers:

- first-user Feishu binding for chat-native setup
- QR issuance timing
- claim lifecycle
- DM kickoff after binding

This design does not yet cover:

- replacing an already bound Feishu user
- multi-operator approval policy
- long-term account switching UX after initial binding

## Binding Session Model

OpenClaw should create a short-lived binding session as soon as Feishu
credentials are accepted.

Suggested fields:

- `bindingId`
- `channel`
  - `feishu`
- `createdAt`
- `expiresAt`
- `state`
  - `pending-gateway-ready`
  - `ready-to-claim`
  - `claimed`
  - `expired`
- `claimedAt`
- `claimedByOpenId`
- `claimedByUserId`
- `source`
  - `qr`
- optional:
  - `repoKey`
  - `setupIntent`

The session should be short-lived, for example 10 minutes.

## QR Payload

The QR code should not expose raw internal state.

Recommended shape:

- a short gateway URL that carries:
  - `bindingId`
  - a signed verifier

Example:

```text
https://<gateway-host>/openclaw/bind/feishu/<bindingId>?sig=<signed>
```

The QR target must be:

- single-use
- time-limited
- signed against tampering

## Claim Flow

### Phase 1: issue

After Feishu credentials are saved:

1. create binding session
2. render QR immediately
3. mark state as `pending-gateway-ready`

### Phase 2: scan

When the QR is scanned:

1. validate signature
2. load binding session
3. if session expired, show refresh-required state
4. if gateway is not ready, hold the claim and continue automatically later
5. if gateway is ready, complete claim immediately

### Phase 3: bind

When claim completes:

1. resolve the Feishu user identity from the scan flow
2. persist that user as the preferred Feishu setup target
3. write the same user into pairing allow-from when needed
4. mark the binding session as `claimed`
5. proactively send the first Feishu DM

### Phase 4: continue setup

After the first DM:

1. if GitHub auth is missing, start the device flow and send URL + code
2. if GitHub auth is already ready, continue into repo / blueprint
   classification

## Gateway Readiness Rule

The QR should appear before full readiness, but the actual claim must still be
gated on gateway readiness.

This keeps the experience smooth without creating brittle failure paths.

Practical rule:

- `QR visible` does not require gateway-ready
- `binding finalization` does require gateway-ready
- `first proactive DM` does require gateway-ready

## Security Rules

- each QR binding session must expire automatically
- each QR binding session must be single-use
- successful claim must invalidate the QR immediately
- if a Feishu user is already bound:
  - do not overwrite silently
  - require an explicit replacement path later
- log:
  - `bindingId`
  - `claimedAt`
  - `claimedByOpenId`
  - `source=qr`

## Failure Handling

### QR expires before scan

Show:

- `二维码已过期，请刷新`

### User scans before gateway is ready

Show:

- `OpenClaw 正在完成启动`
- `扫码已收到，准备好后会自动继续`

### Binding succeeds but proactive DM fails

Persist the binding anyway and show a local recovery state:

- `绑定已完成，请稍后在飞书中查看消息`

If needed, OpenClaw Code can retry the first DM from the background loop.

### Existing binding already present

Do not replace silently in the MVP.

Show:

- `当前已存在绑定`
- a later design can define explicit replace semantics

## Implementation Plan

### Phase 1: QR-first binding contract

Ship:

- binding session storage
- QR issuance immediately after Feishu credential save
- gateway endpoint and signed claim URLs
- pending-gateway-ready state handling

### Phase 2: Feishu claim completion

Ship:

- resolve Feishu identity from the scan flow
- persist the bound `user:<open_id>` target
- write pairing allow-from for setup continuation

### Phase 3: proactive setup kickoff

Ship:

- first proactive Feishu DM after binding
- automatic GitHub device auth kickoff when needed
- fallback retry from the background runner

### Phase 4: replace / audit / polish

Ship:

- explicit replace-binding path
- better local status UI
- operator-facing receipts and audit trail

## Relationship to Existing Setup Flow

The QR flow should become the preferred first-binding path for fresh Feishu
installs.

Existing chat-native setup still remains valid:

- `/occode-setup`
- `/occ-setup`
- quick-actions menu binding

But those become fallback or secondary paths, not the main onboarding story.

## Recommendation

Adopt this as the primary fresh-install Feishu onboarding path:

- after `app id` / `app secret`, show QR immediately
- use simple copy: `用飞书扫码绑定`
- finish the claim only when the gateway is ready
- after claim, proactively continue OpenClaw Code in DM

If later Feishu lifecycle events can identify the user earlier and more
reliably, that can further reduce friction. But QR binding is the most robust
design to ship now without depending on speculative platform behavior.
