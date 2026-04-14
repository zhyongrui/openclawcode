import {
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  hasConfiguredSecretInput,
  mergeAllowFromEntries,
  patchTopLevelChannelConfigSection,
  promptSingleChannelSecretInput,
  splitSetupEntries,
  type ChannelSetupDmPolicy,
  type ChannelSetupWizard,
  type DmPolicy,
  type OpenClawConfig,
  type SecretInput,
} from "openclaw/plugin-sdk/setup";
import { normalizeOptionalLowercaseString } from "openclaw/plugin-sdk/text-runtime";
import type { PluginEntryConfig } from "../../../src/config/types.plugins.js";
import { getPreferredOperatorChatTarget } from "../../../src/operator-chat-targets/store.js";
import {
  inspectFeishuCredentials,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
} from "./accounts.js";
import {
  beginAppRegistration,
  getAppOwnerOpenId,
  initAppRegistration,
  pollAppRegistration,
  printQrCode,
  type AppRegistrationResult,
} from "./app-registration.js";
import { probeFeishu } from "./probe.js";
import type { FeishuConfig, FeishuDomain } from "./types.js";

const channel = "feishu" as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}
function hasOpenClawCodePluginEntry(cfg: OpenClawConfig): boolean {
  const entries = cfg.plugins?.entries;
  return Boolean(
    entries &&
    typeof entries === "object" &&
    Object.prototype.hasOwnProperty.call(entries, "openclawcode"),
  );
}

function resolveConfiguredFeishuOperatorContactBinding(params: {
  cfg: OpenClawConfig;
  accountId: string;
}):
  | {
      accountId?: string;
      mode: "email" | "mobile" | "scan";
      email?: string;
      mobile?: string;
    }
  | undefined {
  const binding = (
    params.cfg.plugins?.entries?.openclawcode as
      | { config?: { feishuOperatorBinding?: Record<string, unknown> } }
      | undefined
  )?.config?.feishuOperatorBinding;
  if (!binding || typeof binding !== "object") {
    return undefined;
  }
  const accountId = normalizeString(binding.accountId);
  if (accountId && accountId !== params.accountId) {
    return undefined;
  }
  const mode =
    normalizeString(binding.mode) === "scan"
      ? "scan"
      : normalizeString(binding.mode) === "mobile"
        ? "mobile"
        : "email";
  const email = normalizeString(binding.email);
  const mobile = normalizeString(binding.mobile);
  if (!email && !mobile && mode !== "scan") {
    return undefined;
  }
  return {
    accountId,
    mode: email ? "email" : mobile ? "mobile" : mode,
    email,
    mobile,
  };
}

