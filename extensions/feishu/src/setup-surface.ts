import {
  buildSingleChannelSecretPromptState,
  createTopLevelChannelAllowFromSetter,
  createTopLevelChannelDmPolicy,
  createTopLevelChannelGroupPolicySetter,
  createTopLevelChannelParsedAllowFromPrompt,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  hasConfiguredSecretInput,
  mergeAllowFromEntries,
  patchTopLevelChannelConfigSection,
  promptSingleChannelSecretInput,
  splitSetupEntries,
  type ChannelSetupDmPolicy,
  type ChannelSetupWizard,
  type OpenClawConfig,
  type SecretInput,
} from "openclaw/plugin-sdk/setup";
import type { PluginEntryConfig } from "../../../src/config/types.plugins.js";
import { getPreferredOperatorChatTarget } from "../../../src/operator-chat-targets/store.js";
import { inspectFeishuCredentials, listFeishuAccountIds } from "./accounts.js";
import { probeFeishu } from "./probe.js";
import { feishuSetupAdapter } from "./setup-core.js";
import type { FeishuConfig } from "./types.js";

const channel = "feishu" as const;
const setFeishuAllowFrom = createTopLevelChannelAllowFromSetter({
  channel,
});
const setFeishuGroupPolicy = createTopLevelChannelGroupPolicySetter({
  channel,
  enabled: true,
});

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function setFeishuGroupAllowFrom(cfg: OpenClawConfig, groupAllowFrom: string[]): OpenClawConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      feishu: {
        ...cfg.channels?.feishu,
        groupAllowFrom,
      },
    },
  };
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
}): { accountId?: string; email?: string; mobile?: string } | undefined {
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
  const email = normalizeString(binding.email);
  const mobile = normalizeString(binding.mobile);
  if (!email && !mobile) {
    return undefined;
  }
  return {
    accountId,
    email,
    mobile,
  };
}

