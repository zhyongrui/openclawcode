import fs from "node:fs";
import path from "node:path";
import { isPathInside } from "../../infra/path-guards.js";
import { SANDBOX_AGENT_WORKSPACE_MOUNT } from "./constants.js";
import type { SandboxWorkspaceAccess } from "./types.js";

function mainWorkspaceMountSuffix(access: SandboxWorkspaceAccess): "" | ":ro" {
  return access === "rw" ? "" : ":ro";
}

function agentWorkspaceMountSuffix(access: SandboxWorkspaceAccess): "" | ":ro" {
  return access === "ro" ? ":ro" : "";
}

function mountSuffix(access: SandboxWorkspaceAccess): "" | ":ro" {
  return mainWorkspaceMountSuffix(access);
}

function resolveWorktreeGitAdminMounts(params: {
  workspaceDir: string;
  workspaceAccess: SandboxWorkspaceAccess;
}): string[] {
  const gitPath = path.join(params.workspaceDir, ".git");
  let gitFile: string;
  try {
    if (!fs.statSync(gitPath).isFile()) {
      return [];
    }
    gitFile = fs.readFileSync(gitPath, "utf8");
  } catch {
    return [];
  }

  const match = gitFile.match(/^gitdir:\s*(.+)\s*$/i);
  if (!match) {
    return [];
  }

  const mounts = [
    `${params.workspaceDir}:${params.workspaceDir}${mountSuffix(params.workspaceAccess)}`,
  ];
  const adminDir = path.resolve(params.workspaceDir, match[1]);

  try {
    const commonDirRaw = fs.readFileSync(path.join(adminDir, "commondir"), "utf8").trim();
    if (!commonDirRaw) {
      return mounts;
    }
    const commonDir = path.resolve(adminDir, commonDirRaw);
    if (!isPathInside(params.workspaceDir, commonDir) && commonDir !== params.workspaceDir) {
      mounts.push(`${commonDir}:${commonDir}${mountSuffix(params.workspaceAccess)}`);
    }
  } catch {
    // Best-effort mount discovery; missing commondir means no extra git mount.
  }

  return mounts;
}

export function resolveWorkspaceMounts(params: {
  workspaceDir: string;
  agentWorkspaceDir: string;
  workdir: string;
  workspaceAccess: SandboxWorkspaceAccess;
}): string[] {
  const mounts = [
    `${params.workspaceDir}:${params.workdir}${mainWorkspaceMountSuffix(params.workspaceAccess)}`,
  ];

  if (params.workspaceAccess !== "none" && params.workspaceDir !== params.agentWorkspaceDir) {
    mounts.push(
      `${params.agentWorkspaceDir}:${SANDBOX_AGENT_WORKSPACE_MOUNT}${agentWorkspaceMountSuffix(params.workspaceAccess)}`,
    );
  }

  for (const mount of resolveWorktreeGitAdminMounts(params)) {
    if (!mounts.includes(mount)) {
      mounts.push(mount);
    }
  }

  return mounts;
}

export function appendWorkspaceMountArgs(params: {
  args: string[];
  workspaceDir: string;
  agentWorkspaceDir: string;
  workdir: string;
  workspaceAccess: SandboxWorkspaceAccess;
}) {
  const mounts = resolveWorkspaceMounts(params);
  for (const mount of mounts) {
    params.args.push("-v", mount);
  }
}
