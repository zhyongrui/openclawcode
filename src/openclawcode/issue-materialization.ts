import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GitHubRestClient, type GitHubIssueClient } from "./github/index.js";
import {
  readProjectNextWorkSelection,
  writeProjectNextWorkSelection,
  type ProjectNextWorkDecisionId,
} from "./next-work.js";
import type { ProjectStageGateId } from "./stage-gates.js";
import {
  readProjectWorkItemInventory,
  type ProjectWorkItem,
  type ProjectWorkItemExecutionMode,
} from "./work-items.js";

export const PROJECT_ISSUE_MATERIALIZATION_SCHEMA_VERSION = 1;

const WORK_ITEM_ID_MARKER = "openclawcode-work-item-id";
const BLUEPRINT_REVISION_MARKER = "openclawcode-blueprint-revision";
const WORK_ITEM_FINGERPRINT_MARKER = "openclawcode-work-item-fingerprint";

export interface ProjectIssueMaterializationEntry {
  workItemId: string;
  blueprintRevisionId: string | null;
  issueNumber: number;
  issueUrl: string;
  issueTitle: string;
  issueState: "open" | "closed";
  materializedAt: string;
  reusedExisting: boolean;
  draftFingerprint: string;
  stale: boolean;
}

export interface ProjectIssueMaterializationArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintRevisionId: string | null;
  nextWorkDecision: ProjectNextWorkDecisionId;
  canContinueAutonomously: boolean;
  blockingGateId: ProjectStageGateId | null;
  selectedWorkItemId: string | null;
  selectedWorkItemExecutionMode: ProjectWorkItemExecutionMode | null;
  selectedIssueNumber: number | null;
  selectedIssueUrl: string | null;
  selectedIssueTitle: string | null;
  outcome: "blocked" | "missing-selection" | "created" | "reused";
  blockerCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
  entries: ProjectIssueMaterializationEntry[];
}

function resolveProjectIssueMaterializationArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "issue-materialization.json");
}

function normalizeEntry(raw: unknown): ProjectIssueMaterializationEntry | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<ProjectIssueMaterializationEntry>;
  if (
    typeof candidate.workItemId !== "string" ||
    typeof candidate.issueNumber !== "number" ||
    typeof candidate.issueUrl !== "string" ||
    typeof candidate.issueTitle !== "string" ||
    typeof candidate.materializedAt !== "string" ||
    typeof candidate.draftFingerprint !== "string"
  ) {
    return undefined;
  }
  return {
    workItemId: candidate.workItemId,
    blueprintRevisionId:
      typeof candidate.blueprintRevisionId === "string" ? candidate.blueprintRevisionId : null,
    issueNumber: candidate.issueNumber,
    issueUrl: candidate.issueUrl,
    issueTitle: candidate.issueTitle,
    issueState: candidate.issueState === "closed" ? "closed" : "open",
    materializedAt: candidate.materializedAt,
    reusedExisting: Boolean(candidate.reusedExisting),
    draftFingerprint: candidate.draftFingerprint,
    stale: Boolean(candidate.stale),
  };
}

function emptyProjectIssueMaterializationArtifact(params: {
  repoRoot: string;
  artifactPath: string;
  selection: Awaited<ReturnType<typeof readProjectNextWorkSelection>>;
}): ProjectIssueMaterializationArtifact {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.selection.blueprintExists,
    blueprintRevisionId: params.selection.blueprintRevisionId,
    nextWorkDecision: params.selection.decision,
    canContinueAutonomously: params.selection.canContinueAutonomously,
    blockingGateId: params.selection.blockingGateId,
    selectedWorkItemId: params.selection.selectedWorkItem?.id ?? null,
    selectedWorkItemExecutionMode: null,
    selectedIssueNumber: null,
    selectedIssueUrl: null,
    selectedIssueTitle: null,
    outcome: params.selection.selectedWorkItem ? "blocked" : "missing-selection",
    blockerCount: params.selection.blockerCount,
    blockers: [...params.selection.blockers],
    suggestionCount: params.selection.suggestionCount,
    suggestions: [...params.selection.suggestions],
    entries: [],
  };
}

function buildDraftFingerprint(workItem: Pick<ProjectWorkItem, "githubIssueDraft">): string {
  return createHash("sha1")
    .update(workItem.githubIssueDraft.title)
    .update("\n")
    .update(workItem.githubIssueDraft.body)
    .digest("hex");
}

