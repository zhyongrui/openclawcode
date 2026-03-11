#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DEFAULT_ENV_FILE="${HOME}/.openclaw/openclawcode.env"
readonly DEFAULT_CONFIG_FILE="${HOME}/.openclaw/openclaw.json"
readonly DEFAULT_STATE_FILE="${HOME}/.openclaw/plugins/openclawcode/chatops-state.json"
readonly DEFAULT_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
readonly DEFAULT_GATEWAY_URL="http://127.0.0.1:${DEFAULT_GATEWAY_PORT}"
readonly DEFAULT_WEBHOOK_ROUTE="/plugins/openclawcode/github"
readonly DEFAULT_GITHUB_REPO="zhyongrui/openclawcode"
readonly DEFAULT_GITHUB_HOOK_EVENTS="issues,pull_request,pull_request_review"
readonly DEFAULT_TUNNEL_LOG_FILE="/tmp/openclawcode-webhook-tunnel.log"
readonly DEFAULT_TUNNEL_PID_FILE="/tmp/openclawcode-webhook-tunnel.pid"

REPO_ROOT="${OPENCLAWCODE_SETUP_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
ENV_FILE="${OPENCLAWCODE_SETUP_ENV_FILE:-${OPENCLAWCODE_WEBHOOK_ENV_FILE:-$DEFAULT_ENV_FILE}}"
CONFIG_FILE="${OPENCLAWCODE_SETUP_CONFIG_FILE:-$DEFAULT_CONFIG_FILE}"
STATE_FILE="${OPENCLAWCODE_SETUP_STATE_FILE:-$DEFAULT_STATE_FILE}"
GATEWAY_URL="${OPENCLAWCODE_SETUP_GATEWAY_URL:-$DEFAULT_GATEWAY_URL}"
WEBHOOK_ROUTE="${OPENCLAWCODE_SETUP_WEBHOOK_ROUTE:-${OPENCLAWCODE_TUNNEL_ROUTE:-$DEFAULT_WEBHOOK_ROUTE}}"
GITHUB_REPO="${OPENCLAWCODE_GITHUB_REPO:-$DEFAULT_GITHUB_REPO}"
GITHUB_HOOK_ID="${OPENCLAWCODE_SETUP_GITHUB_HOOK_ID:-${OPENCLAWCODE_GITHUB_HOOK_ID:-}}"
GITHUB_HOOK_EVENTS="${OPENCLAWCODE_SETUP_GITHUB_HOOK_EVENTS:-${OPENCLAWCODE_GITHUB_HOOK_EVENTS:-$DEFAULT_GITHUB_HOOK_EVENTS}}"
TUNNEL_LOG_FILE="${OPENCLAWCODE_TUNNEL_LOG_FILE:-$DEFAULT_TUNNEL_LOG_FILE}"
TUNNEL_PID_FILE="${OPENCLAWCODE_TUNNEL_PID_FILE:-$DEFAULT_TUNNEL_PID_FILE}"

STRICT_MODE=0
SKIP_ROUTE_PROBE=0

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [--strict] [--skip-route-probe]

Checks:
  - repo root and built CLI artifact
  - env/config/state files used by the local operator flow
  - webhook secret presence
  - GitHub token presence
  - local gateway TCP reachability
  - signed local webhook probe against ${DEFAULT_WEBHOOK_ROUTE}
  - saved repo binding for ${DEFAULT_GITHUB_REPO}
  - tunnel process/url status when using trycloudflare

Environment overrides:
  OPENCLAWCODE_SETUP_REPO_ROOT
  OPENCLAWCODE_SETUP_ENV_FILE
  OPENCLAWCODE_SETUP_CONFIG_FILE
  OPENCLAWCODE_SETUP_STATE_FILE
  OPENCLAWCODE_SETUP_GATEWAY_URL
  OPENCLAWCODE_SETUP_WEBHOOK_ROUTE
  OPENCLAWCODE_GITHUB_REPO
  OPENCLAWCODE_SETUP_GITHUB_HOOK_ID
  OPENCLAWCODE_SETUP_GITHUB_HOOK_EVENTS
  OPENCLAWCODE_TUNNEL_LOG_FILE
  OPENCLAWCODE_TUNNEL_PID_FILE
EOF
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '[PASS] %s\n' "$1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '[WARN] %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '[FAIL] %s\n' "$1"
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "command available: $1"
  else
    fail "missing required command: $1"
  fi
}

is_running_pid() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

