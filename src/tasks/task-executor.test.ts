import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { getFlowById, listFlowRecords, resetFlowRegistryForTests } from "./flow-registry.js";
import {
  cancelDetachedTaskRunById,
  completeTaskRunByRunId,
  createQueuedTaskRun,
  createRunningTaskRun,
  failTaskRunByRunId,
  recordTaskRunProgressByRunId,
  setDetachedTaskDeliveryStatusByRunId,
  startTaskRunByRunId,
} from "./task-executor.js";
import {
  findLatestTaskForFlowId,
  getTaskById,
  resetTaskRegistryForTests,
} from "./task-registry.js";

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;
const hoisted = vi.hoisted(() => {
  const sendMessageMock = vi.fn();
  const cancelSessionMock = vi.fn();
  const killSubagentRunAdminMock = vi.fn();
  return {
    sendMessageMock,
    cancelSessionMock,
    killSubagentRunAdminMock,
  };
});

vi.mock("./task-registry-delivery-runtime.js", () => ({
  sendMessage: hoisted.sendMessageMock,
}));

vi.mock("../acp/control-plane/manager.js", () => ({
  getAcpSessionManager: () => ({
    cancelSession: hoisted.cancelSessionMock,
  }),
}));

vi.mock("../agents/subagent-control.js", () => ({
  killSubagentRunAdmin: (params: unknown) => hoisted.killSubagentRunAdminMock(params),
}));

async function withTaskExecutorStateDir(run: (root: string) => Promise<void>): Promise<void> {
  await withTempDir({ prefix: "openclaw-task-executor-" }, async (root) => {
    process.env.OPENCLAW_STATE_DIR = root;
    resetTaskRegistryForTests();
    resetFlowRegistryForTests();
    try {
      await run(root);
    } finally {
      resetTaskRegistryForTests();
      resetFlowRegistryForTests();
    }
  });
}

