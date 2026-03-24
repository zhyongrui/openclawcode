import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execFileUtf8 } from "../../daemon/exec-file.js";
import { GitWorktreeManager } from "../worktree/index.js";

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileUtf8("git", ["-C", cwd, ...args]);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

async function createTempRepo(): Promise<{ rootDir: string; worktreeRoot: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-repo-"));
  const worktreeRoot = path.join(rootDir, ".openclawcode-worktrees");

  await runGit(rootDir, ["init"]);
  await runGit(rootDir, ["config", "user.name", "OpenClaw Code Tests"]);
  await runGit(rootDir, ["config", "user.email", "tests@openclawcode.local"]);

  await fs.writeFile(path.join(rootDir, "README.md"), "# temp repo\n", "utf8");
  await runGit(rootDir, ["add", "README.md"]);
  await runGit(rootDir, ["commit", "-m", "init"]);
  await runGit(rootDir, ["branch", "-M", "main"]);

  await fs.mkdir(path.join(rootDir, "node_modules", ".bin"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "node_modules", ".bin", "vitest"), "#!/bin/sh\n", "utf8");

  return { rootDir, worktreeRoot };
}

async function writeAndCommitFile(
  cwd: string,
  relativePath: string,
  contents: string,
  message: string,
): Promise<string> {
  await fs.writeFile(path.join(cwd, relativePath), contents, "utf8");
  await runGit(cwd, ["add", relativePath]);
  await runGit(cwd, ["commit", "-m", message]);
  return runGit(cwd, ["rev-parse", "HEAD"]);
}