function patchOpenClawCodeFeishuOperatorContactBinding(params: {
  cfg: OpenClawConfig;
  binding?: {
    accountId?: string;
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
      ...(params.binding.email ? { email: params.binding.email } : {}),
      ...(params.binding.mobile ? { mobile: params.binding.mobile } : {}),
    };
  } else {
    delete existingConfig.feishuOperatorBinding;
  }

  entries.openclawcode = {
    ...existingEntry,
    enabled: existingEntry.enabled === false ? false : true,
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
    message: "OpenClaw Code 飞书绑定方式",
    options: [
      { value: "email", label: "邮箱（推荐）" },
      { value: "mobile", label: "手机号" },
      { value: "skip", label: "暂不绑定" },
    ],
    initialValue: existing?.email ? "email" : existing?.mobile ? "mobile" : "email",
  })) as "email" | "mobile" | "skip";

  if (bindingMode === "skip") {
    return patchOpenClawCodeFeishuOperatorContactBinding({
      cfg: params.cfg,
      binding: undefined,
    });
  }

  const message = bindingMode === "email" ? "输入要绑定的飞书邮箱" : "输入要绑定的飞书手机号";
  const initialValue = bindingMode === "email" ? existing?.email : existing?.mobile;
  const value = String(
    await params.prompter.text({
      message,
      initialValue,
      validate: (raw) => (String(raw ?? "").trim() ? undefined : "Required"),
    }),
  ).trim();

  return patchOpenClawCodeFeishuOperatorContactBinding({
    cfg: params.cfg,
    binding: {
      ...(params.accountId !== DEFAULT_ACCOUNT_ID ? { accountId: params.accountId } : {}),
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
    const contactLabel = configuredContactBinding.email
      ? `邮箱: ${configuredContactBinding.email}`
      : `手机号: ${configuredContactBinding.mobile}`;
    await params.prompter.note(
      [
        "已检测到 openclawcode 的飞书联系方式直绑配置。",
        contactLabel,
        "当前已不再提供二维码绑定。",
        "OpenClaw 启动后会自动查询该用户的 open_id，完成绑定，并主动发送欢迎消息。",
      ].join("\n"),
      "绑定飞书操作员",
    );
    return;
  }
  await params.prompter.note(
    [
      "当前未配置 openclawcode 的飞书联系方式直绑。",
      "OpenClaw Code 已不再提供二维码绑定。",
      "如果你希望 OpenClaw 主动给操作员发送欢迎消息和后续通知，请重新运行配置并填写飞书邮箱或手机号。",
    ].join("\n"),
    "绑定飞书操作员",
  );
}

function isFeishuConfigured(cfg: OpenClawConfig): boolean {
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;

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

  const topLevelConfigured = Boolean(
    isAppIdConfigured(feishuCfg?.appId) && hasConfiguredSecretInput(feishuCfg?.appSecret),
  );

  const accountConfigured = Object.values(feishuCfg?.accounts ?? {}).some((account) => {
    if (!account || typeof account !== "object") {
      return false;
    }
    const hasOwnAppId = Object.prototype.hasOwnProperty.call(account, "appId");
    const hasOwnAppSecret = Object.prototype.hasOwnProperty.call(account, "appSecret");
    const accountAppIdConfigured = hasOwnAppId
      ? isAppIdConfigured((account as Record<string, unknown>).appId)
      : isAppIdConfigured(feishuCfg?.appId);
    const accountSecretConfigured = hasOwnAppSecret
      ? hasConfiguredSecretInput((account as Record<string, unknown>).appSecret)
      : hasConfiguredSecretInput(feishuCfg?.appSecret);
    return Boolean(accountAppIdConfigured && accountSecretConfigured);
  });

  return topLevelConfigured || accountConfigured;
}

const promptFeishuAllowFrom = createTopLevelChannelParsedAllowFromPrompt({
  channel,
  defaultAccountId: DEFAULT_ACCOUNT_ID,
  noteTitle: "Feishu allowlist",
  noteLines: [
    "Allowlist Feishu DMs by open_id or user_id.",
    "You can find user open_id in Feishu admin console or via API.",
    "Examples:",
    "- ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "- on_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  ],
  message: "Feishu allowFrom (user open_ids)",
  placeholder: "ou_xxxxx, ou_yyyyy",
  parseEntries: (raw) => ({ entries: splitSetupEntries(raw) }),
  mergeEntries: ({ existing, parsed }) => mergeAllowFromEntries(existing, parsed),
});

async function noteFeishuCredentialHelp(
  prompter: Parameters<NonNullable<ChannelSetupWizard["finalize"]>>[0]["prompter"],
): Promise<void> {
  await prompter.note(
    [
      "1) Go to Feishu Open Platform (open.feishu.cn)",
      "2) Create a self-built app",
      "3) Get App ID and App Secret from Credentials page",
      "4) Enable required permissions: im:message, im:chat, contact:user.base:readonly",
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
  return String(
    await params.prompter.text({
      message: "Enter Feishu App ID",
      initialValue: params.initialValue,
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();
}

const feishuDmPolicy: ChannelSetupDmPolicy = createTopLevelChannelDmPolicy({
  label: "Feishu",
  channel,
  policyKey: "channels.feishu.dmPolicy",
  allowFromKey: "channels.feishu.allowFrom",
  getCurrent: (cfg) => (cfg.channels?.feishu as FeishuConfig | undefined)?.dmPolicy ?? "pairing",
  promptAllowFrom: promptFeishuAllowFrom,
});

export { feishuSetupAdapter } from "./setup-core.js";

export const feishuSetupWizard: ChannelSetupWizard = {
  channel,
  resolveAccountIdForConfigure: () => DEFAULT_ACCOUNT_ID,
  resolveShouldPromptAccountIds: () => false,
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs app credentials",
    configuredHint: "configured",
    unconfiguredHint: "needs app creds",
    configuredScore: 2,
    unconfiguredScore: 0,
    resolveConfigured: ({ cfg }) => isFeishuConfigured(cfg),
    resolveStatusLines: async ({ cfg, configured }) => {
      const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
      const resolvedCredentials = inspectFeishuCredentials(feishuCfg);
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
  credentials: [],
  finalize: async ({ cfg, prompter, options }) => {
    const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
    const resolved = inspectFeishuCredentials(feishuCfg);
    const hasConfigSecret = hasConfiguredSecretInput(feishuCfg?.appSecret);
    const hasConfigCreds = Boolean(
      typeof feishuCfg?.appId === "string" && feishuCfg.appId.trim() && hasConfigSecret,
    );
    const appSecretPromptState = buildSingleChannelSecretPromptState({
      accountConfigured: Boolean(resolved),
      hasConfigToken: hasConfigSecret,
      allowEnv: !hasConfigCreds && Boolean(process.env.FEISHU_APP_ID?.trim()),
      envValue: process.env.FEISHU_APP_SECRET,
    });

    let next = cfg;
    let appId: string | null = null;
    let appSecret: SecretInput | null = null;
    let appSecretProbeValue: string | null = null;

    if (!resolved) {
      await noteFeishuCredentialHelp(prompter);
    }

    const appSecretResult = await promptSingleChannelSecretInput({
      cfg: next,
      prompter,
      providerHint: "feishu",
      credentialLabel: "App Secret",
      secretInputMode: options?.secretInputMode,
      accountConfigured: appSecretPromptState.accountConfigured,
      canUseEnv: appSecretPromptState.canUseEnv,
      hasConfigToken: appSecretPromptState.hasConfigToken,
      envPrompt: "FEISHU_APP_ID + FEISHU_APP_SECRET detected. Use env vars?",
      keepPrompt: "Feishu App Secret already configured. Keep it?",
      inputPrompt: "Enter Feishu App Secret",
      preferredEnvVar: "FEISHU_APP_SECRET",
    });

    if (appSecretResult.action === "use-env") {
      next = patchTopLevelChannelConfigSection({
        cfg: next,
        channel,
        enabled: true,
        patch: {},
      }) as OpenClawConfig;
    } else if (appSecretResult.action === "set") {
      appSecret = appSecretResult.value;
      appSecretProbeValue = appSecretResult.resolvedValue;
      appId = await promptFeishuAppId({
        prompter,
        initialValue:
          normalizeString(feishuCfg?.appId) ?? normalizeString(process.env.FEISHU_APP_ID),
      });
    }

    if (appId && appSecret) {
      next = patchTopLevelChannelConfigSection({
        cfg: next,
        channel,
        enabled: true,
        patch: {
          appId,
          appSecret,
        },
      }) as OpenClawConfig;

      try {
        const probe = await probeFeishu({
          appId,
          appSecret: appSecretProbeValue ?? undefined,
          domain: (next.channels?.feishu as FeishuConfig | undefined)?.domain,
        });
        if (probe.ok) {
          await prompter.note(
            `Connected as ${probe.botName ?? probe.botOpenId ?? "bot"}`,
            "Feishu connection test",
          );
        } else {
          await prompter.note(
            `Connection failed: ${probe.error ?? "unknown error"}`,
            "Feishu connection test",
          );
        }
      } catch (err) {
        await prompter.note(`Connection test failed: ${String(err)}`, "Feishu connection test");
      }
    }

    next = await promptFeishuOperatorContactBinding({
      cfg: next,
      accountId: DEFAULT_ACCOUNT_ID,
      prompter,
    });

    const currentMode =
      (next.channels?.feishu as FeishuConfig | undefined)?.connectionMode ?? "websocket";
    const connectionMode = (await prompter.select({
      message: "Feishu connection mode",
      options: [
        { value: "websocket", label: "WebSocket (default)" },
        { value: "webhook", label: "Webhook" },
      ],
      initialValue: currentMode,
    })) as "websocket" | "webhook";
    next = patchTopLevelChannelConfigSection({
      cfg: next,
      channel,
      patch: { connectionMode },
    }) as OpenClawConfig;

    if (connectionMode === "webhook") {
      const currentVerificationToken = (next.channels?.feishu as FeishuConfig | undefined)
        ?.verificationToken;
      const verificationTokenResult = await promptSingleChannelSecretInput({
        cfg: next,
        prompter,
        providerHint: "feishu-webhook",
        credentialLabel: "verification token",
        secretInputMode: options?.secretInputMode,
        ...buildSingleChannelSecretPromptState({
          accountConfigured: hasConfiguredSecretInput(currentVerificationToken),
          hasConfigToken: hasConfiguredSecretInput(currentVerificationToken),
          allowEnv: false,
        }),
        envPrompt: "",
        keepPrompt: "Feishu verification token already configured. Keep it?",
        inputPrompt: "Enter Feishu verification token",
        preferredEnvVar: "FEISHU_VERIFICATION_TOKEN",
      });
      if (verificationTokenResult.action === "set") {
        next = patchTopLevelChannelConfigSection({
          cfg: next,
          channel,
          patch: { verificationToken: verificationTokenResult.value },
        }) as OpenClawConfig;
      }

      const currentEncryptKey = (next.channels?.feishu as FeishuConfig | undefined)?.encryptKey;
      const encryptKeyResult = await promptSingleChannelSecretInput({
        cfg: next,
        prompter,
        providerHint: "feishu-webhook",
        credentialLabel: "encrypt key",
        secretInputMode: options?.secretInputMode,
        ...buildSingleChannelSecretPromptState({
          accountConfigured: hasConfiguredSecretInput(currentEncryptKey),
          hasConfigToken: hasConfiguredSecretInput(currentEncryptKey),
          allowEnv: false,
        }),
        envPrompt: "",
        keepPrompt: "Feishu encrypt key already configured. Keep it?",
        inputPrompt: "Enter Feishu encrypt key",
        preferredEnvVar: "FEISHU_ENCRYPT_KEY",
      });
      if (encryptKeyResult.action === "set") {
        next = patchTopLevelChannelConfigSection({
          cfg: next,
          channel,
          patch: { encryptKey: encryptKeyResult.value },
        }) as OpenClawConfig;
      }

      const currentWebhookPath = (next.channels?.feishu as FeishuConfig | undefined)?.webhookPath;
      const webhookPath = String(
        await prompter.text({
          message: "Feishu webhook path",
          initialValue: currentWebhookPath ?? "/feishu/events",
          validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
        }),
      ).trim();
      next = patchTopLevelChannelConfigSection({
        cfg: next,
        channel,
        patch: { webhookPath },
      }) as OpenClawConfig;
    }

    const currentDomain = (next.channels?.feishu as FeishuConfig | undefined)?.domain ?? "feishu";
    const domain = await prompter.select({
      message: "Which Feishu domain?",
      options: [
        { value: "feishu", label: "Feishu (feishu.cn) - China" },
        { value: "lark", label: "Lark (larksuite.com) - International" },
      ],
      initialValue: currentDomain,
    });
    next = patchTopLevelChannelConfigSection({
      cfg: next,
      channel,
      patch: { domain: domain as "feishu" | "lark" },
    }) as OpenClawConfig;

    const groupPolicy = (await prompter.select({
      message: "Group chat policy",
      options: [
        { value: "allowlist", label: "Allowlist - only respond in specific groups" },
        { value: "open", label: "Open - respond in all groups (requires mention)" },
        { value: "disabled", label: "Disabled - don't respond in groups" },
      ],
      initialValue: (next.channels?.feishu as FeishuConfig | undefined)?.groupPolicy ?? "allowlist",
    })) as "allowlist" | "open" | "disabled";
    next = setFeishuGroupPolicy(next, groupPolicy);

    if (groupPolicy === "allowlist") {
      const existing = (next.channels?.feishu as FeishuConfig | undefined)?.groupAllowFrom ?? [];
      const entry = await prompter.text({
        message: "Group chat allowlist (chat_ids)",
        placeholder: "oc_xxxxx, oc_yyyyy",
        initialValue: existing.length > 0 ? existing.map(String).join(", ") : undefined,
      });
      if (entry) {
        const parts = splitSetupEntries(String(entry));
        if (parts.length > 0) {
          next = setFeishuGroupAllowFrom(next, parts);
        }
      }
    }

    await noteFeishuOperatorBinding({
      cfg: next,
      accountId: DEFAULT_ACCOUNT_ID,
      prompter,
    });

    return { cfg: next };
  },
  dmPolicy: feishuDmPolicy,
  disable: (cfg) =>
    patchTopLevelChannelConfigSection({
      cfg,
      channel,
      patch: { enabled: false },
    }),
};
