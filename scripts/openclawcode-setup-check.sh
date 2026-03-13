#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DEFAULT_OPERATOR_ROOT="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}"
readonly DEFAULT_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
readonly DEFAULT_GATEWAY_URL="http://127.0.0.1:${DEFAULT_GATEWAY_PORT}"
readonly DEFAULT_WEBHOOK_ROUTE="/plugins/openclawcode/github"
readonly DEFAULT_GITHUB_REPO="zhyongrui/openclawcode"
readonly DEFAULT_GITHUB_HOOK_EVENTS="issues,pull_request,pull_request_review"
readonly DEFAULT_TUNNEL_LOG_FILE="/tmp/openclawcode-webhook-tunnel.log"
readonly DEFAULT_TUNNEL_PID_FILE="/tmp/openclawcode-webhook-tunnel.pid"
readonly DEFAULT_RETRY_ATTEMPTS="${OPENCLAWCODE_SETUP_RETRY_ATTEMPTS:-5}"
readonly DEFAULT_RETRY_DELAY_SECONDS="${OPENCLAWCODE_SETUP_RETRY_DELAY_SECONDS:-1}"
readonly DEFAULT_MINIMUM_NODE_VERSION="22.16.0"

REPO_ROOT="${OPENCLAWCODE_SETUP_REPO_ROOT:-$DEFAULT_REPO_ROOT}"
OPERATOR_ROOT="${OPENCLAWCODE_SETUP_OPERATOR_ROOT:-${OPENCLAWCODE_OPERATOR_ROOT:-$DEFAULT_OPERATOR_ROOT}}"
ENV_FILE="${OPENCLAWCODE_SETUP_ENV_FILE:-${OPENCLAWCODE_WEBHOOK_ENV_FILE:-${OPERATOR_ROOT}/openclawcode.env}}"
CONFIG_FILE="${OPENCLAWCODE_SETUP_CONFIG_FILE:-${OPERATOR_ROOT}/openclaw.json}"
STATE_FILE="${OPENCLAWCODE_SETUP_STATE_FILE:-${OPERATOR_ROOT}/plugins/openclawcode/chatops-state.json}"
CLI_STARTUP_METADATA_FILE="${OPENCLAWCODE_SETUP_CLI_STARTUP_METADATA_FILE:-${REPO_ROOT}/dist/cli-startup-metadata.json}"
GATEWAY_URL="${OPENCLAWCODE_SETUP_GATEWAY_URL:-$DEFAULT_GATEWAY_URL}"
WEBHOOK_ROUTE="${OPENCLAWCODE_SETUP_WEBHOOK_ROUTE:-${OPENCLAWCODE_TUNNEL_ROUTE:-$DEFAULT_WEBHOOK_ROUTE}}"
GITHUB_REPO="$DEFAULT_GITHUB_REPO"
GITHUB_HOOK_ID=""
GITHUB_HOOK_EVENTS="$DEFAULT_GITHUB_HOOK_EVENTS"
TUNNEL_LOG_FILE="${OPENCLAWCODE_TUNNEL_LOG_FILE:-$DEFAULT_TUNNEL_LOG_FILE}"
TUNNEL_PID_FILE="${OPENCLAWCODE_TUNNEL_PID_FILE:-$DEFAULT_TUNNEL_PID_FILE}"

STRICT_MODE=0
SKIP_ROUTE_PROBE=0
OUTPUT_JSON=0

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
LAST_RETRY_ERROR=""
RESULTS_FILE="${TMPDIR:-/tmp}/openclawcode-setup-check-results.$$"
MODEL_INVENTORY_JSON='{"available":0,"keys":[],"configuredFallbacks":[],"fallbackReady":false}'
READINESS_JSON='{"basic":false,"strict":false,"lowRiskProofReady":false,"fallbackProofReady":false,"promotionReady":false,"nextAction":"fix-failing-checks"}'

: >"$RESULTS_FILE"

cleanup() {
  rm -f "$RESULTS_FILE"
}

trap cleanup EXIT

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [--strict] [--skip-route-probe] [--json]

Checks:
  - repo root and built CLI artifact
  - local Node version satisfies the CLI startup floor
  - env/config/state files used by the local operator flow
  - webhook secret presence
  - GitHub token presence
  - local gateway TCP reachability
  - signed local webhook probe against ${DEFAULT_WEBHOOK_ROUTE}
  - saved repo binding for ${DEFAULT_GITHUB_REPO}
  - tunnel process/url status when using trycloudflare

