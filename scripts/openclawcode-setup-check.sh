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
readonly DEFAULT_CLI_PROBE_TIMEOUT_SECONDS="${OPENCLAWCODE_SETUP_CLI_PROBE_TIMEOUT_SECONDS:-10}"
readonly DEFAULT_STARTUP_PROOF_PORT="${OPENCLAWCODE_SETUP_STARTUP_PROOF_PORT:-18890}"
readonly DEFAULT_STARTUP_PROOF_TIMEOUT_SECONDS="${OPENCLAWCODE_SETUP_STARTUP_PROOF_TIMEOUT_SECONDS:-20}"

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
NODE_BIN="${OPENCLAWCODE_SETUP_NODE_BIN:-node}"
CLI_PROBE_TIMEOUT_SECONDS="$DEFAULT_CLI_PROBE_TIMEOUT_SECONDS"
STARTUP_PROOF_PORT="$DEFAULT_STARTUP_PROOF_PORT"
STARTUP_PROOF_TIMEOUT_SECONDS="$DEFAULT_STARTUP_PROOF_TIMEOUT_SECONDS"

STRICT_MODE=0
SKIP_ROUTE_PROBE=0
OUTPUT_JSON=0
PROBE_BUILT_STARTUP=0

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
LAST_RETRY_ERROR=""
RESULTS_FILE="${TMPDIR:-/tmp}/openclawcode-setup-check-results.$$"
MODEL_INVENTORY_JSON='{"available":0,"keys":[],"configuredFallbacks":[],"fallbackReady":false}'
PLUGIN_ACTIVATION_JSON='{"ready":false,"pluginsEnabled":false,"allowlisted":false,"entryEnabled":false}'
READINESS_JSON='{"basic":false,"strict":false,"lowRiskProofReady":false,"fallbackProofReady":false,"promotionReady":false,"chatSetupRoutingReady":false,"gatewayReachable":false,"routeProbeReady":false,"routeProbeSkipped":false,"builtStartupProofRequested":false,"builtStartupProofReady":false,"nextAction":"fix-failing-checks"}'
NODE_VERSION_FLOOR_OK=0
STARTUP_PROOF_TEMP_DIR=""

: >"$RESULTS_FILE"

cleanup() {
  rm -f "$RESULTS_FILE"
  if [[ -n "$STARTUP_PROOF_TEMP_DIR" ]]; then
    rm -rf "$STARTUP_PROOF_TEMP_DIR"
  fi
}

trap cleanup EXIT

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [--strict] [--skip-route-probe] [--probe-built-startup] [--json]

Checks:
  - repo root and built CLI artifact
  - local Node version satisfies the CLI startup floor
  - env/config/state files used by the local operator flow
  - openclawcode plugin activation and chat-routing readiness
  - webhook secret presence
  - GitHub token presence
  - local gateway TCP reachability
  - signed local webhook probe against ${DEFAULT_WEBHOOK_ROUTE}
  - saved repo binding for ${DEFAULT_GITHUB_REPO}
  - tunnel process/url status when using trycloudflare
  - optional built gateway startup proof using an isolated openclawcode-only config

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
  OPENCLAWCODE_SETUP_NODE_BIN
  OPENCLAWCODE_SETUP_CLI_PROBE_TIMEOUT_SECONDS
  OPENCLAWCODE_SETUP_STARTUP_PROOF_PORT
  OPENCLAWCODE_SETUP_STARTUP_PROOF_TIMEOUT_SECONDS
  OPENCLAWCODE_SETUP_PROBE_BUILT_STARTUP
  OPENCLAWCODE_TUNNEL_LOG_FILE
  OPENCLAWCODE_TUNNEL_PID_FILE
  OPENCLAWCODE_OPERATOR_ROOT
EOF
}

is_truthy() {
  local value="${1:-}"
  case "${value,,}" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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
  if ! current_version_raw="$("$NODE_BIN" --version 2>/dev/null)"; then
    fail "unable to read local Node version with ${NODE_BIN} --version"
    NODE_VERSION_FLOOR_OK=0
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
    pass "local Node ${current_version} satisfies CLI startup floor ${required_version} (${source_label}) via ${NODE_BIN}"
    NODE_VERSION_FLOOR_OK=1
  else
    fail "local Node ${current_version} is below CLI startup floor ${required_version} (${source_label}) via ${NODE_BIN}"
    NODE_VERSION_FLOOR_OK=0
  fi
}

