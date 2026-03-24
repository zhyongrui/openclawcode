import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpenClawCodeChatopsStore } from "../../integrations/openclaw-plugin/index.js";
import type { WorkflowRun } from "../contracts/index.js";

async function createStore(): Promise<{
  rootDir: string;
  store: OpenClawCodeChatopsStore;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-chatops-store-"));
  return {
    rootDir,
    store: OpenClawCodeChatopsStore.fromStateDir(rootDir),
  };
}

function createQueuedRun(issueNumber: number) {
  return {
    issueKey: `zhyongrui/openclawcode#${issueNumber}`,
    notifyChannel: "telegram",
    notifyTarget: "chat:123",
    request: {
      owner: "zhyongrui",
      repo: "openclawcode",
      issueNumber,
      repoRoot: "/home/zyr/pros/openclawcode",
      baseBranch: "main",
      branchName: `openclawcode/issue-${issueNumber}`,
      builderAgent: "main",
      verifierAgent: "main",
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"],
      openPullRequest: true,
      mergeOnApprove: true,
    },
  };
}

function createWorkflowRun(params: {
  issueNumber: number;
  stage?: WorkflowRun["stage"];
  updatedAt?: string;
  prNumber?: number;
  prUrl?: string;
  rerunContext?: WorkflowRun["rerunContext"];
  handoffs?: WorkflowRun["handoffs"];
  runtimeRouting?: WorkflowRun["runtimeRouting"];
}): WorkflowRun {
  const updatedAt = params.updatedAt ?? "2026-03-10T08:30:00.000Z";
  return {
    id: `run-${params.issueNumber}`,
    stage: params.stage ?? "ready-for-human-review",
    issue: {
      owner: "zhyongrui",
      repo: "openclawcode",
      number: params.issueNumber,
      title: `Issue ${params.issueNumber}`,
      labels: [],
    },
    createdAt: updatedAt,
    updatedAt,
    attempts: {
      total: 1,
      planning: 1,
      building: 1,
      verifying: 1,
    },
    stageRecords: [],
    history: [],
    workspace: {
      repoRoot: "/home/zyr/pros/openclawcode",
      baseBranch: "main",
      branchName: `openclawcode/issue-${params.issueNumber}`,
      worktreePath: `/tmp/openclawcode-${params.issueNumber}`,
      preparedAt: updatedAt,
    },
    buildResult: {
      branchName: `openclawcode/issue-${params.issueNumber}`,
      summary: `Summary for issue ${params.issueNumber}`,
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
          number: params.prNumber,
          url: params.prUrl,
          openedAt: updatedAt,
        }
      : undefined,
    verificationReport: {
      decision: "approve-for-human-review",
      summary: `Summary for issue ${params.issueNumber}`,
      findings: [],
      missingCoverage: [],
      followUps: [],
    },
    runtimeRouting: params.runtimeRouting,
    rerunContext: params.rerunContext,
    handoffs: params.handoffs,
  };
}

