import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentCliCommandMock.mockResolvedValue({});
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
});
