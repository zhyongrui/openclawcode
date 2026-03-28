# Feishu Operator Discovery Plan

## Goal

Let OpenClaw identify the intended Feishu operator early enough that it can:

1. send the first welcome message proactively
2. keep using the same user for later setup and notification messages
3. avoid OAuth-only flows and avoid product copy that over-promises a "binding"
   step when the real user goal is simply "let OpenClaw find me on Feishu"

This document supersedes the older QR-only operator-binding direction for the
current product surface.

## Product Principles

The setup copy should:

- stay in one language per surface
- avoid internal wording such as "binding" where the user is really choosing
  how OpenClaw should find them
- avoid mentioning `openclawcode` in the prompt itself
- prefer the path with the fewest user actions

## Recommended UX

After Feishu credentials verify successfully, onboarding should ask:

```text
How should we find you on Feishu?
● Work email (Recommended)
○ Mobile number
○ Scan bot and send code
○ Skip for now
```

If the operator chooses email:

- prompt: `Enter your Feishu work email`
- OpenClaw looks up the user `open_id`
- OpenClaw stores that user as the preferred Feishu operator target
- OpenClaw sends the first welcome message proactively

If the operator chooses mobile:

- prompt: `Enter your Feishu mobile number`
- the rest of the flow is identical

If the operator chooses scan-and-code:

- onboarding records that the operator wants the fallback path
- onboarding does not immediately show a QR code or one-time code
- once Gateway and the Feishu bot are fully ready, OpenClaw shows the QR code
  and one-time code at the appropriate runtime surface
- the operator scans the bot QR code and sends the one-time code in Feishu
- OpenClaw matches that DM and finishes operator discovery

If the operator skips:

- onboarding completes without an operator target
- proactive DM remains unavailable until setup is re-run or a later fallback is
  used

## Required Feishu Permissions

The credential help shown during onboarding must list:

- `im:message`
- `im:chat`
- `contact:user.base:readonly`
- `contact:user.id:readonly`

The extra `contact:user.id:readonly` permission is required for the
email/mobile lookup API that resolves `open_id` from a work email or mobile
number.

## Current Primary Path

### Path A: Contact lookup

This is the default and recommended path.

Flow:

1. save Feishu `App ID` and `App Secret`
2. collect operator work email or mobile number
3. call Feishu contact lookup
4. persist the resolved `user:<open_id>` target
5. optionally add the user to the setup allowlist if needed
6. send the first proactive DM

Why this should be the primary path:

- it has the fewest user actions
- it does not require QR callback hosting
- it does not require OAuth redirect configuration
- it keeps the product mental model simple

## Planned Fallback

### Path B: Scan bot and send code

This is the preferred fallback when contact lookup is unavailable, incorrect, or
undesirable.

The user experience should be:

1. onboarding records that the operator chose `Scan bot and send code`
2. onboarding completes normally without showing the QR code yet
3. Gateway starts and the Feishu bot becomes ready to receive messages
4. OpenClaw shows the Feishu bot QR code and a short one-time code
5. the operator scans the bot QR code
6. the operator sends the one-time code to the bot in Feishu
7. OpenClaw receives the message event and learns the sender `open_id`
8. OpenClaw matches the one-time code to the pending setup session
9. OpenClaw stores the sender as the preferred operator target
10. OpenClaw sends the first proactive welcome message

This path is better than the older QR OAuth idea because:

- it does not require a public OAuth callback URL
- it does not depend on temporary public tunnels
- it requires only one lightweight user action after opening the bot
- it uses a normal user message as the identity proof

It must be deferred until Gateway is ready because a code sent during the
interactive onboarding phase is not reliable input: the Feishu runtime and
message-claim handlers are not guaranteed to be online yet.

## Why Pure QR Is Not Enough

Scanning a bot QR code alone does not give OpenClaw a trustworthy user
identifier. OpenClaw needs either:

- contact lookup by work email or mobile
- a real message event from that user
- or a real authorization callback

Because the product no longer wants the OAuth-heavy route, the practical choices
are:

- contact lookup first
- scan bot and send code as fallback

## Development Plan

### Phase 1: polish the current contact-lookup flow

Scope:

1. rename the onboarding prompt to `How should we find you on Feishu?`
2. keep the surface fully English to match the surrounding wizard
3. remove `OpenClaw Code` and `binding` wording from this step
4. update credential help to include `contact:user.id:readonly`
5. keep `Work email (Recommended)`, `Mobile number`, and `Skip for now`

Success criteria:

- setup copy is consistent and user-facing
- the permission hint is accurate
- setup users understand that the purpose is proactive DM, not a hidden config
  ritual

### Phase 2: add scan-bot-send-code fallback

Scope:

1. add a fourth choice: `Scan bot and send code`
2. generate a short-lived setup code and store it in state
3. persist that choice without rendering the QR or code during onboarding
4. once Gateway is ready, render the bot QR plus the code in the right runtime
   surface
5. watch Feishu DM events for code matches
6. resolve sender `open_id` and persist it as the preferred operator target
7. send a success message immediately after pairing
8. expire unused codes automatically

Implementation notes:

- do not reuse the removed QR OAuth/public callback flow
- do not depend on `cloudflared`
- keep the fallback entirely message-event-driven
- ensure codes are short-lived and single-use
- do not ask the user to send the code before Gateway and Feishu listeners are
  confirmed ready

### Phase 3: harden and measure

Scope:

1. add analytics/logging around contact lookup success and fallback usage
2. add rate limits and replay protection for one-time codes
3. add explicit recovery copy when lookup fails or the wrong user sends the code
4. add tests for stale, duplicate, and cross-account codes

## Testing Plan

### Contact lookup

- onboarding stores email correctly
- onboarding stores mobile correctly
- missing `contact:user.id:readonly` produces a clear error
- successful lookup persists `user:<open_id>`
- OpenClaw sends the first proactive message after startup

### Scan bot and send code

- choosing the fallback during onboarding does not show the QR/code too early
- Gateway-ready flow reveals the QR/code only after Feishu listeners are online
- a generated code is accepted once
- the sender `open_id` becomes the preferred operator target
- the success path sends the first proactive message
- expired or already-used codes are rejected
- messages with unrelated text do not claim a setup session

## Open Questions

1. should the one-time code be short alphanumeric only, or grouped for easier
   manual entry?
2. should setup permit multiple pending codes per Feishu account, or only one at
   a time?
3. should a successful code claim automatically populate channel allowlists for
   setup-only commands?
