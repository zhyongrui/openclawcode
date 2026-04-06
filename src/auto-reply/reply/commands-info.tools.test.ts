import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import {
  createChannelTestPluginBase,
  createTestRegistry,
} from "../../test-utils/channel-plugins.js";

async function loadToolsHarness(options?: {
  resolveToolsMock?: ReturnType<typeof vi.fn>;
  resolveToolsDiffMock?: ReturnType<typeof vi.fn>;
  resolveSessionToolsParamsMock?: ReturnType<typeof vi.fn>;
  resolveTools?: () => {
    agentId: string;
    profile: string;
    assembly: {
      counts: {
        total: number;
        core: number;
        plugin: number;
        channel: number;
      };
      context: {
        messageProvider?: string;
        modelProvider?: string;
        modelId?: string;
        replyToMode?: "off" | "first" | "all";
        senderIsOwner: boolean;
      };
      flags: {
        allowGatewaySubagentBinding: boolean;
        requireExplicitMessageTarget: boolean;
        disableMessageTool: boolean;
      };
      notes: Array<{
        id: string;
        severity: "info" | "warn";
        message: string;
      }>;
    };
    groups: Array<{
      id: "core" | "plugin" | "channel";
      label: string;
      source: "core" | "plugin" | "channel";
      pluginId?: string;
      channelId?: string;
      tools: Array<{
        id: string;
        label: string;
        description: string;
        source: "core" | "plugin" | "channel";
        pluginId?: string;
        channelId?: string;
      }>;
    }>;
  };
}) {
  vi.resetModules();
  vi.doMock("../../agents/agent-scope.js", async () => {
    const actual = await vi.importActual<typeof import("../../agents/agent-scope.js")>(
      "../../agents/agent-scope.js",
    );
    return {
      ...actual,
      listAgentIds: () => ["main", "coder"],
      resolveSessionAgentId: () => "main",
    };
  });
  const resolveToolsMock =
    options?.resolveToolsMock ??
    vi.fn(
      options?.resolveTools ??
        (() => ({
          agentId: "main",
          profile: "coding",
          assembly: {
            counts: {
              total: 2,
              core: 1,
              plugin: 1,
              channel: 0,
            },
            context: {
              messageProvider: "telegram",
              modelProvider: "openai",
              modelId: "gpt-4.1",
              replyToMode: "all" as const,
              senderIsOwner: false,
            },
            flags: {
              allowGatewaySubagentBinding: true,
              requireExplicitMessageTarget: false,
              disableMessageTool: false,
            },
            notes: [
              {
                id: "profile-gated",
                severity: "info" as const,
                message:
                  'Tool profile "coding" may hide capabilities that are available in fuller profiles.',
              },
              {
                id: "owner-only-hidden",
                severity: "info" as const,
                message: "Owner-only tools are hidden because the current caller is not an owner.",
              },
            ],
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
                  description: "Search internal documentation",
                  source: "plugin" as const,
                  pluginId: "docs",
                },
              ],
            },
          ],
        })),
    );
  const resolveToolsDiffMock =
    options?.resolveToolsDiffMock ??
    vi.fn(() => ({
      sharedCount: 1,
      added: [
        {
          id: "browser",
          label: "Browser",
          description: "Browse the web",
          rawDescription: "Browse the web",
          source: "core" as const,
        },
      ],
      removed: [
        {
          id: "docs_lookup",
          label: "Docs Lookup",
          description: "Search internal documentation",
          rawDescription: "Search internal documentation",
          source: "plugin" as const,
          pluginId: "docs",
        },
      ],
      addedCounts: { total: 1, core: 1, plugin: 0, channel: 0 },
      removedCounts: { total: 1, core: 0, plugin: 1, channel: 0 },
      profileChanged: true,
      contextChanges: [{ field: "modelId", from: "gpt-4.1", to: "gpt-5.4" }],
      flagChanges: [],
      noteChanges: {
        added: [],
        removed: [],
      },
    }));
  vi.doMock("../../agents/tools-effective-inventory.js", () => ({
    resolveEffectiveToolInventory: resolveToolsMock,
    resolveEffectiveToolInventoryDiff: resolveToolsDiffMock,
  }));
  const resolveSessionToolsParamsMock =
    options?.resolveSessionToolsParamsMock ??
    vi.fn(() => ({
      cfg: buildConfig(),
      agentId: "coder",
      sessionKey: "agent:coder:acp:other",
      senderIsOwner: false,
      modelProvider: "openai",
      modelId: "gpt-5.4",
      messageProvider: "telegram",
      replyToMode: "all" as const,
    }));
  vi.doMock("../../gateway/tools-effective-context.js", () => ({
    resolveSessionToolsEffectiveInventoryParams: resolveSessionToolsParamsMock,
  }));
  vi.doMock("./agent-runner-utils.js", () => ({
    buildThreadingToolContext: () => ({
      currentChannelId: "channel-123",
      currentMessageId: "message-456",
    }),
  }));
  vi.doMock("./reply-threading.js", () => ({
    resolveReplyToMode: () => "all",
  }));

  const { buildCommandTestParams } = await import("./commands.test-harness.js");
  const { handleToolsCommand } = await import("./commands-info.js");
  return {
    buildCommandTestParams,
    handleToolsCommand,
    resolveToolsMock,
    resolveToolsDiffMock,
    resolveSessionToolsParamsMock,
  };
}