function buildProjectionFingerprint(
  workItem: Pick<ProjectWorkItem, "fingerprint" | "githubIssueDraft">,
): string {
  return workItem.fingerprint || buildDraftFingerprint(workItem);
}

function readMarker(body: string | undefined, marker: string): string | null {
  if (!body) {
    return null;
  }
  const match = new RegExp(`<!--\\s*${marker}:\\s*([^>]+?)\\s*-->`, "i").exec(body);
  return match?.[1]?.trim() ?? null;
}

function sortEntries(
  entries: ProjectIssueMaterializationEntry[],
): ProjectIssueMaterializationEntry[] {
  return [...entries].toSorted((left, right) => {
    if (left.stale !== right.stale) {
      return left.stale ? 1 : -1;
    }
    return (
      right.materializedAt.localeCompare(left.materializedAt) ||
      left.workItemId.localeCompare(right.workItemId)
    );
  });
}

export function buildProjectWorkItemIssueMarkers(params: {
  workItemId: string;
  blueprintRevisionId: string | null;
  workItemFingerprint?: string | null;
}): string[] {
  return [
    `<!-- ${WORK_ITEM_ID_MARKER}: ${params.workItemId} -->`,
    `<!-- ${BLUEPRINT_REVISION_MARKER}: ${params.blueprintRevisionId ?? "unknown"} -->`,
    ...(params.workItemFingerprint
      ? [`<!-- ${WORK_ITEM_FINGERPRINT_MARKER}: ${params.workItemFingerprint} -->`]
      : []),
  ];
}

async function findReusableIssue(params: {
  owner: string;
  repo: string;
  workItem: ProjectWorkItem;
  github: GitHubIssueClient;
}): Promise<
  | {
      issueNumber: number;
      issueUrl: string;
      issueTitle: string;
      issueState: "open" | "closed";
      reusedExisting: true;
    }
  | undefined
> {
  const issues = await params.github.listIssues({
    owner: params.owner,
    repo: params.repo,
    state: "open",
    perPage: 100,
  });
  for (const issue of issues) {
    const workItemId = readMarker(issue.body, WORK_ITEM_ID_MARKER);
    const revisionId = readMarker(issue.body, BLUEPRINT_REVISION_MARKER);
    const fingerprint = readMarker(issue.body, WORK_ITEM_FINGERPRINT_MARKER);
    if (
      workItemId === params.workItem.id &&
      (fingerprint === params.workItem.fingerprint ||
        revisionId === (params.workItem.blueprintRevisionId ?? "unknown"))
    ) {
      return {
        issueNumber: issue.number,
        issueUrl: issue.url,
        issueTitle: issue.title,
        issueState: issue.state,
        reusedExisting: true,
      };
    }
  }
  return undefined;
}