find_running_tunnel_pid() {
  python3 - "$GATEWAY_URL" "$TUNNEL_LOG_FILE" <<'PY'
import subprocess
import sys

gateway_url = sys.argv[1]
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
    if gateway_url not in stripped and log_file not in stripped:
        continue
    pid = stripped.split(None, 1)[0]
    if pid.isdigit():
        print(pid)
        raise SystemExit(0)

raise SystemExit(1)
PY
}

current_public_url() {
  if [[ ! -f "$TUNNEL_LOG_FILE" ]]; then
    return 1
  fi
  grep -Eo 'https://[a-z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG_FILE" | tail -n 1
}

load_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    fail "env file missing: ${ENV_FILE}"
    return
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  pass "env file loaded: ${ENV_FILE}"
}

check_repo_root() {
  if [[ -d "$REPO_ROOT" ]]; then
    pass "repo root exists: ${REPO_ROOT}"
  else
    fail "repo root missing: ${REPO_ROOT}"
  fi
}

check_dist_artifact() {
  if [[ -f "${REPO_ROOT}/dist/index.js" ]]; then
    pass "built CLI artifact present: ${REPO_ROOT}/dist/index.js"
  else
    fail "built CLI artifact missing: ${REPO_ROOT}/dist/index.js"
  fi
}

check_config_file() {
  if [[ -f "$CONFIG_FILE" ]]; then
    pass "gateway config file present: ${CONFIG_FILE}"
  else
    warn "gateway config file missing: ${CONFIG_FILE}"
  fi
}

check_webhook_secret() {
  if [[ -n "${OPENCLAWCODE_GITHUB_WEBHOOK_SECRET:-}" ]]; then
    pass "webhook secret present in env"
  else
    fail "webhook secret missing: OPENCLAWCODE_GITHUB_WEBHOOK_SECRET"
  fi
}

check_github_token() {
  if [[ -n "${GH_TOKEN:-}" || -n "${GITHUB_TOKEN:-}" ]]; then
    pass "GitHub token present for webhook sync"
  else
    warn "GH_TOKEN/GITHUB_TOKEN missing; webhook sync checks will be limited"
  fi
}

check_gateway_port() {
  if python3 - "$GATEWAY_URL" <<'PY'
import socket
import sys
from urllib.parse import urlparse

url = urlparse(sys.argv[1])
host = url.hostname or "127.0.0.1"
port = url.port or (443 if url.scheme == "https" else 80)

with socket.create_connection((host, port), timeout=2):
    pass
PY
  then
    pass "gateway reachable: ${GATEWAY_URL}"
  else
    fail "gateway not reachable: ${GATEWAY_URL}"
  fi
}

check_route_probe() {
  if [[ "$SKIP_ROUTE_PROBE" -eq 1 ]]; then
    warn "skipped signed webhook probe"
    return
  fi
  if [[ -z "${OPENCLAWCODE_GITHUB_WEBHOOK_SECRET:-}" ]]; then
    fail "cannot run route probe without OPENCLAWCODE_GITHUB_WEBHOOK_SECRET"
    return
  fi

  local payload
  payload='{"action":"opened","repository":{"owner":"healthcheck","name":"unconfigured-repo"},"issue":{"number":1,"title":"health probe","labels":[]}}'
  local signature
  signature="$(
    python3 - "$payload" "${OPENCLAWCODE_GITHUB_WEBHOOK_SECRET}" <<'PY'
import hashlib
import hmac
import sys

body = sys.argv[1].encode("utf-8")
secret = sys.argv[2].encode("utf-8")
digest = hmac.new(secret, body, hashlib.sha256).hexdigest()
print(f"sha256={digest}")
PY
  )"

  local response
  if ! response="$(
    curl \
      --silent \
      --show-error \
      --connect-timeout 2 \
      --max-time 5 \
      --write-out $'\n%{http_code}' \
      -X POST \
      -H "Content-Type: application/json" \
      -H "X-GitHub-Event: issues" \
      -H "X-Hub-Signature-256: ${signature}" \
      --data "$payload" \
      "${GATEWAY_URL}${WEBHOOK_ROUTE}"
  )"; then
    fail "signed webhook probe failed to reach ${GATEWAY_URL}${WEBHOOK_ROUTE}"
    return
  fi

  local status_code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "$status_code" != "202" ]]; then
    fail "signed webhook probe returned HTTP ${status_code}"
    return
  fi
  if [[ "$body" == *'"reason":"unconfigured-repo"'* ]]; then
    pass "signed webhook probe reached plugin route"
  else
    fail "signed webhook probe returned unexpected body: ${body}"
  fi
}

