import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenClawCodeChatopsStore } from "../integrations/openclaw-plugin/store.js";
import { setPreferredOperatorChatTarget } from "../operator-chat-targets/store.js";
import type { WorkflowRun } from "../openclawcode/index.js";
import {
  openclawCodeBootstrapCommand,
  openclawCodeBlueprintClarifyCommand,
  openclawCodeBlueprintDecomposeCommand,
  openclawCodeDiscoverWorkItemsCommand,
  DEFAULT_OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS,
  DEFAULT_OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS,
  openclawCodeBlueprintInitCommand,
  openclawCodeBootstrapInternals,
  openclawCodePolicyShowCommand,
  openclawCodeRepoPlanCommand,
  openclawCodeOperatorStatusSnapshotShowCommand,
  openclawCodeBlueprintSetSectionCommand,
  openclawCodeBlueprintSetProviderRoleCommand,
  openclawCodeRoleRoutingRefreshCommand,
  openclawCodeRoleRoutingShowCommand,
  openclawCodeStageGatesDecideCommand,
  openclawCodeStageGatesRefreshCommand,
  openclawCodeStageGatesShowCommand,
  openclawCodeBlueprintSetStatusCommand,
  openclawCodeBlueprintShowCommand,
  openclawCodeListValidationIssuesCommand,
  openclawCodeIssueMaterializeCommand,
  openclawCodeIssueMaterializationShowCommand,
  openclawCodeNextWorkShowCommand,
  openclawCodeAutonomousLoopRunCommand,
  openclawCodeAutonomousLoopShowCommand,
  openclawCodePromotionGateRefreshCommand,
  openclawCodePromotionGateShowCommand,
  openclawCodePromotionReceiptRecordCommand,
  openclawCodePromotionReceiptShowCommand,
  openclawCodeProjectProgressShowCommand,
  openclawCodeRuntimeSteeringSetCommand,
  openclawCodeRuntimeSteeringShowCommand,
  openclawCodeReconcileValidationIssuesCommand,
  openclawCodeRerouteRunCommand,
  openclawCodeRollbackReceiptRecordCommand,
  openclawCodeRollbackReceiptShowCommand,
  openclawCodeRollbackSuggestionRefreshCommand,
  openclawCodeRollbackSuggestionShowCommand,
  openclawCodeRunCommand,
  openclawCodeSeedValidationIssueCommand,
  openclawCodeSeedValidationIssueTemplateIds,
  openclawCodeWorkItemsShowCommand,
} from "./openclawcode.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const mocks = vi.hoisted(() => {
  return {
    resolveGitHubRepoFromGit: vi.fn(),
    runIssueWorkflow: vi.fn(),
    createIssue: vi.fn(),
    listIssues: vi.fn(),
    closeIssue: vi.fn(),
    ensureRepoWebhook: vi.fn(),
    fetchAuthenticatedViewer: vi.fn(),
    listAccessibleRepositories: vi.fn(),
    createRepository: vi.fn(),
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
    ensureRepoWebhook = mocks.ensureRepoWebhook;
    fetchAuthenticatedViewer = mocks.fetchAuthenticatedViewer;
    listAccessibleRepositories = mocks.listAccessibleRepositories;
    createRepository = mocks.createRepository;
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

vi.mock("../openclawcode/github/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openclawcode/github/index.js")>();
  class MockGitHubRestClient {
    createIssue = mocks.createIssue;
    listIssues = mocks.listIssues;
    closeIssue = mocks.closeIssue;
    ensureRepoWebhook = mocks.ensureRepoWebhook;
    fetchAuthenticatedViewer = mocks.fetchAuthenticatedViewer;
    listAccessibleRepositories = mocks.listAccessibleRepositories;
    createRepository = mocks.createRepository;
  }
  return {
    ...actual,
    GitHubRestClient: MockGitHubRestClient,
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
    mocks.listIssues.mockResolvedValue([]);
    mocks.fetchAuthenticatedViewer.mockResolvedValue({ login: "acme" });
    mocks.listAccessibleRepositories.mockResolvedValue([]);
    mocks.createRepository.mockResolvedValue({
      owner: "acme",
      repo: "new-project",
      description: "Created by tests",
      private: true,
      defaultBranch: "main",
      url: "https://github.com/acme/new-project",
      updatedAt: "2026-03-18T00:00:00Z",
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
    mocks.ensureRepoWebhook.mockResolvedValue({
      action: "created",
      id: 123456,
      active: true,
      webhookUrl: "https://bootstrap.example.test/plugins/openclawcode/github",
      events: ["issues", "pull_request", "pull_request_review"],
    });
    mocks.builderCtorArgs.length = 0;
    mocks.verifierCtorArgs.length = 0;
    vi.unstubAllEnvs();
  });

  async function writeOperatorRepoConfig(params: {
    operatorStateDir: string;
    repoRoot: string;
    owner?: string;
    repo?: string;
    notifyChannel?: string;
    notifyTarget?: string;
    builderAgent?: string;
    verifierAgent?: string;
  }): Promise<void> {
    await writeFile(
      path.join(params.operatorStateDir, "openclaw.json"),
      JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                config: {
                  repos: [
                    {
                      owner: params.owner ?? "openclaw",
                      repo: params.repo ?? "openclawcode",
                      repoRoot: params.repoRoot,
                      baseBranch: "main",
                      builderAgent: params.builderAgent ?? "codex-main",
                      verifierAgent: params.verifierAgent ?? "claude-main",
                      testCommands: ["pnpm test"],
                      notifyChannel: params.notifyChannel ?? "telegram",
                      notifyTarget: params.notifyTarget ?? "chat:primary",
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  it("prints stable top-level JSON fields for workflow scope, pr metadata, review, and merge policy", async () => {
    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.contractVersion).toBe(1);
    expect(payload.runCreatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.runUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.runHasUpdatedAt).toBe(true);
    expect(payload.runAgeSeconds).toBe(0);
    expect(payload.issueNumber).toBe(2);
    expect(payload.issueLabelCount).toBe(2);
    expect(payload.issueHasLabels).toBe(true);
    expect(payload.issueLabelListPresent).toBe(true);
    expect(payload.issueFirstLabel).toBe("json");
    expect(payload.issueLastLabel).toBe("cli");
    expect(payload.issueHasBody).toBe(true);
    expect(payload.issueBodyLength).toBe(73);
    expect(payload.issueTitleLength).toBe(40);
    expect(payload.issueUrl).toBe("https://github.com/openclaw/openclaw/issues/2");
    expect(payload.issueTitle).toBe("Include changed file list in JSON output");
    expect(payload.issueRepo).toBe("openclaw");
    expect(payload.issueOwner).toBe("openclaw");
    expect(payload.issueRepoOwnerPair).toBe("openclaw/openclaw");
    expect(payload.stage).toBe("ready-for-human-review");
    expect(payload.stageLabel).toBe("Ready For Human Review");
    expect(payload.totalAttemptCount).toBe(1);
    expect(payload.planningAttemptCount).toBe(1);
    expect(payload.buildAttemptCount).toBe(1);
    expect(payload.verificationAttemptCount).toBe(1);
    expect(payload.buildSummary).toBe("Updated JSON output");
    expect(payload.buildHasSignals).toBe(true);
    expect(payload.buildSummaryPresent).toBe(true);
    expect(payload.changedFiles).toEqual([
      "src/openclawcode/app/run-issue.ts",
      "src/openclawcode/contracts/types.ts",
    ]);
    expect(payload.changedFilesPresent).toBe(true);
    expect(payload.changedFileListStable).toBe(true);
    expect(payload.changedFileCount).toBe(2);
    expect(payload.buildPolicySignalsPresent).toBe(true);
    expect(payload.buildChangedLineCount).toBe(24);
    expect(payload.buildChangedDirectoryCount).toBe(2);
    expect(payload.buildBroadFanOut).toBe(false);
    expect(payload.buildLargeDiff).toBe(false);
    expect(payload.buildGeneratedFilesPresent).toBe(false);
    expect(payload.buildGeneratedFiles).toEqual([]);
    expect(payload.buildGeneratedFileCount).toBe(0);
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
    expect(payload.scopeBlockedFilesPresent).toBe(false);
    expect(payload.scopeBlockedFiles).toEqual([]);
    expect(payload.scopeBlockedFileCount).toBe(0);
    expect(payload.scopeBlockedFirstFile).toBeNull();
    expect(payload.scopeBlockedLastFile).toBeNull();
    expect(payload.testCommandsPresent).toBe(true);
    expect(payload.testCommandCount).toBe(1);
    expect(payload.testResultsPresent).toBe(true);
    expect(payload.testResultCount).toBe(1);
    expect(payload.notesPresent).toBe(true);
    expect(payload.noteCount).toBe(1);
    expect(payload.failureDiagnosticsPresent).toBe(false);
    expect(payload.failureDiagnosticSummaryPresent).toBe(false);
    expect(payload.failureDiagnosticProviderPresent).toBe(false);
    expect(payload.failureDiagnosticModelPresent).toBe(false);
    expect(payload.buildResult.issueClassification).toBe(payload.issueClassification);
    expect(payload.buildResult.scopeCheck).toEqual(payload.scopeCheck);
    expect(payload.blueprintStatus).toBe("agreed");
    expect(payload.blueprintRevisionId).toBe("blueprint_rev_123");
    expect(payload.blueprintAgreed).toBe(true);
    expect(payload.blueprintDefaultedSectionCount).toBe(0);
    expect(payload.blueprintWorkstreamCandidateCount).toBe(1);
    expect(payload.blueprintOpenQuestionCount).toBe(0);
    expect(payload.blueprintHumanGateCount).toBe(3);
    expect(payload.blueprintContext.status).toBe(payload.blueprintStatus);
    expect(payload.blueprintContext.revisionId).toBe(payload.blueprintRevisionId);
    expect(payload.roleRoutingMixedMode).toBe(true);
    expect(payload.roleRoutingFallbackConfigured).toBe(true);
    expect(payload.roleRoutingUnresolvedRoleCount).toBe(0);
    expect(payload.roleRoutingPlannerAdapter).toBe("claude-code");
    expect(payload.roleRoutingCoderAdapter).toBe("codex");
    expect(payload.roleRoutingReviewerAdapter).toBe("claude-code");
    expect(payload.roleRoutingVerifierAdapter).toBe("codex");
    expect(payload.roleRoutingDocWriterAdapter).toBe("codex");
    expect(payload.roleRouting.routes).toHaveLength(5);
    expect(payload.runtimeRoutingSelectionCount).toBe(2);
    expect(payload.runtimeRoutingCoderAgentId).toBe("codex-coder");
    expect(payload.runtimeRoutingCoderAgentSource).toBe("adapter-env");
    expect(payload.runtimeRoutingVerifierAgentId).toBe("codex-verifier");
    expect(payload.runtimeRoutingVerifierAgentSource).toBe("role-env");
    expect(payload.stageGateBlockedGateCount).toBe(0);
    expect(payload.stageGateNeedsHumanDecisionCount).toBe(1);
    expect(payload.goalAgreementStageGateReadiness).toBe("ready");
    expect(payload.workItemProjectionStageGateReadiness).toBe("ready");
    expect(payload.executionRoutingStageGateReadiness).toBe("ready");
    expect(payload.executionStartStageGateReadiness).toBe("needs-human-decision");
    expect(payload.mergePromotionStageGateReadiness).toBe("ready");
    expect(payload.stageGates.gates).toHaveLength(5);
    expect(payload.suitabilityDecision).toBe("auto-run");
    expect(payload.suitabilityDecisionIsAutoRun).toBe(true);
    expect(payload.suitabilityDecisionIsNeedsHumanReview).toBe(false);
    expect(payload.suitabilityDecisionIsEscalate).toBe(false);
    expect(payload.suitabilitySummary).toBe(
      "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
    );
    expect(payload.suitabilitySummaryPresent).toBe(true);
    expect(payload.suitabilityReasons).toEqual([
      "Issue stays within command-layer scope.",
      "Planner risk level is medium.",
      "No high-risk issue signals were detected in the issue text or labels.",
    ]);
    expect(payload.suitabilityReasonsPresent).toBe(true);
    expect(payload.suitabilityReasonCount).toBe(3);
    expect(payload.suitabilityClassification).toBe("command-layer");
    expect(payload.suitabilityRiskLevel).toBe("medium");
    expect(payload.suitabilityEvaluatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.suitabilityAllowlisted).toBe(true);
    expect(payload.suitabilityDenylisted).toBe(false);
    expect(payload.suitabilityOverrideApplied).toBe(false);
    expect(payload.suitabilityOriginalDecision).toBeNull();
    expect(payload.acceptanceCriteriaPresent).toBe(false);
    expect(payload.openQuestionsPresent).toBe(false);
    expect(payload.risksPresent).toBe(false);
    expect(payload.assumptionsPresent).toBe(false);
    expect(payload.testPlanPresent).toBe(false);
    expect(payload.scopeItemsPresent).toBe(false);
    expect(payload.outOfScopePresent).toBe(false);
    expect(payload.workspaceBranchMatchesIssue).toBe(true);
    expect(payload.workspaceRepoRootPresent).toBe(true);
    expect(payload.workspaceHasPreparedAt).toBe(true);
    expect(payload.workspaceHasWorktreePath).toBe(true);
    expect(payload.workspaceWorktreePath).toBe("/repo/.openclawcode/worktrees/issue-2");
    expect(payload.draftPullRequestBranchName).toBe("openclawcode/issue-2");
    expect(payload.draftPullRequestBaseBranch).toBe("main");
    expect(payload.draftPullRequestHasTitle).toBe(true);
    expect(payload.draftPullRequestTitle).toBe(
      "[Issue #2] Include changed file list in JSON output",
    );
    expect(payload.draftPullRequestHasBody).toBe(true);
    expect(payload.draftPullRequestBody).toBe("Draft PR body");
    expect(payload.draftPullRequestHasOpenedAt).toBe(true);
    expect(payload.draftPullRequestOpenedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.draftPullRequestHasNumber).toBe(true);
    expect(payload.draftPullRequestNumber).toBe(42);
    expect(payload.draftPullRequestHasUrl).toBe(true);
    expect(payload.publishedPullRequestNumber).toBe(42);
    expect(payload.publishedPullRequestHasNumber).toBe(true);
    expect(payload.publishedPullRequestHasUrl).toBe(true);
    expect(payload.publishedPullRequestHasOpenedAt).toBe(true);
    expect(payload.publishedPullRequestHasTitle).toBe(true);
    expect(payload.publishedPullRequestHasBody).toBe(true);
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
    expect(payload.verificationDecisionIsApprove).toBe(true);
    expect(payload.verificationDecisionIsRequestChanges).toBe(false);
    expect(payload.verificationDecisionIsEscalate).toBe(false);
    expect(payload.verificationApprovedForHumanReview).toBe(true);
    expect(payload.verificationSummary).toBe(
      "Verification completed and the run is ready for human review.",
    );
    expect(payload.verificationSummaryPresent).toBe(true);
    expect(payload.verificationHasFindings).toBe(false);
    expect(payload.verificationFindingsPresent).toBe(false);
    expect(payload.verificationHasMissingCoverage).toBe(false);
    expect(payload.verificationMissingCoveragePresent).toBe(false);
    expect(payload.verificationHasSignals).toBe(true);
    expect(payload.verificationHasFollowUps).toBe(false);
    expect(payload.verificationFollowUpsPresent).toBe(false);
    expect(payload.verificationFindingCount).toBe(0);
    expect(payload.verificationMissingCoverageCount).toBe(0);
    expect(payload.verificationFollowUpCount).toBe(0);
    expect(payload.runLastStageEnteredAt).toBeNull();
    expect(payload.runHasHistory).toBe(true);
    expect(payload.runHasStageRecords).toBe(false);
    expect(payload.runHistoryTextPresent).toBe(true);
    expect(payload.rerunReasonPresent).toBe(false);
    expect(payload.rerunReviewDecisionPresent).toBe(false);
    expect(payload.rerunReviewSummaryPresent).toBe(false);
    expect(payload.rerunReviewUrlPresent).toBe(false);
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

  it("falls back to operator repo test commands and role agents when run flags omit them", async () => {
    const operatorRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-operator-root-"));
    await writeFile(
      path.join(operatorRoot, "openclaw.json"),
      JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                enabled: true,
                config: {
                  repos: [
                    {
                      owner: "openclaw",
                      repo: "openclaw",
                      repoRoot: "/repo",
                      baseBranch: "main",
                      notifyChannel: "telegram",
                      notifyTarget: "chat:123",
                      builderAgent: "builder-from-config",
                      verifierAgent: "verifier-from-config",
                      testCommands: [
                        "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    vi.stubEnv("OPENCLAW_STATE_DIR", operatorRoot);

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(mocks.builderCtorArgs.at(-1)).toEqual(
      expect.objectContaining({
        agentId: "builder-from-config",
        testCommands: [
          "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
        ],
      }),
    );
    expect(mocks.verifierCtorArgs.at(-1)).toEqual(
      expect.objectContaining({
        agentId: "verifier-from-config",
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

  it("forwards suitability override metadata into workflow runs", async () => {
    await openclawCodeRunCommand(
      {
        issue: "2",
        repoRoot: "/repo",
        json: true,
        suitabilityOverrideActor: "chat:operator",
        suitabilityOverrideReason: "Operator approved this exception.",
      },
      runtime,
    );

    expect(mocks.runIssueWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        suitabilityOverride: {
          actor: "chat:operator",
          reason: "Operator approved this exception.",
        },
      }),
      expect.anything(),
    );
  });

  it("forwards plan-approval metadata into workflow runs", async () => {
    await openclawCodeRunCommand(
      {
        issue: "2",
        repoRoot: "/repo",
        json: true,
        requirePlanApproval: true,
        approvePlanDigest: "sha256:plan-123",
        planApprovalActor: "chat:operator",
        planApprovalNote: "Approved after reviewing the scope and tests.",
      },
      runtime,
    );

    expect(mocks.runIssueWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        requirePlanApproval: true,
        approvePlanDigest: "sha256:plan-123",
        planApprovalActor: "chat:operator",
        planApprovalNote: "Approved after reviewing the scope and tests.",
        planApprovalSource: "cli",
      }),
      expect.anything(),
    );
  });

  it("forwards a parsed plan edit patch into workflow runs", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclawcode-plan-edit-"));
    const patchPath = path.join(tempDir, "plan-edit.json");
    await writeFile(
      patchPath,
      JSON.stringify({
        summary: "Use an edited plan summary.",
        scope: ["Only update the CLI JSON contract."],
        riskLevel: "low",
      }),
      "utf8",
    );

    await openclawCodeRunCommand(
      {
        issue: "2",
        repoRoot: "/repo",
        json: true,
        planEditFile: patchPath,
        planEditActor: "chat:operator",
        planEditNote: "Narrow the work before coding.",
      },
      runtime,
    );

    expect(mocks.runIssueWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        planEdit: {
          summary: "Use an edited plan summary.",
          scope: ["Only update the CLI JSON contract."],
          riskLevel: "low",
        },
        planEditActor: "chat:operator",
        planEditNote: "Narrow the work before coding.",
        planEditSource: patchPath,
      }),
      expect.anything(),
    );
  });

  it("prints empty top-level scope fields and blocks auto-merge when workflow data is missing", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "draft-pr-opened",
        buildResult: undefined,
        draftPullRequest: undefined,
        verificationReport: undefined,
        blueprintContext: undefined,
        roleRouting: undefined,
        runtimeRouting: undefined,
        stageGates: undefined,
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.contractVersion).toBe(1);
    expect(payload.runHasUpdatedAt).toBe(true);
    expect(payload.runAgeSeconds).toBe(0);
    expect(payload.totalAttemptCount).toBe(1);
    expect(payload.planningAttemptCount).toBe(1);
    expect(payload.buildAttemptCount).toBe(1);
    expect(payload.verificationAttemptCount).toBe(1);
    expect(payload.buildSummary).toBeNull();
    expect(payload.buildHasSignals).toBe(false);
    expect(payload.buildSummaryPresent).toBe(false);
    expect(payload.changedFiles).toEqual([]);
    expect(payload.changedFilesPresent).toBe(false);
    expect(payload.changedFileListStable).toBe(false);
    expect(payload.changeDisposition).toBeNull();
    expect(payload.changeDispositionReason).toBeNull();
    expect(payload.stageLabel).toBe("Draft PR Opened");
    expect(payload.issueClassification).toBeNull();
    expect(payload.scopeCheck).toBeNull();
    expect(payload.scopeCheckSummary).toBeNull();
    expect(payload.scopeCheckPassed).toBeNull();
    expect(payload.scopeCheckHasBlockedFiles).toBe(false);
    expect(payload.scopeBlockedFilesPresent).toBe(false);
    expect(payload.scopeBlockedFiles).toBeNull();
    expect(payload.scopeBlockedFileCount).toBeNull();
    expect(payload.scopeBlockedFirstFile).toBeNull();
    expect(payload.scopeBlockedLastFile).toBeNull();
    expect(payload.changedFileCount).toBeNull();
    expect(payload.testCommandsPresent).toBe(false);
    expect(payload.testCommandCount).toBeNull();
    expect(payload.testResultsPresent).toBe(false);
    expect(payload.testResultCount).toBeNull();
    expect(payload.notesPresent).toBe(false);
    expect(payload.noteCount).toBeNull();
    expect(payload.failureDiagnosticsPresent).toBe(false);
    expect(payload.failureDiagnosticSummaryPresent).toBe(false);
    expect(payload.failureDiagnosticProviderPresent).toBe(false);
    expect(payload.failureDiagnosticModelPresent).toBe(false);
    expect(payload.blueprintContext).toBeNull();
    expect(payload.blueprintStatus).toBeNull();
    expect(payload.blueprintRevisionId).toBeNull();
    expect(payload.blueprintAgreed).toBeNull();
    expect(payload.blueprintDefaultedSectionCount).toBeNull();
    expect(payload.blueprintWorkstreamCandidateCount).toBeNull();
    expect(payload.blueprintOpenQuestionCount).toBeNull();
    expect(payload.blueprintHumanGateCount).toBeNull();
    expect(payload.roleRouting).toBeNull();
    expect(payload.roleRoutingMixedMode).toBeNull();
    expect(payload.roleRoutingFallbackConfigured).toBeNull();
    expect(payload.roleRoutingUnresolvedRoleCount).toBeNull();
    expect(payload.roleRoutingPlannerAdapter).toBeNull();
    expect(payload.roleRoutingCoderAdapter).toBeNull();
    expect(payload.roleRoutingReviewerAdapter).toBeNull();
    expect(payload.roleRoutingVerifierAdapter).toBeNull();
    expect(payload.roleRoutingDocWriterAdapter).toBeNull();
    expect(payload.runtimeRouting).toBeNull();
    expect(payload.runtimeRoutingSelectionCount).toBeNull();
    expect(payload.runtimeRoutingCoderAgentId).toBeNull();
    expect(payload.runtimeRoutingCoderAgentSource).toBeNull();
    expect(payload.runtimeRoutingVerifierAgentId).toBeNull();
    expect(payload.runtimeRoutingVerifierAgentSource).toBeNull();
    expect(payload.stageGates).toBeNull();
    expect(payload.stageGateBlockedGateCount).toBeNull();
    expect(payload.stageGateNeedsHumanDecisionCount).toBeNull();
    expect(payload.goalAgreementStageGateReadiness).toBeNull();
    expect(payload.workItemProjectionStageGateReadiness).toBeNull();
    expect(payload.executionRoutingStageGateReadiness).toBeNull();
    expect(payload.executionStartStageGateReadiness).toBeNull();
    expect(payload.mergePromotionStageGateReadiness).toBeNull();
    expect(payload.suitabilityDecision).toBe("auto-run");
    expect(payload.suitabilityDecisionIsAutoRun).toBe(true);
    expect(payload.suitabilityDecisionIsNeedsHumanReview).toBe(false);
    expect(payload.suitabilityDecisionIsEscalate).toBe(false);
    expect(payload.suitabilitySummary).toBe(
      "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
    );
    expect(payload.suitabilitySummaryPresent).toBe(true);
    expect(payload.suitabilityReasonCount).toBe(3);
    expect(payload.acceptanceCriteriaPresent).toBe(false);
    expect(payload.openQuestionsPresent).toBe(false);
    expect(payload.risksPresent).toBe(false);
    expect(payload.assumptionsPresent).toBe(false);
    expect(payload.testPlanPresent).toBe(false);
    expect(payload.scopeItemsPresent).toBe(false);
    expect(payload.outOfScopePresent).toBe(false);
    expect(payload.draftPullRequestBranchName).toBeNull();
    expect(payload.draftPullRequestBaseBranch).toBeNull();
    expect(payload.draftPullRequestHasTitle).toBe(false);
    expect(payload.draftPullRequestTitle).toBeNull();
    expect(payload.draftPullRequestHasBody).toBe(false);
    expect(payload.draftPullRequestBody).toBeNull();
    expect(payload.draftPullRequestHasOpenedAt).toBe(false);
    expect(payload.draftPullRequestOpenedAt).toBeNull();
    expect(payload.draftPullRequestHasNumber).toBe(false);
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.publishedPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestHasUrl).toBe(false);
    expect(payload.draftPullRequestUrl).toBeNull();
    expect(payload.draftPullRequestDisposition).toBeNull();
    expect(payload.draftPullRequestDispositionReason).toBeNull();
    expect(payload.pullRequestPublished).toBe(false);
    expect(payload.publishedPullRequestTitle).toBeNull();
    expect(payload.publishedPullRequestBody).toBeNull();
    expect(payload.publishedPullRequestBranchName).toBeNull();
    expect(payload.publishedPullRequestHasNumber).toBe(false);
    expect(payload.publishedPullRequestHasUrl).toBe(false);
    expect(payload.publishedPullRequestHasOpenedAt).toBe(false);
    expect(payload.publishedPullRequestHasTitle).toBe(false);
    expect(payload.publishedPullRequestHasBody).toBe(false);
    expect(payload.publishedPullRequestBranchName).toBeNull();
    expect(payload.publishedPullRequestBaseBranch).toBeNull();
    expect(payload.publishedPullRequestUrl).toBeNull();
    expect(payload.publishedPullRequestOpenedAt).toBeNull();
    expect(payload.pullRequestMerged).toBe(false);
    expect(payload.mergedPullRequestMergedAt).toBeNull();
    expect(payload.verificationDecision).toBeNull();
    expect(payload.verificationDecisionIsApprove).toBe(false);
    expect(payload.verificationDecisionIsRequestChanges).toBe(false);
    expect(payload.verificationDecisionIsEscalate).toBe(false);
    expect(payload.verificationApprovedForHumanReview).toBeNull();
    expect(payload.verificationSummary).toBeNull();
    expect(payload.verificationSummaryPresent).toBe(false);
    expect(payload.verificationHasFindings).toBe(false);
    expect(payload.verificationFindingsPresent).toBe(false);
    expect(payload.verificationHasMissingCoverage).toBe(false);
    expect(payload.verificationMissingCoveragePresent).toBe(false);
    expect(payload.verificationHasSignals).toBe(false);
    expect(payload.verificationHasFollowUps).toBe(false);
    expect(payload.verificationFollowUpsPresent).toBe(false);
    expect(payload.verificationFindingCount).toBeNull();
    expect(payload.verificationMissingCoverageCount).toBeNull();
    expect(payload.verificationFollowUpCount).toBeNull();
    expect(payload.runLastStageEnteredAt).toBeNull();
    expect(payload.runHasHistory).toBe(true);
    expect(payload.runHasStageRecords).toBe(false);
    expect(payload.runHistoryTextPresent).toBe(true);
    expect(payload.rerunReasonPresent).toBe(false);
    expect(payload.rerunReviewDecisionPresent).toBe(false);
    expect(payload.rerunReviewSummaryPresent).toBe(false);
    expect(payload.rerunReviewUrlPresent).toBe(false);
    expect(payload.runSummary).toBe("Run is at the draft-pr-opened stage.");
    expect(payload.autoMergeDisposition).toBeNull();
    expect(payload.autoMergeDispositionReason).toBeNull();
    expect(payload.autoMergePolicyEligible).toBe(false);
    expect(payload.autoMergePolicyReason).toBe(
      "Not eligible for auto-merge: verification has not approved the run.",
    );
  });

  it("prints plan-review fields when a run is waiting for plan approval", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "awaiting-plan-approval",
        workspace: undefined,
        buildResult: undefined,
        draftPullRequest: undefined,
        verificationReport: undefined,
        planReview: {
          required: true,
          status: "awaiting-approval",
          planDigest:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          requestedAt: "2026-01-01T00:01:00.000Z",
          suppliedDigest: "sha256:stale",
          approvedAt: null,
          approvedBy: null,
          approvalSource: "cli",
          approvalNote: "Previous digest is stale after replanning.",
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.stage).toBe("awaiting-plan-approval");
    expect(payload.stageLabel).toBe("Awaiting Plan Approval");
    expect(payload.planApprovalRequired).toBe(true);
    expect(payload.planApprovalStatus).toBe("awaiting-approval");
    expect(payload.planApprovalPending).toBe(true);
    expect(payload.planApprovalApproved).toBe(false);
    expect(payload.planDigest).toBe(
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(payload.planDigestPresent).toBe(true);
    expect(payload.planApprovalRequestedAt).toBe("2026-01-01T00:01:00.000Z");
    expect(payload.planApprovalSuppliedDigest).toBe("sha256:stale");
    expect(payload.planApprovalSuppliedDigestMatches).toBe(false);
    expect(payload.planApprovedAt).toBeNull();
    expect(payload.planApprovedBy).toBeNull();
    expect(payload.planApprovalSource).toBe("cli");
    expect(payload.planApprovalNote).toBe("Previous digest is stale after replanning.");
  });

  it("prints plan-edit fields when a run carries edited planning metadata", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        planEdits: [
          {
            appliedAt: "2026-01-01T00:00:30.000Z",
            source: "/repo/.openclawcode/plan-edit.json",
            actor: "chat:operator",
            note: "Keep this slice CLI-only.",
            editedFields: ["summary", "scope"],
          },
        ],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.planEditCount).toBe(1);
    expect(payload.planEdited).toBe(true);
    expect(payload.planLastEditedAt).toBe("2026-01-01T00:00:30.000Z");
    expect(payload.planLastEditedBy).toBe("chat:operator");
    expect(payload.planLastEditSource).toBe("/repo/.openclawcode/plan-edit.json");
    expect(payload.planLastEditNote).toBe("Keep this slice CLI-only.");
    expect(payload.planLastEditedFields).toEqual(["summary", "scope"]);
    expect(payload.planLastEditedFieldCount).toBe(2);
  });

  it("prints null suitabilityReasonCount when suitability metadata is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        suitability: undefined,
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.suitabilityDecisionIsAutoRun).toBe(false);
    expect(payload.suitabilityDecisionIsNeedsHumanReview).toBe(false);
    expect(payload.suitabilityDecisionIsEscalate).toBe(false);
    expect(payload.suitabilitySummaryPresent).toBe(false);
    expect(payload.suitabilityReasons).toBeNull();
    expect(payload.suitabilityReasonsPresent).toBe(false);
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
    expect(payload.issueTitleLength).toBeNull();
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
    expect(payload.issueRepoOwnerPair).toBeNull();
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
    expect(payload.issueRepoOwnerPair).toBeNull();
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
    expect(payload.runAgeSeconds).toBeNull();
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
    expect(payload.runHasUpdatedAt).toBe(false);
    expect(payload.runAgeSeconds).toBeNull();
  });

  it("prints runHasUpdatedAt as false and runUpdatedAt as null when the workflow update signal is present but empty", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        updatedAt: [] as unknown as WorkflowRun["updatedAt"],
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.runUpdatedAt).toBeNull();
    expect(payload.runHasUpdatedAt).toBe(false);
    expect(payload.runAgeSeconds).toBeNull();
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
    expect(payload.issueLabelListPresent).toBe(false);
    expect(payload.issueFirstLabel).toBeNull();
    expect(payload.issueLastLabel).toBeNull();
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

  it("keeps issueLabelListPresent true when the workflow issue labels are empty", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          labels: [],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueLabelCount).toBe(0);
    expect(payload.issueHasLabels).toBe(false);
    expect(payload.issueLabelListPresent).toBe(true);
    expect(payload.issueFirstLabel).toBeNull();
    expect(payload.issueLastLabel).toBeNull();
  });

  it("prints issueHasBody as false and issueBodyLength as null when the workflow issue body is unavailable", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          body: undefined as unknown as WorkflowRun["issue"]["body"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueHasBody).toBe(false);
    expect(payload.issueBodyLength).toBeNull();
  });

  it("treats blank issue bodies as absent in convenience signals", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        issue: {
          ...createRun().issue,
          body: "   ",
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.issueHasBody).toBe(false);
    expect(payload.issueBodyLength).toBe(3);
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

  it("prints null workspace fields when the run escalates before workspace preparation", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "escalated",
        workspace: undefined,
        suitability: {
          decision: "escalate",
          summary: "Suitability escalated the issue before branch mutation.",
          reasons: ["High-risk issue signals were detected in the issue text."],
          classification: "mixed",
          riskLevel: "high",
          evaluatedAt: "2026-01-01T00:00:00.000Z",
          allowlisted: false,
          denylisted: true,
          matchedLowRiskLabels: [],
          matchedLowRiskKeywords: [],
          matchedHighRiskLabels: [],
          matchedHighRiskKeywords: ["secret"],
          overrideApplied: false,
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.stage).toBe("escalated");
    expect(payload.workspaceBaseBranch).toBeNull();
    expect(payload.workspaceBranchName).toBeNull();
    expect(payload.workspaceBranchMatchesIssue).toBe(false);
    expect(payload.workspaceRepoRoot).toBeNull();
    expect(payload.workspaceRepoRootPresent).toBe(false);
    expect(payload.workspaceHasPreparedAt).toBe(false);
    expect(payload.workspacePreparedAt).toBeNull();
    expect(payload.workspaceHasWorktreePath).toBe(false);
    expect(payload.workspaceWorktreePath).toBeNull();
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
    expect(payload.workspaceBranchMatchesIssue).toBe(false);
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
    expect(payload.workspaceRepoRootPresent).toBe(false);
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
    expect(payload.workspaceHasPreparedAt).toBe(false);
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
    expect(payload.workspaceHasWorktreePath).toBe(false);
  });

  it("prints workspaceBranchMatchesIssue as false when the workspace branch diverges from the issue number", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        workspace: {
          ...createRun().workspace,
          branchName: "openclawcode/issue-999",
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workspaceBranchName).toBe("openclawcode/issue-999");
    expect(payload.workspaceBranchMatchesIssue).toBe(false);
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
          requestedCoderAgentId: "codex-rerun",
          requestedVerifierAgentId: "claude-rerun",
          manualTakeoverRequestedAt: "2026-01-01T23:50:00.000Z",
          manualTakeoverActor: "user:operator",
          manualTakeoverWorktreePath: "/repo/.openclawcode/worktrees/issue-2",
          manualResumeNote: "Human updated the worktree before rerun.",
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
        rerunRequestedCoderAgentId: "codex-rerun",
        rerunRequestedVerifierAgentId: "claude-rerun",
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
          requestedCoderAgentId: "codex-rerun",
          requestedVerifierAgentId: "claude-rerun",
        },
      }),
      expect.any(Object),
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.rerunRequested).toBe(true);
    expect(payload.rerunHasReviewContext).toBe(true);
    expect(payload.rerunReason).toBe("Address GitHub review feedback");
    expect(payload.rerunReasonPresent).toBe(true);
    expect(payload.rerunRequestedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(payload.rerunPriorRunId).toBe("run_122");
    expect(payload.rerunPriorStage).toBe("changes-requested");
    expect(payload.rerunReviewDecision).toBe("changes-requested");
    expect(payload.rerunReviewDecisionPresent).toBe(true);
    expect(payload.rerunReviewSubmittedAt).toBe("2026-01-01T23:59:00.000Z");
    expect(payload.rerunReviewSummary).toBe("Please add a regression test for the rerun path.");
    expect(payload.rerunReviewSummaryPresent).toBe(true);
    expect(payload.rerunReviewUrl).toBe(
      "https://github.com/openclaw/openclaw/pull/42#pullrequestreview-9",
    );
    expect(payload.rerunReviewUrlPresent).toBe(true);
    expect(payload.rerunRequestedCoderAgentId).toBe("codex-rerun");
    expect(payload.rerunRequestedVerifierAgentId).toBe("claude-rerun");
    expect(payload.rerunManualTakeoverRequestedAt).toBe("2026-01-01T23:50:00.000Z");
    expect(payload.rerunManualTakeoverActor).toBe("user:operator");
    expect(payload.rerunManualTakeoverWorktreePath).toBe("/repo/.openclawcode/worktrees/issue-2");
    expect(payload.rerunManualResumeNote).toBe("Human updated the worktree before rerun.");
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
    expect(payload.rerunReasonPresent).toBe(true);
    expect(payload.rerunReviewDecision).toBeNull();
    expect(payload.rerunReviewDecisionPresent).toBe(false);
    expect(payload.rerunReviewSubmittedAt).toBeNull();
    expect(payload.rerunRequestedCoderAgentId).toBeNull();
    expect(payload.rerunRequestedVerifierAgentId).toBeNull();
    expect(payload.rerunManualTakeoverRequestedAt).toBeNull();
    expect(payload.rerunManualTakeoverActor).toBeNull();
    expect(payload.rerunManualTakeoverWorktreePath).toBeNull();
    expect(payload.rerunManualResumeNote).toBeNull();
    expect(payload.rerunReviewSummary).toBeNull();
    expect(payload.rerunReviewSummaryPresent).toBe(false);
    expect(payload.rerunReviewUrl).toBeNull();
    expect(payload.rerunReviewUrlPresent).toBe(false);
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
    expect(payload.rerunReasonPresent).toBe(false);
    expect(payload.rerunReviewDecision).toBeNull();
    expect(payload.rerunReviewDecisionPresent).toBe(false);
    expect(payload.rerunReviewSubmittedAt).toBeNull();
    expect(payload.rerunReviewSummary).toBeNull();
    expect(payload.rerunReviewSummaryPresent).toBe(false);
    expect(payload.rerunReviewUrl).toBeNull();
    expect(payload.rerunReviewUrlPresent).toBe(false);
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
    expect(payload.draftPullRequestHasTitle).toBe(true);
    expect(payload.draftPullRequestTitle).toBe(
      "[Issue #2] Include changed file list in JSON output",
    );
    expect(payload.draftPullRequestHasBody).toBe(true);
    expect(payload.draftPullRequestBody).toBe("Draft PR body");
    expect(payload.draftPullRequestHasOpenedAt).toBe(true);
    expect(payload.draftPullRequestOpenedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.draftPullRequestHasNumber).toBe(false);
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestHasUrl).toBe(false);
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
    expect(payload.draftPullRequestHasNumber).toBe(false);
    expect(payload.draftPullRequestNumber).toBeNull();
    expect(payload.draftPullRequestHasUrl).toBe(true);
    expect(payload.draftPullRequestUrl).toBe("https://github.com/openclaw/openclaw/pull/42");
    expect(payload.pullRequestPublished).toBe(true);
    expect(payload.publishedPullRequestNumber).toBeNull();
    expect(payload.publishedPullRequestHasNumber).toBe(false);
    expect(payload.publishedPullRequestHasUrl).toBe(true);
    expect(payload.publishedPullRequestHasOpenedAt).toBe(true);
    expect(payload.publishedPullRequestHasTitle).toBe(true);
    expect(payload.publishedPullRequestHasBody).toBe(true);
    expect(payload.publishedPullRequestTitle).toBe(
      "[Issue #2] Include changed file list in JSON output",
    );
    expect(payload.publishedPullRequestBody).toBe("Draft PR body");
    expect(payload.publishedPullRequestBranchName).toBe("openclawcode/issue-2");
    expect(payload.publishedPullRequestBaseBranch).toBe("main");
    expect(payload.publishedPullRequestUrl).toBe("https://github.com/openclaw/openclaw/pull/42");
    expect(payload.publishedPullRequestOpenedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("marks publishedPullRequestHasNumber true when the stored number contains at least one entry", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        draftPullRequest: {
          ...createRun().draftPullRequest!,
          number: [42],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.pullRequestPublished).toBe(true);
    expect(payload.publishedPullRequestNumber).toEqual([42]);
    expect(payload.publishedPullRequestHasNumber).toBe(true);
  });

  it("treats blank published pull request bodies as absent in convenience signals", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        draftPullRequest: {
          ...createRun().draftPullRequest!,
          body: "   ",
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.pullRequestPublished).toBe(true);
    expect(payload.draftPullRequestHasBody).toBe(false);
    expect(payload.publishedPullRequestBody).toBe("   ");
    expect(payload.publishedPullRequestHasBody).toBe(false);
    expect(payload.publishedPullRequestHasTitle).toBe(true);
  });

  it("emits a null draft pull request title when draft metadata omits the nested title", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        draftPullRequest: {
          ...createRun().draftPullRequest!,
          title: undefined,
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.draftPullRequestHasTitle).toBe(false);
    expect(payload.draftPullRequestTitle).toBeNull();
    expect(payload.publishedPullRequestHasTitle).toBe(false);
    expect(payload.publishedPullRequestTitle).toBeNull();
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
    expect(payload.verificationSummaryPresent).toBe(false);
    expect(payload.verificationFindingsPresent).toBe(false);
    expect(payload.verificationMissingCoveragePresent).toBe(false);
    expect(payload.verificationFollowUpsPresent).toBe(false);
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
    expect(payload.suitabilityDecisionIsAutoRun).toBe(false);
    expect(payload.suitabilityDecisionIsNeedsHumanReview).toBe(true);
    expect(payload.suitabilityDecisionIsEscalate).toBe(false);
    expect(payload.suitabilitySummaryPresent).toBe(true);
    expect(payload.suitabilityReasonsPresent).toBe(true);
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
    expect(payload.scopeBlockedFilesPresent).toBe(true);
    expect(payload.scopeBlockedFiles).toEqual(["src/openclawcode/orchestrator/run.ts"]);
    expect(payload.scopeBlockedFileCount).toBe(1);
    expect(payload.scopeBlockedFirstFile).toBe("src/openclawcode/orchestrator/run.ts");
    expect(payload.scopeBlockedLastFile).toBe("src/openclawcode/orchestrator/run.ts");
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

  it("reports changedFileListStable as false when changed files are unsorted or duplicated", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        buildResult: {
          ...createRun().buildResult!,
          changedFiles: ["src/z-last.ts", "src/a-first.ts", "src/a-first.ts"],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.changedFilesPresent).toBe(true);
    expect(payload.changedFileListStable).toBe(false);
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
    expect(payload.verificationDecisionIsApprove).toBe(false);
    expect(payload.verificationDecisionIsRequestChanges).toBe(true);
    expect(payload.verificationDecisionIsEscalate).toBe(false);
    expect(payload.verificationSummaryPresent).toBe(true);
    expect(payload.verificationHasFindings).toBe(true);
    expect(payload.verificationFindingsPresent).toBe(true);
    expect(payload.verificationHasMissingCoverage).toBe(true);
    expect(payload.verificationMissingCoveragePresent).toBe(true);
    expect(payload.verificationHasSignals).toBe(true);
    expect(payload.verificationHasFollowUps).toBe(true);
    expect(payload.verificationFollowUpsPresent).toBe(true);
    expect(payload.verificationFindingCount).toBe(2);
    expect(payload.verificationMissingCoverageCount).toBe(1);
    expect(payload.verificationFollowUpCount).toBe(2);
    expect(payload.qualityGateStatus).toBe("fail");
    expect(payload.qualityGateHasFailures).toBe(true);
    expect(payload.qualityGateHasWarnings).toBe(true);
    expect(payload.qualityGateBlockingReasons).toEqual(["verification requested changes"]);
    expect(payload.qualityGateWarnings).toEqual([
      "2 findings",
      "1 missing coverage item",
      "2 follow-ups",
    ]);
  });

  it("reports verificationDecisionIsEscalate when the verifier escalates", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        verificationReport: {
          ...createRun().verificationReport!,
          decision: "escalate",
          summary: "Verification escalated to a human because the run crossed a policy boundary.",
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.verificationDecision).toBe("escalate");
    expect(payload.verificationDecisionIsApprove).toBe(false);
    expect(payload.verificationDecisionIsRequestChanges).toBe(false);
    expect(payload.verificationDecisionIsEscalate).toBe(true);
    expect(payload.verificationSummaryPresent).toBe(true);
  });

  it("reports verificationHasSignals as true when only the verifier summary is present", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        verificationReport: {
          ...createRun().verificationReport!,
          findings: [],
          missingCoverage: [],
          followUps: [],
          summary: "Verification completed without additional findings.",
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.verificationSummaryPresent).toBe(true);
    expect(payload.verificationHasSignals).toBe(true);
  });

  it("reports verificationSummaryPresent and verificationHasSignals as false when the verifier summary is empty", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        verificationReport: {
          ...createRun().verificationReport!,
          summary: "",
          findings: [],
          missingCoverage: [],
          followUps: [],
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.verificationSummary).toBe("");
    expect(payload.verificationSummaryPresent).toBe(false);
    expect(payload.verificationHasSignals).toBe(false);
  });

  it("reports suitabilityDecisionIsEscalate when suitability escalates before branch mutation", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({
        stage: "escalated",
        suitability: {
          ...createRun().suitability!,
          decision: "escalate",
          summary: "Suitability escalated the issue before branch mutation.",
          reasons: ["Issue references authentication and secret handling."],
          classification: "workflow-core",
          riskLevel: "high",
        },
      }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.suitabilityDecision).toBe("escalate");
    expect(payload.suitabilityDecisionIsAutoRun).toBe(false);
    expect(payload.suitabilityDecisionIsNeedsHumanReview).toBe(false);
    expect(payload.suitabilityDecisionIsEscalate).toBe(true);
    expect(payload.suitabilitySummaryPresent).toBe(true);
    expect(payload.suitabilityReasonsPresent).toBe(true);
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
            toStage: "planning",
            note: "Planning started",
            enteredAt: "2026-01-01T00:00:00.000Z",
          },
          {
            toStage: "building",
            note: "Building started",
            enteredAt: "2026-01-01T00:01:00.000Z",
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
    expect(payload.acceptanceCriteriaPresent).toBe(true);
    expect(payload.openQuestionCount).toBe(2);
    expect(payload.openQuestionsPresent).toBe(true);
    expect(payload.riskCount).toBe(2);
    expect(payload.risksPresent).toBe(true);
    expect(payload.assumptionCount).toBe(2);
    expect(payload.assumptionsPresent).toBe(true);
    expect(payload.testPlanCount).toBe(2);
    expect(payload.testPlanPresent).toBe(true);
    expect(payload.scopeItemCount).toBe(2);
    expect(payload.scopeItemsPresent).toBe(true);
    expect(payload.outOfScopeCount).toBe(2);
    expect(payload.outOfScopePresent).toBe(true);
    expect(payload.workspaceBaseBranch).toBe("main");
    expect(payload.workspaceBranchName).toBe("openclawcode/issue-2");
    expect(payload.workspaceBranchMatchesIssue).toBe(true);
    expect(payload.workspaceRepoRoot).toBe("/repo");
    expect(payload.workspaceRepoRootPresent).toBe(true);
    expect(payload.workspaceHasPreparedAt).toBe(true);
    expect(payload.workspacePreparedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.workspaceHasWorktreePath).toBe(true);
    expect(payload.workspaceWorktreePath).toBe("/repo/.openclawcode/worktrees/issue-2");
    expect(payload.stageRecordCount).toBe(2);
    expect(payload.historyEntryCount).toBe(2);
    expect(payload.runLastStageEnteredAt).toBe("2026-01-01T00:01:00.000Z");
    expect(payload.runHasHistory).toBe(true);
    expect(payload.runHasStageRecords).toBe(true);
    expect(payload.runHistoryTextPresent).toBe(true);
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
    expect(payload.acceptanceCriteriaPresent).toBe(false);
    expect(payload.openQuestionCount).toBeNull();
    expect(payload.openQuestionsPresent).toBe(false);
    expect(payload.riskCount).toBeNull();
    expect(payload.risksPresent).toBe(false);
    expect(payload.assumptionCount).toBeNull();
    expect(payload.assumptionsPresent).toBe(false);
    expect(payload.testPlanCount).toBeNull();
    expect(payload.testPlanPresent).toBe(false);
    expect(payload.scopeItemCount).toBeNull();
    expect(payload.scopeItemsPresent).toBe(false);
    expect(payload.outOfScopeCount).toBeNull();
    expect(payload.outOfScopePresent).toBe(false);
    expect(payload.runLastStageEnteredAt).toBeNull();
    expect(payload.runHasHistory).toBe(false);
    expect(payload.runHasStageRecords).toBe(false);
    expect(payload.runHistoryTextPresent).toBe(false);
    expect(payload.stageRecordCount).toBeNull();
    expect(payload.historyEntryCount).toBeNull();
    expect(payload.failureDiagnostics).toBeNull();
    expect(payload.failureDiagnosticsPresent).toBe(false);
    expect(payload.failureDiagnosticsSummary).toBeNull();
    expect(payload.failureDiagnosticSummaryPresent).toBe(false);
    expect(payload.failureDiagnosticProvider).toBeNull();
    expect(payload.failureDiagnosticProviderPresent).toBe(false);
    expect(payload.failureDiagnosticModel).toBeNull();
    expect(payload.failureDiagnosticModelPresent).toBe(false);
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
    expect(payload.failureDiagnosticsPresent).toBe(true);
    expect(payload.failureDiagnosticsSummary).toBe("HTTP 400: Internal server error");
    expect(payload.failureDiagnosticSummaryPresent).toBe(true);
    expect(payload.failureDiagnosticProvider).toBe("crs");
    expect(payload.failureDiagnosticProviderPresent).toBe(true);
    expect(payload.failureDiagnosticModel).toBe("gpt-5.4");
    expect(payload.failureDiagnosticModelPresent).toBe(true);
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

  it("creates the fixed project blueprint scaffold and reports it in json", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-"));

    await openclawCodeBlueprintInitCommand(
      {
        repoRoot,
        title: "OpenClawCode Blueprint",
        goal: "Ship blueprint-first autonomous development.",
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      blueprintPath: path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      exists: true,
      schemaVersion: 1,
      status: "draft",
      title: "OpenClawCode Blueprint",
      requiredSectionsPresent: true,
      hasAgreementCheckpoint: false,
      statusChangedAt: expect.stringMatching(/^202\d-/),
      revisionId: expect.stringMatching(/^[0-9a-f]{12}$/),
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      workstreamCandidateCount: 0,
      openQuestionCount: 0,
      humanGateCount: 0,
    });
    expect(payload.defaultedSections).toContain("Workstreams");
    expect(payload.providerRoleAssignments).toMatchObject({
      planner: null,
      coder: null,
      reviewer: null,
      verifier: null,
      docWriter: null,
    });
    const content = await readFile(path.join(repoRoot, "PROJECT-BLUEPRINT.md"), "utf8");
    expect(content).toContain("# OpenClawCode Blueprint");
    expect(content).toContain("Ship blueprint-first autonomous development.");
    expect(content).toContain("## Human Gates");
    expect(content).toContain("## Provider Strategy");
  });

  it("shows missing blueprint state in json when the fixed blueprint file does not exist", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-missing-"));

    await openclawCodeBlueprintShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      blueprintPath: path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      exists: false,
      schemaVersion: null,
      status: null,
      title: null,
      hasAgreementCheckpoint: false,
      revisionId: null,
      contentSha256: null,
      defaultedSectionCount: 0,
    });
  });

  it("records the explicit blueprint agreement checkpoint", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-agree-"));
    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Agreement Blueprint",
        "status: clarified",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Agreement Blueprint",
        "",
        "## Goal",
        "Ship a repeatable blueprint agreement flow.",
        "",
        "## Success Criteria",
        "- Operators can agree the blueprint after clarifications are resolved.",
        "",
        "## Scope",
        "- In scope: repo-local blueprint agreement.",
        "- Out of scope: live operator proof in this test.",
        "",
        "## Non-Goals",
        "- Replace the runtime orchestration model.",
        "",
        "## Constraints",
        "- Keep the blueprint machine-readable.",
        "",
        "## Risks",
        "- Invalid placeholders could block agreement.",
        "",
        "## Assumptions",
        "- The operator can answer clarification prompts.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Codex",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- [ ] Capture the agreed target in a validated blueprint.",
        "",
        "## Open Questions",
        "- None.",
        "",
      ].join("\n"),
      "utf8",
    );
    runtime.log.mockClear();

    await openclawCodeBlueprintSetStatusCommand(
      {
        repoRoot,
        status: "agreed",
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.status).toBe("agreed");
    expect(payload.hasAgreementCheckpoint).toBe(true);
    expect(payload.agreedAt).toMatch(/^202\d-/);
    const content = await readFile(path.join(repoRoot, "PROJECT-BLUEPRINT.md"), "utf8");
    expect(content).toContain("status: agreed");
    expect(content).toContain("agreedAt:");
  });

  it("blocks blueprint agreement while validation errors remain", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-agree-blocked-"));

    await openclawCodeBlueprintInitCommand(
      {
        repoRoot,
        title: "Blocked Agreement Blueprint",
      },
      runtime,
    );
    runtime.log.mockClear();

    await expect(
      openclawCodeBlueprintSetStatusCommand(
        {
          repoRoot,
          status: "agreed",
          json: true,
        },
        runtime,
      ),
    ).rejects.toThrow(/Cannot mark the blueprint as agreed/);
  });

  it("updates one blueprint provider role and refreshes routing artifacts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-route-set-"));

    await openclawCodeBlueprintInitCommand(
      {
        repoRoot,
        title: "Routing Blueprint",
      },
      runtime,
    );
    runtime.log.mockClear();

    await openclawCodeBlueprintSetProviderRoleCommand(
      {
        repoRoot,
        role: "reviewer",
        provider: "Claude Code",
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.updatedRole).toBe("reviewer");
    expect(payload.provider).toBe("Claude Code");
    expect(payload.blueprint.providerRoleAssignments.reviewer).toBe("Claude Code");
    expect(payload.roleRouting.routes).toContainEqual(
      expect.objectContaining({
        roleId: "reviewer",
        rawAssignment: "Claude Code",
        adapterId: "claude-code",
      }),
    );
    expect(payload.stageGates.gates).toContainEqual(
      expect.objectContaining({
        gateId: "execution-routing",
      }),
    );
    const content = await readFile(path.join(repoRoot, "PROJECT-BLUEPRINT.md"), "utf8");
    expect(content).toContain("- Reviewer: Claude Code");
  });

  it("updates one blueprint section and refreshes clarification and gate artifacts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-section-set-"));

    await openclawCodeBlueprintSetSectionCommand(
      {
        repoRoot,
        section: "goal",
        body: "Capture blueprint-first goals from chat before issue creation starts.",
        createIfMissing: true,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.updatedSection).toBe("Goal");
    expect(payload.blueprint.goalSummary).toBe(
      "Capture blueprint-first goals from chat before issue creation starts.",
    );
    expect(payload.clarification.questions).not.toContain(
      "Replace the default Goal placeholder with the actual project objective.",
    );
    expect(payload.stageGates.gates).toContainEqual(
      expect.objectContaining({
        gateId: "goal-agreement",
      }),
    );
    const content = await readFile(path.join(repoRoot, "PROJECT-BLUEPRINT.md"), "utf8");
    expect(content).toContain(
      "Capture blueprint-first goals from chat before issue creation starts.",
    );
    expect(content).toContain("updated `Goal` via openclawcode blueprint workflow.");
  });

  it("reports clarification questions and suggestions for the default blueprint scaffold", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-clarify-"));

    await openclawCodeBlueprintInitCommand(
      {
        repoRoot,
      },
      runtime,
    );
    runtime.log.mockClear();

    await openclawCodeBlueprintClarifyCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.exists).toBe(true);
    expect(payload.questionCount).toBeGreaterThan(0);
    expect(payload.suggestionCount).toBeGreaterThan(0);
    expect(payload.priorityQuestion).toBe(
      "Replace the default Goal placeholder with the actual project objective.",
    );
    expect(payload.questions).toContain(
      "Replace the default Goal placeholder with the actual project objective.",
    );
    expect(payload.questions).toContain(
      "Break the blueprint into initial workstreams before autonomous issue creation.",
    );
    expect(payload.validationErrorCount).toBeGreaterThan(0);
    expect(payload.validationErrors).toContain(
      "Section still uses the default scaffold text: Goal.",
    );
    expect(payload.suggestions).toContain(
      "When the team agrees on the target, record it with `openclaw code blueprint-set-status --status agreed`.",
    );
  });

  it("reports a missing-blueprint clarification question before the scaffold exists", async () => {
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-blueprint-clarify-missing-"),
    );

    await openclawCodeBlueprintClarifyCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.exists).toBe(false);
    expect(payload.questionCount).toBe(1);
    expect(payload.questions[0]).toContain("No project blueprint exists yet.");
  });

  it("derives and persists repo-local work items from an agreed blueprint", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-decompose-"));
    const blueprintPath = path.join(repoRoot, "PROJECT-BLUEPRINT.md");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Delivery Blueprint",
        "status: agreed",
        "createdAt: 2026-03-16T00:00:00.000Z",
        "updatedAt: 2026-03-16T00:00:00.000Z",
        "statusChangedAt: 2026-03-16T00:00:00.000Z",
        "agreedAt: 2026-03-16T00:00:00.000Z",
        "---",
        "",
        "# Delivery Blueprint",
        "",
        "## Goal",
        "Ship a blueprint-first operator flow that another teammate can repeat.",
        "",
        "## Success Criteria",
        "- `openclaw code blueprint-decompose` writes work items.",
        "- `openclaw code work-items-show --json` reports a stable artifact.",
        "",
        "## Scope",
        "- In scope: repo-local planning artifacts and issue-draft projection.",
        "- Out of scope: live provider routing changes.",
        "",
        "## Non-Goals",
        "- Rebuild the existing GitHub workflow engine.",
        "",
        "## Constraints",
        "- Technical: stay compatible with the current issue-driven runtime.",
        "- Product: preserve machine-readable artifacts.",
        "- Operational: keep the flow deterministic.",
        "",
        "## Risks",
        "- The blueprint may still be too vague for issue projection.",
        "",
        "## Assumptions",
        "- The operator wants GitHub issue drafts, not direct issue creation, in this phase.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "- Issue projection: operator may intervene",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Build repo-local work item inventory persistence.",
        "- Generate GitHub issue drafts from blueprint-derived work items.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-16: blueprint agreed for decomposition testing.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      inventoryPath: path.join(repoRoot, ".openclawcode", "work-items.json"),
      exists: true,
      schemaVersion: 1,
      blueprintExists: true,
      blueprintStatus: "agreed",
      readyForIssueProjection: true,
      workItemCount: 2,
      plannedWorkItemCount: 2,
      discoveredWorkItemCount: 0,
      blockerCount: 0,
    });
    expect(payload.workItems[0]).toMatchObject({
      id: "planned-01-build-repo-local-work-item-inventory-persistence",
      kind: "planned",
      status: "planned",
      class: "feature",
      executionMode: "feature",
      title: "Build repo-local work item inventory persistence.",
      workstreamIndex: 1,
    });
    expect(payload.workItems[0].fingerprint).toMatch(/^[a-f0-9]{40}$/);
    expect(payload.workItems[0].githubIssue).toEqual({
      current: null,
      history: [],
    });
    expect(payload.workItems[0].providerRoleAssignments).toMatchObject({
      planner: "Claude Code",
      coder: "Codex",
      reviewer: "Claude Code",
      verifier: "Codex",
      docWriter: "Codex",
    });
    expect(payload.workItems[0].githubIssueDraft.title).toBe(
      "[Blueprint]: Build repo-local work item inventory persistence.",
    );
    expect(payload.workItems[0].githubIssueDraft.body).toContain("Delivery policy");
    expect(payload.workItems[0].githubIssueDraft.body).toContain("Testing policy");
    expect(payload.workItems[0].githubIssueDraft.body).toContain("- Execution mode: Feature");
    const artifact = JSON.parse(
      await readFile(path.join(repoRoot, ".openclawcode", "work-items.json"), "utf8"),
    );
    expect(artifact.workItemCount).toBe(2);
  });

  it("adds bug-triage and refactor guardrails to blueprint-derived issue drafts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-work-item-guidance-"));
    const blueprintPath = path.join(repoRoot, "PROJECT-BLUEPRINT.md");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Guided Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Guided Blueprint",
        "",
        "## Goal",
        "Improve issue shaping for bug fixes and refactors.",
        "",
        "## Success Criteria",
        "- A bug-fix draft asks for reproduction and regression proof.",
        "- A refactor draft preserves working-state guardrails.",
        "",
        "## Scope",
        "- In scope: issue-draft policy.",
        "",
        "## Non-Goals",
        "- Live execution.",
        "",
        "## Constraints",
        "- Keep the drafts machine-readable.",
        "",
        "## Risks",
        "- Generic issue templates lead to shallow execution.",
        "",
        "## Assumptions",
        "- Workstream wording can drive issue policy.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "",
        "## Workstreams",
        "- Fix duplicate issue materialization when the blueprint revision changes.",
        "- Refactor role-routing summary formatting into a dedicated module.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: guidance baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workItems[0].class).toBe("bugfix");
    expect(payload.workItems[0].executionMode).toBe("bugfix");
    expect(payload.workItems[0].githubIssueDraft.body).toContain("Bug triage expectations");
    expect(payload.workItems[0].githubIssueDraft.body).toContain(
      "Add a regression proof before or alongside the fix",
    );
    expect(payload.workItems[1].executionMode).toBe("refactor");
    expect(payload.workItems[1].githubIssueDraft.body).toContain("Refactor guardrails");
    expect(payload.workItems[1].githubIssueDraft.body).toContain(
      "Keep the repository working after each small checkpoint.",
    );
  });

  it("classifies blueprint-derived work items into richer work-item classes", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-work-item-classes-"));
    const blueprintPath = path.join(repoRoot, "PROJECT-BLUEPRINT.md");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Work Item Classes Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Work Item Classes Blueprint",
        "",
        "## Goal",
        "Classify blueprint work into richer internal classes.",
        "",
        "## Success Criteria",
        "- Docs, sync, validation, and incident slices classify distinctly.",
        "",
        "## Scope",
        "- In scope: work-item metadata only.",
        "",
        "## Non-Goals",
        "- Live execution.",
        "",
        "## Constraints",
        "- Keep the result machine-readable.",
        "",
        "## Risks",
        "- Flat classification would hide planning differences.",
        "",
        "## Assumptions",
        "- Workstream wording is descriptive enough.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "",
        "## Workstreams",
        "- Document the new-machine install runbook for operators.",
        "- Sync upstream main into the mirrored fork branch.",
        "- Validate the bootstrap flow on a clean host.",
        "- Ship a hotfix for the pairing outage.",
        "",
        "## Open Questions",
        "- None.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workItems.map((item: { class: string }) => item.class)).toEqual([
      "docs",
      "sync",
      "validation",
      "incident",
    ]);
  });

  it("preserves work-item ids, status, and GitHub links across incremental re-decomposition", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-work-item-incremental-"));
    const blueprintPath = path.join(repoRoot, "PROJECT-BLUEPRINT.md");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Incremental Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Incremental Blueprint",
        "",
        "## Goal",
        "Preserve incremental backlog state when the blueprint changes.",
        "",
        "## Success Criteria",
        "- Existing work keeps its id and status.",
        "- Removed work becomes superseded instead of disappearing.",
        "",
        "## Scope",
        "- In scope: work-item inventory behavior.",
        "",
        "## Non-Goals",
        "- Live execution.",
        "",
        "## Constraints",
        "- Keep state deterministic.",
        "",
        "## Risks",
        "- Rebuilding the backlog could drop operator context.",
        "",
        "## Assumptions",
        "- Workstream text stays stable for preserved items.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "",
        "## Workstreams",
        "- Build the stable backlog projection layer.",
        "- Validate incremental decomposition after blueprint edits.",
        "",
        "## Open Questions",
        "- None.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const inventoryPath = path.join(repoRoot, ".openclawcode", "work-items.json");
    const firstPass = JSON.parse(await readFile(inventoryPath, "utf8"));
    const preservedItem = firstPass.workItems[1];
    preservedItem.status = "queued";
    preservedItem.githubIssue = {
      current: {
        issueNumber: 55,
        issueUrl: "https://github.com/openclaw/openclaw/issues/55",
        issueTitle: "[Blueprint]: Validate incremental decomposition after blueprint edits.",
        issueState: "open",
        linkedAt: "2026-03-20T00:10:00.000Z",
        linkedFrom: "created",
        blueprintRevisionId: firstPass.blueprintRevisionId,
      },
      history: [
        {
          issueNumber: 55,
          issueUrl: "https://github.com/openclaw/openclaw/issues/55",
          issueTitle: "[Blueprint]: Validate incremental decomposition after blueprint edits.",
          issueState: "open",
          linkedAt: "2026-03-20T00:10:00.000Z",
          linkedFrom: "created",
          blueprintRevisionId: firstPass.blueprintRevisionId,
        },
      ],
    };
    await writeFile(inventoryPath, `${JSON.stringify(firstPass, null, 2)}\n`, "utf8");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Incremental Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T01:00:00.000Z",
        "statusChangedAt: 2026-03-20T01:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Incremental Blueprint",
        "",
        "## Goal",
        "Preserve incremental backlog state when the blueprint changes.",
        "",
        "## Success Criteria",
        "- Existing work keeps its id and status.",
        "- Removed work becomes superseded instead of disappearing.",
        "",
        "## Scope",
        "- In scope: work-item inventory behavior.",
        "",
        "## Non-Goals",
        "- Live execution.",
        "",
        "## Constraints",
        "- Keep state deterministic.",
        "",
        "## Risks",
        "- Rebuilding the backlog could drop operator context.",
        "",
        "## Assumptions",
        "- Workstream text stays stable for preserved items.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "",
        "## Workstreams",
        "- Validate incremental decomposition after blueprint edits.",
        "- Add a new workstream after backlog churn.",
        "",
        "## Open Questions",
        "- None.",
        "",
      ].join("\n"),
      "utf8",
    );

    runtime.log.mockClear();
    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workItemCount).toBe(2);
    expect(payload.supersededWorkItemCount).toBe(1);
    expect(payload.workItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: preservedItem.id,
          title: "Validate incremental decomposition after blueprint edits.",
          status: "queued",
          githubIssue: expect.objectContaining({
            current: expect.objectContaining({
              issueNumber: 55,
            }),
          }),
        }),
        expect.objectContaining({
          title: "Build the stable backlog projection layer.",
          status: "superseded",
        }),
        expect.objectContaining({
          title: "Add a new workstream after backlog churn.",
          status: "planned",
        }),
      ]),
    );
  });

  it("shows missing repo-local work-item inventory before decomposition has run", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-work-items-missing-"));

    await openclawCodeWorkItemsShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      inventoryPath: path.join(repoRoot, ".openclawcode", "work-items.json"),
      exists: false,
      blueprintExists: false,
      workItemCount: 0,
      artifactStale: null,
    });
  });

  it("reports a stale work-item artifact when the blueprint revision has changed", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-work-items-stale-"));
    const blueprintPath = path.join(repoRoot, "PROJECT-BLUEPRINT.md");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Stale Blueprint",
        "status: agreed",
        "createdAt: 2026-03-16T00:00:00.000Z",
        "updatedAt: 2026-03-16T00:00:00.000Z",
        "statusChangedAt: 2026-03-16T00:00:00.000Z",
        "agreedAt: 2026-03-16T00:00:00.000Z",
        "---",
        "",
        "# Stale Blueprint",
        "",
        "## Goal",
        "Ship stale detection.",
        "",
        "## Success Criteria",
        "- Preserve a work-item artifact.",
        "",
        "## Scope",
        "- In scope: stale detection.",
        "- Out of scope: live execution.",
        "",
        "## Non-Goals",
        "- None.",
        "",
        "## Constraints",
        "- Technical: keep the file machine-readable.",
        "",
        "## Risks",
        "- Drift between blueprint and work-item artifact.",
        "",
        "## Assumptions",
        "- A stale artifact should be flagged.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "",
        "## Workstreams",
        "- Emit artifact stale signals.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-16: stale detection baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );
    runtime.log.mockClear();

    const updatedContent = (await readFile(blueprintPath, "utf8")).replace(
      "Emit artifact stale signals.",
      "Emit artifact stale signals after blueprint edits.",
    );
    await writeFile(blueprintPath, updatedContent, "utf8");

    await openclawCodeWorkItemsShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.exists).toBe(true);
    expect(payload.artifactStale).toBe(true);
  });

  it("selects the first blueprint-backed work item when execution is ready", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-next-work-ready-"));

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Next Work Ready Blueprint",
        "status: agreed",
        "createdAt: 2026-03-19T00:00:00.000Z",
        "updatedAt: 2026-03-19T00:00:00.000Z",
        "statusChangedAt: 2026-03-19T00:00:00.000Z",
        "agreedAt: 2026-03-19T00:00:00.000Z",
        "---",
        "",
        "# Next Work Ready Blueprint",
        "",
        "## Goal",
        "Select the next blueprint-backed work item when all prerequisites are satisfied.",
        "",
        "## Success Criteria",
        "- The next-work command returns a ready-to-execute decision.",
        "",
        "## Scope",
        "- In scope: machine-readable next-work selection.",
        "",
        "## Non-Goals",
        "- Issue creation.",
        "",
        "## Constraints",
        "- Keep the first selection deterministic.",
        "",
        "## Risks",
        "- Hidden blockers could derail autonomous progress.",
        "",
        "## Assumptions",
        "- All operator-facing prerequisites are already satisfied.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Ship the next-work selection artifact.",
        "- Surface the next decision in chat.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-19: ready-selection baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );
    runtime.log.mockClear();

    await openclawCodeNextWorkShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      decision: "ready-to-execute",
      canContinueAutonomously: true,
      blockingGateId: null,
      workItemCount: 2,
      discoveryEvidenceCount: 0,
      unresolvedRoleCount: 0,
      selectedWorkItem: {
        id: "planned-01-ship-the-next-work-selection-artifact",
        selectedFrom: "work-item-inventory",
        executionMode: "feature",
        workstreamIndex: 1,
        title: "Ship the next-work selection artifact.",
      },
    });
  });

  it("holds refactor work behind execution-start human approval in next-work selection", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-next-work-refactor-"));

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Next Work Refactor Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Next Work Refactor Blueprint",
        "",
        "## Goal",
        "Require an explicit execution-start decision for structural refactors.",
        "",
        "## Success Criteria",
        "- The next-work command blocks on human approval for refactor slices.",
        "",
        "## Scope",
        "- In scope: execution-start gating for refactors.",
        "",
        "## Non-Goals",
        "- Live execution.",
        "",
        "## Constraints",
        "- Keep the selected work item deterministic.",
        "",
        "## Risks",
        "- Structural work can drift without an explicit checkpoint.",
        "",
        "## Assumptions",
        "- The blueprint is already agreed.",
        "",
        "## Human Gates",
        "- Execution start: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Refactor role-routing orchestration into a dedicated planning module.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: refactor execution-start baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();

    await openclawCodeNextWorkShowCommand({ repoRoot, json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.decision).toBe("blocked-on-human");
    expect(payload.blockingGateId).toBe("execution-start");
    expect(payload.canContinueAutonomously).toBe(false);
    expect(payload.selectedWorkItem).toMatchObject({
      executionMode: "refactor",
      workstreamIndex: 1,
      title: "Refactor role-routing orchestration into a dedicated planning module.",
    });
    expect(payload.blockers).toContain(
      "Selected refactor slice requires explicit execution-start approval: Refactor role-routing orchestration into a dedicated planning module.",
    );
  });

  it("unblocks refactor next-work selection after execution-start approval is recorded", async () => {
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-next-work-refactor-approved-"),
    );

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Next Work Refactor Approval Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Next Work Refactor Approval Blueprint",
        "",
        "## Goal",
        "Allow autonomous progress after execution-start is explicitly approved.",
        "",
        "## Success Criteria",
        "- Refactor work becomes ready-to-execute once execution-start is approved.",
        "",
        "## Scope",
        "- In scope: next-work alignment with stage-gate decisions.",
        "",
        "## Non-Goals",
        "- Live execution.",
        "",
        "## Constraints",
        "- Keep the selected work item deterministic.",
        "",
        "## Risks",
        "- Approved work could still appear blocked if next-work ignores gate state.",
        "",
        "## Assumptions",
        "- The blueprint is already agreed.",
        "",
        "## Human Gates",
        "- Execution start: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Refactor role-routing orchestration into a dedicated planning module.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: next-work approval alignment baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    await openclawCodeStageGatesDecideCommand(
      {
        repoRoot,
        gate: "execution-start",
        decision: "approved",
        actor: "operator",
        note: "Accepted for this run.",
        json: true,
      },
      runtime,
    );
    runtime.log.mockClear();

    await openclawCodeNextWorkShowCommand({ repoRoot, json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.decision).toBe("ready-to-execute");
    expect(payload.blockingGateId).toBeNull();
    expect(payload.canContinueAutonomously).toBe(true);
    expect(payload.selectedWorkItem).toMatchObject({
      executionMode: "refactor",
      workstreamIndex: 1,
      title: "Refactor role-routing orchestration into a dedicated planning module.",
    });
    expect(payload.suggestions).toContain("Accepted for this run.");
  });

  it("surfaces missing clarification as the reason autonomous progress cannot continue", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-next-work-clarify-"));

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Next Work Clarification Blueprint",
        "status: draft",
        "createdAt: 2026-03-19T00:00:00.000Z",
        "updatedAt: 2026-03-19T00:00:00.000Z",
        "statusChangedAt: 2026-03-19T00:00:00.000Z",
        "---",
        "",
        "# Next Work Clarification Blueprint",
        "",
        "## Goal",
        "Clarify the missing project target before choosing execution work.",
        "",
        "## Success Criteria",
        "- None yet.",
        "",
        "## Scope",
        "- In scope: clarification handling.",
        "",
        "## Non-Goals",
        "- Autonomous execution.",
        "",
        "## Constraints",
        "- Keep the ambiguity visible.",
        "",
        "## Risks",
        "- Wrong work could be selected too early.",
        "",
        "## Assumptions",
        "- None yet.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "",
        "## Workstreams",
        "- None.",
        "",
        "## Open Questions",
        "- Which repository outcome matters most right now?",
        "",
        "## Change Log",
        "- 2026-03-19: clarification baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    runtime.log.mockClear();
    await openclawCodeNextWorkShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.decision).toBe("blocked-on-missing-clarification");
    expect(payload.canContinueAutonomously).toBe(false);
    expect(payload.blockingGateId).toBe("work-item-projection");
    expect(payload.blockers.length).toBeGreaterThan(0);
    expect(payload.suggestions.length).toBeGreaterThan(0);
  });

  it("selects discovery-maintenance work first when the work-item artifact is stale", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-next-work-discovery-"));
    const blueprintPath = path.join(repoRoot, "PROJECT-BLUEPRINT.md");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Next Work Discovery Blueprint",
        "status: agreed",
        "createdAt: 2026-03-19T00:00:00.000Z",
        "updatedAt: 2026-03-19T00:00:00.000Z",
        "statusChangedAt: 2026-03-19T00:00:00.000Z",
        "agreedAt: 2026-03-19T00:00:00.000Z",
        "---",
        "",
        "# Next Work Discovery Blueprint",
        "",
        "## Goal",
        "Prioritize stale-artifact maintenance before continuing blueprint execution.",
        "",
        "## Success Criteria",
        "- The next-work command prefers stale-artifact discovery work.",
        "",
        "## Scope",
        "- In scope: discovery precedence.",
        "",
        "## Non-Goals",
        "- Live issue creation.",
        "",
        "## Constraints",
        "- Keep the selection deterministic.",
        "",
        "## Risks",
        "- A stale backlog could misdirect future issue materialization.",
        "",
        "## Assumptions",
        "- The blueprint was already agreed before the edit.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Ship the initial artifact snapshot.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-19: discovery precedence baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );
    runtime.log.mockClear();

    const updatedContent = (await readFile(blueprintPath, "utf8")).replace(
      "Ship the initial artifact snapshot.",
      "Ship the initial artifact snapshot after the blueprint edit.",
    );
    await writeFile(blueprintPath, updatedContent, "utf8");

    await openclawCodeNextWorkShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.decision).toBe("blocked-on-human");
    expect(payload.blockingGateId).toBe("execution-start");
    expect(payload.discoveryEvidenceCount).toBeGreaterThan(0);
    expect(payload.selectedWorkItem).toMatchObject({
      id: "discovered-refresh-stale-work-item-artifact",
      selectedFrom: "discovery",
      workstreamIndex: null,
      title: "Refresh the repo-local work-item inventory after blueprint changes.",
    });
  });

  it("materializes the selected work item into a GitHub issue artifact", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-issue-materialize-"));

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Issue Materialization Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Issue Materialization Blueprint",
        "",
        "## Goal",
        "Create or reuse a GitHub issue for the selected work item.",
        "",
        "## Success Criteria",
        "- The selected work item materializes into one GitHub issue artifact.",
        "",
        "## Scope",
        "- In scope: issue materialization.",
        "",
        "## Non-Goals",
        "- Execution.",
        "",
        "## Constraints",
        "- Keep the mapping deterministic.",
        "",
        "## Risks",
        "- Duplicate issues could appear without stable markers.",
        "",
        "## Assumptions",
        "- GitHub auth is already available.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Materialize the selected work item into a GitHub issue.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: issue materialization baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    mocks.createIssue.mockResolvedValueOnce({
      owner: "openclaw",
      repo: "openclaw",
      number: 321,
      title: "[Blueprint]: Materialize the selected work item into a GitHub issue.",
      body: "Issue body",
      labels: [],
      url: "https://github.com/openclaw/openclaw/issues/321",
    });
    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    runtime.log.mockClear();
    await openclawCodeIssueMaterializeCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      outcome: "created",
      selectedWorkItemId: "planned-01-materialize-the-selected-work-item-into-a-github",
      selectedWorkItemExecutionMode: "feature",
      selectedIssueNumber: 321,
      selectedIssueUrl: "https://github.com/openclaw/openclaw/issues/321",
    });
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);

    runtime.log.mockClear();
    await openclawCodeIssueMaterializationShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const shown = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(shown.entries).toEqual([
      expect.objectContaining({
        workItemId: "planned-01-materialize-the-selected-work-item-into-a-github",
        issueNumber: 321,
        reusedExisting: false,
        stale: false,
      }),
    ]);

    const workItems = JSON.parse(
      await readFile(path.join(repoRoot, ".openclawcode", "work-items.json"), "utf8"),
    );
    expect(workItems.workItems[0].githubIssue.current).toMatchObject({
      issueNumber: 321,
      issueUrl: "https://github.com/openclaw/openclaw/issues/321",
      linkedFrom: "created",
    });
  });

  it("reuses an existing linked GitHub issue after blueprint revision changes without reopening duplicates", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-issue-materialize-reuse-"));
    const blueprintPath = path.join(repoRoot, "PROJECT-BLUEPRINT.md");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Reuse Materialization Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Reuse Materialization Blueprint",
        "",
        "## Goal",
        "Reuse linked issues when the blueprint revision changes but the work item does not.",
        "",
        "## Success Criteria",
        "- Issue materialization reuses the existing issue after a non-functional blueprint edit.",
        "",
        "## Scope",
        "- In scope: issue projection reuse.",
        "",
        "## Non-Goals",
        "- Execution.",
        "",
        "## Constraints",
        "- Keep markers deterministic.",
        "",
        "## Risks",
        "- Revision churn could reopen duplicates.",
        "",
        "## Assumptions",
        "- The work item text stays the same.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Materialize one stable work item into GitHub.",
        "",
        "## Open Questions",
        "- None.",
        "",
      ].join("\n"),
      "utf8",
    );

    mocks.createIssue.mockResolvedValueOnce({
      owner: "openclaw",
      repo: "openclaw",
      number: 444,
      title: "[Blueprint]: Materialize one stable work item into GitHub.",
      body: "Issue body",
      labels: [],
      url: "https://github.com/openclaw/openclaw/issues/444",
    });

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeIssueMaterializeCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        json: true,
      },
      runtime,
    );

    const createdIssueBody = String(mocks.createIssue.mock.calls.at(-1)?.[0]?.body ?? "");

    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Reuse Materialization Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T02:00:00.000Z",
        "statusChangedAt: 2026-03-20T02:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Reuse Materialization Blueprint",
        "",
        "## Goal",
        "Reuse linked issues when the blueprint revision changes but the work item does not.",
        "",
        "## Success Criteria",
        "- Issue materialization reuses the existing issue after a non-functional blueprint edit.",
        "- The changelog can move without reopening duplicates.",
        "",
        "## Scope",
        "- In scope: issue projection reuse.",
        "",
        "## Non-Goals",
        "- Execution.",
        "",
        "## Constraints",
        "- Keep markers deterministic.",
        "",
        "## Risks",
        "- Revision churn could reopen duplicates.",
        "",
        "## Assumptions",
        "- The work item text stays the same.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Materialize one stable work item into GitHub.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: revised metadata only.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    mocks.listIssues.mockResolvedValueOnce([
      {
        owner: "openclaw",
        repo: "openclaw",
        number: 444,
        title: "[Blueprint]: Materialize one stable work item into GitHub.",
        body: createdIssueBody,
        labels: [],
        url: "https://github.com/openclaw/openclaw/issues/444",
        state: "open",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ]);

    runtime.log.mockClear();
    await openclawCodeIssueMaterializeCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.outcome).toBe("reused");
    expect(payload.selectedIssueNumber).toBe(444);
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
  });

  it("summarizes project progress and the autonomous loop artifact", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-project-progress-"));

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Project Progress Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Project Progress Blueprint",
        "",
        "## Goal",
        "Summarize blueprint-aware project progress.",
        "",
        "## Success Criteria",
        "- Progress includes the selected work item and issue materialization result.",
        "",
        "## Scope",
        "- In scope: progress and loop artifacts.",
        "",
        "## Non-Goals",
        "- Real queue execution.",
        "",
        "## Constraints",
        "- Keep the artifact machine-readable.",
        "",
        "## Risks",
        "- Status could drift without a unified summary.",
        "",
        "## Assumptions",
        "- The repository can resolve its GitHub remote.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Show blueprint-aware progress in one artifact.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: progress baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    mocks.createIssue.mockResolvedValueOnce({
      owner: "openclaw",
      repo: "openclaw",
      number: 654,
      title: "[Blueprint]: Show blueprint-aware progress in one artifact.",
      body: "Issue body",
      labels: [],
      url: "https://github.com/openclaw/openclaw/issues/654",
    });
    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    runtime.log.mockClear();
    await openclawCodeProjectProgressShowCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        json: true,
      },
      runtime,
    );

    const progress = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(progress).toMatchObject({
      repoRoot,
      exists: true,
      nextWorkDecision: "ready-to-execute",
      nextWorkPrimaryBlocker: null,
      activeWorkstreamIndex: 1,
      activeWorkstreamCount: 1,
      activeWorkstreamTitle: "Show blueprint-aware progress in one artifact.",
      activeWorkstreamSummary:
        "Workstream 1/1 | Show blueprint-aware progress in one artifact.",
      nextSuggestedCommand:
        `openclaw code issue-materialize --repo-root ${repoRoot}`,
      nextSuggestedChatCommand: "/occode-materialize openclaw/openclaw",
      selectedWorkItemId: "planned-01-show-blueprint-aware-progress-in-one-artifact",
      selectedWorkItemExecutionMode: "feature",
      selectedIssueNumber: null,
    });

    runtime.log.mockClear();
    await openclawCodeAutonomousLoopRunCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        once: true,
        json: true,
      },
      runtime,
    );

    const loop = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(loop).toMatchObject({
      repoRoot,
      exists: true,
      mode: "once",
      status: "materialized-only",
      requestedIterationCount: 1,
      completedIterationCount: 1,
      nextWorkDecision: "ready-to-execute",
      activeWorkstreamIndex: 1,
      activeWorkstreamCount: 1,
      activeWorkstreamTitle: "Show blueprint-aware progress in one artifact.",
      activeWorkstreamSummary:
        "Workstream 1/1 | Show blueprint-aware progress in one artifact.",
      nextSuggestedCommand:
        `openclaw code run --issue 654 --repo-root ${repoRoot}`,
      nextSuggestedChatCommand: "/occode-start openclaw/openclaw#654",
      selectedWorkItemId: "planned-01-show-blueprint-aware-progress-in-one-artifact",
      selectedWorkItemExecutionMode: "feature",
      selectedIssueNumber: 654,
    });
    expect(loop.iterations).toEqual([
      expect.objectContaining({
        iteration: 1,
        status: "materialized-only",
        selectedIssueNumber: 654,
      }),
    ]);

    runtime.log.mockClear();
    await openclawCodeAutonomousLoopRunCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        once: true,
        json: false,
      },
      runtime,
    );

    const loopLines = runtime.log.mock.calls.map((call) => String(call[0]));
    expect(loopLines).toContain("Mode: once");
    expect(loopLines).toContain("Status: materialized-only");
    expect(loopLines).toContain(
      "Active workstream: Workstream 1/1 | Show blueprint-aware progress in one artifact.",
    );
    expect(
      loopLines.some((line) =>
        line.startsWith("Next suggested command: openclaw code run --issue ") &&
        line.endsWith(` --repo-root ${repoRoot}`),
      ),
    ).toBe(true);
    expect(
      loopLines.some((line) =>
        line.startsWith("Next suggested chat command: /occode-start openclaw/openclaw#"),
      ),
    ).toBe(true);
    expect(loopLines).toContain("Iteration history:");
    expect(
      loopLines.some((line) =>
        line.startsWith("- 1: status=materialized-only | decision=ready-to-execute | issue=#") &&
        line.includes(
          " | message=Materialized the next issue. | workstream=Workstream 1/1 | Show blueprint-aware progress in one artifact.",
        ),
      ),
    ).toBe(true);

    runtime.log.mockClear();
    await openclawCodeAutonomousLoopShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const shown = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(shown.status).toBe("materialized-only");
    expect(typeof shown.selectedIssueNumber).toBe("number");
    expect(shown.selectedWorkItemExecutionMode).toBe("feature");
  });

  it("keeps autonomous loop blocked with explicit execution-mode context for refactor work", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-autonomous-loop-refactor-"));

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Refactor Loop Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Refactor Loop Blueprint",
        "",
        "## Goal",
        "Keep refactor work paused until execution-start is explicitly approved.",
        "",
        "## Success Criteria",
        "- The autonomous loop stays blocked with a clear reason for refactor work.",
        "",
        "## Scope",
        "- In scope: execution-mode-aware autonomous blocking.",
        "",
        "## Non-Goals",
        "- Real queue execution.",
        "",
        "## Constraints",
        "- Keep the stop reason machine-readable enough for operators.",
        "",
        "## Risks",
        "- Structural work could auto-start without an explicit checkpoint.",
        "",
        "## Assumptions",
        "- The repository can resolve its GitHub remote.",
        "",
        "## Human Gates",
        "- Execution start: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Refactor autonomous-loop queue handoff into a dedicated coordinator.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: autonomous-loop refactor baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeAutonomousLoopRunCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        once: true,
        json: true,
      },
      runtime,
    );

    const loop = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(loop).toMatchObject({
      repoRoot,
      exists: true,
      status: "blocked",
      nextWorkDecision: "blocked-on-human",
      nextWorkBlockingGateId: "execution-start",
      selectedWorkItemExecutionMode: "refactor",
    });
    expect(loop.selectedWorkItemId).toContain(
      "refactor-autonomous-loop-queue-handoff-into-a-de",
    );
    expect(loop.nextWorkPrimaryBlocker).toBe(
      "Selected refactor slice requires explicit execution-start approval: Refactor autonomous-loop queue handoff into a dedicated coordinator.",
    );
    expect(loop.nextSuggestedCommand).toBe(
      `openclaw code stage-gates-show --repo-root ${repoRoot}`,
    );
    expect(loop.nextSuggestedChatCommand).toBe("/occode-gates openclaw/openclaw");
    expect(loop.activeWorkstreamSummary).toBe(
      "Workstream 1/1 | Refactor autonomous-loop queue handoff into a dedicated coordinator.",
    );
  });

  it("allows autonomous loop materialization after execution-start approval for refactor work", async () => {
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-autonomous-loop-refactor-approved-"),
    );

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Refactor Loop Approved Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Refactor Loop Approved Blueprint",
        "",
        "## Goal",
        "Allow refactor autopilot progress after execution-start is approved.",
        "",
        "## Success Criteria",
        "- The autonomous loop materializes the refactor issue after approval.",
        "",
        "## Scope",
        "- In scope: autonomous-loop alignment with stage-gate decisions.",
        "",
        "## Non-Goals",
        "- Real queue execution.",
        "",
        "## Constraints",
        "- Keep the stop reason machine-readable.",
        "",
        "## Risks",
        "- Approved refactor work could still appear blocked if the loop ignores gate state.",
        "",
        "## Assumptions",
        "- The repository can resolve its GitHub remote.",
        "",
        "## Human Gates",
        "- Execution start: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Refactor autonomous-loop queue handoff into a dedicated coordinator.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: approved refactor autopilot baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    mocks.createIssue.mockResolvedValueOnce({
      owner: "openclaw",
      repo: "openclaw",
      number: 811,
      title: "[Blueprint]: Refactor autonomous-loop queue handoff into a dedicated coordinator.",
      body: "Issue body",
      labels: [],
      url: "https://github.com/openclaw/openclaw/issues/811",
    });

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    await openclawCodeStageGatesDecideCommand(
      {
        repoRoot,
        gate: "execution-start",
        decision: "approved",
        actor: "operator",
        note: "Accepted for this run.",
        json: true,
      },
      runtime,
    );
    runtime.log.mockClear();

    await openclawCodeAutonomousLoopRunCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        once: true,
        json: true,
      },
      runtime,
    );

    const loop = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(loop).toMatchObject({
      status: "materialized-only",
      nextWorkDecision: "ready-to-execute",
      nextWorkBlockingGateId: null,
      selectedWorkItemExecutionMode: "refactor",
      selectedIssueNumber: 811,
      stopReason: null,
      message: "Materialized the next issue.",
    });
  });

  it("records repeat-loop iteration history when no queue handoff is configured", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-autonomous-loop-repeat-"));

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Repeat Loop Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Repeat Loop Blueprint",
        "",
        "## Goal",
        "Record supervised repeat-loop progress even before queue handoff is wired in.",
        "",
        "## Success Criteria",
        "- Repeat mode records at least one iteration and a precise stop reason.",
        "",
        "## Scope",
        "- In scope: repeat-loop artifact behavior.",
        "",
        "## Non-Goals",
        "- Real queue execution.",
        "",
        "## Constraints",
        "- Stop cleanly when the next step needs external queue handoff.",
        "",
        "## Risks",
        "- Repeat mode could spin uselessly without a stop condition.",
        "",
        "## Assumptions",
        "- The repository can resolve its GitHub remote.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Show supervised repeat-loop history in the artifact.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: repeat-loop baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeAutonomousLoopRunCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        iterations: 3,
        json: true,
      },
      runtime,
    );

    const loop = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(loop).toMatchObject({
      mode: "repeat",
      status: "materialized-only",
      requestedIterationCount: 3,
      completedIterationCount: 1,
      stopReason:
        "Autonomous loop stopped after materialization because no queue handoff is configured.",
    });
    expect(loop.nextSuggestedCommand).toContain(`openclaw code run --issue `);
    expect(loop.nextSuggestedCommand).toContain(` --repo-root ${repoRoot}`);
    expect(loop.nextSuggestedChatCommand).toBe(
      `/occode-start openclaw/openclaw#${loop.selectedIssueNumber}`,
    );
    expect(loop.activeWorkstreamSummary).toBe(
      "Workstream 1/1 | Show supervised repeat-loop history in the artifact.",
    );
    expect(loop.iterations).toEqual([
      expect.objectContaining({
        iteration: 1,
        status: "materialized-only",
        activeWorkstreamSummary:
          "Workstream 1/1 | Show supervised repeat-loop history in the artifact.",
      }),
    ]);
  });

  it("queues CLI autopilot work through the operator store when repo config exists", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-autonomous-loop-cli-queue-"));
    const stateDir = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-autonomous-loop-cli-queue-state-"),
    );
    const store = OpenClawCodeChatopsStore.fromStateDir(stateDir);

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: CLI Queue Autopilot Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# CLI Queue Autopilot Blueprint",
        "",
        "## Goal",
        "Let CLI autopilot queue the selected issue when operator config exists.",
        "",
        "## Success Criteria",
        "- `openclaw code autonomous-loop-run --once` queues the materialized issue.",
        "",
        "## Scope",
        "- In scope: CLI autopilot queue handoff through operator state.",
        "",
        "## Non-Goals",
        "- Real execution.",
        "",
        "## Constraints",
        "- Reuse the same queue contract as chat autopilot.",
        "",
        "## Risks",
        "- CLI autopilot could stall at materialization even when the operator queue is available.",
        "",
        "## Assumptions",
        "- The repository can resolve its GitHub remote.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Queue CLI autopilot output through the operator store.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: CLI autopilot queue baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(stateDir, "openclaw.json"),
      JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                config: {
                  repos: [
                    {
                      owner: "openclaw",
                      repo: "openclaw",
                      repoRoot,
                      baseBranch: "main",
                      notifyChannel: "telegram",
                      notifyTarget: "chat:primary",
                      builderAgent: "main",
                      verifierAgent: "main",
                      testCommands: ["pnpm test"],
                      openPullRequest: true,
                      mergeOnApprove: false,
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    mocks.createIssue.mockResolvedValueOnce({
      owner: "openclaw",
      repo: "openclaw",
      number: 777,
      title: "[Blueprint]: Queue CLI autopilot output through the operator store.",
      body: "Issue body",
      labels: [],
      url: "https://github.com/openclaw/openclaw/issues/777",
    });

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeAutonomousLoopRunCommand(
      {
        owner: "openclaw",
        repo: "openclaw",
        repoRoot,
        stateDir,
        once: true,
        json: true,
      },
      runtime,
    );

    const loop = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(loop).toMatchObject({
      mode: "once",
      status: "materialized-and-queued",
      selectedIssueNumber: 777,
      queuedIssueKey: "openclaw/openclaw#777",
      nextSuggestedCommand: `openclaw code project-progress-show --repo-root ${repoRoot}`,
      nextSuggestedChatCommand: "/occode-progress openclaw/openclaw",
      message: "Queued openclaw/openclaw#777 after issue materialization.",
    });

    const snapshot = await store.snapshot();
    expect(snapshot.queue).toHaveLength(1);
    expect(snapshot.queue[0]).toMatchObject({
      issueKey: "openclaw/openclaw#777",
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });
    expect(snapshot.queue[0]?.request).toMatchObject({
      owner: "openclaw",
      repo: "openclaw",
      issueNumber: 777,
      repoRoot,
      baseBranch: "main",
    });
    expect(await store.getStatus("openclaw/openclaw#777")).toBe(
      "Queued from openclaw code autonomous-loop-run --once.",
    );
  });

  it("surfaces active-run stage and role routing through project progress and autopilot artifacts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-project-progress-active-run-"));
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "openclawcode-project-progress-active-run-state-"));
    const store = OpenClawCodeChatopsStore.fromStateDir(stateDir);

    vi.stubEnv("OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID", "codex-main");
    vi.stubEnv("OPENCLAWCODE_ADAPTER_CLAUDE_CODE_AGENT_ID", "claude-main");

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Active Run Progress Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Active Run Progress Blueprint",
        "",
        "## Goal",
        "Expose active-run progress context through project-level status surfaces.",
        "",
        "## Success Criteria",
        "- Project progress shows the current run stage and role routing.",
        "",
        "## Scope",
        "- In scope: active-run progress context.",
        "",
        "## Non-Goals",
        "- Real workflow execution.",
        "",
        "## Constraints",
        "- Keep the summary concise and machine-readable.",
        "",
        "## Risks",
        "- Operators may lose track of the live run without a project view.",
        "",
        "## Assumptions",
        "- The blueprint is already agreed.",
        "",
        "## Human Gates",
        "- Merge promotion: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Show active-run stage and role routing in project progress.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: active-run progress baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    await store.setRepoBinding({
      repoKey: "openclaw/openclawcode",
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });
    await store.enqueue(
      {
        issueKey: "openclaw/openclawcode#910",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        request: {
          owner: "openclaw",
          repo: "openclawcode",
          issueNumber: 910,
          repoRoot,
          baseBranch: "main",
          branchName: "openclawcode/issue-910",
          builderAgent: "codex-main",
          verifierAgent: "claude-main",
          testCommands: ["pnpm test"],
          openPullRequest: true,
          mergeOnApprove: false,
        },
      },
      "Queued.",
    );
    await store.startNext("Running.");
    await store.setStatusSnapshot({
      issueKey: "openclaw/openclawcode#910",
      status: "openclawcode status for openclaw/openclawcode#910\nStage: Building",
      stage: "building",
      runId: "run-910",
      updatedAt: "2026-03-20T08:20:00.000Z",
      owner: "openclaw",
      repo: "openclawcode",
      issueNumber: 910,
      branchName: "openclawcode/issue-910",
      pullRequestNumber: 9910,
      pullRequestUrl: "https://github.com/openclaw/openclawcode/pull/9910",
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });

    runtime.log.mockClear();
    await openclawCodeProjectProgressShowCommand(
      {
        owner: "openclaw",
        repo: "openclawcode",
        repoRoot,
        stateDir,
        json: true,
      },
      runtime,
    );

    const progress = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(progress.roleRoutes).toEqual([
      expect.objectContaining({
        roleId: "planner",
        resolvedBackend: "Claude Code",
        resolvedAgentId: "claude-main",
        appliedSource: "blueprint",
      }),
      expect.objectContaining({
        roleId: "coder",
        resolvedBackend: "Codex",
        resolvedAgentId: "codex-main",
        runtimeCapable: true,
        rerouteCapable: true,
      }),
      expect.objectContaining({
        roleId: "reviewer",
        resolvedBackend: "Claude Code",
        resolvedAgentId: "claude-main",
      }),
      expect.objectContaining({
        roleId: "verifier",
        resolvedBackend: "Codex",
        resolvedAgentId: "codex-main",
        runtimeCapable: true,
        rerouteCapable: true,
      }),
      expect.objectContaining({
        roleId: "docWriter",
        resolvedBackend: "Codex",
        resolvedAgentId: "codex-main",
      }),
    ]);
    expect(progress.roleRouteSummary).toEqual([
      "planner=Claude Code@claude-main",
      "coder=Codex@codex-main",
      "reviewer=Claude Code@claude-main",
      "verifier=Codex@codex-main",
      "doc-writer=Codex@codex-main",
    ]);
    expect(progress.operator).toMatchObject({
      currentRunIssueKey: "openclaw/openclawcode#910",
      currentRunStage: "building",
      currentRunBranchName: "openclawcode/issue-910",
      currentRunPullRequestNumber: 9910,
      currentRunPullRequestUrl: "https://github.com/openclaw/openclawcode/pull/9910",
      currentRunStatusUpdatedAt: "2026-03-20T08:20:00.000Z",
    });

    runtime.log.mockClear();
    await openclawCodeAutonomousLoopRunCommand(
      {
        owner: "openclaw",
        repo: "openclawcode",
        repoRoot,
        stateDir,
        once: true,
        json: true,
      },
      runtime,
    );

    const loop = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(loop).toMatchObject({
      status: "blocked",
      stopReason: "A run is already active for this repository.",
      currentRunPresent: true,
      currentRunIssueKey: "openclaw/openclawcode#910",
      currentRunStage: "building",
      currentRunBranchName: "openclawcode/issue-910",
      currentRunPullRequestNumber: 9910,
      currentRunPullRequestUrl: "https://github.com/openclaw/openclawcode/pull/9910",
    });
    expect(loop.roleRoutes).toEqual(progress.roleRoutes);
    expect(loop.roleRouteSummary).toEqual(progress.roleRouteSummary);
  });

  it("shows an empty operator status snapshot when no chatops state file exists", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "openclawcode-operator-state-missing-"));

    await openclawCodeOperatorStatusSnapshotShowCommand(
      {
        stateDir,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      contractVersion: 1,
      stateDir,
      statePath: path.join(stateDir, "plugins", "openclawcode", "chatops-state.json"),
      exists: false,
      pendingApprovalCount: 0,
      pendingIntakeDraftCount: 0,
      manualTakeoverCount: 0,
      deferredRuntimeRerouteCount: 0,
      queuedRunCount: 0,
      currentRunPresent: false,
      trackedIssueCount: 0,
      repoBindingCount: 0,
      githubDeliveryCount: 0,
      providerPauseActive: false,
      currentRun: null,
      providerPause: null,
      deferredRuntimeReroutes: [],
      repos: [],
      issueSnapshots: [],
    });
  });

  it("reports a stable operator status snapshot for tracked queue and status state", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "openclawcode-operator-state-"));
    const store = OpenClawCodeChatopsStore.fromStateDir(stateDir);

    await store.setRepoBinding({
      repoKey: "openclaw/openclawcode",
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });
    await store.addPendingApproval(
      {
        issueKey: "openclaw/openclawcode#101",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      },
      "Awaiting manual approval.",
    );
    await store.upsertPendingApproval(
      {
        issueKey: "openclaw/openclawcode#102",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        approvalKind: "execution-start-gated",
      },
      "Held by execution-start gate.",
    );
    await store.upsertPendingIntakeDraft({
      repoKey: "openclaw/openclawcode",
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
      title: "Add operator snapshot contract",
      body: "Persist and surface a machine-readable operator snapshot.",
      sourceRequest: "Need a stable operator snapshot contract.",
      bodySynthesized: false,
      scopedDrafts: [],
      clarificationQuestions: [],
      clarificationSuggestions: [],
      clarificationResponses: [],
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z",
    });
    await store.upsertManualTakeover({
      issueKey: "openclaw/openclawcode#103",
      runId: "run-103",
      stage: "ready-for-human-review",
      worktreePath: "/tmp/worktrees/run-103",
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
      actor: "tester",
      requestedAt: "2026-03-16T00:05:00.000Z",
    });
    await store.upsertDeferredRuntimeReroute({
      issueKey: "openclaw/openclawcode#103",
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
      requestedAt: "2026-03-16T00:06:00.000Z",
      actor: "tester",
      requestedCoderAgentId: "codex-rerun",
    });
    await store.enqueue(
      {
        issueKey: "openclaw/openclawcode#104",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        request: {
          owner: "openclaw",
          repo: "openclawcode",
          issueNumber: 104,
          repoRoot: "/tmp/openclawcode",
          baseBranch: "main",
          branchName: "openclawcode/issue-104",
          builderAgent: "codex",
          verifierAgent: "claude-code",
          testCommands: ["pnpm test"],
          openPullRequest: true,
          mergeOnApprove: false,
        },
      },
      "Queued.",
    );
    await store.startNext("Running.");
    await store.setStatusSnapshot({
      issueKey: "openclaw/openclawcode#105",
      status: "openclawcode status for openclaw/openclawcode#105\nStage: Ready For Human Review",
      stage: "ready-for-human-review",
      runId: "run-105",
      updatedAt: "2026-03-16T00:10:00.000Z",
      owner: "openclaw",
      repo: "openclawcode",
      issueNumber: 105,
      branchName: "openclawcode/issue-105",
      pullRequestNumber: 205,
      pullRequestUrl: "https://github.com/openclaw/openclawcode/pull/205",
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
      latestReviewDecision: "approved",
      qualityGateStatus: "warn",
      qualityGateSummary: "verifier approved with warnings | 1 missing coverage item",
      autoMergePolicyEligible: false,
      autoMergePolicyReason: "Blocked pending merge-promotion gate approval.",
      autoMergeDisposition: "skipped",
      autoMergeDispositionReason: "Waiting for merge-promotion override.",
    });

    await openclawCodeOperatorStatusSnapshotShowCommand(
      {
        stateDir,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      contractVersion: 1,
      stateDir,
      exists: true,
      pendingApprovalCount: 2,
      manualPendingApprovalCount: 1,
      executionStartGatedApprovalCount: 1,
      pendingIntakeDraftCount: 1,
      manualTakeoverCount: 1,
      deferredRuntimeRerouteCount: 1,
      queuedRunCount: 0,
      currentRunPresent: true,
      trackedIssueCount: 1,
      repoBindingCount: 1,
      githubDeliveryCount: 0,
      providerPauseActive: false,
      currentRun: {
        issueKey: "openclaw/openclawcode#104",
      },
    });
    expect(payload.pendingApprovals).toHaveLength(2);
    expect(payload.deferredRuntimeReroutes).toEqual([
      expect.objectContaining({
        issueKey: "openclaw/openclawcode#103",
        requestedCoderAgentId: "codex-rerun",
      }),
    ]);
    expect(payload.issueSnapshots[0]).toMatchObject({
      issueKey: "openclaw/openclawcode#105",
      stage: "ready-for-human-review",
      autoMergeDisposition: "skipped",
    });
    expect(payload.repos).toContainEqual(
      expect.objectContaining({
        repoKey: "openclaw/openclawcode",
        bindingPresent: true,
        trackedIssueCount: 1,
        pendingApprovalCount: 2,
        pendingIntakeDraftCount: 1,
        manualTakeoverCount: 1,
        deferredRuntimeRerouteCount: 1,
        queuedRunCount: 0,
        currentRunCount: 1,
        readyForHumanReviewCount: 1,
        qualityGatePassCount: 0,
        qualityGateWarnCount: 1,
        qualityGateFailCount: 0,
        qualityGatePendingCount: 0,
      }),
    );
  });

  it("discovers a missing work-item artifact from an agreed blueprint", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-discovery-missing-"));
    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Discovery Blueprint",
        "status: agreed",
        "createdAt: 2026-03-16T00:00:00.000Z",
        "updatedAt: 2026-03-16T00:00:00.000Z",
        "statusChangedAt: 2026-03-16T00:00:00.000Z",
        "agreedAt: 2026-03-16T00:00:00.000Z",
        "---",
        "",
        "# Discovery Blueprint",
        "",
        "## Goal",
        "Detect missing repo-local artifacts.",
        "",
        "## Success Criteria",
        "- Emit a discovered work item when the work-item artifact is missing.",
        "",
        "## Scope",
        "- In scope: discovery artifact creation.",
        "- Out of scope: direct GitHub issue creation.",
        "",
        "## Non-Goals",
        "- None.",
        "",
        "## Constraints",
        "- Technical: stay deterministic.",
        "",
        "## Risks",
        "- Artifact drift may go unnoticed without discovery.",
        "",
        "## Assumptions",
        "- The blueprint is already agreed.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "",
        "## Workstreams",
        "- Create the repo-local work-item artifact.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-16: baseline discovery test.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeDiscoverWorkItemsCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      blueprintExists: true,
      workItemInventoryExists: false,
      evidenceCount: 1,
      discoveredWorkItemCount: 1,
      highestPriority: "high",
    });
    expect(payload.evidence[0]).toMatchObject({
      source: "work-item-artifact-missing",
      severity: "high",
      priority: "high",
    });
    expect(payload.evidence[0].discoveredWorkItem.kind).toBe("discovered");

    const backlog = JSON.parse(
      await readFile(path.join(repoRoot, ".openclawcode", "work-items.json"), "utf8"),
    );
    expect(backlog.exists).toBe(true);
    expect(backlog.plannedWorkItemCount).toBe(1);
    expect(backlog.discoveredWorkItemCount).toBe(1);
    expect(
      backlog.workItems.some(
        (entry: { kind: string; fingerprint: string }) =>
          entry.kind === "discovered" &&
          entry.fingerprint === payload.evidence[0].discoveredWorkItem.fingerprint,
      ),
    ).toBe(true);
  });

  it("discovers stale work-item drift after the blueprint changes", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-discovery-stale-"));
    const blueprintPath = path.join(repoRoot, "PROJECT-BLUEPRINT.md");
    await writeFile(
      blueprintPath,
      [
        "---",
        "schemaVersion: 1",
        "title: Discovery Drift Blueprint",
        "status: agreed",
        "createdAt: 2026-03-16T00:00:00.000Z",
        "updatedAt: 2026-03-16T00:00:00.000Z",
        "statusChangedAt: 2026-03-16T00:00:00.000Z",
        "agreedAt: 2026-03-16T00:00:00.000Z",
        "---",
        "",
        "# Discovery Drift Blueprint",
        "",
        "## Goal",
        "Detect stale work-item artifacts.",
        "",
        "## Success Criteria",
        "- A stale artifact becomes a discovered work item.",
        "",
        "## Scope",
        "- In scope: stale detection.",
        "- Out of scope: auto-refresh.",
        "",
        "## Non-Goals",
        "- None.",
        "",
        "## Constraints",
        "- Technical: use repo-local files only.",
        "",
        "## Risks",
        "- None.",
        "",
        "## Assumptions",
        "- None.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "",
        "## Workstreams",
        "- Persist the initial work-item artifact.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-16: baseline drift test.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await writeFile(
      blueprintPath,
      (await readFile(blueprintPath, "utf8")).replace(
        "Persist the initial work-item artifact.",
        "Persist the updated work-item artifact.",
      ),
      "utf8",
    );

    await openclawCodeDiscoverWorkItemsCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.workItemArtifactStale).toBe(true);
    expect(
      payload.evidence.some(
        (entry: { source: string }) => entry.source === "work-item-artifact-stale",
      ),
    ).toBe(true);
  });

  it("discovers setup-check regressions, provider pauses, and upstream sync drift", async () => {
    const repoRoot = await createPromotionArtifactRepoRoot();
    const setupCheckPath = path.join(repoRoot, "scripts", "openclawcode-setup-check.sh");
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "openclawcode-discovery-state-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);

    runGitTestCommand(repoRoot, ["remote", "add", "origin", "git@github.com:openclaw/openclaw.git"]);
    await attachUpstreamDriftFixture(repoRoot);

    await openclawCodeBlueprintDecomposeCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    await writeFile(
      setupCheckPath,
      `#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "ok": false,
  "strict": false,
  "repoRoot": ${JSON.stringify(repoRoot)},
  "operatorRoot": "/tmp/openclaw-operator",
  "readiness": {
    "basic": true,
    "strict": false,
    "lowRiskProofReady": false,
    "fallbackProofReady": false,
    "promotionReady": false,
    "gatewayReachable": true,
    "routeProbeReady": false,
    "routeProbeSkipped": false,
    "builtStartupProofRequested": true,
    "builtStartupProofReady": false,
    "nextAction": "fix-setup-check"
  },
  "summary": {
    "pass": 9,
    "warn": 1,
    "fail": 3
  }
}
EOF
`,
      "utf8",
    );

    const statePath = path.join(stateDir, "plugins", "openclawcode", "chatops-state.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 1,
          pendingApprovals: [],
          pendingIntakeDrafts: [],
          setupSessions: [],
          manualTakeovers: [],
          deferredRuntimeReroutes: [],
          queue: [],
          statusByIssue: {},
          statusSnapshotsByIssue: {
            "openclaw/openclaw#41": {
              issueKey: "openclaw/openclaw#41",
              status: [
                "openclawcode status for openclaw/openclaw#41",
                "Stage: Failed",
                "Summary: Build failed after the provider returned HTTP 500.",
              ].join("\n"),
              stage: "failed",
              runId: "run-41",
              updatedAt: "2026-03-20T00:20:00.000Z",
              owner: "openclaw",
              repo: "openclaw",
              issueNumber: 41,
              notifyChannel: "feishu",
              notifyTarget: "occode-test",
            },
            "openclaw/openclaw#42": {
              issueKey: "openclaw/openclaw#42",
              status: [
                "openclawcode status for openclaw/openclaw#42",
                "Stage: Changes Requested",
                "Summary: Address the missing regression proof before rerun.",
              ].join("\n"),
              stage: "changes-requested",
              runId: "run-42",
              updatedAt: "2026-03-20T00:22:00.000Z",
              owner: "openclaw",
              repo: "openclaw",
              issueNumber: 42,
              notifyChannel: "feishu",
              notifyTarget: "occode-test",
            },
          },
          repoBindingsByRepo: {
            "openclaw/openclaw": {
              repoKey: "openclaw/openclaw",
              notifyChannel: "feishu",
              notifyTarget: "occode-test",
              updatedAt: "2026-03-20T00:00:00.000Z",
            },
          },
          githubDeliveriesById: {},
          recentProviderFailures: [],
          providerPause: {
            until: "2026-03-20T00:15:00.000Z",
            triggeredAt: "2026-03-20T00:05:00.000Z",
            lastFailureAt: "2026-03-20T00:04:00.000Z",
            failureCount: 2,
            reason: "HTTP 400: Internal server error",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    runtime.log.mockClear();
    await openclawCodeDiscoverWorkItemsCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.evidenceCount).toBe(5);
    expect(payload.highestPriority).toBe("high");
    expect(payload.evidence.map((entry: { source: string }) => entry.source)).toEqual(
      expect.arrayContaining([
        "setup-check-regression",
        "provider-pause-active",
        "tracked-run-failed",
        "tracked-run-changes-requested",
        "upstream-sync-drift",
      ]),
    );
    expect(payload.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "setup-check-regression",
          discoveredWorkItem: expect.objectContaining({
            class: "validation",
            executionMode: "bugfix",
          }),
        }),
        expect.objectContaining({
          source: "provider-pause-active",
          discoveredWorkItem: expect.objectContaining({
            class: "incident",
            executionMode: "bugfix",
          }),
        }),
        expect.objectContaining({
          source: "upstream-sync-drift",
          discoveredWorkItem: expect.objectContaining({
            class: "sync",
            executionMode: "feature",
          }),
        }),
        expect.objectContaining({
          source: "tracked-run-failed",
          discoveredWorkItem: expect.objectContaining({
            class: "incident",
            executionMode: "bugfix",
          }),
        }),
        expect.objectContaining({
          source: "tracked-run-changes-requested",
          discoveredWorkItem: expect.objectContaining({
            class: "bugfix",
            executionMode: "bugfix",
          }),
        }),
      ]),
    );
  });

  it("persists a provider-neutral role routing plan with mixed Codex and Claude assignments", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-role-routing-"));
    const previousDefault = process.env.OPENCLAWCODE_ROLE_DEFAULT;
    const previousFallbacks = process.env.OPENCLAWCODE_MODEL_FALLBACKS;
    const previousVerifierFallbacks = process.env.OPENCLAWCODE_ROLE_VERIFIER_FALLBACKS;
    process.env.OPENCLAWCODE_ROLE_DEFAULT = "Codex";
    process.env.OPENCLAWCODE_MODEL_FALLBACKS = "openai/gpt-5,anthropic/claude-sonnet";
    process.env.OPENCLAWCODE_ROLE_VERIFIER_FALLBACKS = "anthropic/claude-opus";

    try {
      await writeFile(
        path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Routing Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:00:00.000Z",
          "statusChangedAt: 2026-03-16T00:00:00.000Z",
          "agreedAt: 2026-03-16T00:00:00.000Z",
          "---",
          "",
          "# Routing Blueprint",
          "",
          "## Goal",
          "Route planner and coder roles cleanly.",
          "",
          "## Success Criteria",
          "- Persist a machine-readable route plan.",
          "",
          "## Scope",
          "- In scope: role routing.",
          "- Out of scope: live run integration.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Technical: keep the output deterministic.",
          "",
          "## Risks",
          "- None.",
          "",
          "## Assumptions",
          "- None.",
          "",
          "## Human Gates",
          "- Goal agreement: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "",
          "## Workstreams",
          "- Persist the provider-neutral role plan.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-16: routing baseline.",
          "",
        ].join("\n"),
        "utf8",
      );

      await openclawCodeRoleRoutingRefreshCommand(
        {
          repoRoot,
          json: true,
        },
        runtime,
      );

      let payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
      expect(payload).toMatchObject({
        repoRoot,
        exists: true,
        fallbackConfigured: true,
        mixedMode: true,
        routeCount: 5,
        stageRouteCount: 8,
        unresolvedRoleCount: 0,
      });
      expect(payload.routes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            roleId: "planner",
            rawAssignment: "Claude Code",
            adapterId: "claude-code",
            source: "blueprint",
            stages: ["planning"],
          }),
          expect.objectContaining({
            roleId: "coder",
            rawAssignment: "Codex",
            adapterId: "codex",
            source: "blueprint",
            stages: ["building"],
          }),
          expect.objectContaining({
            roleId: "reviewer",
            rawAssignment: "Codex",
            adapterId: "codex",
            source: "env-role-default",
          }),
          expect.objectContaining({
            roleId: "verifier",
            fallbackChain: ["anthropic/claude-opus", "openai/gpt-5", "anthropic/claude-sonnet"],
            stages: ["verifying"],
          }),
        ]),
      );
      expect(payload.stageRoutes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stageId: "planning",
            roleId: "planner",
            adapterId: "claude-code",
          }),
          expect.objectContaining({
            stageId: "building",
            roleId: "coder",
            adapterId: "codex",
          }),
          expect.objectContaining({
            stageId: "verifying",
            roleId: "verifier",
            fallbackChain: ["anthropic/claude-opus", "openai/gpt-5", "anthropic/claude-sonnet"],
          }),
        ]),
      );

      runtime.log.mockClear();
      await openclawCodeRoleRoutingShowCommand(
        {
          repoRoot,
          json: true,
        },
        runtime,
      );

      payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
      expect(payload.exists).toBe(true);
      expect(payload.fallbackChain).toEqual(["openai/gpt-5", "anthropic/claude-sonnet"]);
    } finally {
      if (previousDefault == null) {
        delete process.env.OPENCLAWCODE_ROLE_DEFAULT;
      } else {
        process.env.OPENCLAWCODE_ROLE_DEFAULT = previousDefault;
      }
      if (previousFallbacks == null) {
        delete process.env.OPENCLAWCODE_MODEL_FALLBACKS;
      } else {
        process.env.OPENCLAWCODE_MODEL_FALLBACKS = previousFallbacks;
      }
      if (previousVerifierFallbacks == null) {
        delete process.env.OPENCLAWCODE_ROLE_VERIFIER_FALLBACKS;
      } else {
        process.env.OPENCLAWCODE_ROLE_VERIFIER_FALLBACKS = previousVerifierFallbacks;
      }
    }
  });

  it("persists repo-local per-stage runtime steering overrides", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-runtime-steering-"));

    await openclawCodeRuntimeSteeringSetCommand(
      {
        repoRoot,
        stage: "building",
        adapter: "claude-code",
        agent: "builder-steered",
        actor: "tester",
        note: "route build stage to alternate runtime",
        json: true,
      },
      runtime,
    );

    let payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      overrideCount: 1,
      overrides: [
        expect.objectContaining({
          stageId: "building",
          roleId: "coder",
          adapterId: "claude-code",
          agentId: "builder-steered",
          actor: "tester",
          note: "route build stage to alternate runtime",
        }),
      ],
    });

    runtime.log.mockClear();
    await openclawCodeRuntimeSteeringShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      overrideCount: 1,
    });

    runtime.log.mockClear();
    await openclawCodeRuntimeSteeringSetCommand(
      {
        repoRoot,
        stage: "building",
        clear: true,
        json: true,
      },
      runtime,
    );

    payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.overrideCount).toBe(0);
    expect(payload.overrides).toEqual([]);
  });

  it("persists stage-gate readiness and records structured decisions", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-stage-gates-"));
    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Stage Gate Blueprint",
        "status: agreed",
        "createdAt: 2026-03-16T00:00:00.000Z",
        "updatedAt: 2026-03-16T00:00:00.000Z",
        "statusChangedAt: 2026-03-16T00:00:00.000Z",
        "agreedAt: 2026-03-16T00:00:00.000Z",
        "---",
        "",
        "# Stage Gate Blueprint",
        "",
        "## Goal",
        "Persist stage-gate decisions.",
        "",
        "## Success Criteria",
        "- Stage gates are machine-readable.",
        "",
        "## Scope",
        "- In scope: repo-local gate artifacts.",
        "- Out of scope: chat integration.",
        "",
        "## Non-Goals",
        "- None.",
        "",
        "## Constraints",
        "- Technical: keep the artifact deterministic.",
        "",
        "## Risks",
        "- None.",
        "",
        "## Assumptions",
        "- None.",
        "",
        "## Human Gates",
        "- Goal agreement: required",
        "- Execution start: operator may intervene",
        "- Merge or promotion: operator may intervene",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Persist repo-local stage gates.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-16: stage-gate baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeRoleRoutingRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeDiscoverWorkItemsCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();

    await openclawCodeStageGatesRefreshCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    let payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      gateCount: 5,
      blockedGateCount: 0,
      needsHumanDecisionCount: 1,
    });
    expect(payload.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateId: "goal-agreement",
          readiness: "ready",
        }),
        expect.objectContaining({
          gateId: "merge-promotion",
          readiness: "needs-human-decision",
        }),
      ]),
    );

    runtime.log.mockClear();
    await openclawCodeStageGatesDecideCommand(
      {
        repoRoot,
        gate: "execution-start",
        decision: "approved",
        actor: "operator",
        note: "Proceed with autonomous execution.",
        json: true,
      },
      runtime,
    );

    payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateId: "execution-start",
          latestDecision: expect.objectContaining({
            decision: "approved",
            actor: "operator",
            note: "Proceed with autonomous execution.",
          }),
        }),
      ]),
    );

    runtime.log.mockClear();
    await openclawCodeStageGatesShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateId: "execution-start",
          decision: "approved",
          actor: "operator",
        }),
      ]),
    );
  });

  it("marks execution-start as needing a human decision for refactor work", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-stage-gates-refactor-"));

    await writeFile(
      path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
      [
        "---",
        "schemaVersion: 1",
        "title: Refactor Stage Gate Blueprint",
        "status: agreed",
        "createdAt: 2026-03-20T00:00:00.000Z",
        "updatedAt: 2026-03-20T00:00:00.000Z",
        "statusChangedAt: 2026-03-20T00:00:00.000Z",
        "agreedAt: 2026-03-20T00:00:00.000Z",
        "---",
        "",
        "# Refactor Stage Gate Blueprint",
        "",
        "## Goal",
        "Gate structural refactors at execution-start.",
        "",
        "## Success Criteria",
        "- Stage gates surface a human-decision requirement for refactor work.",
        "",
        "## Scope",
        "- In scope: execution-start stage-gate guidance.",
        "",
        "## Non-Goals",
        "- Full execution.",
        "",
        "## Constraints",
        "- Keep the work item selection deterministic.",
        "",
        "## Risks",
        "- Structural work can drift without a checkpoint.",
        "",
        "## Assumptions",
        "- Blueprint agreement is already recorded.",
        "",
        "## Human Gates",
        "- Execution start: required",
        "",
        "## Provider Strategy",
        "- Planner: Claude Code",
        "- Coder: Codex",
        "- Reviewer: Claude Code",
        "- Verifier: Codex",
        "- Doc-writer: Codex",
        "",
        "## Workstreams",
        "- Refactor the stage-gate summary builder into a dedicated module.",
        "",
        "## Open Questions",
        "- None.",
        "",
        "## Change Log",
        "- 2026-03-20: refactor stage-gate baseline.",
        "",
      ].join("\n"),
      "utf8",
    );

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeRoleRoutingRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeStageGatesRefreshCommand({ repoRoot, json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateId: "execution-start",
          readiness: "needs-human-decision",
          blockers: expect.arrayContaining([
            "Selected refactor slice requires explicit execution-start approval: Refactor the stage-gate summary builder into a dedicated module.",
          ]),
        }),
      ]),
    );
  });

  it("persists a machine-readable promotion gate artifact", async () => {
    const repoRoot = await createPromotionArtifactRepoRoot();

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeRoleRoutingRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeStageGatesRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeStageGatesDecideCommand(
      {
        repoRoot,
        gate: "merge-promotion",
        decision: "approved",
        actor: "operator",
        note: "Promotion approved after proofs.",
        json: true,
      },
      runtime,
    );
    runtime.log.mockClear();

    await openclawCodePromotionGateRefreshCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    let payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      schemaVersion: 1,
      branchName: "sync/upstream-2026-03-16",
      baseBranch: "main",
      setupCheckAvailable: true,
      lowRiskProofReady: true,
      fallbackProofReady: false,
      promotionReady: true,
      ready: true,
      mergePromotionGateReadiness: "ready",
      blockerCount: 0,
    });
    expect(payload.rollbackTargetCommitSha).toMatch(/[0-9a-f]{40}/);

    const persisted = JSON.parse(
      await readFile(path.join(repoRoot, ".openclawcode", "promotion-gate.json"), "utf8"),
    );
    expect(persisted.ready).toBe(true);

    runtime.log.mockClear();
    await openclawCodePromotionGateShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.exists).toBe(true);
    expect(payload.artifactPath).toBe(path.join(repoRoot, ".openclawcode", "promotion-gate.json"));
  });

  it("persists a machine-readable rollback suggestion artifact", async () => {
    const repoRoot = await createPromotionArtifactRepoRoot();

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeRoleRoutingRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeStageGatesRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodePromotionGateRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();

    await openclawCodeRollbackSuggestionRefreshCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    let payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      schemaVersion: 1,
      branchName: "sync/upstream-2026-03-16",
      baseBranch: "main",
      targetBranch: "main",
      promotionArtifactExists: true,
      promotionReady: true,
      recommended: true,
    });
    expect(payload.targetRef).toMatch(/^main@[0-9a-f]{40}$/);

    const persisted = JSON.parse(
      await readFile(path.join(repoRoot, ".openclawcode", "rollback-suggestion.json"), "utf8"),
    );
    expect(persisted.targetBranch).toBe("main");

    runtime.log.mockClear();
    await openclawCodeRollbackSuggestionShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.exists).toBe(true);
    expect(payload.reason).toContain("baseline branch");
  });

  it("persists a machine-readable promotion receipt artifact", async () => {
    const repoRoot = await createPromotionArtifactRepoRoot();

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeRoleRoutingRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeStageGatesRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeStageGatesDecideCommand(
      {
        repoRoot,
        gate: "merge-promotion",
        decision: "approved",
        actor: "operator",
        note: "Promotion approved after proofs.",
        json: true,
      },
      runtime,
    );
    runtime.log.mockClear();
    await openclawCodePromotionGateRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeRollbackSuggestionRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();

    const promotedCommitSha =
      spawnSync("git", ["rev-parse", "main"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim() ||
      null;
    expect(promotedCommitSha).toMatch(/[0-9a-f]{40}/);

    await openclawCodePromotionReceiptRecordCommand(
      {
        repoRoot,
        actor: "operator",
        note: "Promoted refreshed sync branch onto main.",
        promotedBranch: "main",
        promotedCommitSha: promotedCommitSha ?? undefined,
        json: true,
      },
      runtime,
    );

    let payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      schemaVersion: 1,
      actor: "operator",
      sourceBranch: "sync/upstream-2026-03-16",
      promotedBranch: "main",
      promotionReady: true,
      rollbackTargetBranch: "main",
      rollbackSuggestionArtifactExists: true,
      blockerCount: 0,
    });
    expect(payload.promotedRef).toMatch(/^main@[0-9a-f]{40}$/);

    const persisted = JSON.parse(
      await readFile(path.join(repoRoot, ".openclawcode", "promotion-receipt.json"), "utf8"),
    );
    expect(persisted.promotedBranch).toBe("main");

    runtime.log.mockClear();
    await openclawCodePromotionReceiptShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.exists).toBe(true);
    expect(payload.artifactPath).toBe(
      path.join(repoRoot, ".openclawcode", "promotion-receipt.json"),
    );
  });

  it("persists a machine-readable rollback receipt artifact", async () => {
    const repoRoot = await createPromotionArtifactRepoRoot();

    await openclawCodeBlueprintDecomposeCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeRoleRoutingRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeStageGatesRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodePromotionGateRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();
    await openclawCodeRollbackSuggestionRefreshCommand({ repoRoot, json: true }, runtime);
    runtime.log.mockClear();

    const restoredCommitSha =
      spawnSync("git", ["rev-parse", "main"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim() ||
      null;
    expect(restoredCommitSha).toMatch(/[0-9a-f]{40}/);

    await openclawCodeRollbackReceiptRecordCommand(
      {
        repoRoot,
        actor: "operator",
        note: "Rolled the operator back to the baseline branch.",
        restoredBranch: "main",
        restoredCommitSha: restoredCommitSha ?? undefined,
        json: true,
      },
      runtime,
    );

    let payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      repoRoot,
      exists: true,
      schemaVersion: 1,
      actor: "operator",
      sourceBranch: "sync/upstream-2026-03-16",
      restoredBranch: "main",
      recommended: true,
      rollbackSuggestionArtifactExists: true,
      blockerCount: 0,
    });
    expect(payload.restoredRef).toMatch(/^main@[0-9a-f]{40}$/);

    const persisted = JSON.parse(
      await readFile(path.join(repoRoot, ".openclawcode", "rollback-receipt.json"), "utf8"),
    );
    expect(persisted.restoredBranch).toBe("main");

    runtime.log.mockClear();
    await openclawCodeRollbackReceiptShowCommand(
      {
        repoRoot,
        json: true,
      },
      runtime,
    );

    payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.exists).toBe(true);
    expect(payload.artifactPath).toBe(
      path.join(repoRoot, ".openclawcode", "rollback-receipt.json"),
    );
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

  it("renders dedicated string validation templates for timestamp, url, and enum-like fields", async () => {
    const templateExpectations = [
      {
        template: "command-json-string-timestamp" as const,
        fieldName: "publishedPullRequestOpenedAt",
        sourcePath: "publishedPullRequest.openedAt",
        snippet: "timestamp-like string field",
      },
      {
        template: "command-json-string-url" as const,
        fieldName: "issueUrl",
        sourcePath: "issue.url",
        snippet: "URL string field",
      },
      {
        template: "command-json-string-enum" as const,
        fieldName: "verificationDecision",
        sourcePath: "verificationReport.decision",
        snippet: "enum-like string field",
      },
    ];

    for (const entry of templateExpectations) {
      runtime.log.mockClear();
      await openclawCodeSeedValidationIssueCommand(
        {
          template: entry.template,
          repoRoot: "/repo",
          fieldName: entry.fieldName,
          sourcePath: entry.sourcePath,
          dryRun: true,
          json: true,
        },
        runtime,
      );

      const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
      expect(payload.template).toBe(entry.template);
      expect(payload.body).toContain(entry.snippet);
      expect(payload.body).toContain("string | null");
    }
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
      owner: "zhyongrui",
      repo: "openclawcode",
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
      "command-json-string-timestamp",
      "command-json-string-url",
      "command-json-string-enum",
      "operator-doc-note",
      "webhook-precheck-high-risk",
    ]);
  });

  it("previews balanced validation-pool seeding from the minimum-pool policy", async () => {
    await openclawCodeSeedValidationIssueCommand(
      {
        repoRoot: "/repo",
        balanced: true,
        dryRun: true,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      contractVersion: 1,
      owner: "openclaw",
      repo: "openclaw",
      balanced: true,
      dryRun: true,
    });
    expect(payload.minimumPoolTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueClass: "command-layer",
          minimumOpenIssues: 0,
        }),
        expect.objectContaining({
          issueClass: "operator-docs",
          minimumOpenIssues: 1,
        }),
        expect.objectContaining({
          issueClass: "high-risk-validation",
          minimumOpenIssues: 1,
        }),
      ]),
    );
    expect(payload.poolDeficits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueClass: "high-risk-validation",
          missingIssues: 1,
        }),
      ]),
    );
    expect(payload.seedActions).toEqual([
      expect.objectContaining({
        template: "webhook-precheck-high-risk",
        issueClass: "high-risk-validation",
        created: false,
        reusedExisting: false,
        dryRun: true,
      }),
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
      contractVersion: 1,
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
      minimumPoolTargets: expect.arrayContaining([
        expect.objectContaining({
          issueClass: "command-layer",
          minimumOpenIssues: 0,
        }),
        expect.objectContaining({
          issueClass: "high-risk-validation",
          minimumOpenIssues: 1,
        }),
      ]),
      poolDeficits: expect.arrayContaining([
        expect.objectContaining({
          issueClass: "high-risk-validation",
          missingIssues: 1,
        }),
      ]),
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
      "- minimum command-layer: 0",
      "- minimum operator-docs: 1",
      "- minimum high-risk-validation: 1",
      "- deficit command-layer: current=1 missing=0",
      "- deficit operator-docs: current=1 missing=0",
      "- deficit high-risk-validation: current=0 missing=1",
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
      contractVersion: 1,
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
      contractVersion: 1,
      closeImplemented: true,
      closableImplementedIssues: 1,
      closedIssues: 1,
      enforceMinimumPoolSize: false,
      nextAction: "enforce-minimum-pool-size",
      poolDeficits: expect.arrayContaining([
        expect.objectContaining({
          issueClass: "high-risk-validation",
          missingIssues: 1,
        }),
      ]),
    });
  });

  it("can enforce the minimum pool size during reconciliation", async () => {
    const repoRoot = await createValidationAssessmentRepoRoot({
      fieldName: "verificationHasMissingCoverage",
    });

    await openclawCodeReconcileValidationIssuesCommand(
      {
        repoRoot,
        closeImplemented: true,
        enforceMinimumPoolSize: true,
        json: true,
      },
      runtime,
    );

    expect(mocks.closeIssue).toHaveBeenCalledWith({
      owner: "openclaw",
      repo: "openclaw",
      issueNumber: 99,
    });
    expect(mocks.createIssue).toHaveBeenCalledWith({
      owner: "openclaw",
      repo: "openclaw",
      title:
        "[Validation]: Webhook intake should precheck-escalate credential or secret exposure requests",
      body: expect.stringContaining("credential or secret exposure requests"),
    });
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      contractVersion: 1,
      closeImplemented: true,
      enforceMinimumPoolSize: true,
      closedIssues: 1,
      seededIssues: 1,
      nextAction: "validation-pool-balanced",
    });
    expect(payload.seedActions).toEqual([
      expect.objectContaining({
        template: "webhook-precheck-high-risk",
        issueClass: "high-risk-validation",
        created: true,
        reusedExisting: false,
      }),
    ]);
  });

  it("queues a reroute rerun from a failed tracked snapshot", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-reroute-failed-repo-"));
    const operatorStateDir = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-reroute-failed-state-"),
    );
    const store = OpenClawCodeChatopsStore.fromStateDir(operatorStateDir);

    await writeOperatorRepoConfig({
      operatorStateDir,
      repoRoot,
    });
    await store.setStatusSnapshot({
      issueKey: "openclaw/openclawcode#321",
      status: [
        "openclawcode status for openclaw/openclawcode#321",
        "Stage: Failed",
        "Summary: Primary coder provider failed during build.",
      ].join("\n"),
      stage: "failed",
      runId: "run-321",
      updatedAt: "2026-03-21T16:00:00.000Z",
      owner: "openclaw",
      repo: "openclawcode",
      issueNumber: 321,
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });

    await openclawCodeRerouteRunCommand(
      {
        issue: "321",
        owner: "openclaw",
        repo: "openclawcode",
        repoRoot,
        stateDir: operatorStateDir,
        coderAgent: "codex-alt",
        actor: "tester",
        note: "retry on secondary coder",
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      contractVersion: 1,
      issueKey: "openclaw/openclawcode#321",
      outcome: "queued-rerun",
      stage: "failed",
      runId: "run-321",
      runtimeOverrideSummary: "coder -> codex-alt",
    });

    const state = await store.snapshot();
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.request).toMatchObject({
      builderAgent: "codex-alt",
      verifierAgent: "claude-main",
      rerunContext: expect.objectContaining({
        priorRunId: "run-321",
        priorStage: "failed",
        requestedCoderAgentId: "codex-alt",
      }),
    });
    expect(state.queue[0]?.request.rerunContext?.reason).toContain(
      "Primary coder provider failed during build.",
    );
    expect(state.queue[0]?.request.rerunContext?.reason).toContain("requested by tester");
    expect(state.queue[0]?.request.rerunContext?.reason).toContain(
      "note: retry on secondary coder",
    );
  });

  it("queues a reroute rerun from an awaiting-plan-approval snapshot", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-reroute-plan-repo-"));
    const operatorStateDir = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-reroute-plan-state-"),
    );
    const store = OpenClawCodeChatopsStore.fromStateDir(operatorStateDir);

    await writeOperatorRepoConfig({
      operatorStateDir,
      repoRoot,
    });
    await store.setStatusSnapshot({
      issueKey: "openclaw/openclawcode#322",
      status: [
        "openclawcode status for openclaw/openclawcode#322",
        "Stage: Awaiting Plan Approval",
        "Summary: Waiting for plan approval before workspace preparation.",
      ].join("\n"),
      stage: "awaiting-plan-approval",
      runId: "run-322",
      updatedAt: "2026-03-21T16:05:00.000Z",
      owner: "openclaw",
      repo: "openclawcode",
      issueNumber: 322,
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });

    await openclawCodeRerouteRunCommand(
      {
        issue: "322",
        owner: "openclaw",
        repo: "openclawcode",
        repoRoot,
        stateDir: operatorStateDir,
        verifierAgent: "claude-alt",
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      issueKey: "openclaw/openclawcode#322",
      outcome: "queued-rerun",
      stage: "awaiting-plan-approval",
      runtimeOverrideSummary: "verifier -> claude-alt",
    });

    const state = await store.snapshot();
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.request).toMatchObject({
      builderAgent: "codex-main",
      verifierAgent: "claude-alt",
      rerunContext: expect.objectContaining({
        priorStage: "awaiting-plan-approval",
        requestedVerifierAgentId: "claude-alt",
      }),
    });
  });

  it("updates the queued runtime override before execution starts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-reroute-queued-repo-"));
    const operatorStateDir = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-reroute-queued-state-"),
    );
    const store = OpenClawCodeChatopsStore.fromStateDir(operatorStateDir);

    await writeOperatorRepoConfig({
      operatorStateDir,
      repoRoot,
    });
    await store.enqueue(
      {
        issueKey: "openclaw/openclawcode#323",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        request: {
          owner: "openclaw",
          repo: "openclawcode",
          issueNumber: 323,
          repoRoot,
          baseBranch: "main",
          branchName: "openclawcode/issue-323",
          builderAgent: "codex-main",
          verifierAgent: "claude-main",
          testCommands: ["pnpm test"],
          openPullRequest: true,
          mergeOnApprove: false,
        },
      },
      "Queued.",
    );

    await openclawCodeRerouteRunCommand(
      {
        issue: "323",
        owner: "openclaw",
        repo: "openclawcode",
        repoRoot,
        stateDir: operatorStateDir,
        coderAgent: "codex-alt",
        verifierAgent: "claude-alt",
        actor: "tester",
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      issueKey: "openclaw/openclawcode#323",
      outcome: "queued-update",
      runtimeOverrideSummary: "coder -> codex-alt, verifier -> claude-alt",
    });

    const state = await store.snapshot();
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.request.builderAgent).toBe("codex-alt");
    expect(state.queue[0]?.request.verifierAgent).toBe("claude-alt");
  });

  it("records a deferred reroute when the current run is still active", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-reroute-active-repo-"));
    const operatorStateDir = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-reroute-active-state-"),
    );
    const store = OpenClawCodeChatopsStore.fromStateDir(operatorStateDir);

    await writeOperatorRepoConfig({
      operatorStateDir,
      repoRoot,
    });
    await store.enqueue(
      {
        issueKey: "openclaw/openclawcode#324",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        request: {
          owner: "openclaw",
          repo: "openclawcode",
          issueNumber: 324,
          repoRoot,
          baseBranch: "main",
          branchName: "openclawcode/issue-324",
          builderAgent: "codex-main",
          verifierAgent: "claude-main",
          testCommands: ["pnpm test"],
          openPullRequest: true,
          mergeOnApprove: false,
        },
      },
      "Queued.",
    );
    await store.startNext("Running.");
    await store.setStatusSnapshot({
      issueKey: "openclaw/openclawcode#324",
      status: "openclawcode status for openclaw/openclawcode#324\nStage: Building",
      stage: "building",
      runId: "run-324",
      updatedAt: "2026-03-21T16:10:00.000Z",
      owner: "openclaw",
      repo: "openclawcode",
      issueNumber: 324,
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });

    await openclawCodeRerouteRunCommand(
      {
        issue: "324",
        owner: "openclaw",
        repo: "openclawcode",
        repoRoot,
        stateDir: operatorStateDir,
        verifierAgent: "claude-alt",
        note: "switch verifier if this fails",
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      issueKey: "openclaw/openclawcode#324",
      outcome: "deferred",
      stage: "building",
      runId: "run-324",
      runtimeOverrideSummary: "verifier -> claude-alt",
    });

    expect(await store.getDeferredRuntimeReroute("openclaw/openclawcode#324")).toMatchObject({
      issueKey: "openclaw/openclawcode#324",
      sourceRunId: "run-324",
      sourceStage: "building",
      requestedVerifierAgentId: "claude-alt",
      note: "switch verifier if this fails",
    });
  });

  it("blocks reroute requests from non-paused tracked stages", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-reroute-blocked-repo-"));
    const operatorStateDir = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-reroute-blocked-state-"),
    );
    const store = OpenClawCodeChatopsStore.fromStateDir(operatorStateDir);

    await writeOperatorRepoConfig({
      operatorStateDir,
      repoRoot,
    });
    await store.setStatusSnapshot({
      issueKey: "openclaw/openclawcode#325",
      status: "openclawcode status for openclaw/openclawcode#325\nStage: Completed Without Changes",
      stage: "completed-without-changes",
      runId: "run-325",
      updatedAt: "2026-03-21T16:12:00.000Z",
      owner: "openclaw",
      repo: "openclawcode",
      issueNumber: 325,
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });

    await openclawCodeRerouteRunCommand(
      {
        issue: "325",
        owner: "openclaw",
        repo: "openclawcode",
        repoRoot,
        stateDir: operatorStateDir,
        coderAgent: "codex-alt",
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload).toMatchObject({
      issueKey: "openclaw/openclawcode#325",
      outcome: "blocked",
      stage: "completed-without-changes",
    });
    expect(payload.detail).toContain("failed or paused stages");

    const state = await store.snapshot();
    expect(state.queue).toHaveLength(0);
  });
});

