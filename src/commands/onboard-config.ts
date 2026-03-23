import type { OpenClawConfig } from "../config/config.js";
import type { DmScope } from "../config/types.base.js";
import type { ToolProfileId } from "../config/types.tools.js";

export const ONBOARDING_DEFAULT_DM_SCOPE: DmScope = "per-channel-peer";
export const ONBOARDING_DEFAULT_TOOLS_PROFILE: ToolProfileId = "coding";
export const ONBOARDING_OPENCLAWCODE_PLUGIN_ID = "openclawcode";

export function ensureOnboardingOpenClawCodePluginEnabled(
  baseConfig: OpenClawConfig,
): OpenClawConfig {
  const allow = Array.isArray(baseConfig.plugins?.allow) ? [...baseConfig.plugins.allow] : [];
  if (!allow.includes(ONBOARDING_OPENCLAWCODE_PLUGIN_ID)) {
    allow.push(ONBOARDING_OPENCLAWCODE_PLUGIN_ID);
  }

  return {
    ...baseConfig,
    plugins: {
      ...baseConfig.plugins,
      enabled: true,
      allow,
      entries: {
        ...baseConfig.plugins?.entries,
        [ONBOARDING_OPENCLAWCODE_PLUGIN_ID]: {
          ...baseConfig.plugins?.entries?.[ONBOARDING_OPENCLAWCODE_PLUGIN_ID],
          enabled: true,
        },
      },
    },
  };
}

export function applyLocalSetupWorkspaceConfig(
  baseConfig: OpenClawConfig,
  workspaceDir: string,
): OpenClawConfig {
  return ensureOnboardingOpenClawCodePluginEnabled({
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
    session: {
      ...baseConfig.session,
      dmScope: baseConfig.session?.dmScope ?? ONBOARDING_DEFAULT_DM_SCOPE,
    },
    tools: {
      ...baseConfig.tools,
      profile: baseConfig.tools?.profile ?? ONBOARDING_DEFAULT_TOOLS_PROFILE,
    },
  });
}
