import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import { configureTaskRegistryRuntime } from "../tasks/task-registry.store.js";
import { createManagedTaskFlow, resetTaskFlowRegistryForTests } from "../tasks/task-flow-runtime-internal.js";
import { createTaskRecord, resetTaskRegistryForTests } from "../tasks/task-registry.js";
import { makeRuntime } from "./sessions.test-helpers.js";

const currentConfig = vi.hoisted(() => ({
  value: {
    agents: {
      defaults: {
        model: { primary: "pi:opus" },
        models: { "pi:opus": {} },
        contextTokens: 32000,
      },
      list: [{ id: "main", default: true }, { id: "coder" }],
    },
    session: {
      store: "/tmp/openclaw-placeholder-sessions.json",
    },
  },
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => currentConfig.value,
  };
});

import { tasksShowCommand } from "./tasks.js";

describe("tasksShowCommand detached session lifecycle", () => {
  const tempDirs: string[] = [];
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00Z"));
    resetTaskRegistryForTests({ persist: false });
    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskRegistryRuntime({ store: taskStore });
    configureTaskFlowRegistryRuntime({ store: flowStore });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTaskRegistryForTests({ persist: false });
    resetTaskFlowRegistryForTests({ persist: false });
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows detached session lifecycle in text and JSON output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-tasks-show-lifecycle-"));
    tempDirs.push(root);
    const sessionsDir = path.join(root, "agents", "coder", "sessions");
    const store = path.join(sessionsDir, "sessions.json");
    const transcriptPath = path.join(sessionsDir, "sess-child-123.jsonl");
    currentConfig.value = {
      agents: {
        defaults: {
          model: { primary: "pi:opus" },
          models: { "pi:opus": {} },
          contextTokens: 32000,
        },
        list: [{ id: "main", default: true }, { id: "coder" }],
      },
      session: {
        store: path.join(root, "agents", "{agentId}", "sessions", "sessions.json"),
      },
    };
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(transcriptPath, '{"type":"message"}\n', "utf8");
    fs.writeFileSync(
      store,
      JSON.stringify(
        {
          "agent:coder:acp:child": {
            sessionId: "sess-child-123",
            updatedAt: Date.now() - 5 * 60_000,
            sessionFile: transcriptPath,
            model: "gpt-5.4",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const task = createTaskRecord({
      runtime: "acp",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      childSessionKey: "agent:coder:acp:child",
      originKind: "detached_session",
      originSessionKey: "agent:main:main",
      runId: "run-detached-1",
      label: "Continue detached work",
      task: "Continue detached work",
      status: "running",
      deliveryStatus: "pending",
      notifyPolicy: "state_changes",
      createdAt: Date.now() - 4 * 60_000,
      lastEventAt: Date.now() - 2 * 60_000,
    });
    createManagedTaskFlow({
      ownerKey: "agent:coder:acp:child",
      controllerId: "tests/tasks-show",
      goal: "Continue detached work",
      status: "waiting",
      currentStep: "await_user_input",
      createdAt: Date.now() - 4 * 60_000,
      updatedAt: Date.now() - 2 * 60_000,
    });

    const textRun = makeRuntime();
    await tasksShowCommand({ lookup: task.taskId, json: false }, textRun.runtime);
    const output = textRun.logs.join("\n");
    expect(output).toContain(`lookup: ${task.taskId}`);
    expect(output).toContain("resolvedBy: task_id");
    expect(output).toContain("sessionLifecycle: missing_transcript");
    expect(output).toContain("sessionLifecycleSummary: Transcript file is missing");
    expect(output).toContain("completionRouting: detached_delivery");
    expect(output).toContain("resumeTranscript: n/a");
    expect(output).toContain("resumeTranscriptExists: no");
    expect(output).toContain("reattachedAt: n/a");

    const jsonRun = makeRuntime();
    await tasksShowCommand({ lookup: task.taskId, json: true }, jsonRun.runtime);
    const payload = JSON.parse(jsonRun.logs[0] ?? "{}") as {
      lookup?: string;
      resolvedBy?: string | null;
      taskId?: string;
      sessionLifecycle?: {
        status: string;
        waitingFlowCount: number;
      } | null;
      sessionResume?: {
        sessionKey: string;
        sessionId?: string;
        transcriptPath: string | null;
        transcriptExists: boolean;
        completionRouting?: {
          mode: string;
        };
        continueWith: string;
      } | null;
      completionRouting?: {
        mode: string;
      };
    };

    expect(payload).toMatchObject({
      lookup: task.taskId,
      resolvedBy: "task_id",
      taskId: task.taskId,
      sessionLifecycle: {
        status: "missing_transcript",
        waitingFlowCount: 1,
      },
      completionRouting: {
        mode: "detached_delivery",
      },
      sessionResume: {
        sessionKey: "agent:coder:acp:child",
        transcriptPath: null,
        transcriptExists: false,
        completionRouting: {
          mode: "detached_delivery",
        },
        continueWith:
          'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
      },
    });
  });

  it("shows reattachedAt when the detached session was later resumed in foreground", async () => {
    const reattachedAt = Date.parse("2026-04-03T11:58:30Z");
    const task = createTaskRecord({
      runtime: "acp",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      childSessionKey: "agent:coder:acp:child-reattached",
      originKind: "detached_session",
      originSessionKey: "agent:main:main",
      runId: "run-detached-reattached",
      label: "Reattach detached work",
      task: "Reattach detached work",
      status: "running",
      deliveryStatus: "pending",
      notifyPolicy: "state_changes",
      reattachedAt,
    });

    const textRun = makeRuntime();
    await tasksShowCommand({ lookup: task.taskId, json: false }, textRun.runtime);
    expect(textRun.logs.join("\n")).toContain("completionRouting: foreground_reattached");
    expect(textRun.logs.join("\n")).toContain("reattachedAt: 2026-04-03T11:58:30.000Z");

    const jsonRun = makeRuntime();
    await tasksShowCommand({ lookup: task.taskId, json: true }, jsonRun.runtime);
    const payload = JSON.parse(jsonRun.logs[0] ?? "{}") as {
      reattachedAt?: number;
      completionRouting?: { mode?: string };
    };
    expect(payload.reattachedAt).toBe(reattachedAt);
    expect(payload.completionRouting?.mode).toBe("foreground_reattached");
  });

  it("classifies a run-id lookup in JSON output", async () => {
    const task = createTaskRecord({
      runtime: "acp",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      runId: "run-detached-2",
      label: "Lookup by run id",
      task: "Lookup by run id",
      status: "running",
      deliveryStatus: "pending",
      notifyPolicy: "state_changes",
      createdAt: Date.now() - 4 * 60_000,
      lastEventAt: Date.now() - 2 * 60_000,
    });

    const jsonRun = makeRuntime();
    await tasksShowCommand({ lookup: "run-detached-2", json: true }, jsonRun.runtime);
    const payload = JSON.parse(jsonRun.logs[0] ?? "{}") as {
      lookup?: string;
      resolvedBy?: string | null;
      taskId?: string;
    };

    expect(payload).toMatchObject({
      lookup: "run-detached-2",
      resolvedBy: "run_id",
      taskId: task.taskId,
    });
  });
});
