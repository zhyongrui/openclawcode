import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawCodeIssueStatusSnapshot } from "../integrations/openclaw-plugin/store.js";
import type { RepoRef } from "./github/index.js";
import type { OpenClawCodeOperatorStatusSnapshot } from "./operator-status.js";
import { FileSystemWorkflowRunStore } from "./persistence/index.js";
import type { WorkflowRun } from "./contracts/index.js";
import { deriveWorkflowLoopHealth } from "./loop-health.js";
import { deriveWorkflowQualityGate } from "./quality-gate.js";

export const PROJECT_WORKFLOW_HISTORY_SCHEMA_VERSION = 1;
const DEFAULT_WORKFLOW_HISTORY_LIMIT = 12;
const HISTORY_TAIL_LIMIT = 3;

export interface ProjectWorkflowHistoryEntry {
  issueKey: string;
  repoKey: string;
  runId: string | null;
  source: "current-run" | "issue-snapshot" | "workflow-run";
  currentSessionFirst: boolean;
  title: string | null;
  stage: string | null;
  statusSummary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  branchName: string | null;
  worktreePath: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  qualityGateStatus: string | null;
  qualityGateSummary: string | null;
  loopHealthStatus: string | null;
  loopHealthSummary: string | null;
  latestReviewDecision: "approved" | "changes-requested" | null;
  rerunReason: string | null;
  historyEventCount: number;
  historyTail: string[];
  runArtifactPath: string | null;
}

export interface ProjectWorkflowHistoryArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  repoKey: string | null;
  projectScoped: boolean;
  currentIssueKey: string | null;
  currentSessionEntryCount: number;
  entryCount: number;
  sourceCounts: {
    currentRun: number;
    issueSnapshot: number;
    workflowRun: number;
  };
  limit: number;
  entries: ProjectWorkflowHistoryEntry[];
}

function resolveProjectWorkflowHistoryArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "workflow-history.json");
}

function resolveWorkflowRunsDir(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "runs");
}

function formatRepoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

function formatIssueKey(params: { owner: string; repo: string; issueNumber: number }): string {
  return `${params.owner}/${params.repo}#${params.issueNumber}`;
}

function normalizeSingleLine(value: string | null | undefined): string | null {
  const line = value
    ?.split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? null;
}

function compareIsoDesc(left: string | null, right: string | null): number {
  if (left && right) {
    return right.localeCompare(left);
  }
  if (left) {
    return -1;
  }
  if (right) {
    return 1;
  }
  return 0;
}

function deriveCurrentIssueKey(params: {
  repo: RepoRef;
  operatorSnapshot?: OpenClawCodeOperatorStatusSnapshot;
}): string | null {
  const currentRun = params.operatorSnapshot?.currentRun;
  if (
    !currentRun ||
    currentRun.request.owner !== params.repo.owner ||
    currentRun.request.repo !== params.repo.repo
  ) {
    return null;
  }
  return formatIssueKey({
    owner: currentRun.request.owner,
    repo: currentRun.request.repo,
    issueNumber: currentRun.request.issueNumber,
  });
}

