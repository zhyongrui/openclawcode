import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { buildCommandsMessage, buildHelpMessage, buildToolsMessage } from "./status.js";

vi.mock("../plugins/commands.js", () => ({
  listPluginCommands: () => [],
}));

describe("tools product copy", () => {
  it("mentions /tools in command discovery copy", () => {
    const cfg = {
      commands: { config: false, debug: false },
    } as unknown as OpenClawConfig;

    expect(buildCommandsMessage(cfg)).toContain("/tools - List available runtime tools.");
    expect(buildCommandsMessage(cfg)).toContain("More: /tools for available capabilities");
    expect(buildHelpMessage(cfg)).toContain("/tools for available capabilities");
  });

  it("formats built-in and plugin tools for end users", () => {
    const text = buildToolsMessage({
      agentId: "main",
      profile: "coding",
      assembly: {
        counts: { total: 3, core: 2, plugin: 1, channel: 0 },
        context: {
          messageProvider: "telegram",
          modelProvider: "openai",
          modelId: "gpt-5.4",
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
            severity: "info",
            message: 'Tool profile "coding" may hide capabilities that are available in fuller profiles.',
          },
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
            {
              id: "web_search",
              label: "Web Search",
              description: "Search the web",
              rawDescription: "Search the web",
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
    });

    expect(text).toContain("Available tools");
    expect(text).toContain("Profile: coding");
    expect(text).toContain("Runtime: 3 total | 2 built-in | 1 plugin | 0 channel | channel=telegram | model=openai/gpt-5.4");
    expect(text).toContain(
      'Restrictions: Tool profile "coding" may hide capabilities that are available in fuller profiles. | Owner-only tools are hidden because the current caller is not an owner.',
    );
    expect(text).toContain("Built-in tools");
    expect(text).toContain("exec, web_search");
    expect(text).toContain("Connected tools");
    expect(text).toContain("docs_lookup (docs)");
    expect(text).toContain("Use /tools verbose for descriptions.");
    expect(text).not.toContain("unavailable right now");
  });

  it("keeps detailed descriptions in verbose mode", () => {
    const text = buildToolsMessage(
      {
        agentId: "main",
        profile: "minimal",
        assembly: {
          counts: { total: 1, core: 1, plugin: 0, channel: 0 },
          context: {
            messageProvider: "discord",
            replyToMode: "first",
            senderIsOwner: true,
          },
          flags: {
            allowGatewaySubagentBinding: true,
            requireExplicitMessageTarget: false,
            disableMessageTool: false,
          },
          notes: [
            {
              id: "profile-gated",
              severity: "info",
              message:
                'Tool profile "minimal" may hide capabilities that are available in fuller profiles.',
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
      },
      { verbose: true },
    );

    expect(text).toContain("What this agent can use right now:");
    expect(text).toContain("Profile: minimal");
    expect(text).toContain(
      "Runtime: 1 total | 1 built-in | 0 plugin | 0 channel | channel=discord | reply=first | owner=yes",
    );
    expect(text).toContain(
      'Restrictions: Tool profile "minimal" may hide capabilities that are available in fuller profiles.',
    );
    expect(text).toContain("Exec - Run shell commands");
    expect(text).toContain("Tool availability depends on this agent's configuration.");
    expect(text).not.toContain("unavailable right now");
  });

  it("trims verbose output before schema-like doc blocks", () => {
    const text = buildToolsMessage(
      {
        agentId: "main",
        profile: "coding",
        assembly: {
          counts: { total: 1, core: 1, plugin: 0, channel: 0 },
          context: { senderIsOwner: false },
          flags: {
            allowGatewaySubagentBinding: true,
            requireExplicitMessageTarget: false,
            disableMessageTool: false,
          },
          notes: [
            {
              id: "profile-gated",
              severity: "info",
              message:
                'Tool profile "coding" may hide capabilities that are available in fuller profiles.',
            },
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
                id: "cron",
                label: "Cron",
                description: "Schedule and manage cron jobs.",
                rawDescription:
                  "Manage Gateway cron jobs and send wake events.\n\nACTIONS:\n- status: Check cron scheduler status\nJOB SCHEMA:\n{ ... }",
                source: "core",
              },
            ],
          },
        ],
      },
      { verbose: true },
    );

    expect(text).toContain("Cron - Manage Gateway cron jobs and send wake events.");
    expect(text).not.toContain("ACTIONS:");
    expect(text).not.toContain("JOB SCHEMA:");
  });

  it("returns the empty state when no tools are available", () => {
    expect(
      buildToolsMessage({
        agentId: "main",
        profile: "full",
        assembly: {
          counts: { total: 0, core: 0, plugin: 0, channel: 0 },
          context: { senderIsOwner: false },
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
      groups: [],
    }),
    ).toBe(
      "No tools are available for this agent right now.\n\nProfile: full\nRestrictions: Owner-only tools are hidden because the current caller is not an owner.",
    );
  });
});
