import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  applyLocalSetupWorkspaceConfig,
  ensureOnboardingOpenClawCodePluginEnabled,
  ONBOARDING_DEFAULT_DM_SCOPE,
  ONBOARDING_OPENCLAWCODE_PLUGIN_ID,
  ONBOARDING_DEFAULT_TOOLS_PROFILE,
} from "./onboard-config.js";

describe("applyLocalSetupWorkspaceConfig", () => {
  it("defaults local setup tool profile to coding", () => {
    expect(ONBOARDING_DEFAULT_TOOLS_PROFILE).toBe("coding");
  });

  it("enables the bundled openclawcode plugin during local onboarding", () => {
    const result = applyLocalSetupWorkspaceConfig({}, "/tmp/workspace");

    expect(result.plugins?.enabled).toBe(true);
    expect(result.plugins?.allow).toContain(ONBOARDING_OPENCLAWCODE_PLUGIN_ID);
    expect(result.plugins?.entries?.openclawcode?.enabled).toBe(true);
  });

  it("sets secure dmScope default when unset", () => {
    const baseConfig: OpenClawConfig = {};
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe(ONBOARDING_DEFAULT_DM_SCOPE);
    expect(result.gateway?.mode).toBe("local");
    expect(result.agents?.defaults?.workspace).toBe("/tmp/workspace");
    expect(result.tools?.profile).toBe(ONBOARDING_DEFAULT_TOOLS_PROFILE);
  });

  it("preserves existing dmScope when already configured", () => {
    const baseConfig: OpenClawConfig = {
      session: {
        dmScope: "main",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe("main");
  });

  it("preserves explicit non-main dmScope values", () => {
    const baseConfig: OpenClawConfig = {
      session: {
        dmScope: "per-account-channel-peer",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe("per-account-channel-peer");
  });

  it("preserves an explicit tools.profile when already configured", () => {
    const baseConfig: OpenClawConfig = {
      tools: {
        profile: "full",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.tools?.profile).toBe("full");
  });
});

describe("ensureOnboardingOpenClawCodePluginEnabled", () => {
  it("preserves existing plugin config while forcing openclawcode routing on", () => {
    const baseConfig: OpenClawConfig = {
      plugins: {
        enabled: false,
        allow: ["feishu"],
        entries: {
          feishu: {
            enabled: true,
          },
          openclawcode: {
            enabled: false,
            config: {
              repos: [
                {
                  owner: "example",
                  repo: "repo",
                },
              ],
            },
          },
        },
      },
    };

    const result = ensureOnboardingOpenClawCodePluginEnabled(baseConfig);

    expect(result.plugins?.enabled).toBe(true);
    expect(result.plugins?.allow).toEqual(["feishu", "openclawcode"]);
    expect(result.plugins?.entries?.feishu?.enabled).toBe(true);
    expect(result.plugins?.entries?.openclawcode).toMatchObject({
      enabled: true,
      config: {
        repos: [
          {
            owner: "example",
            repo: "repo",
          },
        ],
      },
    });
  });
});
