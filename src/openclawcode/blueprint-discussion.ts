import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PROJECT_BLUEPRINT_DISCUSSION_SCHEMA_VERSION = 1;

export interface ProjectBlueprintDiscussionEntry {
  question: string;
  answer: string;
  appliedSection: string;
  actor: string | null;
  appliedAt: string;
  questionIndex: number;
  blueprintRevisionBefore: string | null;
  blueprintRevisionAfter: string | null;
}

interface ProjectBlueprintDiscussionFile {
  schemaVersion: number;
  updatedAt: string;
  entries: ProjectBlueprintDiscussionEntry[];
}

export interface ProjectBlueprintDiscussionArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  updatedAt: string | null;
  entryCount: number;
  lastClarificationAt: string | null;
  entries: ProjectBlueprintDiscussionEntry[];
}

function resolveProjectBlueprintDiscussionArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "blueprint-discussion.json");
}

function normalizeEntry(raw: unknown): ProjectBlueprintDiscussionEntry | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<ProjectBlueprintDiscussionEntry>;
  if (
    typeof candidate.question !== "string" ||
    typeof candidate.answer !== "string" ||
    typeof candidate.appliedSection !== "string" ||
    typeof candidate.appliedAt !== "string" ||
    typeof candidate.questionIndex !== "number"
  ) {
    return undefined;
  }
  return {
    question: candidate.question,
    answer: candidate.answer,
    appliedSection: candidate.appliedSection,
    actor: typeof candidate.actor === "string" ? candidate.actor : null,
    appliedAt: candidate.appliedAt,
    questionIndex: candidate.questionIndex,
    blueprintRevisionBefore:
      typeof candidate.blueprintRevisionBefore === "string"
        ? candidate.blueprintRevisionBefore
        : null,
    blueprintRevisionAfter:
      typeof candidate.blueprintRevisionAfter === "string" ? candidate.blueprintRevisionAfter : null,
  };
}

function emptyArtifact(repoRoot: string, artifactPath: string): ProjectBlueprintDiscussionArtifact {
  return {
    repoRoot,
    artifactPath,
    exists: false,
    schemaVersion: null,
    updatedAt: null,
    entryCount: 0,
    lastClarificationAt: null,
    entries: [],
  };
}

export async function readProjectBlueprintDiscussionArtifact(
  repoRootInput: string,
): Promise<ProjectBlueprintDiscussionArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectBlueprintDiscussionArtifactPath(repoRoot);
  try {
    const raw = JSON.parse(await readFile(artifactPath, "utf8")) as Partial<ProjectBlueprintDiscussionFile>;
    const entries = Array.isArray(raw.entries) ? raw.entries.flatMap((entry) => {
      const normalized = normalizeEntry(entry);
      return normalized ? [normalized] : [];
    }) : [];
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
    return {
      repoRoot,
      artifactPath,
      exists: true,
      schemaVersion:
        typeof raw.schemaVersion === "number" && Number.isFinite(raw.schemaVersion)
          ? raw.schemaVersion
          : null,
      updatedAt,
      entryCount: entries.length,
      lastClarificationAt: entries.at(-1)?.appliedAt ?? null,
      entries,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyArtifact(repoRoot, artifactPath);
    }
    throw error;
  }
}

export async function appendProjectBlueprintDiscussionEntry(params: {
  repoRoot: string;
  entry: ProjectBlueprintDiscussionEntry;
}): Promise<ProjectBlueprintDiscussionArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectBlueprintDiscussionArtifactPath(repoRoot);
  const current = await readProjectBlueprintDiscussionArtifact(repoRoot);
  const nextUpdatedAt = params.entry.appliedAt;
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    JSON.stringify(
      {
        schemaVersion: PROJECT_BLUEPRINT_DISCUSSION_SCHEMA_VERSION,
        updatedAt: nextUpdatedAt,
        entries: [...current.entries, params.entry],
      } satisfies ProjectBlueprintDiscussionFile,
      null,
      2,
    ),
    "utf8",
  );
  return await readProjectBlueprintDiscussionArtifact(repoRoot);
}
