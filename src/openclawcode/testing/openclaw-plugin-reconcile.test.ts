import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OpenClawCodeChatopsStore,
  collectLatestLocalRunStatuses,
} from "../../integrations/openclaw-plugin/index.js";
import type { WorkflowRun } from "../contracts/index.js";

async function createTempRepoRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-reconcile-repo-"));
}

function createRun(params: {
  id: string;
  issueNumber: number;
  updatedAt: string;
  stage: WorkflowRun["stage"];
  summary: string;
  prUrl?: string;
}): WorkflowRun {
  return {
    id: params.id,
    stage: params.stage,
    issue: {
      owner: "zhyongrui",
      repo: "openclawcode",
      number: params.issueNumber,
      title: `Issue ${params.issueNumber}`,
      labels: [],
    },
    createdAt: params.updatedAt,
    updatedAt: params.updatedAt,
    attempts: {
      total: 1,
      planning: 1,
      building: 1,
      verifying: 1,
    },
    stageRecords: [],
    history: [],
    buildResult: {
      branchName: `openclawcode/issue-${params.issueNumber}`,
      summary: params.summary,
      changedFiles: ["src/example.ts"],
      issueClassification: "command-layer",
      testCommands: [],
      testResults: [],
      notes: [],
    },
    draftPullRequest: params.prUrl
      ? {
          title: `feat: implement issue #${params.issueNumber}`,
          body: "body",
          branchName: `openclawcode/issue-${params.issueNumber}`,
          baseBranch: "main",
          number: 1,
          url: params.prUrl,
          openedAt: params.updatedAt,
        }
      : undefined,
    verificationReport: {
      decision: "approve-for-human-review",
      summary: params.summary,
      findings: [],
      missingCoverage: [],
      followUps: [],
    },
  };
}

async function writeRun(repoRoot: string, run: WorkflowRun): Promise<void> {
  const runsDir = path.join(repoRoot, ".openclawcode", "runs");
  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${run.id}.json`),
    `${JSON.stringify(run, null, 2)}\n`,
    "utf8",
  );
}

describe("openclaw plugin local-run reconciliation", () => {
  it("collects the newest local run status per issue", async () => {
    const repoRoot = await createTempRepoRoot();

    try {
      await writeRun(
        repoRoot,
        createRun({
          id: "run-1",
          issueNumber: 301,
          updatedAt: "2026-03-10T07:00:00.000Z",
          stage: "ready-for-human-review",
          summary: "Older status",
        }),
      );
      await writeRun(
        repoRoot,
        createRun({
          id: "run-2",
          issueNumber: 301,
          updatedAt: "2026-03-10T07:05:00.000Z",
          stage: "merged",
          summary: "Newest status",
          prUrl: "https://github.com/zhyongrui/openclawcode/pull/55",
        }),
      );

      const statuses = await collectLatestLocalRunStatuses({
        owner: "zhyongrui",
        repo: "openclawcode",
        repoRoot,
        baseBranch: "main",
        triggerMode: "approve",
        notifyChannel: "telegram",
        notifyTarget: "chat:1",
        builderAgent: "main",
        verifierAgent: "main",
        testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
      });

      expect(statuses).toHaveLength(1);
      expect(statuses[0]?.issueKey).toBe("zhyongrui/openclawcode#301");
      expect(statuses[0]?.status).toContain("Stage: Merged");
      expect(statuses[0]?.status).toContain(
        "PR: https://github.com/zhyongrui/openclawcode/pull/55",
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not let reconciled run status override active queue state", async () => {
    const repoRoot = await createTempRepoRoot();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-reconcile-state-"));

    try {
      await writeRun(
        repoRoot,
        createRun({
          id: "run-3",
          issueNumber: 302,
          updatedAt: "2026-03-10T07:10:00.000Z",
          stage: "merged",
          summary: "Merged remotely",
        }),
      );

      const store = OpenClawCodeChatopsStore.fromStateDir(stateDir);
      await store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#302",
        notifyChannel: "telegram",
        notifyTarget: "chat:1",
      });
      await store.reconcileWorkflowRunStatuses([
        {
          issueKey: "zhyongrui/openclawcode#302",
          status: "openclawcode status for zhyongrui/openclawcode#302\nStage: Merged",
          run: createRun({
            id: "run-3",
            issueNumber: 302,
            updatedAt: "2026-03-10T07:10:00.000Z",
            stage: "merged",
            summary: "Merged remotely",
          }),
        },
      ]);

      expect(await store.getStatus("zhyongrui/openclawcode#302")).toBe("Awaiting chat approval.");
      expect(await store.getStatusSnapshot("zhyongrui/openclawcode#302")).toBeUndefined();
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
