import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-setup-check-"));
}

function runSetupCheck(scriptPath: string, env: NodeJS.ProcessEnv) {
  return spawnSync("bash", [scriptPath], {
    cwd: path.resolve("."),
    env,
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
    expect(script).toContain("OPENCLAWCODE_SETUP_GITHUB_HOOK_ID");
    expect(script).toContain("pull_request_review");
    expect(script).toContain('"reason":"unconfigured-repo"');
    expect(script).toContain("repoBindingsByRepo");
    expect(script).toContain("--connect-timeout 2");
    expect(script).toContain("--max-time 5");
    expect(script).toContain("GitHub webhook subscription check");
  });

  it("keeps the webhook tunnel helper aligned with the required GitHub event set", async () => {
    const script = await fs.readFile(
      path.resolve("scripts/openclawcode-webhook-tunnel.sh"),
      "utf8",
    );

    expect(script).toContain("issues,pull_request,pull_request_review");
    expect(script).toContain('"events": events');
    expect(script).toContain("OPENCLAWCODE_GITHUB_HOOK_EVENTS");
    expect(script).toContain("find_running_tunnel_pid");
  });
});

describeWithShell("openclawcode-setup-check.sh", () => {
  const tempRoots = new Set<string>();

  afterEach(async () => {
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
    await fs.writeFile(configFile, "{}\n", "utf8");
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
printf '%s' "$script" | "${realPythonPath}" - "$@"
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
      ...process.env,
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
    expect(result.stdout).toContain("[PASS] signed webhook probe reached plugin route");
    expect(result.stdout).toContain("[PASS] repo binding present for zhyongrui/openclawcode");
    expect(result.stdout).toContain("Summary:");

    const curlArgs = await fs.readFile(curlArgsFile, "utf8");
    expect(curlArgs).toContain("X-GitHub-Event: issues");
    expect(curlArgs).toContain("X-Hub-Signature-256: sha256=test-signature");
    expect(curlArgs).toContain("http://127.0.0.1:18789/plugins/openclawcode/github");
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
printf '%s' "$script" | "${realPythonPath}" - "$@"
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'{"accepted":false,"reason":"unconfigured-repo"}\\n202\'\n',
    );

    const result = runSetupCheck(scriptPath, {
      ...process.env,
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
    expect(result.stdout).toContain("[FAIL] webhook secret missing");
  });
});
