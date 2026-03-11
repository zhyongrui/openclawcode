#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly DEFAULT_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
readonly DEFAULT_TARGET_URL="http://127.0.0.1:${DEFAULT_GATEWAY_PORT}"
readonly DEFAULT_ROUTE="/plugins/openclawcode/github"
readonly DEFAULT_LOG_FILE="/tmp/openclawcode-webhook-tunnel.log"
readonly DEFAULT_PID_FILE="/tmp/openclawcode-webhook-tunnel.pid"
readonly DEFAULT_GITHUB_REPO="zhyongrui/openclawcode"
readonly DEFAULT_GITHUB_HOOK_ID="600049842"
readonly DEFAULT_GITHUB_HOOK_EVENTS="issues,pull_request,pull_request_review"
readonly DEFAULT_CLOUDFLARED_BIN="cloudflared"
readonly DEFAULT_ENV_FILE="${HOME}/.openclaw/openclawcode.env"

ENV_FILE="${OPENCLAWCODE_WEBHOOK_ENV_FILE:-$DEFAULT_ENV_FILE}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

CLOUDFLARED_BIN="${OPENCLAWCODE_CLOUDFLARED_BIN:-$DEFAULT_CLOUDFLARED_BIN}"
TARGET_URL="${OPENCLAWCODE_TUNNEL_TARGET_URL:-$DEFAULT_TARGET_URL}"
WEBHOOK_ROUTE="${OPENCLAWCODE_TUNNEL_ROUTE:-$DEFAULT_ROUTE}"
LOG_FILE="${OPENCLAWCODE_TUNNEL_LOG_FILE:-$DEFAULT_LOG_FILE}"
PID_FILE="${OPENCLAWCODE_TUNNEL_PID_FILE:-$DEFAULT_PID_FILE}"
GITHUB_REPO="${OPENCLAWCODE_GITHUB_REPO:-$DEFAULT_GITHUB_REPO}"
GITHUB_HOOK_ID="${OPENCLAWCODE_GITHUB_HOOK_ID:-$DEFAULT_GITHUB_HOOK_ID}"
GITHUB_HOOK_EVENTS="${OPENCLAWCODE_GITHUB_HOOK_EVENTS:-$DEFAULT_GITHUB_HOOK_EVENTS}"

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} <command>

Commands:
  start       Start a trycloudflare tunnel and sync the GitHub webhook URL.
  run         Run the tunnel in the foreground. Use this in a dedicated terminal.
  stop        Stop the managed tunnel process, if one is running.
  restart     Restart the managed tunnel process and sync the GitHub webhook URL.
  sync-hook   Sync the GitHub webhook URL to the current tunnel URL.
  print-url   Print the current public trycloudflare URL.
  status      Print tunnel and webhook status.

Environment:
  GH_TOKEN                          GitHub token with repo webhook access.
  OPENCLAWCODE_CLOUDFLARED_BIN      cloudflared binary path.
  OPENCLAWCODE_TUNNEL_TARGET_URL    Local gateway target. Default: ${DEFAULT_TARGET_URL}
  OPENCLAWCODE_TUNNEL_ROUTE         Webhook route. Default: ${DEFAULT_ROUTE}
  OPENCLAWCODE_TUNNEL_LOG_FILE      Tunnel log path. Default: ${DEFAULT_LOG_FILE}
  OPENCLAWCODE_TUNNEL_PID_FILE      Tunnel pid path. Default: ${DEFAULT_PID_FILE}
  OPENCLAWCODE_GITHUB_REPO          GitHub repo slug. Default: ${DEFAULT_GITHUB_REPO}
  OPENCLAWCODE_GITHUB_HOOK_ID       GitHub webhook id. Default: ${DEFAULT_GITHUB_HOOK_ID}
  OPENCLAWCODE_GITHUB_HOOK_EVENTS   Comma-separated webhook events to keep in sync.
  OPENCLAWCODE_WEBHOOK_ENV_FILE     Env file to source before syncing. Default: ${DEFAULT_ENV_FILE}
