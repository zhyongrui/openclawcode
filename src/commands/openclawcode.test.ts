import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun } from "../openclawcode/index.js";
import {
  openclawCodeListValidationIssuesCommand,
  openclawCodeRunCommand,
  openclawCodeSeedValidationIssueCommand,
  openclawCodeSeedValidationIssueTemplateIds,
} from "./openclawcode.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const mocks = vi.hoisted(() => {
  return {
    resolveGitHubRepoFromGit: vi.fn(),
    runIssueWorkflow: vi.fn(),
    createIssue: vi.fn(),
    listIssues: vi.fn(),
  };
});

vi.mock("../openclawcode/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openclawcode/index.js")>();
  class MockGitHubRestClient {
    createIssue = mocks.createIssue;
    listIssues = mocks.listIssues;
  }
  return {
    ...actual,
    resolveGitHubRepoFromGit: mocks.resolveGitHubRepoFromGit,
    runIssueWorkflow: mocks.runIssueWorkflow,
    HostShellRunner: class {},
    GitWorktreeManager: class {},
    GitHubRestClient: MockGitHubRestClient,
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
    mocks.createIssue.mockResolvedValue({
      owner: "openclaw",
      repo: "openclaw",
      number: 99,
      title: "Seeded validation issue",
      body: "Seeded validation issue body",
      labels: [],
      url: "https://github.com/openclaw/openclaw/issues/99",
    });
    mocks.listIssues.mockResolvedValue([
      {
        owner: "openclaw",
        repo: "openclaw",
        number: 99,
        title:
          "[Feature]: Expose verificationHasMissingCoverage in openclaw code run --json output",
        body: [
          "Summary",
          "Add one stable top-level boolean field to `openclaw code run --json` named `verificationHasMissingCoverage`.",
          "",
          "Proposed solution",
          "Update `src/commands/openclawcode.ts` so the JSON output includes `verificationHasMissingCoverage: boolean`.",
        ].join("\n"),
        labels: [],
        url: "https://github.com/openclaw/openclaw/issues/99",
        state: "open",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
      {
        owner: "openclaw",
        repo: "openclaw",
        number: 100,
        title: "[Docs]: Clarify copied-root teardown expectations after fresh-operator validation",
        body: [
          "Summary",
          "copied-root teardown expectations after fresh-operator validation",
          "",
          "- keep the change docs-only",
          "- avoid broad rewrites outside the named document",
        ].join("\n"),
        labels: [],
        url: "https://github.com/openclaw/openclaw/issues/100",
        state: "open",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
      {
        owner: "openclaw",
        repo: "openclaw",
        number: 101,
        title: "Unrelated issue",
        body: "Not a validation issue.",
        labels: [],
        url: "https://github.com/openclaw/openclaw/issues/101",
        state: "open",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
    ]);
  });

  it("prints stable top-level JSON fields for workflow scope, pr metadata, review, and merge policy", async () => {
    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.stage).toBe("ready-for-human-review");
    expect(payload.stageLabel).toBe("Ready For Human Review");
    expect(payload.totalAttemptCount).toBe(1);
    expect(payload.planningAttemptCount).toBe(1);
    expect(payload.buildAttemptCount).toBe(1);
    expect(payload.verificationAttemptCount).toBe(1);
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
    expect(payload.scopeCheckSummary).toBe("Scope check passed for command-layer issue.");
    expect(payload.scopeCheckPassed).toBe(true);
    expect(payload.scopeCheckHasBlockedFiles).toBe(false);
    expect(payload.scopeBlockedFiles).toEqual([]);
    expect(payload.scopeBlockedFileCount).toBe(0);
    expect(payload.buildResult.issueClassification).toBe(payload.issueClassification);
    expect(payload.buildResult.scopeCheck).toEqual(payload.scopeCheck);
    expect(payload.suitabilityDecision).toBe("auto-run");
    expect(payload.suitabilitySummary).toBe(
      "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
    );
    expect(payload.suitabilityReasons).toEqual([
      "Issue stays within command-layer scope.",
      "Planner risk level is medium.",
      "No high-risk issue signals were detected in the issue text or labels.",
    ]);
    expect(payload.suitabilityClassification).toBe("command-layer");
    expect(payload.suitabilityRiskLevel).toBe("medium");
    expect(payload.suitabilityEvaluatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.draftPullRequestBranchName).toBe("openclawcode/issue-2");
    expect(payload.draftPullRequestBaseBranch).toBe("main");
    expect(payload.draftPullRequestNumber).toBe(42);
    expect(payload.publishedPullRequestNumber).toBe(42);
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
    expect(payload.verificationApprovedForHumanReview).toBe(true);
    expect(payload.verificationSummary).toBe(
      "Verification completed and the run is ready for human review.",
    );
    expect(payload.verificationHasFindings).toBe(false);
    expect(payload.verificationHasMissingCoverage).toBe(false);
    expect(payload.verificationHasSignals).toBe(false);
    expect(payload.verificationHasFollowUps).toBe(false);
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
    expect(payload.totalAttemptCount).toBe(1);
    expect(payload.planningAttemptCount).toBe(1);
    expect(payload.buildAttemptCount).toBe(1);
    expect(payload.verificationAttemptCount).toBe(1);
    expect(payload.changedFiles).toEqual([]);
    expect(payload.changeDisposition).toBeNull();
    expect(payload.changeDispositionReason).toBeNull();
    expect(payload.stageLabel).toBe("Draft PR Opened");
    expect(payload.issueClassification).toBeNull();
    expect(payload.scopeCheck).toBeNull();
    expect(payload.scopeCheckSummary).toBeNull();
    expect(payload.scopeCheckPassed).toBeNull();
    expect(payload.scopeCheckHasBlockedFiles).toBe(false);
    expect(payload.scopeBlockedFiles).toBeNull();
    expect(payload.scopeBlockedFileCount).toBeNull();
    expect(payload.suitabilityDecision).toBe("auto-run");
    expect(payload.suitabilitySummary).toBe(
      "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
    );
    expect(payload.draftPullRequestBranchName).toBeNull();
    expect(payload.draftPullRequestBaseBranch).toBeNull();
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.publishedPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestUrl).toBeNull();
    expect(payload.draftPullRequestDisposition).toBeNull();
    expect(payload.draftPullRequestDispositionReason).toBeNull();
    expect(payload.pullRequestPublished).toBe(false);
    expect(payload.publishedPullRequestOpenedAt).toBeNull();
    expect(payload.pullRequestMerged).toBe(false);
    expect(payload.mergedPullRequestMergedAt).toBeNull();
    expect(payload.verificationDecision).toBeNull();
    expect(payload.verificationApprovedForHumanReview).toBeNull();
    expect(payload.verificationSummary).toBeNull();
    expect(payload.verificationHasFindings).toBe(false);
    expect(payload.verificationHasMissingCoverage).toBe(false);
    expect(payload.verificationHasSignals).toBe(false);
    expect(payload.verificationHasFollowUps).toBe(false);
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

  it("prints null attempt counts when workflow attempt metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        attempts: undefined as unknown as WorkflowRun["attempts"],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.totalAttemptCount).toBeNull();
    expect(payload.planningAttemptCount).toBeNull();
    expect(payload.buildAttemptCount).toBeNull();
    expect(payload.verificationAttemptCount).toBeNull();
  });

  it("reports verificationHasFollowUps when verifier follow-up work exists", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        verificationReport: {
          ...createRun().verificationReport!,
          followUps: ["Add a regression test for the JSON follow-up flag."],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.verificationHasSignals).toBe(true);
    expect(payload.verificationHasFollowUps).toBe(true);
    expect(payload.verificationFollowUpCount).toBe(1);
    expect(payload.verificationReport.followUps).toEqual([
      "Add a regression test for the JSON follow-up flag.",
    ]);
  });

  it("reports verificationHasMissingCoverage when verifier coverage gaps exist", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        verificationReport: {
          ...createRun().verificationReport!,
          missingCoverage: ["Add a regression test for missing coverage output."],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.verificationHasSignals).toBe(true);
    expect(payload.verificationHasMissingCoverage).toBe(true);
    expect(payload.verificationMissingCoverageCount).toBe(1);
    expect(payload.verificationReport.missingCoverage).toEqual([
      "Add a regression test for missing coverage output.",
    ]);
  });

  it("forwards rerun flags into the workflow request and prints stable rerun JSON fields", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        rerunContext: {
          reason: "Address GitHub review feedback",
          requestedAt: "2026-01-02T00:00:00.000Z",
          priorRunId: "run_122",
          priorStage: "changes-requested",
          reviewDecision: "changes-requested",
          reviewSubmittedAt: "2026-01-01T23:59:00.000Z",
          reviewSummary: "Please add a regression test for the rerun path.",
          reviewUrl: "https://github.com/openclaw/openclaw/pull/42#pullrequestreview-9",
        },
      }),
    );

    await openclawCodeRunCommand(
      {
        issue: "2",
        repoRoot: "/repo",
        json: true,
        rerunPriorRunId: "run_122",
        rerunPriorStage: "changes-requested",
        rerunReason: "Address GitHub review feedback",
        rerunRequestedAt: "2026-01-02T00:00:00.000Z",
        rerunReviewDecision: "changes-requested",
        rerunReviewSubmittedAt: "2026-01-01T23:59:00.000Z",
        rerunReviewSummary: "Please add a regression test for the rerun path.",
        rerunReviewUrl: "https://github.com/openclaw/openclaw/pull/42#pullrequestreview-9",
      },
      runtime,
    );

    expect(mocks.runIssueWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        rerunContext: {
          reason: "Address GitHub review feedback",
          requestedAt: "2026-01-02T00:00:00.000Z",
          priorRunId: "run_122",
          priorStage: "changes-requested",
          reviewDecision: "changes-requested",
          reviewSubmittedAt: "2026-01-01T23:59:00.000Z",
          reviewSummary: "Please add a regression test for the rerun path.",
          reviewUrl: "https://github.com/openclaw/openclaw/pull/42#pullrequestreview-9",
        },
      }),
      expect.any(Object),
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.rerunRequested).toBe(true);
    expect(payload.rerunHasReviewContext).toBe(true);
    expect(payload.rerunReason).toBe("Address GitHub review feedback");
    expect(payload.rerunRequestedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(payload.rerunPriorRunId).toBe("run_122");
    expect(payload.rerunPriorStage).toBe("changes-requested");
    expect(payload.rerunReviewDecision).toBe("changes-requested");
    expect(payload.rerunReviewSubmittedAt).toBe("2026-01-01T23:59:00.000Z");
    expect(payload.rerunReviewSummary).toBe("Please add a regression test for the rerun path.");
    expect(payload.rerunReviewUrl).toBe(
      "https://github.com/openclaw/openclaw/pull/42#pullrequestreview-9",
    );
  });

  it("reports false when rerun context does not include review metadata", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        rerunContext: {
          reason: "Retry branch refresh after base promotion",
          requestedAt: "2026-01-03T00:00:00.000Z",
          priorRunId: "run_123",
          priorStage: "planning",
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.rerunRequested).toBe(true);
    expect(payload.rerunHasReviewContext).toBe(false);
    expect(payload.rerunReviewDecision).toBeNull();
    expect(payload.rerunReviewSubmittedAt).toBeNull();
    expect(payload.rerunReviewSummary).toBeNull();
    expect(payload.rerunReviewUrl).toBeNull();
  });

  it("reports false when rerun context is absent", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        rerunContext: undefined,
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.rerunRequested).toBe(false);
    expect(payload.rerunHasReviewContext).toBe(false);
    expect(payload.rerunReviewDecision).toBeNull();
    expect(payload.rerunReviewSubmittedAt).toBeNull();
    expect(payload.rerunReviewSummary).toBeNull();
    expect(payload.rerunReviewUrl).toBeNull();
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
    expect(payload.publishedPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestUrl).toBeNull();
    expect(payload.draftPullRequestDisposition).toBeNull();
    expect(payload.draftPullRequestDispositionReason).toBeNull();
    expect(payload.pullRequestPublished).toBe(false);
    expect(payload.publishedPullRequestOpenedAt).toBeNull();
    expect(payload.pullRequestMerged).toBe(false);
    expect(payload.mergedPullRequestMergedAt).toBeNull();
  });

  it("keeps published pull request number null when publication only records a url", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        draftPullRequest: {
          ...createRun().draftPullRequest!,
          number: undefined,
          url: "https://github.com/openclaw/openclaw/pull/42",
        },
        history: ["Pull request opened: https://github.com/openclaw/openclaw/pull/42"],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestUrl).toBe("https://github.com/openclaw/openclaw/pull/42");
    expect(payload.pullRequestPublished).toBe(true);
    expect(payload.publishedPullRequestNumber).toBeNull();
    expect(payload.publishedPullRequestOpenedAt).toBe("2026-01-01T00:00:00.000Z");
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
    expect(payload.publishedPullRequestNumber).toBeNull();
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
        suitability: {
          ...createRun().suitability!,
          decision: "needs-human-review",
          summary:
            "Suitability recommends human review before autonomous execution. Issue is classified as workflow-core instead of command-layer.",
          reasons: ["Issue is classified as workflow-core instead of command-layer."],
          classification: "workflow-core",
        },
        history: [
          "Verification approved for human review",
          "Auto-merge skipped: policy requires an auto-run suitability decision, command-layer scope, and a passing scope check",
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.autoMergeDisposition).toBe("skipped");
    expect(payload.autoMergeDispositionReason).toBe(
      "Auto-merge skipped: policy requires an auto-run suitability decision, command-layer scope, and a passing scope check",
    );
    expect(payload.autoMergePolicyEligible).toBe(false);
    expect(payload.autoMergePolicyReason).toBe(
      "Not eligible for auto-merge: suitability did not accept autonomous execution.",
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
    expect(payload.scopeCheckSummary).toBe("Scope check failed for command-layer issue.");
    expect(payload.scopeCheckPassed).toBe(false);
    expect(payload.scopeCheckHasBlockedFiles).toBe(true);
    expect(payload.scopeBlockedFiles).toEqual(["src/openclawcode/orchestrator/run.ts"]);
    expect(payload.scopeBlockedFileCount).toBe(1);
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
    expect(payload.verificationApprovedForHumanReview).toBe(false);
    expect(payload.verificationHasFindings).toBe(true);
    expect(payload.verificationHasMissingCoverage).toBe(true);
    expect(payload.verificationHasSignals).toBe(true);
    expect(payload.verificationHasFollowUps).toBe(true);
    expect(payload.verificationFindingCount).toBe(2);
    expect(payload.verificationMissingCoverageCount).toBe(1);
    expect(payload.verificationFollowUpCount).toBe(2);
  });

  it("prints historyEntryCount when history is present", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        history: [
          "Draft PR opened: https://github.com/openclaw/openclaw/pull/42",
          "Verification approved for human review",
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.historyEntryCount).toBe(2);
  });

  it("prints historyEntryCount as null when history is missing", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        history: undefined,
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.historyEntryCount).toBeNull();
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

  it("treats ready pull request publication notes as published pr dispositions", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        history: ["Pull request opened: https://github.com/openclaw/openclaw/pull/42"],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.draftPullRequestDisposition).toBe("published");
    expect(payload.draftPullRequestDispositionReason).toBe(
      "Pull request opened: https://github.com/openclaw/openclaw/pull/42",
    );
    expect(payload.pullRequestPublished).toBe(true);
  });

  it("renders a dry-run validation issue template without creating a GitHub issue", async () => {
    await openclawCodeSeedValidationIssueCommand(
      {
        template: "command-json-boolean",
        repoRoot: "/repo",
        fieldName: "verificationHasSignals",
        sourcePath: "verificationReport.followUps",
        dryRun: true,
        json: true,
      },
      runtime,
    );

    expect(mocks.createIssue).not.toHaveBeenCalled();
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      template: "command-json-boolean",
      issueClass: "command-layer",
      owner: "openclaw",
      repo: "openclaw",
      dryRun: true,
      title: "[Feature]: Expose verificationHasSignals in openclaw code run --json output",
    });
    expect(payload.body).toContain("`verificationReport.followUps` contains at least one entry");
  });

  it("creates a validation issue from the selected template", async () => {
    await openclawCodeSeedValidationIssueCommand(
      {
        template: "operator-doc-note",
        owner: "zhyongrui",
        repo: "openclawcode",
        docPath: "docs/openclawcode/operator-setup.md",
        summary: "restart-window retries in setup-check",
        json: true,
      },
      runtime,
    );

    expect(mocks.createIssue).toHaveBeenCalledWith({
      owner: "zhyongrui",
      repo: "openclawcode",
      title: "[Docs]: Clarify restart-window retries in setup-check",
      body: expect.stringContaining("`docs/openclawcode/operator-setup.md`"),
    });
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      template: "operator-doc-note",
      issueClass: "operator-docs",
      owner: "openclaw",
      repo: "openclaw",
      issueNumber: 99,
      issueUrl: "https://github.com/openclaw/openclaw/issues/99",
      dryRun: false,
      created: true,
      reusedExisting: false,
    });
  });

  it("reuses an existing open validation issue instead of creating a duplicate", async () => {
    await openclawCodeSeedValidationIssueCommand(
      {
        template: "command-json-boolean",
        repoRoot: "/repo",
        fieldName: "verificationHasMissingCoverage",
        sourcePath: "verificationReport.missingCoverage",
        json: true,
      },
      runtime,
    );

    expect(mocks.createIssue).not.toHaveBeenCalled();
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      template: "command-json-boolean",
      issueClass: "command-layer",
      issueNumber: 99,
      issueUrl: "https://github.com/openclaw/openclaw/issues/99",
      dryRun: false,
      created: false,
      reusedExisting: true,
    });
  });

  it("exposes the supported validation issue templates", () => {
    expect(openclawCodeSeedValidationIssueTemplateIds()).toEqual([
      "command-json-boolean",
      "command-json-number",
      "operator-doc-note",
      "webhook-precheck-high-risk",
    ]);
  });

  it("lists the current validation issue pool in JSON form", async () => {
    await openclawCodeListValidationIssuesCommand(
      {
        repoRoot: "/repo",
        json: true,
      },
      runtime,
    );

    expect(mocks.listIssues).toHaveBeenCalledWith({
      owner: "openclaw",
      repo: "openclaw",
      state: "open",
    });
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      owner: "openclaw",
      repo: "openclaw",
      state: "open",
      totalValidationIssues: 2,
      counts: {
        commandLayer: 1,
        operatorDocs: 1,
        highRiskValidation: 0,
      },
    });
    expect(payload.issues).toEqual([
      expect.objectContaining({
        issueNumber: 99,
        template: "command-json-boolean",
        issueClass: "command-layer",
      }),
      expect.objectContaining({
        issueNumber: 100,
        template: "operator-doc-note",
        issueClass: "operator-docs",
      }),
    ]);
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
    suitability: {
      decision: "auto-run",
      summary:
        "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
      reasons: [
        "Issue stays within command-layer scope.",
        "Planner risk level is medium.",
        "No high-risk issue signals were detected in the issue text or labels.",
      ],
      classification: "command-layer",
      riskLevel: "medium",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
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
