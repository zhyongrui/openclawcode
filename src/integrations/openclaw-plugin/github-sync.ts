import {
  GitHubRestClient,
  type GitHubIssueClient,
  type GitHubPullRequestState,
} from "../../openclawcode/github/index.js";
import type { OpenClawCodeIssueStatusSnapshot } from "./store.js";

function formatMergedStatus(
  snapshot: OpenClawCodeIssueStatusSnapshot,
  pullRequest: GitHubPullRequestState,
): string {
  const lines = [
    `openclawcode status for ${snapshot.issueKey}`,
    "Stage: Merged",
    "Summary: Pull request was merged on GitHub after the latest local workflow run.",
    `PR: ${pullRequest.url}`,
  ];
  return lines.join("\n");
}

export interface GitHubStatusSyncResult {
  changed: boolean;
  snapshot: OpenClawCodeIssueStatusSnapshot;
}

export async function syncIssueSnapshotFromGitHub(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  github?: GitHubIssueClient;
}): Promise<GitHubStatusSyncResult> {
  const github = params.github ?? new GitHubRestClient();
  const { snapshot } = params;

  if (!snapshot.pullRequestNumber || snapshot.stage === "merged") {
    return {
      changed: false,
      snapshot,
    };
  }

  const pullRequest = await github.fetchPullRequest({
    owner: snapshot.owner,
    repo: snapshot.repo,
    pullNumber: snapshot.pullRequestNumber,
  });
  if (!pullRequest.merged) {
    return {
      changed: false,
      snapshot,
    };
  }

  return {
    changed: true,
    snapshot: {
      ...snapshot,
      stage: "merged",
      status: formatMergedStatus(snapshot, pullRequest),
      updatedAt: pullRequest.mergedAt ?? snapshot.updatedAt,
      pullRequestUrl: pullRequest.url,
    },
  };
}
