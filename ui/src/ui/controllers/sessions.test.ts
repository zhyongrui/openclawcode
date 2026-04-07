import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteSessionsAndRefresh,
  loadSessionInspect,
  reattachSessionInspect,
  sendSessionInspectFollowup,
  subscribeSessions,
  type SessionsState,
} from "./sessions.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

if (!("window" in globalThis)) {
  Object.assign(globalThis, {
    window: {
      confirm: () => false,
    },
  });
}

function createState(request: RequestFn, overrides: Partial<SessionsState> = {}): SessionsState {
  return {
    client: { request } as unknown as SessionsState["client"],
    connected: true,
    sessionsLoading: false,
    sessionsResult: null,
    sessionsError: null,
    sessionsFilterActive: "0",
    sessionsFilterLimit: "0",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: true,
    sessionsInspectKey: null,
    sessionsInspectLoading: false,
    sessionsInspectResult: null,
    sessionsInspectError: null,
    sessionsInspectDraft: "",
    sessionsInspectActionLoading: false,
    sessionsInspectActionError: null,
    sessionsInspectActionStatus: null,
    sessionsExpandedCheckpointKey: null,
    sessionsCheckpointItemsByKey: {},
    sessionsCheckpointLoadingKey: null,
    sessionsCheckpointBusyKey: null,
    sessionsCheckpointErrorByKey: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("subscribeSessions", () => {
  it("registers for session change events", async () => {
    const request = vi.fn(async () => ({ subscribed: true }));
    const state = createState(request);

    await subscribeSessions(state);

    expect(request).toHaveBeenCalledWith("sessions.subscribe", {});
    expect(state.sessionsError).toBeNull();
  });
});

describe("deleteSessionsAndRefresh", () => {
  it("deletes multiple sessions and refreshes", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        return { ok: true };
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a", "key-b"]);

    expect(deleted).toEqual(["key-a", "key-b"]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(1, "sessions.delete", {
      key: "key-a",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.delete", {
      key: "key-b",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenNthCalledWith(3, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(state.sessionsLoading).toBe(false);
  });

  it("returns empty array when user cancels", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a"]);

    expect(deleted).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns partial results when some deletes fail", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "sessions.delete") {
        const p = params as { key: string };
        if (p.key === "key-b" || p.key === "key-c") {
          throw new Error(`delete failed: ${p.key}`);
        }
        return { ok: true };
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a", "key-b", "key-c", "key-d"]);

    expect(deleted).toEqual(["key-a", "key-d"]);
    expect(state.sessionsError).toBe("Error: delete failed: key-b; Error: delete failed: key-c");
    expect(state.sessionsLoading).toBe(false);
  });

  it("returns empty array when already loading", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request, { sessionsLoading: true });

    const deleted = await deleteSessionsAndRefresh(state, ["key-a"]);

    expect(deleted).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("session inspect flows", () => {
  it("loads session inspect detail", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.inspect") {
        return {
          key: "agent:main:main",
          row: { key: "agent:main:main", kind: "direct", updatedAt: 1 },
          transcript: {
            path: "/tmp/session.jsonl",
            exists: true,
            handoff: { mode: "detached_resume", summary: "ok" },
          },
          lifecycle: {
            status: "resumable",
            summary: "ready",
            resumeAvailable: true,
            activeTaskCount: 0,
            activeFlowCount: 0,
            waitingFlowCount: 0,
            blockedFlowCount: 0,
          },
          completionRouting: { mode: "detached_delivery", summary: "detached" },
          relatedTasks: [],
          relatedTaskFlows: [],
          resume: null,
          resumeLines: [],
          preview: { status: "ok", items: [] },
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);

    await loadSessionInspect(state, "agent:main:main");

    expect(request).toHaveBeenCalledWith("sessions.inspect", { key: "agent:main:main" });
    expect(state.sessionsInspectResult?.key).toBe("agent:main:main");
    expect(state.sessionsInspectLoading).toBe(false);
  });

  it("sends detached follow-up and refreshes inspect detail", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.send") {
        return { ok: true };
      }
      if (method === "sessions.inspect") {
        return {
          key: "agent:main:main",
          row: { key: "agent:main:main", kind: "direct", updatedAt: 1 },
          transcript: {
            path: "/tmp/session.jsonl",
            exists: true,
            handoff: { mode: "detached_resume", summary: "ok" },
          },
          lifecycle: {
            status: "resumable",
            summary: "ready",
            resumeAvailable: true,
            activeTaskCount: 0,
            activeFlowCount: 0,
            waitingFlowCount: 0,
            blockedFlowCount: 0,
          },
          completionRouting: { mode: "detached_delivery", summary: "detached" },
          relatedTasks: [],
          relatedTaskFlows: [],
          resume: null,
          resumeLines: [],
          preview: { status: "ok", items: [] },
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request, { sessionsInspectKey: "agent:main:main" });

    await sendSessionInspectFollowup(state, "agent:main:main", "");

    expect(request).toHaveBeenNthCalledWith(1, "sessions.send", {
      key: "agent:main:main",
      message: "Continue from the latest background task state.",
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.inspect", { key: "agent:main:main" });
    expect(state.sessionsInspectActionStatus).toBe("Detached follow-up sent.");
  });

  it("reattaches and stores the refreshed inspect snapshot", async () => {
    const inspect = {
      key: "agent:main:main",
      row: { key: "agent:main:main", kind: "direct", updatedAt: 1 },
      transcript: {
        path: "/tmp/session.jsonl",
        exists: true,
        handoff: { mode: "foreground_history", summary: "reattached" },
      },
      lifecycle: {
        status: "resumable",
        summary: "ready",
        resumeAvailable: true,
        activeTaskCount: 0,
        activeFlowCount: 0,
        waitingFlowCount: 0,
        blockedFlowCount: 0,
      },
      completionRouting: { mode: "foreground_reattached", summary: "foreground" },
      relatedTasks: [],
      relatedTaskFlows: [],
      resume: null,
      resumeLines: [],
      preview: { status: "ok", items: [] },
    };
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.reattach") {
        return {
          continuedSession: { key: "agent:main:main" },
          inspect,
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);

    const result = await reattachSessionInspect(state, "agent:main:main", "");

    expect(request).toHaveBeenCalledWith("sessions.reattach", {
      key: "agent:main:main",
      message: "Continue from the latest background task state.",
    });
    expect(result?.inspect?.completionRouting.mode).toBe("foreground_reattached");
    expect(state.sessionsInspectResult?.completionRouting.mode).toBe("foreground_reattached");
    expect(state.sessionsInspectActionStatus).toBe("Session reattached in foreground.");
  });
});