Environment overrides:
  OPENCLAWCODE_SETUP_REPO_ROOT
  OPENCLAWCODE_SETUP_OPERATOR_ROOT
  OPENCLAWCODE_SETUP_ENV_FILE
  OPENCLAWCODE_SETUP_CONFIG_FILE
  OPENCLAWCODE_SETUP_STATE_FILE
  OPENCLAWCODE_SETUP_CLI_STARTUP_METADATA_FILE
  OPENCLAWCODE_SETUP_GATEWAY_URL
  OPENCLAWCODE_SETUP_WEBHOOK_ROUTE
  OPENCLAWCODE_GITHUB_REPO
  OPENCLAWCODE_SETUP_GITHUB_HOOK_ID
  OPENCLAWCODE_SETUP_GITHUB_HOOK_EVENTS
  OPENCLAWCODE_SETUP_RETRY_ATTEMPTS
  OPENCLAWCODE_SETUP_RETRY_DELAY_SECONDS
  OPENCLAWCODE_TUNNEL_LOG_FILE
  OPENCLAWCODE_TUNNEL_PID_FILE
  OPENCLAWCODE_OPERATOR_ROOT
EOF
}

record_result() {
  printf '%s\t%s\n' "$1" "$2" >>"$RESULTS_FILE"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  record_result "pass" "$1"
  if [[ "$OUTPUT_JSON" -eq 0 ]]; then
    printf '[PASS] %s\n' "$1"
  fi
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  record_result "warn" "$1"
  if [[ "$OUTPUT_JSON" -eq 0 ]]; then
    printf '[WARN] %s\n' "$1"
  fi
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  record_result "fail" "$1"
  if [[ "$OUTPUT_JSON" -eq 0 ]]; then
    printf '[FAIL] %s\n' "$1"
  fi
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

retry_check() {
  local attempts="$1"
  local delay_seconds="$2"
  local callback="$3"
  local attempt=1

  LAST_RETRY_ERROR=""
  while true; do
    if "$callback"; then
      return 0
    fi
    if (( attempt >= attempts )); then
      return 1
    fi
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

refresh_github_hook_settings() {
  GITHUB_REPO="${OPENCLAWCODE_GITHUB_REPO:-$DEFAULT_GITHUB_REPO}"
  GITHUB_HOOK_ID="${OPENCLAWCODE_SETUP_GITHUB_HOOK_ID:-${OPENCLAWCODE_GITHUB_HOOK_ID:-}}"
  GITHUB_HOOK_EVENTS="${OPENCLAWCODE_SETUP_GITHUB_HOOK_EVENTS:-${OPENCLAWCODE_GITHUB_HOOK_EVENTS:-$DEFAULT_GITHUB_HOOK_EVENTS}}"
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
  refresh_github_hook_settings
  pass "env file loaded: ${ENV_FILE}"
}

env_file_defines_var() {
  local variable_name="$1"
  python3 - "$ENV_FILE" "$variable_name" <<'PY'
import re
import sys

env_path = sys.argv[1]
variable_name = sys.argv[2]
pattern = re.compile(rf"^\s*(?:export\s+)?{re.escape(variable_name)}\s*=")

with open(env_path, "r", encoding="utf-8") as handle:
    for line in handle:
        if pattern.match(line):
            raise SystemExit(0)

raise SystemExit(1)
PY
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

check_node_version_floor() {
  local required_version="$DEFAULT_MINIMUM_NODE_VERSION"
  local source_label="fallback runtime floor"

  if [[ -f "$CLI_STARTUP_METADATA_FILE" ]]; then
    local metadata_version=""
    metadata_version="$(
      python3 - "$CLI_STARTUP_METADATA_FILE" <<'PY'
import json
import sys
from pathlib import Path

metadata_path = Path(sys.argv[1])
with metadata_path.open("r", encoding="utf-8") as handle:
    payload = json.load(handle)

value = payload.get("minimumNodeVersion")
if isinstance(value, str) and value.strip():
    print(value.strip())
PY
    )" || {
      warn "unable to read CLI startup metadata: ${CLI_STARTUP_METADATA_FILE}; falling back to Node ${DEFAULT_MINIMUM_NODE_VERSION}"
      metadata_version=""
    }
    if [[ -n "$metadata_version" ]]; then
      required_version="$metadata_version"
      source_label="${CLI_STARTUP_METADATA_FILE}"
    else
      warn "CLI startup metadata missing minimumNodeVersion: ${CLI_STARTUP_METADATA_FILE}; falling back to Node ${DEFAULT_MINIMUM_NODE_VERSION}"
    fi
  else
    warn "CLI startup metadata missing: ${CLI_STARTUP_METADATA_FILE}; falling back to Node ${DEFAULT_MINIMUM_NODE_VERSION}"
  fi

  local current_version_raw=""
  if ! current_version_raw="$(node --version 2>/dev/null)"; then
    fail "unable to read local Node version with node --version"
    return
  fi

  local current_version="${current_version_raw#v}"
  if python3 - "$current_version" "$required_version" <<'PY'
import re
import sys

SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")

def parse(value: str):
    match = SEMVER_RE.search(value or "")
    if not match:
        raise SystemExit(1)
    return tuple(int(part) for part in match.groups())

current = parse(sys.argv[1])
required = parse(sys.argv[2])
raise SystemExit(0 if current >= required else 1)
PY
  then
    pass "local Node ${current_version} satisfies CLI startup floor ${required_version} (${source_label})"
  else
    fail "local Node ${current_version} is below CLI startup floor ${required_version} (${source_label})"
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
  if ! env_file_defines_var "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET"; then
    fail "webhook secret missing from env file: OPENCLAWCODE_GITHUB_WEBHOOK_SECRET"
    return
  fi

  pass "webhook secret configured in env file"

  if [[ -n "${OPENCLAWCODE_GITHUB_WEBHOOK_SECRET:-}" ]]; then
    pass "webhook secret loaded into environment"
  else
    fail "webhook secret failed to load from env file: OPENCLAWCODE_GITHUB_WEBHOOK_SECRET"
  fi
}

check_github_token() {
  if [[ -n "${GH_TOKEN:-}" || -n "${GITHUB_TOKEN:-}" ]]; then
    pass "GitHub token present for webhook sync"
  else
    warn "GH_TOKEN/GITHUB_TOKEN missing; webhook sync checks will be limited"
  fi
}

probe_gateway_port_once() {
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
    return 0
  fi

  LAST_RETRY_ERROR="gateway not reachable: ${GATEWAY_URL}"
  return 1
}

check_gateway_port() {
  if retry_check "$DEFAULT_RETRY_ATTEMPTS" "$DEFAULT_RETRY_DELAY_SECONDS" probe_gateway_port_once
  then
    pass "gateway reachable: ${GATEWAY_URL}"
  else
    fail "${LAST_RETRY_ERROR:-gateway not reachable: ${GATEWAY_URL}}"
  fi
}

probe_route_once() {
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
    LAST_RETRY_ERROR="signed webhook probe failed to reach ${GATEWAY_URL}${WEBHOOK_ROUTE}"
    return 1
  fi

  local status_code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "$status_code" != "202" ]]; then
    LAST_RETRY_ERROR="signed webhook probe returned HTTP ${status_code}"
    return 1
  fi
  if [[ "$body" == *'"reason":"unconfigured-repo"'* ]]; then
    return 0
  fi
  LAST_RETRY_ERROR="signed webhook probe returned unexpected body: ${body}"
  return 1
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

  if retry_check "$DEFAULT_RETRY_ATTEMPTS" "$DEFAULT_RETRY_DELAY_SECONDS" probe_route_once
  then
    pass "signed webhook probe reached plugin route"
  else
    fail "${LAST_RETRY_ERROR:-signed webhook probe failed to reach ${GATEWAY_URL}${WEBHOOK_ROUTE}}"
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

