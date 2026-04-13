---
summary: "Feishu bot overview, features, and configuration"
read_when:
  - You want to connect a Feishu/Lark bot
  - You are configuring the Feishu channel
title: Feishu
---

# Feishu / Lark

Feishu/Lark is an all-in-one collaboration platform where teams chat, share documents, manage calendars, and get work done together.

**Status:** production-ready for bot DMs + group chats. WebSocket is the default mode; webhook mode is optional.

---

## Bundled plugin

Feishu ships bundled with current OpenClaw releases, so no separate plugin install
is required.

If you are using an older build or a custom install that does not include bundled
Feishu, install it manually:

```bash
openclaw plugins install @openclaw/feishu
```

---

## Quickstart

There are two ways to add the Feishu channel:

### Method 1: onboarding (recommended)

If you just installed OpenClaw, run onboarding:

```bash
openclaw onboard
```

The wizard guides you through:

1. Creating a Feishu app and collecting credentials
2. Configuring app credentials in OpenClaw
3. Starting the gateway

✅ **After configuration**, check gateway status:

- `openclaw gateway status`
- `openclaw logs --follow`
- open your Feishu bot and tap **Quick actions** once if you want OpenClaw to
  remember that DM as the preferred operator chat target for later
  openclawcode setup

### Method 2: CLI setup

If you already completed initial install, add the channel via CLI:

```bash
openclaw channels add
```

Choose **Feishu**, then enter the App ID and App Secret.

✅ **After configuration**, manage the gateway:

- `openclaw gateway status`
- `openclaw gateway restart`
- `openclaw logs --follow`
- open your Feishu bot and tap **Quick actions** once if you want OpenClaw to
  remember that DM as the preferred operator chat target for later
  openclawcode setup

---

## openclawcode operator binding

When the bundled `openclawcode` plugin is enabled, Feishu operator binding can
be configured in three ways:

- work email
- mobile number
- scan the bot and send a setup code

Email and mobile are the preferred operator-discovery paths. Scan-code binding
remains a fallback for environments where the operator cannot be resolved from
contact data.

After the operator is resolved to a Feishu `open_id`, OpenClaw should:

1. persist the preferred operator target
2. add the operator to the Feishu DM allowlist when pairing mode requires it
3. optionally send exactly one proactive welcome message

### Welcome-message dedupe design

The proactive welcome message must be treated as a side effect of binding, not
as part of the binding transaction itself. Binding success must not depend on
whether the welcome message send succeeds.

To avoid repeated greetings after restarts, retries, or mixed binding paths
(email first, scan later), the welcome send should be guarded by a durable
receipt store keyed by:

- `channel`
- `accountId`
- `operatorTarget` such as `user:ou_xxx`
- `templateId` such as `openclawcode.feishu.operator-welcome.v1`

The binding source must not be part of the dedupe key. The same operator should
not receive multiple "first welcome" messages just because the system learned
their identity through a different path later.

Each receipt should record:

- `status`: `sending | sent | failed | unknown`
- `source`
- `firstAttemptAt`
- `lastAttemptAt`
- `sentAt`
- `messageId`
- `attemptCount`
- `lastError`

Recommended status rules:

- `sent`: never auto-send this template again for the same operator target
- `failed`: retry conservatively with backoff
- `unknown`: assume the message may already have been delivered; do not
  auto-retry

`unknown` is important for crash safety. If the process dies after calling the
send API but before persisting success, OpenClaw should prefer a possible missed
greeting over a likely duplicate greeting.

### Concurrency and retries

Welcome receipts should be protected by the same kind of file-locking discipline
used for other durable JSON state. This prevents duplicate sends when:

- startup auto-binding is running
- a scan-code claim arrives at the same time
- multiple retries race after a transient Feishu error

Only explicit `failed` states should be retried automatically, with conservative
backoff. `unknown` should require manual intervention or an explicit resend
action.

### Migration rule

Do not backfill welcome messages for historical bindings when the receipt store
is introduced. Existing operator bindings should be treated as already adopted.
Only new binding events should trigger the proactive welcome flow.

