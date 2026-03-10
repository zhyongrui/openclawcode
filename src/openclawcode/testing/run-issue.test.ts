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
  BuildResult,
  IssueRef,
  VerificationReport,
  WorkflowRun,
  WorkflowWorkspace,
} from "../contracts/index.js";
import type { GitHubIssueClient, PullRequestRef, RepoRef } from "../github/index.js";
import { FileSystemWorkflowRunStore } from "../persistence/index.js";
import type { Builder, Verifier } from "../roles/index.js";
import { HeuristicPlanner } from "../roles/index.js";
import type { ShellRunner } from "../runtime/index.js";
import type { WorkflowWorkspaceManager } from "../worktree/index.js";

function createSequenceNow(startAt = Date.UTC(2026, 2, 9, 13, 0, 0)): () => string {
  let tick = 0;
  return () => new Date(startAt + tick++ * 1_000).toISOString();
}

class FakeGitHubClient implements GitHubIssueClient {
  published: PullRequestRef[] = [];
  merged: number[] = [];

  async fetchIssue(ref: RepoRef & { issueNumber: number }): Promise<IssueRef> {
    return {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.issueNumber,
      title: "Implement workflow CLI",
      body: "Add an executable code workflow entrypoint.",
      labels: ["automation"],
    };
  }

  async createDraftPullRequest(): Promise<PullRequestRef> {
    const value = { number: 99, url: "https://github.com/example/repo/pull/99" };
    this.published.push(value);
    return value;
  }

  async mergePullRequest(request: { pullNumber: number }): Promise<void> {
    this.merged.push(request.pullNumber);
  }
}

class FakeWorkspaceManager implements WorkflowWorkspaceManager {
  constructor(
    private readonly workspace: WorkflowWorkspace,
    private readonly changedFiles: string[],
  ) {}

  async prepare(): Promise<WorkflowWorkspace> {
    return this.workspace;
  }

  async collectChangedFiles(): Promise<string[]> {
    return this.changedFiles;
  }

  async cleanup(): Promise<void> {}
}

class FakeBuilder implements Builder {
  constructor(
    private readonly scope: "command-layer" | "workflow-core" | "mixed" = "command-layer",
    private readonly changedFiles: string[] = ["src/commands/openclawcode.ts"],
  ) {}

  async build(run: WorkflowRun): Promise<BuildResult> {
    return {
      branchName: run.workspace?.branchName ?? "openclawcode/issue-1",
      summary: "Builder updated the CLI implementation.",
      changedFiles: this.changedFiles,
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

  constructor(private readonly value: PullRequestRef) {}

  async publish(): Promise<PullRequestRef> {
    this.published += 1;
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

class NoCommitPublisher implements PullRequestPublisher {
  async publish(): Promise<PullRequestRef> {
    throw new Error(
      'GitHub API request failed: 422 Unprocessable Entity {"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"No commits between main and openclawcode/issue-17-automerge-disposition"}]}',
    );
  }
}

describe("runIssueWorkflow", () => {
  it("publishes and merges when verification approves and merge is enabled", async () => {
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
          publisher: new FakePublisher({
            number: 99,
            url: "https://github.com/zhyongrui/openclawcode/pull/99",
          }),
          merger,
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("merged");
      expect(run.draftPullRequest?.number).toBe(99);
      expect(run.draftPullRequest?.url).toBe("https://github.com/zhyongrui/openclawcode/pull/99");
      expect(merger.merged).toBe(1);

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
        "Auto-merge skipped: policy requires human review for non-command-layer or failed-scope runs",
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
          publisher: new FakePublisher({
            number: 101,
            url: "https://github.com/zhyongrui/openclawcode/pull/101",
          }),
          merger: new FailingMerger(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("ready-for-human-review");
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
          github: new FakeGitHubClient(),
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

      expect(run.stage).toBe("ready-for-human-review");
      expect(run.history).toContain(
        "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-59.",
      );
      expect(run.draftPullRequest?.number).toBeUndefined();
      expect(run.draftPullRequest?.url).toBeUndefined();
      expect(publisher.published).toBe(0);
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
          publisher: new NoCommitPublisher(),
          now: createSequenceNow(),
        },
      );

      expect(run.stage).toBe("ready-for-human-review");
      expect(run.history).toContain(
        "Draft PR skipped: no new commits were produced between the base branch and openclawcode/issue-60.",
      );
      expect(run.draftPullRequest?.number).toBeUndefined();
      expect(run.draftPullRequest?.url).toBeUndefined();
    } finally {
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