run_cli_probe() {
  if command -v timeout >/dev/null 2>&1; then
    timeout --signal=TERM "${CLI_PROBE_TIMEOUT_SECONDS}s" "$NODE_BIN" "$@"
    return $?
  fi
  "$NODE_BIN" "$@"
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

check_plugin_activation() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    fail "operator config missing: ${CONFIG_FILE}"
    return
  fi

  local result
  if ! result="$(
    python3 - "$CONFIG_FILE" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])

with config_path.open("r", encoding="utf-8") as handle:
    config = json.load(handle)

plugins = config.get("plugins") or {}
entries = plugins.get("entries") or {}
openclawcode = entries.get("openclawcode") or {}

plugins_enabled = plugins.get("enabled") is True
allow = plugins.get("allow")
allowlisted = isinstance(allow, list) and "openclawcode" in allow
entry_enabled = isinstance(openclawcode, dict) and openclawcode.get("enabled") is True

missing = []
if not plugins_enabled:
    missing.append("plugins.enabled=true")
if not allowlisted:
    missing.append('plugins.allow includes "openclawcode"')
if not entry_enabled:
    missing.append("plugins.entries.openclawcode.enabled=true")

print(json.dumps({
    "ready": plugins_enabled and allowlisted and entry_enabled,
    "pluginsEnabled": plugins_enabled,
    "allowlisted": allowlisted,
    "entryEnabled": entry_enabled,
    "missing": missing,
}))
PY
  )"; then
    fail "unable to inspect plugin activation in ${CONFIG_FILE}"
    return
  fi

  PLUGIN_ACTIVATION_JSON="$result"

  local verdict
  verdict="$(
    python3 - "$result" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload.get("ready") is True:
    print("pass\topenclawcode plugin activation ready for chat routing")
else:
    missing = ", ".join(payload.get("missing") or []) or "unknown requirement"
    print(f'fail\topenclawcode plugin activation missing: {missing}')
PY
  )"

  local status="${verdict%%$'\t'*}"
  local message="${verdict#*$'\t'}"
  if [[ "$status" == "pass" ]]; then
    pass "$message"
  else
    fail "$message"
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

  if [[ "$NODE_VERSION_FLOOR_OK" -ne 1 ]]; then
    warn "skipping model inventory with ${NODE_BIN} because the configured Node runtime is below the CLI startup floor"
    return
  fi

  local inventory_raw
  local probe_temp_dir=""
  local probe_config_path="$CONFIG_FILE"
  local probe_state_dir="$OPERATOR_ROOT"

  if [[ -f "$CONFIG_FILE" ]]; then
    probe_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/openclawcode-model-inventory.XXXXXX")"
    probe_config_path="${probe_temp_dir}/model-inventory-config.json"
    probe_state_dir="${probe_temp_dir}/state"
    mkdir -p "$probe_state_dir"

    if ! python3 - "$CONFIG_FILE" "$probe_config_path" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])

with config_path.open("r", encoding="utf-8") as handle:
    config = json.load(handle)

config["channels"] = {}
config["bindings"] = []
config["plugins"] = {
    "enabled": False,
    "entries": {},
}

with out_path.open("w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
PY
    then
      rm -rf "$probe_temp_dir"
      warn "unable to synthesize model inventory probe config from ${CONFIG_FILE}"
      return
    fi
  fi

  if command -v timeout >/dev/null 2>&1; then
    inventory_raw="$(
      env \
        OPENCLAW_SKIP_CANVAS_HOST=1 \
        OPENCLAW_CONFIG_PATH="$probe_config_path" \
        OPENCLAW_STATE_DIR="$probe_state_dir" \
        timeout --signal=TERM "${CLI_PROBE_TIMEOUT_SECONDS}s" \
        "$NODE_BIN" "${REPO_ROOT}/dist/index.js" models list --json 2>/dev/null
    )"
  else
    inventory_raw="$(
      env \
        OPENCLAW_SKIP_CANVAS_HOST=1 \
        OPENCLAW_CONFIG_PATH="$probe_config_path" \
        OPENCLAW_STATE_DIR="$probe_state_dir" \
        "$NODE_BIN" "${REPO_ROOT}/dist/index.js" models list --json 2>/dev/null
    )"
  fi
  local inventory_status=$?
  if [[ "$inventory_status" -ne 0 ]]; then
    [[ -n "$probe_temp_dir" ]] && rm -rf "$probe_temp_dir"
    if [[ "$inventory_status" -eq 124 || "$inventory_status" -eq 137 || "$inventory_status" -eq 143 ]]; then
      warn "model inventory probe timed out after ${CLI_PROBE_TIMEOUT_SECONDS}s via ${NODE_BIN}"
    else
      warn "unable to inspect model inventory with models list --json via ${NODE_BIN}"
    fi
    return
  fi
  [[ -n "$probe_temp_dir" ]] && rm -rf "$probe_temp_dir"

  local parsed
  if ! parsed="$(
    python3 - "$inventory_raw" "${OPENCLAWCODE_MODEL_FALLBACKS:-}" <<'PY'
