import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
  randomIdempotencyKey: () => "idem-1",
}));
vi.mock("./agent.js", () => ({
  agentCommand: vi.fn(),
}));

import type { OpenClawConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentCliCommand } from "./agent-via-gateway.js";
import { agentCommand } from "./agent.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const configSpy = vi.spyOn(configModule, "loadConfig");

function mockConfig(storePath: string, overrides?: Partial<OpenClawConfig>) {
  configSpy.mockReturnValue({
    agents: {
      defaults: {
        timeoutSeconds: 600,
        ...overrides?.agents?.defaults,
      },
    },
    session: {
      store: storePath,
      mainKey: "main",
      ...overrides?.session,
    },
    gateway: overrides?.gateway,
  });
}

async function withTempStore(
  fn: (ctx: { dir: string; store: string }) => Promise<void>,
  overrides?: Partial<OpenClawConfig>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
  const store = path.join(dir, "sessions.json");
  mockConfig(store, overrides);
  try {
    await fn({ dir, store });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mockGatewaySuccessReply(text = "hello") {
  vi.mocked(callGateway).mockResolvedValue({
    runId: "idem-1",
    status: "ok",
    result: {
      payloads: [{ text }],
      meta: { stub: true },
    },
  });
}

function mockLocalAgentReply(text = "local") {
  vi.mocked(agentCommand).mockImplementationOnce(async (_opts, rt) => {
    rt?.log?.(text);
    return {
      payloads: [{ text }],
      meta: { durationMs: 1, agentMeta: { sessionId: "s", provider: "p", model: "m" } },
    } as unknown as Awaited<ReturnType<typeof agentCommand>>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentCliCommand", () => {
  it("uses a timer-safe max gateway timeout when --timeout is 0", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      await agentCliCommand({ message: "hi", to: "+1555", timeout: "0" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      const request = vi.mocked(callGateway).mock.calls[0]?.[0] as { timeoutMs?: number };
      expect(request.timeoutMs).toBe(2_147_000_000);
    });
  });

  it("uses gateway by default", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.log).toHaveBeenCalledWith("hello");
    });
  });

  it("returns immediately in background mode and prints wait/continue/resume hints", async () => {
    await withTempStore(async ({ dir, store }) => {
      const transcriptPath = path.join(dir, "sess-bg-1.jsonl");
      fs.writeFileSync(transcriptPath, '{"type":"message"}\n', "utf8");
      fs.writeFileSync(
        store,
        JSON.stringify(
          {
            "agent:main:main": {
              sessionId: "sess-bg-1",
              updatedAt: 1,
              sessionFile: transcriptPath,
            },
          },
          null,
          2,
        ),
      );
      vi.mocked(callGateway).mockResolvedValue({
        runId: "run-bg-1",
        status: "accepted",
        acceptedAt: 1,
        sessionId: "sess-bg-1",
        sessionKey: "agent:main:main",
      });

      await agentCliCommand({ message: "hi", to: "+1555", background: true }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(vi.mocked(callGateway).mock.calls[0]?.[0]).toMatchObject({
        expectFinal: false,
      });
      expect(runtime.log).toHaveBeenCalledWith("Accepted background agent run.");
      expect(runtime.log).toHaveBeenCalledWith("runId: run-bg-1");
      expect(runtime.log).toHaveBeenCalledWith("sessionId: sess-bg-1");
      expect(runtime.log).toHaveBeenCalledWith("agent: main");
      expect(runtime.log).toHaveBeenCalledWith(`transcript: ${transcriptPath}`);
      expect(runtime.log).toHaveBeenCalledWith("transcriptExists: yes");
      expect(runtime.log).toHaveBeenCalledWith(
        'continue: openclaw sessions continue agent:main:main --message "Continue from the latest background task state."',
      );
      expect(runtime.log).toHaveBeenCalledWith(
        'resume: openclaw agent --session-id sess-bg-1 --message "Continue from the latest background task state."',
      );
    });
  });

  it("falls back to session id for continue hints when no session key is available", async () => {
    await withTempStore(async () => {
      vi.mocked(callGateway).mockResolvedValue({
        runId: "run-bg-2",
        status: "accepted",
        acceptedAt: 1,
        sessionId: "sess-bg-2",
      });

      await agentCliCommand({ message: "hi", sessionId: "sess-bg-2", background: true }, runtime);

      expect(runtime.log).toHaveBeenCalledWith(
        'continue: openclaw sessions continue sess-bg-2 --message "Continue from the latest background task state."',
      );
      expect(runtime.log).toHaveBeenCalledWith(
        'resume: openclaw agent --session-id sess-bg-2 --message "Continue from the latest background task state."',
      );
    });
  });

  it("adds structured handoff hints to background JSON output", async () => {
    await withTempStore(async ({ dir, store }) => {
      fs.writeFileSync(
        store,
        JSON.stringify(
          {
            "agent:main:main": {
              sessionId: "sess-bg-json-1",
              updatedAt: 1,
              sessionFile: "/tmp/openclaw-bg-json-1.jsonl",
            },
          },
          null,
          2,
        ),
      );
      vi.mocked(callGateway).mockResolvedValue({
        runId: "run-bg-json-1",
        status: "accepted",
        acceptedAt: 1,
        sessionId: "sess-bg-json-1",
        sessionKey: "agent:main:main",
      });

      await agentCliCommand({ message: "hi", to: "+1555", background: true, json: true }, runtime);

      expect(runtime.log).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
        runId?: string;
        sessionId?: string;
        sessionKey?: string;
        handoff?: {
          runId?: string;
          sessionId?: string;
          sessionKey?: string;
          agentId?: string;
          transcriptPath?: string | null;
          transcriptExists?: boolean;
          waitWith?: string;
          continueWith?: string;
          resumeWith?: string;
          resume?: {
            sessionKey: string;
            sessionId?: string;
            agentId?: string;
            transcriptPath: string | null;
            transcriptExists: boolean;
            continueWith: string;
            resumeWith: string;
          };
        };
      };

      expect(payload).toMatchObject({
        runId: "run-bg-json-1",
        sessionId: "sess-bg-json-1",
        sessionKey: "agent:main:main",
        handoff: {
          runId: "run-bg-json-1",
          sessionId: "sess-bg-json-1",
          sessionKey: "agent:main:main",
          agentId: "main",
          transcriptPath: path.join(dir, "sess-bg-json-1.jsonl"),
          transcriptExists: false,
          waitWith: "openclaw gateway call agent.wait --run-id run-bg-json-1",
          continueWith:
            'openclaw sessions continue agent:main:main --message "Continue from the latest background task state."',
          resumeWith:
            'openclaw agent --session-id sess-bg-json-1 --message "Continue from the latest background task state."',
          resume: {
            sessionKey: "agent:main:main",
            sessionId: "sess-bg-json-1",
            agentId: "main",
            transcriptPath: path.join(dir, "sess-bg-json-1.jsonl"),
            transcriptExists: false,
            continueWith:
              'openclaw sessions continue agent:main:main --message "Continue from the latest background task state."',
            resumeWith:
              'openclaw agent --session-id sess-bg-json-1 --message "Continue from the latest background task state."',
          },
        },
      });
    });
  });

  it("falls back to embedded agent when gateway fails", async () => {
    await withTempStore(async () => {
      vi.mocked(callGateway).mockRejectedValue(new Error("gateway not connected"));
      mockLocalAgentReply();

      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
    });
  });

  it("does not fall back to embedded agent for background mode", async () => {
    await withTempStore(async () => {
      vi.mocked(callGateway).mockRejectedValue(new Error("gateway not connected"));

      await expect(
        agentCliCommand({ message: "hi", to: "+1555", background: true }, runtime),
      ).rejects.toThrow("gateway not connected");

      expect(agentCommand).not.toHaveBeenCalled();
    });
  });

  it("skips gateway when --local is set", async () => {
    await withTempStore(async () => {
      mockLocalAgentReply();

      await agentCliCommand(
        {
          message: "hi",
          to: "+1555",
          local: true,
        },
        runtime,
      );

      expect(callGateway).not.toHaveBeenCalled();
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(vi.mocked(agentCommand).mock.calls[0]?.[0]).toMatchObject({
        cleanupBundleMcpOnRunEnd: true,
      });
      expect(runtime.log).toHaveBeenCalledWith("local");
    });
  });

  it("does not force bundle MCP cleanup on gateway fallback", async () => {
    await withTempStore(async () => {
      vi.mocked(callGateway).mockRejectedValue(new Error("gateway not connected"));
      mockLocalAgentReply();

      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(vi.mocked(agentCommand).mock.calls[0]?.[0]).not.toMatchObject({
        cleanupBundleMcpOnRunEnd: true,
      });
    });
  });

  it("supports explicit session keys", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      await agentCliCommand({ message: "hi", sessionKey: "agent:main:main" }, runtime);

      expect(callGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            sessionKey: "agent:main:main",
          }),
        }),
      );
    });
  });

  it("rejects local background mode", async () => {
    await withTempStore(async () => {
      await expect(
        agentCliCommand({ message: "hi", to: "+1555", local: true, background: true }, runtime),
      ).rejects.toThrow("--background is only supported when using the gateway");
    });
  });
});
