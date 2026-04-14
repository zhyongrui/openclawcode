import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { toolsEffectiveHandlers } from "./tools-effective.js";

const runtimeMocks = vi.hoisted(() => ({
  deliveryContextFromSession: vi.fn((_entry?: unknown) => ({
    channel: "telegram",
    to: "channel-1",
    accountId: "acct-1",
    threadId: "thread-2",
  })),
  listAgentIds: vi.fn((_cfg?: unknown) => ["main"]),
  loadConfig: vi.fn(() => ({})),
  loadSessionEntry: vi.fn((_sessionKey?: string) => ({
    cfg: {},
    canonicalKey: "main:abc",
    entry: {
      sessionId: "session-1",
      updatedAt: 1,
      lastChannel: "telegram",
      lastAccountId: "acct-1",
      lastThreadId: "thread-2",
      lastTo: "channel-1",
      groupId: "group-4",
      groupChannel: "#ops",
      space: "workspace-5",
      chatType: "group",
      modelProvider: "openai",
      model: "gpt-4.1",
    },
  })),
  resolveEffectiveToolInventory: vi.fn(() => ({
    agentId: "main",
    profile: "coding",
    presets: ["browser"],
    assembly: {
      counts: {
        total: 1,
        core: 1,
        plugin: 0,
        channel: 0,
      },
      context: {
        senderIsOwner: false,
      },
      flags: {
        allowGatewaySubagentBinding: true,
        requireExplicitMessageTarget: false,
        disableMessageTool: false,
      },
      notes: [
        {
          id: "owner-only-hidden",
          severity: "info",
          message: "Owner-only tools are hidden because the current caller is not an owner.",
        },
      ],
    },
    groups: [
      {
        id: "core",
        label: "Built-in tools",
        source: "core",
        tools: [
          {
            id: "exec",
            label: "Exec",
            description: "Run shell commands",
            rawDescription: "Run shell commands",
            source: "core",
          },
        ],
      },
    ],
  })),
  resolveReplyToMode: vi.fn(() => "first"),
  resolveSessionAgentId: vi.fn((_params?: unknown) => "main"),
  resolveSessionModelRef: vi.fn((_cfg?: unknown, _entry?: unknown, _agentId?: string) => ({
    provider: "openai",
    model: "gpt-4.1",
  })),
  resolveSessionToolsEffectiveInventoryParams: vi.fn(
    (params: { sessionKey: string; requestedAgentId?: string; senderIsOwner: boolean }) => {
      const loaded = runtimeMocks.loadSessionEntry(params.sessionKey) as {
        cfg: Record<string, unknown>;
        canonicalKey?: string;
        entry?: {
          lastChannel?: string;
          lastAccountId?: string;
          lastThreadId?: string | number;
          origin?: {
            provider?: string;
            accountId?: string;
            threadId?: string | number;
          };
          groupId?: string;
          groupChannel?: string;
          space?: string;
          chatType?: string;
          modelProvider?: string;
          model?: string;
        };
      };
      if (!loaded.entry) {
        throw new Error(`unknown session key "${params.sessionKey}"`);
      }
      const sessionAgentId = runtimeMocks.resolveSessionAgentId({
        sessionKey: loaded.canonicalKey ?? params.sessionKey,
        config: loaded.cfg,
      });
      if (params.requestedAgentId && params.requestedAgentId !== sessionAgentId) {
        throw new Error(
          `agent id "${params.requestedAgentId}" does not match session agent "${sessionAgentId}"`,
        );
      }
      const delivery = runtimeMocks.deliveryContextFromSession(loaded.entry) as {
        channel?: string;
        to?: string;
        accountId?: string;
        threadId?: string | number;
      };
      const resolvedModel = runtimeMocks.resolveSessionModelRef(
        loaded.cfg,
        loaded.entry,
        sessionAgentId,
      ) as { provider?: string; model?: string };
      return {
        cfg: loaded.cfg,
        agentId: sessionAgentId,
        sessionKey: params.sessionKey,
        senderIsOwner: params.senderIsOwner,
        modelProvider: resolvedModel.provider,
        modelId: resolvedModel.model,
        messageProvider:
          delivery?.channel ?? loaded.entry.lastChannel ?? loaded.entry.origin?.provider,
        accountId:
          delivery?.accountId ?? loaded.entry.lastAccountId ?? loaded.entry.origin?.accountId,
        currentChannelId: delivery?.to,
        currentThreadTs:
          delivery?.threadId != null
            ? String(delivery.threadId)
            : loaded.entry.lastThreadId != null
              ? String(loaded.entry.lastThreadId)
              : loaded.entry.origin?.threadId != null
                ? String(loaded.entry.origin.threadId)
                : undefined,
        groupId: loaded.entry.groupId,
        groupChannel: loaded.entry.groupChannel,
        groupSpace: loaded.entry.space,
        replyToMode: runtimeMocks.resolveReplyToMode(),
      };
    },
  ),
}));