import json
import sys

raw_payload = sys.argv[1]
configured_raw = sys.argv[2]

decoder = json.JSONDecoder()
payload = None

candidate_blocks = []
stripped = raw_payload.strip()
if stripped:
    candidate_blocks.append(stripped)
    for index, char in enumerate(stripped):
        if char in "{[":
            candidate_blocks.append(stripped[index:])

lines = [line.rstrip() for line in raw_payload.splitlines() if line.strip()]
for index, line in enumerate(lines):
    if line.lstrip().startswith(("{", "[")):
        candidate_blocks.append("\n".join(lines[index:]).strip())

seen = set()
for candidate in candidate_blocks:
    if not candidate or candidate in seen:
        continue
    seen.add(candidate)
    try:
        decoded, end = decoder.raw_decode(candidate)
    except json.JSONDecodeError:
        continue
    if candidate[end:].strip():
        continue
    if isinstance(decoded, dict):
        payload = decoded
        break

if payload is None:
    raise SystemExit(1)

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

check_built_startup_proof() {
  if [[ "$PROBE_BUILT_STARTUP" -ne 1 ]]; then
    return
  fi

  if [[ ! -f "$CONFIG_FILE" ]]; then
    fail "cannot run built startup proof without gateway config: ${CONFIG_FILE}"
    return
  fi

  local cli_entry="${REPO_ROOT}/dist/index.js"
  if [[ ! -f "$cli_entry" ]]; then
    fail "cannot run built startup proof without built CLI artifact: ${cli_entry}"
    return
  fi

  local temp_dir
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/openclawcode-startup-proof.XXXXXX")"
  STARTUP_PROOF_TEMP_DIR="$temp_dir"
  local proof_config="${temp_dir}/openclawcode-only-allowlist.json"
  local proof_log="${temp_dir}/gateway.log"
  local proof_state_dir="${temp_dir}/state"
  mkdir -p "$proof_state_dir"

  if ! python3 - "$CONFIG_FILE" "$proof_config" "$STARTUP_PROOF_PORT" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
port = int(sys.argv[3])

with config_path.open("r", encoding="utf-8") as handle:
    config = json.load(handle)

plugins = (config.get("plugins") or {}).get("entries") or {}
openclawcode = plugins.get("openclawcode")
if not isinstance(openclawcode, dict):
    raise SystemExit(2)

config["channels"] = {}
config["bindings"] = []
gateway = config.get("gateway") or {}
gateway["port"] = port
gateway["bind"] = "loopback"
config["gateway"] = gateway
config["plugins"] = {
    "enabled": True,
    "allow": ["openclawcode"],
    "slots": {"memory": "none"},
    "entries": {
        "openclawcode": {
            **openclawcode,
            "enabled": True,
        }
    },
}

with out_path.open("w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
PY
  then
    fail "unable to synthesize built startup proof config from ${CONFIG_FILE}"
    return
  fi

  local proof_status
  if ! proof_status="$(
    python3 - "$NODE_BIN" "$cli_entry" "$proof_log" "$proof_config" "$proof_state_dir" "$STARTUP_PROOF_TIMEOUT_SECONDS" "$STARTUP_PROOF_PORT" <<'PY'
import os
import subprocess
import sys
from pathlib import Path

node_bin = sys.argv[1]
cli_entry = sys.argv[2]
log_path = Path(sys.argv[3])
config_path = sys.argv[4]
state_dir = sys.argv[5]
timeout_seconds = float(sys.argv[6])
port = sys.argv[7]

env = os.environ.copy()
env["OPENCLAW_SKIP_CANVAS_HOST"] = "1"
env["OPENCLAW_CONFIG_PATH"] = config_path
env["OPENCLAW_STATE_DIR"] = state_dir

with log_path.open("w", encoding="utf-8") as log_handle:
    try:
        completed = subprocess.run(
            [
                node_bin,
                cli_entry,
                "gateway",
                "run",
                "--bind",
                "loopback",
                "--port",
                port,
                "--allow-unconfigured",
                "--verbose",
            ],
            env=env,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            timeout=timeout_seconds,
            check=False,
        )
        print(f"exit:{completed.returncode}")
    except subprocess.TimeoutExpired:
        print("timeout")
PY
  )"; then
    fail "built gateway startup proof failed to execute"
    return
  fi

  if grep -q "listening on ws://127.0.0.1:${STARTUP_PROOF_PORT}" "$proof_log"; then
    pass "built gateway startup proof reached listener on ws://127.0.0.1:${STARTUP_PROOF_PORT}"
    return
  fi

  local proof_detail
  proof_detail="$(
    python3 - "$proof_log" <<'PY'
import re
import sys
from pathlib import Path

log_path = Path(sys.argv[1])
if not log_path.exists():
    print("missing proof log")
    raise SystemExit(0)

lines = [line.strip() for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
for pattern in [
    re.compile(r"Error:.*"),
    re.compile(r".*ERR_[A-Z0-9_]+.*"),
    re.compile(r".*unknown command.*", re.IGNORECASE),
    re.compile(r".*plugin not found.*", re.IGNORECASE),
    re.compile(r".*unknown channel id.*", re.IGNORECASE),
]:
    for line in lines:
        if pattern.match(line):
            print(line)
            raise SystemExit(0)

print(lines[-1] if lines else "no log output")
PY
  )" || proof_detail="no log output"

  if [[ "$proof_status" == "timeout" ]]; then
    fail "built gateway startup proof timed out before listener on ws://127.0.0.1:${STARTUP_PROOF_PORT} (${proof_detail})"
  else
    fail "built gateway startup proof failed before listener on ws://127.0.0.1:${STARTUP_PROOF_PORT} (${proof_detail})"
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

  local result=""
  local attempts="$DEFAULT_RETRY_ATTEMPTS"
  local delay_seconds="$DEFAULT_RETRY_DELAY_SECONDS"
  local attempt=1
  local error_detail=""

  while true; do
    local error_file
    error_file="$(mktemp "${TMPDIR:-/tmp}/openclawcode-setup-check-hook-error.XXXXXX")"
    if result="$(
      python3 - "$GITHUB_REPO" "$GITHUB_HOOK_ID" "$GITHUB_HOOK_EVENTS" "$token" <<'PY' 2>"$error_file"
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
      rm -f "$error_file"
      break
    fi
    error_detail="$(python3 - "$error_file" <<'PY'
import pathlib
import sys

error_path = pathlib.Path(sys.argv[1])
text = error_path.read_text(encoding="utf-8").strip()
print(" ".join(text.split()))
PY
    )"
    rm -f "$error_file"
    if (( attempt >= attempts )); then
      if [[ -n "$error_detail" ]]; then
        fail "GitHub webhook subscription check failed for hook ${GITHUB_HOOK_ID} (${error_detail})"
      else
        fail "GitHub webhook subscription check failed for hook ${GITHUB_HOOK_ID}"
      fi
      return
    fi
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done

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
  READINESS_JSON="$(
    python3 - "$FAIL_COUNT" "$WARN_COUNT" "$MODEL_INVENTORY_JSON" "$PLUGIN_ACTIVATION_JSON" "$RESULTS_FILE" "$PROBE_BUILT_STARTUP" "$SKIP_ROUTE_PROBE" <<'PY'
