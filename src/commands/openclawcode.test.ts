import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRun } from "../openclawcode/index.js";
import {
  DEFAULT_OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS,
  DEFAULT_OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS,
  openclawCodeListValidationIssuesCommand,
  openclawCodeReconcileValidationIssuesCommand,
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
    closeIssue: vi.fn(),
    builderCtorArgs: [] as unknown[],
    verifierCtorArgs: [] as unknown[],
  };
});

vi.mock("../openclawcode/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openclawcode/index.js")>();
  class MockGitHubRestClient {
    createIssue = mocks.createIssue;
    listIssues = mocks.listIssues;
    closeIssue = mocks.closeIssue;
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
    AgentBackedBuilder: class {
      constructor(options: unknown) {
        mocks.builderCtorArgs.push(options);
      }
    },
    AgentBackedVerifier: class {
      constructor(options: unknown) {
        mocks.verifierCtorArgs.push(options);
      }
    },
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
    mocks.closeIssue.mockResolvedValue(undefined);
    mocks.builderCtorArgs.length = 0;
    mocks.verifierCtorArgs.length = 0;
    vi.unstubAllEnvs();
  });

  it("prints stable top-level JSON fields for workflow scope, pr metadata, review, and merge policy", async () => {
    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.contractVersion).toBe(1);
    expect(payload.runCreatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.runUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.issueNumber).toBe(2);
    expect(payload.issueLabelCount).toBe(2);
    expect(payload.issueHasLabels).toBe(true);
    expect(payload.issueUrl).toBe("https://github.com/openclaw/openclaw/issues/2");
    expect(payload.issueTitle).toBe("Include changed file list in JSON output");
    expect(payload.issueRepo).toBe("openclaw");
    expect(payload.issueOwner).toBe("openclaw");
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
    expect(payload.changedFileCount).toBe(2);
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
    expect(payload.scopeCheckSummaryPresent).toBe(true);
    expect(payload.scopeCheckPassed).toBe(true);
    expect(payload.scopeCheckHasBlockedFiles).toBe(false);
    expect(payload.scopeBlockedFiles).toEqual([]);
    expect(payload.scopeBlockedFileCount).toBe(0);
    expect(payload.testCommandCount).toBe(1);
    expect(payload.testResultCount).toBe(1);
    expect(payload.noteCount).toBe(1);
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
    expect(payload.suitabilityReasonCount).toBe(3);
    expect(payload.suitabilityClassification).toBe("command-layer");
    expect(payload.suitabilityRiskLevel).toBe("medium");
    expect(payload.suitabilityEvaluatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.draftPullRequestBranchName).toBe("openclawcode/issue-2");
    expect(payload.draftPullRequestBaseBranch).toBe("main");
    expect(payload.draftPullRequestTitle).toBe(
      "[Issue #2] Include changed file list in JSON output",
    );
    expect(payload.draftPullRequestBody).toBe("Draft PR body");
    expect(payload.draftPullRequestOpenedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.draftPullRequestNumber).toBe(42);
    expect(payload.publishedPullRequestNumber).toBe(42);
    expect(payload.publishedPullRequestTitle).toBe(
      "[Issue #2] Include changed file list in JSON output",
    );
    expect(payload.publishedPullRequestBody).toBe("Draft PR body");
    expect(payload.publishedPullRequestBranchName).toBe("openclawcode/issue-2");
    expect(payload.publishedPullRequestBaseBranch).toBe("main");
    expect(payload.draftPullRequestUrl).toBe("https://github.com/openclaw/openclaw/pull/42");
    expect(payload.publishedPullRequestUrl).toBe("https://github.com/openclaw/openclaw/pull/42");
    expect(payload.draftPullRequest.title).toBe(payload.draftPullRequestTitle);
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

  it("uses bounded default builder and verifier timeouts for workflow runs", async () => {
    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(mocks.builderCtorArgs.at(-1)).toEqual(
      expect.objectContaining({
        timeoutSeconds: DEFAULT_OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS,
      }),
    );
    expect(mocks.verifierCtorArgs.at(-1)).toEqual(
      expect.objectContaining({
        timeoutSeconds: DEFAULT_OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS,
      }),
    );
  });

  it("lets the operator override builder and verifier timeouts through env vars", async () => {
    vi.stubEnv("OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS", "90");
    vi.stubEnv("OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS", "45");

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(mocks.builderCtorArgs.at(-1)).toEqual(
      expect.objectContaining({
        timeoutSeconds: 90,
      }),
    );
    expect(mocks.verifierCtorArgs.at(-1)).toEqual(
      expect.objectContaining({
        timeoutSeconds: 45,
      }),
    );
  });

  it("fails fast on invalid workflow timeout env vars", async () => {
    vi.stubEnv("OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS", "0");

    await expect(
      openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime),
    ).rejects.toThrow("OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS must be a positive integer when set.");

    expect(mocks.runIssueWorkflow).not.toHaveBeenCalled();
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
    expect(payload.contractVersion).toBe(1);
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
    expect(payload.changedFileCount).toBeNull();
    expect(payload.testCommandCount).toBeNull();
    expect(payload.testResultCount).toBeNull();
    expect(payload.noteCount).toBeNull();
    expect(payload.suitabilityDecision).toBe("auto-run");
    expect(payload.suitabilitySummary).toBe(
      "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
    );
    expect(payload.suitabilityReasonCount).toBe(3);
    expect(payload.draftPullRequestBranchName).toBeNull();
    expect(payload.draftPullRequestBaseBranch).toBeNull();
    expect(payload.draftPullRequestTitle).toBeNull();
    expect(payload.draftPullRequestBody).toBeNull();
    expect(payload.draftPullRequestOpenedAt).toBeNull();
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.publishedPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestUrl).toBeNull();
    expect(payload.draftPullRequestDisposition).toBeNull();
    expect(payload.draftPullRequestDispositionReason).toBeNull();
    expect(payload.pullRequestPublished).toBe(false);
    expect(payload.publishedPullRequestTitle).toBeNull();
    expect(payload.publishedPullRequestBody).toBeNull();
    expect(payload.publishedPullRequestBranchName).toBeNull();
    expect(payload.publishedPullRequestBaseBranch).toBeNull();
    expect(payload.publishedPullRequestUrl).toBeNull();
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

  it("prints null suitabilityReasonCount when suitability metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        suitability: undefined,
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.suitabilityReasons).toBeNull();
    expect(payload.suitabilityReasonCount).toBeNull();
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

  it("prints issueTitle as null when the workflow issue title is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          title: undefined as unknown as WorkflowRun["issue"]["title"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueTitle).toBeNull();
  });

  it("prints issueRepo as null when the workflow repo metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          repo: undefined as unknown as WorkflowRun["issue"]["repo"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueRepo).toBeNull();
  });

  it("prints issueOwner as null when the workflow owner metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          owner: undefined as unknown as WorkflowRun["issue"]["owner"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueOwner).toBeNull();
  });

  it("prints runCreatedAt as null when the workflow creation timestamp is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        createdAt: undefined as unknown as WorkflowRun["createdAt"],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.runCreatedAt).toBeNull();
  });

  it("prints runUpdatedAt as null when the workflow update timestamp is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        updatedAt: undefined as unknown as WorkflowRun["updatedAt"],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.runUpdatedAt).toBeNull();
  });

  it("prints issueNumber as null when the workflow issue number is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          number: undefined as unknown as WorkflowRun["issue"]["number"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueNumber).toBeNull();
  });

  it("prints issueUrl as null when the workflow issue url is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          url: undefined as unknown as WorkflowRun["issue"]["url"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueUrl).toBeNull();
  });

  it("prints issueLabelCount as null when the workflow issue labels are unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          labels: undefined as unknown as WorkflowRun["issue"]["labels"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueLabelCount).toBeNull();
  });

  it("prints issueHasLabels as false when the workflow issue labels are unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          labels: undefined as unknown as WorkflowRun["issue"]["labels"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueHasLabels).toBe(false);
  });

  it("prints workspaceBaseBranch as null when workspace metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        workspace: {
          ...createRun().workspace,
          baseBranch: undefined as unknown as WorkflowRun["workspace"]["baseBranch"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workspaceBaseBranch).toBeNull();
  });

  it("prints workspaceBranchName as null when workspace branch metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        workspace: {
          ...createRun().workspace,
          branchName: undefined as unknown as WorkflowRun["workspace"]["branchName"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workspaceBranchName).toBeNull();
  });

  it("prints workspaceRepoRoot as null when workspace repo-root metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        workspace: {
          ...createRun().workspace,
          repoRoot: undefined as unknown as WorkflowRun["workspace"]["repoRoot"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workspaceRepoRoot).toBeNull();
  });

  it("prints workspacePreparedAt as null when workspace timestamp metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        workspace: {
          ...createRun().workspace,
          preparedAt: undefined as unknown as WorkflowRun["workspace"]["preparedAt"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workspacePreparedAt).toBeNull();
  });

  it("prints workspaceWorktreePath as null when workspace path metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        workspace: {
          ...createRun().workspace,
          worktreePath: undefined as unknown as WorkflowRun["workspace"]["worktreePath"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workspaceWorktreePath).toBeNull();
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
    expect(payload.draftPullRequestTitle).toBe(
      "[Issue #2] Include changed file list in JSON output",
    );
    expect(payload.draftPullRequestBody).toBe("Draft PR body");
    expect(payload.draftPullRequestOpenedAt).toBe("2026-01-01T00:00:00.000Z");
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
    expect(payload.publishedPullRequestTitle).toBe(
      "[Issue #2] Include changed file list in JSON output",
    );
    expect(payload.publishedPullRequestBranchName).toBe("openclawcode/issue-2");
    expect(payload.publishedPullRequestBaseBranch).toBe("main");
    expect(payload.publishedPullRequestUrl).toBe("https://github.com/openclaw/openclaw/pull/42");
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

  it("surfaces completed-without-changes runs as no-op completions", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "completed-without-changes",
        draftPullRequest: {
          ...createRun().draftPullRequest!,
          number: undefined,
          url: undefined,
          openedAt: undefined,
        },
        buildResult: {
          ...createRun().buildResult!,
          changedFiles: [],
        },
        verificationReport: {
          ...createRun().verificationReport!,
          summary:
            "The issue was already satisfied in the workspace, so the run completed without code changes.",
        },
        history: [
          "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-2.",
          "Workflow completed without code changes; no pull request was needed.",
          "Issue #2 closed automatically after verification determined no code changes were needed.",
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.stage).toBe("completed-without-changes");
    expect(payload.stageLabel).toBe("Completed Without Changes");
    expect(payload.changeDisposition).toBe("no-op");
    expect(payload.pullRequestPublished).toBe(false);
    expect(payload.publishedPullRequestNumber).toBeNull();
    expect(payload.autoMergePolicyEligible).toBe(false);
    expect(payload.autoMergePolicyReason).toBe(
      "No auto-merge was needed: the run completed without code changes or a pull request.",
    );
    expect(payload.runSummary).toBe(
      "The issue was already satisfied in the workspace, so the run completed without code changes.",
    );
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
    expect(payload.scopeCheckSummaryPresent).toBe(true);
    expect(payload.scopeCheckPassed).toBe(false);
    expect(payload.scopeCheckHasBlockedFiles).toBe(true);
    expect(payload.scopeBlockedFiles).toEqual(["src/openclawcode/orchestrator/run.ts"]);
    expect(payload.scopeBlockedFileCount).toBe(1);
    expect(payload.autoMergePolicyEligible).toBe(false);
    expect(payload.autoMergePolicyReason).toBe(
      "Not eligible for auto-merge: the scope check did not pass.",
    );
  });

  it("reports scopeCheckSummaryPresent as false when the summary is empty", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        buildResult: {
          ...createRun().buildResult!,
          scopeCheck: {
            ok: true,
            blockedFiles: [],
            summary: "",
          },
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.scopeCheckSummary).toBe("");
    expect(payload.scopeCheckSummaryPresent).toBe(false);
    expect(payload.scopeCheckPassed).toBe(true);
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
        executionSpec: {
          summary: "Keep stage and acceptance metadata visible in command JSON.",
          scope: ["Command-layer JSON output only.", "No workflow-core or runtime changes."],
          outOfScope: ["No gateway runtime behavior changes.", "No chatops policy changes."],
          acceptanceCriteria: [
            {
              id: "count-criteria",
              text: "Expose acceptanceCriteriaCount at the top level.",
              required: true,
            },
          ],
          openQuestions: [
            "Should this count stay top-level for downstream consumers?",
            "Do we want a matching boolean later?",
          ],
          testPlan: [
            "Run the focused command JSON unit tests.",
            "Run the openclawcode-targeted Vitest config.",
          ],
          risks: [
            {
              id: "risk-provider-output",
              summary: "Downstream tooling could still ignore the new field accidentally.",
              mitigation: "Add a stable top-level count for direct JSON consumers.",
            },
            {
              id: "risk-null-shape",
              summary: "Missing execution metadata could still change the payload shape.",
              mitigation: "Emit null when executionSpec is unavailable.",
            },
          ],
          assumptions: [
            "The execution spec continues to carry assumptions as a top-level array.",
            "Downstream consumers want assumption counts without unpacking nested metadata.",
          ],
          riskLevel: "low",
        },
        stageRecords: [
          {
            stage: "planning",
            recordedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            stage: "building",
            recordedAt: "2026-01-01T00:01:00.000Z",
          },
        ],
        history: [
          "Draft PR opened: https://github.com/openclaw/openclaw/pull/42",
          "Verification approved for human review",
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.acceptanceCriteriaCount).toBe(1);
    expect(payload.openQuestionCount).toBe(2);
    expect(payload.riskCount).toBe(2);
    expect(payload.assumptionCount).toBe(2);
    expect(payload.testPlanCount).toBe(2);
    expect(payload.scopeItemCount).toBe(2);
    expect(payload.outOfScopeCount).toBe(2);
    expect(payload.workspaceBaseBranch).toBe("main");
    expect(payload.workspaceBranchName).toBe("openclawcode/issue-2");
    expect(payload.workspaceRepoRoot).toBe("/repo");
    expect(payload.workspacePreparedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.workspaceWorktreePath).toBe("/repo/.openclawcode/worktrees/issue-2");
    expect(payload.stageRecordCount).toBe(2);
    expect(payload.historyEntryCount).toBe(2);
  });

  it("prints historyEntryCount, stageRecordCount, acceptanceCriteriaCount, openQuestionCount, riskCount, assumptionCount, testPlanCount, scopeItemCount, and outOfScopeCount as null when metadata is missing", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        executionSpec: undefined,
        stageRecords: undefined,
        history: undefined,
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.acceptanceCriteriaCount).toBeNull();
    expect(payload.openQuestionCount).toBeNull();
    expect(payload.riskCount).toBeNull();
    expect(payload.assumptionCount).toBeNull();
    expect(payload.testPlanCount).toBeNull();
    expect(payload.scopeItemCount).toBeNull();
    expect(payload.outOfScopeCount).toBeNull();
    expect(payload.stageRecordCount).toBeNull();
    expect(payload.historyEntryCount).toBeNull();
    expect(payload.failureDiagnostics).toBeNull();
    expect(payload.failureDiagnosticsSummary).toBeNull();
    expect(payload.failureDiagnosticProvider).toBeNull();
    expect(payload.failureDiagnosticModel).toBeNull();
    expect(payload.failureDiagnosticSystemPromptChars).toBeNull();
    expect(payload.failureDiagnosticSkillsPromptChars).toBeNull();
    expect(payload.failureDiagnosticToolSchemaChars).toBeNull();
    expect(payload.failureDiagnosticSkillCount).toBeNull();
    expect(payload.failureDiagnosticInjectedWorkspaceFileCount).toBeNull();
    expect(payload.failureDiagnosticBootstrapWarningShown).toBe(false);
    expect(payload.failureDiagnosticToolCount).toBeNull();
    expect(payload.failureDiagnosticUsageTotal).toBeNull();
  });

  it("prints failure diagnostics when a failed workflow recorded provider metadata", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "failed",
        failureDiagnostics: {
          summary: "HTTP 400: Internal server error",
          provider: "crs",
          model: "gpt-5.4",
          systemPromptChars: 8629,
          skillsPromptChars: 1245,
          toolSchemaChars: 3030,
          toolCount: 4,
          skillCount: 1,
          injectedWorkspaceFileCount: 0,
          bootstrapWarningShown: false,
          lastCallUsageTotal: 0,
        },
        history: [
          "Build started",
          "Build failed: HTTP 400: Internal server error (model=crs/gpt-5.4, prompt=8629, skillsPrompt=1245, schema=3030, tools=4, skills=1, files=0, usage=0, bootstrap=clean)",
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.failureDiagnosticsSummary).toBe("HTTP 400: Internal server error");
    expect(payload.failureDiagnosticProvider).toBe("crs");
    expect(payload.failureDiagnosticModel).toBe("gpt-5.4");
    expect(payload.failureDiagnosticSystemPromptChars).toBe(8629);
    expect(payload.failureDiagnosticSkillsPromptChars).toBe(1245);
    expect(payload.failureDiagnosticToolSchemaChars).toBe(3030);
    expect(payload.failureDiagnosticSkillCount).toBe(1);
    expect(payload.failureDiagnosticInjectedWorkspaceFileCount).toBe(0);
    expect(payload.failureDiagnosticBootstrapWarningShown).toBe(false);
    expect(payload.failureDiagnosticToolCount).toBe(4);
    expect(payload.failureDiagnosticUsageTotal).toBe(0);
    expect(payload.failureDiagnostics).toEqual({
      summary: "HTTP 400: Internal server error",
      provider: "crs",
      model: "gpt-5.4",
      systemPromptChars: 8629,
      skillsPromptChars: 1245,
      toolSchemaChars: 3030,
      toolCount: 4,
      skillCount: 1,
      injectedWorkspaceFileCount: 0,
      bootstrapWarningShown: false,
      lastCallUsageTotal: 0,
    });
    expect(payload.failureDiagnosticToolCount).toBe(4);
    expect(payload.failureDiagnosticUsageTotal).toBe(0);
  });

  it("prints failureDiagnosticBootstrapWarningShown as true when diagnostics flagged bootstrap warnings", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "failed",
        failureDiagnostics: {
          summary: "HTTP 400: Internal server error",
          bootstrapWarningShown: true,
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.failureDiagnosticBootstrapWarningShown).toBe(true);
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
    expect(payload.body).toContain(
      "`verificationReport.followUps` resolves to `true` or contains at least one entry",
    );
  });

  it("renders a dry-run string validation issue template without creating a GitHub issue", async () => {
    await openclawCodeSeedValidationIssueCommand(
      {
        template: "command-json-string",
        repoRoot: "/repo",
        fieldName: "failureDiagnosticProvider",
        sourcePath: "failureDiagnostics.provider",
        dryRun: true,
        json: true,
      },
      runtime,
    );

    expect(mocks.createIssue).not.toHaveBeenCalled();
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      template: "command-json-string",
      issueClass: "command-layer",
      owner: "openclaw",
      repo: "openclaw",
      dryRun: true,
      title: "[Feature]: Expose failureDiagnosticProvider in openclaw code run --json output",
    });
    expect(payload.body).toContain("`failureDiagnosticProvider: string | null`");
    expect(payload.body).toContain("`failureDiagnostics.provider`");
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
      "command-json-string",
      "operator-doc-note",
      "webhook-precheck-high-risk",
    ]);
  });

  it("lists the current validation issue pool in JSON form", async () => {
    const repoRoot = await createValidationAssessmentRepoRoot({
      fieldName: "verificationHasMissingCoverage",
    });

    await openclawCodeListValidationIssuesCommand(
      {
        repoRoot,
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
      implementationCounts: {
        implemented: 1,
        pending: 0,
        manualReview: 1,
      },
      templateCounts: {
        "command-json-boolean": 1,
        "operator-doc-note": 1,
      },
    });
    expect(payload.issues).toEqual([
      expect.objectContaining({
        issueNumber: 99,
        template: "command-json-boolean",
        issueClass: "command-layer",
        fieldName: "verificationHasMissingCoverage",
        implementationState: "implemented",
        autoClosable: true,
      }),
      expect.objectContaining({
        issueNumber: 100,
        template: "operator-doc-note",
        issueClass: "operator-docs",
        fieldName: null,
        implementationState: "manual-review",
        autoClosable: false,
      }),
    ]);
  });

  it("lists validation issue class and template summaries in text form", async () => {
    const repoRoot = await createValidationAssessmentRepoRoot({
      fieldName: "verificationHasMissingCoverage",
    });

    await openclawCodeListValidationIssuesCommand(
      {
        repoRoot,
      },
      runtime,
    );

    expect(runtime.log.mock.calls.map((call) => call[0])).toEqual([
      "Repo: openclaw/openclaw",
      "State: open",
      "Validation issues: 2",
      "- command-layer: 1",
      "- operator-docs: 1",
      "- high-risk-validation: 0",
      "- implemented: 1",
      "- pending: 0",
      "- manual-review: 1",
      "- template command-json-boolean: 1",
      "- template operator-doc-note: 1",
      expect.stringContaining("#99 [command-layer/command-json-boolean/implemented]"),
      "field: verificationHasMissingCoverage",
      "Field is already present in command output, covered by tests, and documented in the JSON contract.",
      "https://github.com/openclaw/openclaw/issues/99",
      expect.stringContaining("#100 [operator-docs/operator-doc-note/manual-review]"),
      "Automatic local implementation detection is only supported for command-layer JSON validation issues.",
      "https://github.com/openclaw/openclaw/issues/100",
    ]);
  });

  it("reconciles implemented validation issues in dry-run mode", async () => {
    const repoRoot = await createValidationAssessmentRepoRoot({
      fieldName: "verificationHasMissingCoverage",
    });

    await openclawCodeReconcileValidationIssuesCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    expect(mocks.closeIssue).not.toHaveBeenCalled();
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      owner: "openclaw",
      repo: "openclaw",
      closeImplemented: false,
      totalValidationIssues: 2,
      closableImplementedIssues: 1,
      closedIssues: 0,
      nextAction: "close-implemented-validation-issues",
    });
    expect(payload.actions).toEqual([
      expect.objectContaining({
        issueNumber: 99,
        action: "would-close",
        implementationState: "implemented",
      }),
      expect.objectContaining({
        issueNumber: 100,
        action: "left-open",
        implementationState: "manual-review",
      }),
    ]);
  });

  it("closes implemented validation issues and requests a fresh command-layer seed when none remain", async () => {
    const repoRoot = await createValidationAssessmentRepoRoot({
      fieldName: "verificationHasMissingCoverage",
    });

    await openclawCodeReconcileValidationIssuesCommand(
      {
        repoRoot,
        closeImplemented: true,
        json: true,
      },
      runtime,
    );

    expect(mocks.closeIssue).toHaveBeenCalledWith({
      owner: "openclaw",
      repo: "openclaw",
      issueNumber: 99,
    });
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      closeImplemented: true,
      closableImplementedIssues: 1,
      closedIssues: 1,
      nextAction: "seed-command-layer-validation-issue",
    });
  });
});

async function createValidationAssessmentRepoRoot(params: { fieldName: string }): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-validation-"));
  await mkdir(path.join(repoRoot, "src/commands"), { recursive: true });
  await mkdir(path.join(repoRoot, "docs/openclawcode"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src/commands/openclawcode.ts"),
    `${params.fieldName}: true,\n`,
    "utf8",
  );
  await writeFile(
    path.join(repoRoot, "src/commands/openclawcode.test.ts"),
    `expect(payload.${params.fieldName}).toBe(true);\n`,
    "utf8",
  );
  await writeFile(
    path.join(repoRoot, "docs/openclawcode/run-json-contract.md"),
    `- \`${params.fieldName}\`\n`,
    "utf8",
  );
  return repoRoot;
}

function createRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run_123",
    stage: "ready-for-human-review",
    issue: {
      owner: "openclaw",
      repo: "openclaw",
      number: 2,
      title: "Include changed file list in JSON output",
      url: "https://github.com/openclaw/openclaw/issues/2",
      labels: ["json", "cli"],
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
      notes: ["Builder left one note for the operator."],
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
