import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun } from "../openclawcode/index.js";
import { openclawCodeRunCommand } from "./openclawcode.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const mocks = vi.hoisted(() => {
  return {
    resolveGitHubRepoFromGit: vi.fn(),
    runIssueWorkflow: vi.fn(),
  };
});

vi.mock("../openclawcode/index.js", async () => {
  return {
    resolveGitHubRepoFromGit: mocks.resolveGitHubRepoFromGit,
    runIssueWorkflow: mocks.runIssueWorkflow,
    HostShellRunner: class {},
    GitWorktreeManager: class {},
    GitHubRestClient: class {},
    HeuristicPlanner: class {},
    OpenClawAgentRunner: class {},
    AgentBackedBuilder: class {},
    AgentBackedVerifier: class {},
    FileSystemWorkflowRunStore: class {},
  };
});

describe("openclawCodeRunCommand", () => {
  const runtime = createTestRuntime();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveGitHubRepoFromGit.mockResolvedValue({ owner: "openclaw", repo: "openclaw" });
    mocks.runIssueWorkflow.mockResolvedValue(createRun());
  });

  it("prints stable top-level JSON fields for workflow scope, pr metadata, review, and merge policy", async () => {
    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.stage).toBe("ready-for-human-review");
    expect(payload.stageLabel).toBe("Ready For Human Review");
    expect(payload.changedFiles).toEqual([
      "src/openclawcode/app/run-issue.ts",
      "src/openclawcode/contracts/types.ts",
    ]);
    expect(payload.changeDisposition).toBe("modified");
    expect(payload.changeDispositionReason).toBe("Run produced 2 changed file(s).");
    expect(payload.buildResult.changedFiles).toEqual(payload.changedFiles);
    expect(payload.issueClassification).toBe("command-layer");
    expect(payload.scopeCheck).toEqual({
      ok: true,
      blockedFiles: [],
      summary: "Scope check passed for command-layer issue.",
    });
    expect(payload.buildResult.issueClassification).toBe(payload.issueClassification);
    expect(payload.buildResult.scopeCheck).toEqual(payload.scopeCheck);
    expect(payload.draftPullRequestBranchName).toBe("openclawcode/issue-2");
    expect(payload.draftPullRequestBaseBranch).toBe("main");
    expect(payload.draftPullRequestNumber).toBe(42);
    expect(payload.draftPullRequestUrl).toBe("https://github.com/openclaw/openclaw/pull/42");
    expect(payload.draftPullRequest.branchName).toBe(payload.draftPullRequestBranchName);
    expect(payload.draftPullRequest.baseBranch).toBe(payload.draftPullRequestBaseBranch);
    expect(payload.draftPullRequest.number).toBe(payload.draftPullRequestNumber);
    expect(payload.draftPullRequest.url).toBe(payload.draftPullRequestUrl);
    expect(payload.draftPullRequestDisposition).toBe("published");
    expect(payload.draftPullRequestDispositionReason).toBe(
      "Draft PR opened: https://github.com/openclaw/openclaw/pull/42",
    );
    expect(payload.pullRequestPublished).toBe(true);
    expect(payload.publishedPullRequestOpenedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.pullRequestMerged).toBe(false);
    expect(payload.mergedPullRequestMergedAt).toBeNull();
    expect(payload.verificationDecision).toBe("approve-for-human-review");
    expect(payload.verificationSummary).toBe(
      "Verification completed and the run is ready for human review.",
    );
    expect(payload.verificationFindingCount).toBe(0);
    expect(payload.verificationMissingCoverageCount).toBe(0);
    expect(payload.verificationFollowUpCount).toBe(0);
    expect(payload.runSummary).toBe(payload.verificationSummary);
    expect(payload.autoMergeDisposition).toBeNull();
    expect(payload.autoMergeDispositionReason).toBeNull();
    expect(payload.verificationReport.decision).toBe(payload.verificationDecision);
    expect(payload.verificationReport.summary).toBe(payload.verificationSummary);
    expect(payload.autoMergePolicyEligible).toBe(true);
    expect(payload.autoMergePolicyReason).toBe(
      "Eligible for auto-merge under the current command-layer policy.",
    );
  });

  it("prints empty top-level scope fields and blocks auto-merge when workflow data is missing", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "draft-pr-opened",
        buildResult: undefined,
        draftPullRequest: undefined,
        verificationReport: undefined,
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.changedFiles).toEqual([]);
    expect(payload.changeDisposition).toBeNull();
    expect(payload.changeDispositionReason).toBeNull();
    expect(payload.stageLabel).toBe("Draft PR Opened");
    expect(payload.issueClassification).toBeNull();
    expect(payload.scopeCheck).toBeNull();
    expect(payload.draftPullRequestBranchName).toBeNull();
    expect(payload.draftPullRequestBaseBranch).toBeNull();
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestUrl).toBeNull();
    expect(payload.draftPullRequestDisposition).toBeNull();
    expect(payload.draftPullRequestDispositionReason).toBeNull();
    expect(payload.pullRequestPublished).toBe(false);
    expect(payload.publishedPullRequestOpenedAt).toBeNull();
    expect(payload.pullRequestMerged).toBe(false);
    expect(payload.mergedPullRequestMergedAt).toBeNull();
    expect(payload.verificationDecision).toBeNull();
    expect(payload.verificationSummary).toBeNull();
    expect(payload.verificationFindingCount).toBeNull();
    expect(payload.verificationMissingCoverageCount).toBeNull();
    expect(payload.verificationFollowUpCount).toBeNull();
    expect(payload.runSummary).toBe("Run is at the draft-pr-opened stage.");
    expect(payload.autoMergeDisposition).toBeNull();
    expect(payload.autoMergeDispositionReason).toBeNull();
    expect(payload.autoMergePolicyEligible).toBe(false);
    expect(payload.autoMergePolicyReason).toBe(
      "Not eligible for auto-merge: verification has not approved the run.",
    );
  });

  it("keeps unpublished local draft metadata separate from published pr fields", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        draftPullRequest: {
          ...createRun().draftPullRequest!,
          number: undefined,
          url: undefined,
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.draftPullRequestBranchName).toBe("openclawcode/issue-2");
    expect(payload.draftPullRequestBaseBranch).toBe("main");
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestUrl).toBeNull();
    expect(payload.draftPullRequestDisposition).toBeNull();
    expect(payload.draftPullRequestDispositionReason).toBeNull();
    expect(payload.pullRequestPublished).toBe(false);
    expect(payload.publishedPullRequestOpenedAt).toBeNull();
    expect(payload.pullRequestMerged).toBe(false);
    expect(payload.mergedPullRequestMergedAt).toBeNull();
  });

  it("prints skipped draft pr disposition when publication is skipped for a no-op run", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "ready-for-human-review",
        draftPullRequest: {
          ...createRun().draftPullRequest!,
          number: undefined,
          url: undefined,
        },
        buildResult: {
          ...createRun().buildResult!,
          changedFiles: [],
        },
        history: [
          "Build completed and draft PR prepared",
          "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-2.",
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.changedFiles).toEqual([]);
    expect(payload.changeDisposition).toBe("no-op");
    expect(payload.changeDispositionReason).toBe(
      "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-2.",
    );
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestUrl).toBeNull();
    expect(payload.draftPullRequestDisposition).toBe("skipped");
    expect(payload.draftPullRequestDispositionReason).toBe(
      "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-2.",
    );
    expect(payload.pullRequestPublished).toBe(false);
  });

  it("falls back to the build summary when no verification summary exists", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        verificationReport: undefined,
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.autoMergeDisposition).toBeNull();
    expect(payload.autoMergeDispositionReason).toBeNull();
    expect(payload.verificationSummary).toBeNull();
    expect(payload.verificationFindingCount).toBeNull();
    expect(payload.verificationMissingCoverageCount).toBeNull();
    expect(payload.verificationFollowUpCount).toBeNull();
    expect(payload.runSummary).toBe("Updated JSON output");
  });

  it("blocks auto-merge when the build result is outside command-layer scope", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        buildResult: {
          ...createRun().buildResult!,
          issueClassification: "workflow-core",
        },
        history: [
          "Verification approved for human review",
          "Auto-merge skipped: policy requires human review for non-command-layer or failed-scope runs",
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.autoMergeDisposition).toBe("skipped");
    expect(payload.autoMergeDispositionReason).toBe(
      "Auto-merge skipped: policy requires human review for non-command-layer or failed-scope runs",
    );
    expect(payload.autoMergePolicyEligible).toBe(false);
    expect(payload.autoMergePolicyReason).toBe(
      "Not eligible for auto-merge: the run is not classified as command-layer.",
    );
  });

  it("blocks auto-merge when the scope check fails", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        buildResult: {
          ...createRun().buildResult!,
          scopeCheck: {
            ok: false,
            blockedFiles: ["src/openclawcode/orchestrator/run.ts"],
            summary: "Scope check failed for command-layer issue.",
          },
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.autoMergePolicyEligible).toBe(false);
    expect(payload.autoMergePolicyReason).toBe(
      "Not eligible for auto-merge: the scope check did not pass.",
    );
  });

  it("prints verification counts for ready-for-human-review runs", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        verificationReport: {
          decision: "request-changes",
          summary: "Verification found blocking issues.",
          findings: ["Bug one", "Bug two"],
          missingCoverage: ["Missing test one"],
          followUps: ["Add regression coverage", "Fix the blocking bug"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.verificationFindingCount).toBe(2);
    expect(payload.verificationMissingCoverageCount).toBe(1);
    expect(payload.verificationFollowUpCount).toBe(2);
  });

  it("prints failed auto-merge disposition when merge execution fails", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        history: [
          "Verification approved for human review",
          "Auto-merge failed: GitHub token cannot merge pull requests.",
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.autoMergeDisposition).toBe("failed");
    expect(payload.autoMergeDispositionReason).toBe(
      "Auto-merge failed: GitHub token cannot merge pull requests.",
    );
  });

  it("prints merged pr fields when the workflow reaches the merged stage", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "merged",
        history: ["Pull request merged automatically"],
        updatedAt: "2026-01-02T03:04:05.000Z",
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.stageLabel).toBe("Merged");
    expect(payload.pullRequestMerged).toBe(true);
    expect(payload.mergedPullRequestMergedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(payload.autoMergeDisposition).toBe("merged");
    expect(payload.autoMergeDispositionReason).toBe("Pull request merged automatically");
  });

  it("leaves auto-merge disposition empty when the pr was merged without an auto-merge note", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "merged",
        history: ["Pull request merged after manual approval"],
        updatedAt: "2026-01-02T03:04:05.000Z",
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.pullRequestMerged).toBe(true);
    expect(payload.mergedPullRequestMergedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(payload.autoMergeDisposition).toBeNull();
    expect(payload.autoMergeDispositionReason).toBeNull();
  });
});

function createRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run_123",
    stage: "ready-for-human-review",
    issue: {
      owner: "openclaw",
      repo: "openclaw",
      number: 2,
      title: "Include changed file list in JSON output",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attempts: {
      total: 1,
      planning: 1,
      building: 1,
      verifying: 1,
    },
    stageRecords: [],
    workspace: {
      repoRoot: "/repo",
      baseBranch: "main",
      branchName: "openclawcode/issue-2",
      worktreePath: "/repo/.openclawcode/worktrees/issue-2",
      preparedAt: "2026-01-01T00:00:00.000Z",
    },
    draftPullRequest: {
      title: "[Issue #2] Include changed file list in JSON output",
      body: "Draft PR body",
      branchName: "openclawcode/issue-2",
      baseBranch: "main",
      number: 42,
      url: "https://github.com/openclaw/openclaw/pull/42",
      openedAt: "2026-01-01T00:00:00.000Z",
    },
    buildResult: {
      branchName: "openclawcode/issue-2",
      summary: "Updated JSON output",
      changedFiles: ["src/openclawcode/app/run-issue.ts", "src/openclawcode/contracts/types.ts"],
      issueClassification: "command-layer",
      scopeCheck: {
        ok: true,
        blockedFiles: [],
        summary: "Scope check passed for command-layer issue.",
      },
      testCommands: ["vitest run"],
      testResults: ["passed"],
      notes: [],
    },
    verificationReport: {
      decision: "approve-for-human-review",
      summary: "Verification completed and the run is ready for human review.",
      findings: [],
      missingCoverage: [],
      followUps: [],
    },
    history: ["Draft PR opened: https://github.com/openclaw/openclaw/pull/42"],
    ...overrides,
  };
}