import json
import sys
from pathlib import Path

fail_count = int(sys.argv[1])
warn_count = int(sys.argv[2])
model_inventory = json.loads(sys.argv[3])
plugin_activation = json.loads(sys.argv[4])
results_path = Path(sys.argv[5])
built_startup_requested = sys.argv[6] == "1"
route_probe_skipped = sys.argv[7] == "1"

entries = []
for line in results_path.read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    status, _, message = line.partition("\t")
    entries.append((status, message))

def has(status: str, needle: str) -> bool:
    return any(entry_status == status and needle in message for entry_status, message in entries)

basic_ready = fail_count == 0
strict_ready = fail_count == 0 and warn_count == 0
low_risk_ready = strict_ready
fallback_ready = strict_ready and bool(model_inventory.get("fallbackReady"))
promotion_ready = strict_ready
chat_setup_routing_ready = bool(plugin_activation.get("ready"))
gateway_reachable = has("pass", "gateway reachable:")
route_probe_ready = has("pass", "signed webhook probe reached plugin route")
built_startup_ready = has("pass", "built gateway startup proof reached listener")

if not chat_setup_routing_ready:
    next_action = "repair-plugin-activation"
elif not basic_ready:
    if built_startup_requested and built_startup_ready and not gateway_reachable:
        next_action = "start-or-restart-live-gateway"
    elif built_startup_requested and not built_startup_ready:
        next_action = "fix-built-startup-proof"
    else:
        next_action = "fix-failing-checks"
