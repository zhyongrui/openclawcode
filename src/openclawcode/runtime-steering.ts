import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkflowRuntimeRoleSelection, WorkflowStage } from "./contracts/index.js";

export const PROJECT_RUNTIME_STEERING_SCHEMA_VERSION = 1;
export const PROJECT_RUNTIME_STEERING_STAGE_IDS = ["building", "verifying"] as const;

export type ProjectRuntimeSteeringStageId = (typeof PROJECT_RUNTIME_STEERING_STAGE_IDS)[number];

export interface ProjectRuntimeSteeringOverride {
  stageId: ProjectRuntimeSteeringStageId;
  roleId: "coder" | "verifier";
  adapterId: string | null;
  agentId: string | null;
  actor: string | null;
  note: string | null;
  updatedAt: string;
}

export interface ProjectRuntimeSteeringArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  overrideCount: number;
  overrides: ProjectRuntimeSteeringOverride[];
}

export interface ProjectRuntimeSteeringSetOptions {
  repoRoot: string;
  stageId: ProjectRuntimeSteeringStageId;
  adapterId?: string;
  agentId?: string;
  actor?: string;
  note?: string;
  clear?: boolean;
  now?: string;
}

function resolveProjectRuntimeSteeringArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "runtime-steering.json");
}

function emptyProjectRuntimeSteeringArtifact(params: {
  repoRoot: string;
  artifactPath: string;
}): ProjectRuntimeSteeringArtifact {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    overrideCount: 0,
    overrides: [],
  };
}

function normalizeStageId(value: string): ProjectRuntimeSteeringStageId {
  const trimmed = value.trim() as ProjectRuntimeSteeringStageId;
  if (!PROJECT_RUNTIME_STEERING_STAGE_IDS.includes(trimmed)) {
    throw new Error(
      `--stage must be one of: ${PROJECT_RUNTIME_STEERING_STAGE_IDS.join(", ")}`,
    );
  }
  return trimmed;
}

function resolveSteeringRoleId(stageId: ProjectRuntimeSteeringStageId): "coder" | "verifier" {
  return stageId === "building" ? "coder" : "verifier";
}

function normalizeOverride(raw: unknown): ProjectRuntimeSteeringOverride | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<ProjectRuntimeSteeringOverride>;
  if (
    typeof candidate.stageId !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    (candidate.agentId != null && typeof candidate.agentId !== "string") ||
    (candidate.adapterId != null && typeof candidate.adapterId !== "string") ||
    (candidate.actor != null && typeof candidate.actor !== "string") ||
    (candidate.note != null && typeof candidate.note !== "string")
  ) {
    return undefined;
  }

  const stageId = normalizeStageId(candidate.stageId);
  return {
    stageId,
    roleId: resolveSteeringRoleId(stageId),
    adapterId: candidate.adapterId?.trim() || null,
    agentId: candidate.agentId?.trim() || null,
    actor: candidate.actor?.trim() || null,
    note: candidate.note?.trim() || null,
    updatedAt: candidate.updatedAt,
  };
}

export function projectRuntimeSteeringStageIds(): ProjectRuntimeSteeringStageId[] {
  return [...PROJECT_RUNTIME_STEERING_STAGE_IDS];
}

export async function readProjectRuntimeSteeringArtifact(
  repoRootInput: string,
): Promise<ProjectRuntimeSteeringArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectRuntimeSteeringArtifactPath(repoRoot);

  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectRuntimeSteeringArtifact>;
    const overrides = Array.isArray(parsed.overrides)
      ? parsed.overrides
          .map((entry) => normalizeOverride(entry))
          .filter((entry): entry is ProjectRuntimeSteeringOverride => Boolean(entry))
          .toSorted((left, right) => left.stageId.localeCompare(right.stageId))
      : [];
    return {
      repoRoot,
      artifactPath,
      exists: true,
      schemaVersion: PROJECT_RUNTIME_STEERING_SCHEMA_VERSION,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
      overrideCount: overrides.length,
      overrides,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyProjectRuntimeSteeringArtifact({
        repoRoot,
        artifactPath,
      });
    }
    throw error;
  }
}

export async function writeProjectRuntimeSteeringArtifact(
  repoRootInput: string,
): Promise<ProjectRuntimeSteeringArtifact> {
  const current = await readProjectRuntimeSteeringArtifact(repoRootInput);
  await mkdir(path.dirname(current.artifactPath), { recursive: true });
  const persisted = {
    ...current,
    exists: true,
    schemaVersion: PROJECT_RUNTIME_STEERING_SCHEMA_VERSION,
    generatedAt: current.generatedAt ?? new Date().toISOString(),
    overrideCount: current.overrides.length,
  };
  await writeFile(current.artifactPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function recordProjectRuntimeSteeringOverride(
  options: ProjectRuntimeSteeringSetOptions,
): Promise<ProjectRuntimeSteeringArtifact> {
  const current = await readProjectRuntimeSteeringArtifact(options.repoRoot);
  const stageId = normalizeStageId(options.stageId);
  const updatedAt = options.now ?? new Date().toISOString();
  const remaining = current.overrides.filter((entry) => entry.stageId !== stageId);
  const overrides = options.clear
    ? remaining
    : [
        ...remaining,
        {
          stageId,
          roleId: resolveSteeringRoleId(stageId),
          adapterId: options.adapterId?.trim() || null,
          agentId: options.agentId?.trim() || null,
          actor: options.actor?.trim() || null,
          note: options.note?.trim() || null,
          updatedAt,
        } satisfies ProjectRuntimeSteeringOverride,
      ].toSorted((left, right) => left.stageId.localeCompare(right.stageId));
  await mkdir(path.dirname(current.artifactPath), { recursive: true });
  await writeFile(
    current.artifactPath,
    `${JSON.stringify(
      {
        ...current,
        exists: true,
        schemaVersion: PROJECT_RUNTIME_STEERING_SCHEMA_VERSION,
        generatedAt: updatedAt,
        overrideCount: overrides.length,
        overrides,
      } satisfies ProjectRuntimeSteeringArtifact,
      null,
      2,
    )}\n`,
    "utf8",
  );
  return await readProjectRuntimeSteeringArtifact(options.repoRoot);
}

export function applyRuntimeSteeringOverride(params: {
  selection: WorkflowRuntimeRoleSelection;
  stageId: WorkflowStage;
  steering: ProjectRuntimeSteeringArtifact | undefined;
}): WorkflowRuntimeRoleSelection {
  if (!params.steering || !PROJECT_RUNTIME_STEERING_STAGE_IDS.includes(params.stageId as ProjectRuntimeSteeringStageId)) {
    return params.selection;
  }
  const override = params.steering.overrides.find(
    (entry) => entry.stageId === params.stageId && entry.roleId === params.selection.roleId,
  );
  if (!override) {
    return params.selection;
  }
  return {
    ...params.selection,
    adapterId: override.adapterId ?? params.selection.adapterId,
    appliedAgentId: override.agentId ?? params.selection.appliedAgentId,
    agentSource: "stage-steering",
  };
}