describe("openclawCodeBootstrapCommand", () => {
  const runtime = createTestRuntime();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv(
      "OPENCLAWCODE_TUNNEL_LOG_FILE",
      path.join(os.tmpdir(), "openclawcode-bootstrap-missing-tunnel.log"),
    );
    mocks.resolveGitHubRepoFromGit.mockResolvedValue({ owner: "acme", repo: "demo" });
  });

  it("bootstraps operator files, repo binding, blueprint artifacts, and inferred test commands", async () => {
    const operatorRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-bootstrap-operator-"));
    const targetRepoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-bootstrap-target-"));
    await writeFile(
      path.join(targetRepoRoot, "package.json"),
      JSON.stringify(
        {
          name: "demo",
          scripts: {
            test: "vitest run",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(path.join(targetRepoRoot, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8");
    vi.stubEnv("GH_TOKEN", "ghs_bootstrap_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: true,
          strict: true,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: true,
            fallbackProofReady: false,
            promotionReady: true,
            chatSetupRoutingReady: true,
            gatewayReachable: false,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: false,
            builtStartupProofReady: false,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 9,
            warn: 0,
            fail: 0,
          },
          checks: [],
        },
        stderr: "",
        status: 0,
      });
    const webhookUrlSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "resolveWebhookUrl")
      .mockResolvedValue({ url: null, source: null });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        repoRoot: targetRepoRoot,
        stateDir: operatorRoot,
        baseBranch: "main",
        startGateway: false,
        probeBuiltStartup: false,
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();
    webhookUrlSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(payload.contractVersion).toBe(1);
    expect(payload.repo.repoKey).toBe("acme/demo");
    expect(payload.repo.repoRoot).toBe(targetRepoRoot);
    expect(payload.repo.repoRootSelection).toBe("explicit");
    expect(payload.repo.checkoutAction).toBe("attached");
    expect(payload.mode).toBe("cli-only");
    expect(payload.notify.bindingMode).toBe("cli-placeholder");
    expect(payload.credentials.githubTokenSource).toBe("GH_TOKEN");
    expect(payload.config.repoEntryAction).toBe("created");
    expect(payload.config.testCommands).toEqual(["pnpm test"]);
    expect(payload.config.testCommandSource).toBe("package-manager");
    expect(payload.webhook.action).toBe("skipped");
    expect(payload.webhook.hookId).toBeNull();
    expect(payload.binding.action).toBe("created");
    expect(payload.blueprint.action).toBe("created");
    expect(payload.stageGates.executionStartReadiness).toBe("ready");
    expect(payload.gateway.action).toBe("skipped");
    expect(payload.setupCheck.payload.readiness.nextAction).toBe("ready-for-low-risk-proof");
    expect(payload.proofReadiness.cliProofReady).toBe(true);
    expect(payload.proofReadiness.chatProofReady).toBe(false);
    expect(payload.proofReadiness.webhookReady).toBe(false);
    expect(payload.proofReadiness.webhookUrlReady).toBe(false);
    expect(payload.proofReadiness.needsChatBind).toBe(false);
    expect(payload.proofReadiness.needsPublicWebhookUrl).toBe(false);
    expect(payload.handoff.recommendedProofMode).toBe("cli-only");
    expect(payload.handoff.cliRunCommand).toContain("openclaw code run --issue <issue-number>");
    expect(payload.handoff.gatewayRestartCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.pluginActivationRepairCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.chatSetupCommand).toBeNull();
    expect(payload.handoff.chatSetupStatusCommand).toBeNull();
    expect(payload.handoff.chatBindCommand).toBeNull();
    expect(payload.handoff.chatStartCommand).toBeNull();
    expect(payload.nextAction).toBe("ready-for-low-risk-proof");

    const envFile = await readFile(path.join(operatorRoot, "openclawcode.env"), "utf8");
    expect(envFile).toContain("export GH_TOKEN='ghs_bootstrap_token'");
    expect(envFile).toContain("export OPENCLAWCODE_GITHUB_REPO='acme/demo'");
    expect(envFile).toContain("export OPENCLAWCODE_GITHUB_WEBHOOK_SECRET=");
    expect(envFile).not.toContain("OPENCLAWCODE_GITHUB_HOOK_ID");

    const config = JSON.parse(await readFile(path.join(operatorRoot, "openclaw.json"), "utf8"));
    const repoEntry = config.plugins.entries.openclawcode.config.repos[0];
    expect(repoEntry.owner).toBe("acme");
    expect(repoEntry.repo).toBe("demo");
    expect(repoEntry.repoRoot).toBe(targetRepoRoot);
    expect(repoEntry.testCommands).toEqual(["pnpm test"]);

    const chatopsState = JSON.parse(
      await readFile(
        path.join(operatorRoot, "plugins", "openclawcode", "chatops-state.json"),
        "utf8",
      ),
    );
    expect(chatopsState.repoBindingsByRepo["acme/demo"]).toEqual(
      expect.objectContaining({
        notifyChannel: "bootstrap",
        notifyTarget: "cli-only:acme/demo",
      }),
    );

    await expect(
      readFile(path.join(targetRepoRoot, "PROJECT-BLUEPRINT.md"), "utf8"),
    ).resolves.toContain("Bootstrap acme/demo");
    const stageGates = JSON.parse(
      await readFile(path.join(targetRepoRoot, ".openclawcode", "stage-gates.json"), "utf8"),
    );
    expect(stageGates.exists).toBe(true);
  });

  it("treats a truly empty repo as blueprint-first bootstrap instead of requiring fake test commands", async () => {
    const operatorRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-empty-blueprint-operator-"),
    );
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-empty-blueprint-target-"),
    );
    vi.stubEnv("GH_TOKEN", "ghs_bootstrap_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: true,
          strict: true,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: true,
            fallbackProofReady: false,
            promotionReady: true,
            gatewayReachable: false,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: false,
            builtStartupProofReady: false,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 9,
            warn: 0,
            fail: 0,
          },
          checks: [],
        },
        stderr: "",
        status: 0,
      });
    const webhookUrlSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "resolveWebhookUrl")
      .mockResolvedValue({ url: null, source: null });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        repoRoot: targetRepoRoot,
        stateDir: operatorRoot,
        baseBranch: "main",
        startGateway: false,
        probeBuiltStartup: false,
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();
    webhookUrlSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(payload.config.testCommands).toEqual([]);
    expect(payload.config.testCommandSource).toBe("empty-repo-blueprint");
    expect(payload.config.blueprintFirstBootstrap).toBe(true);
    expect(payload.nextAction).toBe("clarify-project-blueprint");
    expect(payload.handoff.blueprintClarifyCommand).toContain("blueprint-clarify");
    expect(payload.handoff.blueprintAgreeCommand).toContain("blueprint-set-status");
    expect(payload.handoff.blueprintDecomposeCommand).toContain("blueprint-decompose");
  });

  it("reuses existing operator config defaults and accepts explicit chat targets", async () => {
    const operatorRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-bootstrap-existing-"));
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-existing-target-"),
    );
    await writeFile(
      path.join(operatorRoot, "openclaw.json"),
      JSON.stringify(
        {
          plugins: {
            entries: {
              openclawcode: {
                enabled: true,
                config: {
                  repos: [
                    {
                      owner: "acme",
                      repo: "demo",
                      repoRoot: targetRepoRoot,
                      baseBranch: "develop",
                      triggerMode: "approve",
                      notifyChannel: "telegram",
                      notifyTarget: "chat:123",
                      builderAgent: "builder-existing",
                      verifierAgent: "verifier-existing",
                      testCommands: ["npm test"],
                      openPullRequest: true,
                      mergeOnApprove: false,
                    },
                  ],
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    vi.stubEnv("GITHUB_TOKEN", "github_fallback_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: false,
          strict: true,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: true,
            strict: false,
            lowRiskProofReady: false,
            fallbackProofReady: false,
            promotionReady: false,
            chatSetupRoutingReady: true,
            gatewayReachable: false,
            routeProbeReady: false,
            routeProbeSkipped: false,
            builtStartupProofRequested: true,
            builtStartupProofReady: true,
            nextAction: "start-or-restart-live-gateway",
          },
          summary: {
            pass: 7,
            warn: 1,
            fail: 1,
          },
          checks: [],
        },
        stderr: "",
        status: 1,
      });
    const webhookUrlSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "resolveWebhookUrl")
      .mockResolvedValue({ url: null, source: null });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        stateDir: operatorRoot,
        mode: "chatops",
        channel: "feishu",
        chatTarget: "user:new-chat",
        startGateway: false,
        probeBuiltStartup: true,
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();
    webhookUrlSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(payload.repo.repoRootSelection).toBe("existing-operator-config");
    expect(payload.mode).toBe("chatops");
    expect(payload.notify.bindingMode).toBe("explicit");
    expect(payload.notify.notifyChannel).toBe("feishu");
    expect(payload.notify.notifyTarget).toBe("user:new-chat");
    expect(payload.config.testCommandSource).toBe("existing-config");
    expect(payload.config.builderAgent).toBe("builder-existing");
    expect(payload.config.verifierAgent).toBe("verifier-existing");
    expect(payload.credentials.githubTokenSource).toBe("GITHUB_TOKEN");
    expect(payload.proofReadiness.cliProofReady).toBe(false);
    expect(payload.proofReadiness.chatProofReady).toBe(false);
    expect(payload.proofReadiness.webhookReady).toBe(false);
    expect(payload.proofReadiness.webhookUrlReady).toBe(false);
    expect(payload.proofReadiness.needsChatBind).toBe(false);
    expect(payload.proofReadiness.needsPublicWebhookUrl).toBe(true);
    expect(payload.handoff.recommendedProofMode).toBe("chatops");
    expect(payload.handoff.gatewayRestartCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.pluginActivationRepairCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.chatSetupCommand).toBe("/occode-setup acme/demo");
    expect(payload.handoff.chatSetupStatusCommand).toBe("/occode-setup-status");
    expect(payload.handoff.chatBindCommand).toBeNull();
    expect(payload.handoff.chatStartCommand).toBe("/occode-start acme/demo#<issue-number>");
    expect(payload.handoff.webhookRetryCommand).toContain("--mode chatops");
    expect(payload.handoff.webhookRetryCommand).toContain("--channel feishu");
    expect(payload.handoff.webhookRetryCommand).toContain("--chat-target user:new-chat");
    expect(payload.nextAction).toBe("configure-public-webhook-url");
    expect(payload.webhook.action).toBe("skipped");

    const config = JSON.parse(await readFile(path.join(operatorRoot, "openclaw.json"), "utf8"));
    const repoEntry = config.plugins.entries.openclawcode.config.repos[0];
    expect(repoEntry.notifyChannel).toBe("feishu");
    expect(repoEntry.notifyTarget).toBe("user:new-chat");
    expect(repoEntry.testCommands).toEqual(["npm test"]);
  });

  it("reuses a unique saved binding when chat-target auto is requested", async () => {
    const operatorRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-auto-target-operator-"),
    );
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-auto-target-target-"),
    );
    await writeFile(
      path.join(targetRepoRoot, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest run" } }, null, 2),
      "utf8",
    );
    await writeFile(path.join(targetRepoRoot, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8");
    await OpenClawCodeChatopsStore.fromStateDir(operatorRoot).setRepoBinding({
      repoKey: "acme/existing",
      notifyChannel: "feishu",
      notifyTarget: "user:solo-chat",
    });
    vi.stubEnv("GH_TOKEN", "ghs_bootstrap_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: true,
          strict: true,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: true,
            fallbackProofReady: false,
            promotionReady: true,
            chatSetupRoutingReady: true,
            gatewayReachable: false,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: false,
            builtStartupProofReady: false,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 9,
            warn: 0,
            fail: 0,
          },
          checks: [],
        },
        stderr: "",
        status: 0,
      });
    const webhookUrlSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "resolveWebhookUrl")
      .mockResolvedValue({ url: null, source: null });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        repoRoot: targetRepoRoot,
        stateDir: operatorRoot,
        mode: "chatops",
        channel: "feishu",
        chatTarget: "auto",
        startGateway: false,
        probeBuiltStartup: false,
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();
    webhookUrlSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(payload.mode).toBe("chatops");
    expect(payload.notify.bindingMode).toBe("auto-discovered");
    expect(payload.notify.notifyChannel).toBe("feishu");
    expect(payload.notify.notifyTarget).toBe("user:solo-chat");
    expect(payload.proofReadiness.cliProofReady).toBe(true);
    expect(payload.proofReadiness.chatProofReady).toBe(true);
    expect(payload.proofReadiness.webhookReady).toBe(false);
    expect(payload.proofReadiness.webhookUrlReady).toBe(false);
    expect(payload.proofReadiness.needsChatBind).toBe(false);
    expect(payload.proofReadiness.needsPublicWebhookUrl).toBe(true);
    expect(payload.handoff.recommendedProofMode).toBe("chatops");
    expect(payload.handoff.gatewayRestartCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.pluginActivationRepairCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.chatSetupCommand).toBe("/occode-setup acme/demo");
    expect(payload.handoff.chatSetupStatusCommand).toBe("/occode-setup-status");
    expect(payload.handoff.chatBindCommand).toBeNull();
    expect(payload.handoff.chatStartCommand).toBe("/occode-start acme/demo#<issue-number>");
    expect(payload.handoff.webhookRetryCommand).toContain("--chat-target auto");
    expect(payload.webhook.action).toBe("skipped");
    expect(payload.nextAction).toBe("configure-public-webhook-url");

    const config = JSON.parse(await readFile(path.join(operatorRoot, "openclaw.json"), "utf8"));
    const repoEntry = config.plugins.entries.openclawcode.config.repos[0];
    expect(repoEntry.notifyChannel).toBe("feishu");
    expect(repoEntry.notifyTarget).toBe("user:solo-chat");

    const chatopsState = JSON.parse(
      await readFile(
        path.join(operatorRoot, "plugins", "openclawcode", "chatops-state.json"),
        "utf8",
      ),
    );
    expect(chatopsState.repoBindingsByRepo["acme/demo"]).toEqual(
      expect.objectContaining({
        notifyChannel: "feishu",
        notifyTarget: "user:solo-chat",
      }),
    );
  });

  it("reuses a preferred operator target when no repo binding exists yet", async () => {
    const operatorRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-operator-target-"),
    );
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-operator-target-repo-"),
    );
    await writeFile(
      path.join(targetRepoRoot, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest run" } }, null, 2),
      "utf8",
    );
    await writeFile(path.join(targetRepoRoot, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8");
    await setPreferredOperatorChatTarget({
      stateDir: operatorRoot,
      channel: "feishu",
      target: "user:preferred-operator",
      source: "feishu-quick-actions-menu",
    });
    vi.stubEnv("GH_TOKEN", "ghs_bootstrap_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: true,
          strict: true,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: true,
            fallbackProofReady: false,
            promotionReady: true,
            chatSetupRoutingReady: true,
            gatewayReachable: false,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: false,
            builtStartupProofReady: false,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 9,
            warn: 0,
            fail: 0,
          },
          checks: [],
        },
        stderr: "",
        status: 0,
      });
    const webhookUrlSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "resolveWebhookUrl")
      .mockResolvedValue({ url: null, source: null });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        repoRoot: targetRepoRoot,
        stateDir: operatorRoot,
        mode: "chatops",
        channel: "feishu",
        chatTarget: "auto",
        startGateway: false,
        probeBuiltStartup: false,
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();
    webhookUrlSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(payload.notify.bindingMode).toBe("auto-discovered");
    expect(payload.notify.notifyChannel).toBe("feishu");
    expect(payload.notify.notifyTarget).toBe("user:preferred-operator");

    const config = JSON.parse(await readFile(path.join(operatorRoot, "openclaw.json"), "utf8"));
    expect(config.plugins.entries.openclawcode.config.repos[0].notifyTarget).toBe(
      "user:preferred-operator",
    );
  });

  it("surfaces an explicit bind handoff when chatops bootstrap still lacks a live target", async () => {
    const operatorRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-bind-handoff-operator-"),
    );
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-bind-handoff-target-"),
    );
    await writeFile(
      path.join(targetRepoRoot, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest run" } }, null, 2),
      "utf8",
    );
    await writeFile(path.join(targetRepoRoot, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8");
    vi.stubEnv("GH_TOKEN", "ghs_bootstrap_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: true,
          strict: true,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: true,
            fallbackProofReady: false,
            promotionReady: true,
            chatSetupRoutingReady: true,
            gatewayReachable: false,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: false,
            builtStartupProofReady: false,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 9,
            warn: 0,
            fail: 0,
          },
          checks: [],
        },
        stderr: "",
        status: 0,
      });
    const webhookUrlSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "resolveWebhookUrl")
      .mockResolvedValue({ url: null, source: null });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        repoRoot: targetRepoRoot,
        stateDir: operatorRoot,
        mode: "chatops",
        channel: "feishu",
        startGateway: false,
        probeBuiltStartup: false,
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();
    webhookUrlSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(payload.notify.bindingMode).toBe("chat-placeholder");
    expect(payload.proofReadiness.cliProofReady).toBe(true);
    expect(payload.proofReadiness.chatProofReady).toBe(false);
    expect(payload.proofReadiness.webhookReady).toBe(false);
    expect(payload.proofReadiness.webhookUrlReady).toBe(false);
    expect(payload.proofReadiness.needsChatBind).toBe(true);
    expect(payload.proofReadiness.needsPublicWebhookUrl).toBe(true);
    expect(payload.handoff.recommendedProofMode).toBe("cli-only");
    expect(payload.handoff.gatewayRestartCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.pluginActivationRepairCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.chatSetupCommand).toBe("/occode-setup acme/demo");
    expect(payload.handoff.chatSetupStatusCommand).toBe("/occode-setup-status");
    expect(payload.handoff.chatBindCommand).toBe("/occode-bind acme/demo");
    expect(payload.handoff.chatStartCommand).toBe("/occode-start acme/demo#<issue-number>");
    expect(payload.nextAction).toBe("connect-chat-and-run-occode-bind");
  });

  it("surfaces plugin-activation repair commands in bootstrap JSON when chat routing is blocked", async () => {
    const operatorRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-plugin-repair-operator-"),
    );
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-plugin-repair-target-"),
    );
    await writeFile(
      path.join(targetRepoRoot, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest run" } }, null, 2),
      "utf8",
    );
    await writeFile(path.join(targetRepoRoot, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8");
    vi.stubEnv("GH_TOKEN", "ghs_bootstrap_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: false,
          strict: false,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: false,
            strict: false,
            lowRiskProofReady: false,
            fallbackProofReady: false,
            promotionReady: false,
            gatewayReachable: true,
            routeProbeReady: false,
            routeProbeSkipped: false,
            builtStartupProofRequested: true,
            builtStartupProofReady: true,
            chatSetupRoutingReady: false,
            nextAction: "repair-plugin-activation",
          },
          pluginActivation: {
            ready: false,
            pluginsEnabled: true,
            allowlisted: false,
            entryEnabled: true,
          },
          summary: {
            pass: 7,
            warn: 0,
            fail: 1,
          },
          checks: [],
        },
        stderr: "",
        status: 1,
      });
    const webhookUrlSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "resolveWebhookUrl")
      .mockResolvedValue({ url: null, source: null });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        repoRoot: targetRepoRoot,
        stateDir: operatorRoot,
        mode: "chatops",
        channel: "feishu",
        chatTarget: "user:new-chat",
        startGateway: false,
        probeBuiltStartup: true,
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();
    webhookUrlSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(payload.nextAction).toBe("repair-plugin-activation");
    expect(payload.pluginActivation).toMatchObject({
      ready: false,
      pluginsEnabled: true,
      allowlisted: false,
      entryEnabled: true,
    });
    expect(payload.handoff.pluginActivationRepairCommand).toBe("openclaw gateway restart");
    expect(payload.handoff.chatSetupCommand).toBe("/occode-setup acme/demo");
    expect(payload.handoff.chatSetupStatusCommand).toBe("/occode-setup-status");
  });

  it("fails fast when GitHub credentials are missing", async () => {
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-no-token-"),
    );

    await expect(
      openclawCodeBootstrapCommand(
        {
          repo: "acme/demo",
          repoRoot: targetRepoRoot,
          startGateway: false,
          probeBuiltStartup: false,
        },
        runtime,
      ),
    ).rejects.toThrow(
      "Bootstrap requires GH_TOKEN, GITHUB_TOKEN, or an authenticated `gh auth token` session so the target repo can be inspected and configured.",
    );
  });

  it("creates or reuses a GitHub webhook when a public URL is available", async () => {
    const operatorRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-webhook-operator-"),
    );
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-webhook-target-"),
    );
    await writeFile(
      path.join(targetRepoRoot, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest run" } }, null, 2),
      "utf8",
    );
    await writeFile(path.join(targetRepoRoot, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8");
    vi.stubEnv("GH_TOKEN", "ghs_bootstrap_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: true,
          strict: true,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: true,
            fallbackProofReady: false,
            promotionReady: true,
            chatSetupRoutingReady: true,
            gatewayReachable: true,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: false,
            builtStartupProofReady: false,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 10,
            warn: 0,
            fail: 0,
          },
          checks: [],
        },
        stderr: "",
        status: 0,
      });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        repoRoot: targetRepoRoot,
        stateDir: operatorRoot,
        startGateway: false,
        probeBuiltStartup: false,
        webhookUrl: "https://bootstrap.example.test",
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(mocks.ensureRepoWebhook).toHaveBeenCalledWith({
      owner: "acme",
      repo: "demo",
      webhookUrl: "https://bootstrap.example.test/plugins/openclawcode/github",
      secret: expect.any(String),
      events: ["issues", "pull_request", "pull_request_review"],
    });
    expect(payload.webhook.action).toBe("created");
    expect(payload.webhook.hookId).toBe(123456);
    expect(payload.webhook.webhookUrl).toBe(
      "https://bootstrap.example.test/plugins/openclawcode/github",
    );
    expect(payload.webhook.webhookUrlSource).toBe("explicit");
    expect(payload.proofReadiness.webhookReady).toBe(true);
    expect(payload.proofReadiness.webhookUrlReady).toBe(true);
    expect(payload.proofReadiness.needsPublicWebhookUrl).toBe(false);
    expect(payload.handoff.webhookRetryCommand).toBeNull();

    const envFile = await readFile(path.join(operatorRoot, "openclawcode.env"), "utf8");
    expect(envFile).toContain("export OPENCLAWCODE_GITHUB_HOOK_ID='123456'");
  });

  it("starts the managed tunnel when bootstrap cannot discover a public webhook URL", async () => {
    const operatorRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-managed-tunnel-operator-"),
    );
    const targetRepoRoot = await mkdtemp(
      path.join(os.tmpdir(), "openclawcode-bootstrap-managed-tunnel-target-"),
    );
    await writeFile(
      path.join(targetRepoRoot, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest run" } }, null, 2),
      "utf8",
    );
    await writeFile(path.join(targetRepoRoot, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n", "utf8");
    vi.stubEnv("GH_TOKEN", "ghs_bootstrap_token");

    const setupCheckSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "runSetupCheck")
      .mockReturnValue({
        payload: {
          ok: true,
          strict: true,
          repoRoot: "/operator/repo",
          operatorRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: true,
            fallbackProofReady: false,
            promotionReady: true,
            chatSetupRoutingReady: true,
            gatewayReachable: true,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: false,
            builtStartupProofReady: false,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 10,
            warn: 0,
            fail: 0,
          },
          checks: [],
        },
        stderr: "",
        status: 0,
      });
    const startGatewaySpy = vi
      .spyOn(openclawCodeBootstrapInternals, "startGateway")
      .mockResolvedValue({ action: "started" });
    const resolveWebhookUrlSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "resolveWebhookUrl")
      .mockResolvedValue({ url: null, source: null });
    const startTunnelSpy = vi
      .spyOn(openclawCodeBootstrapInternals, "startTunnel")
      .mockResolvedValue({
        action: "started",
        url: "https://bootstrap.example.test/plugins/openclawcode/github",
        error: null,
      });

    await openclawCodeBootstrapCommand(
      {
        repo: "acme/demo",
        repoRoot: targetRepoRoot,
        stateDir: operatorRoot,
        probeBuiltStartup: false,
        json: true,
      },
      runtime,
    );

    setupCheckSpy.mockRestore();
    startGatewaySpy.mockRestore();
    resolveWebhookUrlSpy.mockRestore();
    startTunnelSpy.mockRestore();

    const payload = JSON.parse(runtime.log.mock.calls.at(-1)?.[0] ?? "null");
    expect(payload.gateway.action).toBe("started");
    expect(payload.tunnel.action).toBe("started");
    expect(payload.tunnel.url).toBe("https://bootstrap.example.test/plugins/openclawcode/github");
    expect(payload.webhook.action).toBe("created");
    expect(payload.webhook.webhookUrlSource).toBe("tunnel-log");
    expect(payload.proofReadiness.webhookReady).toBe(true);
    expect(payload.proofReadiness.webhookUrlReady).toBe(true);
    expect(payload.proofReadiness.needsPublicWebhookUrl).toBe(false);
    expect(payload.handoff.webhookRetryCommand).toBeNull();
    expect(mocks.ensureRepoWebhook).toHaveBeenCalledWith({
      owner: "acme",
      repo: "demo",
      webhookUrl: "https://bootstrap.example.test/plugins/openclawcode/github",
      secret: expect.any(String),
      events: ["issues", "pull_request", "pull_request_review"],
    });

    const envFile = await readFile(path.join(operatorRoot, "openclawcode.env"), "utf8");
    expect(envFile).toContain("export OPENCLAWCODE_GITHUB_HOOK_ID='123456'");
  });
});