describe("GitWorktreeManager", () => {
  it("creates and reuses a per-run worktree", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const first = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-42",
        baseBranch: "main",
        runId: "issue-42",
      });
      const second = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-42",
        baseBranch: "main",
        runId: "issue-42",
      });

      expect(first.worktreePath).toBe(second.worktreePath);
      expect(await fs.readFile(path.join(first.worktreePath, "README.md"), "utf8")).toContain(
        "temp repo",
      );
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("reuses an existing issue branch worktree across reruns", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const first = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-45",
        baseBranch: "main",
        runId: "issue-45-first",
      });
      const second = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-45",
        baseBranch: "main",
        runId: "issue-45-second",
      });

      expect(second.worktreePath).toBe(first.worktreePath);
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("cleans tracked and untracked changes when reusing an existing issue branch worktree", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const first = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-47",
        baseBranch: "main",
        runId: "issue-47-first",
      });

      await fs.writeFile(path.join(first.worktreePath, "README.md"), "# dirty rerun\n", "utf8");
      await fs.writeFile(path.join(first.worktreePath, "notes.txt"), "temp\n", "utf8");
      await fs.writeFile(path.join(first.worktreePath, "HEARTBEAT.md"), "runtime\n", "utf8");
      await fs.mkdir(path.join(first.worktreePath, ".openclaw"), { recursive: true });
      await fs.writeFile(
        path.join(first.worktreePath, ".openclaw", "session.json"),
        "{}\n",
        "utf8",
      );

      const second = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-47",
        baseBranch: "main",
        runId: "issue-47-second",
      });

      expect(second.worktreePath).toBe(first.worktreePath);
      expect(await fs.readFile(path.join(second.worktreePath, "README.md"), "utf8")).toBe(
        "# temp repo\n",
      );
      await expect(fs.stat(path.join(second.worktreePath, "notes.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fs.stat(path.join(second.worktreePath, "HEARTBEAT.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        fs.stat(path.join(second.worktreePath, ".openclaw", "session.json")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("fast-forwards a reusable issue branch to the latest base commit when it has no unique commits", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const first = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-48",
        baseBranch: "main",
        runId: "issue-48-first",
      });

      const updatedBaseHead = await writeAndCommitFile(
        repo.rootDir,
        "README.md",
        "# temp repo v2\n",
        "advance main",
      );

      const second = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-48",
        baseBranch: "main",
        runId: "issue-48-second",
      });

      expect(second.worktreePath).toBe(first.worktreePath);
      expect(await fs.readFile(path.join(second.worktreePath, "README.md"), "utf8")).toBe(
        "# temp repo v2\n",
      );
      expect(await runGit(second.worktreePath, ["rev-parse", "HEAD"])).toBe(updatedBaseHead);
      expect(await runGit(repo.rootDir, ["rev-parse", "openclawcode/issue-48"])).toBe(
        updatedBaseHead,
      );
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("merges the latest base branch into a reusable issue branch while preserving committed changes", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const first = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-49",
        baseBranch: "main",
        runId: "issue-49-first",
      });

      const branchHead = await writeAndCommitFile(
        first.worktreePath,
        "README.md",
        "# issue branch change\n",
        "issue branch change",
      );
      await writeAndCommitFile(repo.rootDir, "base.txt", "base advanced\n", "advance main again");

      await fs.writeFile(path.join(first.worktreePath, "README.md"), "# dirty rerun\n", "utf8");
      await fs.writeFile(path.join(first.worktreePath, "scratch.txt"), "temp\n", "utf8");

      const second = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-49",
        baseBranch: "main",
        runId: "issue-49-second",
      });

      expect(second.worktreePath).toBe(first.worktreePath);
      expect(await fs.readFile(path.join(second.worktreePath, "README.md"), "utf8")).toBe(
        "# issue branch change\n",
      );
      await expect(fs.stat(path.join(second.worktreePath, "scratch.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const refreshedHead = await runGit(second.worktreePath, ["rev-parse", "HEAD"]);
      expect(refreshedHead).not.toBe(branchHead);
      expect(await runGit(repo.rootDir, ["rev-parse", "openclawcode/issue-49"])).toBe(
        refreshedHead,
      );
      expect(await fs.readFile(path.join(second.worktreePath, "base.txt"), "utf8")).toBe(
        "base advanced\n",
      );
      expect(
        await runGit(second.worktreePath, ["merge-base", "--is-ancestor", "main", "HEAD"]),
      ).toBe("");
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("aborts reusable issue branch refresh when merging the latest base would conflict", async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const first = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-50",
        baseBranch: "main",
        runId: "issue-50-first",
      });

      await writeAndCommitFile(
        first.worktreePath,
        "README.md",
        "# branch conflicting change\n",
        "issue branch conflicting change",
      );
      await writeAndCommitFile(
        repo.rootDir,
        "README.md",
        "# main conflicting change\n",
        "advance main with conflict",
      );

      await expect(
        manager.prepare({
          repoRoot: repo.rootDir,
          worktreeRoot: repo.worktreeRoot,
          branchName: "openclawcode/issue-50",
          baseBranch: "main",
          runId: "issue-50-second",
        }),
      ).rejects.toThrow(/merge/i);

      expect(await runGit(first.worktreePath, ["status", "--short"])).toBe("");
      expect(await fs.readFile(path.join(first.worktreePath, "README.md"), "utf8")).toBe(
        "# branch conflicting change\n",
      );
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it("links shared install artifacts into the worktree", { timeout: 60_000 }, async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const workspace = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-46",
        baseBranch: "main",
        runId: "issue-46",
      });

      const nodeModulesStat = await fs.lstat(path.join(workspace.worktreePath, "node_modules"));
      expect(nodeModulesStat.isSymbolicLink()).toBe(true);
      expect(await fs.readlink(path.join(workspace.worktreePath, "node_modules"))).toBe(
        path.join(repo.rootDir, "node_modules"),
      );
      expect(
        await fs.readFile(
          path.join(workspace.worktreePath, "node_modules", ".bin", "vitest"),
          "utf8",
        ),
      ).toContain("#!/bin/sh");
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });

  it(
    "collects tracked and untracked file changes from the isolated worktree",
    { timeout: 60_000 },
    async () => {
      const repo = await createTempRepo();
      const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

      try {
        const workspace = await manager.prepare({
          repoRoot: repo.rootDir,
          worktreeRoot: repo.worktreeRoot,
          branchName: "openclawcode/issue-43",
          baseBranch: "main",
          runId: "issue-43",
        });

        await fs.writeFile(path.join(workspace.worktreePath, "README.md"), "# changed\n", "utf8");
        await fs.writeFile(path.join(workspace.worktreePath, "notes.txt"), "hello\n", "utf8");
        await fs.writeFile(path.join(workspace.worktreePath, "HEARTBEAT.md"), "runtime\n", "utf8");
        await fs.mkdir(path.join(workspace.worktreePath, ".agents", "skills", "tmp"), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(workspace.worktreePath, ".agents", "skills", "tmp", "SKILL.md"),
          "runtime\n",
          "utf8",
        );
        await fs.mkdir(path.join(workspace.worktreePath, ".openclaw"), { recursive: true });
        await fs.writeFile(
          path.join(workspace.worktreePath, ".openclaw", "session.json"),
          "{}\n",
          "utf8",
        );

        expect(await manager.collectChangedFiles(workspace)).toEqual(["README.md", "notes.txt"]);
      } finally {
        await fs.rm(repo.rootDir, { recursive: true, force: true });
      }
    },
  );

  it("removes the worktree during cleanup", { timeout: 60_000 }, async () => {
    const repo = await createTempRepo();
    const manager = new GitWorktreeManager(() => "2026-03-09T12:00:00.000Z");

    try {
      const workspace = await manager.prepare({
        repoRoot: repo.rootDir,
        worktreeRoot: repo.worktreeRoot,
        branchName: "openclawcode/issue-44",
        baseBranch: "main",
        runId: "issue-44",
      });

      await manager.cleanup(workspace);

      await expect(fs.stat(workspace.worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(repo.rootDir, { recursive: true, force: true });
    }
  });
});