vi.mock("./tools-effective.runtime.js", () => runtimeMocks);

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createInvokeParams(params: Record<string, unknown>) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await toolsEffectiveHandlers["tools.effective"]({
        params,
        respond: respond as never,
        context: {} as never,
        client: null,
        req: { type: "req", id: "req-1", method: "tools.effective" },
        isWebchatConnect: () => false,
      }),
  };
}

describe("tools.effective handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid params", async () => {
    const { respond, invoke } = createInvokeParams({ includePlugins: false });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("invalid tools.effective params");
  });

  it("rejects missing sessionKey", async () => {
    const { respond, invoke } = createInvokeParams({});
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("invalid tools.effective params");
  });

  it("rejects caller-supplied auth context params", async () => {
    const { respond, invoke } = createInvokeParams({ senderIsOwner: true });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("invalid tools.effective params");
  });

  it("rejects unknown agent ids", async () => {
    const { respond, invoke } = createInvokeParams({
      sessionKey: "main:abc",
      agentId: "unknown-agent",
    });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("unknown agent id");
  });

  it("rejects unknown session keys", async () => {
    runtimeMocks.loadSessionEntry.mockReturnValueOnce({
      cfg: {},
      canonicalKey: "missing-session",
      entry: undefined,
      legacyKey: undefined,
      storePath: "/tmp/sessions.json",
    } as never);
    const { respond, invoke } = createInvokeParams({ sessionKey: "missing-session" });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain('unknown session key "missing-session"');
  });

  it("returns the effective runtime inventory", async () => {
    const { respond, invoke } = createInvokeParams({ sessionKey: "main:abc" });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toMatchObject({
      agentId: "main",
      profile: "coding",
      presets: ["browser"],
      assembly: {
        counts: {
          total: 1,
          core: 1,
          plugin: 0,
          channel: 0,
        },
        notes: [
          {
            id: "owner-only-hidden",
            severity: "info",
            message: "Owner-only tools are hidden because the current caller is not an owner.",
          },
        ],
      },
      groups: [
        {
          id: "core",
          source: "core",
          tools: [{ id: "exec", source: "core" }],
        },
      ],
    });
    expect(runtimeMocks.resolveEffectiveToolInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        senderIsOwner: false,
        currentChannelId: "channel-1",
        currentThreadTs: "thread-2",
        accountId: "acct-1",
        groupId: "group-4",
        groupChannel: "#ops",
        groupSpace: "workspace-5",
        replyToMode: "first",
        messageProvider: "telegram",
        modelProvider: "openai",
        modelId: "gpt-4.1",
      }),
    );
  });

  it("falls back to origin.threadId when delivery context omits thread metadata", async () => {
    runtimeMocks.loadSessionEntry.mockReturnValueOnce({
      cfg: {},
      canonicalKey: "main:abc",
      entry: {
        sessionId: "session-origin-thread",
        updatedAt: 1,
        lastChannel: "telegram",
        lastAccountId: "acct-1",
        lastTo: "channel-1",
        origin: {
          provider: "telegram",
          accountId: "acct-1",
          threadId: 42,
        },
        groupId: "group-4",
        groupChannel: "#ops",
        space: "workspace-5",
        chatType: "group",
        modelProvider: "openai",
        model: "gpt-4.1",
      },
    } as never);
    runtimeMocks.deliveryContextFromSession.mockReturnValueOnce({
      channel: "telegram",
      to: "channel-1",
      accountId: "acct-1",
      threadId: "42",
    });

    const { respond, invoke } = createInvokeParams({ sessionKey: "main:abc" });
    await invoke();

    expect(runtimeMocks.resolveEffectiveToolInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        currentThreadTs: "42",
      }),
    );
    expect((respond.mock.calls[0] as RespondCall | undefined)?.[0]).toBe(true);
  });

  it("passes senderIsOwner=true for admin-scoped callers", async () => {
    const respond = vi.fn();
    await toolsEffectiveHandlers["tools.effective"]({
      params: { sessionKey: "main:abc" },
      respond: respond as never,
      context: {} as never,
      client: {
        connect: { scopes: ["operator.admin"] },
      } as never,
      req: { type: "req", id: "req-1", method: "tools.effective" },
      isWebchatConnect: () => false,
    });
    expect(runtimeMocks.resolveEffectiveToolInventory).toHaveBeenCalledWith(
      expect.objectContaining({ senderIsOwner: true }),
    );
  });

  it("rejects agent ids that do not match the session agent", async () => {
    const { respond, invoke } = createInvokeParams({
      sessionKey: "main:abc",
      agentId: "other",
    });
    runtimeMocks.loadSessionEntry.mockReturnValueOnce({
      cfg: {},
      canonicalKey: "main:abc",
      entry: {
        sessionId: "session-1",
        updatedAt: 1,
      },
    } as never);
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain('unknown agent id "other"');
  });
});
