import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readProjectBlueprintDocument } from "./blueprint.js";
import { deriveProjectDiscoveryInventory, readProjectDiscoveryInventory } from "./discovery.js";
import { deriveProjectRoleRoutingPlan, readProjectRoleRoutingPlan } from "./role-routing.js";
import {
  readProjectWorkItemInventory,
  type ProjectWorkItem,
} from "./work-items.js";

export const PROJECT_STAGE_GATE_SCHEMA_VERSION = 1;
export const PROJECT_STAGE_GATE_IDS = [
  "goal-agreement",
  "work-item-projection",
  "execution-routing",
  "execution-start",
  "merge-promotion",
] as const;
export const PROJECT_STAGE_GATE_DECISIONS = ["approved", "changes-requested", "blocked"] as const;
export const PROJECT_STAGE_GATE_READINESS_IDS = [
  "ready",
  "blocked",
  "needs-human-decision",
] as const;

export type ProjectStageGateId = (typeof PROJECT_STAGE_GATE_IDS)[number];
export type ProjectStageGateDecisionId = (typeof PROJECT_STAGE_GATE_DECISIONS)[number];
export type ProjectStageGateReadinessId = (typeof PROJECT_STAGE_GATE_READINESS_IDS)[number];

export interface ProjectStageGateDecisionRecord {
  gateId: ProjectStageGateId;
  decision: ProjectStageGateDecisionId;
  note: string | null;
  actor: string | null;
  recordedAt: string;
}

export interface ProjectStageGateRecord {
  gateId: ProjectStageGateId;
  title: string;
  summary: string;
  readiness: ProjectStageGateReadinessId;
  decisionRequired: boolean;
  blockers: string[];
  suggestions: string[];
  latestDecision: ProjectStageGateDecisionRecord | null;
}

export interface ProjectStageGateArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  workItemInventoryExists: boolean;
  discoveryInventoryExists: boolean;
  roleRoutingExists: boolean;
  gateCount: number;
  blockedGateCount: number;
  needsHumanDecisionCount: number;
  gates: ProjectStageGateRecord[];
  decisions: ProjectStageGateDecisionRecord[];
}

export interface RecordProjectStageGateDecisionOptions {
  repoRoot: string;
  gateId: string;
  decision: string;
  note?: string;
  actor?: string;
  now?: string;
}

function isProjectStageGateId(value: string): value is ProjectStageGateId {
  return PROJECT_STAGE_GATE_IDS.includes(value as ProjectStageGateId);
}

function isProjectStageGateDecisionId(value: string): value is ProjectStageGateDecisionId {
  return PROJECT_STAGE_GATE_DECISIONS.includes(value as ProjectStageGateDecisionId);
}

export function parseProjectStageGateId(value: string): ProjectStageGateId {
  if (!isProjectStageGateId(value)) {
    throw new Error(`--gate must be one of: ${PROJECT_STAGE_GATE_IDS.join(", ")}`);
  }
  return value;
}

export function parseProjectStageGateDecisionId(value: string): ProjectStageGateDecisionId {
  if (!isProjectStageGateDecisionId(value)) {
    throw new Error(`--decision must be one of: ${PROJECT_STAGE_GATE_DECISIONS.join(", ")}`);
  }
  return value;
}

export function projectStageGateIds(): ProjectStageGateId[] {
  return [...PROJECT_STAGE_GATE_IDS];
}

export function projectStageGateDecisionIds(): ProjectStageGateDecisionId[] {
  return [...PROJECT_STAGE_GATE_DECISIONS];
}

function resolveProjectStageGateArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "stage-gates.json");
}

function emptyProjectStageGateArtifact(params: {
  repoRoot: string;
  artifactPath: string;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  workItemInventoryExists: boolean;
  discoveryInventoryExists: boolean;
  roleRoutingExists: boolean;
}): ProjectStageGateArtifact {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.blueprintExists,
    blueprintPath: params.blueprintPath,
    blueprintRevisionId: params.blueprintRevisionId,
    workItemInventoryExists: params.workItemInventoryExists,
    discoveryInventoryExists: params.discoveryInventoryExists,
    roleRoutingExists: params.roleRoutingExists,
    gateCount: 0,
    blockedGateCount: 0,
    needsHumanDecisionCount: 0,
    gates: [],
    decisions: [],
  };
}

function latestDecisionForGate(
  decisions: ProjectStageGateDecisionRecord[],
  gateId: ProjectStageGateId,
): ProjectStageGateDecisionRecord | null {
  return (
    [...decisions]
      .filter((decision) => decision.gateId === gateId)
      .toSorted((left, right) => left.recordedAt.localeCompare(right.recordedAt))
      .at(-1) ?? null
  );
}

