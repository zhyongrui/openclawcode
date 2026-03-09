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

  it("prints changedFiles as a stable top-level JSON field", async () => {
    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.changedFiles).toEqual([
      "src/openclawcode/app/run-issue.ts",
      "src/openclawcode/contracts/types.ts",
    ]);
    expect(payload.buildResult.changedFiles).toEqual(payload.changedFiles);
  });

  it("prints an empty changedFiles array when the build result is missing", async () => {
    mocks.runIssueWorkflow.mockResolvedValue(createRun({ buildResult: undefined }));

    await openclawCodeRunCommand({ issue: "2", repoRoot: "/repo", json: true }, runtime);

    const payload = JSON.parse(runtime.log.mock.calls[0]?.[0] ?? "null");
    expect(payload.changedFiles).toEqual([]);
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
      testCommands: ["vitest run"],
      testResults: ["passed"],
      notes: [],
    },
    history: [],
    ...overrides,
  };
}