function buildHistoryTail(run: WorkflowRun | undefined): string[] {
  if (!run) {
    return [];
  }
  return run.history
    .map((entry) => normalizeSingleLine(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(-HISTORY_TAIL_LIMIT);
}

function buildEntryFromSnapshot(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  repoKey: string;
  currentIssueKey: string | null;
  run?: WorkflowRun;
  runsDir: string;
}): ProjectWorkflowHistoryEntry {
  const { snapshot, repoKey, currentIssueKey, run, runsDir } = params;
  return {
    issueKey: snapshot.issueKey,
    repoKey,
    runId: snapshot.runId ?? run?.id ?? null,
    source: snapshot.issueKey === currentIssueKey ? "current-run" : "issue-snapshot",
    currentSessionFirst: snapshot.issueKey === currentIssueKey,
    title: run?.issue.title ?? null,
    stage: snapshot.stage ?? run?.stage ?? null,
    statusSummary: normalizeSingleLine(snapshot.status),
    createdAt: run?.createdAt ?? null,
    updatedAt: snapshot.updatedAt ?? run?.updatedAt ?? null,
    branchName: snapshot.branchName ?? run?.workspace?.branchName ?? null,
    worktreePath: snapshot.worktreePath ?? run?.workspace?.worktreePath ?? null,
    pullRequestNumber: snapshot.pullRequestNumber ?? run?.draftPullRequest?.number ?? null,
    pullRequestUrl: snapshot.pullRequestUrl ?? run?.draftPullRequest?.url ?? null,
    qualityGateStatus: snapshot.qualityGateStatus ?? null,
    qualityGateSummary: snapshot.qualityGateSummary ?? null,
    loopHealthStatus: snapshot.loopHealthStatus ?? null,
    loopHealthSummary: snapshot.loopHealthSummary ?? null,
    latestReviewDecision: snapshot.latestReviewDecision ?? null,
    rerunReason: snapshot.rerunReason ?? run?.rerunContext?.reason ?? null,
    historyEventCount: run?.history.length ?? 0,
    historyTail: buildHistoryTail(run),
    runArtifactPath: snapshot.runId ? path.join(runsDir, `${snapshot.runId}.json`) : null,
  };
}

function buildEntryFromRun(params: {
  run: WorkflowRun;
  repoKey: string;
  currentIssueKey: string | null;
  runsDir: string;
}): ProjectWorkflowHistoryEntry {
  const { run, repoKey, currentIssueKey, runsDir } = params;
  const qualityGate = deriveWorkflowQualityGate(run);
  const loopHealth = deriveWorkflowLoopHealth(run);
  const issueKey = formatIssueKey({
    owner: run.issue.owner,
    repo: run.issue.repo,
    issueNumber: run.issue.number,
  });
  return {
    issueKey,
    repoKey,
    runId: run.id,
    source: issueKey === currentIssueKey ? "current-run" : "workflow-run",
    currentSessionFirst: issueKey === currentIssueKey,
    title: run.issue.title,
    stage: run.stage,
    statusSummary: normalizeSingleLine(run.history.at(-1)),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    branchName: run.workspace?.branchName ?? null,
    worktreePath: run.workspace?.worktreePath ?? null,
    pullRequestNumber: run.draftPullRequest?.number ?? null,
    pullRequestUrl: run.draftPullRequest?.url ?? null,
    qualityGateStatus: qualityGate.status,
    qualityGateSummary: qualityGate.summary,
    loopHealthStatus: loopHealth.status,
    loopHealthSummary: loopHealth.summary,
    latestReviewDecision: run.rerunContext?.reviewDecision ?? null,
    rerunReason: run.rerunContext?.reason ?? null,
    historyEventCount: run.history.length,
    historyTail: buildHistoryTail(run),
    runArtifactPath: path.join(runsDir, `${run.id}.json`),
  };
}

function sortHistoryEntries(entries: ProjectWorkflowHistoryEntry[]): ProjectWorkflowHistoryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.currentSessionFirst !== right.currentSessionFirst) {
      return left.currentSessionFirst ? -1 : 1;
    }
    const updatedCompare = compareIsoDesc(left.updatedAt, right.updatedAt);
    if (updatedCompare !== 0) {
      return updatedCompare;
    }
    const createdCompare = compareIsoDesc(left.createdAt, right.createdAt);
    if (createdCompare !== 0) {
      return createdCompare;
    }
    return left.issueKey.localeCompare(right.issueKey);
  });
}

