import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  inspectProjectBlueprintClarifications,
  readProjectBlueprintDocument,
  type ProjectBlueprintRoleAssignments,
  type ProjectBlueprintStatus,
} from "./blueprint.js";
import type { WorkflowStage } from "./contracts/index.js";
import { resolveGitHubRepoFromGit } from "./github/index.js";
import { buildProjectWorkItemIssueMarkers } from "./issue-materialization.js";
import {
  readOpenClawCodeOperatorStatusSnapshot,
} from "./operator-status.js";
import type { OpenClawCodeIssueStatusSnapshot } from "../integrations/openclaw-plugin/store.js";

export const PROJECT_WORK_ITEM_SCHEMA_VERSION = 1;
export const PROJECT_WORK_ITEM_STATUSES = [
  "planned",
  "queued",
  "in-progress",
  "blocked",
  "completed",
  "canceled",
  "superseded",
] as const;
export const PROJECT_WORK_ITEM_KINDS = ["planned", "discovered"] as const;
export const PROJECT_WORK_ITEM_CLASSES = [
  "feature",
  "bugfix",
  "docs",
  "sync",
  "validation",
  "incident",
] as const;
export const PROJECT_WORK_ITEM_EXECUTION_MODES = [
  "feature",
  "bugfix",
  "refactor",
  "research",
] as const;

export type ProjectWorkItemStatus = (typeof PROJECT_WORK_ITEM_STATUSES)[number];
export type ProjectWorkItemKind = (typeof PROJECT_WORK_ITEM_KINDS)[number];
export type ProjectWorkItemClass = (typeof PROJECT_WORK_ITEM_CLASSES)[number];
export type ProjectWorkItemExecutionMode = (typeof PROJECT_WORK_ITEM_EXECUTION_MODES)[number];

export interface ProjectWorkItemIssueDraft {
  title: string;
  body: string;
}

export interface ProjectWorkItemGitHubIssueLink {
  issueNumber: number;
  issueUrl: string;
  issueTitle: string;
  issueState: "open" | "closed";
  linkedAt: string;
  linkedFrom: "created" | "reused";
  blueprintRevisionId: string | null;
}

export interface ProjectWorkItemGitHubProjection {
  current: ProjectWorkItemGitHubIssueLink | null;
  history: ProjectWorkItemGitHubIssueLink[];
}

export interface ProjectWorkItem {
  id: string;
  kind: ProjectWorkItemKind;
  status: ProjectWorkItemStatus;
  class: ProjectWorkItemClass;
  executionMode: ProjectWorkItemExecutionMode;
  fingerprint: string;
  title: string;
  summary: string;
  source: "blueprint";
  sourceSection: "Workstreams";
  workstreamIndex: number;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  acceptanceCriteria: string[];
  openQuestions: string[];
  humanGates: string[];
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
  githubIssueDraft: ProjectWorkItemIssueDraft;
  githubIssue: ProjectWorkItemGitHubProjection;
}

export interface ProjectWorkItemInventory {
  repoRoot: string;
  inventoryPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintTitle: string | null;
  blueprintStatus: ProjectBlueprintStatus | null;
  blueprintRevisionId: string | null;
  currentBlueprintRevisionId: string | null;
  artifactStale: boolean | null;
  readyForExecution: boolean;
  readyForIssueProjection: boolean;
  blockerCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
  workItemCount: number;
  plannedWorkItemCount: number;
  discoveredWorkItemCount: number;
  supersededWorkItemCount: number;
  workItems: ProjectWorkItem[];
}

function emptyProjectBlueprintRoleAssignments(): ProjectBlueprintRoleAssignments {
  return {
    planner: null,
    coder: null,
    reviewer: null,
    verifier: null,
    docWriter: null,
  };
}

