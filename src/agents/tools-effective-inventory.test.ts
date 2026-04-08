import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { createOpenClawCodingTools } from "./pi-tools.js";
import type { AnyAgentTool } from "./tools/common.js";

function mockTool(params: {
  name: string;
  label: string;
  description: string;
  displaySummary?: string;
}): AnyAgentTool {
  return {
    ...params,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ text: params.description }),
  } as unknown as AnyAgentTool;
}

const effectiveInventoryState = vi.hoisted(() => ({
  tools: [
    mockTool({ name: "exec", label: "Exec", description: "Run shell commands" }),
    mockTool({ name: "docs_lookup", label: "Docs Lookup", description: "Search docs" }),
  ] as AnyAgentTool[],
  pluginMeta: {} as Record<string, { pluginId: string } | undefined>,
  channelMeta: {} as Record<string, { channelId: string } | undefined>,
  effectivePolicy: {} as { profile?: string; providerProfile?: string },
  resolvedModelCompat: undefined as Record<string, unknown> | undefined,
  createToolsMock: vi.fn<typeof createOpenClawCodingTools>(
    (_options) =>
      [
        mockTool({ name: "exec", label: "Exec", description: "Run shell commands" }),
        mockTool({ name: "docs_lookup", label: "Docs Lookup", description: "Search docs" }),
      ] as AnyAgentTool[],
  ),
}));

vi.mock("./agent-scope.js", async () => {
  const actual = await vi.importActual<typeof import("./agent-scope.js")>("./agent-scope.js");
  return {
    ...actual,
    resolveSessionAgentId: () => "main",
    resolveAgentWorkspaceDir: () => "/tmp/workspace-main",
    resolveAgentDir: () => "/tmp/agents/main/agent",
  };
});

vi.mock("./pi-tools.js", () => ({
  createOpenClawCodingTools: (options?: Parameters<typeof createOpenClawCodingTools>[0]) =>
    effectiveInventoryState.createToolsMock(options),
}));

vi.mock("./pi-embedded-runner/model.js", () => ({
  resolveModel: vi.fn(() => ({
    model: effectiveInventoryState.resolvedModelCompat
      ? { compat: effectiveInventoryState.resolvedModelCompat }
      : undefined,
    authStorage: {} as never,
    modelRegistry: {} as never,
  })),
}));

vi.mock("../plugins/tools.js", () => ({
  getPluginToolMeta: (tool: { name: string }) => effectiveInventoryState.pluginMeta[tool.name],
}));

vi.mock("./channel-tools.js", () => ({
  getChannelAgentToolMeta: (tool: { name: string }) =>
    effectiveInventoryState.channelMeta[tool.name],
}));

vi.mock("./pi-tools.policy.js", () => ({
  resolveEffectiveToolPolicy: () => effectiveInventoryState.effectivePolicy,
}));

let resolveEffectiveToolInventory: typeof import("./tools-effective-inventory.js").resolveEffectiveToolInventory;
let resolveEffectiveToolInventoryDiff: typeof import("./tools-effective-inventory.js").resolveEffectiveToolInventoryDiff;

async function loadHarness(options?: {
  tools?: AnyAgentTool[];
  createToolsMock?: typeof effectiveInventoryState.createToolsMock;
  pluginMeta?: Record<string, { pluginId: string } | undefined>;
  channelMeta?: Record<string, { channelId: string } | undefined>;
  effectivePolicy?: { profile?: string; providerProfile?: string; presets?: string[] };
  resolvedModelCompat?: Record<string, unknown>;
}) {
  effectiveInventoryState.tools = options?.tools ?? [
    mockTool({ name: "exec", label: "Exec", description: "Run shell commands" }),
    mockTool({ name: "docs_lookup", label: "Docs Lookup", description: "Search docs" }),
  ];
  effectiveInventoryState.pluginMeta = options?.pluginMeta ?? {};
  effectiveInventoryState.channelMeta = options?.channelMeta ?? {};
  effectiveInventoryState.effectivePolicy = options?.effectivePolicy ?? {};
  effectiveInventoryState.resolvedModelCompat = options?.resolvedModelCompat;
  effectiveInventoryState.createToolsMock =
    options?.createToolsMock ??
    vi.fn<typeof createOpenClawCodingTools>((_options) => effectiveInventoryState.tools);
  return {
    resolveEffectiveToolInventory,
    resolveEffectiveToolInventoryDiff,
    createToolsMock: effectiveInventoryState.createToolsMock,
  };
}