export async function readProjectIssueMaterializationArtifact(
  repoRootInput: string,
): Promise<ProjectIssueMaterializationArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectIssueMaterializationArtifactPath(repoRoot);
  const selection = await readProjectNextWorkSelection(repoRoot);
  const empty = emptyProjectIssueMaterializationArtifact({
    repoRoot,
    artifactPath,
    selection,
  });
  const raw = await readFile(artifactPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!raw) {
    return empty;
  }
  const parsed = JSON.parse(raw) as Partial<ProjectIssueMaterializationArtifact>;
  return {
    ...empty,
    exists: true,
    schemaVersion:
      typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : empty.schemaVersion,
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : empty.generatedAt,
    blueprintExists:
      typeof parsed.blueprintExists === "boolean" ? parsed.blueprintExists : empty.blueprintExists,
    blueprintRevisionId:
      typeof parsed.blueprintRevisionId === "string"
        ? parsed.blueprintRevisionId
        : parsed.blueprintRevisionId === null
          ? null
          : empty.blueprintRevisionId,
    nextWorkDecision:
      parsed.nextWorkDecision === "ready-to-execute" ||
      parsed.nextWorkDecision === "blocked-on-human" ||
      parsed.nextWorkDecision === "blocked-on-missing-clarification" ||
      parsed.nextWorkDecision === "blocked-on-policy" ||
      parsed.nextWorkDecision === "no-actionable-work-item"
        ? parsed.nextWorkDecision
        : empty.nextWorkDecision,
    canContinueAutonomously:
      typeof parsed.canContinueAutonomously === "boolean"
        ? parsed.canContinueAutonomously
        : empty.canContinueAutonomously,
    blockingGateId:
      typeof parsed.blockingGateId === "string" ? parsed.blockingGateId : empty.blockingGateId,
    selectedWorkItemId:
      typeof parsed.selectedWorkItemId === "string"
        ? parsed.selectedWorkItemId
        : parsed.selectedWorkItemId === null
          ? null
          : empty.selectedWorkItemId,
    selectedWorkItemExecutionMode:
      parsed.selectedWorkItemExecutionMode === "feature" ||
      parsed.selectedWorkItemExecutionMode === "bugfix" ||
      parsed.selectedWorkItemExecutionMode === "refactor" ||
      parsed.selectedWorkItemExecutionMode === "research"
        ? parsed.selectedWorkItemExecutionMode
        : empty.selectedWorkItemExecutionMode,
    selectedIssueNumber:
      typeof parsed.selectedIssueNumber === "number"
        ? parsed.selectedIssueNumber
        : empty.selectedIssueNumber,
    selectedIssueUrl:
      typeof parsed.selectedIssueUrl === "string"
        ? parsed.selectedIssueUrl
        : parsed.selectedIssueUrl === null
          ? null
          : empty.selectedIssueUrl,
    selectedIssueTitle:
      typeof parsed.selectedIssueTitle === "string"
        ? parsed.selectedIssueTitle
        : parsed.selectedIssueTitle === null
          ? null
          : empty.selectedIssueTitle,
    outcome:
      parsed.outcome === "blocked" ||
      parsed.outcome === "missing-selection" ||
      parsed.outcome === "created" ||
      parsed.outcome === "reused"
        ? parsed.outcome
        : empty.outcome,
    blockerCount:
      typeof parsed.blockerCount === "number" ? parsed.blockerCount : empty.blockerCount,
    blockers: Array.isArray(parsed.blockers)
      ? parsed.blockers.filter((value): value is string => typeof value === "string")
      : empty.blockers,
    suggestionCount:
      typeof parsed.suggestionCount === "number" ? parsed.suggestionCount : empty.suggestionCount,
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((value): value is string => typeof value === "string")
      : empty.suggestions,
    entries: Array.isArray(parsed.entries)
      ? sortEntries(
          parsed.entries
            .map((entry) => normalizeEntry(entry))
            .filter((entry): entry is ProjectIssueMaterializationEntry => entry != null),
        )
      : empty.entries,
  };
}

