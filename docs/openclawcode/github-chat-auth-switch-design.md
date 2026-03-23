# GitHub Chat-Native Re-Auth Design

## Problem

Today, when `/occode-setup` detects that GitHub auth exists but the logged-in
`gh` account is wrong for the operator's intent, OpenClaw Code tells the user
to go back to the host and run commands like:

- `gh auth logout --hostname github.com --user <user>`
- `gh auth login --hostname github.com --web`

That breaks the chat-native setup story.

From the operator's point of view, the setup task is still "finish OpenClaw Code
setup in chat". Asking the operator to drop back to the shell to repair `gh`
auth turns one task into two disconnected tasks.

## Desired Product Behavior

If the GitHub account is wrong, the operator should be able to fix it entirely
from chat, without touching the host shell.

OpenClaw should:

1. detect that the current `gh` login is wrong or likely wrong
2. offer a chat-native account switch flow
3. run the host-side `gh auth logout` / `gh auth login --web` steps itself
4. send the device-flow URL and one-time code back to the same chat
5. poll for completion
6. automatically continue the interrupted `/occode-setup` flow after auth is
   repaired

This is especially important for the "login succeeded, but the account is still
wrong" case. In that case, the product should not stop at a message like:

- GitHub auth is ready
- current account: `zhyongrui`
- wrong account? run `gh auth logout` / `gh auth login` on the host

Instead, that message should be replaced with a chat-native recovery path.

## Why `owner/repo` Still Matters

GitHub login identity and repo target are not the same thing.

- `gh auth login` answers: who is the current authenticated GitHub user?
- `/occode-setup owner/repo` answers: which repository should this chat bind to?

The owner is still required because the logged-in user may operate:

- their own repos
- org repos
- collaborator repos owned by someone else

That said, UX can still improve by allowing shorthand when it is safe:

- `/occode-setup repo-name`
- resolve to `<current-gh-user>/repo-name` when the intent is unambiguous

Internally, the system should still normalize to a full `owner/repo` key.

## Proposed UX

### Current setup command

Operator sends:

```text
/occode-setup owner/repo
```

### If the current GitHub account looks wrong

OpenClaw replies with a structured status message such as:

- current GitHub account: `zhyongrui`
- requested repo: `other-org/project`
- current account may not match the intended operator account or may not have
  access to the target repo
- continue here with:
  - `/occode-github-switch`
  - `/occode-github-status`

### If login already succeeded, but the account is still wrong

This is the most important UX correction.

Current behavior often becomes:

1. OpenClaw confirms GitHub auth is ready
2. OpenClaw shows the detected GitHub username
3. OpenClaw tells the operator to go back to the host and rerun `gh`

Proposed behavior should instead be:

1. OpenClaw confirms GitHub auth is present
2. OpenClaw detects that the current account is wrong for the setup intent
3. OpenClaw offers an in-chat switch action immediately
4. OpenClaw performs host-side re-auth itself
5. OpenClaw resumes setup automatically after the new account is ready

In other words, "wrong account after login" should still be treated as an
incomplete setup session, not as a handoff back to the shell.

### Chat-native switch flow

Operator sends:

```text
/occode-github-switch
```

OpenClaw then:

1. stores the interrupted setup session context
2. logs out the current GitHub account on the host if needed
3. starts `gh auth login --hostname github.com --web`
4. posts the device-flow URL and code back to the same chat
5. waits for login completion
6. announces the new GitHub user
7. resumes the original `/occode-setup owner/repo` automatically

### Status / recovery commands

Recommended companion commands:

- `/occode-github-status`
  - report current host `gh auth` user, auth source, and whether setup can continue
- `/occode-github-switch`
  - start a chat-native GitHub account switch flow
- `/occode-github-logout`
  - clear current GitHub auth on the host
- `/occode-setup-status`
  - report the current setup session state and next action

## Setup Session State Model

The setup session should be explicit and resumable. Suggested states:

- `pairing-blocked`
- `github-auth-missing`
- `github-auth-wrong-account`
- `github-auth-in-progress`
- `repo-binding-pending`
- `bootstrap-running`
- `bootstrap-failed`
- `bootstrap-complete`

This lets `/occode-setup-status` return a real workflow state instead of a
collection of loosely related hints.

Example:

- state: `github-auth-wrong-account`
- current GitHub user: `zhyongrui`
- requested repo: `owner/repo`
- next action: `/occode-github-switch`

## Detection Rules

OpenClaw should not rely only on "logged-in username != repo owner" because
that is insufficient for org and collaborator repos.

Instead, classify auth as potentially wrong when one or more of these are true:

1. no `gh auth` session exists
2. the operator explicitly says the account is wrong
3. repo access checks fail for the requested `owner/repo`
4. webhook/bootstrap permissions are missing for the requested repo
5. the current account differs from the operator's expected account and the
   operator asks to switch

Detection should run both:

- before GitHub login starts
- after GitHub login completes

That second check is what closes the "account wrong after successful login"
gap.

This keeps the UX accurate for both personal repos and org repos.

## Security Constraints

Chat-native GitHub re-auth should only run when:

- the chat has already passed pairing / operator gating
- the request comes from an approved operator target
- the flow is tied to one active setup session

And it should never:

- send tokens back into chat
- echo sensitive credential material
- silently replace a working account without operator intent

Recommended safety rules:

- show a confirmation step before logout/switch
- only post device-flow URL + code
- only report the resulting GitHub username after completion
- expire interrupted switch sessions after a short timeout

## Recovery Behavior

If the login flow expires or fails:

- the session should remain resumable
- `/occode-setup-status` should show the failure reason
- `/occode-github-switch` should start a fresh login
- after successful re-auth, the original setup should continue automatically

The operator should not need to remember to resend the entire original command
unless the session itself was cancelled.

## Suggested Implementation Shape

### New chat commands

Add chat-native commands in the bundled `openclawcode` plugin:

- `/occode-github-status`
- `/occode-github-switch`
- `/occode-github-logout`

### New setup-session fields

Persist enough state to resume correctly:

- current setup stage
- requested repo key
- previous GitHub username
- current GitHub username
- login attempt started at
- login attempt expiry
- resume command payload
- last failure reason

### Host integration layer

Expose a focused helper that wraps:

- `gh auth status`
- `gh auth logout`
- `gh auth login --web`
- login completion polling / inspection

This should be treated as a setup primitive, not as ad hoc shell guidance.

### Automatic resume

When GitHub login completes successfully:

- refresh setup session state
- send a proactive chat message that the account is ready
- continue the stored repo-binding/bootstrap flow automatically

## Operator Experience Goal

The ideal operator experience should be:

1. send `/occode-setup owner/repo`
2. OpenClaw notices the GitHub account is wrong
3. OpenClaw offers `/occode-github-switch`
4. operator confirms in chat
5. OpenClaw runs host-side re-auth and sends the browser code in chat
6. operator finishes login in browser
7. OpenClaw reports the new GitHub account in chat
8. OpenClaw resumes setup automatically

The operator should not need to SSH back into the host just to repair `gh`
auth for a flow that is otherwise already chat-native.
