import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSessionStoreTargetsMock: vi.fn(),
  loadSessionStoreMock: vi.fn(),
  resolveAcpThreadSessionDetailLinesMock: vi.fn(),
}));

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    resolveSessionStoreTargets: (...args: unknown[]) =>
      mocks.resolveSessionStoreTargetsMock(...args),
    loadSessionStore: (...args: unknown[]) => mocks.loadSessionStoreMock(...args),
  };
});

vi.mock("../acp/runtime/session-identifiers.js", () => ({
  resolveAcpThreadSessionDetailLines: (...args: unknown[]) =>
    mocks.resolveAcpThreadSessionDetailLinesMock(...args),
}));

import {
  describeBackgroundChildSessions,
  describeBackgroundSessionResume,
  formatBackgroundChildSessionGroupLines,
  formatBackgroundSessionResumeLines,
} from "./background-session-resume.js";

describe("background session resume helpers", () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-bg-resume-"));
    transcriptPath = path.join(tempDir, "sess-child-123.jsonl");
    fs.writeFileSync(transcriptPath, '{"type":"message"}\n', "utf8");
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
            sessionFile: transcriptPath,
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

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
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
      `resumeTranscript: ${transcriptPath}`,
      "resumeTranscriptExists: yes",
      "transcriptHandoff: detached_resume",
      "transcriptHandoffSummary: Transcript remains the live detached handoff and can still be used for direct resume or recovery.",
      "completionRouting: detached_delivery",
      "completionRoutingSummary: Detached completion will still be delivered or queued back to the owner session.",
      'continueWith: openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
      'reattachWith: openclaw sessions reattach agent:coder:acp:child --message "Continue from the latest background task state."',
      'resumeWith: openclaw agent --session-id sess-child-123 --message "Continue from the latest background task state."',
      "agent session id: inner-123",
      "resume in Codex CLI: `codex resume inner-123` (continues this conversation).",
    ]);
  });

  it("describes structured background session resume details", () => {
    const detail = describeBackgroundSessionResume({
      cfg: {} as never,
      sessionKey: "agent:coder:acp:child",
    });

    expect(detail).toEqual({
      sessionKey: "agent:coder:acp:child",
      sessionId: "sess-child-123",
      agentId: "coder",
      transcriptPath,
      transcriptExists: true,
      transcriptHandoff: {
        mode: "detached_resume",
        summary:
          "Transcript remains the live detached handoff and can still be used for direct resume or recovery.",
      },
      completionRouting: {
        mode: "detached_delivery",
        summary: "Detached completion will still be delivered or queued back to the owner session.",
      },
      continueWith:
        'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
      reattachWith:
        'openclaw sessions reattach agent:coder:acp:child --message "Continue from the latest background task state."',
      resumeWith:
        'openclaw agent --session-id sess-child-123 --message "Continue from the latest background task state."',
      acpDetailLines: [
        "agent session id: inner-123",
        "resume in Codex CLI: `codex resume inner-123` (continues this conversation).",
      ],
    });
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
      `  resumeTranscript: ${transcriptPath}`,
      "  resumeTranscriptExists: yes",
      "  transcriptHandoff: detached_resume",
      "  transcriptHandoffSummary: Transcript remains the live detached handoff and can still be used for direct resume or recovery.",
      "  completionRouting: detached_delivery",
      "  completionRoutingSummary: Detached completion will still be delivered or queued back to the owner session.",
      '  continueWith: openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
      '  reattachWith: openclaw sessions reattach agent:coder:acp:child --message "Continue from the latest background task state."',
      '  resumeWith: openclaw agent --session-id sess-child-123 --message "Continue from the latest background task state."',
      "  agent session id: inner-123",
      "  resume in Codex CLI: `codex resume inner-123` (continues this conversation).",
      "- agent:main:missing",
      "  resumeAgent: main",
      "  resumeTranscript: n/a",
      "  resumeTranscriptExists: no",
      "  transcriptHandoff: missing",
      "  transcriptHandoffSummary: Detached transcript snapshot is missing; direct transcript recovery is unavailable.",
      "  completionRouting: detached_delivery",
      "  completionRoutingSummary: Detached completion will still be delivered or queued back to the owner session.",
      '  continueWith: openclaw sessions continue agent:main:missing --message "Continue from the latest background task state."',
      '  reattachWith: openclaw sessions reattach agent:main:missing --message "Continue from the latest background task state."',
      '  resumeWith: openclaw agent --session-key agent:main:missing --message "Continue from the latest background task state."',
    ]);
  });

  it("describes grouped child sessions as structured resume details", () => {
    const childSessions = describeBackgroundChildSessions({
      cfg: {} as never,
      sessionKeys: [
        "agent:coder:acp:child",
        "agent:coder:acp:child",
        "agent:main:missing",
      ],
    });

    expect(childSessions).toEqual([
      {
        sessionKey: "agent:coder:acp:child",
        sessionId: "sess-child-123",
        agentId: "coder",
        transcriptPath,
        transcriptExists: true,
        transcriptHandoff: {
          mode: "detached_resume",
          summary:
            "Transcript remains the live detached handoff and can still be used for direct resume or recovery.",
        },
        completionRouting: {
          mode: "detached_delivery",
          summary:
            "Detached completion will still be delivered or queued back to the owner session.",
        },
        continueWith:
          'openclaw sessions continue agent:coder:acp:child --message "Continue from the latest background task state."',
        reattachWith:
          'openclaw sessions reattach agent:coder:acp:child --message "Continue from the latest background task state."',
        resumeWith:
          'openclaw agent --session-id sess-child-123 --message "Continue from the latest background task state."',
        acpDetailLines: [
          "agent session id: inner-123",
          "resume in Codex CLI: `codex resume inner-123` (continues this conversation).",
        ],
      },
      {
        sessionKey: "agent:main:missing",
        agentId: "main",
        transcriptPath: null,
        transcriptExists: false,
        transcriptHandoff: {
          mode: "missing",
          summary:
            "Detached transcript snapshot is missing; direct transcript recovery is unavailable.",
        },
        completionRouting: {
          mode: "detached_delivery",
          summary:
            "Detached completion will still be delivered or queued back to the owner session.",
        },
        continueWith:
          'openclaw sessions continue agent:main:missing --message "Continue from the latest background task state."',
        reattachWith:
          'openclaw sessions reattach agent:main:missing --message "Continue from the latest background task state."',
        resumeWith:
          'openclaw agent --session-key agent:main:missing --message "Continue from the latest background task state."',
        acpDetailLines: [],
      },
    ]);
  });

  it("renders foreground reattach completion routing when provided", () => {
    const lines = formatBackgroundSessionResumeLines({
      cfg: {} as never,
      sessionKey: "agent:coder:acp:child",
      completionRouting: {
        mode: "foreground_reattached",
        summary:
          "Detached completion stays with the foreground reattached session instead of detached delivery.",
        reattachedAt: Date.parse("2026-04-05T03:00:00Z"),
      },
    });

    expect(lines).toContain("completionRouting: foreground_reattached");
    expect(lines).toContain("transcriptHandoff: foreground_history");
    expect(lines).toContain(
      "transcriptHandoffSummary: Transcript remains available as detached history, but live continuation now belongs to the foreground reattached session.",
    );
    expect(lines).toContain(
      "completionRoutingSummary: Detached completion stays with the foreground reattached session instead of detached delivery.",
    );
    expect(lines).toContain("completionRoutingAt: 2026-04-05T03:00:00.000Z");
    expect(lines).toContain(
      'reattachWith: openclaw sessions reattach agent:coder:acp:child --message "Continue from the latest background task state."',
    );
  });

  it("surfaces missing transcript semantics after foreground reattach", () => {
    const detail = describeBackgroundSessionResume({
      cfg: {} as never,
      sessionKey: "agent:main:missing",
      completionRouting: {
        mode: "foreground_reattached",
        summary:
          "Detached completion stays with the foreground reattached session instead of detached delivery.",
        reattachedAt: Date.parse("2026-04-05T03:00:00Z"),
      },
    });

    expect(detail?.transcriptHandoff).toEqual({
      mode: "missing",
      summary:
        "Detached transcript snapshot is missing; live continuation now belongs to the foreground reattached session.",
    });
  });
});