function patchOpenClawCodeFeishuOperatorContactBinding(params: {
  cfg: OpenClawConfig;
  binding?: {
    accountId?: string;
    mode?: "email" | "mobile" | "scan";
    email?: string;
    mobile?: string;
  };
}): OpenClawConfig {
  const entries =
    params.cfg.plugins?.entries && typeof params.cfg.plugins.entries === "object"
      ? ({ ...(params.cfg.plugins.entries as Record<string, PluginEntryConfig>) } satisfies Record<
          string,
          PluginEntryConfig
        >)
      : {};
  const existingEntry =
    entries.openclawcode && typeof entries.openclawcode === "object"
      ? ({ ...(entries.openclawcode as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const existingConfig =
    existingEntry.config && typeof existingEntry.config === "object"
      ? ({ ...(existingEntry.config as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (params.binding) {
    existingConfig.feishuOperatorBinding = {
      ...(params.binding.accountId ? { accountId: params.binding.accountId } : {}),
      ...(params.binding.mode ? { mode: params.binding.mode } : {}),
      ...(params.binding.email ? { email: params.binding.email } : {}),
      ...(params.binding.mobile ? { mobile: params.binding.mobile } : {}),
    };
  } else {
    delete existingConfig.feishuOperatorBinding;
  }

  entries.openclawcode = {
    ...existingEntry,
    enabled: existingEntry.enabled !== false,
    ...(Object.keys(existingConfig).length > 0 ? { config: existingConfig } : {}),
  };

  return {
    ...params.cfg,
    plugins: {
      ...params.cfg.plugins,
      entries,
    },
  };
}

async function promptFeishuOperatorContactBinding(params: {
  cfg: OpenClawConfig;
  accountId: string;
  prompter: Parameters<NonNullable<ChannelSetupWizard["finalize"]>>[0]["prompter"];
}): Promise<OpenClawConfig> {
  if (!hasOpenClawCodePluginEntry(params.cfg)) {
    return params.cfg;
  }

  const existing = resolveConfiguredFeishuOperatorContactBinding({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const bindingMode = (await params.prompter.select({
    message: "How should we find you on Feishu?",
    options: [
      { value: "email", label: "Work email (Recommended)" },
      { value: "mobile", label: "Mobile number" },
      { value: "scan", label: "Scan bot and send code" },
      { value: "skip", label: "Skip for now" },
    ],
    initialValue:
      existing?.mode ?? (existing?.email ? "email" : existing?.mobile ? "mobile" : "email"),
  })) as "email" | "mobile" | "scan" | "skip";

  if (bindingMode === "skip") {
    return patchOpenClawCodeFeishuOperatorContactBinding({
      cfg: params.cfg,
      binding: undefined,
    });
  }

  if (bindingMode === "scan") {
    return patchOpenClawCodeFeishuOperatorContactBinding({
      cfg: params.cfg,
      binding: {
        ...(params.accountId !== DEFAULT_ACCOUNT_ID ? { accountId: params.accountId } : {}),
        mode: "scan",
      },
    });
  }

  const message =
    bindingMode === "email" ? "Enter your Feishu work email" : "Enter your Feishu mobile number";
  const initialValue = bindingMode === "email" ? existing?.email : existing?.mobile;
  const value = (
    await params.prompter.text({
      message,
      initialValue,
      validate: (raw) => (raw.trim() ? undefined : "Required"),
    })
  ).trim();

  return patchOpenClawCodeFeishuOperatorContactBinding({
    cfg: params.cfg,
    binding: {
      ...(params.accountId !== DEFAULT_ACCOUNT_ID ? { accountId: params.accountId } : {}),
      mode: bindingMode,
      ...(bindingMode === "email" ? { email: value } : { mobile: value }),
    },
  });
}

async function noteFeishuOperatorBinding(params: {
  cfg: OpenClawConfig;
  accountId: string;
  prompter: Parameters<NonNullable<ChannelSetupWizard["finalize"]>>[0]["prompter"];
}): Promise<void> {
  const existingTarget = await getPreferredOperatorChatTarget({
    channel: "feishu",
    accountId: params.accountId,
  });
  if (existingTarget) {
    return;
  }
  const configuredContactBinding = resolveConfiguredFeishuOperatorContactBinding({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  if (configuredContactBinding) {
    if (configuredContactBinding.mode === "scan") {
      await params.prompter.note(
        [
          "OpenClaw will wait until startup before showing the Feishu bot QR code and one-time code.",
          "This wizard will not show the QR code too early.",
          "Once Gateway and Feishu are ready, scan the bot and send the code to finish setup.",
        ].join("\n"),
        "Find you on Feishu",
      );
      return;
    }
    const contactLabel =
      configuredContactBinding.mode === "email"
        ? `Work email: ${configuredContactBinding.email}`
        : `Mobile number: ${configuredContactBinding.mobile}`;
    await params.prompter.note(
      [
        "OpenClaw will use this contact to find you on Feishu.",
        contactLabel,
        "After startup, OpenClaw will look up your open_id and send the first welcome message.",
      ].join("\n"),
      "Find you on Feishu",
    );
    return;
  }
  await params.prompter.note(
    [
      "OpenClaw does not yet know how to find you on Feishu.",
      "If you want it to send the first welcome message and later notifications, rerun setup and provide your work email, mobile number, or choose scan bot and send code.",
    ].join("\n"),
    "Find you on Feishu",
  );
}
function isFeishuConfigured(cfg: OpenClawConfig, accountId?: string | null): boolean {
  const feishuCfg = ((cfg.channels?.feishu as FeishuConfig | undefined) ?? {}) as FeishuConfig;
  const configuredAccountId = normalizeOptionalLowercaseString(accountId);
  const resolvedAccountId = configuredAccountId ?? resolveDefaultFeishuAccountId(cfg);

  const isAppIdConfigured = (value: unknown): boolean => {
    const asString = normalizeString(value);
    if (asString) {
      return true;
    }
    if (!value || typeof value !== "object") {
      return false;
    }
    const rec = value as Record<string, unknown>;
    const source = normalizeString(rec.source)?.toLowerCase();
    const id = normalizeString(rec.id);
    if (source === "env" && id) {
      return Boolean(normalizeString(process.env[id]));
    }
    return hasConfiguredSecretInput(value);
  };

  const topLevelConfigured =
    isAppIdConfigured(feishuCfg?.appId) && hasConfiguredSecretInput(feishuCfg?.appSecret);

  if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    return topLevelConfigured;
  }

  const account = feishuCfg.accounts?.[resolvedAccountId];
  if (!account || typeof account !== "object") {
    return topLevelConfigured;
  }

  const hasOwnAppId = Object.prototype.hasOwnProperty.call(account, "appId");
  const hasOwnAppSecret = Object.prototype.hasOwnProperty.call(account, "appSecret");
  const accountAppIdConfigured = hasOwnAppId
    ? isAppIdConfigured((account as Record<string, unknown>).appId)
    : isAppIdConfigured(feishuCfg?.appId);
  const accountSecretConfigured = hasOwnAppSecret
    ? hasConfiguredSecretInput((account as Record<string, unknown>).appSecret)
    : hasConfiguredSecretInput(feishuCfg?.appSecret);

  return accountAppIdConfigured && accountSecretConfigured;
}

/**
 * Patch feishu config at the correct location based on accountId.
 * - DEFAULT_ACCOUNT_ID → writes to top-level channels.feishu
 * - named account → writes to channels.feishu.accounts[accountId]
 */
function patchFeishuConfig(
  cfg: OpenClawConfig,
  accountId: string,
  patch: Record<string, unknown>,
): OpenClawConfig {
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return patchTopLevelChannelConfigSection({
      cfg,
      channel,
      enabled: true,
      patch,
    });
  }
  const nextAccountPatch = {
    ...(feishuCfg?.accounts?.[accountId] as Record<string, unknown> | undefined),
    enabled: true,
    ...patch,
  };
  return patchTopLevelChannelConfigSection({
    cfg,
    channel,
    enabled: true,
    patch: {
      accounts: {
        ...feishuCfg?.accounts,
        [accountId]: nextAccountPatch,
      },
    },
  });
}

async function promptFeishuAllowFrom(params: {
  cfg: OpenClawConfig;
  accountId?: string;
  prompter: Parameters<NonNullable<ChannelSetupDmPolicy["promptAllowFrom"]>>[0]["prompter"];
}): Promise<OpenClawConfig> {
  const feishuCfg = params.cfg.channels?.feishu as FeishuConfig | undefined;
  const resolvedAccountId = params.accountId ?? resolveDefaultFeishuAccountId(params.cfg);
  const account =
    resolvedAccountId !== DEFAULT_ACCOUNT_ID
      ? (feishuCfg?.accounts?.[resolvedAccountId] as Record<string, unknown> | undefined)
      : undefined;
  const existingAllowFrom = (account?.allowFrom ?? feishuCfg?.allowFrom ?? []) as Array<
    string | number
  >;
  await params.prompter.note(
    [
      "Allowlist Feishu DMs by open_id or user_id.",
      "You can find user open_id in Feishu admin console or via API.",
      "Examples:",
      "- ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "- on_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    ].join("\n"),
    "Feishu allowlist",
  );
  const entry = await params.prompter.text({
    message: "Feishu allowFrom (user open_ids)",
    placeholder: "ou_xxxxx, ou_yyyyy",
    initialValue:
      existingAllowFrom.length > 0 ? existingAllowFrom.map(String).join(", ") : undefined,
  });
  const mergedAllowFrom = mergeAllowFromEntries(existingAllowFrom, splitSetupEntries(entry));
  return patchFeishuConfig(params.cfg, resolvedAccountId, { allowFrom: mergedAllowFrom });
}

async function noteFeishuCredentialHelp(
  prompter: Parameters<NonNullable<ChannelSetupWizard["finalize"]>>[0]["prompter"],
): Promise<void> {
  await prompter.note(
    [
      "1) Go to Feishu Open Platform (open.feishu.cn)",
      "2) Create a self-built app",
      "3) Get App ID and App Secret from Credentials page",
      "4) Enable required permissions: im:message, im:chat, contact:user.base:readonly, contact:user.id:readonly",
      "5) Publish the app or add it to a test group",
      "Tip: you can also set FEISHU_APP_ID / FEISHU_APP_SECRET env vars.",
      `Docs: ${formatDocsLink("/channels/feishu", "feishu")}`,
    ].join("\n"),
    "Feishu credentials",
  );
}

async function promptFeishuAppId(params: {
  prompter: Parameters<NonNullable<ChannelSetupWizard["finalize"]>>[0]["prompter"];
  initialValue?: string;
}): Promise<string> {
  return (
    await params.prompter.text({
      message: "Enter Feishu App ID",
      initialValue: params.initialValue,
      validate: (value) => (value?.trim() ? undefined : "Required"),
    })
  ).trim();
}

const feishuDmPolicy: ChannelSetupDmPolicy = {
  label: "Feishu",
  channel,
  policyKey: "channels.feishu.dmPolicy",
  allowFromKey: "channels.feishu.allowFrom",
  resolveConfigKeys: (_cfg, accountId) => {
    const resolvedAccountId = accountId ?? resolveDefaultFeishuAccountId(_cfg);
    return resolvedAccountId !== DEFAULT_ACCOUNT_ID
      ? {
          policyKey: `channels.feishu.accounts.${resolvedAccountId}.dmPolicy`,
          allowFromKey: `channels.feishu.accounts.${resolvedAccountId}.allowFrom`,
        }
      : {
          policyKey: "channels.feishu.dmPolicy",
          allowFromKey: "channels.feishu.allowFrom",
        };
  },
  getCurrent: (cfg, accountId) => {
    const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
    const resolvedAccountId = accountId ?? resolveDefaultFeishuAccountId(cfg);
    if (resolvedAccountId !== DEFAULT_ACCOUNT_ID) {
      const account = feishuCfg?.accounts?.[resolvedAccountId] as
        | Record<string, unknown>
        | undefined;
      if (account?.dmPolicy) {
        return account.dmPolicy as DmPolicy;
      }
    }
    return (feishuCfg?.dmPolicy as DmPolicy | undefined) ?? "pairing";
  },
  setPolicy: (cfg, policy, accountId) => {
    const resolvedAccountId = accountId ?? resolveDefaultFeishuAccountId(cfg);
    return patchFeishuConfig(cfg, resolvedAccountId, {
      dmPolicy: policy,
      ...(policy === "open" ? { allowFrom: mergeAllowFromEntries([], ["*"]) } : {}),
    });
  },
  promptAllowFrom: promptFeishuAllowFrom,
};

type WizardPrompter = Parameters<NonNullable<ChannelSetupWizard["finalize"]>>[0]["prompter"];

// ---------------------------------------------------------------------------
// Security policy helpers
// ---------------------------------------------------------------------------

function applyNewAppSecurityPolicy(
  cfg: OpenClawConfig,
  accountId: string,
  openId: string | undefined,
  groupPolicy: "allowlist" | "open" | "disabled",
): OpenClawConfig {
  let next = cfg;

  if (openId) {
    // dmPolicy=allowlist, allowFrom=[openId]
    next = patchFeishuConfig(next, accountId, { dmPolicy: "allowlist", allowFrom: [openId] });
  }

  // Apply group policy.
  const groupPatch: Record<string, unknown> = { groupPolicy };
  if (groupPolicy === "open") {
    groupPatch.requireMention = true;
  }
  next = patchFeishuConfig(next, accountId, groupPatch);

  return next;
}

// ---------------------------------------------------------------------------
// Scan-to-create flow
// ---------------------------------------------------------------------------

async function runScanToCreate(prompter: WizardPrompter): Promise<AppRegistrationResult | null> {
  try {
    await initAppRegistration("feishu");
  } catch {
    await prompter.note(
      "Scan-to-create is not available in this environment. Falling back to manual input.",
      "Feishu setup",
    );
    return null;
  }

  const begin = await beginAppRegistration("feishu");

  await prompter.note("Scan the QR with Lark/Feishu on your phone.", "Feishu scan-to-create");
  await printQrCode(begin.qrUrl);

  const progress = prompter.progress("Fetching configuration results...");

  const outcome = await pollAppRegistration({
    deviceCode: begin.deviceCode,
    interval: begin.interval,
    expireIn: begin.expireIn,
    initialDomain: "feishu",
    tp: "ob_app",
  });

  switch (outcome.status) {
    case "success":
      progress.stop("Scan completed.");
      return outcome.result;
    case "access_denied":
      progress.stop("User denied authorization. Falling back to manual input.");
      return null;
    case "expired":
      progress.stop("Session expired. Falling back to manual input.");
      return null;
    case "timeout":
      progress.stop("Scan timed out. Falling back to manual input.");
      return null;
    case "error":
      progress.stop(`Registration error: ${outcome.message}. Falling back to manual input.`);
      return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// New app configuration flow
// ---------------------------------------------------------------------------

async function runNewAppFlow(params: {
  cfg: OpenClawConfig;
  accountId?: string;
  prompter: WizardPrompter;
  options: Parameters<NonNullable<ChannelSetupWizard["finalize"]>>[0]["options"];
}): Promise<{ cfg: OpenClawConfig }> {
  const { prompter, options } = params;
  let next = params.cfg;

  const targetAccountId =
    normalizeOptionalLowercaseString(params.accountId) ?? resolveDefaultFeishuAccountId(next);

  // ----- QR scan flow -----
  let appId: string | null = null;
  let appSecret: SecretInput | null = null;
  let appSecretProbeValue: string | null = null;
  let scanDomain: FeishuDomain | undefined;
  let scanOpenId: string | undefined;

  const scanResult = await runScanToCreate(prompter);
  if (scanResult) {
    appId = scanResult.appId;
    appSecret = scanResult.appSecret;
    appSecretProbeValue = scanResult.appSecret;
    scanDomain = scanResult.domain;
    scanOpenId = scanResult.openId;
  } else {
    // Fallback to manual input: collect domain, appId, appSecret.
    const feishuCfg = next.channels?.feishu as FeishuConfig | undefined;
    await noteFeishuCredentialHelp(prompter);

    // Domain selection first (needed for API calls).
    const currentDomain = feishuCfg?.domain ?? "feishu";
    const domain = (await prompter.select({
      message: "Which Feishu domain?",
      options: [
        { value: "feishu", label: "Feishu (feishu.cn) - China" },
        { value: "lark", label: "Lark (larksuite.com) - International" },
      ],
      initialValue: currentDomain,
    })) as FeishuDomain;
    scanDomain = domain;

    appId = await promptFeishuAppId({
      prompter,
      initialValue: normalizeString(process.env.FEISHU_APP_ID),
    });

    const appSecretResult = await promptSingleChannelSecretInput({
      cfg: next,
      prompter,
      providerHint: "feishu",
      credentialLabel: "App Secret",
      secretInputMode: options?.secretInputMode,
      accountConfigured: false,
      canUseEnv: false,
      hasConfigToken: false,
      envPrompt: "",
      keepPrompt: "Feishu App Secret already configured. Keep it?",
      inputPrompt: "Enter Feishu App Secret",
      preferredEnvVar: "FEISHU_APP_SECRET",
    });
    if (appSecretResult.action === "set") {
      appSecret = appSecretResult.value;
      appSecretProbeValue = appSecretResult.resolvedValue;
    }

    // Fetch openId via API for manual flow.
    if (appId && appSecretProbeValue) {
      scanOpenId = await getAppOwnerOpenId({
        appId,
        appSecret: appSecretProbeValue,
        domain: scanDomain,
      });
    }
  }

  // ----- Group chat policy -----
  const groupPolicy = (await prompter.select({
    message: "Group chat policy",
    options: [
      { value: "allowlist", label: "Allowlist - only respond in specific groups" },
      { value: "open", label: "Open - respond in all groups (requires mention)" },
      { value: "disabled", label: "Disabled - don't respond in groups" },
    ],
    initialValue: "allowlist",
  })) as "allowlist" | "open" | "disabled";

  // ----- Apply credentials & security policy -----
  const configProgress = prompter.progress("Configuring...");
  await new Promise((resolve) => setTimeout(resolve, 50));

  if (appId && appSecret) {
    next = patchFeishuConfig(next, targetAccountId, {
      appId,
      appSecret,
      connectionMode: "websocket",
      ...(scanDomain ? { domain: scanDomain } : {}),
    });
  } else if (scanDomain) {
    next = patchFeishuConfig(next, targetAccountId, { domain: scanDomain });
  }

  next = applyNewAppSecurityPolicy(next, targetAccountId, scanOpenId, groupPolicy);

  if (groupPolicy === "allowlist") {
    const existingGroupAllowFrom =
      resolveFeishuAccount({ cfg: next, accountId: targetAccountId }).config.groupAllowFrom ?? [];
    const groupAllowFrom = await prompter.text({
      message: "Group chat allowlist (chat_ids)",
      placeholder: "oc_xxxxx, oc_yyyyy",
      initialValue:
        existingGroupAllowFrom.length > 0
          ? existingGroupAllowFrom.map(String).join(", ")
          : undefined,
    });
    const parts = splitSetupEntries(groupAllowFrom ?? "");
    if (parts.length > 0) {
      next = patchFeishuConfig(next, targetAccountId, { groupAllowFrom: parts });
    }
  }

  next = await promptFeishuOperatorContactBinding({
    cfg: next,
    accountId: targetAccountId,
    prompter,
  });

  await noteFeishuOperatorBinding({
    cfg: next,
    accountId: targetAccountId,
    prompter,
  });

  configProgress.stop("Bot configured.");

  return { cfg: next };
}

// ---------------------------------------------------------------------------
// Edit configuration flow
// ---------------------------------------------------------------------------

async function runEditFlow(params: {
  cfg: OpenClawConfig;
  accountId?: string;
  prompter: WizardPrompter;
  options: Parameters<NonNullable<ChannelSetupWizard["finalize"]>>[0]["options"];
}): Promise<{ cfg: OpenClawConfig } | null> {
  const { prompter, options } = params;
  let next = params.cfg;
  const feishuCfg = next.channels?.feishu as FeishuConfig | undefined;
  const targetAccountId =
    normalizeOptionalLowercaseString(params.accountId) ?? resolveDefaultFeishuAccountId(next);

  // Check existing appId (top-level or first configured account).
  // Supports both plain string and SecretRef (env-backed) appId values.
  const resolveAppIdLabel = (value: unknown): string | undefined => {
    const asString = normalizeString(value);
    if (asString) {
      return asString;
    }
    if (value && typeof value === "object") {
      const rec = value as Record<string, unknown>;
      if (normalizeString(rec.source) && normalizeString(rec.id)) {
        const envValue = normalizeString(process.env[rec.id as string]);
        return envValue ?? `env:${String(rec.id)}`;
      }
      if (hasConfiguredSecretInput(value)) {
        return "(configured)";
      }
    }
    return undefined;
  };
  const existingAppId =
    resolveAppIdLabel(feishuCfg?.appId) ??
    Object.values(feishuCfg?.accounts ?? {}).reduce<string | undefined>((found, account) => {
      if (found) {
        return found;
      }
      if (account && typeof account === "object") {
        return resolveAppIdLabel((account as Record<string, unknown>).appId);
      }
      return undefined;
    }, undefined);
  if (existingAppId) {
    const useExisting = await prompter.confirm({
      message: `We found an existing bot (App ID: ${existingAppId}). Use it for this setup?`,
      initialValue: true,
    });

    if (!useExisting) {
      // User wants a new bot — run new app flow.
      return runNewAppFlow({ cfg: next, accountId: targetAccountId, prompter, options });
    }
  } else {
    // No existing appId — run new app flow.
    return runNewAppFlow({ cfg: next, accountId: targetAccountId, prompter, options });
  }

  next = await promptFeishuOperatorContactBinding({
    cfg: next,
    accountId: targetAccountId,
    prompter,
  });

  await noteFeishuOperatorBinding({
    cfg: next,
    accountId: targetAccountId,
    prompter,
  });

  await prompter.note("Bot configured.", "");

  return { cfg: next };
}

// ---------------------------------------------------------------------------
// Standalone login entry point (for `channels login --channel feishu`)
// ---------------------------------------------------------------------------

export async function runFeishuLogin(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
}): Promise<OpenClawConfig> {
  const { cfg, prompter } = params;
  const options = {};
  const alreadyConfigured = isFeishuConfigured(cfg);

  if (alreadyConfigured) {
    const result = await runEditFlow({ cfg, prompter, options });
    if (result === null) {
      return cfg;
    }
    return result.cfg;
  }

  const result = await runNewAppFlow({ cfg, prompter, options });
  return result.cfg;
}

// ---------------------------------------------------------------------------
// Exported wizard
// ---------------------------------------------------------------------------

export { feishuSetupAdapter } from "./setup-core.js";

export const feishuSetupWizard: ChannelSetupWizard = {
  channel,
  resolveAccountIdForConfigure: ({ accountOverride, defaultAccountId, cfg }) =>
    (typeof accountOverride === "string" && accountOverride.trim()
      ? accountOverride.trim()
      : undefined) ??
    resolveDefaultFeishuAccountId(cfg) ??
    defaultAccountId,
  resolveShouldPromptAccountIds: () => false,
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs app credentials",
    configuredHint: "configured",
    unconfiguredHint: "needs app creds",
    configuredScore: 2,
    unconfiguredScore: 0,
    resolveConfigured: ({ cfg, accountId }) => isFeishuConfigured(cfg, accountId),
    resolveStatusLines: async ({ cfg, accountId, configured }) => {
      const resolvedCredentials = accountId
        ? (() => {
            const account = resolveFeishuAccount({ cfg, accountId });
            return account.configured && account.appId && account.appSecret
              ? {
                  appId: account.appId,
                  appSecret: account.appSecret,
                  encryptKey: account.encryptKey,
                  verificationToken: account.verificationToken,
                  domain: account.domain,
                }
              : null;
          })()
        : inspectFeishuCredentials(cfg.channels?.feishu as FeishuConfig | undefined);
      let probeResult = null;
      if (configured && resolvedCredentials) {
        try {
          probeResult = await probeFeishu(resolvedCredentials);
        } catch {}
      }
      if (!configured) {
        return ["Feishu: needs app credentials"];
      }
      if (probeResult?.ok) {
        return [`Feishu: connected as ${probeResult.botName ?? probeResult.botOpenId ?? "bot"}`];
      }
      return ["Feishu: configured (connection not verified)"];
    },
  },

  // -------------------------------------------------------------------------
  // prepare: determine flow based on existing configuration
  // -------------------------------------------------------------------------
  prepare: async ({ cfg, credentialValues }) => {
    const alreadyConfigured = isFeishuConfigured(cfg);

    if (alreadyConfigured) {
      return {
        credentialValues: { ...credentialValues, _flow: "edit" },
      };
    }
    return {
      credentialValues: { ...credentialValues, _flow: "new" },
    };
  },

  credentials: [],

  // -------------------------------------------------------------------------
  // finalize: run the appropriate flow
  // -------------------------------------------------------------------------
  finalize: async ({ cfg, accountId, prompter, options, credentialValues }) => {
    const flow = credentialValues._flow ?? "new";

    if (flow === "edit") {
      const result = await runEditFlow({
        cfg,
        accountId,
        prompter,
        options,
      });
      if (result === null) {
        return { cfg };
      }
      return result;
    }

    return runNewAppFlow({
      cfg,
      accountId,
      prompter,
      options,
    });
  },

  dmPolicy: feishuDmPolicy,
  disable: (cfg) =>
    patchTopLevelChannelConfigSection({
      cfg,
      channel,
      patch: { enabled: false },
    }),
};
