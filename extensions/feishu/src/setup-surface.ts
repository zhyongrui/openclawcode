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
import qrcode from "qrcode-terminal";
import { resolveGatewayPort } from "../../../src/config/config.js";
import { resolveControlUiLinks } from "../../../src/commands/onboard-helpers.js";
import {
  preparePublicCallbackTooling,
  resolvePublicCallbackAvailability,
} from "../../../src/gateway/public-callback.js";
import {
  buildFeishuQrBindingClaimUrl,
  createFeishuQrBindingSession,
} from "../../../src/operator-chat-targets/feishu-qr-binding.js";
import { getPreferredOperatorChatTarget } from "../../../src/operator-chat-targets/store.js";
import { inspectFeishuCredentials, listFeishuAccountIds, resolveFeishuAccount } from "./accounts.js";
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

function renderQrAscii(data: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(data, { small: true }, (output: string) => {
      resolve(output);
    });
  });
}

async function printQrToTerminal(params: {
  title: string;
  data: string;
  fallbackUrlLabel: string;
}): Promise<void> {
  const asciiQr = await renderQrAscii(params.data);
  console.log(
    [
      "",
      params.title,
      "",
      asciiQr.trimEnd(),
      "",
      `如果二维码未能成功展示，请用浏览器打开以下链接：`,
      `${params.fallbackUrlLabel}: ${params.data}`,
      "",
    ].join("\n"),
  );
}

function resolveLocalFeishuQrBindingBaseHttpUrl(cfg: OpenClawConfig): string {
  return resolveControlUiLinks({
    bind: cfg.gateway?.bind ?? "loopback",
    port: resolveGatewayPort(cfg),
    customBindHost: cfg.gateway?.customBindHost,
  }).httpUrl.replace(/\/+$/, "");
}

function buildFeishuBotOpenUrl(params: { appId: string; domain?: string }): string {
  const host = params.domain === "lark" ? "applink.larksuite.com" : "applink.feishu.cn";
  const url = new URL(`https://${host}/client/bot/open`);
  url.searchParams.set("appId", params.appId);
  return url.toString();
}

function formatFeishuPublicCallbackSource(detail?: string): string | undefined {
  switch (detail) {
    case "plugins.entries.device-pair.config.publicUrl":
      return "已配置公网地址: plugins.entries.device-pair.config.publicUrl";
    case "gateway.remote.url":
      return "已配置公网地址: gateway.remote.url";
    case "gateway.bind=custom":
      return "已配置绑定地址: gateway.bind=custom";
    case "gateway.bind=lan":
      return "局域网可达地址: gateway.bind=lan";
    case "gateway.bind=tailnet":
      return "Tailnet 可达地址: gateway.bind=tailnet";
    default:
      if (detail?.startsWith("gateway.tailscale.mode=")) {
        return `Tailscale 公网入口: ${detail}`;
      }
      return undefined;
  }
}

function describeFeishuPublicCallbackFailure(reason: "loopback-only-no-tunnel" | "tunnel-start-failed" | "public-base-url-misconfigured"): string {
  switch (reason) {
    case "public-base-url-misconfigured":
      return "已配置的公网绑定地址当前不可用。";
    case "tunnel-start-failed":
      return "临时公网绑定链接创建失败。";
    case "loopback-only-no-tunnel":
    default:
      return "当前 gateway 只有本机地址，暂时没有可供手机访问的绑定链接。";
  }
}