export async function writeProjectWorkflowHistoryArtifact(params: {
  repoRoot: string;
  repo?: RepoRef;
  operatorSnapshot?: OpenClawCodeOperatorStatusSnapshot;
  limit?: number;
}): Promise<ProjectWorkflowHistoryArtifact> {
  const repoRoot = path.resolve(params.repoRoot);
  const artifactPath = resolveProjectWorkflowHistoryArtifactPath(repoRoot);
  const runsDir = resolveWorkflowRunsDir(repoRoot);
  const limit = Math.max(1, Math.trunc(params.limit ?? DEFAULT_WORKFLOW_HISTORY_LIMIT));
  const repoKey = params.repo ? formatRepoKey(params.repo) : null;
  const projectScoped = Boolean(params.repo);
  const currentIssueKey =
    params.repo && params.operatorSnapshot
      ? deriveCurrentIssueKey({
          repo: params.repo,
          operatorSnapshot: params.operatorSnapshot,
        })
      : null;

  const runStore = new FileSystemWorkflowRunStore(runsDir);
  const workflowRuns = (await runStore.list())
    .filter(
      (run) =>
        !params.repo ||
        (run.issue.owner === params.repo.owner && run.issue.repo === params.repo.repo),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const runsById = new Map(workflowRuns.map((run) => [run.id, run]));

  const snapshots =
    params.repo && params.operatorSnapshot
      ? params.operatorSnapshot.issueSnapshots.filter(
          (snapshot) => snapshot.owner === params.repo?.owner && snapshot.repo === params.repo?.repo,
        )
      : [];

  const consumedRunIds = new Set<string>();
  const entries: ProjectWorkflowHistoryEntry[] = [];

  for (const snapshot of snapshots) {
    const run = snapshot.runId ? runsById.get(snapshot.runId) : undefined;
    if (run) {
      consumedRunIds.add(run.id);
    }
    entries.push(
      buildEntryFromSnapshot({
        snapshot,
        repoKey: repoKey ?? `${snapshot.owner}/${snapshot.repo}`,
        currentIssueKey,
        run,
        runsDir,
      }),
    );
  }

  for (const run of workflowRuns) {
    if (consumedRunIds.has(run.id)) {
      continue;
    }
    entries.push(
      buildEntryFromRun({
        run,
        repoKey: repoKey ?? formatRepoKey({ owner: run.issue.owner, repo: run.issue.repo }),
        currentIssueKey,
        runsDir,
      }),
    );
  }

  const sortedEntries = sortHistoryEntries(entries).slice(0, limit);
  const artifact: ProjectWorkflowHistoryArtifact = {
    repoRoot,
    artifactPath,
    exists: true,
    schemaVersion: PROJECT_WORKFLOW_HISTORY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoKey,
    projectScoped,
    currentIssueKey,
    currentSessionEntryCount: sortedEntries.filter((entry) => entry.currentSessionFirst).length,
    entryCount: sortedEntries.length,
    sourceCounts: {
      currentRun: sortedEntries.filter((entry) => entry.source === "current-run").length,
      issueSnapshot: sortedEntries.filter((entry) => entry.source === "issue-snapshot").length,
      workflowRun: sortedEntries.filter((entry) => entry.source === "workflow-run").length,
    },
    limit,
    entries: sortedEntries,
  };

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectWorkflowHistoryArtifact(
  repoRootInput: string,
): Promise<ProjectWorkflowHistoryArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectWorkflowHistoryArtifactPath(repoRoot);
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
      generatedAt: null,
      repoKey: null,
      projectScoped: false,
      currentIssueKey: null,
      currentSessionEntryCount: 0,
      entryCount: 0,
      sourceCounts: {
        currentRun: 0,
        issueSnapshot: 0,
        workflowRun: 0,
      },
      limit: DEFAULT_WORKFLOW_HISTORY_LIMIT,
      entries: [],
    };
  }

  const parsed = JSON.parse(raw) as Partial<ProjectWorkflowHistoryArtifact>;
  return {
    repoRoot,
    artifactPath,
    exists: parsed.exists ?? true,
    schemaVersion: parsed.schemaVersion ?? PROJECT_WORKFLOW_HISTORY_SCHEMA_VERSION,
    generatedAt: parsed.generatedAt ?? null,
    repoKey: parsed.repoKey ?? null,
    projectScoped: parsed.projectScoped ?? false,
    currentIssueKey: parsed.currentIssueKey ?? null,
    currentSessionEntryCount: parsed.currentSessionEntryCount ?? 0,
    entryCount: parsed.entryCount ?? 0,
    sourceCounts: {
      currentRun: parsed.sourceCounts?.currentRun ?? 0,
      issueSnapshot: parsed.sourceCounts?.issueSnapshot ?? 0,
      workflowRun: parsed.sourceCounts?.workflowRun ?? 0,
    },
    limit: parsed.limit ?? DEFAULT_WORKFLOW_HISTORY_LIMIT,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}