check_repo_binding() {
  if [[ ! -f "$STATE_FILE" ]]; then
    warn "chatops state file missing: ${STATE_FILE}"
    return
  fi

  local binding=""
  if binding="$(
    python3 - "$STATE_FILE" "$GITHUB_REPO" <<'PY'
import json
import sys

path = sys.argv[1]
repo_key = sys.argv[2]

with open(path, "r", encoding="utf-8") as handle:
    state = json.load(handle)

binding = (state.get("repoBindingsByRepo") or {}).get(repo_key)
if not isinstance(binding, dict):
    raise SystemExit(1)

channel = binding.get("notifyChannel", "unknown")
target = binding.get("notifyTarget", "unknown")
print(f"{channel}:{target}")
PY
  )"; then
    pass "repo binding present for ${GITHUB_REPO}: ${binding}"
  else
    warn "no saved repo binding for ${GITHUB_REPO}; /occode-bind is recommended"
  fi
}

check_github_hook_subscription() {
  if [[ -z "$GITHUB_HOOK_ID" ]]; then
    warn "GitHub hook id missing; webhook event subscription was not verified"
    return
  fi

  local token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [[ -z "$token" ]]; then
    warn "GitHub hook subscription check skipped without GH_TOKEN/GITHUB_TOKEN"
    return
  fi

  local result
  if ! result="$(
    python3 - "$GITHUB_REPO" "$GITHUB_HOOK_ID" "$GITHUB_HOOK_EVENTS" "$token" <<'PY'
import json
import sys
import urllib.request

repo = sys.argv[1]
hook_id = sys.argv[2]
required = [entry.strip() for entry in sys.argv[3].split(",") if entry.strip()]
token = sys.argv[4]

request = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/hooks/{hook_id}",
    headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "openclawcode-setup-check",
    },
)

with urllib.request.urlopen(request) as response:
    body = json.load(response)

events = body.get("events") or []
missing = [entry for entry in required if entry not in events]
print(json.dumps({
    "active": bool(body.get("active")),
    "events": events,
    "missing": missing,
}))
PY
  )"; then
    fail "GitHub webhook subscription check failed for hook ${GITHUB_HOOK_ID}"
    return
  fi

  local summary
  summary="$(
    python3 - "$result" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
missing = payload.get("missing") or []
events = payload.get("events") or []
if not payload.get("active"):
    raise SystemExit(2)
if missing:
    raise SystemExit(3)
print(",".join(events))
PY
  )" || {
    local code=$?
    if [[ "$code" -eq 2 ]]; then
      fail "GitHub webhook ${GITHUB_HOOK_ID} is not active"
    else
      fail "GitHub webhook ${GITHUB_HOOK_ID} is missing required events: ${GITHUB_HOOK_EVENTS}"
    fi
    return
  }

  pass "GitHub webhook ${GITHUB_HOOK_ID} subscribed to required events: ${summary}"
}

check_tunnel_status() {
  local pid=""
  if [[ -f "$TUNNEL_PID_FILE" ]]; then
    pid="$(tr -d '[:space:]' <"$TUNNEL_PID_FILE")"
  fi
  if [[ -z "$pid" ]] || ! is_running_pid "$pid"; then
    pid="$(find_running_tunnel_pid || true)"
  fi

  local url=""
  url="$(current_public_url || true)"
  if [[ -n "$pid" ]] && is_running_pid "$pid" && [[ -n "$url" ]]; then
    pass "trycloudflare tunnel running: ${url}"
    return
  fi
  if [[ -n "$pid" ]] && is_running_pid "$pid"; then
    warn "tunnel pid ${pid} is running, but no public URL was found in ${TUNNEL_LOG_FILE}"
    return
  fi
  warn "trycloudflare tunnel is not running"
}

print_summary_and_exit() {
  printf '\nSummary: %s pass, %s warn, %s fail\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    exit 1
  fi
  if [[ "$STRICT_MODE" -eq 1 && "$WARN_COUNT" -gt 0 ]]; then
    exit 1
  fi
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT_MODE=1
      ;;
    --skip-route-probe)
      SKIP_ROUTE_PROBE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

require_command python3
require_command curl
check_repo_root
check_dist_artifact
load_env_file
check_config_file
check_webhook_secret
check_github_token
check_gateway_port
check_route_probe
check_repo_binding
check_github_hook_subscription
check_tunnel_status
print_summary_and_exit
