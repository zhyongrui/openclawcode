# OpenClawCode Webhook Operations

Use this runbook when `openclawcode` is exposed through an anonymous
`trycloudflare` tunnel instead of a fixed public domain.

Start with `operator-setup.md` first.
This page only covers the temporary ingress helper and webhook URL rotation.

## One-Time GitHub Webhook Shape

The helper rewrites an existing repo webhook URL.
It does not create the webhook for you.

Create or update the GitHub repo webhook with:

- content type: `application/json`
- secret: the same value as `OPENCLAWCODE_GITHUB_WEBHOOK_SECRET`
- events:
  - `issues`
  - `pull_request`
  - `pull_request_review`

## Managed Tunnel Script

The repository now includes:

```bash
scripts/openclawcode-webhook-tunnel.sh
```

It manages three things together:

1. starts a `cloudflared tunnel --url http://127.0.0.1:18789`
2. extracts the current `https://*.trycloudflare.com` URL from the tunnel log
3. updates the GitHub repository webhook to point at:
   `https://<public-host>/plugins/openclawcode/github`

## Required Environment

Before using the script, make sure these are available in the shell:

```bash
export GH_TOKEN=...
```

Optional overrides:

```bash
export OPENCLAW_GATEWAY_PORT=18789
export OPENCLAWCODE_GITHUB_REPO=zhyongrui/openclawcode
export OPENCLAWCODE_GITHUB_HOOK_ID=600049842
export OPENCLAWCODE_GITHUB_HOOK_EVENTS=issues,pull_request,pull_request_review
```

## Common Commands

Start the tunnel and sync the GitHub webhook URL:

```bash
./scripts/openclawcode-webhook-tunnel.sh start
```

If you want to keep the tunnel in a dedicated terminal or `tmux` pane, run it in
the foreground instead:

```bash
./scripts/openclawcode-webhook-tunnel.sh run
```

Show the current public URL and tracked webhook target:

```bash
./scripts/openclawcode-webhook-tunnel.sh status
```

If the tunnel URL changes but the process is still running, resync only the
GitHub webhook:

```bash
./scripts/openclawcode-webhook-tunnel.sh sync-hook
```

In this temporary-ingress flow, `sync-hook` rewrites the current quick-tunnel
webhook URL and also re-applies:

- `OPENCLAWCODE_GITHUB_WEBHOOK_SECRET` from `~/.openclaw/openclawcode.env`,
  when that variable is present
- the configured GitHub event set from `OPENCLAWCODE_GITHUB_HOOK_EVENTS`

That helps avoid both:

- `401 Invalid signature` after a tunnel rotation
- stale webhook subscriptions that only deliver `issues` while missing
  `pull_request` or `pull_request_review`

Restart the tunnel and resync the webhook:

```bash
./scripts/openclawcode-webhook-tunnel.sh restart
```

Stop the managed tunnel:

```bash
./scripts/openclawcode-webhook-tunnel.sh stop
```

## Recommended Session Startup

When using the temporary ingress mode, start services in this order:

1. start the local OpenClaw gateway
2. run `./scripts/openclawcode-webhook-tunnel.sh start`
3. run `./scripts/openclawcode-setup-check.sh`
4. create or redeliver a GitHub issue, PR, or review webhook event
5. approve with `/occode-start #<issue>` in Feishu when running in
   `triggerMode: "approve"`

## Limitation

This mode is operationally useful but not truly stable:

- the `trycloudflare` hostname can change whenever the tunnel restarts
- the GitHub webhook must therefore be resynced after each restart

The script removes the manual webhook-edit step, but it does not eliminate the
temporary-domain dependency itself.