async function noteFeishuQrBinding(params: {
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
  const { session } = await createFeishuQrBindingSession({
    accountId: params.accountId,
    setupIntent: "feishu-initial-bind",
  });
  const callbackAvailability = await resolvePublicCallbackAvailability({
    cfg: params.cfg,
  });
  if (callbackAvailability.available) {
    const claimUrl = buildFeishuQrBindingClaimUrl({
      baseHttpUrl: callbackAvailability.baseUrl,
      session,
    });
    await printQrToTerminal({
      title: "使用飞书扫描以下二维码，以完成绑定：",
      data: claimUrl,
      fallbackUrlLabel: "绑定链接",
    });
    const sourceLine =
      callbackAvailability.source === "managed-tunnel"
        ? "公网入口来源: 临时公网链接"
        : formatFeishuPublicCallbackSource(callbackAvailability.detail);
    await params.prompter.note(
      [
        "推荐方式: 用飞书扫码绑定",
        "二维码已直接输出到当前终端，避免被提示框裁切。",
        `绑定链接: ${claimUrl}`,
        ...(sourceLine ? [sourceLine] : []),
        ...(callbackAvailability.source === "managed-tunnel" && callbackAvailability.detail
          ? [`注意: ${callbackAvailability.detail}`]
          : []),
        ...(callbackAvailability.expiresAt
          ? [`链接有效期至: ${callbackAvailability.expiresAt}`]
          : callbackAvailability.source === "managed-tunnel"
            ? ["这是临时公网链接；如果失效，重新运行配置即可刷新。"]
            : []),
        "也可以直接在浏览器打开上面的链接完成绑定。",
        "回退方式: 在飞书里打开机器人并点击 Quick actions。",
        "OpenClaw 正在完成启动，绑定会在可用后自动继续。",
      ].join("\n"),
      "绑定飞书操作员",
    );
    return;
  }
  const baseHttpUrl = resolveLocalFeishuQrBindingBaseHttpUrl(params.cfg);
  const claimUrl = buildFeishuQrBindingClaimUrl({
    baseHttpUrl,
    session,
  });
  const account = resolveFeishuAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const botOpenUrl = account.appId
    ? buildFeishuBotOpenUrl({
        appId: account.appId,
        domain: account.domain,
      })
    : undefined;
  if (botOpenUrl) {
    await printQrToTerminal({
      title: "使用飞书扫描以下二维码，打开机器人：",
      data: botOpenUrl,
      fallbackUrlLabel: "机器人链接",
    });
  }
  await params.prompter.note(
    [
      describeFeishuPublicCallbackFailure(callbackAvailability.reason),
      ...(callbackAvailability.detail ? [`原因: ${callbackAvailability.detail}`] : []),
      ...(botOpenUrl
        ? [
            "服务器/远程主机场景推荐方式: 用飞书扫码打开机器人",
            "机器人二维码已直接输出到当前终端，避免被提示框裁切。",
            `机器人链接: ${botOpenUrl}`,
            "扫码进入飞书后，点击 Quick actions 完成绑定。",
          ]
        : ["如果你更方便直接在飞书里继续，也可以打开机器人并点击 Quick actions。"]),
      `同机浏览器备用: ${claimUrl}`,
      "上面的本地链接只适用于运行 OpenClaw 的这台机器。",
      "OpenClaw 正在完成启动，绑定会在可用后自动继续。",
    ].join("\n"),
    "绑定飞书操作员",
  );
}

async function prewarmFeishuPublicCallbackTooling(
  params: Pick<
    Parameters<typeof noteFeishuQrBinding>[0],
    "cfg" | "prompter"
  >,
): Promise<void> {
  const preparation = await preparePublicCallbackTooling({
    cfg: params.cfg,
  });
  if (preparation.status === "ready" && preparation.source === "downloaded-cloudflared") {
    await params.prompter.note(
      [
        "已预先安装临时公网绑定组件 cloudflared。",
        `安装位置: ${preparation.binaryPath}`,
        "后续生成飞书扫码绑定公网链接时会直接复用，不再临时下载安装。",
        "这一步只是公网绑定预热，不是最终的绑定二维码。",
        "继续完成下面的配置后，OpenClaw 会继续展示飞书绑定二维码。",
      ].join("\n"),
      "飞书公网绑定预热",
    );
    return;
  }
  if (preparation.status === "failed" && preparation.reason === "cloudflared-prepare-failed") {
    await params.prompter.note(
      [
        "未能预先准备临时公网绑定组件，后续扫码绑定可能无法自动生成公网链接。",
        `原因: ${preparation.detail}`,
      ].join("\n"),
      "飞书公网绑定预热",
    );
  }
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

    await prewarmFeishuPublicCallbackTooling({
      cfg: next,
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

    await noteFeishuQrBinding({
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
