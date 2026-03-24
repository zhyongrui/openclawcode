import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runIssueWorkflow,
  type PullRequestMerger,
  type PullRequestPublisher,
} from "../app/index.js";
import type {
  BuildPolicySignals,
  BuildResult,
  IssueRef,
  VerificationReport,
  WorkflowRun,
  WorkflowRuntimeRoleSelection,
  WorkflowWorkspace,
} from "../contracts/index.js";
import type { GitHubIssueClient, PullRequestRef, RepoRef } from "../github/index.js";
import { FileSystemWorkflowRunStore } from "../persistence/index.js";
import type { Builder, Verifier } from "../roles/index.js";
import { HeuristicPlanner } from "../roles/index.js";
import { AgentRunFailureError, type ShellRunner } from "../runtime/index.js";
import type { WorkflowWorkspaceManager } from "../worktree/index.js";

function createSequenceNow(startAt = Date.UTC(2026, 2, 9, 13, 0, 0)): () => string {
  let tick = 0;
  return () => new Date(startAt + tick++ * 1_000).toISOString();
}

class FakeGitHubClient implements GitHubIssueClient {
  published: PullRequestRef[] = [];
  promoted: number[] = [];
  merged: number[] = [];
  closedIssues: number[] = [];
  existingPullRequest?: PullRequestRef;
  issueOverride?: IssueRef;

  async fetchIssue(ref: RepoRef & { issueNumber: number }): Promise<IssueRef> {
    return (
      this.issueOverride ?? {
        owner: ref.owner,
        repo: ref.repo,
        number: ref.issueNumber,
        title: "Implement workflow CLI",
        body: "Add an executable code workflow entrypoint.",
        labels: ["automation"],
      }
    );
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

  async fetchIssueState(): Promise<{ state: "open" | "closed" }> {
    return { state: "open" };
  }

  async fetchPullRequest(request: { pullNumber: number }): Promise<{
    number: number;
    url: string;
    state: "open" | "closed";
    draft: boolean;
    merged: boolean;
    mergedAt?: string;
  }> {
    return {
      number: request.pullNumber,
      url: `https://github.com/example/repo/pull/${request.pullNumber}`,
      state: "open",
      draft: true,
      merged: false,
    };
  }

  async fetchLatestPullRequestReview(): Promise<undefined> {
    return undefined;
  }

  async findOpenPullRequestForBranch(): Promise<PullRequestRef | undefined> {
    return this.existingPullRequest;
  }

  async createDraftPullRequest(): Promise<PullRequestRef> {
    const value = { number: 99, url: "https://github.com/example/repo/pull/99" };
    this.published.push(value);
    return value;
  }

  async markPullRequestReadyForReview(request: { pullNumber: number }): Promise<void> {
    this.promoted.push(request.pullNumber);
  }

  async mergePullRequest(request: { pullNumber: number }): Promise<void> {
    this.merged.push(request.pullNumber);
  }

  async closeIssue(request: { issueNumber: number }): Promise<void> {
    this.closedIssues.push(request.issueNumber);
  }
}

class ReusedPullRequestGitHubClient extends FakeGitHubClient {
  constructor(existingPullRequest: PullRequestRef) {
    super();
    this.existingPullRequest = existingPullRequest;
  }
}

class FakeWorkspaceManager implements WorkflowWorkspaceManager {
  prepareCalls = 0;

  constructor(
    private readonly workspace: WorkflowWorkspace,
    private readonly changedFiles: string[],
  ) {}

  async prepare(): Promise<WorkflowWorkspace> {
    this.prepareCalls += 1;
    return this.workspace;
  }

  async collectChangedFiles(): Promise<string[]> {
    return this.changedFiles;
  }

  async cleanup(): Promise<void> {}
}

class FakeBuilder implements Builder {
  buildCalls = 0;
  lastRun?: WorkflowRun;

  constructor(
    private readonly scope: "command-layer" | "workflow-core" | "mixed" = "command-layer",
    private readonly changedFiles: string[] = ["src/commands/openclawcode.ts"],
    private readonly policySignals?: BuildPolicySignals,
  ) {}

  async build(run: WorkflowRun): Promise<BuildResult> {
    this.buildCalls += 1;
    this.lastRun = run;
    return {
      branchName: run.workspace?.branchName ?? "openclawcode/issue-1",
      summary: "Builder updated the CLI implementation.",
      changedFiles: this.changedFiles,
      policySignals: this.policySignals,
      issueClassification: this.scope,
      scopeCheck: {
        ok: true,
        blockedFiles: [],
        summary: `Scope check passed for ${this.scope} issue.`,
      },
      testCommands: ["pnpm test"],
      testResults: ["PASS pnpm test"],
      notes: [],
    };
  }
}

class FakeVerifier implements Verifier {
  constructor(private readonly report: VerificationReport) {}

  async verify(): Promise<VerificationReport> {
    return this.report;
  }
}

class RuntimeAwareFakeBuilder extends FakeBuilder {
  constructor(private readonly selection: WorkflowRuntimeRoleSelection) {
    super();
  }

  override previewRuntimeRouting(): WorkflowRuntimeRoleSelection {
    return this.selection;
  }
}

class RuntimeAwareFakeVerifier extends FakeVerifier {
  constructor(
    report: VerificationReport,
    private readonly selection: WorkflowRuntimeRoleSelection,
  ) {
    super(report);
  }

  override previewRuntimeRouting(): WorkflowRuntimeRoleSelection {
    return this.selection;
  }
}

class FailingBuilder implements Builder {
  constructor(private readonly error: Error) {}

  async build(): Promise<BuildResult> {
    throw this.error;
  }
}

class HighRiskPlanner extends HeuristicPlanner {
  override async plan(issue: IssueRef) {
    const spec = await super.plan(issue);
    return {
      ...spec,
      riskLevel: "high" as const,
    };
  }
}

class OpenQuestionPlanner extends HeuristicPlanner {
  override async plan(issue: IssueRef) {
    const spec = await super.plan(issue);
    return {
      ...spec,
      openQuestions: ["Clarify whether this should stay docs-only or change workflow behavior."],
    };
  }
}

class NoopShellRunner implements ShellRunner {
  commands: string[] = [];