async function writeLinkedWorkItemBackToInventory(params: {
  repoRoot: string;
  workItem: ProjectWorkItem;
  materializedAt: string;
  linkedFrom: "created" | "reused";
  issueNumber: number;
  issueUrl: string;
  issueTitle: string;
  issueState: "open" | "closed";
}): Promise<void> {
  const inventory = await readProjectWorkItemInventory(params.repoRoot);
  if (!inventory.blueprintExists || inventory.workItems.length === 0) {
    return;
  }
  const linkedEntry = {
    issueNumber: params.issueNumber,
    issueUrl: params.issueUrl,
    issueTitle: params.issueTitle,
    issueState: params.issueState,
    linkedAt: params.materializedAt,
    linkedFrom: params.linkedFrom,
    blueprintRevisionId: params.workItem.blueprintRevisionId,
  } as const;
  const workItems = inventory.workItems.map((entry) => {
    if (entry.id !== params.workItem.id) {
      return entry;
    }
    const history = [
      linkedEntry,
      ...entry.githubIssue.history.filter(
        (candidate) =>
          !(
            candidate.issueNumber === linkedEntry.issueNumber &&
            candidate.issueUrl === linkedEntry.issueUrl
          ),
      ),
    ].toSorted((left, right) => right.linkedAt.localeCompare(left.linkedAt));
    return {
      ...entry,
      githubIssue: {
        current: linkedEntry,
        history,
      },
    };
  });
  const persisted = {
    ...inventory,
    exists: true,
    generatedAt: inventory.generatedAt ?? params.materializedAt,
    workItems,
  };
  await mkdir(path.dirname(inventory.inventoryPath), { recursive: true });
  await writeFile(inventory.inventoryPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

export async function writeProjectIssueMaterializationArtifact(params: {
  repoRoot: string;
  owner: string;
  repo: string;
  github?: GitHubIssueClient;
}): Promise<ProjectIssueMaterializationArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const selection = await writeProjectNextWorkSelection(repoRoot);
  const artifactPath = resolveProjectIssueMaterializationArtifactPath(repoRoot);
  const previous = await readProjectIssueMaterializationArtifact(repoRoot);
  const now = new Date().toISOString();

  const base: ProjectIssueMaterializationArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_ISSUE_MATERIALIZATION_SCHEMA_VERSION,
    generatedAt: now,
    blueprintExists: selection.blueprintExists,
    blueprintRevisionId: selection.blueprintRevisionId,
    nextWorkDecision: selection.decision,
    canContinueAutonomously: selection.canContinueAutonomously,
    blockingGateId: selection.blockingGateId,
    selectedWorkItemId: selection.selectedWorkItem?.id ?? null,
    selectedWorkItemExecutionMode: null,
    selectedIssueNumber: null,
    selectedIssueUrl: null,
    selectedIssueTitle: null,
    outcome: selection.selectedWorkItem ? "blocked" : "missing-selection",
    blockerCount: selection.blockerCount,
    blockers: [...selection.blockers],
    suggestionCount: selection.suggestionCount,
    suggestions: [...selection.suggestions],
    entries: sortEntries(
      previous.entries.map((entry) =>
        entry.workItemId === selection.selectedWorkItem?.id &&
        entry.blueprintRevisionId !== selection.blueprintRevisionId
          ? { ...entry, stale: true }
          : entry,
      ),
    ),
  };

  if (selection.decision !== "ready-to-execute" || !selection.selectedWorkItem) {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(base, null, 2)}\n`, "utf8");
    return base;
  }

  const inventory = await readProjectWorkItemInventory(repoRoot);
  const workItem = inventory.workItems.find((entry) => entry.id === selection.selectedWorkItem?.id);
  if (!workItem) {
    const missingSelection = {
      ...base,
      outcome: "missing-selection" as const,
      blockers: [
        ...base.blockers,
        `Selected work item ${selection.selectedWorkItem.id} was not found in the work-item inventory.`,
      ],
      blockerCount: base.blockers.length + 1,
    };
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(missingSelection, null, 2)}\n`, "utf8");
    return missingSelection;
  }

  const github = params.github ?? new GitHubRestClient();
  const reused = await findReusableIssue({
    owner: params.owner,
    repo: params.repo,
    workItem,
    github,
  });
  const materialized = reused
    ? reused
    : await github
        .createIssue({
          owner: params.owner,
          repo: params.repo,
          title: workItem.githubIssueDraft.title,
          body: workItem.githubIssueDraft.body,
        })
        .then((issue) => ({
          issueNumber: issue.number,
          issueUrl: issue.url,
          issueTitle: issue.title,
          issueState: "open" as const,
          reusedExisting: false as const,
        }));

  const nextEntry: ProjectIssueMaterializationEntry = {
    workItemId: workItem.id,
    blueprintRevisionId: workItem.blueprintRevisionId,
    issueNumber: materialized.issueNumber,
    issueUrl: materialized.issueUrl,
    issueTitle: materialized.issueTitle,
    issueState: materialized.issueState,
    materializedAt: now,
    reusedExisting: materialized.reusedExisting,
    draftFingerprint: buildProjectionFingerprint(workItem),
    stale: false,
  };

  const persisted: ProjectIssueMaterializationArtifact = {
    ...base,
    selectedWorkItemExecutionMode: workItem.executionMode,
    selectedIssueNumber: nextEntry.issueNumber,
    selectedIssueUrl: nextEntry.issueUrl,
    selectedIssueTitle: nextEntry.issueTitle,
    outcome: materialized.reusedExisting ? "reused" : "created",
    entries: sortEntries([
      ...base.entries.filter(
        (entry) =>
          !(
            entry.workItemId === nextEntry.workItemId &&
            entry.blueprintRevisionId === nextEntry.blueprintRevisionId &&
            !entry.stale
          ),
      ),
      nextEntry,
    ]),
  };

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  await writeLinkedWorkItemBackToInventory({
    repoRoot,
    workItem,
    materializedAt: now,
    linkedFrom: materialized.reusedExisting ? "reused" : "created",
    issueNumber: nextEntry.issueNumber,
    issueUrl: nextEntry.issueUrl,
    issueTitle: nextEntry.issueTitle,
    issueState: nextEntry.issueState,
  });
  return persisted;
}
