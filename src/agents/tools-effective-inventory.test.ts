import { describe, expect, it, vi } from "vitest";

async function loadHarness(options?: {
  tools?: Array<{ name: string; label?: string; description?: string; displaySummary?: string }>;
  createToolsMock?: ReturnType<typeof vi.fn>;
  pluginMeta?: Record<string, { pluginId: string } | undefined>;
  channelMeta?: Record<string, { channelId: string } | undefined>;
  effectivePolicy?: { profile?: string; providerProfile?: string };
  resolvedModelCompat?: Record<string, unknown>;
}) {
  vi.resetModules();
  vi.doMock("./agent-scope.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./agent-scope.js")>();
    return {
      ...actual,
      resolveSessionAgentId: () => "main",
      resolveAgentWorkspaceDir: () => "/tmp/workspace-main",
      resolveAgentDir: () => "/tmp/agents/main/agent",
    };
  });
  const createToolsMock =
    options?.createToolsMock ??
    vi.fn(
      () =>
        options?.tools ?? [
          { name: "exec", label: "Exec", description: "Run shell commands" },
          { name: "docs_lookup", label: "Docs Lookup", description: "Search docs" },
        ],
    );
  vi.doMock("./pi-tools.js", () => ({
    createOpenClawCodingTools: createToolsMock,
  }));
  vi.doMock("./pi-embedded-runner/model.js", () => ({
    resolveModel: vi.fn(() => ({
      model: options?.resolvedModelCompat ? { compat: options.resolvedModelCompat } : undefined,
      authStorage: {} as never,
      modelRegistry: {} as never,
    })),
  }));
  vi.doMock("../plugins/tools.js", () => ({
    getPluginToolMeta: (tool: { name: string }) => options?.pluginMeta?.[tool.name],
  }));
  vi.doMock("./channel-tools.js", () => ({
    getChannelAgentToolMeta: (tool: { name: string }) => options?.channelMeta?.[tool.name],
  }));
  vi.doMock("./pi-tools.policy.js", () => ({
    resolveEffectiveToolPolicy: () => options?.effectivePolicy ?? {},
  }));
  return await import("./tools-effective-inventory.js");
}

describe("resolveEffectiveToolInventory", () => {
  it("groups core, plugin, and channel tools from the effective runtime set", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        { name: "exec", label: "Exec", description: "Run shell commands" },
        { name: "docs_lookup", label: "Docs Lookup", description: "Search docs" },
        { name: "message_actions", label: "Message Actions", description: "Act on messages" },
      ],
      pluginMeta: { docs_lookup: { pluginId: "docs" } },
      channelMeta: { message_actions: { channelId: "telegram" } },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result).toEqual({
      agentId: "main",
      profile: "full",
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
        { name: "docs_lookup", label: "Lookup", description: "Search docs" },
        { name: "jira_lookup", label: "Lookup", description: "Search Jira" },
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
        {
          name: "cron",
          label: "Cron",
          displaySummary: "Schedule and manage cron jobs.",
          description: "Long raw description\n\nACTIONS:\n- status",
        },
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
        {
          name: "cron",
          label: "Cron",
          description:
            "Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events.\n\nACTIONS:\n- status: Check cron scheduler status\nJOB SCHEMA:\n{ ... }",
        },
      ],
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.groups[0]?.tools[0]?.description).toBe(
      "Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events.",
    );
    expect(result.groups[0]?.tools[0]?.rawDescription).toContain("ACTIONS:");
  });

  it("includes the resolved tool profile", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [{ name: "exec", label: "Exec", description: "Run shell commands" }],
      effectivePolicy: { profile: "minimal", providerProfile: "coding" },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.profile).toBe("coding");
    expect(result.assembly.context.senderIsOwner).toBe(false);
  });

  it("passes resolved model compat into effective tool creation", async () => {
    const createToolsMock = vi.fn(() => [
      { name: "exec", label: "Exec", description: "Run shell commands" },
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
});