check_repo_test_commands() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    return
  fi

  local result
  if ! result="$(
    python3 - "$CONFIG_FILE" "$GITHUB_REPO" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
repo_key = sys.argv[2]

with config_path.open("r", encoding="utf-8") as handle:
    config = json.load(handle)

entries = ((config.get("plugins") or {}).get("entries") or {})
plugin = entries.get("openclawcode") or {}
repos = (((plugin.get("config") or {}).get("repos")) or [])

match = None
for repo in repos:
    if not isinstance(repo, dict):
        continue
    owner = repo.get("owner")
    name = repo.get("repo")
    if isinstance(owner, str) and isinstance(name, str) and f"{owner}/{name}" == repo_key:
        match = repo
        break

if match is None:
    print(json.dumps({"found": False, "unsafe": []}))
    raise SystemExit(0)

unsafe = []
for command in match.get("testCommands") or []:
    if not isinstance(command, str):
        continue
    if "vitest.openclawcode.config.mjs" in command and "--pool threads" not in command:
      unsafe.append(command)

print(json.dumps({"found": True, "unsafe": unsafe}))
PY
  )"; then
    fail "unable to inspect repo test commands in ${CONFIG_FILE}"
    return
  fi

  local verdict
  verdict="$(
    python3 - "$result" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if not payload.get("found"):
    print("missing")
