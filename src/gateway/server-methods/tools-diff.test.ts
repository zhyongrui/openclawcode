import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveEffectiveToolInventory,
  resolveEffectiveToolInventoryDiff,
} from "../../agents/tools-effective-inventory.js";
import { ErrorCodes } from "../protocol/index.js";
import { toolsDiffHandlers } from "./tools-diff.js";

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../../agents/agent-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/agent-scope.js")>();
  return {
    ...actual,
    listAgentIds: vi.fn(() => ["main", "coder"]),
  };
});

vi.mock("../../agents/tools-effective-inventory.js", () => ({
  resolveEffectiveToolInventory: vi
    .fn()
    .mockReturnValueOnce({
      agentId: "main",
      profile: "coding",
      presets: [],
      assembly: {
        counts: { total: 1, core: 1, plugin: 0, channel: 0 },
        context: { senderIsOwner: false },
        flags: {
          allowGatewaySubagentBinding: true,
          requireExplicitMessageTarget: false,
          disableMessageTool: false,
        },
        notes: [],
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
    })
    .mockReturnValue({
      agentId: "coder",
      profile: "full",
      presets: ["browser"],
      assembly: {
        counts: { total: 2, core: 2, plugin: 0, channel: 0 },
        context: { senderIsOwner: false },
        flags: {
          allowGatewaySubagentBinding: true,
          requireExplicitMessageTarget: false,
          disableMessageTool: false,
        },
        notes: [],
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
            {
              id: "browser",
              label: "Browser",
              description: "Browse the web",
              rawDescription: "Browse the web",
              source: "core",
            },
          ],
        },
      ],
    }),
  resolveEffectiveToolInventoryDiff: vi.fn(() => ({
    sharedCount: 1,
    added: [],
    removed: [],
    addedCounts: { total: 0, core: 0, plugin: 0, channel: 0 },
    removedCounts: { total: 0, core: 0, plugin: 0, channel: 0 },
    profileChanged: false,
    contextChanges: [],
    flagChanges: [],
    noteChanges: { added: [], removed: [] },
  })),
}));

vi.mock("../tools-effective-context.js", () => ({
  resolveSessionToolsEffectiveInventoryParams: vi
    .fn()
    .mockReturnValueOnce({
      cfg: {},
      agentId: "main",
      sessionKey: "main:abc",
      senderIsOwner: false,
    })
    .mockReturnValue({
      cfg: {},
      agentId: "coder",
      sessionKey: "agent:coder:acp:other",
      senderIsOwner: false,
    }),
}));

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createInvokeParams(params: Record<string, unknown>) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await toolsDiffHandlers["tools.diff"]({
        params,
        respond: respond as never,
        context: {} as never,
        client: null,
        req: { type: "req", id: "req-1", method: "tools.diff" },
        isWebchatConnect: () => false,
      }),
  };
}

describe("tools.diff handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid params", async () => {
    const { respond, invoke } = createInvokeParams({ sessionKey: "main:abc" });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("invalid tools.diff params");
  });

  it("rejects unknown compare agent ids", async () => {
    const { respond, invoke } = createInvokeParams({
      sessionKey: "main:abc",
      compareAgentId: "missing-agent",
    });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.message).toContain("unknown agent id");
  });

  it("returns a diff against another agent", async () => {
    const { respond, invoke } = createInvokeParams({
      sessionKey: "main:abc",
      compareAgentId: "coder",
    });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toMatchObject({
      baseSessionKey: "main:abc",
      compareAgentId: "coder",
      base: { agentId: "main" },
      target: { agentId: "coder" },
      diff: { sharedCount: 1 },
    });
    expect(resolveEffectiveToolInventory).toHaveBeenCalledTimes(2);
    expect(resolveEffectiveToolInventoryDiff).toHaveBeenCalledTimes(1);
  });
});
