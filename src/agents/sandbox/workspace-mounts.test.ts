import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendWorkspaceMountArgs, resolveWorkspaceMounts } from "./workspace-mounts.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createLinkedWorktreeFixture(): {
  agentWorkspaceDir: string;
  commonGitDir: string;
  workspaceDir: string;
} {
  const root = createTempDir("openclaw-workspace-mounts-");
  const repoRoot = path.join(root, "repo");
  const workspaceDir = path.join(repoRoot, ".openclawcode", "worktrees", "run-1");
  const commonGitDir = path.join(repoRoot, ".git");
  const adminDir = path.join(commonGitDir, "worktrees", "run-1");
  const agentWorkspaceDir = path.join(root, "agent-workspace");

  fs.mkdirSync(adminDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(agentWorkspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, ".git"), `gitdir: ${adminDir}\n`, "utf8");
  fs.writeFileSync(path.join(adminDir, "commondir"), "../..\n", "utf8");
  fs.writeFileSync(path.join(adminDir, "gitdir"), `${path.join(workspaceDir, ".git")}\n`, "utf8");

  return { agentWorkspaceDir, commonGitDir, workspaceDir };
}

describe("appendWorkspaceMountArgs", () => {
  it.each([
    { access: "rw" as const, expected: "/tmp/workspace:/workspace" },
    { access: "ro" as const, expected: "/tmp/workspace:/workspace:ro" },
    { access: "none" as const, expected: "/tmp/workspace:/workspace:ro" },
  ])("sets main mount permissions for workspaceAccess=$access", ({ access, expected }) => {
    const args: string[] = [];
    appendWorkspaceMountArgs({
      args,
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/agent-workspace",
      workdir: "/workspace",
      workspaceAccess: access,
    });

    expect(args).toContain(expected);
  });

  it("omits agent workspace mount when workspaceAccess is none", () => {
    const args: string[] = [];
    appendWorkspaceMountArgs({
      args,
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/agent-workspace",
      workdir: "/workspace",
      workspaceAccess: "none",
    });

    const mounts = args.filter((arg) => arg.startsWith("/tmp/"));
    expect(mounts).toEqual(["/tmp/workspace:/workspace:ro"]);
  });

  it("omits agent workspace mount when paths are identical", () => {
    const args: string[] = [];
    appendWorkspaceMountArgs({
      args,
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      workdir: "/workspace",
      workspaceAccess: "rw",
    });

    const mounts = args.filter((arg) => arg.startsWith("/tmp/"));
    expect(mounts).toEqual(["/tmp/workspace:/workspace"]);
  });

  it("adds linked worktree compatibility mounts for host absolute git paths", () => {
    const { agentWorkspaceDir, commonGitDir, workspaceDir } = createLinkedWorktreeFixture();

    const mounts = resolveWorkspaceMounts({
      workspaceDir,
      agentWorkspaceDir,
      workdir: "/workspace",
      workspaceAccess: "rw",
    });

    expect(mounts).toContain(`${workspaceDir}:/workspace`);
    expect(mounts).toContain(`${workspaceDir}:${workspaceDir}`);
    expect(mounts).toContain(`${commonGitDir}:${commonGitDir}`);
  });

  it("keeps linked worktree compatibility mounts read-only when workspace access is none", () => {
    const { agentWorkspaceDir, commonGitDir, workspaceDir } = createLinkedWorktreeFixture();

    const mounts = resolveWorkspaceMounts({
      workspaceDir,
      agentWorkspaceDir,
      workdir: "/workspace",
      workspaceAccess: "none",
    });

    expect(mounts).toContain(`${workspaceDir}:/workspace:ro`);
    expect(mounts).toContain(`${workspaceDir}:${workspaceDir}:ro`);
    expect(mounts).toContain(`${commonGitDir}:${commonGitDir}:ro`);
  });
});
