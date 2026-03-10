import path from "node:path";
import { FileSystemWorkflowRunStore, type WorkflowRun } from "../../openclawcode/index.js";
import type { OpenClawCodeChatopsRepoConfig } from "./chatops.js";
import { buildRunStatusMessage, formatIssueKey } from "./chatops.js";

export interface LocalRunStatusRecord {
  issueKey: string;
  status: string;
  updatedAt: string;
  run: WorkflowRun;
}

function compareWorkflowRuns(left: WorkflowRun, right: WorkflowRun): number {
  const updatedComparison = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedComparison !== 0) {
    return updatedComparison;
  }
  return left.createdAt.localeCompare(right.createdAt);
}

function issueMatchesRepo(run: WorkflowRun, repo: OpenClawCodeChatopsRepoConfig): boolean {
  return (
    run.issue.owner.toLowerCase() === repo.owner.toLowerCase() &&
    run.issue.repo.toLowerCase() === repo.repo.toLowerCase()
  );
}

export async function collectLatestLocalRunStatuses(
  repo: OpenClawCodeChatopsRepoConfig,
): Promise<LocalRunStatusRecord[]> {
  const store = new FileSystemWorkflowRunStore(path.join(repo.repoRoot, ".openclawcode", "runs"));
  const runs = await store.list();
  const latestByIssue = new Map<string, WorkflowRun>();

  for (const run of runs) {
    if (!issueMatchesRepo(run, repo)) {
      continue;
    }
    const issueKey = formatIssueKey(run.issue);
    const current = latestByIssue.get(issueKey);
    if (!current || compareWorkflowRuns(current, run) < 0) {
      latestByIssue.set(issueKey, run);
    }
  }

  return Array.from(latestByIssue.entries())
    .map(([issueKey, run]) => ({
      issueKey,
      status: buildRunStatusMessage(run),
      updatedAt: run.updatedAt,
      run,
    }))
    .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

export async function findLatestLocalRunStatusForIssue(params: {
  repo: OpenClawCodeChatopsRepoConfig;
  issueKey: string;
}): Promise<LocalRunStatusRecord | undefined> {
  const records = await collectLatestLocalRunStatuses(params.repo);
  return records.find((record) => record.issueKey === params.issueKey);
}
