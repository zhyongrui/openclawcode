import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  inspectProjectBlueprintClarifications,
  readProjectBlueprintDocument,
} from "./blueprint.js";
import {
  deriveProjectDiscoveryInventory,
} from "./discovery.js";
import {
  deriveProjectRoleRoutingPlan,
  readProjectRoleRoutingPlan,
} from "./role-routing.js";
import { deriveProjectStageGateArtifact } from "./stage-gates.js";
import type { ProjectStageGateId } from "./stage-gates.js";
import {
  deriveProjectWorkItemInventory,
  readProjectWorkItemInventory,
  type ProjectWorkItem,
  type ProjectWorkItemExecutionMode,
} from "./work-items.js";

export const PROJECT_NEXT_WORK_SELECTION_SCHEMA_VERSION = 1;
export const PROJECT_NEXT_WORK_DECISION_IDS = [
  "ready-to-execute",
  "blocked-on-human",
  "blocked-on-missing-clarification",
  "blocked-on-policy",
  "no-actionable-work-item",
] as const;

export type ProjectNextWorkDecisionId = (typeof PROJECT_NEXT_WORK_DECISION_IDS)[number];

export interface ProjectNextWorkCandidate {
  id: string;
  kind: ProjectWorkItem["kind"];
  status: ProjectWorkItem["status"];
  executionMode: ProjectWorkItemExecutionMode;
  workstreamIndex: number | null;
  title: string;
  summary: string;
  selectedFrom: "discovery" | "work-item-inventory";
  blueprintRevisionId: string | null;
  githubIssueDraftTitle: string;
}

export interface ProjectNextWorkSelection {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  decision: ProjectNextWorkDecisionId;
  canContinueAutonomously: boolean;
  blockingGateId: ProjectStageGateId | null;
  selectedWorkItem: ProjectNextWorkCandidate | null;
  selectedReason: string | null;
  blockerCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
  clarificationQuestionCount: number;
  clarificationQuestions: string[];
  discoveryEvidenceCount: number;
  highestDiscoveryPriority: "low" | "medium" | "high" | null;
  workItemCount: number;
  plannedWorkItemCount: number;
  discoveredWorkItemCount: number;
  blockedGateCount: number;
  needsHumanDecisionCount: number;
  unresolvedRoleCount: number;
}

function resolveProjectNextWorkArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "next-work.json");
}

function emptyProjectNextWorkSelection(params: {
  repoRoot: string;
  artifactPath: string;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  clarificationQuestions: string[];
}): ProjectNextWorkSelection {
  const blockers =
    params.clarificationQuestions.length > 0
      ? [...params.clarificationQuestions]
      : ["No project blueprint exists yet."];
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.blueprintExists,
    blueprintPath: params.blueprintPath,
    blueprintRevisionId: params.blueprintRevisionId,
    decision: params.clarificationQuestions.length > 0
      ? "blocked-on-missing-clarification"
      : "no-actionable-work-item",
    canContinueAutonomously: false,
    blockingGateId: null,
    selectedWorkItem: null,
    selectedReason: null,
    blockerCount: blockers.length,
    blockers,
    suggestionCount: 0,
    suggestions: [],
    clarificationQuestionCount: params.clarificationQuestions.length,
    clarificationQuestions: [...params.clarificationQuestions],
    discoveryEvidenceCount: 0,
    highestDiscoveryPriority: null,
    workItemCount: 0,
    plannedWorkItemCount: 0,
    discoveredWorkItemCount: 0,
    blockedGateCount: 0,
    needsHumanDecisionCount: 0,
    unresolvedRoleCount: 0,
  };
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function compareDiscoveryPriority(
  left: "low" | "medium" | "high",
  right: "low" | "medium" | "high",
): number {
  const order = { low: 0, medium: 1, high: 2 } as const;
  return order[right] - order[left];
}

function toSelectedWorkItem(
  workItem: ProjectWorkItem,
  selectedFrom: "discovery" | "work-item-inventory",
): ProjectNextWorkCandidate {
  return {
    id: workItem.id,
    kind: workItem.kind,
    status: workItem.status,
    executionMode: workItem.executionMode,
    workstreamIndex: workItem.workstreamIndex > 0 ? workItem.workstreamIndex : null,
    title: workItem.title,
    summary: workItem.summary,
    selectedFrom,
    blueprintRevisionId: workItem.blueprintRevisionId,
    githubIssueDraftTitle: workItem.githubIssueDraft.title,
  };
}

function buildExecutionModeGuidance(
  executionMode: ProjectWorkItemExecutionMode,
): { blockers: string[]; suggestions: string[] } {
  switch (executionMode) {
    case "bugfix":
      return {
        blockers: [],
        suggestions: [
          "Confirm the observed behavior, expected behavior, and regression proof before broad code changes.",
        ],
      };
    case "refactor":
      return {
        blockers: [
          "The selected work item is a refactor slice, so execution-start should be explicitly approved before autonomous execution.",
        ],
        suggestions: [
          "Confirm the invariant behavior and first safe checkpoint, then record an execution-start approval.",
        ],
      };
    case "research":
      return {
        blockers: [
          "The selected work item is a research slice, so execution-start should be explicitly approved before open-ended investigation begins.",
        ],
        suggestions: [
          "Confirm the research question, required evidence, and expected next executable slice before approving execution-start.",
        ],
      };
    default:
      return {
        blockers: [],
        suggestions: [
          "Keep the selected work item as one demoable vertical slice with public-behavior proof.",
        ],
      };
  }
}