function normalizeMarkdownListItem(line: string): string | null {
  const trimmed = line.trim();
  const match =
    trimmed.match(/^[-*]\s+\[(?: |x|X)\]\s+(.+)$/) ??
    trimmed.match(/^[-*]\s+(.+)$/) ??
    trimmed.match(/^\d+\.\s+(.+)$/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractMarkdownListItems(content: string | undefined): string[] {
  if (!content) {
    return [];
  }
  return content
    .split("\n")
    .map((line) => normalizeMarkdownListItem(line))
    .filter((item): item is string => Boolean(item))
    .filter((item) => !/^none\b/i.test(item));
}

function slugifyWorkItemIdSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeWorkItemText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function classifyProjectWorkItemClass(workItem: string): ProjectWorkItemClass {
  if (
    /\b(outage|incident|sev[ -]?[0-9]|hotfix|rollback|degrad(ed|ation)|urgent)\b/i.test(workItem)
  ) {
    return "incident";
  }
  if (
    /\b(sync|upstream|rebase|merge|align|mirror|rollout|release|promot(e|ion))\b/i.test(workItem)
  ) {
    return "sync";
  }
  if (/\b(doc|docs|documentation|readme|guide|runbook|manual|tutorial)\b/i.test(workItem)) {
    return "docs";
  }
  if (
    /\b(validat(e|ion)|verify|verification|test|smoke test|regression suite|audit)\b/i.test(
      workItem,
    )
  ) {
    return "validation";
  }
  if (/\b(fix|bug|regression|broken|crash|error|failure)\b/i.test(workItem)) {
    return "bugfix";
  }
  return "feature";
}

function classifyProjectWorkItemExecutionMode(workItem: string): ProjectWorkItemExecutionMode {
  if (/\b(fix|bug|regression|broken|crash|error|failure)\b/i.test(workItem)) {
    return "bugfix";
  }
  if (
    /\b(refactor|cleanup|clean up|rename|extract|restructure|reorganize|dedupe|simplify)\b/i.test(
      workItem,
    )
  ) {
    return "refactor";
  }
  if (/\b(investigate|diagnose|triage|research|spike|explore)\b/i.test(workItem)) {
    return "research";
  }
  return "feature";
}

function buildProjectWorkItemFingerprint(params: {
  kind: ProjectWorkItemKind;
  source: ProjectWorkItem["source"];
  sourceSection: ProjectWorkItem["sourceSection"];
  title: string;
  summary: string;
  executionMode: ProjectWorkItemExecutionMode;
  workItemClass: ProjectWorkItemClass;
}): string {
  return createHash("sha1")
    .update(params.kind)
    .update("\n")
    .update(params.source)
    .update("\n")
    .update(params.sourceSection)
    .update("\n")
    .update(params.workItemClass)
    .update("\n")
    .update(params.executionMode)
    .update("\n")
    .update(normalizeWorkItemText(params.title))
    .update("\n")
    .update(normalizeWorkItemText(params.summary))
    .digest("hex");
}

function buildDeliveryPolicyLines(executionMode: ProjectWorkItemExecutionMode): string[] {
  const base = [
    "- Keep this work item as one demoable vertical slice.",
    "- Prefer the smallest user-visible or operator-visible change that proves progress.",
    "- Avoid splitting the work into front-end-only, back-end-only, or tests-only subprojects unless the blueprint explicitly requires it.",
  ];
  if (executionMode === "research") {
    return [
      ...base,
      "- End with a recommendation or next executable slice instead of leaving an open-ended investigation.",
    ];
  }
  return base;
}

function buildTestingPolicyLines(executionMode: ProjectWorkItemExecutionMode): string[] {
  const lines = [
    "- Start with a failing proof or executable check when practical.",
    "- Prefer public-behavior tests, CLI proofs, or chat-visible verification over implementation-only assertions.",
    "- Follow a red -> green -> refactor loop and keep the proof green before broadening scope.",
  ];
  if (executionMode === "refactor") {
    lines.push(
      "- Preserve existing behavior unless the acceptance criteria explicitly say otherwise.",
    );
  }
  return lines;
}

function buildExecutionModeSpecificLines(
  executionMode: ProjectWorkItemExecutionMode,
): { heading: string; lines: string[] } | null {
  switch (executionMode) {
    case "bugfix":
      return {
        heading: "Bug triage expectations",
        lines: [
          "- Record the observed behavior, the expected behavior, and the smallest known reproduction path.",
          "- Identify the likely root-cause area before broad code changes.",
          "- Add a regression proof before or alongside the fix so the failure cannot silently return.",
        ],
      };
    case "refactor":
      return {
        heading: "Refactor guardrails",
        lines: [
          "- Keep the repository working after each small checkpoint.",
          "- Preserve external behavior unless a success criterion explicitly changes it.",
          "- Separate structural movement from behavior changes whenever the work can be split safely.",
        ],
      };
    case "research":
      return {
        heading: "Research exit criteria",
        lines: [
          "- End with a concrete recommendation, not only observations.",
          "- Name the next smallest executable slice once the investigation is complete.",
        ],
      };
    default:
      return null;
  }
}

function resolveProjectWorkItemIssueDraft(params: {
  blueprintTitle: string | null;
  blueprintGoal: string | null;
  blueprintRevisionId: string | null;
  workItemId: string;
  workItemFingerprint: string;
  workItem: string;
  executionMode: ProjectWorkItemExecutionMode;
  acceptanceCriteria: string[];
  openQuestions: string[];
  humanGates: string[];
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
}): ProjectWorkItemIssueDraft {
  const providerLines = [
    ["Planner", params.providerRoleAssignments.planner],
    ["Coder", params.providerRoleAssignments.coder],
    ["Reviewer", params.providerRoleAssignments.reviewer],
    ["Verifier", params.providerRoleAssignments.verifier],
    ["Doc-writer", params.providerRoleAssignments.docWriter],
  ]
    .filter(([, assignment]) => assignment != null && assignment.length > 0)
    .map(([role, assignment]) => `- ${role}: ${assignment}`);

  const acceptanceCriteriaLines =
    params.acceptanceCriteria.length > 0
      ? params.acceptanceCriteria.map((item) => `- ${item}`)
      : ["- Reuse or refine the success criteria from the blueprint."];
  const openQuestionLines =
    params.openQuestions.length > 0
      ? params.openQuestions.map((item) => `- ${item}`)
      : ["- None recorded."];
  const humanGateLines =
    params.humanGates.length > 0
      ? params.humanGates.map((item) => `- ${item}`)
      : ["- Follow the default autonomous policy for this repository."];
  const executionModeLabel = params.executionMode.replace(
    /(^|-)([a-z])/g,
    (_match, dash, char) => `${dash}${String(char).toUpperCase()}`,
  );
  const deliveryPolicyLines = buildDeliveryPolicyLines(params.executionMode);
  const testingPolicyLines = buildTestingPolicyLines(params.executionMode);
  const executionModeSpecific = buildExecutionModeSpecificLines(params.executionMode);

  return {
    title: `[Blueprint]: ${params.workItem}`,
    body: [
      "Summary",
      params.workItem,
      "",
      "Blueprint context",
      `- Blueprint: ${params.blueprintTitle ?? "Untitled project blueprint"}`,
      `- Revision: ${params.blueprintRevisionId ?? "unknown"}`,
      `- Goal: ${params.blueprintGoal ?? "No goal summary recorded."}`,
      `- Execution mode: ${executionModeLabel}`,
      "",
      "Acceptance criteria",
      ...acceptanceCriteriaLines,
      "",
      "Delivery policy",
      ...deliveryPolicyLines,
      "",
      "Testing policy",
      ...testingPolicyLines,
      "",
      ...(executionModeSpecific
        ? [executionModeSpecific.heading, ...executionModeSpecific.lines, ""]
        : []),
      "Open questions",
      ...openQuestionLines,
      "",
      "Human gates",
      ...humanGateLines,
      "",
      "Provider strategy",
      ...(providerLines.length > 0
        ? providerLines
        : ["- No explicit provider-role assignments recorded in PROJECT-BLUEPRINT.md."]),
      "",
      ...buildProjectWorkItemIssueMarkers({
        workItemId: params.workItemId,
        blueprintRevisionId: params.blueprintRevisionId,
        workItemFingerprint: params.workItemFingerprint,
      }),
    ].join("\n"),
  };
}

function emptyProjectWorkItemGitHubProjection(): ProjectWorkItemGitHubProjection {
  return {
    current: null,
    history: [],
  };
}

function normalizeProjectWorkItemGitHubIssueLink(
  raw: unknown,
): ProjectWorkItemGitHubIssueLink | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<ProjectWorkItemGitHubIssueLink>;
  if (
    typeof candidate.issueNumber !== "number" ||
    typeof candidate.issueUrl !== "string" ||
    typeof candidate.issueTitle !== "string" ||
    typeof candidate.linkedAt !== "string"
  ) {
    return undefined;
  }
  return {
    issueNumber: candidate.issueNumber,
    issueUrl: candidate.issueUrl,
    issueTitle: candidate.issueTitle,
    issueState: candidate.issueState === "closed" ? "closed" : "open",
    linkedAt: candidate.linkedAt,
    linkedFrom: candidate.linkedFrom === "reused" ? "reused" : "created",
    blueprintRevisionId:
      typeof candidate.blueprintRevisionId === "string" ? candidate.blueprintRevisionId : null,
  };
}

function normalizeProjectWorkItemGitHubProjection(raw: unknown): ProjectWorkItemGitHubProjection {
  if (!raw || typeof raw !== "object") {
    return emptyProjectWorkItemGitHubProjection();
  }
  const candidate = raw as Partial<ProjectWorkItemGitHubProjection>;
  const history = Array.isArray(candidate.history)
    ? candidate.history
        .map((entry) => normalizeProjectWorkItemGitHubIssueLink(entry))
        .filter((entry): entry is ProjectWorkItemGitHubIssueLink => Boolean(entry))
        .toSorted((left, right) => right.linkedAt.localeCompare(left.linkedAt))
    : [];
  const current = normalizeProjectWorkItemGitHubIssueLink(candidate.current) ?? history[0] ?? null;
  return {
    current,
    history,
  };
}

function allocateProjectWorkItemId(params: {
  kind: ProjectWorkItemKind;
  title: string;
  preferredIndex: number;
  usedIds: Set<string>;
}): string {
  let ordinal = Math.max(1, params.preferredIndex);
  const slug = slugifyWorkItemIdSegment(params.title);
  while (true) {
    const candidate = `${params.kind}-${String(ordinal).padStart(2, "0")}-${slug}`;
    if (!params.usedIds.has(candidate)) {
      params.usedIds.add(candidate);
      return candidate;
    }
    ordinal += 1;
  }
}

function preserveProjectWorkItemStatus(
  previous: ProjectWorkItem | undefined,
  fallback: ProjectWorkItemStatus,
): ProjectWorkItemStatus {
  if (!previous || previous.status === "superseded") {
    return fallback;
  }
  return previous.status;
}

function normalizeProjectWorkItem(raw: unknown): ProjectWorkItem | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<ProjectWorkItem>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.kind !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.summary !== "string" ||
    typeof candidate.blueprintPath !== "string"
  ) {
    return undefined;
  }
  const kind = PROJECT_WORK_ITEM_KINDS.find((value) => value === candidate.kind);
  const status = PROJECT_WORK_ITEM_STATUSES.find((value) => value === candidate.status);
  const workItemClass = PROJECT_WORK_ITEM_CLASSES.find((value) => value === candidate.class);
  const executionMode = PROJECT_WORK_ITEM_EXECUTION_MODES.find(
    (value) => value === candidate.executionMode,
  );
  if (!kind || !status) {
    return undefined;
  }
  return {
    id: candidate.id,
    kind,
    status,
    class: workItemClass ?? classifyProjectWorkItemClass(candidate.title),
    executionMode: executionMode ?? classifyProjectWorkItemExecutionMode(candidate.title),
    fingerprint:
      typeof candidate.fingerprint === "string" && candidate.fingerprint.length > 0
        ? candidate.fingerprint
        : buildProjectWorkItemFingerprint({
            kind,
            source: "blueprint",
            sourceSection: "Workstreams",
            title: candidate.title,
            summary: candidate.summary,
            executionMode: executionMode ?? classifyProjectWorkItemExecutionMode(candidate.title),
            workItemClass: workItemClass ?? classifyProjectWorkItemClass(candidate.title),
          }),
    title: candidate.title,
    summary: candidate.summary,
    source: "blueprint",
    sourceSection: "Workstreams",
    workstreamIndex:
      typeof candidate.workstreamIndex === "number" && Number.isFinite(candidate.workstreamIndex)
        ? candidate.workstreamIndex
        : 0,
    blueprintPath: candidate.blueprintPath,
    blueprintRevisionId:
      typeof candidate.blueprintRevisionId === "string" ? candidate.blueprintRevisionId : null,
    acceptanceCriteria: Array.isArray(candidate.acceptanceCriteria)
      ? candidate.acceptanceCriteria.filter((value): value is string => typeof value === "string")
      : [],
    openQuestions: Array.isArray(candidate.openQuestions)
      ? candidate.openQuestions.filter((value): value is string => typeof value === "string")
      : [],
    humanGates: Array.isArray(candidate.humanGates)
      ? candidate.humanGates.filter((value): value is string => typeof value === "string")
      : [],
    providerRoleAssignments:
      typeof candidate.providerRoleAssignments === "object" && candidate.providerRoleAssignments
        ? candidate.providerRoleAssignments
        : emptyProjectBlueprintRoleAssignments(),
    githubIssueDraft:
      typeof candidate.githubIssueDraft?.title === "string" &&
      typeof candidate.githubIssueDraft?.body === "string"
        ? candidate.githubIssueDraft
        : { title: candidate.title, body: candidate.summary },
    githubIssue: normalizeProjectWorkItemGitHubProjection(candidate.githubIssue),
  };
}

