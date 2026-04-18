import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectProjectBlueprintClarifications, readProjectBlueprint } from "./blueprint.js";
import {
  buildOpenClawCodeRecommendation,
  type OpenClawCodeRecommendationAlternative,
  type OpenClawCodeRecommendationInputKind,
  type OpenClawCodeRecommendationNextStep,
  type OpenClawCodeRecommendationSignals,
  type OpenClawCodeRecommendationWorkType,
} from "./recommendation.js";

export const PROJECT_BLUEPRINT_ALIGNMENT_SCHEMA_VERSION = 1;

export const PROJECT_BLUEPRINT_ALIGNMENT_STATUS_IDS = [
  "needs-blueprint-draft",
  "needs-clarification",
  "ready-to-agree",
  "already-agreed",
] as const;

export const PROJECT_BLUEPRINT_ALIGNMENT_NEXT_ACTION_IDS = [
  "init-blueprint",
  "clarify-blueprint",
  "agree-blueprint",
  "decompose-blueprint",
] as const;

export type ProjectBlueprintAlignmentStatus =
  (typeof PROJECT_BLUEPRINT_ALIGNMENT_STATUS_IDS)[number];
export type ProjectBlueprintAlignmentNextAction =
  (typeof PROJECT_BLUEPRINT_ALIGNMENT_NEXT_ACTION_IDS)[number];

export interface ProjectBlueprintAlignmentArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  request: string | null;
  inputKind: OpenClawCodeRecommendationInputKind | null;
  workType: OpenClawCodeRecommendationWorkType | null;
  signals: OpenClawCodeRecommendationSignals | null;
  inferredGoal: string | null;
  recommendedApproach: string | null;
  rationale: string | null;
  alternatives: OpenClawCodeRecommendationAlternative[];
  suggestedFirstSlice: string | null;
  recommendationNextStep: OpenClawCodeRecommendationNextStep | null;
  recommendationNextStepReason: string | null;
  priorityQuestion: string | null;
  unresolvedQuestions: string[];
  clarificationSuggestions: string[];
  affectedBlueprintSections: string[];
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintStatus: string | null;
  blueprintRevisionId: string | null;
  blueprintTitle: string | null;
  blueprintGoalSummary: string | null;
  blueprintHasAgreementCheckpoint: boolean;
  blueprintDefaultedSectionCount: number;
  blueprintOpenQuestionCount: number;
  alignmentStatus: ProjectBlueprintAlignmentStatus | null;
  alignmentSummary: string | null;
  blockers: string[];
  nextRecommendedAction: ProjectBlueprintAlignmentNextAction | null;
  nextRecommendedActionSummary: string | null;
  nextRecommendedCommand: string | null;
}

export interface WriteProjectBlueprintAlignmentArtifactOptions {
  repoRoot: string;
  request: string;
  now?: string;
}

function resolveProjectBlueprintAlignmentArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "blueprint-alignment.json");
}

function emptyArtifact(repoRootInput: string): ProjectBlueprintAlignmentArtifact {
  const repoRoot = path.resolve(repoRootInput);
  return {
    repoRoot,
    artifactPath: resolveProjectBlueprintAlignmentArtifactPath(repoRoot),
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    request: null,
    inputKind: null,
    workType: null,
    signals: null,
    inferredGoal: null,
    recommendedApproach: null,
    rationale: null,
    alternatives: [],
    suggestedFirstSlice: null,
    recommendationNextStep: null,
    recommendationNextStepReason: null,
    priorityQuestion: null,
    unresolvedQuestions: [],
    clarificationSuggestions: [],
    affectedBlueprintSections: [],
    blueprintExists: false,
    blueprintPath: path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
    blueprintStatus: null,
    blueprintRevisionId: null,
    blueprintTitle: null,
    blueprintGoalSummary: null,
    blueprintHasAgreementCheckpoint: false,
    blueprintDefaultedSectionCount: 0,
    blueprintOpenQuestionCount: 0,
    alignmentStatus: null,
    alignmentSummary: null,
    blockers: [],
    nextRecommendedAction: null,
    nextRecommendedActionSummary: null,
    nextRecommendedCommand: null,
  };
}

function pushUnique(list: string[], value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed || list.includes(trimmed)) {
    return;
  }
  list.push(trimmed);
}

