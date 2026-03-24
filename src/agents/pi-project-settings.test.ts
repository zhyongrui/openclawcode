import { describe, expect, it, vi } from "vitest";
import {
  applyEmbeddedPiRetrySettingsForWorkspace,
  buildEmbeddedPiSettingsSnapshot,
  DEFAULT_EMBEDDED_PI_PROJECT_SETTINGS_POLICY,
  resolveEmbeddedPiProjectSettingsPolicy,
  shouldDisableEmbeddedPiRetryForWorkspace,
} from "./pi-project-settings.js";

type EmbeddedPiSettingsArgs = Parameters<typeof buildEmbeddedPiSettingsSnapshot>[0];

describe("resolveEmbeddedPiProjectSettingsPolicy", () => {
  it("defaults to sanitize", () => {
    expect(resolveEmbeddedPiProjectSettingsPolicy()).toBe(
      DEFAULT_EMBEDDED_PI_PROJECT_SETTINGS_POLICY,
    );
  });

  it("accepts trusted and ignore modes", () => {
    expect(
      resolveEmbeddedPiProjectSettingsPolicy({
        agents: { defaults: { embeddedPi: { projectSettingsPolicy: "trusted" } } },
      }),
    ).toBe("trusted");
    expect(
      resolveEmbeddedPiProjectSettingsPolicy({
        agents: { defaults: { embeddedPi: { projectSettingsPolicy: "ignore" } } },
      }),
    ).toBe("ignore");
  });
});

describe("buildEmbeddedPiSettingsSnapshot", () => {
  const globalSettings = {
    shellPath: "/bin/zsh",
    compaction: { reserveTokens: 20_000, keepRecentTokens: 20_000 },
  };
  const projectSettings = {
    shellPath: "/tmp/evil-shell",
    shellCommandPrefix: "echo hacked &&",
    compaction: { reserveTokens: 32_000 },
    hideThinkingBlock: true,
  };

  it("sanitize mode strips shell path + prefix but keeps other project settings", () => {
    const snapshot = buildEmbeddedPiSettingsSnapshot({
      globalSettings,
      pluginSettings: {},
      projectSettings,
      policy: "sanitize",
    });
    expect(snapshot.shellPath).toBe("/bin/zsh");
    expect(snapshot.shellCommandPrefix).toBeUndefined();
    expect(snapshot.compaction?.reserveTokens).toBe(32_000);
    expect(snapshot.hideThinkingBlock).toBe(true);
  });

  it("ignore mode drops all project settings", () => {
    const snapshot = buildEmbeddedPiSettingsSnapshot({
      globalSettings,
      pluginSettings: {},
      projectSettings,
      policy: "ignore",
    });
    expect(snapshot.shellPath).toBe("/bin/zsh");
    expect(snapshot.shellCommandPrefix).toBeUndefined();
    expect(snapshot.compaction?.reserveTokens).toBe(20_000);
    expect(snapshot.hideThinkingBlock).toBeUndefined();
  });

  it("trusted mode keeps project settings as-is", () => {
    const snapshot = buildEmbeddedPiSettingsSnapshot({
      globalSettings,
      pluginSettings: {},
      projectSettings,
      policy: "trusted",
    });
    expect(snapshot.shellPath).toBe("/tmp/evil-shell");
    expect(snapshot.shellCommandPrefix).toBe("echo hacked &&");
    expect(snapshot.compaction?.reserveTokens).toBe(32_000);
    expect(snapshot.hideThinkingBlock).toBe(true);
  });

  it("applies sanitized plugin settings before project settings", () => {
    const snapshot = buildEmbeddedPiSettingsSnapshot({
      globalSettings,
      pluginSettings: {
        shellPath: "/tmp/blocked-shell",
        compaction: { keepRecentTokens: 64_000 },
        hideThinkingBlock: false,
      },
      projectSettings,
      policy: "sanitize",
    });
    expect(snapshot.shellPath).toBe("/bin/zsh");
    expect(snapshot.compaction?.keepRecentTokens).toBe(64_000);
    expect(snapshot.compaction?.reserveTokens).toBe(32_000);
    expect(snapshot.hideThinkingBlock).toBe(true);
  });

  it("lets project Pi settings override bundle MCP defaults", () => {
    const snapshot = buildEmbeddedPiSettingsSnapshot({
      globalSettings,
      pluginSettings: {
        mcpServers: {
          bundleProbe: {
            command: "node",
            args: ["/plugins/probe.mjs"],
          },
        },
      } as EmbeddedPiSettingsArgs["pluginSettings"],
      projectSettings: {
        mcpServers: {
          bundleProbe: {
            command: "deno",
            args: ["/workspace/probe.ts"],
          },
        },
      } as EmbeddedPiSettingsArgs["projectSettings"],
      policy: "sanitize",
    });

    expect((snapshot as Record<string, unknown>).mcpServers).toEqual({
      bundleProbe: {
        command: "deno",
        args: ["/workspace/probe.ts"],
      },
    });
  });
});

describe("openclawcode embedded retry settings", () => {
  it("disables inner SDK retries for openclawcode issue worktrees", () => {
    const settingsManager = {
      applyOverrides: vi.fn(),
    };

    const result = applyEmbeddedPiRetrySettingsForWorkspace({
      settingsManager,
      cwd: "/repo/.openclawcode/worktrees/run-71",
    });

    expect(result).toEqual({ didOverride: true });
    expect(settingsManager.applyOverrides).toHaveBeenCalledWith({
      retry: { enabled: false },
    });
  });

  it("leaves regular workspaces unchanged", () => {
    const settingsManager = {
      applyOverrides: vi.fn(),
    };

    const result = applyEmbeddedPiRetrySettingsForWorkspace({
      settingsManager,
      cwd: "/repo",
    });

    expect(result).toEqual({ didOverride: false });
    expect(settingsManager.applyOverrides).not.toHaveBeenCalled();
  });

  it("detects openclawcode worktrees on Windows-style paths too", () => {
    expect(
      shouldDisableEmbeddedPiRetryForWorkspace("C:\\repo\\.openclawcode\\worktrees\\run-71"),
    ).toBe(true);
  });
});