function emptyProjectWorkItemInventory(params: {
  repoRoot: string;
  inventoryPath: string;
  blueprintPath: string;
  blueprintExists: boolean;
  blueprintTitle: string | null;
  blueprintStatus: ProjectBlueprintStatus | null;
  blueprintRevisionId: string | null;
  currentBlueprintRevisionId: string | null;
}): ProjectWorkItemInventory {
  return {
    repoRoot: params.repoRoot,
    inventoryPath: params.inventoryPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.blueprintExists,
    blueprintPath: params.blueprintPath,
    blueprintTitle: params.blueprintTitle,
    blueprintStatus: params.blueprintStatus,
    blueprintRevisionId: params.blueprintRevisionId,
    currentBlueprintRevisionId: params.currentBlueprintRevisionId,
    artifactStale: null,
    readyForExecution: false,
    readyForIssueProjection: false,
    blockerCount: 0,
    blockers: [],
    suggestionCount: 0,
    suggestions: [],
    workItemCount: 0,
    plannedWorkItemCount: 0,
    discoveredWorkItemCount: 0,
    supersededWorkItemCount: 0,
    workItems: [],
  };
}

export function resolveProjectWorkItemInventoryPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "work-items.json");
}

type ProjectTrackedIssueState = {
  currentIssueNumber: number | null;
  queuedIssueNumbers: Set<number>;
  snapshotsByIssueNumber: Map<number, OpenClawCodeIssueStatusSnapshot>;
};