function deriveAffectedBlueprintSections(params: {
  workType: OpenClawCodeRecommendationWorkType;
  signals: OpenClawCodeRecommendationSignals;
}): string[] {
  const sections: string[] = [];
  pushUnique(sections, "Goal");
  pushUnique(sections, "Success Criteria");
  pushUnique(sections, "Scope");
  pushUnique(sections, "Open Questions");

  if (params.signals.multiGoal) {
    pushUnique(sections, "Non-Goals");
  }
  if (params.signals.riskySurface) {
    pushUnique(sections, "Constraints");
    pushUnique(sections, "Risks");
  }

  switch (params.workType) {
    case "bugfix":
      pushUnique(sections, "Assumptions");
      pushUnique(sections, "Risks");
      break;
    case "refactor":
      pushUnique(sections, "Constraints");
      pushUnique(sections, "Non-Goals");
      pushUnique(sections, "Risks");
      break;
    case "research":
      pushUnique(sections, "Assumptions");
      break;
    default:
      break;
  }

  return sections;
}

function buildBlockers(params: {
  blueprintExists: boolean;
  blueprintQuestions: string[];
  recommendationQuestions: string[];
  signals: OpenClawCodeRecommendationSignals;
}): string[] {
  const blockers: string[] = [];

  if (!params.blueprintExists) {
    pushUnique(
      blockers,
      "Create the fixed repo-local blueprint scaffold before trying to record agreement.",
    );
  }

  for (const question of params.blueprintQuestions) {
    pushUnique(blockers, question);
  }

  if (params.signals.missingSuccessCriteria) {
    pushUnique(blockers, "The first slice still lacks an explicit success proof.");
  }
  if (params.signals.multiGoal) {
    pushUnique(
      blockers,
      "The request still mixes multiple goals that may need to be split before coding starts.",
    );
  }
  if (params.signals.riskySurface) {
    pushUnique(
      blockers,
      "Rollout, compatibility, or safety constraints still need confirmation before coding starts.",
    );
  }

  for (const question of params.recommendationQuestions) {
    pushUnique(blockers, question);
  }

  return blockers;
}

function buildAlignmentState(params: {
  repoRoot: string;
  blueprintExists: boolean;
  blueprintHasAgreementCheckpoint: boolean;
  blockers: string[];
}): {
  status: ProjectBlueprintAlignmentStatus;
  summary: string;
  nextAction: ProjectBlueprintAlignmentNextAction;
  nextActionSummary: string;
  nextRecommendedCommand: string;
} {
  const repoRoot = path.resolve(params.repoRoot);
  if (!params.blueprintExists) {
    return {
      status: "needs-blueprint-draft",
      summary: "A repo-local blueprint draft does not exist yet, so agreement cannot be recorded.",
      nextAction: "init-blueprint",
      nextActionSummary:
        "Create `PROJECT-BLUEPRINT.md`, then rerun blueprint alignment against the same request.",
      nextRecommendedCommand: `openclaw code blueprint-init --repo-root ${repoRoot}`,
    };
  }
  if (params.blockers.length > 0) {
    return {
      status: "needs-clarification",
      summary:
        "The request still has blueprint or scope ambiguities that materially affect agreement.",
      nextAction: "clarify-blueprint",
      nextActionSummary:
        "Resolve the remaining alignment blockers, then refresh the blueprint clarification report before agreeing.",
      nextRecommendedCommand: `openclaw code blueprint-clarify --repo-root ${repoRoot} --json`,
    };
  }
  if (params.blueprintHasAgreementCheckpoint) {
    return {
      status: "already-agreed",
      summary:
        "The current blueprint already has an agreement checkpoint and is ready for downstream work decomposition.",
      nextAction: "decompose-blueprint",
      nextActionSummary:
        "Derive or refresh the repo-local work-item inventory from the agreed blueprint.",
      nextRecommendedCommand: `openclaw code blueprint-decompose --repo-root ${repoRoot} --json`,
    };
  }
  return {
    status: "ready-to-agree",
    summary:
      "The blueprint-backed request is aligned enough to record an explicit agreement checkpoint before coding starts.",
    nextAction: "agree-blueprint",
    nextActionSummary:
      "Record the explicit blueprint agreement checkpoint, then move into work-item decomposition.",
    nextRecommendedCommand: `openclaw code blueprint-set-status --repo-root ${repoRoot} --status agreed --json`,
  };
}