describe("task-executor", () => {
  afterEach(() => {
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
    }
    resetTaskRegistryForTests();
    resetFlowRegistryForTests();
    hoisted.sendMessageMock.mockReset();
    hoisted.cancelSessionMock.mockReset();
    hoisted.killSubagentRunAdminMock.mockReset();
  });

  it("advances a queued run through start and completion", async () => {
    await withTaskExecutorStateDir(async () => {
      const created = createQueuedTaskRun({
        runtime: "acp",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:codex:acp:child",
        runId: "run-executor-queued",
        task: "Investigate issue",
      });

      expect(created.status).toBe("queued");

      startTaskRunByRunId({
        runId: "run-executor-queued",
        startedAt: 100,
        lastEventAt: 100,
        eventSummary: "Started.",
      });

      completeTaskRunByRunId({
        runId: "run-executor-queued",
        endedAt: 250,
        lastEventAt: 250,
        terminalSummary: "Done.",
      });

      expect(getTaskById(created.taskId)).toMatchObject({
        taskId: created.taskId,
        status: "succeeded",
        startedAt: 100,
        endedAt: 250,
        terminalSummary: "Done.",
      });
    });
  });

  it("records progress, failure, and delivery status through the executor", async () => {
    await withTaskExecutorStateDir(async () => {
      const created = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:codex:subagent:child",
        runId: "run-executor-fail",
        task: "Write summary",
        startedAt: 10,
      });

      recordTaskRunProgressByRunId({
        runId: "run-executor-fail",
        lastEventAt: 20,
        progressSummary: "Collecting results",
        eventSummary: "Collecting results",
      });

      failTaskRunByRunId({
        runId: "run-executor-fail",
        endedAt: 40,
        lastEventAt: 40,
        error: "tool failed",
      });

      setDetachedTaskDeliveryStatusByRunId({
        runId: "run-executor-fail",
        deliveryStatus: "failed",
      });

      expect(getTaskById(created.taskId)).toMatchObject({
        taskId: created.taskId,
        status: "failed",
        progressSummary: "Collecting results",
        error: "tool failed",
        deliveryStatus: "failed",
      });
    });
  });

  it("auto-creates a one-task flow and keeps it synced with task status", async () => {
    await withTaskExecutorStateDir(async () => {
      const created = createRunningTaskRun({
        runtime: "subagent",
        originKind: "detached_session",
        originSessionKey: "agent:main:main",
        requesterSessionKey: "agent:main:main",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:codex:subagent:child",
        runId: "run-executor-flow",
        task: "Write summary",
        startedAt: 10,
        deliveryStatus: "pending",
      });

      expect(created.parentFlowId).toEqual(expect.any(String));
      expect(getFlowById(created.parentFlowId!)).toMatchObject({
        flowId: created.parentFlowId,
        originKind: "detached_session",
        originSessionKey: "agent:main:main",
        ownerSessionKey: "agent:main:main",
        status: "running",
        goal: "Write summary",
        notifyPolicy: "done_only",
      });

      completeTaskRunByRunId({
        runId: "run-executor-flow",
        endedAt: 40,
        lastEventAt: 40,
        terminalSummary: "Done.",
      });

      expect(getFlowById(created.parentFlowId!)).toMatchObject({
        flowId: created.parentFlowId,
        status: "succeeded",
        endedAt: 40,
        goal: "Write summary",
        notifyPolicy: "done_only",
      });
    });
  });

  it("does not auto-create one-task flows for non-returning bookkeeping runs", async () => {
    await withTaskExecutorStateDir(async () => {
      const created = createRunningTaskRun({
        runtime: "cli",
        requesterSessionKey: "agent:main:main",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:main:main",
        runId: "run-executor-cli",
        task: "Foreground gateway run",
        deliveryStatus: "not_applicable",
        startedAt: 10,
      });

      expect(created.parentFlowId).toBeUndefined();
      expect(listFlowRecords()).toEqual([]);
    });
  });

  it("records blocked task outcomes without wrapping them in a separate flow model", async () => {
    await withTaskExecutorStateDir(async () => {
      const created = createRunningTaskRun({
        runtime: "acp",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        requesterOrigin: {
          channel: "telegram",
          to: "telegram:123",
        },
        childSessionKey: "agent:codex:acp:child",
        runId: "run-executor-blocked",
        task: "Patch file",
        startedAt: 10,
        deliveryStatus: "pending",
        notifyPolicy: "silent",
      });

      completeTaskRunByRunId({
        runId: "run-executor-blocked",
        endedAt: 40,
        lastEventAt: 40,
        terminalOutcome: "blocked",
        terminalSummary: "Writable session required.",
      });

      expect(getTaskById(created.taskId)).toMatchObject({
        taskId: created.taskId,
        status: "succeeded",
        terminalOutcome: "blocked",
        terminalSummary: "Writable session required.",
      });
      expect(getFlowById(created.parentFlowId!)).toMatchObject({
        flowId: created.parentFlowId,
        status: "blocked",
        blockedTaskId: created.taskId,
        blockedSummary: "Writable session required.",
        endedAt: 40,
      });
    });
  });

  it("reuses the same one-task flow for queued retries after blocked outcomes", async () => {
    await withTaskExecutorStateDir(async () => {
      const created = createRunningTaskRun({
        runtime: "acp",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        requesterOrigin: {
          channel: "telegram",
          to: "telegram:123",
        },
        childSessionKey: "agent:codex:acp:child",
        runId: "run-executor-blocked-retry",
        task: "Patch file",
        startedAt: 10,
        deliveryStatus: "pending",
        notifyPolicy: "silent",
      });

      completeTaskRunByRunId({
        runId: "run-executor-blocked-retry",
        endedAt: 40,
        lastEventAt: 40,
        terminalOutcome: "blocked",
        terminalSummary: "Writable session required.",
      });

      const retried = retryBlockedFlowAsQueuedTaskRun({
        flowId: created.parentFlowId!,
        runId: "run-executor-retry",
        childSessionKey: "agent:codex:acp:retry-child",
      });

      expect(retried).toMatchObject({
        found: true,
        retried: true,
        previousTask: expect.objectContaining({
          taskId: created.taskId,
        }),
        task: expect.objectContaining({
          parentFlowId: created.parentFlowId,
          parentTaskId: created.taskId,
          status: "queued",
          runId: "run-executor-retry",
        }),
      });

      expect(getFlowById(created.parentFlowId!)).toMatchObject({
        flowId: created.parentFlowId,
        status: "queued",
      });
      expect(getFlowById(created.parentFlowId!)?.blockedTaskId).toBeUndefined();
      expect(getFlowById(created.parentFlowId!)?.blockedSummary).toBeUndefined();
      expect(getFlowById(created.parentFlowId!)?.endedAt).toBeUndefined();
      expect(findLatestTaskForFlowId(created.parentFlowId!)).toMatchObject({
        taskId: retried.task?.taskId,
      });
    });
  });

  it("cancels active ACP child tasks", async () => {
    await withTaskExecutorStateDir(async () => {
      hoisted.cancelSessionMock.mockResolvedValue(undefined);

      const child = createRunningTaskRun({
        runtime: "acp",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:codex:acp:child",
        runId: "run-linear-cancel",
        task: "Inspect a PR",
        startedAt: 10,
        deliveryStatus: "pending",
      });

      const cancelled = await cancelDetachedTaskRunById({
        cfg: {} as never,
        taskId: child.taskId,
      });

      expect(cancelled).toMatchObject({
        found: true,
        cancelled: true,
      });
      expect(getTaskById(child.taskId)).toMatchObject({
        taskId: child.taskId,
        status: "cancelled",
      });
      expect(hoisted.cancelSessionMock).toHaveBeenCalledWith({
        cfg: {} as never,
        sessionKey: "agent:codex:acp:child",
        reason: "task-cancel",
      });
    });
  });

  it("cancels active subagent child tasks", async () => {
    await withTaskExecutorStateDir(async () => {
      hoisted.killSubagentRunAdminMock.mockResolvedValue({
        found: true,
        killed: true,
      });

      const child = createRunningTaskRun({
        runtime: "subagent",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        childSessionKey: "agent:codex:subagent:child",
        runId: "run-subagent-cancel",
        task: "Inspect a PR",
        startedAt: 10,
        deliveryStatus: "pending",
      });

      const cancelled = await cancelDetachedTaskRunById({
        cfg: {} as never,
        taskId: child.taskId,
      });

      expect(cancelled).toMatchObject({
        found: true,
        cancelled: true,
      });
      expect(getTaskById(child.taskId)).toMatchObject({
        taskId: child.taskId,
        status: "cancelled",
      });
      expect(hoisted.killSubagentRunAdminMock).toHaveBeenCalledWith({
        cfg: {} as never,
        sessionKey: "agent:codex:subagent:child",
      });
    });
  });

  it("scopes run-id updates to the matching runtime and session", async () => {
    await withTaskExecutorStateDir(async () => {
      const victim = createRunningTaskRun({
        runtime: "acp",
        ownerKey: "agent:victim:main",
        scopeKind: "session",
        childSessionKey: "agent:victim:acp:child",
        runId: "run-shared-executor-scope",
        task: "Victim ACP task",
        deliveryStatus: "pending",
      });
      const attacker = createRunningTaskRun({
        runtime: "cli",
        ownerKey: "agent:attacker:main",
        scopeKind: "session",
        childSessionKey: "agent:attacker:main",
        runId: "run-shared-executor-scope",
        task: "Attacker CLI task",
        deliveryStatus: "not_applicable",
      });

      failTaskRunByRunId({
        runId: "run-shared-executor-scope",
        runtime: "cli",
        sessionKey: "agent:attacker:main",
        endedAt: 40,
        lastEventAt: 40,
        error: "attacker controlled error",
      });

      expect(getTaskById(attacker.taskId)).toMatchObject({
        status: "failed",
        error: "attacker controlled error",
      });
      expect(getTaskById(victim.taskId)).toMatchObject({
        status: "running",
      });
    });
  });
});
