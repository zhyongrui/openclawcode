import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn(),
  AzureOpenAI: vi.fn(),
}));

import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import { configureTaskRegistryRuntime } from "../tasks/task-registry.store.js";
import { createManagedTaskFlow, resetTaskFlowRegistryForTests } from "../tasks/task-flow-runtime-internal.js";
import { resetTaskRegistryForTests } from "../tasks/task-registry.js";
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

import { flowsListCommand } from "./flows.js";

describe("flowsListCommand detached session lifecycle", () => {
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-flows-list-lifecycle-"));
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

    createManagedTaskFlow({
      ownerKey: "agent:coder:acp:child",
      controllerId: "tests/flows-list",
      goal: "Continue detached work",
      status: "waiting",
      currentStep: "await_user_input",
      createdAt: Date.now() - 4 * 60_000,
      updatedAt: Date.now() - 2 * 60_000,
    });

    const textRun = makeRuntime();
    await flowsListCommand({}, textRun.runtime);
    const flowRow = textRun.logs.find((line) => line.includes("Continue detached work")) ?? "";
    expect(flowRow).toContain("missing-xcript");

    const jsonRun = makeRuntime();
    await flowsListCommand({ json: true }, jsonRun.runtime);
    const payload = JSON.parse(jsonRun.logs[0] ?? "{}") as {
      flows?: Array<{
        goal: string;
        detachedLifecycle?: {
          status: string;
          waitingFlowCount: number;
        } | null;
        sessionResume?: {
          sessionKey: string;
          transcriptPath: string | null;
          transcriptExists: boolean;
          transcriptHandoff?: {
            mode: string;
          };
          continueWith: string;
        } | null;
      }>;
    };

    expect(payload.flows?.[0]).toMatchObject({
      goal: "Continue detached work",
      detachedLifecycle: {
        status: "missing_transcript",
        waitingFlowCount: 1,
      },
      sessionResume: {
        sessionKey: "agent:coder:acp:child",
        transcriptPath: null,
        transcriptExists: false,
        transcriptHandoff: {
          mode: "missing",
        },
        continueWith:
          'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
      },
    });
  });
});
