import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpenClawCodeChatopsStore } from "../../integrations/openclaw-plugin/index.js";

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
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
      openPullRequest: true,
      mergeOnApprove: true,
    },
  };
}

describe("OpenClawCodeChatopsStore", () => {
  it("persists pending approvals and consumes them when approved", async () => {
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
  });

  it("persists queue entries and statuses across store instances", async () => {
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
  });

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
});