function finalizeGateRecord(params: {
  gateId: ProjectStageGateId;
  title: string;
  summary: string;
  readiness: ProjectStageGateReadinessId;
  decisionRequired: boolean;
  blockers: string[];
  suggestions: string[];
  latestDecision: ProjectStageGateDecisionRecord | null;
}): ProjectStageGateRecord {
  const blockers = [...params.blockers];
  const suggestions = [...params.suggestions];
  const latestDecision = params.latestDecision;
  let readiness = params.readiness;

  if (latestDecision?.decision === "blocked") {
    readiness = "blocked";
    if (latestDecision.note) {
      blockers.unshift(latestDecision.note);
    }
  } else if (latestDecision?.decision === "approved" && readiness === "needs-human-decision") {
    readiness = "ready";
    if (latestDecision.note) {
      suggestions.unshift(latestDecision.note);
    }
  } else if (latestDecision?.decision === "changes-requested") {
    readiness = "needs-human-decision";
    if (latestDecision.note) {
      suggestions.unshift(latestDecision.note);
    }
  }

  return {
    gateId: params.gateId,
    title: params.title,
    summary: params.summary,
    readiness,
    decisionRequired: params.decisionRequired,
    blockers,
    suggestions,
    latestDecision,
  };
}

function selectExecutionStartCandidate(
  workItems: Awaited<ReturnType<typeof readProjectWorkItemInventory>>,
): ProjectWorkItem | null {
  return (
    workItems.workItems.find(
      (item) =>
        item.status !== "completed" &&
        item.status !== "canceled" &&
        item.status !== "superseded",
    ) ?? null
  );
}

function buildExecutionStartModeGuidance(
  workItem: ProjectWorkItem | null,
): {
  readiness: ProjectStageGateReadinessId;
  blockers: string[];
  suggestions: string[];
} {
  if (!workItem) {
    return {
      readiness: "ready",
      blockers: [],
      suggestions: ["No execution candidate is currently selected."],
    };
  }

  switch (workItem.executionMode) {
    case "bugfix":
      return {
        readiness: "ready",
        blockers: [],
        suggestions: [
          `Selected bug-fix slice: ${workItem.title}`,
          "Confirm observed behavior, expected behavior, and regression proof before broad edits.",
        ],
      };
    case "refactor":
      return {
        readiness: "needs-human-decision",
        blockers: [
          `Selected refactor slice requires explicit execution-start approval: ${workItem.title}`,
        ],
        suggestions: [
          "Confirm the invariant behavior and first safe checkpoint before approving execution-start.",
        ],
      };
    case "research":
      return {
        readiness: "needs-human-decision",
        blockers: [
          `Selected research slice requires explicit execution-start approval: ${workItem.title}`,
        ],
        suggestions: [
          "Confirm the research question, required evidence, and expected next executable slice before approving execution-start.",
        ],
      };
    default:
      return {
        readiness: "ready",
        blockers: [],
        suggestions: [
          `Selected feature slice: ${workItem.title}`,
          "Keep the execution slice demoable and verify public behavior before broadening scope.",
        ],
      };
  }
}

