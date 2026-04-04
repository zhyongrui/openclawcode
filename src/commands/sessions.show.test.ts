import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import { configureTaskRegistryRuntime } from "../tasks/task-registry.store.js";
import { createManagedTaskFlow, resetTaskFlowRegistryForTests } from "../tasks/task-flow-runtime-internal.js";
import { createTaskRecord, resetTaskRegistryForTests } from "../tasks/task-registry.js";
import { makeRuntime, mockSessionsConfig } from "./sessions.test-helpers.js";

mockSessionsConfig();

import { sessionsShowCommand } from "./sessions.js";

describe("sessionsShowCommand", () => {
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

  it("shows one detached session with transcript, related tasks, TaskFlows, and resume metadata", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sessions-show-"));
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
            modelProvider: "openai-codex",
            model: "gpt-5.4",
            totalTokens: 3200,
            totalTokensFresh: true,
            acp: {
              backend: "codex",
              agent: "coder",
              runtimeSessionName: "child",
              mode: "persistent",
              state: "idle",
              lastActivityAt: Date.now() - 60_000,
              identity: {
                state: "resolved",
                source: "status",
                lastUpdatedAt: Date.now() - 60_000,
                agentSessionId: "inner-123",
              },
            },
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
      controllerId: "tests/sessions-show",
      goal: "Continue detached work",
      status: "waiting",
      currentStep: "await_user_input",
      createdAt: Date.now() - 4 * 60_000,
      updatedAt: Date.now() - 2 * 60_000,
    });

    const { runtime, logs } = makeRuntime();
    await sessionsShowCommand(
      {
        lookup: "sess-child-123",
        store,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(logs[0] ?? "{}") as {
      lookup: string;
      resolvedBy: string;
      agentId: string;
      lifecycle: {
        status: string;
        summary: string;
      };
      session: {
        key: string;
        sessionId: string;
        transcriptExists: boolean;
        transcriptPath: string;
        model: string;
      };
      relatedTaskCount: number;
      relatedTaskFlowCount: number;
      relatedTasks: Array<{ runId: string | null; originKind: string | null }>;
      relatedTaskFlows: Array<{ controllerId: string | null; status: string }>;
      resume?: {
        sessionKey: string;
        sessionId?: string;
        transcriptPath: string | null;
        transcriptExists: boolean;
        continueWith: string;
      } | null;
      resumeLines: string[];
    };

    expect(payload).toMatchObject({
      lookup: "sess-child-123",
      resolvedBy: "session_id",
      agentId: "coder",
      lifecycle: {
        status: "waiting_detached",
      },
      session: {
        key: "agent:coder:acp:child",
        sessionId: "sess-child-123",
        transcriptExists: true,
        transcriptPath,
        model: "gpt-5.4",
      },
      relatedTaskCount: 1,
      relatedTaskFlowCount: 1,
      relatedTasks: [
        {
          runId: "run-detached-1",
          originKind: "detached_session",
        },
      ],
      relatedTaskFlows: [
        {
          controllerId: "tests/sessions-show",
          status: "waiting",
        },
      ],
      resume: {
        sessionKey: "agent:coder:acp:child",
        sessionId: "sess-child-123",
        transcriptPath,
        transcriptExists: true,
        continueWith:
          'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
      },
    });
    expect(payload.resumeLines).toContain("resumeSessionKey: agent:coder:acp:child");
    expect(payload.resumeLines).toContain("resumeSessionId: sess-child-123");
    expect(payload.resumeLines).toContain(`resumeTranscript: ${transcriptPath}`);
    expect(payload.resumeLines).toContain("resumeTranscriptExists: yes");
    expect(payload.resumeLines).toContain(
      'continueWith: openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
    );
    expect(payload.resumeLines.some((line) => line.includes("openclaw agent --session-id"))).toBe(
      true,
    );
  });

  it("classifies a session with a missing transcript as missing_transcript", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sessions-show-missing-"));
    tempDirs.push(root);
    const store = path.join(root, "sessions.json");
    fs.writeFileSync(
      store,
      JSON.stringify(
        {
          "agent:main:main": {
            sessionId: "sess-missing-123",
            updatedAt: Date.now() - 5 * 60_000,
            sessionFile: path.join(root, "missing.jsonl"),
            abortedLastRun: true,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const { runtime, logs } = makeRuntime();
    await sessionsShowCommand(
      {
        lookup: "agent:main:main",
        store,
        json: true,
      },
      runtime,
    );

    const payload = JSON.parse(logs[0] ?? "{}") as {
      lifecycle: { status: string; summary: string };
      session: { transcriptExists: boolean };
    };

    expect(payload.session.transcriptExists).toBe(false);
    expect(payload.lifecycle.status).toBe("missing_transcript");
    expect(payload.lifecycle.summary).toContain("Transcript file is missing");
  });

  it("fails with candidate details when the session-id lookup is ambiguous", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sessions-show-ambiguous-"));
    tempDirs.push(root);
    const store = path.join(root, "sessions.json");
    fs.writeFileSync(
      store,
      JSON.stringify(
        {
          "agent:main:alpha": {
            sessionId: "dup-session",
            updatedAt: Date.now() - 5 * 60_000,
          },
          "agent:main:beta": {
            sessionId: "dup-session",
            updatedAt: Date.now() - 5 * 60_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const { runtime, errors } = makeRuntime();
    await expect(
      sessionsShowCommand(
        {
          lookup: "dup-session",
          store,
        },
        runtime,
      ),
    ).rejects.toThrow("exit 1");

    expect(errors[0]).toContain("Session lookup is ambiguous");
    expect(errors[1]).toContain("agent:main:alpha");
    expect(errors[2]).toContain("agent:main:beta");
  });
});
