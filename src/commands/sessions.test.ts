import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import { configureTaskRegistryRuntime } from "../tasks/task-registry.store.js";
import { createManagedTaskFlow, resetTaskFlowRegistryForTests } from "../tasks/task-flow-runtime-internal.js";
import { createTaskRecord, resetTaskRegistryForTests } from "../tasks/task-registry.js";
import {
  makeRuntime,
  mockSessionsConfig,
  runSessionsJson,
  writeStore,
} from "./sessions.test-helpers.js";

// Disable colors for deterministic snapshots.
process.env.FORCE_COLOR = "0";

mockSessionsConfig();

import { sessionsCommand } from "./sessions.js";

describe("sessionsCommand", () => {
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
    vi.setSystemTime(new Date("2025-12-06T00:00:00Z"));
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

  it("renders a tabular view with token percentages", async () => {
    const store = writeStore({
      "+15555550123": {
        sessionId: "abc123",
        updatedAt: Date.now() - 45 * 60_000,
        inputTokens: 1200,
        outputTokens: 800,
        totalTokens: 2000,
        totalTokensFresh: true,
        model: "pi:opus",
      },
    });

    const { runtime, logs } = makeRuntime();
    await sessionsCommand({ store }, runtime);

    fs.rmSync(store);

    const tableHeader = logs.find((line) => line.includes("Tokens (ctx %"));
    expect(tableHeader).toBeTruthy();

    const row = logs.find((line) => line.includes("+15555550123")) ?? "";
    expect(row).toContain("2.0k/32k (6%)");
    expect(row).toContain("45m ago");
    expect(row).toContain("pi:opus");
  });

  it("shows placeholder rows when tokens are missing", async () => {
    const store = writeStore({
      "discord:group:demo": {
        sessionId: "xyz",
        updatedAt: Date.now() - 5 * 60_000,
        thinkingLevel: "high",
      },
    });

    const { runtime, logs } = makeRuntime();
    await sessionsCommand({ store }, runtime);

    fs.rmSync(store);

    const row = logs.find((line) => line.includes("discord:group:demo")) ?? "";
    expect(row).toContain("unknown/32k (?%)");
    expect(row).toContain("think:high");
    expect(row).toContain("5m ago");
  });

  it("exports freshness metadata in JSON output", async () => {
    const store = writeStore({
      main: {
        sessionId: "abc123",
        updatedAt: Date.now() - 10 * 60_000,
        inputTokens: 1200,
        outputTokens: 800,
        totalTokens: 2000,
        totalTokensFresh: true,
        model: "pi:opus",
      },
      "discord:group:demo": {
        sessionId: "xyz",
        updatedAt: Date.now() - 5 * 60_000,
        inputTokens: 20,
        outputTokens: 10,
        model: "pi:opus",
      },
    });

    const payload = await runSessionsJson<{
      sessions?: Array<{
        key: string;
        totalTokens: number | null;
        totalTokensFresh: boolean;
      }>;
    }>(sessionsCommand, store);
    const main = payload.sessions?.find((row) => row.key === "main");
    const group = payload.sessions?.find((row) => row.key === "discord:group:demo");
    expect(main?.totalTokens).toBe(2000);
    expect(main?.totalTokensFresh).toBe(true);
    expect(group?.totalTokens).toBeNull();
    expect(group?.totalTokensFresh).toBe(false);
  });

  it("shows lifecycle state in table and JSON output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sessions-list-"));
    tempDirs.push(root);
    const store = path.join(root, "sessions.json");
    const transcriptPath = path.join(root, "sess-child-123.jsonl");
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
      controllerId: "tests/sessions-list",
      goal: "Continue detached work",
      status: "waiting",
      currentStep: "await_user_input",
      createdAt: Date.now() - 4 * 60_000,
      updatedAt: Date.now() - 2 * 60_000,
    });

    const { runtime, logs } = makeRuntime();
    await sessionsCommand({ store }, runtime);
    const row = logs.find((line) => line.includes("agent:coder:acp:child")) ?? "";
    expect(row).toContain("waiting");

    const payload = await runSessionsJson<{
      sessions?: Array<{
        key: string;
        transcriptExists: boolean;
        lifecycle: { status: string; waitingFlowCount: number };
      }>;
    }>(sessionsCommand, store);
    expect(payload.sessions?.[0]).toMatchObject({
      key: "agent:coder:acp:child",
      transcriptExists: true,
      lifecycle: {
        status: "waiting_detached",
        waitingFlowCount: 1,
      },
    });
  });

  it("applies --active filtering in JSON output", async () => {
    const store = writeStore(
      {
        recent: {
          sessionId: "recent",
          updatedAt: Date.now() - 5 * 60_000,
          model: "pi:opus",
        },
        stale: {
          sessionId: "stale",
          updatedAt: Date.now() - 45 * 60_000,
          model: "pi:opus",
        },
      },
      "sessions-active",
    );

    const payload = await runSessionsJson<{
      sessions?: Array<{
        key: string;
      }>;
    }>(sessionsCommand, store, { active: "10" });
    expect(payload.sessions?.map((row) => row.key)).toEqual(["recent"]);
  });

  it("rejects invalid --active values", async () => {
    const store = writeStore(
      {
        demo: {
          sessionId: "demo",
          updatedAt: Date.now() - 5 * 60_000,
        },
      },
      "sessions-active-invalid",
    );
    const { runtime, errors } = makeRuntime();

    await expect(sessionsCommand({ store, active: "0" }, runtime)).rejects.toThrow("exit 1");
    expect(errors[0]).toContain("--active must be a positive integer");

    fs.rmSync(store);
  });
});
