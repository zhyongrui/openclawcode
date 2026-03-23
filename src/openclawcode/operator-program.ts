import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PROJECT_OPERATOR_PROGRAM_SCHEMA_VERSION = 1;

export type ProjectOperatorProgramMutableSurfaceMode =
  | "scoped-by-work-item"
  | "allowlist"
  | "single-file";

export type ProjectOperatorProgramNextActionCode =
  | "narrow-mutation-scope"
  | "define-validation-budget"
  | "record-advancement-rules";

export interface ProjectOperatorProgramArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  updatedAt: string | null;
  title: string | null;
  summary: string | null;
  mutableSurfaceMode: ProjectOperatorProgramMutableSurfaceMode | null;
  mutableSurfacePaths: string[];
  validationBudgetSummary: string | null;
  validationBudgetMaxPrimaryCommands: number | null;
  requireOneExecutableProof: boolean;
  advancementRuleSummary: string | null;
  keepCriteria: string[];
  discardCriteria: string[];
  retryCriteria: string[];
  simplificationBias: boolean;
  attemptLedgerRequired: boolean;
  nextActionCode: ProjectOperatorProgramNextActionCode | null;
  nextActionSummary: string | null;
  linkedArtifacts: {
    blueprintPath: string;
    workItemsPath: string;
    stageGatesPath: string;
  };
}

export interface CreateProjectOperatorProgramOptions {
  repoRoot: string;
  title?: string;
  summary?: string;
  force?: boolean;
  now?: string;
}

function resolveProjectOperatorProgramArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "operator-program.json");
}

function buildDefaultProjectOperatorProgram(params: {
  repoRoot: string;
  artifactPath: string;
  now: string;
  title?: string;
  summary?: string;
}): ProjectOperatorProgramArtifact {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: true,
    schemaVersion: PROJECT_OPERATOR_PROGRAM_SCHEMA_VERSION,
    updatedAt: params.now,
    title: params.title?.trim() || "Repo-local operator program",
    summary:
      params.summary?.trim() ||
      "Define mutable scope, validation budget, and keep/discard rules for autonomous delivery.",
    mutableSurfaceMode: "scoped-by-work-item",
    mutableSurfacePaths: [],
    validationBudgetSummary:
      "Prefer one focused proof plus the smallest targeted checks needed to validate the active slice.",
    validationBudgetMaxPrimaryCommands: 2,
    requireOneExecutableProof: true,
    advancementRuleSummary:
      "Keep changes only when the proof stays green and the slice meaningfully improves the active work item.",
    keepCriteria: [
      "Keep only when at least one executable proof passes after the change.",
      "Keep when the diff narrows or clarifies the active work item without broad fan-out.",
      "Prefer simpler changes when the observable outcome is equal.",
    ],
    discardCriteria: [
      "Discard when the proof regresses or the change broadens scope without approval.",
      "Discard when the diff adds complexity with no meaningful operator-visible gain.",
    ],
    retryCriteria: [
      "Retry only after fixing a narrow crash, typo, or environmental mismatch.",
      "Record the retry outcome in an attempt ledger instead of silently replacing history.",
    ],
    simplificationBias: true,
    attemptLedgerRequired: true,
    nextActionCode: "narrow-mutation-scope",
    nextActionSummary:
      "Set mutableSurfacePaths when a work item can safely run inside a narrower file or directory allowlist.",
    linkedArtifacts: {
      blueprintPath: "PROJECT-BLUEPRINT.md",
      workItemsPath: ".openclawcode/work-items.json",
      stageGatesPath: ".openclawcode/stage-gates.json",
    },
  };
}

