import fs from "node:fs/promises";
import path from "node:path";
import { execFileUtf8 } from "../../daemon/exec-file.js";
import type { WorkflowWorkspace } from "../contracts/index.js";

export interface PrepareWorkspaceParams {
  repoRoot: string;
  worktreeRoot: string;
  branchName: string;
  baseBranch: string;
  runId: string;
}

export interface WorkflowWorkspaceManager {
  prepare(params: PrepareWorkspaceParams): Promise<WorkflowWorkspace>;
  collectChangedFiles(workspace: WorkflowWorkspace): Promise<string[]>;
  cleanup(workspace: WorkflowWorkspace): Promise<void>;
}

const RUNTIME_ARTIFACT_RULES = [
  ".agent/",
  ".agents/",
  ".openclaw/",
  "HEARTBEAT.md",
  "SOUL.md",
  "TOOLS.md",
];
const SHARED_INSTALL_ARTIFACTS = ["node_modules"];

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileUtf8("git", ["-C", cwd, ...args]);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

type GitWorktreeEntry = {
  path: string;
  branch?: string;
};

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function listGitWorktrees(repoRoot: string): Promise<GitWorktreeEntry[]> {
  const output = await runGit(repoRoot, ["worktree", "list", "--porcelain"]);
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | undefined;

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      if (current?.path) {
        entries.push(current);
      }
      current = undefined;
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current?.path) {
        entries.push(current);
      }
      current = { path: line.slice("worktree ".length).trim() };
      continue;
    }

    if (line.startsWith("branch ")) {
      current ??= { path: "" };
      current.branch = line.slice("branch ".length).trim();
    }
  }

  if (current?.path) {
    entries.push(current);
  }

  return entries;
}

function shouldIgnoreChangedFile(file: string): boolean {
  const ignoredRules = [...RUNTIME_ARTIFACT_RULES, ...SHARED_INSTALL_ARTIFACTS];
  return ignoredRules.some((rule) => (rule.endsWith("/") ? file.startsWith(rule) : file === rule));
}

async function ensureSharedInstallArtifacts(repoRoot: string, worktreePath: string): Promise<void> {
  for (const relativePath of SHARED_INSTALL_ARTIFACTS) {
    const sourcePath = path.join(repoRoot, relativePath);
    const targetPath = path.join(worktreePath, relativePath);

    if (!(await pathExists(sourcePath)) || (await pathExists(targetPath))) {
      continue;
    }

    await fs.symlink(sourcePath, targetPath, "dir");
  }
}

async function isAncestor(
  repoRoot: string,
  ancestorRef: string,
  descendantRef: string,
): Promise<boolean> {
  const result = await execFileUtf8("git", [
    "-C",
    repoRoot,
    "merge-base",
    "--is-ancestor",
    ancestorRef,
    descendantRef,
  ]);
  return result.code === 0;
}

type ReusableWorktreeRefreshMode = "reset-to-base" | "reset-to-head" | "merge-base-into-branch";

async function resolveReusableWorktreeRefreshMode(
  params: Pick<PrepareWorkspaceParams, "repoRoot" | "branchName" | "baseBranch">,
): Promise<ReusableWorktreeRefreshMode> {
  if (await isAncestor(params.repoRoot, params.branchName, params.baseBranch)) {
    return "reset-to-base";
  }
  if (await isAncestor(params.repoRoot, params.baseBranch, params.branchName)) {
    return "reset-to-head";
  }
  return "merge-base-into-branch";
}

async function resetAndCleanWorktree(worktreePath: string, resetTarget: string): Promise<void> {
  const reset = await execFileUtf8("git", ["-C", worktreePath, "reset", "--hard", resetTarget]);
  if (reset.code !== 0) {
    throw new Error(reset.stderr || `Failed to reset reusable worktree at ${worktreePath}`);
  }

  const clean = await execFileUtf8("git", ["-C", worktreePath, "clean", "-fd"]);
  if (clean.code !== 0) {
    throw new Error(clean.stderr || `Failed to clean reusable worktree at ${worktreePath}`);
  }
}

