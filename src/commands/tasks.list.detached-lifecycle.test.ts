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

import { tasksListCommand } from "./tasks.js";

describe("tasksListCommand detached session lifecycle", () => {
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-tasks-list-lifecycle-"));
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

    createTaskRecord({
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
      controllerId: "tests/tasks-list",
      goal: "Continue detached work",
      status: "waiting",
      currentStep: "await_user_input",
      createdAt: Date.now() - 4 * 60_000,
      updatedAt: Date.now() - 2 * 60_000,
    });

    const textRun = makeRuntime();
    await tasksListCommand({}, textRun.runtime);
    const taskRow = textRun.logs.find((line) => line.includes("Continue detached work")) ?? "";
    expect(taskRow).toContain("missing-xcript");

    const jsonRun = makeRuntime();
    await tasksListCommand({ json: true }, jsonRun.runtime);
    const payload = JSON.parse(jsonRun.logs[0] ?? "{}") as {
      tasks?: Array<{
        runId?: string;
        sessionLifecycle?: {
          status: string;
          waitingFlowCount: number;
        } | null;
        sessionResume?: {
          sessionKey: string;
          transcriptPath: string | null;
          transcriptExists: boolean;
          continueWith: string;
        } | null;
      }>;
    };

    expect(payload.tasks?.[0]).toMatchObject({
      runId: "run-detached-1",
      sessionLifecycle: {
        status: "missing_transcript",
        waitingFlowCount: 1,
      },
      sessionResume: {
        sessionKey: "agent:coder:acp:child",
        transcriptPath: null,
        transcriptExists: false,
        continueWith:
          'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
      },
    });
  });
});