elif not strict_ready:
    next_action = "resolve-warnings-before-promotion"
elif fallback_ready:
    next_action = "ready-for-low-risk-or-fallback-proof"
else:
    next_action = "ready-for-low-risk-proof"

print(json.dumps({
    "basic": basic_ready,
    "strict": strict_ready,
    "lowRiskProofReady": low_risk_ready,
    "fallbackProofReady": fallback_ready,
    "promotionReady": promotion_ready,
    "chatSetupRoutingReady": chat_setup_routing_ready,
    "gatewayReachable": gateway_reachable,
    "routeProbeReady": route_probe_ready,
    "routeProbeSkipped": route_probe_skipped,
    "builtStartupProofRequested": built_startup_requested,
    "builtStartupProofReady": built_startup_ready,
    "nextAction": next_action,
}))
PY
  )" || READINESS_JSON='{"basic":false,"strict":false,"lowRiskProofReady":false,"fallbackProofReady":false,"promotionReady":false,"chatSetupRoutingReady":false,"gatewayReachable":false,"routeProbeReady":false,"routeProbeSkipped":false,"builtStartupProofRequested":false,"builtStartupProofReady":false,"nextAction":"fix-failing-checks"}'
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
    printf '"pluginActivation":%s,' "$PLUGIN_ACTIVATION_JSON"
    printf '"summary":{"pass":%s,"warn":%s,"fail":%s},' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
    printf '"checks":[%s]}\n' "$checks_json"
  else
    printf '\nSummary: %s pass, %s warn, %s fail\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
    python3 - "$READINESS_JSON" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
print(
    "Readiness: basic={basic}, strict={strict}, low-risk-proof={low_risk}, fallback-proof={fallback}, promotion={promotion}, chat-routing={chat_routing}, gateway={gateway}, route-probe={route_probe}, built-startup={built_startup}".format(
        basic=str(payload.get("basic", False)).lower(),
        strict=str(payload.get("strict", False)).lower(),
        low_risk=str(payload.get("lowRiskProofReady", False)).lower(),
        fallback=str(payload.get("fallbackProofReady", False)).lower(),
        promotion=str(payload.get("promotionReady", False)).lower(),
        chat_routing=str(payload.get("chatSetupRoutingReady", False)).lower(),
        gateway=str(payload.get("gatewayReachable", False)).lower(),
        route_probe=str(payload.get("routeProbeReady", False)).lower(),
        built_startup=str(payload.get("builtStartupProofReady", False)).lower(),
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
    --probe-built-startup)
      PROBE_BUILT_STARTUP=1
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

if is_truthy "${OPENCLAWCODE_SETUP_PROBE_BUILT_STARTUP:-}"; then
  PROBE_BUILT_STARTUP=1
fi

refresh_github_hook_settings
require_command python3
require_command curl
require_command node
check_repo_root
check_dist_artifact
check_node_version_floor
load_env_file
check_config_file
check_plugin_activation
check_webhook_secret
check_github_token
check_gateway_port
check_route_probe
check_repo_binding
check_repo_test_commands
check_model_inventory
check_built_startup_proof
check_github_hook_subscription
check_tunnel_status
print_summary_and_exit
