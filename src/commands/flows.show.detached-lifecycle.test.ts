import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import { createRunningTaskRun } from "../tasks/task-executor.js";
import { configureTaskRegistryRuntime } from "../tasks/task-registry.store.js";
import { createManagedTaskFlow, resetTaskFlowRegistryForTests } from "../tasks/task-flow-runtime-internal.js";
import {
  resetTaskRegistryDeliveryRuntimeForTests,
  resetTaskRegistryForTests,
} from "../tasks/task-registry.js";
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

import { flowsShowCommand } from "./flows.js";

describe("flowsShowCommand detached session lifecycle", () => {
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
    resetTaskRegistryDeliveryRuntimeForTests();
    resetTaskRegistryForTests({ persist: false });
    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskRegistryRuntime({ store: taskStore });
    configureTaskFlowRegistryRuntime({ store: flowStore });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTaskRegistryDeliveryRuntimeForTests();
    resetTaskRegistryForTests({ persist: false });
    resetTaskFlowRegistryForTests({ persist: false });
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows detached session lifecycle in text and JSON output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-flows-show-lifecycle-"));
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

    const flow = createManagedTaskFlow({
      ownerKey: "agent:coder:acp:child",
      controllerId: "tests/flows-show",
      goal: "Continue detached work",
      status: "waiting",
      currentStep: "await_user_input",
      createdAt: Date.now() - 4 * 60_000,
      updatedAt: Date.now() - 2 * 60_000,
    });
    createRunningTaskRun({
      runtime: "acp",
      ownerKey: "agent:coder:acp:child",
      scopeKind: "session",
      parentFlowId: flow.flowId,
      childSessionKey: "agent:coder:acp:child",
      runId: "run-child-1",
      label: "Continue detached work",
      task: "Continue detached work",
      startedAt: Date.now() - 4 * 60_000,
      lastEventAt: Date.now() - 2 * 60_000,
    });

    const textRun = makeRuntime();
    await flowsShowCommand({ lookup: flow.flowId, json: false }, textRun.runtime);
    const output = textRun.logs.join("\n");
    expect(output).toContain(`lookup: ${flow.flowId}`);
    expect(output).toContain("resolvedBy: flow_id");
    expect(output).toContain("sessionLifecycle: missing_transcript");
    expect(output).toContain("sessionLifecycleSummary: Transcript file is missing");
    expect(output).toContain("Child sessions:");
    expect(output).toContain("resumeTranscript: n/a");
    expect(output).toContain("resumeTranscriptExists: no");
    expect(output).toContain("continueWith: openclaw sessions continue agent:coder:acp:child");
    expect(output).toContain("reattachedAt: n/a");

    const jsonRun = makeRuntime();
    await flowsShowCommand({ lookup: flow.flowId, json: true }, jsonRun.runtime);
    const payload = JSON.parse(jsonRun.logs[0] ?? "{}") as {
      lookup?: string;
      resolvedBy?: string | null;
      flowId?: string;
      detachedLifecycle?: {
        status: string;
        waitingFlowCount: number;
      } | null;
      childSessions?: Array<{
        sessionKey: string;
        sessionId?: string;
        transcriptPath: string | null;
        transcriptExists: boolean;
        continueWith: string;
      }>;
    };

    expect(payload).toMatchObject({
      lookup: flow.flowId,
      resolvedBy: "flow_id",
      flowId: flow.flowId,
      detachedLifecycle: {
        status: "missing_transcript",
        waitingFlowCount: 1,
      },
      childSessions: [
        {
          sessionKey: "agent:coder:acp:child",
          transcriptPath: null,
          transcriptExists: false,
          continueWith:
            'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
        },
      ],
    });
  });

  it("shows reattachedAt when the detached flow was later resumed in foreground", async () => {
    const reattachedAt = Date.parse("2026-04-03T11:58:30Z");
    const flow = createManagedTaskFlow({
      ownerKey: "agent:coder:acp:owner-reattached",
      controllerId: "tests/flows-show",
      goal: "Continue detached work",
      status: "waiting",
      reattachedAt,
    });

    const textRun = makeRuntime();
    await flowsShowCommand({ lookup: flow.flowId, json: false }, textRun.runtime);
    expect(textRun.logs.join("\n")).toContain("reattachedAt: 2026-04-03T11:58:30.000Z");

    const jsonRun = makeRuntime();
    await flowsShowCommand({ lookup: flow.flowId, json: true }, jsonRun.runtime);
    const payload = JSON.parse(jsonRun.logs[0] ?? "{}") as { reattachedAt?: number };
    expect(payload.reattachedAt).toBe(reattachedAt);
  });

  it("classifies an owner-key lookup in JSON output", async () => {
    const flow = createManagedTaskFlow({
      ownerKey: "agent:coder:acp:owner-lookup",
      controllerId: "tests/flows-show",
      goal: "Lookup by owner key",
      status: "waiting",
      createdAt: Date.now() - 4 * 60_000,
      updatedAt: Date.now() - 2 * 60_000,
    });

    const jsonRun = makeRuntime();
    await flowsShowCommand({ lookup: "agent:coder:acp:owner-lookup", json: true }, jsonRun.runtime);
    const payload = JSON.parse(jsonRun.logs[0] ?? "{}") as {
      lookup?: string;
      resolvedBy?: string | null;
      flowId?: string;
    };

    expect(payload).toMatchObject({
      lookup: "agent:coder:acp:owner-lookup",
      resolvedBy: "owner_key",
      flowId: flow.flowId,
    });
  });
});