export async function deriveProjectStageGateArtifact(
  repoRootInput: string,
): Promise<ProjectStageGateArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectStageGateArtifactPath(repoRoot);
  const existing = await readProjectStageGateArtifact(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const workItems = await readProjectWorkItemInventory(repoRoot);
  const discovery = await deriveProjectDiscoveryInventory(repoRoot);
  const storedRoleRouting = await readProjectRoleRoutingPlan(repoRoot);
  const roleRouting = storedRoleRouting.exists
    ? storedRoleRouting
    : await deriveProjectRoleRoutingPlan(repoRoot);

  if (!blueprint.exists) {
    return emptyProjectStageGateArtifact({
      repoRoot,
      artifactPath,
      blueprintExists: false,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: null,
      workItemInventoryExists: workItems.exists,
      discoveryInventoryExists: discovery.exists,
      roleRoutingExists: storedRoleRouting.exists,
    });
  }

  const decisions = existing.decisions;
  const gates: ProjectStageGateRecord[] = [];
  const executionCandidate = selectExecutionStartCandidate(workItems);
  const executionModeGuidance = buildExecutionStartModeGuidance(executionCandidate);

  gates.push(
    finalizeGateRecord({
      gateId: "goal-agreement",
      title: "Goal agreement",
      summary: "The project blueprint must be explicitly agreed before autonomous execution.",
      readiness: blueprint.hasAgreementCheckpoint ? "ready" : "needs-human-decision",
      decisionRequired: true,
      blockers: blueprint.hasAgreementCheckpoint
        ? []
        : ["Record blueprint agreement with `openclaw code blueprint-set-status --status agreed`."],
      suggestions: blueprint.hasAgreementCheckpoint
        ? ["Update the blueprint again if the team materially changes the target."]
        : ["Clarify the blueprint and record the agreement checkpoint once the team aligns."],
      latestDecision: latestDecisionForGate(decisions, "goal-agreement"),
    }),
  );

  gates.push(
    finalizeGateRecord({
      gateId: "work-item-projection",
      title: "Work-item projection",
      summary:
        "The blueprint must be decomposed into repo-local work items before issue projection or execution.",
      readiness: workItems.readyForIssueProjection ? "ready" : "blocked",
      decisionRequired: true,
      blockers: workItems.readyForIssueProjection ? [] : workItems.blockers,
      suggestions: workItems.suggestions,
      latestDecision: latestDecisionForGate(decisions, "work-item-projection"),
    }),
  );

  gates.push(
    finalizeGateRecord({
      gateId: "execution-routing",
      title: "Execution routing",
      summary:
        "Provider-neutral planner/coder/reviewer/verifier/doc-writer routing should be resolved before autonomous execution.",
      readiness: roleRouting.unresolvedRoleCount === 0 ? "ready" : "needs-human-decision",
      decisionRequired: true,
      blockers: roleRouting.blockers,
      suggestions: roleRouting.suggestions,
      latestDecision: latestDecisionForGate(decisions, "execution-routing"),
    }),
  );

  gates.push(
    finalizeGateRecord({
      gateId: "execution-start",
      title: "Execution start",
      summary:
        "Discovery signals and stale artifacts should be resolved or consciously accepted before execution starts.",
      readiness:
        discovery.evidenceCount === 0 ? executionModeGuidance.readiness : "needs-human-decision",
      decisionRequired: true,
      blockers: discovery.evidenceCount === 0
        ? executionModeGuidance.blockers
        : [...discovery.blockers, ...executionModeGuidance.blockers],
      suggestions:
        discovery.evidenceCount > 0
          ? [
              ...discovery.evidence.map((entry) => `${entry.source}: ${entry.summary}`),
              ...executionModeGuidance.suggestions,
            ]
          : executionModeGuidance.suggestions,
      latestDecision: latestDecisionForGate(decisions, "execution-start"),
    }),
  );

  gates.push(
    finalizeGateRecord({
      gateId: "merge-promotion",
      title: "Merge or promotion",
      summary:
        "A human should explicitly decide whether the blueprint-backed execution can merge or promote.",
      readiness: "needs-human-decision",
      decisionRequired: true,
      blockers: [],
      suggestions: [
        "Use this gate to record merge or promotion approval after verification and review are complete.",
      ],
      latestDecision: latestDecisionForGate(decisions, "merge-promotion"),
    }),
  );

  return {
    repoRoot,
    artifactPath,
    exists: false,
    schemaVersion: PROJECT_STAGE_GATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    blueprintExists: true,
    blueprintPath: blueprint.blueprintPath,
    blueprintRevisionId: blueprint.revisionId,
    workItemInventoryExists: workItems.exists,
    discoveryInventoryExists: discovery.exists,
    roleRoutingExists: storedRoleRouting.exists,
    gateCount: gates.length,
    blockedGateCount: gates.filter((gate) => gate.readiness === "blocked").length,
    needsHumanDecisionCount: gates.filter((gate) => gate.readiness === "needs-human-decision")
      .length,
    gates,
    decisions,
  };
}

export async function writeProjectStageGateArtifact(
  repoRootInput: string,
): Promise<ProjectStageGateArtifact> {
  const artifact = await deriveProjectStageGateArtifact(repoRootInput);
  await mkdir(path.dirname(artifact.artifactPath), { recursive: true });
  const persisted = {
    ...artifact,
    exists: true,
  };
  await writeFile(artifact.artifactPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function readProjectStageGateArtifact(
  repoRootInput: string,
): Promise<ProjectStageGateArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectStageGateArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const workItems = await readProjectWorkItemInventory(repoRoot);
  const discovery = await readProjectDiscoveryInventory(repoRoot);
  const storedRoleRouting = await readProjectRoleRoutingPlan(repoRoot);

  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectStageGateArtifact;
    return {
      ...parsed,
      repoRoot,
      artifactPath,
      blueprintExists: blueprint.exists,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      workItemInventoryExists: workItems.exists,
      discoveryInventoryExists: discovery.exists,
      roleRoutingExists: storedRoleRouting.exists,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      gates: Array.isArray(parsed.gates) ? parsed.gates : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyProjectStageGateArtifact({
        repoRoot,
        artifactPath,
        blueprintExists: blueprint.exists,
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        workItemInventoryExists: workItems.exists,
        discoveryInventoryExists: discovery.exists,
        roleRoutingExists: storedRoleRouting.exists,
      });
    }
    throw error;
  }
}

export async function recordProjectStageGateDecision(
  options: RecordProjectStageGateDecisionOptions,
): Promise<ProjectStageGateArtifact> {
  const repoRoot = path.resolve(options.repoRoot);
  const gateId = parseProjectStageGateId(options.gateId);
  const decision = parseProjectStageGateDecisionId(options.decision);
  const current = await readProjectStageGateArtifact(repoRoot);
  const recordedAt = options.now ?? new Date().toISOString();
  const decisions = [
    ...current.decisions,
    {
      gateId,
      decision,
      note: options.note?.trim() || null,
      actor: options.actor?.trim() || null,
      recordedAt,
    } satisfies ProjectStageGateDecisionRecord,
  ];
  await mkdir(path.dirname(current.artifactPath), { recursive: true });
  await writeFile(
    current.artifactPath,
    `${JSON.stringify(
      {
        ...current,
        exists: true,
        decisions,
      } satisfies ProjectStageGateArtifact,
      null,
      2,
    )}\n`,
    "utf8",
  );
  return await writeProjectStageGateArtifact(repoRoot);
}
