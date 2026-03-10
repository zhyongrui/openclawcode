import { describe, expect, it } from "vitest";
import { syncIssueSnapshotFromGitHub } from "../../integrations/openclaw-plugin/index.js";
import type { IssueRef } from "../contracts/index.js";
import type {
  GitHubIssueClient,
  GitHubIssueState,
  GitHubPullRequestState,
  PullRequestRef,
  RepoRef,
} from "../github/index.js";

class FakeGitHubClient implements GitHubIssueClient {
  constructor(private readonly pullRequest: GitHubPullRequestState) {}

  async fetchIssue(_ref: RepoRef & { issueNumber: number }): Promise<IssueRef> {
    throw new Error("not used");
  }

  async fetchIssueState(): Promise<GitHubIssueState> {
    return { state: "open" };
  }

  async fetchPullRequest(): Promise<GitHubPullRequestState> {
    return this.pullRequest;
  }

  async createDraftPullRequest(): Promise<PullRequestRef> {
    throw new Error("not used");
  }

  async markPullRequestReadyForReview(): Promise<void> {
    throw new Error("not used");
  }

  async mergePullRequest(): Promise<void> {
    throw new Error("not used");
  }

  async closeIssue(): Promise<void> {
    throw new Error("not used");
  }
}

describe("openclaw plugin GitHub snapshot sync", () => {
  it("upgrades ready-for-review snapshots to merged when GitHub reports a merged PR", async () => {
    const result = await syncIssueSnapshotFromGitHub({
      snapshot: {
        issueKey: "zhyongrui/openclawcode#401",
        status: "openclawcode status for zhyongrui/openclawcode#401\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-401",
        updatedAt: "2026-03-10T09:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 401,
        branchName: "openclawcode/issue-401",
        pullRequestNumber: 501,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/501",
      },
      github: new FakeGitHubClient({
        number: 501,
        url: "https://github.com/zhyongrui/openclawcode/pull/501",
        state: "closed",
        draft: false,
        merged: true,
        mergedAt: "2026-03-10T09:05:00.000Z",
      }),
    });

    expect(result.changed).toBe(true);
    expect(result.snapshot.stage).toBe("merged");
    expect(result.snapshot.updatedAt).toBe("2026-03-10T09:05:00.000Z");
    expect(result.snapshot.status).toContain("Stage: Merged");
  });

  it("leaves snapshots unchanged when the pull request is still open", async () => {
    const snapshot = {
      issueKey: "zhyongrui/openclawcode#402",
      status: "Queued.",
      stage: "draft-pr-opened" as const,
      runId: "run-402",
      updatedAt: "2026-03-10T09:00:00.000Z",
      owner: "zhyongrui",
      repo: "openclawcode",
      issueNumber: 402,
      pullRequestNumber: 502,
      pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/502",
    };

    const result = await syncIssueSnapshotFromGitHub({
      snapshot,
      github: new FakeGitHubClient({
        number: 502,
        url: "https://github.com/zhyongrui/openclawcode/pull/502",
        state: "open",
        draft: false,
        merged: false,
      }),
    });

    expect(result.changed).toBe(false);
    expect(result.snapshot).toEqual(snapshot);
  });
});
