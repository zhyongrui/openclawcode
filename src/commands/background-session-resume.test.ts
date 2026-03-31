import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSessionStoreTargetsMock: vi.fn(),
  loadSessionStoreMock: vi.fn(),
  resolveAcpThreadSessionDetailLinesMock: vi.fn(),
}));

vi.mock("../config/sessions.js", () => ({
  resolveSessionStoreTargets: (...args: unknown[]) => mocks.resolveSessionStoreTargetsMock(...args),
  loadSessionStore: (...args: unknown[]) => mocks.loadSessionStoreMock(...args),
}));

vi.mock("../acp/runtime/session-identifiers.js", () => ({
  resolveAcpThreadSessionDetailLines: (...args: unknown[]) =>
    mocks.resolveAcpThreadSessionDetailLinesMock(...args),
}));

import {
  formatBackgroundChildSessionGroupLines,
  formatBackgroundSessionResumeLines,
} from "./background-session-resume.js";

describe("background session resume helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSessionStoreTargetsMock.mockReturnValue([
      { agentId: "main", storePath: "/tmp/main.json" },
      { agentId: "coder", storePath: "/tmp/coder.json" },
    ]);
    mocks.loadSessionStoreMock.mockImplementation((storePath: string) => {
      if (storePath === "/tmp/coder.json") {
        return {
          "agent:coder:acp:child": {
            sessionId: "sess-child-123",
            updatedAt: 1,
            acp: {
              backend: "codex",
              agent: "codex",
              runtimeSessionName: "child",
              mode: "persistent",
              state: "idle",
              lastActivityAt: 1,
              identity: {
                state: "resolved",
                source: "status",
                lastUpdatedAt: 1,
                agentSessionId: "inner-123",
              },
            },
          },
        };
      }
      return {};
    });
    mocks.resolveAcpThreadSessionDetailLinesMock.mockReturnValue([
      "agent session id: inner-123",
      "resume in Codex CLI: `codex resume inner-123` (continues this conversation).",
    ]);
  });

  it("formats direct resume lines from a persisted child session", () => {
    const lines = formatBackgroundSessionResumeLines({
      cfg: {} as never,
      sessionKey: "agent:coder:acp:child",
    });

    expect(lines).toEqual([
      "resumeSessionKey: agent:coder:acp:child",
      "resumeSessionId: sess-child-123",
      "resumeAgent: coder",
      'resumeWith: openclaw agent --session-id sess-child-123 --message "Continue from the latest background task state."',
      "agent session id: inner-123",
      "resume in Codex CLI: `codex resume inner-123` (continues this conversation).",
    ]);
  });

  it("falls back to session-key resume commands and dedupes grouped child sessions", () => {
    const lines = formatBackgroundChildSessionGroupLines({
      cfg: {} as never,
      sessionKeys: [
        "agent:coder:acp:child",
        "agent:coder:acp:child",
        "agent:main:missing",
        undefined,
        "",
      ],
    });

    expect(lines).toEqual([
      "Child sessions:",
      "- agent:coder:acp:child",
      "  resumeSessionId: sess-child-123",
      "  resumeAgent: coder",
      '  resumeWith: openclaw agent --session-id sess-child-123 --message "Continue from the latest background task state."',
      "  agent session id: inner-123",
      "  resume in Codex CLI: `codex resume inner-123` (continues this conversation).",
      "- agent:main:missing",
      '  resumeWith: openclaw agent --session-key agent:main:missing --message "Continue from the latest background task state."',
    ]);
  });
});