function resolveTrackedIssueSnapshotStatus(stage: WorkflowStage): ProjectWorkItemStatus | null {
  switch (stage) {
    case "intake":
    case "planning":
    case "awaiting-plan-approval":
      return "queued";
    case "building":
    case "draft-pr-opened":
    case "verifying":
    case "ready-for-human-review":
      return "in-progress";
    case "changes-requested":
    case "escalated":
    case "failed":
      return "blocked";
    case "completed-without-changes":
    case "merged":
      return "completed";
    default:
      return null;
  }
}

function reconcileProjectedIssueLink(params: {
  projection: ProjectWorkItemGitHubProjection;
  trackedIssueState: ProjectTrackedIssueState | null;
}): ProjectWorkItemGitHubProjection {
  const current = params.projection.current;
  if (!current) {
    return params.projection;
  }
  const snapshot = params.trackedIssueState?.snapshotsByIssueNumber.get(current.issueNumber);
  const nextIssueState =
    snapshot?.stage === "merged" || snapshot?.stage === "completed-without-changes"
      ? "closed"
      : current.issueState;
  if (nextIssueState === current.issueState) {
    return params.projection;
  }
  const nextCurrent = {
    ...current,
    issueState: nextIssueState,
  };
  return {
    current: nextCurrent,
    history: params.projection.history.map((entry) =>
      entry.issueNumber === nextCurrent.issueNumber
        ? { ...entry, issueState: nextIssueState }
        : entry,
    ),
  };
}