async function refreshReusableWorktree(
  params: PrepareWorkspaceParams,
  worktreePath: string,
): Promise<void> {
  const mode = await resolveReusableWorktreeRefreshMode(params);
  if (mode === "reset-to-base") {
    await resetAndCleanWorktree(worktreePath, params.baseBranch);
    return;
  }
  if (mode === "reset-to-head") {
    await resetAndCleanWorktree(worktreePath, "HEAD");
    return;
  }

  await resetAndCleanWorktree(worktreePath, "HEAD");
  const merge = await execFileUtf8("git", [
    "-C",
    worktreePath,
    "merge",
    "--no-edit",
    params.baseBranch,
  ]);
  if (merge.code !== 0) {
    const abort = await execFileUtf8("git", ["-C", worktreePath, "merge", "--abort"]);
    const abortSuffix =
      abort.code === 0 ? "" : ` Merge abort also failed: ${abort.stderr || "unknown error"}`;
    throw new Error(
      (merge.stderr || `Failed to merge ${params.baseBranch} into ${params.branchName}`) +
        abortSuffix,
    );
  }
}

export class GitWorktreeManager implements WorkflowWorkspaceManager {
  constructor(private readonly now: () => string = nowIso) {}

  private resolveWorktreePath(params: PrepareWorkspaceParams): string {
    return path.join(params.worktreeRoot, sanitizePathSegment(params.runId));
  }

  async prepare(params: PrepareWorkspaceParams): Promise<WorkflowWorkspace> {
    const worktreePath = this.resolveWorktreePath(params);
    const branchRef = `refs/heads/${params.branchName}`;

    await fs.mkdir(params.worktreeRoot, { recursive: true });

    if (!(await pathExists(worktreePath))) {
      await runGit(params.repoRoot, ["worktree", "prune"]);

      const existingBranchWorktree = (await listGitWorktrees(params.repoRoot)).find(
        (entry) => entry.branch === branchRef,
      );
      if (existingBranchWorktree && (await pathExists(existingBranchWorktree.path))) {
        await refreshReusableWorktree(params, existingBranchWorktree.path);
        await ensureSharedInstallArtifacts(params.repoRoot, existingBranchWorktree.path);
        return {
          repoRoot: params.repoRoot,
          baseBranch: params.baseBranch,
          branchName: params.branchName,
          worktreePath: existingBranchWorktree.path,
          preparedAt: this.now(),
        };
      }

      const branchExists =
        (
          await execFileUtf8("git", [
            "-C",
            params.repoRoot,
            "show-ref",
            "--verify",
            "--quiet",
            branchRef,
          ])
        ).code === 0;

      const args = branchExists
        ? ["-C", params.repoRoot, "worktree", "add", worktreePath, params.branchName]
        : [
            "-C",
            params.repoRoot,
            "worktree",
            "add",
            "-b",
            params.branchName,
            worktreePath,
            params.baseBranch,
          ];

      const result = await execFileUtf8("git", args);
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to prepare worktree at ${worktreePath}`);
      }
    }

    await refreshReusableWorktree(params, worktreePath);
    await ensureSharedInstallArtifacts(params.repoRoot, worktreePath);

    return {
      repoRoot: params.repoRoot,
      baseBranch: params.baseBranch,
      branchName: params.branchName,
      worktreePath,
      preparedAt: this.now(),
    };
  }

  async collectChangedFiles(workspace: WorkflowWorkspace): Promise<string[]> {
    const trackedFromBase = await runGit(workspace.worktreePath, [
      "diff",
      "--name-only",
      "--relative",
      `${workspace.baseBranch}...HEAD`,
    ]);
    const trackedFromWorktree = await runGit(workspace.worktreePath, [
      "diff",
      "--name-only",
      "--relative",
      "HEAD",
    ]);
    const untracked = await runGit(workspace.worktreePath, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);

    return Array.from(
      new Set(
        [
          ...trackedFromBase.split("\n"),
          ...trackedFromWorktree.split("\n"),
          ...untracked.split("\n"),
        ]
          .map((entry) => entry.trim())
          .filter(Boolean)
          .filter((entry) => !shouldIgnoreChangedFile(entry)),
      ),
    ).toSorted();
  }

  async cleanup(workspace: WorkflowWorkspace): Promise<void> {
    const remove = await execFileUtf8("git", [
      "-C",
      workspace.repoRoot,
      "worktree",
      "remove",
      "--force",
      workspace.worktreePath,
    ]);
    if (remove.code !== 0) {
      throw new Error(remove.stderr || `Failed to remove worktree ${workspace.worktreePath}`);
    }

    const prune = await execFileUtf8("git", ["-C", workspace.repoRoot, "worktree", "prune"]);
    if (prune.code !== 0) {
      throw new Error(prune.stderr || `Failed to prune worktrees for ${workspace.repoRoot}`);
    }
  }
}
