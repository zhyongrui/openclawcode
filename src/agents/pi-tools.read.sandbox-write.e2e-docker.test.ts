import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSandboxedWriteTool } from "./pi-tools.read.js";
import { DEFAULT_SANDBOX_IMAGE } from "./sandbox/constants.js";
import { buildSandboxCreateArgs, execDocker, execDockerRaw } from "./sandbox/docker.js";
import { createSandboxFsBridge } from "./sandbox/fs-bridge.js";
import { createSandboxTestContext } from "./sandbox/test-fixtures.js";
import { appendWorkspaceMountArgs } from "./sandbox/workspace-mounts.js";

async function sandboxImageReady(): Promise<boolean> {
  try {
    const dockerVersion = await execDockerRaw(["version"], { allowFailure: true });
    if (dockerVersion.code !== 0) {
      return false;
    }
    const pythonCheck = await execDockerRaw(
      ["run", "--rm", "--entrypoint", "python3", DEFAULT_SANDBOX_IMAGE, "--version"],
      { allowFailure: true },
    );
    return pythonCheck.code === 0;
  } catch {
    return false;
  }
}

async function createLinkedWorktreeFixture(root: string): Promise<{ workspaceDir: string }> {
  const repoRoot = path.join(root, "repo");
  const workspaceDir = path.join(repoRoot, ".openclawcode", "worktrees", "run-1");
  const commonGitDir = path.join(repoRoot, ".git");
  const adminDir = path.join(commonGitDir, "worktrees", "run-1");
  await fs.mkdir(adminDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, ".git"), `gitdir: ${adminDir}\n`, "utf8");
  await fs.writeFile(path.join(adminDir, "commondir"), "../..\n", "utf8");
  await fs.writeFile(path.join(adminDir, "gitdir"), `${path.join(workspaceDir, ".git")}\n`, "utf8");
  return { workspaceDir };
}

