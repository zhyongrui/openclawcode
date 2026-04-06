import { beforeEach, describe, expect, it, vi } from "vitest";

const buildGatewaySessionRowMock = vi.fn();
const loadSessionEntryMock = vi.fn();
const readSessionPreviewItemsFromTranscriptMock = vi.fn();
const readSessionMessagesMock = vi.fn(() => []);
const resolveGatewaySessionStoreTargetMock = vi.fn();
const inspectDetachedSessionLifecycleMock = vi.fn();
const resolveSessionTranscriptStateMock = vi.fn();
const buildSessionLifecycleAssessmentMock = vi.fn();
const buildBackgroundSessionCompletionRoutingMock = vi.fn();
const buildBackgroundSessionTranscriptHandoffMock = vi.fn();
const formatBackgroundSessionResumeLinesMock = vi.fn();
const markTasksReattachedForRelatedSessionKeyMock = vi.fn();
const markTaskFlowsReattachedForOwnerKeyMock = vi.fn();
const chatSendMock = vi.fn();

vi.mock("../session-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...actual,
    buildGatewaySessionRow: buildGatewaySessionRowMock,
    loadSessionEntry: loadSessionEntryMock,
    readSessionPreviewItemsFromTranscript: readSessionPreviewItemsFromTranscriptMock,
    readSessionMessages: readSessionMessagesMock,
    resolveGatewaySessionStoreTarget: resolveGatewaySessionStoreTargetMock,
  };
});

vi.mock("../../commands/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../commands/sessions.js")>();
  return {
    ...actual,
    inspectDetachedSessionLifecycle: inspectDetachedSessionLifecycleMock,
    resolveSessionTranscriptState: resolveSessionTranscriptStateMock,
    buildSessionLifecycleAssessment: buildSessionLifecycleAssessmentMock,
  };
});

vi.mock("../../commands/background-session-resume.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../commands/background-session-resume.js")>();
  return {
    ...actual,
    DEFAULT_BACKGROUND_RESUME_MESSAGE: "Continue from the latest background task state.",
    buildBackgroundSessionCompletionRouting: buildBackgroundSessionCompletionRoutingMock,
    buildBackgroundSessionTranscriptHandoff: buildBackgroundSessionTranscriptHandoffMock,
    formatBackgroundSessionResumeLines: formatBackgroundSessionResumeLinesMock,
  };
});

vi.mock("../../tasks/runtime-internal.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../tasks/runtime-internal.js")>();
  return {
    ...actual,
    markTasksReattachedForRelatedSessionKey: markTasksReattachedForRelatedSessionKeyMock,
  };
});

vi.mock("../../tasks/task-flow-runtime-internal.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../tasks/task-flow-runtime-internal.js")>();
  return {
    ...actual,
    markTaskFlowsReattachedForOwnerKey: markTaskFlowsReattachedForOwnerKeyMock,
  };
});

vi.mock("./chat.js", () => ({
  chatHandlers: {
    "chat.send": (...args: unknown[]) => chatSendMock(...args),
    "chat.abort": vi.fn(),
  },
}));

