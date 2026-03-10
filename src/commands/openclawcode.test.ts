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

  it("prints workflow scope signals as stable top-level JSON fields", async () => {
    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.changedFiles).toEqual([
      "src/openclawcode/app/run-issue.ts",
      "src/openclawcode/contracts/types.ts",
    ]);
    expect(payload.buildResult.changedFiles).toEqual(payload.changedFiles);
    expect(payload.issueClassification).toBe("command-layer");
    expect(payload.scopeCheck).toEqual({
      ok: true,
      blockedFiles: [],
      summary: "Scope check passed for command-layer issue.",
    });
    expect(payload.buildResult.issueClassification).toBe(payload.issueClassification);
    expect(payload.buildResult.scopeCheck).toEqual(payload.scopeCheck);
    expect(payload.verificationDecision).toBe("approve-for-human-review");
    expect(payload.verificationSummary).toBe(
      "Verification completed and the run is ready for human review.",
    );
    expect(payload.verificationReport.decision).toBe(payload.verificationDecision);
    expect(payload.verificationReport.summary).toBe(payload.verificationSummary);
  });

  it("prints empty top-level scope fields when the build result is missing", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(
      createRun({ buildResult: undefined, verificationReport: undefined }),
    );

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.changedFiles).toEqual([]);
    expect(payload.issueClassification).toBeNull();
    expect(payload.scopeCheck).toBeNull();
    expect(payload.verificationDecision).toBeNull();
    expect(payload.verificationSummary).toBeNull();
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
    history: [],
    ...overrides,
  };
}