export async function writeProjectBlueprintAlignmentArtifact(
  opts: WriteProjectBlueprintAlignmentArtifactOptions,
): Promise<ProjectBlueprintAlignmentArtifact> {
  const repoRoot = path.resolve(opts.repoRoot);
  const request = opts.request.trim();
  if (!request) {
    throw new Error("Blueprint alignment input cannot be empty.");
  }

  const artifactPath = resolveProjectBlueprintAlignmentArtifactPath(repoRoot);
  const recommendation = buildOpenClawCodeRecommendation(request);
  const blueprint = await readProjectBlueprint(repoRoot);
  const clarification = await inspectProjectBlueprintClarifications(repoRoot);
  const unresolvedQuestions: string[] = [];
  for (const question of recommendation.openQuestions) {
    pushUnique(unresolvedQuestions, question);
  }
  if (blueprint.exists) {
    for (const question of clarification.questions) {
      pushUnique(unresolvedQuestions, question);
    }
  }
  const blockers = buildBlockers({
    blueprintExists: blueprint.exists,
    blueprintQuestions: blueprint.exists ? clarification.questions : [],
    recommendationQuestions: recommendation.openQuestions,
    signals: recommendation.signals,
  });
  const alignmentState = buildAlignmentState({
    repoRoot,
    blueprintExists: blueprint.exists,
    blueprintHasAgreementCheckpoint: blueprint.hasAgreementCheckpoint,
    blockers,
  });
  const generatedAt = opts.now ?? new Date().toISOString();

  const artifact: ProjectBlueprintAlignmentArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_BLUEPRINT_ALIGNMENT_SCHEMA_VERSION,
    generatedAt,
    request: recommendation.request,
    inputKind: recommendation.inputKind,
    workType: recommendation.workType,
    signals: recommendation.signals,
    inferredGoal: recommendation.inferredGoal,
    recommendedApproach: recommendation.recommendedApproach,
    rationale: recommendation.rationale,
    alternatives: recommendation.alternatives,
    suggestedFirstSlice: recommendation.suggestedFirstSlice,
    recommendationNextStep: recommendation.nextStep,
    recommendationNextStepReason: recommendation.nextStepReason,
    priorityQuestion: recommendation.openQuestions[0] ?? clarification.priorityQuestion ?? null,
    unresolvedQuestions,
    clarificationSuggestions: blueprint.exists ? clarification.suggestions : [],
    affectedBlueprintSections: deriveAffectedBlueprintSections({
      workType: recommendation.workType,
      signals: recommendation.signals,
    }),
    blueprintExists: blueprint.exists,
    blueprintPath: blueprint.blueprintPath,
    blueprintStatus: blueprint.status,
    blueprintRevisionId: blueprint.revisionId,
    blueprintTitle: blueprint.title,
    blueprintGoalSummary: blueprint.goalSummary,
    blueprintHasAgreementCheckpoint: blueprint.hasAgreementCheckpoint,
    blueprintDefaultedSectionCount: blueprint.defaultedSectionCount,
    blueprintOpenQuestionCount: blueprint.openQuestionCount,
    alignmentStatus: alignmentState.status,
    alignmentSummary: alignmentState.summary,
    blockers,
    nextRecommendedAction: alignmentState.nextAction,
    nextRecommendedActionSummary: alignmentState.nextActionSummary,
    nextRecommendedCommand: alignmentState.nextRecommendedCommand,
  };

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectBlueprintAlignmentArtifact(
  repoRootInput: string,
): Promise<ProjectBlueprintAlignmentArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectBlueprintAlignmentArtifactPath(repoRoot);
  const raw = await readFile(artifactPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!raw) {
    return emptyArtifact(repoRoot);
  }

  const parsed = JSON.parse(raw) as Partial<ProjectBlueprintAlignmentArtifact>;
  const base = emptyArtifact(repoRoot);
  return {
    ...base,
    artifactPath,
    exists: parsed.exists ?? true,
    schemaVersion:
      typeof parsed.schemaVersion === "number"
        ? parsed.schemaVersion
        : PROJECT_BLUEPRINT_ALIGNMENT_SCHEMA_VERSION,
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
    request: typeof parsed.request === "string" ? parsed.request : null,
    inputKind:
      parsed.inputKind === "goal" ||
      parsed.inputKind === "problem" ||
      parsed.inputKind === "partial-solution" ||
      parsed.inputKind === "execution-ready"
        ? parsed.inputKind
        : null,
    workType:
      parsed.workType === "feature" ||
      parsed.workType === "bugfix" ||
      parsed.workType === "refactor" ||
      parsed.workType === "research"
        ? parsed.workType
        : null,
    signals:
      parsed.signals &&
      typeof parsed.signals === "object" &&
      typeof parsed.signals.broadScope === "boolean" &&
      typeof parsed.signals.publicSurface === "boolean" &&
      typeof parsed.signals.riskySurface === "boolean" &&
      typeof parsed.signals.missingSuccessCriteria === "boolean" &&
      typeof parsed.signals.multiGoal === "boolean"
        ? parsed.signals
        : null,
    inferredGoal: typeof parsed.inferredGoal === "string" ? parsed.inferredGoal : null,
    recommendedApproach:
      typeof parsed.recommendedApproach === "string" ? parsed.recommendedApproach : null,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : null,
    alternatives: Array.isArray(parsed.alternatives)
      ? parsed.alternatives.filter(
          (value): value is OpenClawCodeRecommendationAlternative =>
            Boolean(value) &&
            typeof value === "object" &&
            typeof value.approach === "string" &&
            typeof value.when === "string" &&
            typeof value.tradeoff === "string",
        )
      : [],
    suggestedFirstSlice:
      typeof parsed.suggestedFirstSlice === "string" ? parsed.suggestedFirstSlice : null,
    recommendationNextStep:
      parsed.recommendationNextStep === "ask-user" ||
      parsed.recommendationNextStep === "draft-spec" ||
      parsed.recommendationNextStep === "start-build"
        ? parsed.recommendationNextStep
        : null,
    recommendationNextStepReason:
      typeof parsed.recommendationNextStepReason === "string"
        ? parsed.recommendationNextStepReason
        : null,
    priorityQuestion: typeof parsed.priorityQuestion === "string" ? parsed.priorityQuestion : null,
    unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions)
      ? parsed.unresolvedQuestions.filter((value): value is string => typeof value === "string")
      : [],
    clarificationSuggestions: Array.isArray(parsed.clarificationSuggestions)
      ? parsed.clarificationSuggestions.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    affectedBlueprintSections: Array.isArray(parsed.affectedBlueprintSections)
      ? parsed.affectedBlueprintSections.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    blueprintExists: parsed.blueprintExists ?? false,
    blueprintPath:
      typeof parsed.blueprintPath === "string" ? parsed.blueprintPath : base.blueprintPath,
    blueprintStatus: typeof parsed.blueprintStatus === "string" ? parsed.blueprintStatus : null,
    blueprintRevisionId:
      typeof parsed.blueprintRevisionId === "string" ? parsed.blueprintRevisionId : null,
    blueprintTitle: typeof parsed.blueprintTitle === "string" ? parsed.blueprintTitle : null,
    blueprintGoalSummary:
      typeof parsed.blueprintGoalSummary === "string" ? parsed.blueprintGoalSummary : null,
    blueprintHasAgreementCheckpoint: parsed.blueprintHasAgreementCheckpoint ?? false,
    blueprintDefaultedSectionCount:
      typeof parsed.blueprintDefaultedSectionCount === "number"
        ? parsed.blueprintDefaultedSectionCount
        : 0,
    blueprintOpenQuestionCount:
      typeof parsed.blueprintOpenQuestionCount === "number" ? parsed.blueprintOpenQuestionCount : 0,
    alignmentStatus:
      parsed.alignmentStatus === "needs-blueprint-draft" ||
      parsed.alignmentStatus === "needs-clarification" ||
      parsed.alignmentStatus === "ready-to-agree" ||
      parsed.alignmentStatus === "already-agreed"
        ? parsed.alignmentStatus
        : null,
    alignmentSummary: typeof parsed.alignmentSummary === "string" ? parsed.alignmentSummary : null,
    blockers: Array.isArray(parsed.blockers)
      ? parsed.blockers.filter((value): value is string => typeof value === "string")
      : [],
    nextRecommendedAction:
      parsed.nextRecommendedAction === "init-blueprint" ||
      parsed.nextRecommendedAction === "clarify-blueprint" ||
      parsed.nextRecommendedAction === "agree-blueprint" ||
      parsed.nextRecommendedAction === "decompose-blueprint"
        ? parsed.nextRecommendedAction
        : null,
    nextRecommendedActionSummary:
      typeof parsed.nextRecommendedActionSummary === "string"
        ? parsed.nextRecommendedActionSummary
        : null,
    nextRecommendedCommand:
      typeof parsed.nextRecommendedCommand === "string" ? parsed.nextRecommendedCommand : null,
  };
}