describe("resolveEffectiveToolInventory", () => {
  beforeAll(async () => {
    ({ resolveEffectiveToolInventory, resolveEffectiveToolInventoryDiff } = await import(
      "./tools-effective-inventory.js"
    ));
  });

  beforeEach(() => {
    effectiveInventoryState.tools = [
      mockTool({ name: "exec", label: "Exec", description: "Run shell commands" }),
      mockTool({ name: "docs_lookup", label: "Docs Lookup", description: "Search docs" }),
    ];
    effectiveInventoryState.pluginMeta = {};
    effectiveInventoryState.channelMeta = {};
    effectiveInventoryState.effectivePolicy = {};
    effectiveInventoryState.resolvedModelCompat = undefined;
    effectiveInventoryState.createToolsMock = vi.fn<typeof createOpenClawCodingTools>(
      (_options) => effectiveInventoryState.tools,
    );
  });

  it("groups core, plugin, and channel tools from the effective runtime set", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        mockTool({ name: "exec", label: "Exec", description: "Run shell commands" }),
        mockTool({ name: "docs_lookup", label: "Docs Lookup", description: "Search docs" }),
        mockTool({
          name: "message_actions",
          label: "Message Actions",
          description: "Act on messages",
        }),
      ],
      pluginMeta: { docs_lookup: { pluginId: "docs" } },
      channelMeta: { message_actions: { channelId: "telegram" } },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result).toEqual({
      agentId: "main",
      profile: "full",
      presets: [],
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
        {
          id: "plugin",
          label: "Connected tools",
          source: "plugin",
          tools: [
            {
              id: "docs_lookup",
              label: "Docs Lookup",
              description: "Search docs",
              rawDescription: "Search docs",
              source: "plugin",
              pluginId: "docs",
            },
          ],
        },
        {
          id: "channel",
          label: "Channel tools",
          source: "channel",
          tools: [
            {
              id: "message_actions",
              label: "Message Actions",
              description: "Act on messages",
              rawDescription: "Act on messages",
              source: "channel",
              channelId: "telegram",
            },
          ],
        },
      ],
      assembly: {
        counts: {
          total: 3,
          core: 1,
          plugin: 1,
          channel: 1,
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
    });
  });

  it("disambiguates duplicate labels with source ids", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        mockTool({ name: "docs_lookup", label: "Lookup", description: "Search docs" }),
        mockTool({ name: "jira_lookup", label: "Lookup", description: "Search Jira" }),
      ],
      pluginMeta: {
        docs_lookup: { pluginId: "docs" },
        jira_lookup: { pluginId: "jira" },
      },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });
    const labels = result.groups.flatMap((group) => group.tools.map((tool) => tool.label));

    expect(labels).toEqual(["Lookup (docs)", "Lookup (jira)"]);
    expect(result.assembly.counts.plugin).toBe(2);
  });

  it("prefers displaySummary over raw description", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        mockTool({
          name: "cron",
          label: "Cron",
          displaySummary: "Schedule and manage cron jobs.",
          description: "Long raw description\n\nACTIONS:\n- status",
        }),
      ],
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.groups[0]?.tools[0]).toEqual({
      id: "cron",
      label: "Cron",
      description: "Schedule and manage cron jobs.",
      rawDescription: "Long raw description\n\nACTIONS:\n- status",
      source: "core",
    });
  });

  it("falls back to a sanitized summary for multi-line raw descriptions", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        mockTool({
          name: "cron",
          label: "Cron",
          description:
            'Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events. Use this for reminders, "check back later" requests, delayed follow-ups, and recurring tasks. Do not emulate scheduling with exec sleep or process polling.\n\nACTIONS:\n- status: Check cron scheduler status\nJOB SCHEMA:\n{ ... }',
        }),
      ],
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    const description = result.groups[0]?.tools[0]?.description ?? "";
    expect(description).toContain(
      "Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events.",
    );
    expect(description).toContain("Use this for reminders");
    expect(description.endsWith("...")).toBe(true);
    expect(description.length).toBeLessThanOrEqual(120);
    expect(result.groups[0]?.tools[0]?.rawDescription).toContain("ACTIONS:");
  });

  it("includes the resolved tool profile", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [mockTool({ name: "exec", label: "Exec", description: "Run shell commands" })],
      effectivePolicy: { profile: "minimal", providerProfile: "coding", presets: ["browser"] },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.profile).toBe("coding");
    expect(result.presets).toEqual(["browser"]);
    expect(result.assembly.context.senderIsOwner).toBe(false);
  });

  it("passes resolved model compat into effective tool creation", async () => {
    const createToolsMock = vi.fn<typeof createOpenClawCodingTools>(() => [
      mockTool({ name: "exec", label: "Exec", description: "Run shell commands" }),
    ]);
    const { resolveEffectiveToolInventory } = await loadHarness({
      createToolsMock,
      resolvedModelCompat: { supportsTools: true, supportsNativeWebSearch: true },
    });

    resolveEffectiveToolInventory({
      cfg: {},
      agentDir: "/tmp/agents/main/agent",
      modelProvider: "xai",
      modelId: "grok-test",
    });

    expect(createToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowGatewaySubagentBinding: true,
        modelCompat: { supportsTools: true, supportsNativeWebSearch: true },
      }),
    );
  });

  it("surfaces effective runtime context flags in the assembly metadata", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [{ name: "exec", label: "Exec", description: "Run shell commands" }],
    });

    const result = resolveEffectiveToolInventory({
      cfg: {},
      messageProvider: "telegram",
      modelProvider: "openai",
      modelId: "gpt-5.4",
      replyToMode: "first",
      senderIsOwner: true,
      requireExplicitMessageTarget: true,
      disableMessageTool: true,
      allowGatewaySubagentBinding: false,
    });

    expect(result.assembly).toEqual({
      counts: {
        total: 1,
        core: 1,
        plugin: 0,
        channel: 0,
      },
      context: {
        messageProvider: "telegram",
        modelProvider: "openai",
        modelId: "gpt-5.4",
        replyToMode: "first",
        senderIsOwner: true,
      },
      flags: {
        allowGatewaySubagentBinding: false,
        requireExplicitMessageTarget: true,
        disableMessageTool: true,
      },
      notes: [
        {
          id: "message-target-required",
          severity: "info",
          message:
            "Message-send tools require an explicit target in this runtime; implicit last-route sends are disabled.",
        },
        {
          id: "message-tool-disabled",
          severity: "warn",
          message: "The message tool is disabled for this runtime, so direct outbound sends are unavailable.",
        },
        {
          id: "gateway-subagent-binding-disabled",
          severity: "info",
          message: "Gateway subagent binding is disabled for this runtime, so subagent handoff helpers are restricted.",
        },
      ],
    });
  });

  it("surfaces active presets from effective tool policy", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [{ name: "browser", label: "Browser", description: "Browse the web" }],
      effectivePolicy: { profile: "minimal", presets: ["browser", "remote"] },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.presets).toEqual(["browser", "remote"]);
  });

  it("builds a stable diff between two effective tool inventories", async () => {
    const { resolveEffectiveToolInventoryDiff } = await loadHarness();
    const base = {
      agentId: "main",
      profile: "coding",
      presets: [],
      assembly: {
        counts: { total: 2, core: 1, plugin: 1, channel: 0 },
        context: {
          modelId: "gpt-4.1",
          senderIsOwner: false,
        },
        flags: {
          allowGatewaySubagentBinding: true,
          requireExplicitMessageTarget: false,
          disableMessageTool: false,
        },
        notes: [],
      },
      groups: [
        {
          id: "core" as const,
          label: "Built-in tools",
          source: "core" as const,
          tools: [
            {
              id: "exec",
              label: "Exec",
              description: "Run shell commands",
              rawDescription: "Run shell commands",
              source: "core" as const,
            },
          ],
        },
        {
          id: "plugin" as const,
          label: "Connected tools",
          source: "plugin" as const,
          tools: [
            {
              id: "docs_lookup",
              label: "Docs Lookup",
              description: "Search docs",
              rawDescription: "Search docs",
              source: "plugin" as const,
              pluginId: "docs",
            },
          ],
        },
      ],
    };
    const target = {
      agentId: "coder",
      profile: "full",
      presets: ["browser"],
      assembly: {
        counts: { total: 2, core: 2, plugin: 0, channel: 0 },
        context: {
          modelId: "gpt-5.4",
          senderIsOwner: false,
        },
        flags: {
          allowGatewaySubagentBinding: true,
          requireExplicitMessageTarget: false,
          disableMessageTool: false,
        },
        notes: [],
      },
      groups: [
        {
          id: "core" as const,
          label: "Built-in tools",
          source: "core" as const,
          tools: [
            {
              id: "exec",
              label: "Exec",
              description: "Run shell commands",
              rawDescription: "Run shell commands",
              source: "core" as const,
            },
            {
              id: "browser",
              label: "Browser",
              description: "Browse the web",
              rawDescription: "Browse the web",
              source: "core" as const,
            },
          ],
        },
      ],
    };

    expect(resolveEffectiveToolInventoryDiff({ base, target })).toEqual({
      sharedCount: 1,
      added: [
        {
          id: "browser",
          label: "Browser",
          description: "Browse the web",
          rawDescription: "Browse the web",
          source: "core",
        },
      ],
      removed: [
        {
          id: "docs_lookup",
          label: "Docs Lookup",
          description: "Search docs",
          rawDescription: "Search docs",
          source: "plugin",
          pluginId: "docs",
        },
      ],
      addedCounts: { total: 1, core: 1, plugin: 0, channel: 0 },
      removedCounts: { total: 1, core: 0, plugin: 1, channel: 0 },
      profileChanged: true,
      contextChanges: [{ field: "modelId", from: "gpt-4.1", to: "gpt-5.4" }],
      flagChanges: [],
      noteChanges: { added: [], removed: [] },
    });
  });
});