function pickSelectedWorkItem(params: {
  discovery: Awaited<ReturnType<typeof deriveProjectDiscoveryInventory>>;
  workItems: Awaited<ReturnType<typeof deriveProjectWorkItemInventory>>;
}): { selectedWorkItem: ProjectNextWorkCandidate | null; selectedReason: string | null } {
  if (params.discovery.evidence.length > 0) {
    const highest = [...params.discovery.evidence].sort((left, right) => {
      const priority = compareDiscoveryPriority(left.priority, right.priority);
      if (priority !== 0) {
        return priority;
      }
      return left.summary.localeCompare(right.summary);
    })[0];
    if (highest) {
      return {
        selectedWorkItem: toSelectedWorkItem(highest.discoveredWorkItem, "discovery"),
        selectedReason: highest.summary,
      };
    }
  }

  const planned = params.workItems.workItems.find((item) =>
    item.status !== "completed" && item.status !== "canceled" && item.status !== "superseded",
  );
  if (!planned) {
    return { selectedWorkItem: null, selectedReason: null };
  }
  return {
    selectedWorkItem: toSelectedWorkItem(planned, "work-item-inventory"),
    selectedReason:
      planned.kind === "planned"
        ? "Selected the first blueprint-backed work item that is not completed or canceled."
        : "Selected the first discovered work item that is not completed or canceled.",
  };
}

function classifyWorkItemProjectionBlockers(blockers: string[]): ProjectNextWorkDecisionId {
  if (
    blockers.some((blocker) =>
      /open questions|clarif|workstreams|project blueprint/i.test(blocker),
    )
  ) {
    return "blocked-on-missing-clarification";
  }
  if (blockers.some((blocker) => /agreement|agreed|checkpoint/i.test(blocker))) {
    return "blocked-on-human";
  }
  return "blocked-on-policy";
}

export async function deriveProjectNextWorkSelection(
  repoRootInput: string,
): Promise<ProjectNextWorkSelection> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectNextWorkArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const clarification = await inspectProjectBlueprintClarifications(repoRoot);

  if (!blueprint.exists) {
    return emptyProjectNextWorkSelection({
      repoRoot,
      artifactPath,
      blueprintExists: false,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: null,
      clarificationQuestions: clarification.questions,
    });
  }

  const workItems = await readProjectWorkItemInventory(repoRoot);
  const discovery = await deriveProjectDiscoveryInventory(repoRoot);
  const storedRoleRouting = await readProjectRoleRoutingPlan(repoRoot);
  const roleRouting = storedRoleRouting.exists
    ? storedRoleRouting
    : await deriveProjectRoleRoutingPlan(repoRoot);
  const stageGates = await deriveProjectStageGateArtifact(repoRoot);
  const selection = pickSelectedWorkItem({ discovery, workItems });
  const goalAgreementGate = stageGates.gates.find((gate) => gate.gateId === "goal-agreement");
  const workItemProjectionGate = stageGates.gates.find(
    (gate) => gate.gateId === "work-item-projection",
  );
  const executionRoutingGate = stageGates.gates.find((gate) => gate.gateId === "execution-routing");
  const executionStartGate = stageGates.gates.find((gate) => gate.gateId === "execution-start");

  let decision: ProjectNextWorkDecisionId;
  let blockingGateId: ProjectStageGateId | null = null;
  let blockers: string[] = [];
  let suggestions: string[] = [];

  if (clarification.questions.length > 0) {
    decision = "blocked-on-missing-clarification";
    blockingGateId = "work-item-projection";
    blockers = [...clarification.questions];
    suggestions = [...clarification.suggestions];
  } else if (goalAgreementGate && goalAgreementGate.readiness !== "ready") {
    decision = "blocked-on-human";
    blockingGateId = "goal-agreement";
    blockers = [...goalAgreementGate.blockers];
    suggestions = [...goalAgreementGate.suggestions];
  } else if (workItemProjectionGate && workItemProjectionGate.readiness !== "ready") {
    decision = classifyWorkItemProjectionBlockers(workItemProjectionGate.blockers);
    blockingGateId = "work-item-projection";
    blockers = [...workItemProjectionGate.blockers];
    suggestions = [...workItemProjectionGate.suggestions];
  } else if (executionRoutingGate && executionRoutingGate.readiness !== "ready") {
    decision = "blocked-on-policy";
    blockingGateId = "execution-routing";
    blockers = [...executionRoutingGate.blockers];
    suggestions = [...executionRoutingGate.suggestions];
  } else if (executionStartGate && executionStartGate.readiness !== "ready") {
    decision = "blocked-on-human";
    blockingGateId = "execution-start";
    blockers = [...executionStartGate.blockers];
    suggestions = [...executionStartGate.suggestions];
  } else if (selection.selectedWorkItem) {
    const modeGuidance = buildExecutionModeGuidance(selection.selectedWorkItem.executionMode);
    decision = "ready-to-execute";
    suggestions = [
      "Use the selected work item as the next issue-materialization candidate.",
      `Selected work item execution mode: ${selection.selectedWorkItem.executionMode}.`,
      ...modeGuidance.suggestions,
      ...(executionStartGate?.suggestions ?? []),
      `Draft GitHub issue title: ${selection.selectedWorkItem.githubIssueDraftTitle}`,
    ];
  } else {
    decision = "no-actionable-work-item";
    blockers = ["No planned or discovered work items are currently available."];
    suggestions = [
      "Update `PROJECT-BLUEPRINT.md` and refresh the work-item artifact before trying again.",
    ];
  }

  const normalizedBlockers = normalizeList(blockers);
  const normalizedSuggestions = normalizeList([
    ...suggestions,
    ...(decision === "blocked-on-missing-clarification"
      ? ["Resolve the clarification questions before continuing autonomous execution."]
      : []),
    ...(decision === "blocked-on-human"
      ? ["Record the required human decision before allowing the loop to continue."]
      : []),
    ...(decision === "blocked-on-policy"
      ? ["Resolve the role-routing or policy blocker before continuing autonomous execution."]
      : []),
  ]);

  return {
    repoRoot,
    artifactPath,
    exists: false,
    schemaVersion: PROJECT_NEXT_WORK_SELECTION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    blueprintExists: blueprint.exists,
    blueprintPath: blueprint.blueprintPath,
    blueprintRevisionId: blueprint.revisionId,
    decision,
    canContinueAutonomously: decision === "ready-to-execute",
    blockingGateId,
    selectedWorkItem: selection.selectedWorkItem,
    selectedReason: selection.selectedReason,
    blockerCount: normalizedBlockers.length,
    blockers: normalizedBlockers,
    suggestionCount: normalizedSuggestions.length,
    suggestions: normalizedSuggestions,
    clarificationQuestionCount: clarification.questionCount,
    clarificationQuestions: [...clarification.questions],
    discoveryEvidenceCount: discovery.evidenceCount,
    highestDiscoveryPriority: discovery.highestPriority,
    workItemCount: workItems.workItemCount,
    plannedWorkItemCount: workItems.plannedWorkItemCount,
    discoveredWorkItemCount:
      workItems.discoveredWorkItemCount + discovery.discoveredWorkItemCount,
    blockedGateCount: stageGates.blockedGateCount,
    needsHumanDecisionCount: stageGates.needsHumanDecisionCount,
    unresolvedRoleCount: roleRouting.unresolvedRoleCount,
  };
}