---

## Step 1: Create a Feishu app

### 1. Open Feishu Open Platform

Visit [Feishu Open Platform](https://open.feishu.cn/app) and sign in.

Lark (global) tenants should use [https://open.larksuite.com/app](https://open.larksuite.com/app) and set `domain: "lark"` in the Feishu config.

### 2. Create an app

1. Click **Create enterprise app**
2. Fill in the app name + description
3. Choose an app icon

![Create enterprise app](/images/feishu-step2-create-app.png)

### 3. Copy credentials

From **Credentials & Basic Info**, copy:

- **App ID** (format: `cli_xxx`)
- **App Secret**

❗ **Important:** keep the App Secret private.

![Get credentials](/images/feishu-step3-credentials.png)

### 4. Configure permissions

On **Permissions**, click **Batch import** and paste:

```json
{
  "scopes": {
    "tenant": [
      "aily:file:read",
      "aily:file:write",
      "application:application.app_message_stats.overview:readonly",
      "application:application:self_manage",
      "application:bot.menu:write",
      "cardkit:card:read",
      "cardkit:card:write",
      "contact:user.employee_id:readonly",
      "corehr:file:download",
      "event:ip_list",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.members:bot_access",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource"
    ],
    "user": ["aily:file:read", "aily:file:write", "im:chat.access_event.bot_p2p_chat:read"]
  }
}
```

![Configure permissions](/images/feishu-step4-permissions.png)

### 5. Enable bot capability

In **App Capability** > **Bot**:

1. Enable bot capability
2. Set the bot name

![Enable bot capability](/images/feishu-step5-bot-capability.png)

### 6. Configure event subscription

⚠️ **Important:** before setting event subscription, make sure:

1. You already ran `openclaw channels add` for Feishu
2. The gateway is running (`openclaw gateway status`)

In **Event Subscription**:

1. Choose **Use long connection to receive events** (WebSocket)
2. Add the event: `im.message.receive_v1`
3. (Optional) For Drive comment workflows, also add: `drive.notice.comment_add_v1`

⚠️ If the gateway is not running, the long-connection setup may fail to save.

![Configure event subscription](/images/feishu-step6-event-subscription.png)

### 7. Publish the app

1. Create a version in **Version Management & Release**
2. Submit for review and publish
3. Wait for admin approval (enterprise apps usually auto-approve)

---

## Step 2: Configure OpenClaw

### Configure with the wizard (recommended)

```bash
openclaw channels add
```

Choose **Feishu** and paste your App ID + App Secret.

### Configure via config file

Edit `~/.openclaw/openclaw.json`:

```json5
{
  channels: {
    feishu: {
      enabled: true,
      dmPolicy: "pairing",
      accounts: {
        main: {
          appId: "cli_xxx",
          appSecret: "xxx",
          name: "My AI assistant",
        },
      },
    },
  },
}
```

If you use `connectionMode: "webhook"`, set both `verificationToken` and `encryptKey`. The Feishu webhook server binds to `127.0.0.1` by default; set `webhookHost` only if you intentionally need a different bind address.

#### Verification Token and Encrypt Key (webhook mode)

When using webhook mode, set both `channels.feishu.verificationToken` and `channels.feishu.encryptKey` in your config. To get the values:

1. In Feishu Open Platform, open your app
2. Go to **Development** → **Events & Callbacks** (开发配置 → 事件与回调)
3. Open the **Encryption** tab (加密策略)
4. Copy **Verification Token** and **Encrypt Key**

The screenshot below shows where to find the **Verification Token**. The **Encrypt Key** is listed in the same **Encryption** section.

![Verification Token location](/images/feishu-verification-token.png)

### Configure via environment variables

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

### Lark (global) domain

If your tenant is on Lark (international), set the domain to `lark` (or a full domain string). You can set it at `channels.feishu.domain` or per account (`channels.feishu.accounts.<id>.domain`).

```json5
{
  channels: {
    feishu: {
      domain: "lark",
      accounts: {
        main: {
          appId: "cli_xxx",
          appSecret: "xxx",
        },
      },
    },
  },
}
```

### Quota optimization flags

You can reduce Feishu API usage with two optional flags:

- `typingIndicator` (default `true`): when `false`, skip typing reaction calls.
- `resolveSenderNames` (default `true`): when `false`, skip sender profile lookup calls.

Set them at top level or per account:

```json5
{
  channels: {
    feishu: {
      typingIndicator: false,
      resolveSenderNames: false,
      accounts: {
        main: {
          appId: "cli_xxx",
          appSecret: "xxx",
          typingIndicator: true,
          resolveSenderNames: false,
        },
      },
    },
  },
}
```

---

## Step 3: Start + test

### 1. Start the gateway

```bash
openclaw gateway
```

### 2. Send a test message

In Feishu, find your bot and send a message.

### 3. Approve pairing

By default, the bot replies with a pairing code. Approve it:

```bash
openclaw pairing approve feishu <CODE>
```

After approval, you can chat normally.

---

## Overview

- **Feishu bot channel**: Feishu bot managed by the gateway
- **Deterministic routing**: replies always return to Feishu
- **Session isolation**: DMs share a main session; groups are isolated
- **WebSocket connection**: long connection via Feishu SDK, no public URL needed

---

## Access control

### Direct messages

Configure `dmPolicy` to control who can DM the bot:

- `"pairing"` — unknown users receive a pairing code; approve via CLI
- `"allowlist"` — only users listed in `allowFrom` can chat (default: bot owner only)
- `"open"` — allow all users
- `"disabled"` — disable all DMs

**Approve a pairing request:**

```bash
openclaw pairing list feishu
openclaw pairing approve feishu <CODE>
```

### Group chats

**Group policy** (`channels.feishu.groupPolicy`):

| Value         | Behavior                                   |
| ------------- | ------------------------------------------ |
| `"open"`      | Respond to all messages in groups          |
| `"allowlist"` | Only respond to groups in `groupAllowFrom` |
| `"disabled"`  | Disable all group messages                 |

Default: `allowlist`

**Mention requirement** (`channels.feishu.requireMention`):

- `true` — require @mention (default)
- `false` — respond without @mention
- Per-group override: `channels.feishu.groups.<chat_id>.requireMention`

---

## Group configuration examples

### Allow all groups, no @mention required

```json5
{
  channels: {
    feishu: {
      groupPolicy: "open",
    },
  },
}
```

### Allow all groups, still require @mention

```json5
{
  channels: {
    feishu: {
      groupPolicy: "open",
      requireMention: true,
    },
  },
}
```

### Allow specific groups only

```json5
{
  channels: {
    feishu: {
      groupPolicy: "allowlist",
      // Group IDs look like: oc_xxx
      groupAllowFrom: ["oc_xxx", "oc_yyy"],
    },
  },
}
```

### Restrict senders within a group

```json5
{
  channels: {
    feishu: {
      groupPolicy: "allowlist",
      groupAllowFrom: ["oc_xxx"],
      groups: {
        oc_xxx: {
          // User open_ids look like: ou_xxx
          allowFrom: ["ou_user1", "ou_user2"],
        },
      },
    },
  },
}
```

---

## Get group/user IDs

### Group IDs (`chat_id`, format: `oc_xxx`)

Open the group in Feishu/Lark, click the menu icon in the top-right corner, and go to **Settings**. The group ID (`chat_id`) is listed on the settings page.

![Get Group ID](/images/feishu-get-group-id.png)

### User IDs (`open_id`, format: `ou_xxx`)

Start the gateway, send a DM to the bot, then check the logs:

```bash
openclaw logs --follow
```

Look for `open_id` in the log output. You can also check pending pairing requests:

```bash
openclaw pairing list feishu
```

---

## Common commands

| Command   | Description                 |
| --------- | --------------------------- |
| `/status` | Show bot status             |
| `/reset`  | Reset the current session   |
| `/model`  | Show or switch the AI model |

> Feishu/Lark does not support native slash-command menus, so send these as plain text messages.

---

## Troubleshooting

### Bot does not respond in group chats

1. Ensure the bot is added to the group
2. Ensure you @mention the bot (required by default)
3. Verify `groupPolicy` is not `"disabled"`
4. Check logs: `openclaw logs --follow`

### Bot does not receive messages

1. Ensure the bot is published and approved in Feishu Open Platform / Lark Developer
2. Ensure event subscription includes `im.message.receive_v1`
3. Ensure **persistent connection** (WebSocket) is selected
4. Ensure all required permission scopes are granted
5. Ensure the gateway is running: `openclaw gateway status`
6. Check logs: `openclaw logs --follow`

### App Secret leaked

1. Reset the App Secret in Feishu Open Platform / Lark Developer
2. Update the value in your config
3. Restart the gateway: `openclaw gateway restart`

---

## Advanced configuration

### Multiple accounts

```json5
{
  channels: {
    feishu: {
      defaultAccount: "main",
      accounts: {
        main: {
          appId: "cli_xxx",
          appSecret: "xxx",
          name: "Primary bot",
        },
        backup: {
          appId: "cli_yyy",
          appSecret: "yyy",
          name: "Backup bot",
          enabled: false,
        },
      },
    },
  },
}
```

`defaultAccount` controls which account is used when outbound APIs do not specify an `accountId`.

### Message limits

- `textChunkLimit` — outbound text chunk size (default: `2000` chars)
- `mediaMaxMb` — media upload/download limit (default: `30` MB)

### Streaming

Feishu/Lark supports streaming replies via interactive cards. When enabled, the bot updates the card in real time as it generates text.

```json5
{
  channels: {
    feishu: {
      streaming: true, // enable streaming card output (default: true)
      blockStreaming: true, // enable block-level streaming (default: true)
    },
  },
}
```

Set `streaming: false` to send the complete reply in one message.

### Quota optimization

Reduce the number of Feishu/Lark API calls with two optional flags:

- `typingIndicator` (default `true`): set `false` to skip typing reaction calls
- `resolveSenderNames` (default `true`): set `false` to skip sender profile lookups

```json5
{
  channels: {
    feishu: {
      typingIndicator: false,
      resolveSenderNames: false,
    },
  },
}
```

### ACP sessions

Feishu/Lark supports ACP for DMs and group thread messages. Feishu/Lark ACP is text-command driven — there are no native slash-command menus, so use `/acp ...` messages directly in the conversation.

#### Persistent ACP binding

```json5
{
  agents: {
    list: [
      {
        id: "codex",
        runtime: {
          type: "acp",
          acp: {
            agent: "codex",
            backend: "acpx",
            mode: "persistent",
            cwd: "/workspace/openclaw",
          },
        },
      },
    ],
  },
  bindings: [
    {
      type: "acp",
      agentId: "codex",
      match: {
        channel: "feishu",
        accountId: "default",
        peer: { kind: "direct", id: "ou_1234567890" },
      },
    },
    {
      type: "acp",
      agentId: "codex",
      match: {
        channel: "feishu",
        accountId: "default",
        peer: { kind: "group", id: "oc_group_chat:topic:om_topic_root" },
      },
      acp: { label: "codex-feishu-topic" },
    },
  ],
}
```

#### Spawn ACP from chat

In a Feishu/Lark DM or thread:

```text
/acp spawn codex --thread here
```

`--thread here` works for DMs and Feishu/Lark thread messages. Follow-up messages in the bound conversation route directly to that ACP session.

### Multi-agent routing

Use `bindings` to route Feishu/Lark DMs or groups to different agents.

```json5
{
  agents: {
    list: [
      { id: "main" },
      { id: "agent-a", workspace: "/home/user/agent-a" },
      { id: "agent-b", workspace: "/home/user/agent-b" },
    ],
  },
  bindings: [
    {
      agentId: "agent-a",
      match: {
        channel: "feishu",
        peer: { kind: "direct", id: "ou_xxx" },
      },
    },
    {
      agentId: "agent-b",
      match: {
        channel: "feishu",
        peer: { kind: "group", id: "oc_zzz" },
      },
    },
  ],
}
```

Routing fields:

- `match.channel`: `"feishu"`
- `match.peer.kind`: `"direct"` (DM) or `"group"` (group chat)
- `match.peer.id`: user Open ID (`ou_xxx`) or group ID (`oc_xxx`)

See [Get group/user IDs](#get-groupuser-ids) for lookup tips.

---

## Configuration reference

Full configuration: [Gateway configuration](/gateway/configuration)

| Setting                                           | Description                                | Default          |
| ------------------------------------------------- | ------------------------------------------ | ---------------- |
| `channels.feishu.enabled`                         | Enable/disable the channel                 | `true`           |
| `channels.feishu.domain`                          | API domain (`feishu` or `lark`)            | `feishu`         |
| `channels.feishu.connectionMode`                  | Event transport (`websocket` or `webhook`) | `websocket`      |
| `channels.feishu.defaultAccount`                  | Default account for outbound routing       | `default`        |
| `channels.feishu.verificationToken`               | Required for webhook mode                  | —                |
| `channels.feishu.encryptKey`                      | Required for webhook mode                  | —                |
| `channels.feishu.webhookPath`                     | Webhook route path                         | `/feishu/events` |
| `channels.feishu.webhookHost`                     | Webhook bind host                          | `127.0.0.1`      |
| `channels.feishu.webhookPort`                     | Webhook bind port                          | `3000`           |
| `channels.feishu.accounts.<id>.appId`             | App ID                                     | —                |
| `channels.feishu.accounts.<id>.appSecret`         | App Secret                                 | —                |
| `channels.feishu.accounts.<id>.domain`            | Per-account domain override                | `feishu`         |
| `channels.feishu.dmPolicy`                        | DM policy                                  | `allowlist`      |
| `channels.feishu.allowFrom`                       | DM allowlist (open_id list)                | [BotOwnerId]     |
| `channels.feishu.groupPolicy`                     | Group policy                               | `allowlist`      |
| `channels.feishu.groupAllowFrom`                  | Group allowlist                            | —                |
| `channels.feishu.requireMention`                  | Require @mention in groups                 | `true`           |
| `channels.feishu.groups.<chat_id>.requireMention` | Per-group @mention override                | inherited        |
| `channels.feishu.groups.<chat_id>.enabled`        | Enable/disable a specific group            | `true`           |
| `channels.feishu.textChunkLimit`                  | Message chunk size                         | `2000`           |
| `channels.feishu.mediaMaxMb`                      | Media size limit                           | `30`             |
| `channels.feishu.streaming`                       | Streaming card output                      | `true`           |
| `channels.feishu.blockStreaming`                  | Block-level streaming                      | `true`           |
| `channels.feishu.typingIndicator`                 | Send typing reactions                      | `true`           |
| `channels.feishu.resolveSenderNames`              | Resolve sender display names               | `true`           |

---

## Supported message types

### Receive

- ✅ Text
- ✅ Rich text (post)
- ✅ Images
- ✅ Files
- ✅ Audio
- ✅ Video/media
- ✅ Stickers

### Send

- ✅ Text
- ✅ Images
- ✅ Files
- ✅ Audio
- ✅ Video/media
- ✅ Interactive cards (including streaming updates)
- ⚠️ Rich text (post-style formatting; doesn't support full Feishu/Lark authoring capabilities)

### Threads and replies

- ✅ Inline replies
- ✅ Thread replies
- ✅ Media replies stay thread-aware when replying to a thread message

---

## Related

- [Channels Overview](/channels) — all supported channels
- [Pairing](/channels/pairing) — DM authentication and pairing flow
- [Groups](/channels/groups) — group chat behavior and mention gating
- [Channel Routing](/channels/channel-routing) — session routing for messages
- [Security](/gateway/security) — access model and hardening
