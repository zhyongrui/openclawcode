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
    timeout: 60_000,
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

async function writeStubCliArtifacts(distDir: string, minimumNodeVersion = "22.16.0") {
  await fs.writeFile(path.join(distDir, "index.js"), "console.log('ok');\n", "utf8");
  await fs.writeFile(
    path.join(distDir, "cli-startup-metadata.json"),
    `${JSON.stringify(
      {
        generatedBy: "setup-check.test.ts",
        channelOptions: ["telegram"],
        minimumNodeVersion,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeStubNode(
  binDir: string,
  version = "22.16.0",
  modelKeys: string[] = ["crs/gpt-5.4"],
) {
  const inventoryJson = JSON.stringify({
    count: modelKeys.length,
    models: modelKeys.map((key, index) => ({
      key,
      name: `Stub Model ${index + 1}`,
      input: "text",
      local: false,
      available: true,
      tags: index === 0 ? ["default", "configured"] : ["configured"],
      missing: false,
    })),
  });
  await writeExecutable(
    path.join(binDir, "node"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" || "\${1:-}" == "-v" ]]; then
  printf 'v${version}\\n'
  exit 0
fi
if [[ "\${1:-}" == *"/dist/index.js" && "\${2:-}" == "models" && "\${3:-}" == "list" && "\${4:-}" == "--json" ]]; then
  cat <<'EOF'
${inventoryJson}
EOF
  exit 0
fi
printf 'stub node only supports --version\\n' >&2
exit 1
`,
  );
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
    expect(script).toContain("--json");
    expect(script).toContain("OPENCLAWCODE_GITHUB_WEBHOOK_SECRET");
    expect(script).toContain("GH_TOKEN/GITHUB_TOKEN");
    expect(script).toContain("OPENCLAWCODE_SETUP_OPERATOR_ROOT");
    expect(script).toContain("OPENCLAWCODE_OPERATOR_ROOT");
    expect(script).toContain("OPENCLAWCODE_SETUP_GITHUB_HOOK_ID");
    expect(script).toContain("OPENCLAWCODE_SETUP_CLI_STARTUP_METADATA_FILE");
    expect(script).toContain("OPENCLAWCODE_SETUP_RETRY_ATTEMPTS");
    expect(script).toContain("OPENCLAWCODE_SETUP_RETRY_DELAY_SECONDS");
    expect(script).toContain("OPENCLAWCODE_SETUP_NODE_BIN");
    expect(script).toContain("OPENCLAWCODE_SETUP_CLI_PROBE_TIMEOUT_SECONDS");
    expect(script).toContain("OPENCLAWCODE_SETUP_STARTUP_PROOF_PORT");
    expect(script).toContain("OPENCLAWCODE_SETUP_STARTUP_PROOF_TIMEOUT_SECONDS");
    expect(script).toContain("OPENCLAWCODE_SETUP_PROBE_BUILT_STARTUP");
    expect(script).toContain("refresh_github_hook_settings");
    expect(script).toContain("retry_check");
    expect(script).toContain("--probe-built-startup");
    expect(script).toContain("models list --json");
    expect(script).toContain("model-inventory-config.json");
    expect(script).toContain("OPENCLAW_SKIP_CANVAS_HOST=1");
    expect(script).toContain("run_cli_probe");
    expect(script).toContain('"allow": ["openclawcode"]');
    expect(script).toContain('"slots": {"memory": "none"}');
    expect(script).toContain("listening on ws://127.0.0.1:${STARTUP_PROOF_PORT}");
    expect(script).toContain("pull_request_review");
    expect(script).toContain('"reason":"unconfigured-repo"');
    expect(script).toContain("repoBindingsByRepo");
    expect(script).toContain("--connect-timeout 2");
    expect(script).toContain("--max-time 5");
    expect(script).toContain("GitHub webhook subscription check");
    expect(script).toContain("cli-startup-metadata.json");
    expect(script).toContain("minimumNodeVersion");
    expect(script).toContain('"$NODE_BIN" --version');
    expect(script).toContain("vitest.openclawcode.config.mjs");
    expect(script).toContain("--pool threads");
    expect(script).toContain('"modelInventory":');
    expect(script).toContain('"pluginActivation":');
    expect(script).toContain('"readiness":');
    expect(script).toContain('"chatSetupRoutingReady":');
    expect(script).toContain('"gatewayReachable":');
    expect(script).toContain('"routeProbeReady":');
    expect(script).toContain('"builtStartupProofReady":');
    expect(script).toContain('"checks":[');
    expect(script).toContain('"summary":{"pass":');
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
  }, 60_000);

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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
    expect(result.stdout).toContain(
      `[PASS] local Node 22.16.0 satisfies CLI startup floor 22.16.0 (${path.join(distDir, "cli-startup-metadata.json")})`,
    );
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

  it("emits machine-readable JSON with --json", async () => {
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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
                      notifyTarget: "user:json-output",
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
              notifyTarget: "user:json-output",
              updatedAt: "2026-03-13T00:00:00.000Z",
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

    const result = runSetupCheck(
      scriptPath,
      {
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
      },
      ["--json"],
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("[PASS]");

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      strict: boolean;
      repoRoot: string;
      operatorRoot: string;
      gatewayUrl: string;
      modelInventory: {
        available: number;
        keys: string[];
        configuredFallbacks: string[];
        missingConfiguredFallbacks?: string[];
        fallbackReady: boolean;
      };
      readiness: {
        basic: boolean;
        strict: boolean;
        lowRiskProofReady: boolean;
        fallbackProofReady: boolean;
        promotionReady: boolean;
        chatSetupRoutingReady: boolean;
        gatewayReachable: boolean;
        routeProbeReady: boolean;
        routeProbeSkipped: boolean;
        builtStartupProofRequested: boolean;
        builtStartupProofReady: boolean;
        nextAction: string;
      };
      pluginActivation: {
        ready: boolean;
        pluginsEnabled: boolean;
        allowlisted: boolean;
        entryEnabled: boolean;
      };
      summary: { pass: number; warn: number; fail: number };
      checks: Array<{ status: string; message: string }>;
    };

    expect(payload.ok).toBe(true);
    expect(payload.strict).toBe(false);
    expect(payload.repoRoot).toBe(repoRoot);
    expect(payload.gatewayUrl).toBe("http://127.0.0.1:18789");
    expect(payload.modelInventory).toMatchObject({
      available: 1,
      keys: ["crs/gpt-5.4"],
      configuredFallbacks: [],
      fallbackReady: false,
    });
    expect(payload.readiness).toMatchObject({
      basic: true,
      strict: false,
      lowRiskProofReady: false,
      fallbackProofReady: false,
      promotionReady: false,
      chatSetupRoutingReady: true,
      gatewayReachable: true,
      routeProbeReady: true,
      routeProbeSkipped: false,
      builtStartupProofRequested: false,
      builtStartupProofReady: false,
      nextAction: "resolve-warnings-before-promotion",
    });
    expect(payload.pluginActivation).toMatchObject({
      ready: true,
      pluginsEnabled: true,
      allowlisted: true,
      entryEnabled: true,
    });
    expect(payload.summary.fail).toBe(0);
    expect(payload.summary.pass).toBeGreaterThan(0);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "pass",
          message: expect.stringContaining("built CLI artifact present"),
        }),
        expect.objectContaining({
          status: "pass",
          message: expect.stringContaining("signed webhook probe reached plugin route"),
        }),
        expect.objectContaining({
          status: "pass",
          message: expect.stringContaining("fallback proof readiness: false"),
        }),
      ]),
    );
  });

  it("fails readiness explicitly when plugin activation is missing", async () => {
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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
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
            enabled: true,
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
                      notifyTarget: "user:missing-allow",
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
              notifyTarget: "user:missing-allow",
              updatedAt: "2026-03-13T00:00:00.000Z",
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

    const result = runSetupCheck(
      scriptPath,
      {
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
      },
      ["--json"],
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      pluginActivation: {
        ready: boolean;
        pluginsEnabled: boolean;
        allowlisted: boolean;
        entryEnabled: boolean;
      };
      readiness: {
        chatSetupRoutingReady: boolean;
        nextAction: string;
      };
      checks: Array<{ status: string; message: string }>;
    };
    expect(payload.ok).toBe(false);
    expect(payload.pluginActivation).toMatchObject({
      ready: false,
      pluginsEnabled: true,
      allowlisted: false,
      entryEnabled: true,
    });
    expect(payload.readiness).toMatchObject({
      chatSetupRoutingReady: false,
      nextAction: "repair-plugin-activation",
    });
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "fail",
          message: expect.stringContaining("openclawcode plugin activation missing"),
        }),
      ]),
    );
  });

  it("fails when configured model fallback overrides are not discoverable", async () => {
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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir, "22.16.0", ["crs/gpt-5.4"]);
    await fs.writeFile(
      envFile,
      [
        "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret",
        "GH_TOKEN=dummy-token",
        "OPENCLAWCODE_MODEL_FALLBACKS=openai/gpt-5-mini",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
                      notifyTarget: "user:fallback-missing",
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
              notifyTarget: "user:fallback-missing",
              updatedAt: "2026-03-13T00:00:00.000Z",
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
    expect(result.stdout).toContain("[PASS] model inventory exposes 1 available model(s)");
    expect(result.stdout).toContain(
      "[FAIL] configured OPENCLAWCODE_MODEL_FALLBACKS entries are not discoverable: openai/gpt-5-mini",
    );
  });

  it("sanitizes the model inventory probe config before running the built CLI", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const stateFile = path.join(rootDir, "chatops-state.json");
    const probeMarker = path.join(rootDir, "models-probe-called");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeStubCliArtifacts(distDir);
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          channels: {
            feishu: {
              enabled: true,
            },
          },
          bindings: [
            {
              agentId: "main",
              match: {
                channel: "feishu",
                accountId: "default",
              },
            },
          ],
          plugins: {
            enabled: true,
            allow: ["openclawcode"],
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
                      notifyTarget: "user:model-inventory",
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
              notifyTarget: "user:model-inventory",
              updatedAt: "2026-03-14T05:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeExecutable(
      path.join(binDir, "node"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" || "\${1:-}" == "-v" ]]; then
  printf 'v22.16.0\\n'
  exit 0
fi
if [[ "\${1:-}" == *"/dist/index.js" && "\${2:-}" == "models" && "\${3:-}" == "list" && "\${4:-}" == "--json" ]]; then
  printf 'called\\n' >"${probeMarker}"
  python3 - "\${OPENCLAW_CONFIG_PATH}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

assert payload.get("channels") == {}
assert payload.get("bindings") == []
plugins = payload.get("plugins") or {}
assert plugins.get("enabled") is False
assert plugins.get("entries") == {}
print('{"count":1,"models":[{"key":"crs/gpt-5.4","name":"Stub Model 1","input":"text","local":false,"available":true,"tags":["default","configured"],"missing":false}]}')
PY
  exit 0
fi
printf 'stub node only supports --version and models list\\n' >&2
exit 1
`,
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

    const result = runSetupCheck(
      scriptPath,
      {
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
      },
      ["--json"],
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      modelInventory: { available: number; keys: string[] };
      checks: Array<{ status: string; message: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.modelInventory).toMatchObject({
      available: 1,
      keys: ["crs/gpt-5.4"],
    });
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "pass",
          message: expect.stringContaining("model inventory exposes 1 available model(s)"),
        }),
      ]),
    );
    await expect(fs.readFile(probeMarker, "utf8")).resolves.toBe("called\n");
  });

  it("parses model inventory json even when config warnings prefix stdout", async () => {
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
    await writeStubCliArtifacts(distDir);
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
            enabled: true,
            allow: ["openclawcode"],
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
                      notifyTarget: "user:model-warning-prefix",
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
              notifyTarget: "user:model-warning-prefix",
              updatedAt: "2026-03-16T02:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeExecutable(
      path.join(binDir, "node"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" || "\${1:-}" == "-v" ]]; then
  printf 'v22.16.0\\n'
  exit 0
fi
if [[ "\${1:-}" == *"/dist/index.js" && "\${2:-}" == "models" && "\${3:-}" == "list" && "\${4:-}" == "--json" ]]; then
  printf 'Config warnings:\\n- plugins.entries.brave: plugin brave mismatch\\n'
  printf '{"count":1,"models":[{"key":"crs/gpt-5.4","available":true}]}'$'\\n'
  exit 0
fi
printf 'stub node only supports --version and models list\\n' >&2
exit 1
`,
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

    const result = runSetupCheck(
      scriptPath,
      {
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
      },
      ["--json"],
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      modelInventory: { available: number; keys: string[] };
      checks: Array<{ status: string; message: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.modelInventory).toMatchObject({
      available: 1,
      keys: ["crs/gpt-5.4"],
    });
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "pass",
          message: expect.stringContaining("model inventory exposes 1 available model(s)"),
        }),
      ]),
    );
  });

  it("fails when local Node is below the CLI startup floor", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const stateFile = path.join(rootDir, "chatops-state.json");
    const modelProbeMarker = path.join(rootDir, "models-probe-called");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeStubCliArtifacts(distDir, "22.16.0");
    await writeExecutable(
      path.join(binDir, "node"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" || "\${1:-}" == "-v" ]]; then
  printf 'v22.12.0\\n'
  exit 0
fi
if [[ "\${1:-}" == *"/dist/index.js" && "\${2:-}" == "models" && "\${3:-}" == "list" && "\${4:-}" == "--json" ]]; then
  printf 'called\\n' >"${modelProbeMarker}"
  exit 9
fi
printf 'stub node only supports --version\\n' >&2
exit 1
`,
    );
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
                      notifyTarget: "user:stale-node",
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
              notifyTarget: "user:stale-node",
              updatedAt: "2026-03-12T16:40:00.000Z",
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
      `[FAIL] local Node 22.12.0 is below CLI startup floor 22.16.0 (${path.join(distDir, "cli-startup-metadata.json")}) via node`,
    );
    expect(result.stdout).toContain(
      "[WARN] skipping model inventory with node because the configured Node runtime is below the CLI startup floor",
    );
    await expect(fs.access(modelProbeMarker)).rejects.toThrow();
  });

  it("uses OPENCLAWCODE_SETUP_NODE_BIN for CLI probes when the default node is too old", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const oldBinDir = path.join(rootDir, "old-bin");
    const goodBinDir = path.join(rootDir, "good-bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const stateFile = path.join(rootDir, "chatops-state.json");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(oldBinDir, { recursive: true });
    await fs.mkdir(goodBinDir, { recursive: true });
    await writeStubCliArtifacts(distDir, "22.16.0");
    await writeStubNode(oldBinDir, "22.12.0");
    await writeStubNode(goodBinDir, "22.16.0", ["crs/gpt-5.4"]);
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
                      notifyTarget: "user:node-override",
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
              notifyTarget: "user:node-override",
              updatedAt: "2026-03-13T17:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeExecutable(
      path.join(oldBinDir, "python3"),
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
      path.join(oldBinDir, "curl"),
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'{"accepted":false,"reason":"unconfigured-repo"}\\n202\'\n',
    );

    const result = runSetupCheck(
      scriptPath,
      {
        PATH: `${oldBinDir}:${process.env.PATH ?? ""}`,
        OPENCLAWCODE_SETUP_NODE_BIN: path.join(goodBinDir, "node"),
        OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
        OPENCLAWCODE_SETUP_ENV_FILE: envFile,
        OPENCLAWCODE_SETUP_CONFIG_FILE: configFile,
        OPENCLAWCODE_SETUP_STATE_FILE: stateFile,
        OPENCLAWCODE_SETUP_GATEWAY_URL: "http://127.0.0.1:18789",
        OPENCLAWCODE_SETUP_WEBHOOK_ROUTE: "/plugins/openclawcode/github",
        OPENCLAWCODE_GITHUB_REPO: "zhyongrui/openclawcode",
        OPENCLAWCODE_TUNNEL_LOG_FILE: path.join(rootDir, "tunnel.log"),
        OPENCLAWCODE_TUNNEL_PID_FILE: path.join(rootDir, "tunnel.pid"),
      },
      ["--json"],
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      modelInventory: { available: number };
    };
    expect(payload.ok).toBe(true);
    expect(payload.modelInventory.available).toBe(1);
  });

  it("can run an isolated built startup proof for the bundled openclawcode plugin", async () => {
    const rootDir = await createTempDir();
    tempRoots.add(rootDir);
    const repoRoot = path.join(rootDir, "repo");
    const distDir = path.join(repoRoot, "dist");
    const binDir = path.join(rootDir, "bin");
    const envFile = path.join(rootDir, "openclawcode.env");
    const configFile = path.join(rootDir, "openclaw.json");
    const stateFile = path.join(rootDir, "chatops-state.json");
    const startupProbeMarker = path.join(rootDir, "startup-proof-called");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeStubCliArtifacts(distDir);
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          channels: {
            feishu: {
              enabled: true,
            },
          },
          bindings: [
            {
              agentId: "main",
              match: {
                channel: "feishu",
                accountId: "default",
              },
            },
          ],
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
                      notifyTarget: "user:startup-proof",
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
              notifyTarget: "user:startup-proof",
              updatedAt: "2026-03-14T03:49:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await writeExecutable(
      path.join(binDir, "node"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" || "\${1:-}" == "-v" ]]; then
  printf 'v22.16.0\\n'
  exit 0
fi
if [[ "\${1:-}" == *"/dist/index.js" && "\${2:-}" == "models" && "\${3:-}" == "list" && "\${4:-}" == "--json" ]]; then
  cat <<'EOF'
{"count":1,"models":[{"key":"crs/gpt-5.4","name":"Stub Model 1","input":"text","local":false,"available":true,"tags":["default","configured"],"missing":false}]}
EOF
  exit 0
fi
if [[ "\${1:-}" == *"/dist/index.js" && "\${2:-}" == "gateway" && "\${3:-}" == "run" ]]; then
  printf 'called\\n' >"${startupProbeMarker}"
  python3 - "\${OPENCLAW_CONFIG_PATH}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

assert payload.get("channels") == {}
assert payload.get("bindings") == []
plugins = payload.get("plugins") or {}
assert plugins.get("allow") == ["openclawcode"]
assert (plugins.get("slots") or {}).get("memory") == "none"
entry = ((plugins.get("entries") or {}).get("openclawcode") or {})
assert entry.get("enabled") is True

print("2026-03-14T03:49:30.352+00:00 [gateway] listening on ws://127.0.0.1:18890, ws://[::1]:18890 (PID 12345)")
PY
  exit 0
fi
printf 'stub node only supports --version, models list, and gateway run\\n' >&2
exit 1
`,
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

    const result = runSetupCheck(
      scriptPath,
      {
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
      },
      ["--probe-built-startup"],
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "[PASS] built gateway startup proof reached listener on ws://127.0.0.1:18890",
    );
    await expect(fs.readFile(startupProbeMarker, "utf8")).resolves.toBe("called\n");
  });

  it(
    "distinguishes a passing built startup proof from a down live gateway in readiness json",
    { timeout: 60_000 },
    async () => {
      const rootDir = await createTempDir();
      tempRoots.add(rootDir);
      const repoRoot = path.join(rootDir, "repo");
      const distDir = path.join(repoRoot, "dist");
      const binDir = path.join(rootDir, "bin");
      const envFile = path.join(rootDir, "openclawcode.env");
      const configFile = path.join(rootDir, "openclaw.json");
      const stateFile = path.join(rootDir, "chatops-state.json");
      const startupProbeMarker = path.join(rootDir, "startup-proof-called");
      const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
      const realPythonPath = resolveRealPythonPath();

      await fs.mkdir(distDir, { recursive: true });
      await fs.mkdir(binDir, { recursive: true });
      await writeStubCliArtifacts(distDir);
      await fs.writeFile(
        envFile,
        "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
        "utf8",
      );
      await fs.writeFile(
        configFile,
        `${JSON.stringify(
          {
            channels: {
              feishu: {
                enabled: true,
              },
            },
            bindings: [
              {
                agentId: "main",
                match: {
                  channel: "feishu",
                  accountId: "default",
                },
              },
            ],
            plugins:
          {
              enabled: true,
            allow: ["openclawcode"],
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
                        notifyTarget: "user:startup-proof-json",
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
                notifyTarget: "user:startup-proof-json",
                updatedAt: "2026-03-14T04:30:00.000Z",
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await writeExecutable(
        path.join(binDir, "node"),
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" || "\${1:-}" == "-v" ]]; then
  printf 'v22.16.0\\n'
  exit 0
fi
if [[ "\${1:-}" == *"/dist/index.js" && "\${2:-}" == "models" && "\${3:-}" == "list" && "\${4:-}" == "--json" ]]; then
  cat <<'EOF'
{"count":1,"models":[{"key":"crs/gpt-5.4","name":"Stub Model 1","input":"text","local":false,"available":true,"tags":["default","configured"],"missing":false}]}
EOF
  exit 0
fi
if [[ "\${1:-}" == *"/dist/index.js" && "\${2:-}" == "gateway" && "\${3:-}" == "run" ]]; then
  printf 'called\\n' >"${startupProbeMarker}"
  python3 - "\${OPENCLAW_CONFIG_PATH}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

assert payload.get("channels") == {}
assert payload.get("bindings") == []
plugins = payload.get("plugins") or {}
assert plugins.get("allow") == ["openclawcode"]
assert (plugins.get("slots") or {}).get("memory") == "none"
print("2026-03-14T04:30:30.352+00:00 [gateway] listening on ws://127.0.0.1:18890, ws://[::1]:18890 (PID 12345)")
PY
  exit 0
fi
printf 'stub node only supports --version, models list, and gateway run\\n' >&2
exit 1
`,
      );
      await writeExecutable(
        path.join(binDir, "python3"),
        `#!/usr/bin/env bash
set -euo pipefail
script="$(cat)"
if [[ "$script" == *"socket.create_connection"* ]]; then
  exit 1
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
        '#!/usr/bin/env bash\nset -euo pipefail\nprintf "curl: (7) Failed to connect to 127.0.0.1 port 18789 after 0 ms: Couldn\'t connect to server\\n" >&2\nexit 7\n',
      );

      const result = runSetupCheck(
        scriptPath,
        {
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
        },
        ["--json", "--probe-built-startup"],
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        readiness: {
          basic: boolean;
          strict: boolean;
          chatSetupRoutingReady: boolean;
          gatewayReachable: boolean;
          routeProbeReady: boolean;
          routeProbeSkipped: boolean;
          builtStartupProofRequested: boolean;
          builtStartupProofReady: boolean;
          nextAction: string;
        };
        checks: Array<{ status: string; message: string }>;
      };

      expect(payload.ok).toBe(false);
      expect(payload.readiness).toMatchObject({
        basic: false,
        strict: false,
        chatSetupRoutingReady: true,
        gatewayReachable: false,
        routeProbeReady: false,
        routeProbeSkipped: false,
        builtStartupProofRequested: true,
        builtStartupProofReady: true,
        nextAction: "start-or-restart-live-gateway",
      });
      expect(payload.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "fail",
            message: expect.stringContaining("gateway not reachable"),
          }),
          expect.objectContaining({
            status: "pass",
            message: expect.stringContaining("built gateway startup proof reached listener"),
          }),
        ]),
      );
      await expect(fs.readFile(startupProbeMarker, "utf8")).resolves.toBe("called\n");
    },
  );

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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
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
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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

  it("retries transient GitHub hook subscription probe failures before passing strict mode", async () => {
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
    const hookCounterFile = path.join(rootDir, "hook-check-count.txt");
    const tunnelLogFile = path.join(rootDir, "strict-tunnel.log");
    const tunnelPidFile = path.join(rootDir, "strict-tunnel.pid");
    const scriptPath = path.resolve("scripts/openclawcode-setup-check.sh");
    const realPythonPath = resolveRealPythonPath();

    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(pluginsDir, { recursive: true });
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
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
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
  count=0
  if [[ -f "${hookCounterFile}" ]]; then
    count="$(cat "${hookCounterFile}")"
  fi
  count="$((count + 1))"
  printf '%s\\n' "$count" >"${hookCounterFile}"
  if [[ "$count" -eq 1 ]]; then
    printf 'urllib.error.URLError: transient TLS failure\\n' >&2
    exit 1
  fi
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
        OPENCLAWCODE_SETUP_RETRY_ATTEMPTS: "2",
        OPENCLAWCODE_SETUP_RETRY_DELAY_SECONDS: "0",
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
    await expect(fs.readFile(hookCounterFile, "utf8")).resolves.toContain("2");
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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
    await fs.writeFile(
      envFile,
      "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=test-secret\nGH_TOKEN=dummy-token\n",
      "utf8",
    );
    await fs.writeFile(
      configFile,
      `${JSON.stringify(
        {
          plugins:
          {
            enabled: true,
            allow: ["openclawcode"],
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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
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
    await writeStubCliArtifacts(distDir);
    await writeStubNode(binDir);
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
