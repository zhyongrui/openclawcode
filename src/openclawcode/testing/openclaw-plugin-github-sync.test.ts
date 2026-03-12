import { describe, expect, it } from "vitest";
import { syncIssueSnapshotFromGitHub } from "../../integrations/openclaw-plugin/index.js";
import type { IssueRef } from "../contracts/index.js";
import type {
  GitHubIssueClient,
  GitHubIssueState,
  GitHubPullRequestState,
  GitHubPullRequestReviewState,
  PullRequestRef,
  RepoRef,
} from "../github/index.js";

class FakeGitHubClient implements GitHubIssueClient {
  constructor(
    private readonly pullRequest: GitHubPullRequestState,
    private readonly review?: GitHubPullRequestReviewState,
  ) {}

  async fetchIssue(_ref: RepoRef & { issueNumber: number }): Promise<IssueRef> {
    throw new Error("not used");
  }

  async createIssue(
    ref: RepoRef & { title: string; body: string },
  ): Promise<IssueRef & { url: string }> {
    return {
      owner: ref.owner,
      repo: ref.repo,
      number: 999,
      title: ref.title,
      body: ref.body,
      labels: [],
      url: `https://github.com/${ref.owner}/${ref.repo}/issues/999`,
    };
  }

  async listIssues(): Promise<Array<IssueRef & { url: string; state: "open" | "closed" }>> {
    return [];
  }

  async fetchIssueState(): Promise<GitHubIssueState> {
    return { state: "open" };
  }

  async fetchPullRequest(): Promise<GitHubPullRequestState> {
    return this.pullRequest;
  }

  async fetchLatestPullRequestReview(): Promise<GitHubPullRequestReviewState | undefined> {
    return this.review;
  }

  async findOpenPullRequestForBranch(): Promise<PullRequestRef | undefined> {
    throw new Error("not used");
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

  it("escalates snapshots when the pull request was closed without merge", async () => {
    const result = await syncIssueSnapshotFromGitHub({
      snapshot: {
        issueKey: "zhyongrui/openclawcode#405",
        status: "openclawcode status for zhyongrui/openclawcode#405\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-405",
        updatedAt: "2026-03-10T10:10:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 405,
        branchName: "openclawcode/issue-405",
        pullRequestNumber: 505,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/505",
      },
      github: new FakeGitHubClient({
        number: 505,
        url: "https://github.com/zhyongrui/openclawcode/pull/505",
        state: "closed",
        draft: false,
        merged: false,
      }),
    });

    expect(result.changed).toBe(true);
    expect(result.snapshot.stage).toBe("escalated");
    expect(result.snapshot.status).toContain("Stage: Escalated");
  });

  it("downgrades ready-for-review snapshots to changes-requested when GitHub review requests changes", async () => {
    const result = await syncIssueSnapshotFromGitHub({
      snapshot: {
        issueKey: "zhyongrui/openclawcode#403",
        status: "openclawcode status for zhyongrui/openclawcode#403\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-403",
        updatedAt: "2026-03-10T10:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 403,
        branchName: "openclawcode/issue-403",
        pullRequestNumber: 503,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/503",
      },
      github: new FakeGitHubClient(
        {
          number: 503,
          url: "https://github.com/zhyongrui/openclawcode/pull/503",
          state: "open",
          draft: false,
          merged: false,
        },
        {
          decision: "changes-requested",
          submittedAt: "2026-03-10T10:05:00.000Z",
        },
      ),
    });

    expect(result.changed).toBe(true);
    expect(result.snapshot.stage).toBe("changes-requested");
    expect(result.snapshot.updatedAt).toBe("2026-03-10T10:05:00.000Z");
    expect(result.snapshot.status).toContain("Stage: Changes Requested");
  });

  it("upgrades changes-requested snapshots back to ready-for-human-review when GitHub review approves", async () => {
    const result = await syncIssueSnapshotFromGitHub({
      snapshot: {
        issueKey: "zhyongrui/openclawcode#404",
        status: "openclawcode status for zhyongrui/openclawcode#404\nStage: Changes Requested",
        stage: "changes-requested",
        runId: "run-404",
        updatedAt: "2026-03-10T10:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 404,
        branchName: "openclawcode/issue-404",
        pullRequestNumber: 504,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/504",
      },
      github: new FakeGitHubClient(
        {
          number: 504,
          url: "https://github.com/zhyongrui/openclawcode/pull/504",
          state: "open",
          draft: false,
          merged: false,
        },
        {
          decision: "approved",
          submittedAt: "2026-03-10T10:07:00.000Z",
        },
      ),
    });

    expect(result.changed).toBe(true);
    expect(result.snapshot.stage).toBe("ready-for-human-review");
    expect(result.snapshot.updatedAt).toBe("2026-03-10T10:07:00.000Z");
    expect(result.snapshot.status).toContain("Stage: Ready For Human Review");
  });
});
