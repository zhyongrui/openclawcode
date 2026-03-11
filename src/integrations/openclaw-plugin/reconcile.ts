import path from "node:path";
import type { WorkflowRun } from "../../openclawcode/contracts/index.js";
import { FileSystemWorkflowRunStore } from "../../openclawcode/persistence/index.js";
import type { OpenClawCodeChatopsRepoConfig } from "./chatops.js";
import { buildRunStatusMessage, formatIssueKey } from "./chatops.js";

export interface LocalRunStatusRecord {
  issueKey: string;
  status: string;
  updatedAt: string;
  run: WorkflowRun;
}

function hasPullRequestMetadata(run: WorkflowRun): boolean {
  return Boolean(run.draftPullRequest?.number || run.draftPullRequest?.url);
}

function resolveRunBranchName(run: WorkflowRun): string | undefined {
  return (
    run.workspace?.branchName ?? run.buildResult?.branchName ?? run.draftPullRequest?.branchName
  );
}

function recoverPullRequestMetadata(latest: WorkflowRun, candidate: WorkflowRun): WorkflowRun {
  if (hasPullRequestMetadata(latest) || !hasPullRequestMetadata(candidate)) {
    return latest;
  }

  const latestBranchName = resolveRunBranchName(latest);
  const candidateBranchName = resolveRunBranchName(candidate);
  if (latestBranchName && candidateBranchName && latestBranchName !== candidateBranchName) {
    return latest;
  }

  return {
    ...latest,
    draftPullRequest: latest.draftPullRequest
      ? {
          ...latest.draftPullRequest,
          number: latest.draftPullRequest.number ?? candidate.draftPullRequest?.number,
          url: latest.draftPullRequest.url ?? candidate.draftPullRequest?.url,
          openedAt: latest.draftPullRequest.openedAt ?? candidate.draftPullRequest?.openedAt,
        }
      : candidate.draftPullRequest,
  };
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
  const latestWithPullRequestByIssue = new Map<string, WorkflowRun>();

  for (const run of runs) {
    if (!issueMatchesRepo(run, repo)) {
      continue;
    }
    const issueKey = formatIssueKey(run.issue);
    const current = latestByIssue.get(issueKey);
    if (!current || compareWorkflowRuns(current, run) < 0) {
      latestByIssue.set(issueKey, run);
    }
    if (hasPullRequestMetadata(run)) {
      const currentWithPullRequest = latestWithPullRequestByIssue.get(issueKey);
      if (!currentWithPullRequest || compareWorkflowRuns(currentWithPullRequest, run) < 0) {
        latestWithPullRequestByIssue.set(issueKey, run);
      }
    }
  }

  return Array.from(latestByIssue.entries())
    .map(([issueKey, run]) => {
      const recoveredRun = recoverPullRequestMetadata(
        run,
        latestWithPullRequestByIssue.get(issueKey) ?? run,
      );
      return {
        issueKey,
        status: buildRunStatusMessage(recoveredRun),
        updatedAt: recoveredRun.updatedAt,
        run: recoveredRun,
      };
    })
    .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

export async function findLatestLocalRunStatusForIssue(params: {
  repo: OpenClawCodeChatopsRepoConfig;
  issueKey: string;
}): Promise<LocalRunStatusRecord | undefined> {
  const records = await collectLatestLocalRunStatuses(params.repo);
  return records.find((record) => record.issueKey === params.issueKey);
}
