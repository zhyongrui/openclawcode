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
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
}): WorkflowRun {
  const branchName = params.branchName ?? `openclawcode/issue-${params.issueNumber}`;
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
      branchName,
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
          branchName,
          baseBranch: "main",
          number: params.prNumber ?? 1,
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

  it("recovers pull request metadata from an older run when the newest rerun omits it", async () => {
    const repoRoot = await createTempRepoRoot();

    try {
      await writeRun(
        repoRoot,
        createRun({
          id: "run-4",
          issueNumber: 303,
          updatedAt: "2026-03-10T08:00:00.000Z",
          stage: "ready-for-human-review",
          summary: "Existing PR is ready.",
          prNumber: 77,
          prUrl: "https://github.com/zhyongrui/openclawcode/pull/77",
        }),
      );
      await writeRun(
        repoRoot,
        createRun({
          id: "run-5",
          issueNumber: 303,
          updatedAt: "2026-03-10T08:05:00.000Z",
          stage: "changes-requested",
          summary: "Latest rerun kept the branch but missed the PR metadata.",
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
      expect(statuses[0]?.issueKey).toBe("zhyongrui/openclawcode#303");
      expect(statuses[0]?.status).toContain("Stage: Changes Requested");
      expect(statuses[0]?.status).toContain(
        "PR: https://github.com/zhyongrui/openclawcode/pull/77",
      );
      expect(statuses[0]?.run.draftPullRequest?.number).toBe(77);
      expect(statuses[0]?.run.draftPullRequest?.url).toBe(
        "https://github.com/zhyongrui/openclawcode/pull/77",
      );
      expect(statuses[0]?.run.id).toBe("run-5");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not recover pull request metadata from a different branch history", async () => {
    const repoRoot = await createTempRepoRoot();

    try {
      await writeRun(
        repoRoot,
        createRun({
          id: "run-6",
          issueNumber: 304,
          updatedAt: "2026-03-10T09:00:00.000Z",
          stage: "ready-for-human-review",
          summary: "Old branch still had an open PR.",
          branchName: "openclawcode/issue-304-old",
          prNumber: 88,
          prUrl: "https://github.com/zhyongrui/openclawcode/pull/88",
        }),
      );
      await writeRun(
        repoRoot,
        createRun({
          id: "run-7",
          issueNumber: 304,
          updatedAt: "2026-03-10T09:05:00.000Z",
          stage: "draft-pr-opened",
          summary: "New branch should not inherit the old PR.",
          branchName: "openclawcode/issue-304-new",
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
      expect(statuses[0]?.issueKey).toBe("zhyongrui/openclawcode#304");
      expect(statuses[0]?.status).toContain("Stage: Draft PR Opened");
      expect(statuses[0]?.status).not.toContain("PR:");
      expect(statuses[0]?.run.draftPullRequest?.number).toBeUndefined();
      expect(statuses[0]?.run.id).toBe("run-7");
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