describe("OpenClawCodeChatopsStore", () => {
  it(
    "persists pending approvals and consumes them when approved",
    { timeout: 90_000 },
    async () => {
      const fixture = await createStore();

      try {
        const pending = {
          issueKey: "zhyongrui/openclawcode#100",
          notifyChannel: "telegram",
          notifyTarget: "chat:123",
        };
        expect(await fixture.store.addPendingApproval(pending)).toBe(true);
        expect(await fixture.store.isPendingApproval(pending.issueKey)).toBe(true);

        const secondStore = OpenClawCodeChatopsStore.fromStateDir(fixture.rootDir);
        expect(await secondStore.getPendingApproval(pending.issueKey)).toEqual(pending);
        expect(await secondStore.consumePendingApproval(pending.issueKey)).toEqual(pending);
        expect(await secondStore.isPendingApproval(pending.issueKey)).toBe(false);
      } finally {
        await fs.rm(fixture.rootDir, { recursive: true, force: true });
      }
    },
  );

  it(
    "persists queue entries and statuses across store instances",
    { timeout: 60_000 },
    async () => {
      const fixture = await createStore();

      try {
        const firstRun = createQueuedRun(101);
        expect(await fixture.store.enqueue(firstRun)).toBe(true);
        await fixture.store.setStatus(firstRun.issueKey, "Awaiting chat approval.");

        const secondStore = OpenClawCodeChatopsStore.fromStateDir(fixture.rootDir);
        const snapshot = await secondStore.snapshot();

        expect(snapshot.queue).toHaveLength(1);
        expect(snapshot.queue[0]?.issueKey).toBe(firstRun.issueKey);
        expect(snapshot.statusByIssue[firstRun.issueKey]).toBe("Awaiting chat approval.");
      } finally {
        await fs.rm(fixture.rootDir, { recursive: true, force: true });
      }
    },
  );

  it("starts queued runs and clears current state on finish", async () => {
    const fixture = await createStore();

    try {
      const firstRun = createQueuedRun(102);
      await fixture.store.enqueue(firstRun);

      const started = await fixture.store.startNext();
      expect(started?.issueKey).toBe(firstRun.issueKey);
      expect(await fixture.store.isQueuedOrRunning(firstRun.issueKey)).toBe(true);

      await fixture.store.finishCurrent(firstRun.issueKey, "Merged.");

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.currentRun).toBeUndefined();
      expect(snapshot.statusByIssue[firstRun.issueKey]).toBe("Merged.");
      expect(await fixture.store.isQueuedOrRunning(firstRun.issueKey)).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("persists deferred runtime reroutes across store instances", async () => {
    const fixture = await createStore();

    try {
      await fixture.store.upsertDeferredRuntimeReroute({
        issueKey: "zhyongrui/openclawcode#103",
        notifyChannel: "telegram",
        notifyTarget: "chat:123",
        requestedAt: "2026-03-16T03:00:00.000Z",
        actor: "user:operator",
        note: "Wait for the current run to fail before switching agents.",
        sourceRunId: "run-103",
        sourceStage: "building",
        requestedVerifierAgentId: "claude-alt",
      });

      const secondStore = OpenClawCodeChatopsStore.fromStateDir(fixture.rootDir);
      expect(await secondStore.getDeferredRuntimeReroute("zhyongrui/openclawcode#103")).toEqual({
        issueKey: "zhyongrui/openclawcode#103",
        notifyChannel: "telegram",
        notifyTarget: "chat:123",
        requestedAt: "2026-03-16T03:00:00.000Z",
        actor: "user:operator",
        note: "Wait for the current run to fail before switching agents.",
        sourceRunId: "run-103",
        sourceStage: "building",
        requestedVerifierAgentId: "claude-alt",
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("updates queued runtime reroute overrides in place", async () => {
    const fixture = await createStore();

    try {
      const queuedRun = createQueuedRun(104);
      expect(await fixture.store.enqueue(queuedRun)).toBe(true);

      const updated = await fixture.store.updateQueuedRuntimeReroute({
        issueKey: queuedRun.issueKey,
        requestedCoderAgentId: "codex-alt",
        requestedAt: "2026-03-16T03:05:00.000Z",
        reason: "Runtime reroute requested before execution started.",
      });

      expect(updated?.request.builderAgent).toBe("codex-alt");
      expect(updated?.request.verifierAgent).toBe("main");

      const secondStore = OpenClawCodeChatopsStore.fromStateDir(fixture.rootDir);
      const snapshot = await secondStore.snapshot();
      expect(snapshot.queue[0]?.request.builderAgent).toBe("codex-alt");
      expect(snapshot.statusByIssue[queuedRun.issueKey]).toBe(
        "Queued with runtime reroute overrides.",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("tracks repeated transient provider failures and clears the pause after a later success", async () => {
    const fixture = await createStore();

    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 1201,
          stage: "failed",
          updatedAt: "2026-03-12T12:00:00.000Z",
        }),
        [
          "openclawcode status for zhyongrui/openclawcode#1201",
          "Stage: Failed",
          "Summary: Build failed: HTTP 400: Internal server error",
        ].join("\n"),
      );
      expect((await fixture.store.snapshot()).providerPause).toBeUndefined();

      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 1202,
          stage: "failed",
          updatedAt: "2026-03-12T12:05:00.000Z",
        }),
        [
          "openclawcode status for zhyongrui/openclawcode#1202",
          "Stage: Failed",
          "Summary: Build failed: HTTP 400: Internal server error",
        ].join("\n"),
      );

      const paused = await fixture.store.snapshot();
      expect(paused.recentProviderFailures).toHaveLength(2);
      expect(paused.providerPause).toMatchObject({
        failureCount: 2,
        lastFailureAt: "2026-03-12T12:05:00.000Z",
      });
      expect(paused.statusSnapshotsByIssue["zhyongrui/openclawcode#1202"]).toMatchObject({
        providerFailureCount: 2,
        lastProviderFailureAt: "2026-03-12T12:05:00.000Z",
        providerPauseUntil: "2026-03-12T12:15:00.000Z",
      });
      expect(await fixture.store.getActiveProviderPause("2026-03-12T12:06:00.000Z")).toMatchObject({
        failureCount: 2,
      });

      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 1203,
          stage: "merged",
          updatedAt: "2026-03-12T12:06:30.000Z",
        }),
        [
          "openclawcode status for zhyongrui/openclawcode#1203",
          "Stage: Merged",
          "Summary: Merge completed.",
        ].join("\n"),
      );

      const recovered = await fixture.store.snapshot();
      expect(recovered.recentProviderFailures).toEqual([]);
      expect(recovered.providerPause).toBeUndefined();
      expect(recovered.statusSnapshotsByIssue["zhyongrui/openclawcode#1202"]).toMatchObject({
        providerFailureCount: 2,
        lastProviderFailureAt: "2026-03-12T12:05:00.000Z",
        providerPauseUntil: "2026-03-12T12:15:00.000Z",
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("ignores stale finishCurrent writes after a newer workflow status was recorded", async () => {
    const fixture = await createStore();

    try {
      const queued = createQueuedRun(1020);
      const successStatus = "Ready for human review.";
      const staleFailure = "Failed.\nstale worker failure";
      await fixture.store.enqueue(queued);

      const started = await fixture.store.startNext();
      expect(started?.issueKey).toBe(queued.issueKey);

      await fixture.store.finishCurrent(queued.issueKey, successStatus);
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({ issueNumber: 1020 }),
        successStatus,
      );

      await fixture.store.finishCurrent(queued.issueKey, staleFailure);

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.currentRun).toBeUndefined();
      expect(snapshot.statusByIssue[queued.issueKey]).toBe(successStatus);
      expect(snapshot.statusSnapshotsByIssue[queued.issueKey]?.status).toBe(successStatus);
      expect(snapshot.statusSnapshotsByIssue[queued.issueKey]?.stage).toBe(
        "ready-for-human-review",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("recovers interrupted runs by requeueing them at the front", async () => {
    const fixture = await createStore();

    try {
      const firstRun = createQueuedRun(103);
      const secondRun = createQueuedRun(104);
      await fixture.store.enqueue(firstRun);
      await fixture.store.enqueue(secondRun);

      const started = await fixture.store.startNext();
      expect(started?.issueKey).toBe(firstRun.issueKey);

      const recovered = await fixture.store.recoverInterruptedRun();
      expect(recovered?.issueKey).toBe(firstRun.issueKey);

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.currentRun).toBeUndefined();
      expect(snapshot.queue.map((entry) => entry.issueKey)).toEqual([
        firstRun.issueKey,
        secondRun.issueKey,
      ]);
      expect(snapshot.statusByIssue[firstRun.issueKey]).toContain("Recovered after restart");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("does not enqueue duplicate issue keys and can remove queued runs", async () => {
    const fixture = await createStore();

    try {
      const firstRun = createQueuedRun(105);
      expect(await fixture.store.enqueue(firstRun)).toBe(true);
      expect(await fixture.store.enqueue(firstRun)).toBe(false);

      expect(await fixture.store.removeQueued(firstRun.issueKey)).toBe(true);
      expect(await fixture.store.removeQueued(firstRun.issueKey)).toBe(false);
      expect(await fixture.store.getStatus(firstRun.issueKey)).toBe("Skipped before execution.");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("skips pending approvals before they enter the queue", async () => {
    const fixture = await createStore();

    try {
      const pending = {
        issueKey: "zhyongrui/openclawcode#106",
        notifyChannel: "telegram",
        notifyTarget: "chat:123",
      };
      await fixture.store.addPendingApproval(pending);

      expect(await fixture.store.removePendingApproval(pending.issueKey)).toBe(true);
      expect(await fixture.store.removePendingApproval(pending.issueKey)).toBe(false);
      expect(await fixture.store.getStatus(pending.issueKey)).toBe("Skipped before execution.");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("atomically promotes a pending approval into the durable queue", async () => {
    const fixture = await createStore();

    try {
      const pending = {
        issueKey: "zhyongrui/openclawcode#107",
        notifyChannel: "telegram",
        notifyTarget: "chat:123",
      };
      await fixture.store.addPendingApproval(pending);

      const promoted = await fixture.store.promotePendingApprovalToQueue({
        issueKey: pending.issueKey,
        request: createQueuedRun(107).request,
        fallbackNotifyChannel: "discord",
        fallbackNotifyTarget: "channel:999",
        status: "Approved in chat and queued.",
      });

      expect(promoted).toEqual({
        issueKey: pending.issueKey,
        notifyChannel: "telegram",
        notifyTarget: "chat:123",
        request: createQueuedRun(107).request,
      });

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.queue).toEqual([promoted]);
      expect(snapshot.statusByIssue[pending.issueKey]).toBe("Approved in chat and queued.");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("persists one pending intake draft per repo and chat target", async () => {
    const fixture = await createStore();

    try {
      const createdAt = "2026-03-16T10:00:00.000Z";
      const draft = {
        repoKey: "zhyongrui/openclawcode",
        notifyChannel: "telegram",
        notifyTarget: "chat:123",
        title: "Expose issueCount in run json",
        body: "Summary\nExpose issueCount in run json",
        sourceRequest: "Expose issueCount in run json",
        bodySynthesized: true,
        scopedDrafts: [],
        clarificationQuestions: ["What proof should show the request succeeded?"],
        clarificationSuggestions: ["Use /occode-intake-edit before /occode-intake-confirm."],
        clarificationResponses: [
          {
            question: "What proof should show the request succeeded?",
            answer: "Add a regression assertion for the top-level field.",
            answeredAt: createdAt,
          },
        ],
        createdAt,
        updatedAt: createdAt,
      };

      expect(await fixture.store.upsertPendingIntakeDraft(draft)).toBe("added");
      expect(
        await fixture.store.upsertPendingIntakeDraft({
          ...draft,
          title: "Expose issueCount and issueRepo in run json",
          bodySynthesized: false,
          updatedAt: "2026-03-16T10:05:00.000Z",
        }),
      ).toBe("updated");

      const saved = await fixture.store.getPendingIntakeDraft({
        repoKey: draft.repoKey,
        notifyChannel: draft.notifyChannel,
        notifyTarget: draft.notifyTarget,
      });
      expect(saved).toMatchObject({
        title: "Expose issueCount and issueRepo in run json",
        bodySynthesized: false,
        clarificationResponses: [
          expect.objectContaining({
            answer: "Add a regression assertion for the top-level field.",
          }),
        ],
        createdAt,
      });

      expect(
        await fixture.store.removePendingIntakeDraft({
          repoKey: draft.repoKey,
          notifyChannel: draft.notifyChannel,
          notifyTarget: draft.notifyTarget,
        }),
      ).toBe(true);
      expect(await fixture.store.snapshot()).toMatchObject({
        pendingIntakeDrafts: [],
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("persists one setup session per chat target", async () => {
    const fixture = await createStore();

    try {
      const createdAt = "2026-03-19T02:00:00.000Z";
      expect(
        await fixture.store.upsertSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
          projectMode: "new-project",
          stage: "drafting-blueprint",
          blueprintDraft: {
            status: "draft",
            sections: {
              Goal: "Ship blueprint-first chat onboarding for new repositories.",
              Constraints: "- Stay inside chat until repo creation is necessary.",
            },
          },
          createdAt,
          updatedAt: createdAt,
        }),
      ).toBe("added");

      expect(
        await fixture.store.upsertSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
          projectMode: "existing-repo",
          repoKey: "zhyongrui/openclawcode",
          stage: "bootstrap-complete",
          githubAuthSource: "gh-auth-token",
          bootstrap: {
            completedAt: "2026-03-19T02:03:00.000Z",
            repoRoot: "/home/zyr/pros/openclawcode-target",
            blueprintPath: "/home/zyr/pros/openclawcode-target/PROJECT-BLUEPRINT.md",
            blueprintGoalSummary: "Ship chat-native setup.",
            workItemCount: 2,
            plannedWorkItemCount: 2,
            readyForIssueProjection: false,
            blockedGateCount: 1,
            needsHumanDecisionCount: 1,
            pluginActivation: {
              ready: true,
              pluginsEnabled: true,
              allowlisted: true,
              entryEnabled: true,
            },
            firstWorkItemTitle: "[Blueprint]: Capture project goal",
            nextSuggestedCommand: "/occode-gates zhyongrui/openclawcode",
            autoBindStatus: "existing-binding-kept",
            autoBindChannel: "feishu",
            autoBindTarget: "user:setup-chat",
            clarificationQuestions: ["What exact operator-visible success proves readiness?"],
            nextAction: "clarify-project-blueprint",
            blueprintCommand: "/occode-blueprint zhyongrui/openclawcode",
            proofReadiness: {
              cliProofReady: true,
              chatProofReady: true,
              chatSetupRoutingReady: true,
            },
          },
          githubDeviceAuth: {
            pid: 321,
            logPath: "/tmp/gh-auth-login.log",
            userCode: "ABCD-EFGH",
            verificationUri: "https://github.com/login/device",
            startedAt: createdAt,
            completedAt: "2026-03-19T02:03:00.000Z",
            notificationState: "authorized",
            notificationSentAt: "2026-03-19T02:04:00.000Z",
          },
          createdAt: "2026-03-19T02:03:00.000Z",
          updatedAt: "2026-03-19T02:03:00.000Z",
        }),
      ).toBe("updated");

      const saved = await fixture.store.getSetupSession({
        notifyChannel: "feishu",
        notifyTarget: "user:setup-chat",
      });
      expect(saved).toMatchObject({
        projectMode: "existing-repo",
        repoKey: "zhyongrui/openclawcode",
        stage: "bootstrap-complete",
        githubAuthSource: "gh-auth-token",
        bootstrap: {
          blueprintGoalSummary: "Ship chat-native setup.",
          nextAction: "clarify-project-blueprint",
          workItemCount: 2,
          autoBindStatus: "existing-binding-kept",
          pluginActivation: {
            ready: true,
          },
          proofReadiness: {
            chatSetupRoutingReady: true,
          },
        },
        createdAt,
      });
      await expect(fixture.store.listSetupSessions()).resolves.toHaveLength(1);

      expect(
        await fixture.store.removeSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toBe(true);
      expect(await fixture.store.snapshot()).toMatchObject({
        setupSessions: [],
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("persists and clears manual takeover records per issue", async () => {
    const fixture = await createStore();

    try {
      expect(
        await fixture.store.upsertManualTakeover({
          issueKey: "zhyongrui/openclawcode#140",
          runId: "run-140",
          stage: "ready-for-human-review",
          branchName: "openclawcode/issue-140",
          worktreePath: "/tmp/openclawcode-140",
          notifyChannel: "telegram",
          notifyTarget: "chat:123",
          actor: "user:operator",
          note: "Human is testing a manual patch.",
          requestedAt: "2026-03-16T10:10:00.000Z",
        }),
      ).toBe("added");

      expect(await fixture.store.getManualTakeover("zhyongrui/openclawcode#140")).toMatchObject({
        worktreePath: "/tmp/openclawcode-140",
        actor: "user:operator",
      });

      expect(await fixture.store.removeManualTakeover("zhyongrui/openclawcode#140")).toBe(true);
      expect(await fixture.store.getManualTakeover("zhyongrui/openclawcode#140")).toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("can update an existing pending approval into an execution-start gate hold", async () => {
    const fixture = await createStore();

    try {
      const pending = {
        issueKey: "zhyongrui/openclawcode#1071",
        notifyChannel: "telegram",
        notifyTarget: "chat:123",
      };
      await fixture.store.addPendingApproval(pending);

      const outcome = await fixture.store.upsertPendingApproval(
        {
          issueKey: pending.issueKey,
          notifyChannel: "feishu",
          notifyTarget: "user:current-chat",
          approvalKind: "execution-start-gated",
        },
        "Awaiting execution-start gate approval.",
      );

      expect(outcome).toBe("updated");
      expect(await fixture.store.getPendingApproval(pending.issueKey)).toEqual({
        issueKey: pending.issueKey,
        notifyChannel: "feishu",
        notifyTarget: "user:current-chat",
        approvalKind: "execution-start-gated",
      });
      expect(await fixture.store.getStatus(pending.issueKey)).toBe(
        "Awaiting execution-start gate approval.",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("can promote directly to queue when no pending approval exists", async () => {
    const fixture = await createStore();

    try {
      const promoted = await fixture.store.promotePendingApprovalToQueue({
        issueKey: "zhyongrui/openclawcode#108",
        request: createQueuedRun(108).request,
        fallbackNotifyChannel: "discord",
        fallbackNotifyTarget: "channel:999",
      });

      expect(promoted).toEqual({
        issueKey: "zhyongrui/openclawcode#108",
        notifyChannel: "discord",
        notifyTarget: "channel:999",
        request: createQueuedRun(108).request,
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("persists GitHub delivery records across store instances", async () => {
    const fixture = await createStore();

    try {
      await fixture.store.recordGitHubDelivery({
        deliveryId: "delivery-1",
        eventName: "issues",
        action: "opened",
        accepted: true,
        reason: "accepted",
        receivedAt: "2026-03-10T15:20:00.000Z",
        issueKey: "zhyongrui/openclawcode#109",
      });

      const secondStore = OpenClawCodeChatopsStore.fromStateDir(fixture.rootDir);
      expect(await secondStore.getGitHubDelivery("delivery-1")).toEqual({
        deliveryId: "delivery-1",
        eventName: "issues",
        action: "opened",
        accepted: true,
        reason: "accepted",
        receivedAt: "2026-03-10T15:20:00.000Z",
        issueKey: "zhyongrui/openclawcode#109",
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("keeps only the newest GitHub delivery records", { timeout: 60_000 }, async () => {
    const fixture = await createStore();

    try {
      for (let index = 0; index < 202; index += 1) {
        await fixture.store.recordGitHubDelivery({
          deliveryId: `delivery-${index}`,
          eventName: "issues",
          action: "opened",
          accepted: index % 2 === 0,
          reason: `reason-${index}`,
          receivedAt: `2026-03-10T15:${String(index % 60).padStart(2, "0")}:00.000Z`,
          issueKey: `zhyongrui/openclawcode#${300 + index}`,
        });
      }

      const snapshot = await fixture.store.snapshot();
      expect(Object.keys(snapshot.githubDeliveriesById)).toHaveLength(200);
      expect(snapshot.githubDeliveriesById["delivery-0"]).toBeUndefined();
      expect(snapshot.githubDeliveriesById["delivery-1"]).toBeUndefined();
      expect(snapshot.githubDeliveriesById["delivery-2"]?.reason).toBe("reason-2");
      expect(snapshot.githubDeliveriesById["delivery-201"]?.issueKey).toBe(
        "zhyongrui/openclawcode#501",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("persists structured workflow run snapshots alongside issue statuses", async () => {
    const fixture = await createStore();

    try {
      const run = createWorkflowRun({
        issueNumber: 109,
        stage: "merged",
        prNumber: 209,
        prUrl: "https://github.com/zhyongrui/openclawcode/pull/209",
        rerunContext: {
          reason: "Address GitHub review feedback",
          requestedAt: "2026-03-10T08:25:00.000Z",
          priorRunId: "run-108",
          priorStage: "changes-requested",
          reviewDecision: "changes-requested",
          reviewSubmittedAt: "2026-03-10T08:20:00.000Z",
          reviewSummary: "Please add a regression test for the rerun path.",
          reviewUrl: "https://github.com/zhyongrui/openclawcode/pull/209#pullrequestreview-2",
          requestedCoderAgentId: "codex-reroute",
          requestedVerifierAgentId: "claude-reroute",
          manualTakeoverRequestedAt: "2026-03-10T08:24:00.000Z",
          manualTakeoverActor: "user:operator",
          manualTakeoverWorktreePath: "/repo/.openclawcode/worktrees/issue-109",
          manualResumeNote: "Human updated the worktree before rerun.",
        },
        handoffs: {
          entries: [
            {
              kind: "runtime-steering",
              recordedAt: "2026-03-10T08:23:00.000Z",
              summary:
                "stage=verifying | role=verifier | adapter=claude-code | agent=claude-reroute",
            },
            {
              kind: "rerun-request",
              recordedAt: "2026-03-10T08:25:00.000Z",
              summary: "Address GitHub review feedback",
              priorRunId: "run-108",
              priorStage: "changes-requested",
              reviewDecision: "changes-requested",
              reviewSubmittedAt: "2026-03-10T08:20:00.000Z",
            },
            {
              kind: "runtime-reroute",
              recordedAt: "2026-03-10T08:25:00.000Z",
              summary: "coder=codex-reroute, verifier=claude-reroute",
              requestedCoderAgentId: "codex-reroute",
              requestedVerifierAgentId: "claude-reroute",
            },
            {
              kind: "manual-takeover",
              recordedAt: "2026-03-10T08:24:00.000Z",
              actor: "user:operator",
              summary: "/repo/.openclawcode/worktrees/issue-109",
              worktreePath: "/repo/.openclawcode/worktrees/issue-109",
            },
            {
              kind: "manual-resume",
              recordedAt: "2026-03-10T08:25:00.000Z",
              actor: "user:operator",
              summary: "Human updated the worktree before rerun.",
              worktreePath: "/repo/.openclawcode/worktrees/issue-109",
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
              appliedAgentId: "codex-reroute",
              agentSource: "rerun-request",
            },
            {
              roleId: "verifier",
              adapterId: "claude-code",
              assignmentSource: "blueprint",
              configured: true,
              appliedAgentId: "claude-reroute",
              agentSource: "stage-steering",
            },
          ],
        },
      });

      await fixture.store.recordWorkflowRunStatus(
        run,
        "openclawcode status for zhyongrui/openclawcode#109",
        {
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
        },
      );

      const snapshot = await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#109");
      expect(snapshot).toMatchObject({
        issueKey: "zhyongrui/openclawcode#109",
        stage: "merged",
        runId: "run-109",
        issueNumber: 109,
        pullRequestNumber: 209,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/209",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        rerunReason: "Address GitHub review feedback",
        rerunRequestedAt: "2026-03-10T08:25:00.000Z",
        rerunPriorRunId: "run-108",
        rerunPriorStage: "changes-requested",
        rerunRequestedCoderAgentId: "codex-reroute",
        rerunRequestedVerifierAgentId: "claude-reroute",
        rerunManualTakeoverRequestedAt: "2026-03-10T08:24:00.000Z",
        rerunManualTakeoverActor: "user:operator",
        rerunManualTakeoverWorktreePath: "/repo/.openclawcode/worktrees/issue-109",
        rerunManualResumeNote: "Human updated the worktree before rerun.",
        runtimeRoutingSummary:
          "coder=codex-reroute | adapter=codex | source=rerun-request || verifier=claude-reroute | adapter=claude-code | source=stage-steering",
        latestReviewDecision: "changes-requested",
        latestReviewSubmittedAt: "2026-03-10T08:20:00.000Z",
        latestReviewSummary: "Please add a regression test for the rerun path.",
        latestReviewUrl: "https://github.com/zhyongrui/openclawcode/pull/209#pullrequestreview-2",
        autoMergePolicyEligible: false,
        autoMergePolicyReason:
          "Not eligible for auto-merge: suitability did not accept autonomous execution.",
        handoffEntries: expect.arrayContaining([
          expect.objectContaining({
            kind: "runtime-steering",
            summary:
              "stage=verifying | role=verifier | adapter=claude-code | agent=claude-reroute",
          }),
          expect.objectContaining({
            kind: "rerun-request",
            summary: "Address GitHub review feedback",
          }),
          expect.objectContaining({
            kind: "runtime-reroute",
            summary: "coder=codex-reroute, verifier=claude-reroute",
          }),
          expect.objectContaining({
            kind: "manual-takeover",
            actor: "user:operator",
          }),
          expect.objectContaining({
            kind: "manual-resume",
            summary: "Human updated the worktree before rerun.",
          }),
        ]),
        lastNotificationChannel: "telegram",
        lastNotificationTarget: "chat:primary",
        lastNotificationStatus: "sent",
      });
      expect(snapshot?.lastNotificationAt).toMatch(/^2026-03-\d{2}T/);
      expect(
        await fixture.store.findStatusSnapshotByPullRequest({
          owner: "zhyongrui",
          repo: "openclawcode",
          pullRequestNumber: 209,
        }),
      ).toMatchObject({
        issueKey: "zhyongrui/openclawcode#109",
        pullRequestNumber: 209,
      });
      expect(await fixture.store.getStatus("zhyongrui/openclawcode#109")).toBe(
        "openclawcode status for zhyongrui/openclawcode#109",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("records snapshot notification delivery metadata for operator ledger output", async () => {
    const fixture = await createStore();

    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#110",
        status: "openclawcode status for zhyongrui/openclawcode#110",
        stage: "ready-for-human-review",
        runId: "run-110",
        updatedAt: "2026-03-10T09:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 110,
      });

      await fixture.store.recordSnapshotNotification({
        issueKey: "zhyongrui/openclawcode#110",
        notifyChannel: "feishu",
        notifyTarget: "user:bound-chat",
        notifiedAt: "2026-03-10T09:05:00.000Z",
        status: "failed",
        error: "send failed",
      });

      expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#110")).toMatchObject({
        notifyChannel: "feishu",
        notifyTarget: "user:bound-chat",
        lastNotificationChannel: "feishu",
        lastNotificationTarget: "user:bound-chat",
        lastNotificationAt: "2026-03-10T09:05:00.000Z",
        lastNotificationStatus: "failed",
        lastNotificationError: "send failed",
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent workflow status writes without dropping snapshots", async () => {
    const fixture = await createStore();

    try {
      await Promise.all(
        Array.from({ length: 12 }, (_, index) => {
          const issueNumber = 200 + index;
          return fixture.store.recordWorkflowRunStatus(
            createWorkflowRun({
              issueNumber,
              stage: index % 2 === 0 ? "ready-for-human-review" : "merged",
              updatedAt: `2026-03-10T08:${String(index).padStart(2, "0")}:00.000Z`,
              prNumber: 500 + index,
              prUrl: `https://github.com/zhyongrui/openclawcode/pull/${500 + index}`,
            }),
            `status-${issueNumber}`,
          );
        }),
      );

      const snapshot = await fixture.store.snapshot();
      expect(Object.keys(snapshot.statusSnapshotsByIssue)).toHaveLength(12);

      for (let issueNumber = 200; issueNumber < 212; issueNumber += 1) {
        const issueKey = `zhyongrui/openclawcode#${issueNumber}`;
        expect(snapshot.statusByIssue[issueKey]).toBe(`status-${issueNumber}`);
        expect(snapshot.statusSnapshotsByIssue[issueKey]?.pullRequestNumber).toBe(
          500 + (issueNumber - 200),
        );
      }
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