EOF
}

ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

is_running_pid() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' <"$PID_FILE"
  fi
}

cleanup_stale_pidfile() {
  local pid
  pid="$(read_pid || true)"
  if [[ -n "$pid" ]] && ! is_running_pid "$pid"; then
    rm -f "$PID_FILE"
  fi
}

find_running_tunnel_pid() {
  python3 - "$TARGET_URL" "$LOG_FILE" <<'PY'
import subprocess
import sys

target_url = sys.argv[1]
log_file = sys.argv[2]

try:
    output = subprocess.run(
        ["ps", "-eo", "pid=,args="],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
except Exception:
    raise SystemExit(1)

for line in output:
    stripped = line.strip()
    if not stripped or "cloudflared" not in stripped or " tunnel " not in f" {stripped} ":
        continue
    if target_url not in stripped and log_file not in stripped:
        continue
    pid = stripped.split(None, 1)[0]
    if pid.isdigit():
        print(pid)
        raise SystemExit(0)

raise SystemExit(1)
PY
}

current_public_url() {
  if [[ ! -f "$LOG_FILE" ]]; then
    return 1
  fi
  grep -Eo 'https://[a-z0-9.-]+\.trycloudflare\.com' "$LOG_FILE" | tail -n 1
}

wait_for_public_url() {
  local attempts="${1:-40}"
  local sleep_seconds="${2:-1}"
  local url=""
  local index

  for ((index = 0; index < attempts; index += 1)); do
    url="$(current_public_url || true)"
    if [[ -n "$url" ]]; then
      printf '%s\n' "$url"
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "Timed out waiting for a trycloudflare URL in ${LOG_FILE}." >&2
  return 1
}

start_tunnel() {
  cleanup_stale_pidfile

  local pid
  pid="$(read_pid || true)"
  if [[ -n "$pid" ]] && is_running_pid "$pid"; then
    return 0
  fi
  pid="$(find_running_tunnel_pid || true)"
  if [[ -n "$pid" ]] && is_running_pid "$pid"; then
    printf '%s\n' "$pid" >"$PID_FILE"
    return 0
  fi

  : >"$LOG_FILE"
  nohup "$CLOUDFLARED_BIN" tunnel \
    --no-autoupdate \
    --url "$TARGET_URL" \
    --pidfile "$PID_FILE" \
    --logfile "$LOG_FILE" \
    --loglevel info \
    >/dev/null 2>&1 &

  local started_pid="$!"
  local index
  for ((index = 0; index < 20; index += 1)); do
    pid="$(read_pid || true)"
    if [[ -n "$pid" ]] && is_running_pid "$pid"; then
      return 0
    fi
    if ! is_running_pid "$started_pid"; then
      echo "cloudflared exited before writing ${PID_FILE}. See ${LOG_FILE}." >&2
      return 1
    fi
    sleep 1
  done

  echo "cloudflared did not create ${PID_FILE}. See ${LOG_FILE}." >&2
  return 1
}

run_tunnel_foreground() {
  ensure_command "$CLOUDFLARED_BIN"
  : >"$LOG_FILE"
  exec "$CLOUDFLARED_BIN" tunnel \
    --no-autoupdate \
    --url "$TARGET_URL" \
    --pidfile "$PID_FILE" \
    --logfile "$LOG_FILE" \
    --loglevel info
}

stop_tunnel() {
  cleanup_stale_pidfile

  local pid
  pid="$(read_pid || true)"
  if [[ -z "$pid" ]]; then
    pid="$(find_running_tunnel_pid || true)"
  fi
  if [[ -z "$pid" ]]; then
    echo "Tunnel is not running."
    return 0
  fi

  if ! is_running_pid "$pid"; then
    rm -f "$PID_FILE"
    echo "Removed stale pid file."
    return 0
  fi

  kill "$pid"
  local index
  for ((index = 0; index < 15; index += 1)); do
    if ! is_running_pid "$pid"; then
      rm -f "$PID_FILE"
      echo "Stopped tunnel pid ${pid}."
      return 0
    fi
    sleep 1
  done

  echo "Tunnel pid ${pid} did not stop after SIGTERM." >&2
  return 1
}

sync_github_hook() {
  ensure_command python3

  if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "GH_TOKEN is required to sync the GitHub webhook URL." >&2
    return 1
  fi

  local public_url
  public_url="$(current_public_url || true)"
  if [[ -z "$public_url" ]]; then
    public_url="$(wait_for_public_url)"
  fi

  local webhook_url="${public_url}${WEBHOOK_ROUTE}"
  python3 - "$GITHUB_REPO" "$GITHUB_HOOK_ID" "$webhook_url" "$GITHUB_HOOK_EVENTS" <<'PY'
import json
import os
import sys
import urllib.request

repo = sys.argv[1]
hook_id = sys.argv[2]
webhook_url = sys.argv[3]
events = [entry.strip() for entry in sys.argv[4].split(",") if entry.strip()]
token = os.environ["GH_TOKEN"]
secret = os.environ.get("OPENCLAWCODE_GITHUB_WEBHOOK_SECRET", "").strip()

api_url = f"https://api.github.com/repos/{repo}/hooks/{hook_id}"
config = {
    "url": webhook_url,
    "content_type": "json",
    "insecure_ssl": "0",
}
if secret:
    config["secret"] = secret

payload = json.dumps({
    "active": True,
    "events": events,
    "config": config,
}).encode("utf-8")
request = urllib.request.Request(
    api_url,
    data=payload,
    method="PATCH",
    headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "openclawcode-webhook-tunnel",
        "Content-Type": "application/json",
    },
)

with urllib.request.urlopen(request) as response:
    body = json.load(response)

print(json.dumps({
    "repo": repo,
    "hookId": body["id"],
    "webhookUrl": body["config"].get("url"),
    "events": body.get("events"),
    "active": body.get("active"),
    "updatedAt": body.get("updated_at"),
}, indent=2))
PY
}