elif payload.get("unsafe"):
    print("\n".join(payload["unsafe"]))
    raise SystemExit(2)
else:
    print("safe")
PY
  )" || {
    local code=$?
    if [[ "$code" -eq 2 ]]; then
      fail "repo test command for ${GITHUB_REPO} must add --pool threads when using vitest.openclawcode.config.mjs"
    else
      fail "unable to evaluate repo test commands in ${CONFIG_FILE}"
    fi
    return
  }

  if [[ "$verdict" == "safe" ]]; then
    pass "repo test commands avoid the known vitest worker timeout trap"
  fi
}

check_model_inventory() {
  if [[ ! -f "${REPO_ROOT}/dist/index.js" ]]; then
    return
  fi

  local inventory_raw
  if ! inventory_raw="$(node "${REPO_ROOT}/dist/index.js" models list --json 2>/dev/null)"; then
    warn "unable to inspect model inventory with models list --json"
    return
  fi

  local parsed
  if ! parsed="$(
    python3 - "$inventory_raw" "${OPENCLAWCODE_MODEL_FALLBACKS:-}" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
configured_raw = sys.argv[2]

models = payload.get("models") or []
available_keys = []
for entry in models:
    if not isinstance(entry, dict):
        continue
    key = entry.get("key")
    if isinstance(key, str) and key.strip() and entry.get("available") is True:
        trimmed = key.strip()
        if trimmed not in available_keys:
            available_keys.append(trimmed)

configured = []
for raw in configured_raw.split(","):
    trimmed = raw.strip()
    if trimmed and trimmed not in configured:
        configured.append(trimmed)

missing = [entry for entry in configured if entry not in available_keys]

print(json.dumps({
    "available": len(available_keys),
    "keys": available_keys,
    "configuredFallbacks": configured,
    "missingConfiguredFallbacks": missing,
    "fallbackReady": len(available_keys) >= 2,
}))
PY
  )"; then
    warn "unable to parse model inventory from models list --json"
    return
  fi

  MODEL_INVENTORY_JSON="$parsed"

  local summary
  summary="$(
    python3 - "$parsed" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
available = int(payload.get("available") or 0)
keys = payload.get("keys") or []
configured = payload.get("configuredFallbacks") or []
missing = payload.get("missingConfiguredFallbacks") or []
fallback_ready = bool(payload.get("fallbackReady"))

print(f"available={available}")
print("keys=" + ",".join(keys))
print("configured=" + ",".join(configured))
print("missing=" + ",".join(missing))
print("fallbackReady=" + ("true" if fallback_ready else "false"))
PY
  )" || {
    warn "unable to summarize model inventory readiness"
    return
  }

  local available_count=""
  local keys=""
  local configured=""
  local missing=""
  local fallback_ready=""
  while IFS='=' read -r key value; do
    case "$key" in
      available) available_count="$value" ;;
      keys) keys="$value" ;;
      configured) configured="$value" ;;
      missing) missing="$value" ;;
      fallbackReady) fallback_ready="$value" ;;
    esac
  done <<<"$summary"

  pass "model inventory exposes ${available_count:-0} available model(s): ${keys:-none}"

  if [[ -n "$configured" && -n "$missing" ]]; then
    fail "configured OPENCLAWCODE_MODEL_FALLBACKS entries are not discoverable: ${missing}"
    return
  fi

  if [[ -n "$configured" ]]; then
    pass "configured model fallback overrides are discoverable: ${configured}"
  else
    pass "fallback proof readiness: ${fallback_ready:-false}"
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