function resolveProjectedWorkItemStatus(params: {
  previous: ProjectWorkItem | undefined;
  fallback: ProjectWorkItemStatus;
  githubIssue: ProjectWorkItemGitHubProjection;
  trackedIssueState: ProjectTrackedIssueState | null;
}): ProjectWorkItemStatus {
  if (params.previous?.status === "canceled" || params.previous?.status === "superseded") {
    return params.previous.status;
  }
  const currentIssueNumber = params.githubIssue.current?.issueNumber ?? null;
  if (currentIssueNumber != null) {
    if (params.trackedIssueState?.currentIssueNumber === currentIssueNumber) {
      return "in-progress";
    }
    if (params.trackedIssueState?.queuedIssueNumbers.has(currentIssueNumber)) {
      return "queued";
    }
    const snapshot = params.trackedIssueState?.snapshotsByIssueNumber.get(currentIssueNumber);
    if (snapshot) {
      const resolved = resolveTrackedIssueSnapshotStatus(snapshot.stage);
      if (resolved) {
        return resolved;
      }
    }
    if (params.githubIssue.current?.issueState === "closed") {
      return "completed";
    }
  }
  if (params.previous?.status === "completed") {
    return "completed";
  }
  return params.fallback;
}

async function resolveProjectTrackedIssueState(
  repoRoot: string,
): Promise<ProjectTrackedIssueState | null> {
  const repo = await resolveGitHubRepoFromGit(repoRoot).catch(() => null);
  if (!repo) {
    return null;
  }
  const operatorSnapshot = await readOpenClawCodeOperatorStatusSnapshot(resolveStateDir()).catch(
    () => null,
  );
  if (!operatorSnapshot) {
    return null;
  }
  const repoKey = `${repo.owner}/${repo.repo}`.toLowerCase();
  const currentIssueNumber =
    operatorSnapshot.currentRun &&
    `${operatorSnapshot.currentRun.request.owner}/${operatorSnapshot.currentRun.request.repo}`.toLowerCase() ===
      repoKey
      ? operatorSnapshot.currentRun.request.issueNumber
      : null;
  const snapshotsByIssueNumber = new Map<number, OpenClawCodeIssueStatusSnapshot>();
  for (const snapshot of operatorSnapshot.issueSnapshots) {
    if (`${snapshot.owner}/${snapshot.repo}`.toLowerCase() !== repoKey) {
      continue;
    }
    snapshotsByIssueNumber.set(snapshot.issueNumber, snapshot);
  }
  return {
    currentIssueNumber,
    queuedIssueNumbers: new Set<number>(),
    snapshotsByIssueNumber,
  };
}