status() {
  cleanup_stale_pidfile

  local pid
  pid="$(read_pid || true)"
  if [[ -z "$pid" ]]; then
    pid="$(find_running_tunnel_pid || true)"
  fi
  local url
  url="$(current_public_url || true)"

  if [[ -n "$pid" ]] && is_running_pid "$pid"; then
    echo "Tunnel: running (pid ${pid})"
  else
    echo "Tunnel: stopped"
  fi

  if [[ -n "$url" ]]; then
    echo "Public URL: ${url}"
    echo "Webhook URL: ${url}${WEBHOOK_ROUTE}"
  else
    echo "Public URL: unavailable"
  fi

  echo "Target URL: ${TARGET_URL}"
  echo "Log file: ${LOG_FILE}"
  echo "Pid file: ${PID_FILE}"
  echo "GitHub repo: ${GITHUB_REPO}"
  echo "GitHub hook id: ${GITHUB_HOOK_ID}"
  echo "GitHub hook events: ${GITHUB_HOOK_EVENTS}"
}

command="${1:-}"
case "$command" in
  start)
    ensure_command "$CLOUDFLARED_BIN"
    start_tunnel
    wait_for_public_url >/dev/null
    sync_github_hook
    status
    ;;
  run)
    run_tunnel_foreground
    ;;
  stop)
    stop_tunnel
    ;;
  restart)
    ensure_command "$CLOUDFLARED_BIN"
    stop_tunnel || true
    start_tunnel
    wait_for_public_url >/dev/null
    sync_github_hook
    status
    ;;
  sync-hook)
    sync_github_hook
    ;;
  print-url)
    current_public_url
    ;;
  status)
    status
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: ${command}" >&2
    usage >&2
    exit 1
    ;;
esac
