import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-setup-check-"));
}

function runSetupCheck(scriptPath: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const isolatedParentEnv: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  };
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: path.resolve("."),
    env: {
      ...isolatedParentEnv,
      ...env,
    },
    encoding: "utf8",
    timeout: 15_000,
  });
}

function resolveRealPythonPath() {
  const result = spawnSync("bash", ["-lc", "command -v python3"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Failed to resolve python3 path: ${result.stderr}`);
  }
  const pythonPath = result.stdout.trim();
  if (!pythonPath) {
    throw new Error("Resolved empty python3 path.");
  }
  return pythonPath;
}

async function writeExecutable(filePath: string, contents: string) {
  await fs.writeFile(filePath, contents, "utf8");
  await fs.chmod(filePath, 0o755);
}

function hasShellExecutionSupport() {
  const result = spawnSync("bash", ["-lc", "exit 0"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  return !result.error && result.status === 0;
}

const describeWithShell = hasShellExecutionSupport() ? describe : describe.skip;

describe("openclawcode-setup-check.sh source", () => {
  it("keeps the required operator checks and guardrails in the script", async () => {
    const script = await fs.readFile(path.resolve("scripts/openclawcode-setup-check.sh"), "utf8");

    expect(script).toContain("--strict");
    expect(script).toContain("--skip-route-probe");
    expect(script).toContain("OPENCLAWCODE_GITHUB_WEBHOOK_SECRET");
    expect(script).toContain("GH_TOKEN/GITHUB_TOKEN");
    expect(script).toContain("OPENCLAWCODE_SETUP_OPERATOR_ROOT");
    expect(script).toContain("OPENCLAWCODE_OPERATOR_ROOT");
    expect(script).toContain("OPENCLAWCODE_SETUP_GITHUB_HOOK_ID");
    expect(script).toContain("OPENCLAWCODE_SETUP_RETRY_ATTEMPTS");
    expect(script).toContain("OPENCLAWCODE_SETUP_RETRY_DELAY_SECONDS");
    expect(script).toContain("refresh_github_hook_settings");
    expect(script).toContain("retry_check");
    expect(script).toContain("pull_request_review");
    expect(script).toContain('"reason":"unconfigured-repo"');
    expect(script).toContain("repoBindingsByRepo");
    expect(script).toContain("--connect-timeout 2");
    expect(script).toContain("--max-time 5");
    expect(script).toContain("GitHub webhook subscription check");
    expect(script).toContain("vitest.openclawcode.config.mjs");
    expect(script).toContain("--pool threads");
  });

  it("keeps the webhook tunnel helper aligned with the required GitHub event set", async () => {
    const script = await fs.readFile(
      path.resolve("scripts/openclawcode-webhook-tunnel.sh"),
      "utf8",
    );

    expect(script).toContain("issues,pull_request,pull_request_review");
    expect(script).toContain('"events": events');
    expect(script).toContain("OPENCLAWCODE_GITHUB_HOOK_EVENTS");
    expect(script).toContain("OPENCLAWCODE_TUNNEL_OPERATOR_ROOT");
    expect(script).toContain("OPENCLAWCODE_OPERATOR_ROOT");
    expect(script).toContain("find_running_tunnel_pid");
  });
});

describeWithShell("openclawcode-setup-check.sh", () => {
  const tempRoots = new Set<string>();
  const backgroundPids = new Set<number>();

  afterEach(async () => {
    for (const pid of backgroundPids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process already exited.
      }
    }
    backgroundPids.clear();
    await Promise.all(
      Array.from(tempRoots, async (rootDir) => {
        await fs.rm(rootDir, { recursive: true, force: true });
      }),
    );
    tempRoots.clear();
  });

  it("passes against a reachable gateway with a signed webhook probe", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const stateFile = path.join(rootDir, "chatops-state.json");
    const curlArgsFile = path.join(rootDir, "curl-args.txt");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.js"), "console.log('ok');\n", "utf8");
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                enabled: true,
                config: {
                  repos: [
                    {
                      owner: "zhyongrui",
                      repo: "openclawcode",
                      repoRoot,
                      baseBranch: "main",
                      triggerMode: "approve",
                      notifyChannel: "feishu",
                      notifyTarget: "user:strict-root",
                      builderAgent: "main",
                      verifierAgent: "main",
                      testCommands: [
                        "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      stateFile,
      `${JSON.stringify(
        {
          repoBindingsByRepo: {
            "zhyongrui/openclawcode": {
              repoKey: "zhyongrui/openclawcode",
              notifyChannel: "feishu",
              notifyTarget: "user:bound-chat",
              updatedAt: "2026-03-11T12:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeExecutable(
      path.join(binDir, "python3"),
      `#!/usr/bin/env bash
set -euo pipefail
script="$(cat)"
if [[ "$script" == *"socket.create_connection"* ]]; then
  exit 0
fi
if [[ "$script" == *"hmac.new"* ]]; then
  printf 'sha256=test-signature\\n'
  exit 0
fi
printf '%s' "$script" | "${realPythonPath}" "$@"
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >"${curlArgsFile}"
printf '{"accepted":false,"reason":"unconfigured-repo"}\\n202'
`,
    );

    const result = runSetupCheck(scriptPath, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
      OPENCLAWCODE_SETUP_ENV_FILE: envFile,
      OPENCLAWCODE_SETUP_CONFIG_FILE: configFile,
      OPENCLAWCODE_SETUP_STATE_FILE: stateFile,
      OPENCLAWCODE_SETUP_GATEWAY_URL: "http://127.0.0.1:18789",
      OPENCLAWCODE_SETUP_WEBHOOK_ROUTE: "/plugins/openclawcode/github",
      OPENCLAWCODE_GITHUB_REPO: "zhyongrui/openclawcode",
      OPENCLAWCODE_TUNNEL_LOG_FILE: path.join(rootDir, "tunnel.log"),
      OPENCLAWCODE_TUNNEL_PID_FILE: path.join(rootDir, "tunnel.pid"),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[PASS] built CLI artifact present");
    expect(result.stdout).toContain("[PASS] webhook secret configured in env file");
    expect(result.stdout).toContain("[PASS] webhook secret loaded into environment");
    expect(result.stdout).toContain("[PASS] signed webhook probe reached plugin route");
    expect(result.stdout).toContain("[PASS] repo binding present for zhyongrui/openclawcode");
    expect(result.stdout).toContain("Summary:");

    const curlArgs = await fs.readFile(curlArgsFile, "utf8");
    expect(curlArgs).toContain("X-GitHub-Event: issues");
    expect(curlArgs).toContain("X-Hub-Signature-256: sha256=test-signature");
    expect(curlArgs).toContain("http://127.0.0.1:18789/plugins/openclawcode/github");
  });

  it("retries transient gateway and route-probe failures during restart windows", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const stateFile = path.join(rootDir, "chatops-state.json");
    const curlArgsFile = path.join(rootDir, "curl-args.txt");
    const gatewayAttemptsFile = path.join(rootDir, "gateway-attempts.txt");
    const probeAttemptsFile = path.join(rootDir, "probe-attempts.txt");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.js"), "console.log('ok');\n", "utf8");
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                enabled: true,
                config: {
                  repos: [
                    {
                      owner: "zhyongrui",
                      repo: "openclawcode",
                      repoRoot,
                      baseBranch: "main",
                      triggerMode: "approve",
                      notifyChannel: "feishu",
                      notifyTarget: "user:retry-window",
                      builderAgent: "main",
                      verifierAgent: "main",
                      testCommands: [
                        "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      stateFile,
      `${JSON.stringify(
        {
          repoBindingsByRepo: {
            "zhyongrui/openclawcode": {
              repoKey: "zhyongrui/openclawcode",
              notifyChannel: "feishu",
              notifyTarget: "user:retry-window",
              updatedAt: "2026-03-12T08:40:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeExecutable(
      path.join(binDir, "python3"),
      `#!/usr/bin/env bash
set -euo pipefail
script="$(cat)"
if [[ "$script" == *"socket.create_connection"* ]]; then
  count=0
  if [[ -f "${gatewayAttemptsFile}" ]]; then
    count="$(cat "${gatewayAttemptsFile}")"
  fi
  count=$((count + 1))
  printf '%s\\n' "$count" >"${gatewayAttemptsFile}"
  if [[ "$count" -lt 2 ]]; then
    exit 1
  fi
  exit 0
fi
if [[ "$script" == *"hmac.new"* ]]; then
  printf 'sha256=test-signature\\n'
  exit 0
fi
printf '%s' "$script" | "${realPythonPath}" "$@"
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      `#!/usr/bin/env bash
set -euo pipefail
count=0
if [[ -f "${probeAttemptsFile}" ]]; then
  count="$(cat "${probeAttemptsFile}")"
fi
count=$((count + 1))
printf '%s\\n' "$count" >"${probeAttemptsFile}"
printf '%s\\n' "$@" >>"${curlArgsFile}"
if [[ "$count" -lt 2 ]]; then
  exit 7
fi
printf '{"accepted":false,"reason":"unconfigured-repo"}\\n202'
`,
    );

    const result = runSetupCheck(scriptPath, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
      OPENCLAWCODE_SETUP_ENV_FILE: envFile,
      OPENCLAWCODE_SETUP_CONFIG_FILE: configFile,
      OPENCLAWCODE_SETUP_STATE_FILE: stateFile,
      OPENCLAWCODE_SETUP_GATEWAY_URL: "http://127.0.0.1:18789",
      OPENCLAWCODE_SETUP_WEBHOOK_ROUTE: "/plugins/openclawcode/github",
      OPENCLAWCODE_GITHUB_REPO: "zhyongrui/openclawcode",
      OPENCLAWCODE_SETUP_RETRY_ATTEMPTS: "2",
      OPENCLAWCODE_SETUP_RETRY_DELAY_SECONDS: "0.01",
      OPENCLAWCODE_TUNNEL_LOG_FILE: path.join(rootDir, "tunnel.log"),
      OPENCLAWCODE_TUNNEL_PID_FILE: path.join(rootDir, "tunnel.pid"),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[PASS] gateway reachable: http://127.0.0.1:18789");
    expect(result.stdout).toContain("[PASS] signed webhook probe reached plugin route");
    expect(await fs.readFile(gatewayAttemptsFile, "utf8")).toBe("2\n");
    expect(await fs.readFile(probeAttemptsFile, "utf8")).toBe("2\n");
  });

  it("derives env, config, and state paths from OPENCLAWCODE_SETUP_OPERATOR_ROOT", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const operatorRoot = path.join(rootDir, "operator-root");
    const pluginsDir = path.join(operatorRoot, "plugins", "openclawcode");
    const envFile = path.join(operatorRoot, "openclawcode.env");
    const configFile = path.join(operatorRoot, "openclaw.json");
    const stateFile = path.join(pluginsDir, "chatops-state.json");
    const curlArgsFile = path.join(rootDir, "curl-args.txt");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(pluginsDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.js"), "console.log('ok');\n", "utf8");
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                enabled: true,
                config: {
                  repos: [
                    {
                      owner: "zhyongrui",
                      repo: "openclawcode",
                      repoRoot,
                      baseBranch: "main",
                      triggerMode: "approve",
                      notifyChannel: "feishu",
                      notifyTarget: "user:strict-root",
                      builderAgent: "main",
                      verifierAgent: "main",
                      testCommands: [
                        "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      stateFile,
      `${JSON.stringify(
        {
          repoBindingsByRepo: {
            "zhyongrui/openclawcode": {
              repoKey: "zhyongrui/openclawcode",
              notifyChannel: "feishu",
              notifyTarget: "user:fresh-root",
              updatedAt: "2026-03-12T04:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeExecutable(
      path.join(binDir, "python3"),
      `#!/usr/bin/env bash
set -euo pipefail
script="$(cat)"
if [[ "$script" == *"socket.create_connection"* ]]; then
  exit 0
fi
if [[ "$script" == *"hmac.new"* ]]; then
  printf 'sha256=test-signature\\n'
  exit 0
fi
printf '%s' "$script" | "${realPythonPath}" "$@"
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >"${curlArgsFile}"
printf '{"accepted":false,"reason":"unconfigured-repo"}\\n202'
`,
    );

    const result = runSetupCheck(scriptPath, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
      OPENCLAWCODE_SETUP_OPERATOR_ROOT: operatorRoot,
      OPENCLAWCODE_SETUP_GATEWAY_URL: "http://127.0.0.1:18789",
      OPENCLAWCODE_SETUP_WEBHOOK_ROUTE: "/plugins/openclawcode/github",
      OPENCLAWCODE_GITHUB_REPO: "zhyongrui/openclawcode",
      OPENCLAWCODE_TUNNEL_LOG_FILE: path.join(rootDir, "tunnel.log"),
      OPENCLAWCODE_TUNNEL_PID_FILE: path.join(rootDir, "tunnel.pid"),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`[PASS] env file loaded: ${envFile}`);
    expect(result.stdout).toContain(`[PASS] gateway config file present: ${configFile}`);
    expect(result.stdout).toContain(
      `[PASS] repo binding present for zhyongrui/openclawcode: feishu:user:fresh-root`,
    );

    const curlArgs = await fs.readFile(curlArgsFile, "utf8");
    expect(curlArgs).toContain("http://127.0.0.1:18789/plugins/openclawcode/github");
  });

  it("passes strict mode when the operator-root env file defines GitHub hook metadata", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const operatorRoot = path.join(rootDir, "operator-root");
    const pluginsDir = path.join(operatorRoot, "plugins", "openclawcode");
    const envFile = path.join(operatorRoot, "openclawcode.env");
    const configFile = path.join(operatorRoot, "openclaw.json");
    const stateFile = path.join(pluginsDir, "chatops-state.json");
    const tunnelLogFile = path.join(rootDir, "tunnel.log");
    const tunnelPidFile = path.join(rootDir, "tunnel.pid");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(pluginsDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.js"), "console.log('ok');\n", "utf8");
    await fs.writeFile(
      envFile,
      [
        "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret",
        "GH_TOKEN=dummy-token",
        "OPENCLAWCODE_GITHUB_REPO=zhyongrui/openclawcode",
        "OPENCLAWCODE_GITHUB_HOOK_ID=123456",
        "OPENCLAWCODE_GITHUB_HOOK_EVENTS=issues,pull_request,pull_request_review",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                enabled: true,
                config: {
                  repos: [
                    {
                      owner: "zhyongrui",
                      repo: "openclawcode",
                      repoRoot,
                      baseBranch: "main",
                      triggerMode: "approve",
                      notifyChannel: "feishu",
                      notifyTarget: "user:strict-root",
                      builderAgent: "main",
                      verifierAgent: "main",
                      testCommands: [
                        "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      stateFile,
      `${JSON.stringify(
        {
          repoBindingsByRepo: {
            "zhyongrui/openclawcode": {
              repoKey: "zhyongrui/openclawcode",
              notifyChannel: "feishu",
              notifyTarget: "user:strict-root",
              updatedAt: "2026-03-12T04:10:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeExecutable(
      path.join(binDir, "python3"),
      `#!/usr/bin/env bash
set -euo pipefail
script="$(cat)"
if [[ "$script" == *"socket.create_connection"* ]]; then
  exit 0
fi
if [[ "$script" == *"hmac.new"* ]]; then
  printf 'sha256=test-signature\\n'
  exit 0
fi
if [[ "$script" == *"api.github.com/repos"* && "$script" == *"/hooks/"* ]]; then
  printf '{"active": true, "events": ["issues", "pull_request", "pull_request_review"], "missing": []}\\n'
  exit 0
fi
printf '%s' "$script" | "${realPythonPath}" "$@"
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'{"accepted":false,"reason":"unconfigured-repo"}\\n202\'\n',
    );

    const tunnelProcess = spawn("sleep", ["30"], {
      cwd: path.resolve("."),
      stdio: "ignore",
    });
    if (typeof tunnelProcess.pid !== "number") {
      throw new Error("Failed to start background tunnel placeholder.");
    }
    backgroundPids.add(tunnelProcess.pid);
    await fs.writeFile(tunnelPidFile, `${tunnelProcess.pid}\n`, "utf8");
    await fs.writeFile(tunnelLogFile, "https://strict-root.trycloudflare.com\n", "utf8");

    const result = runSetupCheck(
      scriptPath,
      {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
        OPENCLAWCODE_SETUP_OPERATOR_ROOT: operatorRoot,
        OPENCLAWCODE_SETUP_GATEWAY_URL: "http://127.0.0.1:18789",
        OPENCLAWCODE_SETUP_WEBHOOK_ROUTE: "/plugins/openclawcode/github",
        OPENCLAWCODE_TUNNEL_LOG_FILE: tunnelLogFile,
        OPENCLAWCODE_TUNNEL_PID_FILE: tunnelPidFile,
      },
      ["--strict"],
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "[PASS] GitHub webhook 123456 subscribed to required events: issues,pull_request,pull_request_review",
    );
    expect(result.stdout).toContain(
      "[PASS] repo test commands avoid the known vitest worker timeout trap",
    );
    expect(result.stdout).toContain(
      "[PASS] trycloudflare tunnel running: https://strict-root.trycloudflare.com",
    );
  });

  it("fails when repo test commands use vitest.openclawcode.config.mjs without --pool threads", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const stateFile = path.join(rootDir, "chatops-state.json");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.js"), "console.log('ok');\n", "utf8");
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                enabled: true,
                config: {
                  repos: [
                    {
                      owner: "zhyongrui",
                      repo: "openclawcode",
                      repoRoot,
                      baseBranch: "main",
                      triggerMode: "auto",
                      notifyChannel: "feishu",
                      notifyTarget: "user:primary",
                      builderAgent: "main",
                      verifierAgent: "main",
                      testCommands: [
                        "pnpm exec vitest run --config vitest.openclawcode.config.mjs",
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      stateFile,
      `${JSON.stringify(
        {
          repoBindingsByRepo: {
            "zhyongrui/openclawcode": {
              repoKey: "zhyongrui/openclawcode",
              notifyChannel: "feishu",
              notifyTarget: "user:bound-chat",
              updatedAt: "2026-03-12T07:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeExecutable(
      path.join(binDir, "python3"),
      `#!/usr/bin/env bash
set -euo pipefail
script="$(cat)"
if [[ "$script" == *"socket.create_connection"* ]]; then
  exit 0
fi
if [[ "$script" == *"hmac.new"* ]]; then
  printf 'sha256=test-signature\\n'
  exit 0
fi
printf '%s' "$script" | "${realPythonPath}" "$@"
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'{"accepted":false,"reason":"unconfigured-repo"}\\n202\'\n',
    );

    const result = runSetupCheck(scriptPath, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
      OPENCLAWCODE_SETUP_ENV_FILE: envFile,
      OPENCLAWCODE_SETUP_CONFIG_FILE: configFile,
      OPENCLAWCODE_SETUP_STATE_FILE: stateFile,
      OPENCLAWCODE_SETUP_GATEWAY_URL: "http://127.0.0.1:18789",
      OPENCLAWCODE_SETUP_WEBHOOK_ROUTE: "/plugins/openclawcode/github",
      OPENCLAWCODE_GITHUB_REPO: "zhyongrui/openclawcode",
      OPENCLAWCODE_TUNNEL_LOG_FILE: path.join(rootDir, "tunnel.log"),
      OPENCLAWCODE_TUNNEL_PID_FILE: path.join(rootDir, "tunnel.pid"),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "[FAIL] repo test command for zhyongrui/openclawcode must add --pool threads when using vitest.openclawcode.config.mjs",
    );
  });

  it("fails when the webhook secret is missing from the env file", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.js"), "console.log('ok');\n", "utf8");
    await fs.writeFile(envFile, "GH_TOKEN=dummy-token\n", "utf8");
    await fs.writeFile(configFile, "{}\n", "utf8");

    await writeExecutable(
      path.join(binDir, "python3"),
      `#!/usr/bin/env bash
set -euo pipefail
script="$(cat)"
if [[ "$script" == *"socket.create_connection"* ]]; then
  exit 0
fi
printf '%s' "$script" | "${realPythonPath}" "$@"
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'{"accepted":false,"reason":"unconfigured-repo"}\\n202\'\n',
    );

    const result = runSetupCheck(scriptPath, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
      OPENCLAWCODE_SETUP_ENV_FILE: envFile,
      OPENCLAWCODE_SETUP_CONFIG_FILE: configFile,
      OPENCLAWCODE_SETUP_STATE_FILE: path.join(rootDir, "missing-state.json"),
      OPENCLAWCODE_SETUP_GATEWAY_URL: "http://127.0.0.1:18789",
      OPENCLAWCODE_SETUP_WEBHOOK_ROUTE: "/plugins/openclawcode/github",
      OPENCLAWCODE_GITHUB_REPO: "zhyongrui/openclawcode",
      OPENCLAWCODE_TUNNEL_LOG_FILE: path.join(rootDir, "tunnel.log"),
      OPENCLAWCODE_TUNNEL_PID_FILE: path.join(rootDir, "tunnel.pid"),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("[FAIL] webhook secret missing from env file");
  });

  it("fails when the parent environment has a webhook secret but the env file does not", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.js"), "console.log('ok');\n", "utf8");
    await fs.writeFile(envFile, "GH_TOKEN=dummy-token\n", "utf8");
    await fs.writeFile(configFile, "{}\n", "utf8");

    await writeExecutable(
      path.join(binDir, "python3"),
      `#!/usr/bin/env bash
set -euo pipefail
script="$(cat)"
if [[ "$script" == *"socket.create_connection"* ]]; then
  exit 0
fi
printf '%s' "$script" | "${realPythonPath}" "$@"
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'{"accepted":false,"reason":"unconfigured-repo"}\\n202\'\n',
    );

    const result = runSetupCheck(scriptPath, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      OPENCLAWCODE_GITHUB_WEBHOOK_SECRET: "inherited-secret",
      OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
      OPENCLAWCODE_SETUP_ENV_FILE: envFile,
      OPENCLAWCODE_SETUP_CONFIG_FILE: configFile,
      OPENCLAWCODE_SETUP_STATE_FILE: path.join(rootDir, "missing-state.json"),
      OPENCLAWCODE_SETUP_GATEWAY_URL: "http://127.0.0.1:18789",
      OPENCLAWCODE_SETUP_WEBHOOK_ROUTE: "/plugins/openclawcode/github",
      OPENCLAWCODE_GITHUB_REPO: "zhyongrui/openclawcode",
      OPENCLAWCODE_TUNNEL_LOG_FILE: path.join(rootDir, "tunnel.log"),
      OPENCLAWCODE_TUNNEL_PID_FILE: path.join(rootDir, "tunnel.pid"),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("[FAIL] webhook secret missing from env file");
  });
});