export async function deriveProjectWorkItemInventory(
  repoRootInput: string,
): Promise<ProjectWorkItemInventory> {
  const repoRoot = path.resolve(repoRootInput);
  const inventoryPath = resolveProjectWorkItemInventoryPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const clarificationReport = await inspectProjectBlueprintClarifications(repoRoot);
  const blockers = new Set<string>(clarificationReport.questions);
  const suggestions = new Set<string>(clarificationReport.suggestions);
  const previousRaw = await readFile(inventoryPath, "utf8")
    .then((raw) => JSON.parse(raw) as Partial<ProjectWorkItemInventory>)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    });
  const previousItems = Array.isArray(previousRaw?.workItems)
    ? previousRaw.workItems
        .map((entry) => normalizeProjectWorkItem(entry))
        .filter((entry): entry is ProjectWorkItem => Boolean(entry))
    : [];

  if (!blueprint.exists) {
    const inventory = emptyProjectWorkItemInventory({
      repoRoot,
      inventoryPath,
      blueprintPath: blueprint.blueprintPath,
      blueprintExists: false,
      blueprintTitle: null,
      blueprintStatus: null,
      blueprintRevisionId: null,
      currentBlueprintRevisionId: null,
    });
    inventory.blockers = [...blockers];
    inventory.blockerCount = inventory.blockers.length;
    inventory.suggestions = [...suggestions];
    inventory.suggestionCount = inventory.suggestions.length;
    return inventory;
  }

  const workstreamItems = extractMarkdownListItems(blueprint.sectionBodies.Workstreams);
  const acceptanceCriteria = extractMarkdownListItems(blueprint.sectionBodies["Success Criteria"]);
  const openQuestions = extractMarkdownListItems(blueprint.sectionBodies["Open Questions"]);
  const humanGates = extractMarkdownListItems(blueprint.sectionBodies["Human Gates"]);

  if (workstreamItems.length === 0) {
    blockers.add(
      "Add at least one concrete bullet under `Workstreams` before decomposing execution work items.",
    );
  }

  if (!blueprint.hasAgreementCheckpoint) {
    blockers.add(
      "Record blueprint agreement with `openclaw code blueprint-set-status --status agreed` before autonomous issue projection.",
    );
  }

  if (openQuestions.length > 0) {
    blockers.add(
      "Resolve or explicitly clear the remaining `Open Questions` before autonomous issue projection.",
    );
  }

  if (blueprint.status === "superseded") {
    blockers.add(
      "The current blueprint is marked `superseded`; create or activate a new blueprint first.",
    );
  }

  const generatedAt = new Date().toISOString();
  const trackedIssueState = await resolveProjectTrackedIssueState(repoRoot);
  const previousByFingerprint = new Map(previousItems.map((item) => [item.fingerprint, item]));
  const matchedFingerprints = new Set<string>();
  const usedIds = new Set(previousItems.map((item) => item.id));
  const activeWorkItems = workstreamItems.map((workstream, index) => {
    const executionMode = classifyProjectWorkItemExecutionMode(workstream);
    const workItemClass = classifyProjectWorkItemClass(workstream);
    const fingerprint = buildProjectWorkItemFingerprint({
      kind: "planned",
      source: "blueprint",
      sourceSection: "Workstreams",
      title: workstream,
      summary: workstream,
      executionMode,
      workItemClass,
    });
    const previous = previousByFingerprint.get(fingerprint);
    if (previous) {
      matchedFingerprints.add(fingerprint);
    }
    const id =
      previous?.id ??
      allocateProjectWorkItemId({
        kind: "planned",
        title: workstream,
        preferredIndex: index + 1,
        usedIds,
      });
    const githubIssue = reconcileProjectedIssueLink({
      projection: previous?.githubIssue ?? emptyProjectWorkItemGitHubProjection(),
      trackedIssueState,
    });
    return {
      id,
      kind: "planned" as const,
      status: resolveProjectedWorkItemStatus({
        previous,
        fallback: "planned",
        githubIssue,
        trackedIssueState,
      }),
      class: workItemClass,
      executionMode,
      fingerprint,
      title: workstream,
      summary: workstream,
      source: "blueprint" as const,
      sourceSection: "Workstreams" as const,
      workstreamIndex: index + 1,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      acceptanceCriteria,
      openQuestions,
      humanGates,
      providerRoleAssignments: blueprint.providerRoleAssignments,
      githubIssueDraft: resolveProjectWorkItemIssueDraft({
        blueprintTitle: blueprint.title,
        blueprintGoal: blueprint.goalSummary,
        blueprintRevisionId: blueprint.revisionId,
        workItemId: id,
        workItemFingerprint: fingerprint,
        workItem: workstream,
        executionMode,
        acceptanceCriteria,
        openQuestions,
        humanGates,
        providerRoleAssignments: blueprint.providerRoleAssignments,
      }),
      githubIssue,
    };
  });
  const supersededWorkItems = previousItems
    .filter((item) => item.kind === "planned" && !matchedFingerprints.has(item.fingerprint))
    .map((item) => ({
      ...item,
      status: "superseded" as const,
      blueprintPath: blueprint.blueprintPath,
      providerRoleAssignments: blueprint.providerRoleAssignments,
    }));
  const preservedDiscovered = previousItems
    .filter((item) => item.kind === "discovered")
    .map((item) => {
      const githubIssue = reconcileProjectedIssueLink({
        projection: item.githubIssue,
        trackedIssueState,
      });
      return {
        ...item,
        status: resolveProjectedWorkItemStatus({
          previous: item,
          fallback: item.status === "blocked" ? "blocked" : "planned",
          githubIssue,
          trackedIssueState,
        }),
        githubIssue,
      };
    });
  const workItems = [...activeWorkItems, ...preservedDiscovered, ...supersededWorkItems];

  const blockerList = [...blockers].toSorted();
  const suggestionList = [...suggestions].toSorted();
  const activeWorkItemCount = workItems.filter((item) => item.status !== "superseded").length;
  const activePlannedWorkItemCount = workItems.filter(
    (item) => item.kind === "planned" && item.status !== "superseded",
  ).length;
  const activeDiscoveredWorkItemCount = workItems.filter(
    (item) => item.kind === "discovered" && item.status !== "superseded",
  ).length;
  const supersededWorkItemCount = workItems.filter((item) => item.status === "superseded").length;
  return {
    repoRoot,
    inventoryPath,
    exists: false,
    schemaVersion: PROJECT_WORK_ITEM_SCHEMA_VERSION,
    generatedAt,
    blueprintExists: true,
    blueprintPath: blueprint.blueprintPath,
    blueprintTitle: blueprint.title,
    blueprintStatus: blueprint.status,
    blueprintRevisionId: blueprint.revisionId,
    currentBlueprintRevisionId: blueprint.revisionId,
    artifactStale: false,
    readyForExecution: blockerList.length === 0 && activeWorkItemCount > 0,
    readyForIssueProjection: blockerList.length === 0 && activeWorkItemCount > 0,
    blockerCount: blockerList.length,
    blockers: blockerList,
    suggestionCount: suggestionList.length,
    suggestions: suggestionList,
    workItemCount: activeWorkItemCount,
    plannedWorkItemCount: activePlannedWorkItemCount,
    discoveredWorkItemCount: activeDiscoveredWorkItemCount,
    supersededWorkItemCount,
    workItems,
  };
}

