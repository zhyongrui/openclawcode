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
    mocks.agentCliCommandMock.mockResolvedValue(undefined);
  });

  it("resolves by session id and forwards continue options to agentCliCommand", async () => {
    const store = writeStore({
      "agent:coder:acp:child": {
        sessionId: "sess-child-123",
        updatedAt: Date.now() - 5 * 60_000,
      },
    });

    try {
      const { runtime } = makeRuntime();
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
          json: true,
        }),
        runtime,
      );
      expect(mocks.agentCliCommandMock.mock.calls[0]?.[0]?.sessionKey).toBeUndefined();
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
        }),
        runtime,
      );
      expect(mocks.agentCliCommandMock.mock.calls[0]?.[0]?.sessionId).toBeUndefined();
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
});
