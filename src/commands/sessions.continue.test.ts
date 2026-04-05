import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import { createManagedTaskFlow, getTaskFlowById, resetTaskFlowRegistryForTests } from "../tasks/task-flow-runtime-internal.js";
import { configureTaskRegistryRuntime } from "../tasks/task-registry.store.js";
import { createTaskRecord, getTaskById, resetTaskRegistryForTests } from "../tasks/runtime-internal.js";
import { makeRuntime, mockSessionsConfig, writeStore } from "./sessions.test-helpers.js";

const mocks = vi.hoisted(() => ({
  agentCliCommandMock: vi.fn(),
}));

vi.mock("./agent-via-gateway.js", () => ({
  agentCliCommand: (...args: unknown[]) => mocks.agentCliCommandMock(...args),
}));

mockSessionsConfig();

import { sessionsContinueCommand } from "./sessions.js";

describe("sessionsContinueCommand", () => {
  const taskStore = {
    loadSnapshot: () => ({
      tasks: new Map(),
      deliveryStates: new Map(),
    }),
    saveSnapshot: () => {},
    upsertTaskWithDeliveryState: () => {},
    upsertTask: () => {},
    deleteTaskWithDeliveryState: () => {},
    deleteTask: () => {},
    upsertDeliveryState: () => {},
    deleteDeliveryState: () => {},
    close: () => {},
  };
  const flowStore = {
    loadSnapshot: () => ({
      flows: new Map(),
    }),
    saveSnapshot: () => {},
    upsertFlow: () => {},
    deleteFlow: () => {},
    close: () => {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentCliCommandMock.mockResolvedValue({});
    resetTaskRegistryForTests({ persist: false });
    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskRegistryRuntime({ store: taskStore });
    configureTaskFlowRegistryRuntime({ store: flowStore });
  });

  it("wraps JSON output with resolved session metadata and forwarded agent result", async () => {
    const store = writeStore({
      "agent:coder:acp:child": {
        sessionId: "sess-child-123",
        updatedAt: Date.now() - 5 * 60_000,
        sessionFile: "/tmp/missing-transcript.jsonl",
      },
    });

    try {
      mocks.agentCliCommandMock.mockResolvedValue({
        runId: "run-bg-1",
        status: "accepted",
        handoff: {
          continueWith:
            'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
        },
      });
      const { runtime, logs } = makeRuntime();
      await sessionsContinueCommand(
        {
          lookup: "sess-child-123",
          message: "Continue detached work",
          store,
          thinking: "medium",
          verbose: "on",
          background: true,
          json: true,
        },
        runtime,
      );

      expect(mocks.agentCliCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Continue detached work",
          sessionId: "sess-child-123",
          background: true,
          thinking: "medium",
          verbose: "on",
          json: false,
        }),
        expect.objectContaining({
          log: expect.any(Function),
        }),
      );
      expect(mocks.agentCliCommandMock.mock.calls[0]?.[0]?.sessionKey).toBeUndefined();

      const payload = JSON.parse(logs[0] ?? "{}") as {
        runId?: string;
        status?: string;
        lookup?: string;
        resolvedBy?: string;
        continuedSession?: {
          key: string;
          sessionId: string | null;
          agentId: string;
          transcriptPath: string | null;
          transcriptExists: boolean;
          lifecycleBeforeContinue?: {
            status: string;
            waitingFlowCount: number;
          } | null;
          resumeBeforeContinue?: {
            sessionKey: string;
            transcriptPath: string | null;
            transcriptExists: boolean;
            continueWith: string;
          } | null;
        };
        continueRequest?: {
          message: string;
          background: boolean;
          thinking: string | null;
          verbose: string | null;
        };
        handoff?: {
          continueWith?: string;
        };
      };

      expect(payload).toMatchObject({
        runId: "run-bg-1",
        status: "accepted",
        lookup: "sess-child-123",
        resolvedBy: "session_id",
        continuedSession: {
          key: "agent:coder:acp:child",
          sessionId: "sess-child-123",
          agentId: "coder",
          transcriptPath: "/tmp/missing-transcript.jsonl",
          transcriptExists: false,
          lifecycleBeforeContinue: {
            status: "missing_transcript",
            waitingFlowCount: 0,
          },
          resumeBeforeContinue: {
            sessionKey: "agent:coder:acp:child",
            transcriptPath: "/tmp/missing-transcript.jsonl",
            transcriptExists: false,
            continueWith:
              'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
          },
        },
        continueRequest: {
          message: "Continue detached work",
          background: true,
          thinking: "medium",
          verbose: "on",
        },
        handoff: {
          continueWith:
            'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
        },
      });
    } finally {
      fs.rmSync(store, { force: true });
    }
  });

  it("falls back to session key when the session has no session id", async () => {
    const store = writeStore({
      "agent:main:main": {
        updatedAt: Date.now() - 5 * 60_000,
      },
    });

    try {
      const { runtime } = makeRuntime();
      await sessionsContinueCommand(
        {
          lookup: "agent:main:main",
          message: "Resume by key",
          store,
          local: true,
        },
        runtime,
      );

      expect(mocks.agentCliCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Resume by key",
          sessionKey: "agent:main:main",
          local: true,
          json: false,
        }),
        runtime,
      );
      expect(mocks.agentCliCommandMock.mock.calls[0]?.[0]?.sessionId).toBeUndefined();
    } finally {
      fs.rmSync(store, { force: true });
    }
  });

  it("prints resolved session context before continuing in text mode", async () => {
    const store = writeStore({
      "agent:coder:acp:child": {
        sessionId: "sess-child-999",
        updatedAt: Date.now() - 5 * 60_000,
        sessionFile: "/tmp/missing-transcript-continue.jsonl",
      },
    });

    try {
      const { runtime, logs } = makeRuntime();
      await sessionsContinueCommand(
        {
          lookup: "sess-child-999",
          message: "Continue in text mode",
          store,
        },
        runtime,
      );

      const output = logs.join("\n");
      expect(output).toContain("Continuing session:");
      expect(output).toContain("lookup: sess-child-999");
      expect(output).toContain("resolvedBy: session_id");
      expect(output).toContain("key: agent:coder:acp:child");
      expect(output).toContain("sessionId: sess-child-999");
      expect(output).toContain("agent: coder");
      expect(output).toContain("transcriptExists: no");
      expect(output).toContain("lifecycleBeforeContinue: missing_transcript");
      expect(output).toContain("lifecycleSummary: Transcript file is missing");
      expect(output).toContain("Resume before continue:");
      expect(output).toContain("resumeSessionKey: agent:coder:acp:child");
      expect(output).toContain("resumeTranscript: /tmp/missing-transcript-continue.jsonl");
      expect(output).toContain("resumeTranscriptExists: no");
      expect(output).toContain(
        'continueWith: openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
      );
    } finally {
      fs.rmSync(store, { force: true });
    }
  });

  it("fails with candidate details when the lookup is ambiguous", async () => {
    const store = writeStore({
      "agent:main:alpha": {
        sessionId: "dup-session",
        updatedAt: Date.now() - 5 * 60_000,
      },
      "agent:main:beta": {
        sessionId: "dup-session",
        updatedAt: Date.now() - 5 * 60_000,
      },
    });

    try {
      const { runtime, errors } = makeRuntime();
      await expect(
        sessionsContinueCommand(
          {
            lookup: "dup-session",
            message: "Continue detached work",
            store,
          },
          runtime,
        ),
      ).rejects.toThrow("exit 1");

      expect(errors[0]).toContain("Session lookup is ambiguous");
      expect(errors[1]).toContain("agent:main:alpha");
      expect(errors[2]).toContain("agent:main:beta");
      expect(mocks.agentCliCommandMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(store, { force: true });
    }
  });

  it("keeps JSON output additive when continuing a session-key lookup", async () => {
    const store = writeStore({
      "agent:main:main": {
        updatedAt: Date.now() - 5 * 60_000,
      },
    });

    try {
      mocks.agentCliCommandMock.mockResolvedValue({
        payloads: [{ text: "done" }],
        meta: { stub: true },
      });
      const { runtime, logs } = makeRuntime();
      await sessionsContinueCommand(
        {
          lookup: "agent:main:main",
          message: "Resume by key",
          store,
          json: true,
          local: true,
        },
        runtime,
      );

      const payload = JSON.parse(logs[0] ?? "{}") as {
        payloads?: Array<{ text?: string }>;
        continuedSession?: {
          key: string;
          sessionId: string | null;
          lifecycleBeforeContinue?: {
            status: string;
          } | null;
        };
        continueRequest?: { local: boolean; background: boolean };
      };

      expect(payload).toMatchObject({
        payloads: [{ text: "done" }],
        continuedSession: {
          key: "agent:main:main",
          sessionId: null,
          lifecycleBeforeContinue: {
            status: "missing_transcript",
          },
        },
        continueRequest: {
          local: true,
          background: false,
        },
      });
    } finally {
      fs.rmSync(store, { force: true });
    }
  });

  it("marks related tasks and flows as reattached for foreground continue", async () => {
    const store = writeStore({
      "agent:coder:acp:child": {
        sessionId: "sess-child-continue-reattach",
        updatedAt: Date.now() - 5 * 60_000,
      },
    });
    const task = createTaskRecord({
      runtime: "acp",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      childSessionKey: "agent:coder:acp:child",
      originKind: "detached_session",
      originSessionKey: "agent:main:main",
      task: "Detached child",
      status: "running",
      deliveryStatus: "pending",
      notifyPolicy: "state_changes",
    });
    const flow = createManagedTaskFlow({
      ownerKey: "agent:coder:acp:child",
      controllerId: "tests/sessions-continue",
      goal: "Detached child",
      status: "waiting",
    });

    try {
      const { runtime, logs } = makeRuntime();
      await sessionsContinueCommand(
        {
          lookup: "sess-child-continue-reattach",
          message: "Bring this back to foreground",
          store,
          json: true,
        },
        runtime,
      );

      const updatedTask = getTaskById(task.taskId);
      const updatedFlow = getTaskFlowById(flow.flowId);
      expect(updatedTask?.reattachedAt).toBeTypeOf("number");
      expect(updatedFlow?.reattachedAt).toBeTypeOf("number");

      const payload = JSON.parse(logs[0] ?? "{}") as {
        continuedSession?: { reattachedAt?: number | null };
      };
      expect(payload.continuedSession?.reattachedAt).toBe(updatedTask?.reattachedAt);
      expect(updatedFlow?.reattachedAt).toBe(updatedTask?.reattachedAt);
    } finally {
      fs.rmSync(store, { force: true });
    }
  });

  it("does not mark related tasks and flows as reattached for background continue", async () => {
    const store = writeStore({
      "agent:coder:acp:bg-child": {
        sessionId: "sess-child-continue-bg",
        updatedAt: Date.now() - 5 * 60_000,
      },
    });
    const task = createTaskRecord({
      runtime: "acp",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      childSessionKey: "agent:coder:acp:bg-child",
      originKind: "detached_session",
      originSessionKey: "agent:main:main",
      task: "Detached child",
      status: "running",
      deliveryStatus: "pending",
      notifyPolicy: "state_changes",
    });
    const flow = createManagedTaskFlow({
      ownerKey: "agent:coder:acp:bg-child",
      controllerId: "tests/sessions-continue",
      goal: "Detached child",
      status: "waiting",
    });

    try {
      const { runtime, logs } = makeRuntime();
      await sessionsContinueCommand(
        {
          lookup: "sess-child-continue-bg",
          message: "Keep it detached",
          store,
          json: true,
          background: true,
        },
        runtime,
      );

      expect(getTaskById(task.taskId)?.reattachedAt).toBeUndefined();
      expect(getTaskFlowById(flow.flowId)?.reattachedAt).toBeUndefined();
      const payload = JSON.parse(logs[0] ?? "{}") as {
        continuedSession?: { reattachedAt?: number | null };
      };
      expect(payload.continuedSession?.reattachedAt).toBeNull();
    } finally {
      fs.rmSync(store, { force: true });
    }
  });
});