refresh_readiness_json() {
  local strict_ready="false"
  local basic_ready="false"
  local low_risk_ready="false"
  local fallback_ready="false"
  local promotion_ready="false"
  local next_action="fix-failing-checks"

  if [[ "$FAIL_COUNT" -eq 0 ]]; then
    basic_ready="true"
  fi

  if [[ "$FAIL_COUNT" -eq 0 && "$WARN_COUNT" -eq 0 ]]; then
    strict_ready="true"
    low_risk_ready="true"
    promotion_ready="true"
  fi

  local model_fallback_ready
  model_fallback_ready="$(
    python3 - "$MODEL_INVENTORY_JSON" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
print("true" if payload.get("fallbackReady") else "false")
PY
  )" || model_fallback_ready="false"

  if [[ "$strict_ready" == "true" && "$model_fallback_ready" == "true" ]]; then
    fallback_ready="true"
  fi

  if [[ "$basic_ready" != "true" ]]; then
    next_action="fix-failing-checks"
  elif [[ "$strict_ready" != "true" ]]; then
    next_action="resolve-warnings-before-promotion"
  elif [[ "$fallback_ready" == "true" ]]; then
    next_action="ready-for-low-risk-or-fallback-proof"
  else
    next_action="ready-for-low-risk-proof"
  fi

  READINESS_JSON="$(
    python3 - "$basic_ready" "$strict_ready" "$low_risk_ready" "$fallback_ready" "$promotion_ready" "$next_action" <<'PY'
import json
import sys

print(json.dumps({
    "basic": sys.argv[1] == "true",
    "strict": sys.argv[2] == "true",
    "lowRiskProofReady": sys.argv[3] == "true",
    "fallbackProofReady": sys.argv[4] == "true",
    "promotionReady": sys.argv[5] == "true",
    "nextAction": sys.argv[6],
}))
PY
  )" || READINESS_JSON='{"basic":false,"strict":false,"lowRiskProofReady":false,"fallbackProofReady":false,"promotionReady":false,"nextAction":"fix-failing-checks"}'
}

print_summary_and_exit() {
  local exit_code=0
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    exit_code=1
  fi
  if [[ "$STRICT_MODE" -eq 1 && "$WARN_COUNT" -gt 0 ]]; then
    exit_code=1
  fi

  refresh_readiness_json

  if [[ "$OUTPUT_JSON" -eq 1 ]]; then
    local checks_json=""
    local separator=""
    while IFS=$'\t' read -r status message; do
      [[ -n "$status" ]] || continue
      checks_json="${checks_json}${separator}{\"status\":\"$(json_escape "$status")\",\"message\":\"$(json_escape "$message")\"}"
      separator=","
    done <"$RESULTS_FILE"

    printf '{'
    printf '"ok":%s,' "$([[ "$exit_code" -eq 0 ]] && printf 'true' || printf 'false')"
    printf '"strict":%s,' "$([[ "$STRICT_MODE" -eq 1 ]] && printf 'true' || printf 'false')"
    printf '"repoRoot":"%s",' "$(json_escape "$REPO_ROOT")"
    printf '"operatorRoot":"%s",' "$(json_escape "$OPERATOR_ROOT")"
    printf '"gatewayUrl":"%s",' "$(json_escape "$GATEWAY_URL")"
    printf '"modelInventory":%s,' "$MODEL_INVENTORY_JSON"
    printf '"readiness":%s,' "$READINESS_JSON"
    printf '"summary":{"pass":%s,"warn":%s,"fail":%s},' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
    printf '"checks":[%s]}\n' "$checks_json"
  else
    printf '\nSummary: %s pass, %s warn, %s fail\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
    python3 - "$READINESS_JSON" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
print(
    "Readiness: basic={basic}, strict={strict}, low-risk-proof={low_risk}, fallback-proof={fallback}, promotion={promotion}".format(
        basic=str(payload.get("basic", False)).lower(),
        strict=str(payload.get("strict", False)).lower(),
        low_risk=str(payload.get("lowRiskProofReady", False)).lower(),
        fallback=str(payload.get("fallbackProofReady", False)).lower(),
        promotion=str(payload.get("promotionReady", False)).lower(),
    )
)
print(f"Next action: {payload.get('nextAction', 'fix-failing-checks')}")
PY
  fi

  exit "$exit_code"
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT_MODE=1
      ;;
    --skip-route-probe)
      SKIP_ROUTE_PROBE=1
      ;;
    --json)
      OUTPUT_JSON=1
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

refresh_github_hook_settings
require_command python3
require_command curl
require_command node
check_repo_root
check_dist_artifact
check_node_version_floor
load_env_file
check_config_file
check_webhook_secret
check_github_token
check_gateway_port
check_route_probe
check_repo_binding
check_repo_test_commands
check_model_inventory
check_github_hook_subscription
check_tunnel_status
print_summary_and_exit