describe("openclawCodeRepoPlanCommand", () => {
  const runtime = createTestRuntime();

  beforeEach(() => {
    vi.stubEnv("GH_TOKEN", "ghs_repo_plan_token");
    delete process.env.GITHUB_TOKEN;
  });

  it("lists recent accessible repositories for the existing-repo flow", async () => {
    mocks.listAccessibleRepositories.mockResolvedValue([
      {
        owner: "acme",
        repo: "igallery",
        description: "Shared gallery",
        private: true,
        defaultBranch: "main",
        url: "https://github.com/acme/igallery",
        updatedAt: "2026-03-18T09:00:00Z",
      },
      {
        owner: "acme",
        repo: "photo-vault",
        description: "Private photo app",
        private: false,
        defaultBranch: "main",
        url: "https://github.com/acme/photo-vault",
        updatedAt: "2026-03-17T09:00:00Z",
      },
    ]);

    await openclawCodeRepoPlanCommand(
      {
        owner: "acme",
        existing: true,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(String(runtime.log.mock.calls.at(-1)?.[0] ?? "{}"));
    expect(payload.mode).toBe("existing");
    expect(payload.credentials.githubTokenSource).toBe("GH_TOKEN");
    expect(payload.repositories).toHaveLength(2);
    expect(payload.nextAction).toContain("openclaw code bootstrap --repo acme/igallery --json");
  });

  it("creates a chosen repository for the new-project flow", async () => {
    mocks.createRepository.mockResolvedValue({
      owner: "acme",
      repo: "igallery-app",
      description: "Shared image gallery",
      private: false,
      defaultBranch: "main",
      url: "https://github.com/acme/igallery-app",
      updatedAt: "2026-03-18T10:00:00Z",
    });

    await openclawCodeRepoPlanCommand(
      {
        owner: "acme",
        project: "Shared image gallery for family albums",
        repo: "igallery-app",
        create: true,
        visibility: "public",
        json: true,
      },
      runtime,
    );

    expect(mocks.createRepository).toHaveBeenCalledWith({
      owner: "acme",
      name: "igallery-app",
      description: "Shared image gallery for family albums",
      private: false,
    });
    const payload = JSON.parse(String(runtime.log.mock.calls.at(-1)?.[0] ?? "{}"));
    expect(payload.mode).toBe("new");
    expect(payload.createdRepository.repo).toBe("igallery-app");
    expect(payload.nextAction).toBe("openclaw code bootstrap --repo acme/igallery-app --json");
  });
});

describe("openclawCodePolicyShowCommand", () => {
  const runtime = createTestRuntime();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints a machine-readable policy snapshot", async () => {
    await openclawCodePolicyShowCommand({ json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.contractVersion).toBe(1);
    expect(payload.suitability.lowRiskLabels).toContain("json");
    expect(payload.suitability.highRiskLabels).toContain("security");
    expect(payload.buildGuardrails.largeDiffLineThreshold).toBe(300);
    expect(payload.providerFailureHandling.autoPauseClasses).toContain("provider-internal-error");
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

function runGitTestCommand(cwd: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

async function createPromotionArtifactRepoRoot(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-promotion-artifact-"));
  await mkdir(path.join(repoRoot, "scripts"), { recursive: true });
  await writeFile(path.join(repoRoot, "README.md"), "# promotion artifact repo\n", "utf8");
  runGitTestCommand(repoRoot, ["init", "-b", "main"]);
  runGitTestCommand(repoRoot, ["config", "user.email", "test@example.com"]);
  runGitTestCommand(repoRoot, ["config", "user.name", "OpenClawCode Test"]);
  runGitTestCommand(repoRoot, ["add", "README.md"]);
  runGitTestCommand(repoRoot, ["commit", "-m", "init"]);
  runGitTestCommand(repoRoot, ["checkout", "-b", "sync/upstream-2026-03-16"]);
  await writeFile(
    path.join(repoRoot, "scripts", "openclawcode-setup-check.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "ok": true,
  "strict": true,
  "repoRoot": ${JSON.stringify(repoRoot)},
  "operatorRoot": "/tmp/openclaw-operator",
  "readiness": {
    "basic": true,
    "strict": true,
    "lowRiskProofReady": true,
    "fallbackProofReady": false,
    "promotionReady": true,
    "gatewayReachable": true,
    "routeProbeReady": true,
    "routeProbeSkipped": false,
    "builtStartupProofRequested": true,
    "builtStartupProofReady": true,
    "nextAction": "ready-for-promotion"
  },
  "summary": {
    "pass": 19,
    "warn": 0,
    "fail": 0
  }
}
EOF
`,
    "utf8",
  );
  await writeFile(
    path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
    [
      "---",
      "schemaVersion: 1",
      "title: Promotion Blueprint",
      "status: agreed",
      "createdAt: 2026-03-16T00:00:00.000Z",
      "updatedAt: 2026-03-16T00:00:00.000Z",
      "statusChangedAt: 2026-03-16T00:00:00.000Z",
      "agreedAt: 2026-03-16T00:00:00.000Z",
      "---",
      "",
      "# Promotion Blueprint",
      "",
      "## Goal",
      "Ship machine-readable promotion and rollback artifacts.",
      "",
      "## Success Criteria",
      "- Persist promotion readiness for automation.",
      "",
      "## Scope",
      "- In scope: repo-local release artifacts.",
      "- Out of scope: live promotion itself.",
      "",
      "## Non-Goals",
      "- None.",
      "",
      "## Constraints",
      "- Technical: use deterministic files.",
      "",
      "## Risks",
      "- Promotion may be attempted without a stable rollback target.",
      "",
      "## Assumptions",
      "- main is the long-lived baseline branch.",
      "",
      "## Human Gates",
      "- Goal agreement: required",
      "- Merge or promotion: operator may intervene",
      "",
      "## Provider Strategy",
      "- Planner: Claude Code",
      "- Coder: Codex",
      "- Verifier: Codex",
      "",
      "## Workstreams",
      "- Persist promotion and rollback artifacts.",
      "",
      "## Open Questions",
      "- None.",
      "",
      "## Change Log",
      "- 2026-03-16: promotion artifact baseline.",
      "",
    ].join("\n"),
    "utf8",
  );
  return repoRoot;
}

async function attachUpstreamDriftFixture(repoRoot: string): Promise<void> {
  const upstreamBare = path.join(
    await mkdtemp(path.join(os.tmpdir(), "openclawcode-upstream-bare-")),
    "upstream.git",
  );
  const upstreamWork = await mkdtemp(path.join(os.tmpdir(), "openclawcode-upstream-work-"));

  runGitTestCommand(repoRoot, ["clone", "--bare", repoRoot, upstreamBare]);
  runGitTestCommand(path.dirname(upstreamWork), ["clone", upstreamBare, upstreamWork]);
  runGitTestCommand(upstreamWork, ["config", "user.email", "test@example.com"]);
  runGitTestCommand(upstreamWork, ["config", "user.name", "OpenClawCode Test"]);
  runGitTestCommand(upstreamWork, ["checkout", "main"]);
  await writeFile(path.join(upstreamWork, "UPSTREAM.md"), "upstream drift\n", "utf8");
  runGitTestCommand(upstreamWork, ["add", "UPSTREAM.md"]);
  runGitTestCommand(upstreamWork, ["commit", "-m", "upstream drift"]);
  runGitTestCommand(upstreamWork, ["push", "origin", "main"]);

  runGitTestCommand(repoRoot, ["remote", "add", "upstream", upstreamBare]);
  runGitTestCommand(repoRoot, ["fetch", "upstream", "main"]);
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
      body: "Add one more stable command JSON field and update targeted command tests.",
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
      policySignals: {
        changedLineCount: 24,
        changedDirectoryCount: 2,
        broadFanOut: false,
        largeDiff: false,
        generatedFiles: [],
      },
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
      allowlisted: true,
      denylisted: false,
      overrideApplied: false,
    },
    blueprintContext: {
      path: "/repo/PROJECT-BLUEPRINT.md",
      status: "agreed",
      revisionId: "blueprint_rev_123",
      agreed: true,
      defaultedSectionCount: 0,
      workstreamCandidateCount: 1,
      openQuestionCount: 0,
      humanGateCount: 3,
    },
    roleRouting: {
      artifactExists: true,
      blueprintRevisionId: "blueprint_rev_123",
      mixedMode: true,
      fallbackConfigured: true,
      unresolvedRoleCount: 0,
      routes: [
        {
          roleId: "planner",
          adapterId: "claude-code",
          source: "blueprint",
          configured: true,
          fallbackChain: ["openai/gpt-5.4"],
        },
        {
          roleId: "coder",
          adapterId: "codex",
          source: "blueprint",
          configured: true,
          fallbackChain: ["openai/gpt-5.4"],
        },
        {
          roleId: "reviewer",
          adapterId: "claude-code",
          source: "blueprint",
          configured: true,
          fallbackChain: ["openai/gpt-5.4"],
        },
        {
          roleId: "verifier",
          adapterId: "codex",
          source: "blueprint",
          configured: true,
          fallbackChain: ["openai/gpt-5.4"],
        },
        {
          roleId: "docWriter",
          adapterId: "codex",
          source: "blueprint",
          configured: true,
          fallbackChain: ["openai/gpt-5.4"],
        },
      ],
    },
    runtimeRouting: {
      selections: [
        {
          roleId: "coder",
          adapterId: "codex",
          assignmentSource: "blueprint",
          configured: true,
          appliedAgentId: "codex-coder",
          agentSource: "adapter-env",
        },
        {
          roleId: "verifier",
          adapterId: "codex",
          assignmentSource: "blueprint",
          configured: true,
          appliedAgentId: "codex-verifier",
          agentSource: "role-env",
        },
      ],
    },
    stageGates: {
      artifactExists: true,
      blueprintRevisionId: "blueprint_rev_123",
      gateCount: 5,
      blockedGateCount: 0,
      needsHumanDecisionCount: 1,
      gates: [
        {
          gateId: "goal-agreement",
          readiness: "ready",
          decisionRequired: true,
          blockerCount: 0,
          suggestionCount: 1,
          latestDecision: null,
        },
        {
          gateId: "work-item-projection",
          readiness: "ready",
          decisionRequired: true,
          blockerCount: 0,
          suggestionCount: 0,
          latestDecision: null,
        },
        {
          gateId: "execution-routing",
          readiness: "ready",
          decisionRequired: true,
          blockerCount: 0,
          suggestionCount: 1,
          latestDecision: null,
        },
        {
          gateId: "execution-start",
          readiness: "needs-human-decision",
          decisionRequired: true,
          blockerCount: 0,
          suggestionCount: 1,
          latestDecision: null,
        },
        {
          gateId: "merge-promotion",
          readiness: "ready",
          decisionRequired: true,
          blockerCount: 0,
          suggestionCount: 1,
          latestDecision: {
            decision: "approved",
            note: "Ready to promote once verification passes.",
            actor: "operator",
            recordedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ],
    },
    planReview: undefined,
    planEdits: undefined,
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