function mergeDiscoveredWorkItems(params: {
  inventory: ProjectWorkItemInventory;
  discoveredWorkItems: ProjectWorkItem[];
}): ProjectWorkItemInventory {
  if (params.discoveredWorkItems.length === 0) {
    return params.inventory;
  }

  const plannedAndSuperseded = params.inventory.workItems.filter(
    (item) => item.kind !== "discovered",
  );
  const existingDiscovered = params.inventory.workItems.filter(
    (item) => item.kind === "discovered",
  );
  const existingByFingerprint = new Map(existingDiscovered.map((item) => [item.fingerprint, item]));
  const mergedDiscovered = params.discoveredWorkItems.map((item) => {
    const previous = existingByFingerprint.get(item.fingerprint);
    return {
      ...item,
      id: previous?.id ?? item.id,
      status: preserveProjectWorkItemStatus(previous, item.status),
      githubIssue: previous?.githubIssue ?? item.githubIssue,
    };
  });
  const retainedHistoricalDiscovered = existingDiscovered
    .filter(
      (item) =>
        !params.discoveredWorkItems.some((candidate) => candidate.fingerprint === item.fingerprint),
    )
    .map((item) => ({
      ...item,
      status: "superseded" as const,
    }));
  const workItems = [...plannedAndSuperseded, ...mergedDiscovered, ...retainedHistoricalDiscovered];
  const activeWorkItems = workItems.filter((item) => item.status !== "superseded");
  const activePlannedWorkItemCount = workItems.filter(
    (item) => item.kind === "planned" && item.status !== "superseded",
  ).length;
  const activeDiscoveredWorkItemCount = workItems.filter(
    (item) => item.kind === "discovered" && item.status !== "superseded",
  ).length;
  const supersededWorkItemCount = workItems.filter((item) => item.status === "superseded").length;

  return {
    ...params.inventory,
    workItemCount: activeWorkItems.length,
    plannedWorkItemCount: activePlannedWorkItemCount,
    discoveredWorkItemCount: activeDiscoveredWorkItemCount,
    supersededWorkItemCount,
    workItems,
    readyForExecution: params.inventory.blockerCount === 0 && activeWorkItems.length > 0,
    readyForIssueProjection: params.inventory.blockerCount === 0 && activeWorkItems.length > 0,
  };
}