function buildConfig() {
  return {
    commands: { text: true },
    channels: { whatsapp: { allowFrom: ["*"] } },
  } as OpenClawConfig;
}

describe("handleToolsCommand", () => {
  it("renders a product-facing tool list", async () => {
    const { buildCommandTestParams, handleToolsCommand, resolveToolsMock } =
      await loadToolsHarness();
    const params = buildCommandTestParams("/tools", buildConfig(), undefined, {
      workspaceDir: "/tmp",
    });
    params.agentId = "main";
    params.provider = "openai";
    params.model = "gpt-4.1";
    params.ctx = {
      ...params.ctx,
      From: "telegram:group:abc123",
      GroupChannel: "#ops",
      GroupSpace: "workspace-1",
      SenderName: "User Name",
      SenderUsername: "user_name",
      SenderE164: "+1000",
      MessageThreadId: 99,
      AccountId: "acct-1",
      Provider: "telegram",
      ChatType: "group",
    };

    const result = await handleToolsCommand(params, true);

    expect(result?.reply?.text).toContain("Available tools");
    expect(result?.reply?.text).toContain("Profile: coding");
    expect(result?.reply?.text).toContain(
      "Runtime: 2 total | 1 built-in | 1 plugin | 0 channel | channel=telegram | model=openai/gpt-4.1 | reply=all",
    );
    expect(result?.reply?.text).toContain(
      'Restrictions: Tool profile "coding" may hide capabilities that are available in fuller profiles. | Owner-only tools are hidden because the current caller is not an owner.',
    );
    expect(result?.reply?.text).toContain("Built-in tools");
    expect(result?.reply?.text).toContain("exec");
    expect(result?.reply?.text).toContain("Connected tools");
    expect(result?.reply?.text).toContain("docs_lookup (docs)");
    expect(result?.reply?.text).not.toContain("unavailable right now");
    expect(resolveToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        senderIsOwner: false,
        senderId: undefined,
        senderName: "User Name",
        senderUsername: "user_name",
        senderE164: "+1000",
        accountId: "acct-1",
        currentChannelId: "channel-123",
        currentThreadTs: "99",
        currentMessageId: "message-456",
        groupId: "abc123",
        groupChannel: "#ops",
        groupSpace: "workspace-1",
        replyToMode: "all",
      }),
    );
  });

  it("returns usage when arguments are provided", async () => {
    const { buildCommandTestParams, handleToolsCommand } = await loadToolsHarness();
    const result = await handleToolsCommand(
      buildCommandTestParams("/tools extra", buildConfig(), undefined, { workspaceDir: "/tmp" }),
      true,
    );

    expect(result).toEqual({
      shouldContinue: false,
      reply: {
        text: "Usage: /tools [compact|verbose] | /tools compare <agent-id|session-key> [compact|verbose]",
      },
    });
  });

  it("does not synthesize group ids for direct-chat sender ids", async () => {
    const { buildCommandTestParams, handleToolsCommand, resolveToolsMock } =
      await loadToolsHarness();
    const params = buildCommandTestParams("/tools", buildConfig(), undefined, {
      workspaceDir: "/tmp",
    });
    params.ctx = {
      ...params.ctx,
      From: "telegram:8231046597",
      Provider: "telegram",
      ChatType: "dm",
    };

    await handleToolsCommand(params, true);

    expect(resolveToolsMock).toHaveBeenCalledWith(expect.objectContaining({ groupId: undefined }));
  });

  it("renders the detailed tool list in verbose mode", async () => {
    const { buildCommandTestParams, handleToolsCommand } = await loadToolsHarness();
    const result = await handleToolsCommand(
      buildCommandTestParams("/tools verbose", buildConfig(), undefined, { workspaceDir: "/tmp" }),
      true,
    );

    expect(result?.reply?.text).toContain("What this agent can use right now:");
    expect(result?.reply?.text).toContain("Profile: coding");
    expect(result?.reply?.text).toContain("Runtime: 2 total | 1 built-in | 1 plugin | 0 channel");
    expect(result?.reply?.text).toContain("Exec - Run shell commands");
    expect(result?.reply?.text).toContain("Docs Lookup - Search internal documentation");
  });

  it("accepts explicit compact mode", async () => {
    const { buildCommandTestParams, handleToolsCommand } = await loadToolsHarness();
    const result = await handleToolsCommand(
      buildCommandTestParams("/tools compact", buildConfig(), undefined, { workspaceDir: "/tmp" }),
      true,
    );

    expect(result?.reply?.text).toContain("exec");
    expect(result?.reply?.text).toContain("Use /tools verbose for descriptions.");
  });

  it("renders a tool diff against another agent", async () => {
    const { buildCommandTestParams, handleToolsCommand, resolveToolsMock, resolveToolsDiffMock } =
      await loadToolsHarness({
        resolveToolsMock: vi
          .fn()
          .mockReturnValueOnce({
            agentId: "main",
            profile: "coding",
            assembly: {
              counts: { total: 2, core: 1, plugin: 1, channel: 0 },
              context: { modelId: "gpt-4.1", senderIsOwner: false },
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
              {
                id: "plugin",
                label: "Connected tools",
                source: "plugin",
                tools: [
                  {
                    id: "docs_lookup",
                    label: "Docs Lookup",
                    description: "Search internal documentation",
                    rawDescription: "Search internal documentation",
                    source: "plugin",
                    pluginId: "docs",
                  },
                ],
              },
            ],
          })
          .mockReturnValueOnce({
            agentId: "coder",
            profile: "full",
            assembly: {
              counts: { total: 2, core: 2, plugin: 0, channel: 0 },
              context: { modelId: "gpt-5.4", senderIsOwner: false },
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
      });
    const result = await handleToolsCommand(
      buildCommandTestParams("/tools compare coder", buildConfig(), undefined, {
        workspaceDir: "/tmp",
      }),
      true,
    );

    expect(result?.reply?.text).toContain("Tool surface diff");
    expect(result?.reply?.text).toContain("Target: Agent coder");
    expect(result?.reply?.text).toContain("Summary: 1 shared | 1 only in target | 1 only in base");
    expect(result?.reply?.text).toContain("Only in target:");
    expect(result?.reply?.text).toContain("browser");
    expect(result?.reply?.text).toContain("Only in base:");
    expect(result?.reply?.text).toContain("docs_lookup (docs)");
    expect(resolveToolsMock).toHaveBeenCalledTimes(2);
    expect(resolveToolsDiffMock).toHaveBeenCalledTimes(1);
  });

  it("renders a verbose tool diff against another session key", async () => {
    const {
      buildCommandTestParams,
      handleToolsCommand,
      resolveToolsMock,
      resolveSessionToolsParamsMock,
    } = await loadToolsHarness();
    const result = await handleToolsCommand(
      buildCommandTestParams("/tools compare agent:coder:acp:other verbose", buildConfig(), undefined, {
        workspaceDir: "/tmp",
      }),
      true,
    );

    expect(result?.reply?.text).toContain("Target: Session agent:coder:acp:other");
    expect(result?.reply?.text).toContain("Browser - Browse the web");
    expect(result?.reply?.text).toContain("Docs Lookup - Search internal documentation");
    expect(resolveSessionToolsParamsMock).toHaveBeenCalledWith({
      sessionKey: "agent:coder:acp:other",
      senderIsOwner: false,
    });
    expect(resolveToolsMock).toHaveBeenCalledTimes(2);
  });

  it("ignores unauthorized senders", async () => {
    const { buildCommandTestParams, handleToolsCommand } = await loadToolsHarness();
    const params = buildCommandTestParams("/tools", buildConfig(), undefined, {
      workspaceDir: "/tmp",
    });
    params.command = {
      ...params.command,
      isAuthorizedSender: false,
      senderId: "unauthorized",
    };

    const result = await handleToolsCommand(params, true);

    expect(result).toEqual({ shouldContinue: false });
  });

  it("uses the configured default account when /tools omits AccountId", async () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "telegram",
          source: "test",
          plugin: {
            ...createChannelTestPluginBase({
              id: "telegram",
              label: "Telegram",
              config: {
                listAccountIds: () => ["default", "work"],
                defaultAccountId: () => "work",
                resolveAccount: (_cfg, accountId) => ({ accountId: accountId ?? "work" }),
              },
            }),
          },
        },
      ]),
    );

    const { buildCommandTestParams, handleToolsCommand, resolveToolsMock } =
      await loadToolsHarness();
    const params = buildCommandTestParams(
      "/tools",
      {
        commands: { text: true },
        channels: { telegram: { defaultAccount: "work" } },
      } as OpenClawConfig,
      undefined,
      { workspaceDir: "/tmp" },
    );
    params.agentId = "main";
    params.provider = "openai";
    params.model = "gpt-4.1";
    params.ctx = {
      ...params.ctx,
      OriginatingChannel: "telegram",
      Provider: "telegram",
      Surface: "telegram",
      ChatType: "group",
      AccountId: undefined,
    };
    params.command = {
      ...params.command,
      channel: "telegram",
    };

    await handleToolsCommand(params, true);

    expect(resolveToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "work",
      }),
    );
  });

  it("returns a concise fallback error on effective inventory failures", async () => {
    const { buildCommandTestParams, handleToolsCommand } = await loadToolsHarness({
      resolveTools: () => {
        throw new Error("boom");
      },
    });

    const result = await handleToolsCommand(
      buildCommandTestParams("/tools", buildConfig(), undefined, { workspaceDir: "/tmp" }),
      true,
    );

    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "Couldn't load available tools right now. Try again in a moment." },
    });
  });
});