export async function writeProjectNextWorkSelection(
  repoRootInput: string,
): Promise<ProjectNextWorkSelection> {
  const selection = await deriveProjectNextWorkSelection(repoRootInput);
  await mkdir(path.dirname(selection.artifactPath), { recursive: true });
  const persisted = {
    ...selection,
    exists: true,
  };
  await writeFile(selection.artifactPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function readProjectNextWorkSelection(
  repoRootInput: string,
): Promise<ProjectNextWorkSelection> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectNextWorkArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);

  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectNextWorkSelection>;
    return {
      repoRoot,
      artifactPath,
      exists: parsed.exists ?? true,
      schemaVersion: parsed.schemaVersion ?? PROJECT_NEXT_WORK_SELECTION_SCHEMA_VERSION,
      generatedAt: parsed.generatedAt ?? null,
      blueprintExists: blueprint.exists,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      decision: parsed.decision ?? "no-actionable-work-item",
      canContinueAutonomously: parsed.canContinueAutonomously ?? false,
      blockingGateId: parsed.blockingGateId ?? null,
      selectedWorkItem: parsed.selectedWorkItem
        ? {
            ...parsed.selectedWorkItem,
            workstreamIndex: parsed.selectedWorkItem.workstreamIndex ?? null,
          }
        : null,
      selectedReason: parsed.selectedReason ?? null,
      blockerCount: parsed.blockerCount ?? 0,
      blockers: parsed.blockers ?? [],
      suggestionCount: parsed.suggestionCount ?? 0,
      suggestions: parsed.suggestions ?? [],
      clarificationQuestionCount: parsed.clarificationQuestionCount ?? 0,
      clarificationQuestions: parsed.clarificationQuestions ?? [],
      discoveryEvidenceCount: parsed.discoveryEvidenceCount ?? 0,
      highestDiscoveryPriority: parsed.highestDiscoveryPriority ?? null,
      workItemCount: parsed.workItemCount ?? 0,
      plannedWorkItemCount: parsed.plannedWorkItemCount ?? 0,
      discoveredWorkItemCount: parsed.discoveredWorkItemCount ?? 0,
      blockedGateCount: parsed.blockedGateCount ?? 0,
      needsHumanDecisionCount: parsed.needsHumanDecisionCount ?? 0,
      unresolvedRoleCount: parsed.unresolvedRoleCount ?? 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return await deriveProjectNextWorkSelection(repoRoot);
    }
    throw error;
  }
}