describe("createSandboxedWriteTool docker e2e", () => {
  it.runIf(process.platform !== "win32")(
    "writes a new workspace file through the sandbox bridge using alias-style write params",
    async () => {
      if (!(await sandboxImageReady())) {
        return;
      }

      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-write-e2e-"));
      const workspaceDir = path.join(stateDir, "workspace");
      const targetRelativePath = path.join("docs", "openclawcode", "write-proof.md");
      const targetPath = path.join(workspaceDir, targetRelativePath);
      const content = [
        "# Write Proof",
        "",
        "- sandbox write tool can create new files",
        "- alias-style file_path params normalize correctly",
        "",
      ].join("\n");

      const suffix = `${process.pid}-${Date.now()}`;
      const containerName = `openclaw-sbx-write-${suffix}`.slice(0, 63);

      try {
        const sandbox = createSandboxTestContext({
          overrides: {
            workspaceDir,
            agentWorkspaceDir: workspaceDir,
            containerName,
            containerWorkdir: "/workspace",
          },
          dockerOverrides: {
            image: DEFAULT_SANDBOX_IMAGE,
            containerPrefix: "openclaw-sbx-write-",
            user: "",
          },
        });

        const createArgs = buildSandboxCreateArgs({
          name: containerName,
          cfg: sandbox.docker,
          scopeKey: sandbox.sessionKey,
          includeBinds: false,
          bindSourceRoots: [workspaceDir],
        });
        createArgs.push("--workdir", sandbox.containerWorkdir);
        appendWorkspaceMountArgs({
          args: createArgs,
          workspaceDir,
          agentWorkspaceDir: workspaceDir,
          workdir: sandbox.containerWorkdir,
          workspaceAccess: sandbox.workspaceAccess,
        });
        createArgs.push(sandbox.docker.image, "sleep", "infinity");

        await execDocker(createArgs);
        await execDocker(["start", containerName]);

        const bridge = createSandboxFsBridge({ sandbox });
        const tool = createSandboxedWriteTool({
          root: workspaceDir,
          bridge,
        });

        const result = await tool.execute(
          "call-1",
          {
            file_path: targetRelativePath.split(path.sep).join(path.posix.sep),
            content,
          },
          undefined,
        );

        await expect(fs.readFile(targetPath, "utf8")).resolves.toBe(content);
        const blocks = Array.isArray((result as { content?: unknown }).content)
          ? (result as { content: Array<{ type?: string; text?: string }> }).content
          : [];
        expect(blocks.find((entry) => entry?.type === "text")?.text).toContain("Wrote");
      } finally {
        await execDocker(["rm", "-f", containerName], { allowFailure: true });
        await fs.rm(stateDir, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "keeps linked-worktree writes visible through both workspace mounts",
    async () => {
      if (!(await sandboxImageReady())) {
        return;
      }

      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-write-worktree-"));
      const { workspaceDir } = await createLinkedWorktreeFixture(stateDir);
      const targetRelativePath = path.join("src", "commands", "write-proof.ts");
      const targetPath = path.join(workspaceDir, targetRelativePath);
      const content = [
        "export const writeProof = {",
        '  mode: "sandbox-write",',
        "  ok: true,",
        "};",
        "",
      ].join("\n");

      const suffix = `${process.pid}-${Date.now()}`;
      const containerName = `openclaw-sbx-writewt-${suffix}`.slice(0, 63);

      try {
        const sandbox = createSandboxTestContext({
          overrides: {
            workspaceDir,
            agentWorkspaceDir: workspaceDir,
            containerName,
            containerWorkdir: "/workspace",
          },
          dockerOverrides: {
            image: DEFAULT_SANDBOX_IMAGE,
            containerPrefix: "openclaw-sbx-writewt-",
            user: "",
          },
        });

        const createArgs = buildSandboxCreateArgs({
          name: containerName,
          cfg: sandbox.docker,
          scopeKey: sandbox.sessionKey,
          includeBinds: false,
          bindSourceRoots: [workspaceDir],
        });
        createArgs.push("--workdir", sandbox.containerWorkdir);
        appendWorkspaceMountArgs({
          args: createArgs,
          workspaceDir,
          agentWorkspaceDir: workspaceDir,
          workdir: sandbox.containerWorkdir,
          workspaceAccess: sandbox.workspaceAccess,
        });
        createArgs.push(sandbox.docker.image, "sleep", "infinity");

        await execDocker(createArgs);
        await execDocker(["start", containerName]);

        const bridge = createSandboxFsBridge({ sandbox });
        const tool = createSandboxedWriteTool({
          root: workspaceDir,
          bridge,
        });

        const result = await tool.execute(
          "call-1",
          {
            file_path: targetRelativePath.split(path.sep).join(path.posix.sep),
            content,
          },
          undefined,
        );

        await expect(fs.readFile(targetPath, "utf8")).resolves.toBe(content);

        const posixRelativePath = targetRelativePath.split(path.sep).join(path.posix.sep);
        const workspaceView = await execDockerRaw(
          ["exec", "-i", containerName, "sh", "-lc", `cat /workspace/${posixRelativePath}`],
          { allowFailure: true },
        );
        expect(workspaceView.code).toBe(0);
        expect(workspaceView.stdout.toString("utf8")).toBe(content);

        const hostAliasView = await execDockerRaw(
          [
            "exec",
            "-i",
            containerName,
            "sh",
            "-lc",
            `cat ${path.posix.join(workspaceDir, posixRelativePath)}`,
          ],
          { allowFailure: true },
        );
        expect(hostAliasView.code).toBe(0);
        expect(hostAliasView.stdout.toString("utf8")).toBe(content);

        const blocks = Array.isArray((result as { content?: unknown }).content)
          ? (result as { content: Array<{ type?: string; text?: string }> }).content
          : [];
        expect(blocks.find((entry) => entry?.type === "text")?.text).toContain("Wrote");
      } finally {
        await execDocker(["rm", "-f", containerName], { allowFailure: true });
        await fs.rm(stateDir, { recursive: true, force: true });
      }
    },
  );
});
