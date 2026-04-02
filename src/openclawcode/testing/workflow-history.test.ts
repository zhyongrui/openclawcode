import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpenClawCodeChatopsStore } from "../../integrations/openclaw-plugin/store.js";
import type { WorkflowRun } from "../contracts/index.js";
import { readOpenClawCodeOperatorStatusSnapshot } from "../operator-status.js";
import { readProjectWorkflowHistoryArtifact, writeProjectWorkflowHistoryArtifact } from "../workflow-history.js";

function createRun(params: {
  id: string;
  issueNumber: number;
  title: string;
  updatedAt: string;
  repo?: string;
  owner?: string;
  history?: string[];
}): WorkflowRun {
  return {
    id: params.id,
    stage: "ready-for-human-review",
    issue: {
      owner: params.owner ?? "openclaw",
      repo: params.repo ?? "openclawcode",
      number: params.issueNumber,
      title: params.title,
      body: `${params.title} body`,
    },
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: params.updatedAt,
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
      branchName: `openclawcode/issue-${params.issueNumber}`,
      worktreePath: `/repo/.openclawcode/worktrees/issue-${params.issueNumber}`,
      preparedAt: "2026-04-02T00:00:00.000Z",
    },
    draftPullRequest: {
      title: `[Issue #${params.issueNumber}] ${params.title}`,
      body: "Draft body",
      branchName: `openclawcode/issue-${params.issueNumber}`,
      baseBranch: "main",
      number: params.issueNumber + 100,
      url: `https://github.com/openclaw/${params.repo ?? "openclawcode"}/pull/${params.issueNumber + 100}`,
      openedAt: "2026-04-02T00:00:00.000Z",
    },
    history: params.history ?? ["Planning completed", "Verification approved for human review"],
  };
}

describe("project workflow history artifact", () => {
  it("keeps repo-local entries and sorts the current issue first", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-workflow-history-"));
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "openclawcode-workflow-history-state-"));
    const runsDir = path.join(repoRoot, ".openclawcode", "runs");
    await mkdir(runsDir, { recursive: true });

    await writeFile(
      path.join(runsDir, "run-105.json"),
      `${JSON.stringify(
        createRun({
          id: "run-105",
          issueNumber: 105,
          title: "Current issue",
          updatedAt: "2026-04-02T10:00:00.000Z",
          history: ["Planning completed", "Verification approved for human review"],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(runsDir, "run-106.json"),
      `${JSON.stringify(
        createRun({
          id: "run-106",
          issueNumber: 106,
          title: "Earlier issue",
          updatedAt: "2026-04-02T09:00:00.000Z",
          history: ["Planning completed", "Requested rerun", "Verification approved for human review"],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(runsDir, "run-200.json"),
      `${JSON.stringify(
        createRun({
          id: "run-200",
          issueNumber: 200,
          title: "Other repo issue",
          updatedAt: "2026-04-02T11:00:00.000Z",
          repo: "other-repo",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const store = OpenClawCodeChatopsStore.fromStateDir(stateDir);
    await store.enqueue(
      {
        issueKey: "openclaw/openclawcode#105",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        request: {
          owner: "openclaw",
          repo: "openclawcode",
          issueNumber: 105,
          repoRoot,
          baseBranch: "main",
          branchName: "openclawcode/issue-105",
          builderAgent: "codex-main",
          verifierAgent: "claude-main",
          testCommands: ["pnpm test"],
          openPullRequest: true,
          mergeOnApprove: false,
        },
      },
      "Queued current issue.",
    );
    await store.startNext("Running current issue.");
    await store.setStatusSnapshot({
      issueKey: "openclaw/openclawcode#105",
      status: "openclawcode status for openclaw/openclawcode#105\nStage: Ready For Human Review",
      stage: "ready-for-human-review",
      runId: "run-105",
      updatedAt: "2026-04-02T10:05:00.000Z",
      owner: "openclaw",
      repo: "openclawcode",
      issueNumber: 105,
      branchName: "openclawcode/issue-105",
      pullRequestNumber: 205,
      pullRequestUrl: "https://github.com/openclaw/openclawcode/pull/205",
      qualityGateStatus: "warn",
      qualityGateSummary: "1 missing coverage item",
      loopHealthStatus: "warn",
      loopHealthSummary: "high prompt footprint",
    });
    await store.setStatusSnapshot({
      issueKey: "openclaw/openclawcode#106",
      status: "openclawcode status for openclaw/openclawcode#106\nStage: Changes Requested",
      stage: "changes-requested",
      runId: "run-106",
      updatedAt: "2026-04-02T09:30:00.000Z",
      owner: "openclaw",
      repo: "openclawcode",
      issueNumber: 106,
      branchName: "openclawcode/issue-106",
      rerunReason: "Address review feedback",
    });

    const operatorSnapshot = await readOpenClawCodeOperatorStatusSnapshot(stateDir);
    const artifact = await writeProjectWorkflowHistoryArtifact({
      repoRoot,
      repo: {
        owner: "openclaw",
        repo: "openclawcode",
      },
      operatorSnapshot,
      limit: 5,
    });

    expect(artifact).toMatchObject({
      repoKey: "openclaw/openclawcode",
      projectScoped: true,
      currentIssueKey: "openclaw/openclawcode#105",
      currentSessionEntryCount: 1,
      entryCount: 2,
      sourceCounts: {
        currentRun: 1,
        issueSnapshot: 1,
        workflowRun: 0,
      },
    });
    expect(artifact.entries[0]).toMatchObject({
      issueKey: "openclaw/openclawcode#105",
      source: "current-run",
      currentSessionFirst: true,
      runId: "run-105",
      historyEventCount: 2,
      historyTail: ["Planning completed", "Verification approved for human review"],
    });
    expect(artifact.entries[1]).toMatchObject({
      issueKey: "openclaw/openclawcode#106",
      source: "issue-snapshot",
      currentSessionFirst: false,
      runId: "run-106",
      rerunReason: "Address review feedback",
    });
    expect(
      artifact.entries.some((entry) => entry.issueKey === "openclaw/other-repo#200"),
    ).toBe(false);

    const persisted = await readProjectWorkflowHistoryArtifact(repoRoot);
    expect(persisted.entries).toHaveLength(2);
    expect(persisted.entries[0]?.issueKey).toBe("openclaw/openclawcode#105");
  });
});