  async run(request: { cwd: string; command: string }) {
    this.commands.push(`${request.cwd}:${request.command}`);
    return {
      command: request.command,
      code: 0,
      stdout: "",
      stderr: "",
    };
  }
}

class FakePublisher implements PullRequestPublisher {
  published = 0;
  drafts: boolean[] = [];

  constructor(private readonly value: PullRequestRef) {}

  async publish(params: { draft?: boolean }): Promise<PullRequestRef> {
    this.published += 1;
    this.drafts.push(params.draft ?? true);
    return this.value;
  }
}

class FakeMerger implements PullRequestMerger {
  merged = 0;

  async merge(): Promise<void> {
    this.merged += 1;
  }
}

class FailingMerger implements PullRequestMerger {
  async merge(): Promise<void> {
    throw new Error(
      'GitHub API request failed: 403 Forbidden {"message":"Resource not accessible by personal access token"}',
    );
  }
}

class FailingIssueCloseGitHubClient extends FakeGitHubClient {
  override async closeIssue(): Promise<void> {
    throw new Error(
      'GitHub API request failed: 403 Forbidden {"message":"Resource not accessible by personal access token"}',
    );
  }
}

class NoCommitPublisher implements PullRequestPublisher {
  async publish(): Promise<PullRequestRef> {
    throw new Error(
      'GitHub API request failed: 422 Unprocessable Entity {"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"No commits between main and openclawcode/issue-17-automerge-disposition"}]}',
    );
  }
}

class NotFoundReadyForReviewGitHubClient extends FakeGitHubClient {
  override async markPullRequestReadyForReview(): Promise<void> {
    throw new Error('GitHub API request failed: 404 Not Found {"message":"Not Found"}');
  }
}

describe("runIssueWorkflow", () => {
  it(
    "publishes and merges when verification approves and merge is enabled",
    { timeout: 90_000 },
    async () => {
      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

      try {
        const workspace: WorkflowWorkspace = {
          repoRoot: "/repo",
          baseBranch: "main",
          branchName: "openclawcode/issue-55",
          worktreePath: "/repo/.openclawcode/worktrees/run-55",
          preparedAt: "2026-03-09T13:00:00.000Z",
        };
        const merger = new FakeMerger();
        const github = new FakeGitHubClient();
        const publisher = new FakePublisher({
          number: 99,
          url: "https://github.com/zhyongrui/openclawcode/pull/99",
        });
        const run = await runIssueWorkflow(
          {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 55,
            repoRoot: "/repo",
            stateDir,
            baseBranch: "main",
            openPullRequest: true,
            mergeOnApprove: true,
          },
          {
            github,
            planner: new HeuristicPlanner(),
            builder: new FakeBuilder(),
            verifier: new FakeVerifier({
              decision: "approve-for-human-review",
              summary: "Looks good.",
              findings: [],
              missingCoverage: [],
              followUps: [],
            }),
            store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
            worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
            shellRunner: new NoopShellRunner(),
            publisher,
            merger,
            now: createSequenceNow(),
          },
        );

        expect(run.stage).toBe("merged");
        expect(run.draftPullRequest?.number).toBe(99);
        expect(run.draftPullRequest?.url).toBe("https://github.com/zhyongrui/openclawcode/pull/99");
        expect(run.history).toContain(
          "Pull request opened: https://github.com/zhyongrui/openclawcode/pull/99",
        );
        expect(run.history).toContain("Issue #55 closed automatically after merge.");
        expect(merger.merged).toBe(1);
        expect(github.promoted).toEqual([]);
        expect(publisher.drafts).toEqual([false]);
        expect(github.closedIssues).toEqual([55]);

        const savedRun = JSON.parse(
          await fs.readFile(path.join(stateDir, "runs", `${run.id}.json`), "utf8"),
        ) as typeof run;
        expect(savedRun.draftPullRequest?.number).toBe(99);
        expect(savedRun.draftPullRequest?.url).toBe(
          "https://github.com/zhyongrui/openclawcode/pull/99",
        );
        expect(savedRun.buildResult?.issueClassification).toBe("command-layer");
        expect(savedRun.buildResult?.scopeCheck?.summary).toBe(
          "Scope check passed for command-layer issue.",
        );
        expect(savedRun.suitability?.decision).toBe("auto-run");
        expect(savedRun.history).toContain("Issue #55 closed automatically after merge.");
      } finally {
        await fs.rm(stateDir, { recursive: true, force: true });
      }
    },
  );

  it("keeps the draft pull request base branch aligned with a non-main workflow base", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "sync/upstream-2026-03-12",
        branchName: "openclawcode/issue-66-sync-upstream-2026-03-12",
        worktreePath: "/repo/.openclawcode/worktrees/run-66",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const github = new FakeGitHubClient();
      const publisher = new FakePublisher({
        number: 111,
        url: "https://github.com/zhyongrui/openclawcode/pull/111",
      });
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 66,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "sync/upstream-2026-03-12",
          openPullRequest: true,
          mergeOnApprove: false,
        },
        {
          github,
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder("mixed", ["docs/openclawcode/README.md"]),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["docs/openclawcode/README.md"]),
          shellRunner: new NoopShellRunner(),
          publisher,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("ready-for-human-review");
      expect(run.draftPullRequest?.baseBranch).toBe("sync/upstream-2026-03-12");

      const savedRun = JSON.parse(
        await fs.readFile(path.join(stateDir, "runs", `${run.id}.json`), "utf8"),
      ) as typeof run;
      expect(savedRun.draftPullRequest?.baseBranch).toBe("sync/upstream-2026-03-12");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("records an auto-run suitability assessment before preparing the workspace", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-77",
        worktreePath: "/repo/.openclawcode/worktrees/run-77",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const github = new FakeGitHubClient();
      github.issueOverride = {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 77,
        title: "Expose verification summary in openclaw code run --json output",
        body: "Add one more stable command JSON field and update targeted command tests.",
        labels: ["enhancement"],
      };
      const workspaceManager = new FakeWorkspaceManager(workspace, [
        "src/commands/openclawcode.ts",
      ]);
      const builder = new FakeBuilder();

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 77,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
        },
        {
          github,
          planner: new HeuristicPlanner(),
          builder,
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: workspaceManager,
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.suitability).toMatchObject({
        decision: "auto-run",
        classification: "command-layer",
        riskLevel: "medium",
      });
      expect(run.history).toContain(
        "Suitability assessed: Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
      );
      expect(workspaceManager.prepareCalls).toBe(1);
      expect(builder.buildCalls).toBe(1);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("halts after planning when explicit plan approval is required", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-177",
        worktreePath: "/repo/.openclawcode/worktrees/run-177",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const workspaceManager = new FakeWorkspaceManager(workspace, [
        "src/commands/openclawcode.ts",
      ]);
      const builder = new FakeBuilder();

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 177,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          requirePlanApproval: true,
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder,
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: workspaceManager,
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("awaiting-plan-approval");
      expect(run.planReview).toMatchObject({
        required: true,
        status: "awaiting-approval",
      });
      expect(run.planReview?.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(run.planReview?.requestedAt).toBe(run.updatedAt);
      expect(workspaceManager.prepareCalls).toBe(0);
      expect(builder.buildCalls).toBe(0);
      expect(run.history.at(-1)).toBe(
        "Plan approval required before workspace preparation and code execution.",
      );

      const savedRun = JSON.parse(
        await fs.readFile(path.join(stateDir, "runs", `${run.id}.json`), "utf8"),
      ) as typeof run;
      expect(savedRun.stage).toBe("awaiting-plan-approval");
      expect(savedRun.planReview?.status).toBe("awaiting-approval");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("applies a plan edit patch before code execution", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-176",
        worktreePath: "/repo/.openclawcode/worktrees/run-176",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const workspaceManager = new FakeWorkspaceManager(workspace, [
        "src/commands/openclawcode.ts",
      ]);
      const builder = new FakeBuilder();

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 176,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          planEdit: {
            summary: "Implement the issue with an operator-edited execution plan.",
            scope: ["Only touch the CLI run command."],
            testPlan: ["Run the targeted run-command Vitest cases."],
            riskLevel: "low",
          },
          planEditActor: "chat:operator",
          planEditNote: "Narrow this down to the CLI surface first.",
          planEditSource: "/repo/.openclawcode/plan-edit.json",
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder,
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: workspaceManager,
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("ready-for-human-review");
      expect(run.executionSpec).toMatchObject({
        summary: "Implement the issue with an operator-edited execution plan.",
        scope: ["Only touch the CLI run command."],
        testPlan: ["Run the targeted run-command Vitest cases."],
        riskLevel: "low",
      });
      expect(run.planEdits).toEqual([
        expect.objectContaining({
          actor: "chat:operator",
          note: "Narrow this down to the CLI surface first.",
          source: "/repo/.openclawcode/plan-edit.json",
          editedFields: ["summary", "scope", "testPlan", "riskLevel"],
        }),
      ]);
      expect(run.handoffs?.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "plan-edit",
            actor: "chat:operator",
          }),
        ]),
      );
      expect(builder.lastRun?.executionSpec).toMatchObject({
        summary: "Implement the issue with an operator-edited execution plan.",
        riskLevel: "low",
      });
      expect(run.history).toContain(
        "Plan edited before code execution: summary, scope, testPlan, riskLevel.",
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("recomputes the plan digest after a plan edit when approval is required", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-182",
        worktreePath: "/repo/.openclawcode/worktrees/run-182",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const baseRun = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 182,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          requirePlanApproval: true,
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      const editedRun = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 182,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          requirePlanApproval: true,
          planEdit: {
            openQuestions: ["Confirm whether this should stay JSON-only in this slice."],
          },
          planEditActor: "chat:operator",
          planEditSource: "/repo/.openclawcode/plan-edit.json",
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(Date.UTC(2026, 2, 9, 14, 30, 0)),
        },
      );

      expect(baseRun.planReview?.planDigest).toMatch(/^sha256:/);
      expect(editedRun.planReview?.planDigest).toMatch(/^sha256:/);
      expect(editedRun.planReview?.planDigest).not.toBe(baseRun.planReview?.planDigest);
      expect(editedRun.planEdits?.at(-1)).toMatchObject({
        editedFields: ["openQuestions"],
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("continues into build when the current plan digest is explicitly approved", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-178",
        worktreePath: "/repo/.openclawcode/worktrees/run-178",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const initialWorkspaceManager = new FakeWorkspaceManager(workspace, [
        "src/commands/openclawcode.ts",
      ]);
      const initialBuilder = new FakeBuilder();

      const pausedRun = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 178,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          requirePlanApproval: true,
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: initialBuilder,
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: initialWorkspaceManager,
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      const approvedWorkspaceManager = new FakeWorkspaceManager(workspace, [
        "src/commands/openclawcode.ts",
      ]);
      const approvedBuilder = new FakeBuilder();
      const continuedRun = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 178,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          requirePlanApproval: true,
          approvePlanDigest: pausedRun.planReview?.planDigest,
          planApprovalActor: "chat:operator",
          planApprovalNote: "Proceed with the current implementation plan.",
          planApprovalSource: "cli",
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: approvedBuilder,
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: approvedWorkspaceManager,
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(Date.UTC(2026, 2, 9, 14, 0, 0)),
        },
      );

      expect(continuedRun.stage).toBe("ready-for-human-review");
      expect(continuedRun.planReview).toMatchObject({
        required: true,
        status: "approved",
        planDigest: pausedRun.planReview?.planDigest,
        suppliedDigest: pausedRun.planReview?.planDigest,
        approvedBy: "chat:operator",
        approvalSource: "cli",
        approvalNote: "Proceed with the current implementation plan.",
      });
      expect(continuedRun.planReview?.approvedAt).toBeDefined();
      expect(approvedWorkspaceManager.prepareCalls).toBe(1);
      expect(approvedBuilder.buildCalls).toBe(1);
      expect(continuedRun.history).toContain(
        `Plan approved for code execution: ${pausedRun.planReview?.planDigest}`,
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("re-halts when a supplied approval digest no longer matches the current plan", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-181",
        worktreePath: "/repo/.openclawcode/worktrees/run-181",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const workspaceManager = new FakeWorkspaceManager(workspace, [
        "src/commands/openclawcode.ts",
      ]);
      const builder = new FakeBuilder();

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 181,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          requirePlanApproval: true,
          approvePlanDigest: "sha256:stale-plan",
          planApprovalActor: "chat:operator",
          planApprovalNote: "Trying to continue from an older plan.",
          planApprovalSource: "cli",
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder,
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: workspaceManager,
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("awaiting-plan-approval");
      expect(run.planReview).toMatchObject({
        required: true,
        status: "awaiting-approval",
        suppliedDigest: "sha256:stale-plan",
        approvedBy: "chat:operator",
        approvalSource: "cli",
        approvalNote: "Trying to continue from an older plan.",
      });
      expect(run.planReview?.planDigest).not.toBe("sha256:stale-plan");
      expect(workspaceManager.prepareCalls).toBe(0);
      expect(builder.buildCalls).toBe(0);
      expect(run.history.at(-1)).toContain("Plan approval digest mismatch");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("escalates high-risk issues before any branch mutation starts", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-78",
        worktreePath: "/repo/.openclawcode/worktrees/run-78",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const github = new FakeGitHubClient();
      github.issueOverride = {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 78,
        title: "Rotate authentication secrets for the webhook gateway",
        body: "Update authentication and secret handling for webhook delivery.",
        labels: ["security"],
      };
      const workspaceManager = new FakeWorkspaceManager(workspace, [
        "src/commands/openclawcode.ts",
      ]);
      const builder = new FakeBuilder();

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 78,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
        },
        {
          github,
          planner: new HighRiskPlanner(),
          builder,
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: workspaceManager,
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("escalated");
      expect(run.suitability).toMatchObject({
        decision: "escalate",
        riskLevel: "high",
      });
      expect(run.workspace).toBeUndefined();
      expect(workspaceManager.prepareCalls).toBe(0);
      expect(builder.buildCalls).toBe(0);
      expect(run.history.at(-1)).toContain(
        "Suitability gate escalated the issue before branch mutation",
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("skips auto-merge when suitability requires human review", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-79",
        worktreePath: "/repo/.openclawcode/worktrees/run-79",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const github = new FakeGitHubClient();
      github.issueOverride = {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 79,
        title: "Expose more openclaw code run --json output",
        body: "",
        labels: ["enhancement"],
      };
      const merger = new FakeMerger();

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 79,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
          mergeOnApprove: true,
        },
        {
          github,
          planner: new OpenQuestionPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          publisher: new FakePublisher({
            number: 120,
            url: "https://github.com/zhyongrui/openclawcode/pull/120",
          }),
          merger,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("ready-for-human-review");
      expect(run.suitability?.decision).toBe("needs-human-review");
      expect(run.history).toContain(
        "Auto-merge skipped: Not eligible for auto-merge: suitability did not accept autonomous execution.",
      );
      expect(merger.merged).toBe(0);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("lets an operator suitability override continue execution but still blocks auto-merge", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-179",
        worktreePath: "/repo/.openclawcode/worktrees/run-179",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const github = new FakeGitHubClient();
      github.issueOverride = {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 179,
        title: "Expose orchestrator retry metadata in openclaw code run --json output",
        body: [
          "Update the CLI output and workflow persistence so retry metadata is visible.",
          "This also requires orchestrator resume behavior and stored run record updates.",
        ].join(" "),
        labels: ["enhancement"],
      };
      const merger = new FakeMerger();
      const builder = new FakeBuilder();

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 179,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
          mergeOnApprove: true,
          suitabilityOverride: {
            actor: "chat:operator",
            reason: "Operator approved this narrow exception.",
          },
        },
        {
          github,
          planner: new OpenQuestionPlanner(),
          builder,
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          publisher: new FakePublisher({
            number: 179,
            url: "https://github.com/zhyongrui/openclawcode/pull/179",
          }),
          merger,
          now: createSequenceNow(),
        },
      );

      expect(builder.buildCalls).toBe(1);
      expect(run.stage).toBe("ready-for-human-review");
      expect(run.suitability).toMatchObject({
        decision: "auto-run",
        originalDecision: "needs-human-review",
        overrideApplied: true,
        overrideActor: "chat:operator",
      });
      expect(run.handoffs?.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "suitability-override",
            actor: "chat:operator",
            summary: "Operator approved this narrow exception.",
          }),
        ]),
      );
      expect(run.history).toContain(
        "Auto-merge skipped: Not eligible for auto-merge: manual suitability overrides still require a human merge decision.",
      );
      expect(merger.merged).toBe(0);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("skips auto-merge when build guardrails detect a large generated diff", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-180",
        worktreePath: "/repo/.openclawcode/worktrees/run-180",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const merger = new FakeMerger();

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 180,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
          mergeOnApprove: true,
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder("command-layer", ["src/generated/output.gen.ts"], {
            changedLineCount: 420,
            changedDirectoryCount: 5,
            broadFanOut: true,
            largeDiff: true,
            generatedFiles: ["src/generated/output.gen.ts"],
          }),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/generated/output.gen.ts"]),
          shellRunner: new NoopShellRunner(),
          publisher: new FakePublisher({
            number: 180,
            url: "https://github.com/zhyongrui/openclawcode/pull/180",
          }),
          merger,
          now: createSequenceNow(),
        },
      );

      expect(run.buildResult?.policySignals).toMatchObject({
        broadFanOut: true,
        largeDiff: true,
        generatedFiles: ["src/generated/output.gen.ts"],
      });
      expect(run.history).toContain(
        "Auto-merge skipped: Not eligible for auto-merge: generated files were changed and require explicit human review.",
      );
      expect(merger.merged).toBe(0);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps merged runs usable when issue close fails after auto-merge", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-63",
        worktreePath: "/repo/.openclawcode/worktrees/run-63",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const merger = new FakeMerger();
      const github = new FailingIssueCloseGitHubClient();
      const publisher = new FakePublisher({
        number: 105,
        url: "https://github.com/zhyongrui/openclawcode/pull/105",
      });
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 63,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
          mergeOnApprove: true,
        },
        {
          github,
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          publisher,
          merger,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("merged");
      expect(run.history).toContain("Pull request merged automatically");
      expect(run.history.at(-1)).toContain(
        "Issue close failed for #63: GitHub token cannot update issues.",
      );
      expect(run.history.at(-1)).toContain("Ensure GH_TOKEN/GITHUB_TOKEN has issues write access.");
      expect(merger.merged).toBe(1);

      const savedRun = JSON.parse(
        await fs.readFile(path.join(stateDir, "runs", `${run.id}.json`), "utf8"),
      ) as typeof run;
      expect(savedRun.stage).toBe("merged");
      expect(savedRun.history.at(-1)).toContain(
        "Issue close failed for #63: GitHub token cannot update issues.",
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps approved workflow-core runs for human review even when merge-on-approve is enabled", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-57",
        worktreePath: "/repo/.openclawcode/worktrees/run-57",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const merger = new FakeMerger();
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 57,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
          mergeOnApprove: true,
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder("workflow-core"),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, [
            "src/openclawcode/orchestrator/run.ts",
          ]),
          shellRunner: new NoopShellRunner(),
          publisher: new FakePublisher({
            number: 100,
            url: "https://github.com/zhyongrui/openclawcode/pull/100",
          }),
          merger,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("ready-for-human-review");
      expect(merger.merged).toBe(0);
      expect(run.history).toContain(
        "Auto-merge skipped: Not eligible for auto-merge: the run is not classified as command-layer.",
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps approved runs at ready-for-human-review when auto-merge fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-58",
        worktreePath: "/repo/.openclawcode/worktrees/run-58",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const github = new FakeGitHubClient();
      const publisher = new FakePublisher({
        number: 101,
        url: "https://github.com/zhyongrui/openclawcode/pull/101",
      });
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 58,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
          mergeOnApprove: true,
        },
        {
          github,
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          publisher,
          merger: new FailingMerger(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("ready-for-human-review");
      expect(run.history).toContain(
        "Pull request opened: https://github.com/zhyongrui/openclawcode/pull/101",
      );
      expect(run.history.at(-1)).toContain(
        "Auto-merge failed: GitHub token cannot merge pull requests.",
      );
      expect(run.history.at(-1)).toContain(
        "Ensure GH_TOKEN/GITHUB_TOKEN has pull request and contents write access.",
      );

      const savedRun = JSON.parse(
        await fs.readFile(path.join(stateDir, "runs", `${run.id}.json`), "utf8"),
      ) as typeof run;
      expect(savedRun.stage).toBe("ready-for-human-review");
      expect(savedRun.history.at(-1)).toContain(
        "Auto-merge failed: GitHub token cannot merge pull requests.",
      );
      expect(github.promoted).toEqual([]);
      expect(publisher.drafts).toEqual([false]);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("reuses an existing open pull request for the issue branch on reruns", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-64",
        worktreePath: "/repo/.openclawcode/worktrees/run-64",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const publisher = new FakePublisher({
        number: 106,
        url: "https://github.com/zhyongrui/openclawcode/pull/106",
      });
      const existingPullRequest = {
        number: 206,
        url: "https://github.com/zhyongrui/openclawcode/pull/206",
      };
      const shellRunner = new NoopShellRunner();
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 64,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
        },
        {
          github: new ReusedPullRequestGitHubClient(existingPullRequest),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "request-changes",
            summary: "Needs one more fix.",
            findings: ["Carry the existing PR forward"],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner,
          publisher,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("changes-requested");
      expect(run.draftPullRequest?.number).toBe(206);
      expect(run.draftPullRequest?.url).toBe(existingPullRequest.url);
      expect(run.history).toContain(`Reusing existing pull request: ${existingPullRequest.url}`);
      expect(publisher.published).toBe(0);
      expect(shellRunner.commands).toContain(
        "/repo/.openclawcode/worktrees/run-64:git push -u origin openclawcode/issue-64",
      );

      const savedRun = JSON.parse(
        await fs.readFile(path.join(stateDir, "runs", `${run.id}.json`), "utf8"),
      ) as typeof run;
      expect(savedRun.draftPullRequest?.number).toBe(206);
      expect(savedRun.history).toContain(
        `Reusing existing pull request: ${existingPullRequest.url}`,
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("persists a failed run with an explicit build failure note when the builder aborts", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-66",
        worktreePath: "/repo/.openclawcode/worktrees/run-66",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };

      await expect(
        runIssueWorkflow(
          {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 66,
            repoRoot: "/repo",
            stateDir,
            baseBranch: "main",
          },
          {
            github: new FakeGitHubClient(),
            planner: new HeuristicPlanner(),
            builder: new FailingBuilder(
              new Error(
                "Builder workspace integrity check failed: existing tracked file(s) became empty in the isolated worktree. Files: src/commands/openclawcode.ts",
              ),
            ),
            verifier: new FakeVerifier({
              decision: "approve-for-human-review",
              summary: "Looks good.",
              findings: [],
              missingCoverage: [],
              followUps: [],
            }),
            store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
            worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
            shellRunner: new NoopShellRunner(),
            now: createSequenceNow(),
          },
        ),
      ).rejects.toThrow(/Builder workspace integrity check failed/i);

      const store = new FileSystemWorkflowRunStore(path.join(stateDir, "runs"));
      const [savedRun] = await store.list();

      expect(savedRun?.stage).toBe("failed");
      expect(savedRun?.failureDiagnostics).toEqual({
        summary:
          "Builder workspace integrity check failed: existing tracked file(s) became empty in the isolated worktree. Files: src/commands/openclawcode.ts",
      });
      expect(savedRun?.history).toContain("Build started");
      expect(savedRun?.history.at(-1)).toContain(
        "Build failed: Builder workspace integrity check failed: existing tracked file(s) became empty in the isolated worktree.",
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("persists provider diagnostics in the build failure note when the builder surfaces them", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-87",
        worktreePath: "/repo/.openclawcode/worktrees/run-87",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };

      await expect(
        runIssueWorkflow(
          {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 87,
            repoRoot: "/repo",
            stateDir,
            baseBranch: "main",
          },
          {
            github: new FakeGitHubClient(),
            planner: new HeuristicPlanner(),
            builder: new FailingBuilder(
              new AgentRunFailureError("HTTP 400: Internal server error", {
                provider: "crs",
                model: "gpt-5.4",
                systemPromptChars: 8629,
                skillsPromptChars: 1245,
                toolSchemaChars: 3030,
                toolCount: 4,
                skillCount: 1,
                injectedWorkspaceFileCount: 0,
                lastCallUsageTotal: 0,
                bootstrapWarningShown: false,
              }),
            ),
            verifier: new FakeVerifier({
              decision: "approve-for-human-review",
              summary: "Looks good.",
              findings: [],
              missingCoverage: [],
              followUps: [],
            }),
            store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
            worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
            shellRunner: new NoopShellRunner(),
            now: createSequenceNow(),
          },
        ),
      ).rejects.toThrow("HTTP 400: Internal server error");

      const store = new FileSystemWorkflowRunStore(path.join(stateDir, "runs"));
      const [savedRun] = await store.list();

      expect(savedRun?.stage).toBe("failed");
      expect(savedRun?.failureDiagnostics).toEqual({
        summary: "HTTP 400: Internal server error",
        provider: "crs",
        model: "gpt-5.4",
        systemPromptChars: 8629,
        skillsPromptChars: 1245,
        toolSchemaChars: 3030,
        toolCount: 4,
        skillCount: 1,
        injectedWorkspaceFileCount: 0,
        lastCallUsageTotal: 0,
        bootstrapWarningShown: false,
      });
      expect(savedRun?.history.at(-1)).toBe(
        "Build failed: HTTP 400: Internal server error (model=crs/gpt-5.4, prompt=8629, skillsPrompt=1245, schema=3030, tools=4, skills=1, files=0, usage=0, bootstrap=clean)",
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("persists rerun context and latest review metadata in workflow artifacts", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-65",
        worktreePath: "/repo/.openclawcode/worktrees/run-65",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const reviewUrl = "https://github.com/zhyongrui/openclawcode/pull/265#pullrequestreview-200";
      const rerunReason = "Address GitHub review feedback";
      const reviewSummary = [
        "Please add a regression test for the rerun path.",
        "Keep the existing PR open.",
      ].join("\n");

      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 65,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          rerunContext: {
            reason: rerunReason,
            requestedAt: "2026-03-11T03:00:00.000Z",
            priorRunId: "run-64",
            priorStage: "changes-requested",
            reviewDecision: "changes-requested",
            reviewSubmittedAt: "2026-03-11T02:55:00.000Z",
            reviewSummary,
            reviewUrl,
          },
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "request-changes",
            summary: "Needs one more fix.",
            findings: ["Carry the review context into the new run artifact"],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.rerunContext).toMatchObject({
        reason: rerunReason,
        requestedAt: "2026-03-11T03:00:00.000Z",
        priorRunId: "run-64",
        priorStage: "changes-requested",
        reviewDecision: "changes-requested",
        reviewSubmittedAt: "2026-03-11T02:55:00.000Z",
        reviewSummary,
        reviewUrl,
      });
      expect(run.handoffs?.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "rerun-request",
            recordedAt: "2026-03-11T03:00:00.000Z",
            summary: rerunReason,
            priorRunId: "run-64",
            priorStage: "changes-requested",
          }),
        ]),
      );
      expect(run.history).toContain(`Rerun requested: ${rerunReason}`);
      expect(run.history).toContain(
        "Rerun context: prior run run-64 from stage changes-requested.",
      );
      expect(run.history).toContain(
        "Latest review context: changes-requested at 2026-03-11T02:55:00.000Z.",
      );
      expect(run.history).toContain(
        "Latest review summary: Please add a regression test for the rerun path.",
      );
      expect(run.history).toContain(`Latest review URL: ${reviewUrl}`);

      const savedRun = JSON.parse(
        await fs.readFile(path.join(stateDir, "runs", `${run.id}.json`), "utf8"),
      ) as typeof run;
      expect(savedRun.rerunContext).toMatchObject({
        reason: rerunReason,
        priorRunId: "run-64",
        priorStage: "changes-requested",
        reviewDecision: "changes-requested",
        reviewSubmittedAt: "2026-03-11T02:55:00.000Z",
        reviewSummary,
        reviewUrl,
      });
      expect(savedRun.handoffs?.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "rerun-request",
            summary: rerunReason,
          }),
        ]),
      );
      expect(savedRun.history).toContain(`Rerun requested: ${rerunReason}`);
      expect(savedRun.history).toContain(
        "Latest review summary: Please add a regression test for the rerun path.",
      );
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("still opens draft pull requests when merge-on-approve is disabled", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-61",
        worktreePath: "/repo/.openclawcode/worktrees/run-61",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const publisher = new FakePublisher({
        number: 103,
        url: "https://github.com/zhyongrui/openclawcode/pull/103",
      });
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 61,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          publisher,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("ready-for-human-review");
      expect(run.history).toContain(
        "Draft PR opened: https://github.com/zhyongrui/openclawcode/pull/103",
      );
      expect(publisher.drafts).toEqual([true]);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("does not depend on draft promotion when merge-on-approve publishes a ready pull request", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-62",
        worktreePath: "/repo/.openclawcode/worktrees/run-62",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const merger = new FakeMerger();
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 62,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
          mergeOnApprove: true,
        },
        {
          github: new NotFoundReadyForReviewGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          publisher: new FakePublisher({
            number: 104,
            url: "https://github.com/zhyongrui/openclawcode/pull/104",
          }),
          merger,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("merged");
      expect(merger.merged).toBe(1);
      expect(run.history).toContain(
        "Pull request opened: https://github.com/zhyongrui/openclawcode/pull/104",
      );
      expect(run.history).toContain("Pull request merged automatically");

      const savedRun = JSON.parse(
        await fs.readFile(path.join(stateDir, "runs", `${run.id}.json`), "utf8"),
      ) as typeof run;
      expect(savedRun.stage).toBe("merged");
      expect(savedRun.history).toContain("Pull request merged automatically");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("skips draft pr publication when the run produces no changed files", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-59",
        worktreePath: "/repo/.openclawcode/worktrees/run-59",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const publisher = new FakePublisher({
        number: 102,
        url: "https://github.com/zhyongrui/openclawcode/pull/102",
      });
      const github = new FakeGitHubClient();
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 59,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
        },
        {
          github,
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder("command-layer", []),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Already implemented.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, []),
          shellRunner: new NoopShellRunner(),
          publisher,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("completed-without-changes");
      expect(run.history).toContain(
        "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-59.",
      );
      expect(run.history).toContain(
        "Workflow completed without code changes; no pull request was needed.",
      );
      expect(run.history).toContain(
        "Issue #59 closed automatically after verification determined no code changes were needed.",
      );
      expect(run.draftPullRequest?.number).toBeUndefined();
      expect(run.draftPullRequest?.url).toBeUndefined();
      expect(publisher.published).toBe(0);
      expect(github.closedIssues).toEqual([59]);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps the run usable when GitHub rejects PR creation because no commits exist", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-60",
        worktreePath: "/repo/.openclawcode/worktrees/run-60",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const github = new FakeGitHubClient();
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 60,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
        },
        {
          github,
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          publisher: new NoCommitPublisher(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("completed-without-changes");
      expect(run.history).toContain(
        "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-60.",
      );
      expect(run.history).toContain(
        "Workflow completed without code changes; no pull request was needed.",
      );
      expect(run.history).toContain(
        "Issue #60 closed automatically after verification determined no code changes were needed.",
      );
      expect(run.draftPullRequest?.number).toBeUndefined();
      expect(run.draftPullRequest?.url).toBeUndefined();
      expect(github.closedIssues).toEqual([60]);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("closes an existing pull request and completes without changes when the latest run is a no-op", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-60",
        worktreePath: "/repo/.openclawcode/worktrees/run-60",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const github = new ReusedPullRequestGitHubClient({
        number: 103,
        url: "https://github.com/zhyongrui/openclawcode/pull/103",
      });
      const publisher = new FakePublisher({
        number: 104,
        url: "https://github.com/zhyongrui/openclawcode/pull/104",
      });
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 60,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
          openPullRequest: true,
        },
        {
          github,
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder("command-layer", []),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "No changes were needed.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, []),
          shellRunner: new NoopShellRunner(),
          publisher,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("completed-without-changes");
      expect(run.history).toContain(
        "Closed stale pull request because the latest run produced no code changes: https://github.com/zhyongrui/openclawcode/pull/103",
      );
      expect(run.history).toContain(
        "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-60.",
      );
      expect(run.history).toContain(
        "Workflow completed without code changes; no pull request was needed.",
      );
      expect(run.draftPullRequest?.number).toBeUndefined();
      expect(run.draftPullRequest?.url).toBeUndefined();
      expect(publisher.published).toBe(0);
      expect(github.closedIssues).toEqual([103, 60]);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("captures blueprint, role-routing, and stage-gate snapshots in workflow artifacts", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-blueprint-run-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));
    const previousFallbacks = process.env.OPENCLAWCODE_MODEL_FALLBACKS;

    process.env.OPENCLAWCODE_MODEL_FALLBACKS = "openai/gpt-5.4";

    try {
      await fs.writeFile(
        path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Runtime Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:00:00.000Z",
          "statusChangedAt: 2026-03-16T00:00:00.000Z",
          "agreedAt: 2026-03-16T00:00:00.000Z",
          "---",
          "",
          "# Runtime Blueprint",
          "",
          "## Goal",
          "Carry blueprint-first state into workflow runs.",
          "",
          "## Success Criteria",
          "- Workflow artifacts include blueprint-first context.",
          "",
          "## Scope",
          "- In scope: run artifact snapshots.",
          "- Out of scope: chat surfaces.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Technical: stay repo-local.",
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
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Persist blueprint-backed workflow snapshots.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-16: runtime snapshot baseline.",
          "",
        ].join("\n"),
        "utf8",
      );

      const workspace: WorkflowWorkspace = {
        repoRoot,
        baseBranch: "main",
        branchName: "openclawcode/issue-61",
        worktreePath: path.join(repoRoot, ".openclawcode", "worktrees", "run-61"),
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 61,
          repoRoot,
          stateDir,
          baseBranch: "main",
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "approve-for-human-review",
            summary: "Looks good.",
            findings: [],
            missingCoverage: [],
            followUps: [],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.blueprintContext).toMatchObject({
        path: path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
        status: "agreed",
        agreed: true,
        openQuestionCount: 0,
      });
      expect(run.roleRouting).toMatchObject({
        artifactExists: false,
        mixedMode: true,
        fallbackConfigured: true,
        unresolvedRoleCount: 0,
      });
      expect(run.roleRouting?.routes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            roleId: "planner",
            adapterId: "claude-code",
            stages: ["planning"],
          }),
          expect.objectContaining({
            roleId: "coder",
            adapterId: "codex",
            stages: ["building"],
          }),
        ]),
      );
      expect(run.roleRouting?.stageRoutes).toEqual(
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
        ]),
      );
      expect(run.stageGates).toMatchObject({
        artifactExists: false,
        gateCount: 5,
        blockedGateCount: 1,
      });
      expect(run.stageGates?.gates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ gateId: "goal-agreement", readiness: "ready" }),
          expect.objectContaining({ gateId: "work-item-projection", readiness: "blocked" }),
          expect.objectContaining({ gateId: "execution-routing", readiness: "ready" }),
        ]),
      );

      const store = new FileSystemWorkflowRunStore(path.join(stateDir, "runs"));
      const savedRun = await store.get(run.id);
      expect(savedRun?.blueprintContext?.revisionId).toBe(run.blueprintContext?.revisionId);
      expect(savedRun?.roleRouting?.mixedMode).toBe(true);
      expect(savedRun?.roleRouting?.stageRoutes).toEqual(run.roleRouting?.stageRoutes);
      expect(savedRun?.stageGates?.blockedGateCount).toBe(1);
    } finally {
      if (previousFallbacks == null) {
        delete process.env.OPENCLAWCODE_MODEL_FALLBACKS;
      } else {
        process.env.OPENCLAWCODE_MODEL_FALLBACKS = previousFallbacks;
      }
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("captures runtime routing selections before build and verification", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-162",
        worktreePath: "/repo/.openclawcode/worktrees/run-162",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 162,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new RuntimeAwareFakeBuilder({
            roleId: "coder",
            adapterId: "codex",
            assignmentSource: "blueprint",
            configured: true,
            appliedAgentId: "codex-coder",
            agentSource: "adapter-env",
          }),
          verifier: new RuntimeAwareFakeVerifier(
            {
              decision: "approve-for-human-review",
              summary: "Looks good.",
              findings: [],
              missingCoverage: [],
              followUps: [],
            },
            {
              roleId: "verifier",
              adapterId: "claude-code",
              assignmentSource: "blueprint",
              configured: true,
              appliedAgentId: "claude-reviewer",
              agentSource: "role-env",
            },
          ),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.runtimeRouting?.selections).toEqual([
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
          adapterId: "claude-code",
          assignmentSource: "blueprint",
          configured: true,
          appliedAgentId: "claude-reviewer",
          agentSource: "role-env",
        },
      ]);
      expect(run.history).toEqual(
        expect.arrayContaining([
          "Runtime routing for coder: requested codex resolved via adapter-env using codex-coder.",
          "Runtime routing for verifier: requested claude-code resolved via role-env using claude-reviewer.",
        ]),
      );

      const store = new FileSystemWorkflowRunStore(path.join(stateDir, "runs"));
      const savedRun = await store.get(run.id);
      expect(savedRun?.runtimeRouting?.selections).toEqual(run.runtimeRouting?.selections);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("applies repo-local per-stage runtime steering before build and verification", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-repo-"));

    try {
      await fs.mkdir(path.join(repoRoot, ".openclawcode"), { recursive: true });
      await fs.writeFile(
        path.join(repoRoot, ".openclawcode", "runtime-steering.json"),
        JSON.stringify(
          {
            repoRoot,
            artifactPath: path.join(repoRoot, ".openclawcode", "runtime-steering.json"),
            exists: true,
            schemaVersion: 1,
            generatedAt: "2026-03-21T16:36:00.000Z",
            overrideCount: 2,
            overrides: [
              {
                stageId: "building",
                roleId: "coder",
                adapterId: "claude-code",
                agentId: "builder-steered",
                actor: "tester",
                note: "force alternate build runtime",
                updatedAt: "2026-03-21T16:36:00.000Z",
              },
              {
                stageId: "verifying",
                roleId: "verifier",
                adapterId: "codex",
                agentId: "verifier-steered",
                actor: "tester",
                note: "force alternate verify runtime",
                updatedAt: "2026-03-21T16:37:00.000Z",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const workspace: WorkflowWorkspace = {
        repoRoot,
        baseBranch: "main",
        branchName: "openclawcode/issue-163",
        worktreePath: path.join(repoRoot, ".openclawcode", "worktrees", "run-163"),
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 163,
          repoRoot,
          stateDir,
          baseBranch: "main",
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new RuntimeAwareFakeBuilder({
            roleId: "coder",
            adapterId: "codex",
            assignmentSource: "blueprint",
            configured: true,
            appliedAgentId: "codex-coder",
            agentSource: "adapter-env",
          }),
          verifier: new RuntimeAwareFakeVerifier(
            {
              decision: "approve-for-human-review",
              summary: "Looks good.",
              findings: [],
              missingCoverage: [],
              followUps: [],
            },
            {
              roleId: "verifier",
              adapterId: "claude-code",
              assignmentSource: "blueprint",
              configured: true,
              appliedAgentId: "claude-reviewer",
              agentSource: "role-env",
            },
          ),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.runtimeRouting?.selections).toEqual([
        {
          roleId: "coder",
          adapterId: "claude-code",
          assignmentSource: "blueprint",
          configured: true,
          appliedAgentId: "builder-steered",
          agentSource: "stage-steering",
        },
        {
          roleId: "verifier",
          adapterId: "codex",
          assignmentSource: "blueprint",
          configured: true,
          appliedAgentId: "verifier-steered",
          agentSource: "stage-steering",
        },
      ]);
      expect(run.history).toEqual(
        expect.arrayContaining([
          "Runtime routing for coder: requested claude-code resolved via stage-steering using builder-steered.",
          "Runtime routing for verifier: requested codex resolved via stage-steering using verifier-steered.",
        ]),
      );
      expect(run.handoffs?.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "runtime-steering",
            actor: "tester",
            summary:
              "stage=building | role=coder | adapter=claude-code | agent=builder-steered",
            requestedCoderAgentId: "builder-steered",
          }),
          expect.objectContaining({
            kind: "runtime-steering",
            actor: "tester",
            summary:
              "stage=verifying | role=verifier | adapter=codex | agent=verifier-steered",
            requestedVerifierAgentId: "verifier-steered",
          }),
        ]),
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("stops at changes-requested when verification fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-state-"));

    try {
      const workspace: WorkflowWorkspace = {
        repoRoot: "/repo",
        baseBranch: "main",
        branchName: "openclawcode/issue-56",
        worktreePath: "/repo/.openclawcode/worktrees/run-56",
        preparedAt: "2026-03-09T13:00:00.000Z",
      };
      const run = await runIssueWorkflow(
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 56,
          repoRoot: "/repo",
          stateDir,
          baseBranch: "main",
        },
        {
          github: new FakeGitHubClient(),
          planner: new HeuristicPlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier({
            decision: "request-changes",
            summary: "Needs more tests.",
            findings: ["Missing regression coverage"],
            missingCoverage: ["Add regression test"],
            followUps: ["Implement missing test"],
          }),
          store: new FileSystemWorkflowRunStore(path.join(stateDir, "runs")),
          worktreeManager: new FakeWorkspaceManager(workspace, ["src/commands/openclawcode.ts"]),
          shellRunner: new NoopShellRunner(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("changes-requested");
      expect(run.verificationReport?.findings).toContain("Missing regression coverage");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