export async function createProjectOperatorProgram(
  opts: CreateProjectOperatorProgramOptions,
): Promise<ProjectOperatorProgramArtifact> {
  const repoRoot = path.resolve(opts.repoRoot);
  const artifactPath = resolveProjectOperatorProgramArtifactPath(repoRoot);
  if (!opts.force) {
    const existing = await readProjectOperatorProgram(repoRoot);
    if (existing.exists) {
      throw new Error(
        `Operator program already exists at ${artifactPath}. Pass --force to overwrite it.`,
      );
    }
  }
  const now = opts.now ?? new Date().toISOString();
  const artifact = buildDefaultProjectOperatorProgram({
    repoRoot,
    artifactPath,
    now,
    title: opts.title,
    summary: opts.summary,
  });
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectOperatorProgram(
  repoRootInput: string,
): Promise<ProjectOperatorProgramArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectOperatorProgramArtifactPath(repoRoot);
  const raw = await readFile(artifactPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!raw) {
    return {
      repoRoot,
      artifactPath,
      exists: false,
      schemaVersion: null,
      updatedAt: null,
      title: null,
      summary: null,
      mutableSurfaceMode: null,
      mutableSurfacePaths: [],
      validationBudgetSummary: null,
      validationBudgetMaxPrimaryCommands: null,
      requireOneExecutableProof: false,
      advancementRuleSummary: null,
      keepCriteria: [],
      discardCriteria: [],
      retryCriteria: [],
      simplificationBias: false,
      attemptLedgerRequired: false,
      nextActionCode: null,
      nextActionSummary: null,
      linkedArtifacts: {
        blueprintPath: "PROJECT-BLUEPRINT.md",
        workItemsPath: ".openclawcode/work-items.json",
        stageGatesPath: ".openclawcode/stage-gates.json",
      },
    };
  }
  const parsed = JSON.parse(raw) as Partial<ProjectOperatorProgramArtifact>;
  return {
    repoRoot,
    artifactPath,
    exists: parsed.exists ?? true,
    schemaVersion: parsed.schemaVersion ?? PROJECT_OPERATOR_PROGRAM_SCHEMA_VERSION,
    updatedAt: parsed.updatedAt ?? null,
    title: parsed.title ?? null,
    summary: parsed.summary ?? null,
    mutableSurfaceMode:
      parsed.mutableSurfaceMode === "scoped-by-work-item" ||
      parsed.mutableSurfaceMode === "allowlist" ||
      parsed.mutableSurfaceMode === "single-file"
        ? parsed.mutableSurfaceMode
        : null,
    mutableSurfacePaths: Array.isArray(parsed.mutableSurfacePaths)
      ? parsed.mutableSurfacePaths.filter((value): value is string => typeof value === "string")
      : [],
    validationBudgetSummary: parsed.validationBudgetSummary ?? null,
    validationBudgetMaxPrimaryCommands:
      typeof parsed.validationBudgetMaxPrimaryCommands === "number"
        ? parsed.validationBudgetMaxPrimaryCommands
        : null,
    requireOneExecutableProof: parsed.requireOneExecutableProof ?? false,
    advancementRuleSummary: parsed.advancementRuleSummary ?? null,
    keepCriteria: Array.isArray(parsed.keepCriteria)
      ? parsed.keepCriteria.filter((value): value is string => typeof value === "string")
      : [],
    discardCriteria: Array.isArray(parsed.discardCriteria)
      ? parsed.discardCriteria.filter((value): value is string => typeof value === "string")
      : [],
    retryCriteria: Array.isArray(parsed.retryCriteria)
      ? parsed.retryCriteria.filter((value): value is string => typeof value === "string")
      : [],
    simplificationBias: parsed.simplificationBias ?? false,
    attemptLedgerRequired: parsed.attemptLedgerRequired ?? false,
    nextActionCode:
      parsed.nextActionCode === "narrow-mutation-scope" ||
      parsed.nextActionCode === "define-validation-budget" ||
      parsed.nextActionCode === "record-advancement-rules"
        ? parsed.nextActionCode
        : null,
    nextActionSummary: parsed.nextActionSummary ?? null,
    linkedArtifacts: {
      blueprintPath:
        parsed.linkedArtifacts?.blueprintPath ?? "PROJECT-BLUEPRINT.md",
      workItemsPath:
        parsed.linkedArtifacts?.workItemsPath ?? ".openclawcode/work-items.json",
      stageGatesPath:
        parsed.linkedArtifacts?.stageGatesPath ?? ".openclawcode/stage-gates.json",
    },
  };
}