const { sessionsHandlers } = await import("./sessions.js");

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createArgs(params: Record<string, unknown>) {
  const respond = vi.fn();
  return {
    respond,
    context: {
      chatAbortControllers: new Map(),
      broadcastToConnIds: vi.fn(),
      getSessionEventSubscriberConnIds: () => new Set<string>(),
      subscribeSessionEvents: vi.fn(),
      unsubscribeSessionEvents: vi.fn(),
      subscribeSessionMessageEvents: vi.fn(),
      unsubscribeSessionMessageEvents: vi.fn(),
    },
    req: { type: "req", id: "req-1", method: "test" },
    client: null,
    isWebchatConnect: () => false,
    params,
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSessionEntryMock.mockReturnValue({
    cfg: {},
    storePath: "/tmp/sessions.json",
    store: {},
    entry: {
      sessionId: "sess-1",
      sessionFile: "/tmp/sess-1.jsonl",
      updatedAt: 1,
    },
    canonicalKey: "agent:main:main",
  });
  resolveGatewaySessionStoreTargetMock.mockReturnValue({
    agentId: "main",
    storePath: "/tmp/sessions.json",
    canonicalKey: "agent:main:main",
    storeKeys: ["agent:main:main"],
  });
  buildGatewaySessionRowMock.mockReturnValue({
    key: "agent:main:main",
    kind: "direct",
    updatedAt: 1,
    abortedLastRun: false,
  });
  resolveSessionTranscriptStateMock.mockReturnValue({
    transcriptPath: "/tmp/sess-1.jsonl",
    transcriptExists: true,
  });
  buildBackgroundSessionCompletionRoutingMock.mockReturnValue({
    mode: "detached_delivery",
    summary: "detached",
  });
  buildBackgroundSessionTranscriptHandoffMock.mockReturnValue({
    mode: "detached_resume",
    summary: "live transcript",
  });
  buildSessionLifecycleAssessmentMock.mockReturnValue({
    status: "resumable",
    summary: "ready",
    resumeAvailable: true,
    activeTaskCount: 0,
    activeFlowCount: 0,
    waitingFlowCount: 0,
    blockedFlowCount: 0,
  });
  formatBackgroundSessionResumeLinesMock.mockReturnValue(["resumeSessionKey: agent:main:main"]);
  readSessionPreviewItemsFromTranscriptMock.mockReturnValue([
    { role: "assistant", text: "preview text" },
  ]);
  inspectDetachedSessionLifecycleMock.mockReturnValue({
    relatedTasks: [],
    relatedTaskFlows: [],
    completionRouting: {
      mode: "detached_delivery",
      summary: "detached",
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
    resumeDetail: null,
  });
});

describe("sessions.inspect handler", () => {
  it("returns detached-session operator detail", () => {
    const args = createArgs({
      key: "agent:main:main",
      previewLimit: 4,
      previewMaxChars: 120,
    });

    sessionsHandlers["sessions.inspect"]({
      ...args,
      respond: args.respond as never,
    } as never);

    const call = args.respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toMatchObject({
      key: "agent:main:main",
      transcript: {
        path: "/tmp/sess-1.jsonl",
        exists: true,
        handoff: { mode: "detached_resume" },
      },
      preview: {
        status: "ok",
      },
    });
    expect(readSessionPreviewItemsFromTranscriptMock).toHaveBeenCalledWith(
      "sess-1",
      "/tmp/sessions.json",
      "/tmp/sess-1.jsonl",
      "main",
      4,
      120,
    );
  });
});

describe("sessions.reattach handler", () => {
  it("marks related work as reattached and returns refreshed inspect detail", async () => {
    inspectDetachedSessionLifecycleMock
      .mockReturnValueOnce({
        relatedTasks: [],
        relatedTaskFlows: [],
        completionRouting: {
          mode: "detached_delivery",
          summary: "detached",
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
        resumeDetail: null,
      })
      .mockReturnValueOnce({
        relatedTasks: [],
        relatedTaskFlows: [],
        completionRouting: {
          mode: "foreground_reattached",
          summary: "foreground",
          reattachedAt: 123,
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
        resumeDetail: null,
      });
    buildBackgroundSessionTranscriptHandoffMock
      .mockReturnValueOnce({
        mode: "detached_resume",
        summary: "live transcript",
      })
      .mockReturnValueOnce({
        mode: "foreground_history",
        summary: "history only",
      });
    chatSendMock.mockImplementation(async ({ respond }: { respond: (...args: unknown[]) => void }) => {
      respond(true, { status: "started", runId: "run-1" }, undefined, undefined);
    });
    const args = createArgs({
      key: "agent:main:main",
    });

    await sessionsHandlers["sessions.reattach"]({
      ...args,
      respond: args.respond as never,
    } as never);

    expect(chatSendMock).toHaveBeenCalledTimes(1);
    expect(markTasksReattachedForRelatedSessionKeyMock).toHaveBeenCalledTimes(1);
    expect(markTaskFlowsReattachedForOwnerKeyMock).toHaveBeenCalledTimes(1);
    const call = args.respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toMatchObject({
      runId: "run-1",
      continuedSession: {
        key: "agent:main:main",
      },
      inspect: {
        completionRouting: {
          mode: "foreground_reattached",
        },
      },
    });
  });
});
