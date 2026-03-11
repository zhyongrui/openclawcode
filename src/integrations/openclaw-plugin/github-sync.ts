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

function formatChangesRequestedStatus(snapshot: OpenClawCodeIssueStatusSnapshot): string {
  return [
    `openclawcode status for ${snapshot.issueKey}`,
    "Stage: Changes Requested",
    "Summary: GitHub pull request review requested changes after the latest local workflow run.",
    snapshot.pullRequestUrl ? `PR: ${snapshot.pullRequestUrl}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatApprovedReviewStatus(snapshot: OpenClawCodeIssueStatusSnapshot): string {
  return [
    `openclawcode status for ${snapshot.issueKey}`,
    "Stage: Ready For Human Review",
    "Summary: GitHub pull request review approved the pull request after the latest local workflow run.",
    snapshot.pullRequestUrl ? `PR: ${snapshot.pullRequestUrl}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
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
    const review = await github.fetchLatestPullRequestReview({
      owner: snapshot.owner,
      repo: snapshot.repo,
      pullNumber: snapshot.pullRequestNumber,
    });
    if (!review) {
      return {
        changed: false,
        snapshot,
      };
    }
    if (review.decision === "changes-requested" && snapshot.stage !== "changes-requested") {
      return {
        changed: true,
        snapshot: {
          ...snapshot,
          stage: "changes-requested",
          status: formatChangesRequestedStatus(snapshot),
          updatedAt: review.submittedAt ?? snapshot.updatedAt,
          pullRequestUrl: pullRequest.url,
        },
      };
    }
    if (review.decision === "approved" && snapshot.stage === "changes-requested") {
      return {
        changed: true,
        snapshot: {
          ...snapshot,
          stage: "ready-for-human-review",
          status: formatApprovedReviewStatus(snapshot),
          updatedAt: review.submittedAt ?? snapshot.updatedAt,
          pullRequestUrl: pullRequest.url,
        },
      };
    }
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