export async function writeProjectWorkItemInventory(
  repoRootInput: string,
): Promise<ProjectWorkItemInventory> {
  const inventory = await deriveProjectWorkItemInventory(repoRootInput);
  if (!inventory.blueprintExists) {
    return inventory;
  }

  await mkdir(path.dirname(inventory.inventoryPath), { recursive: true });
  const persisted = {
    ...inventory,
    exists: true,
  };
  await writeFile(inventory.inventoryPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function writeProjectWorkItemInventoryWithDiscoveredItems(params: {
  repoRoot: string;
  discoveredWorkItems: ProjectWorkItem[];
}): Promise<ProjectWorkItemInventory> {
  const inventory = mergeDiscoveredWorkItems({
    inventory: await deriveProjectWorkItemInventory(params.repoRoot),
    discoveredWorkItems: params.discoveredWorkItems,
  });
  if (!inventory.blueprintExists) {
    return inventory;
  }

  await mkdir(path.dirname(inventory.inventoryPath), { recursive: true });
  const persisted = {
    ...inventory,
    exists: true,
  };
  await writeFile(inventory.inventoryPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function readProjectWorkItemInventory(
  repoRootInput: string,
): Promise<ProjectWorkItemInventory> {
  const repoRoot = path.resolve(repoRootInput);
  const inventoryPath = resolveProjectWorkItemInventoryPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);

  try {
    const raw = await readFile(inventoryPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectWorkItemInventory>;
    const workItems = Array.isArray(parsed.workItems)
      ? parsed.workItems
          .map((entry) => normalizeProjectWorkItem(entry))
          .filter((entry): entry is ProjectWorkItem => Boolean(entry))
      : [];
    const workItemCount =
      typeof parsed.workItemCount === "number"
        ? parsed.workItemCount
        : workItems.filter((item) => item.status !== "superseded").length;
    const plannedWorkItemCount =
      typeof parsed.plannedWorkItemCount === "number"
        ? parsed.plannedWorkItemCount
        : workItems.filter((item) => item.kind === "planned" && item.status !== "superseded")
            .length;
    const discoveredWorkItemCount =
      typeof parsed.discoveredWorkItemCount === "number"
        ? parsed.discoveredWorkItemCount
        : workItems.filter((item) => item.kind === "discovered" && item.status !== "superseded")
            .length;
    const supersededWorkItemCount =
      typeof parsed.supersededWorkItemCount === "number"
        ? parsed.supersededWorkItemCount
        : workItems.filter((item) => item.status === "superseded").length;
    return {
      ...parsed,
      inventoryPath,
      repoRoot,
      exists: parsed.exists ?? true,
      schemaVersion: parsed.schemaVersion ?? PROJECT_WORK_ITEM_SCHEMA_VERSION,
      generatedAt: parsed.generatedAt ?? null,
      blueprintExists: blueprint.exists,
      blueprintPath: blueprint.blueprintPath,
      blueprintTitle: blueprint.title,
      blueprintStatus: blueprint.status,
      blueprintRevisionId: parsed.blueprintRevisionId ?? null,
      currentBlueprintRevisionId: blueprint.revisionId,
      artifactStale:
        blueprint.revisionId == null || parsed.blueprintRevisionId == null
          ? null
          : blueprint.revisionId !== parsed.blueprintRevisionId,
      readyForExecution: parsed.readyForExecution ?? workItemCount > 0,
      readyForIssueProjection: parsed.readyForIssueProjection ?? workItemCount > 0,
      blockerCount: parsed.blockerCount ?? 0,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      suggestionCount: parsed.suggestionCount ?? 0,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      workItemCount,
      plannedWorkItemCount,
      discoveredWorkItemCount,
      supersededWorkItemCount,
      workItems,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyProjectWorkItemInventory({
        repoRoot,
        inventoryPath,
        blueprintPath: blueprint.blueprintPath,
        blueprintExists: blueprint.exists,
        blueprintTitle: blueprint.title,
        blueprintStatus: blueprint.status,
        blueprintRevisionId: blueprint.revisionId,
        currentBlueprintRevisionId: blueprint.revisionId,
      });
    }
    throw error;
  }
}
