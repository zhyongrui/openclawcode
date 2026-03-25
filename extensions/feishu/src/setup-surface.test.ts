import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNonExitingTypedRuntimeEnv } from "../../../test/helpers/extensions/runtime-env.js";
import {
  createPluginSetupWizardConfigure,
  createPluginSetupWizardStatus,
  createTestWizardPrompter,
  runSetupWizardConfigure,
} from "../../../test/helpers/extensions/setup-wizard.js";
import { setPreferredOperatorChatTarget } from "../../../src/operator-chat-targets/store.js";

vi.mock("./probe.js", () => ({
  probeFeishu: vi.fn(async () => ({ ok: false, error: "mocked" })),
}));

const qrGenerateMock = vi.hoisted(() => vi.fn((_value, _opts, cb) => cb("QR ASCII")));
const resolvePublicCallbackAvailabilityMock = vi.hoisted(() => vi.fn());

vi.mock("qrcode-terminal", () => ({
  default: {
    generate: qrGenerateMock,
  },
}));

vi.mock("../../../src/gateway/public-callback.js", () => ({
  resolvePublicCallbackAvailability: resolvePublicCallbackAvailabilityMock,
}));

import { feishuPlugin } from "./channel.js";

const baseStatusContext = {
  accountOverrides: {},
};

async function withEnvVars(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, prior] of previous.entries()) {
      if (prior === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  }
}

async function getStatusWithEnvRefs(params: { appIdKey: string; appSecretKey: string }) {
  return await feishuGetStatus({
    cfg: {
      channels: {
        feishu: {
          appId: { source: "env", id: params.appIdKey, provider: "default" },
          appSecret: { source: "env", id: params.appSecretKey, provider: "default" },
        },
      },
    } as never,
    ...baseStatusContext,
  });
}

const feishuConfigure = createPluginSetupWizardConfigure(feishuPlugin);
const feishuGetStatus = createPluginSetupWizardStatus(feishuPlugin);
type FeishuConfigureRuntime = Parameters<typeof feishuConfigure>[0]["runtime"];

describe("feishu setup wizard", () => {
  beforeEach(() => {
    qrGenerateMock.mockClear();
    resolvePublicCallbackAvailabilityMock.mockReset();
    resolvePublicCallbackAvailabilityMock.mockResolvedValue({
      available: false,
      reason: "loopback-only-no-tunnel",
      detail: "Gateway only exposes loopback and no public callback URL or managed tunnel is available.",
    });
  });

  it("does not throw when config appId/appSecret are SecretRef objects", async () => {
    const text = vi
      .fn()
      .mockResolvedValueOnce("cli_from_prompt")
      .mockResolvedValueOnce("secret_from_prompt")
      .mockResolvedValueOnce("oc_group_1");
    const prompter = createTestWizardPrompter({
      text,
      confirm: vi.fn(async () => true),
      select: vi.fn(
        async ({ initialValue }: { initialValue?: string }) => initialValue ?? "allowlist",
      ) as never,
    });

    await expect(
      runSetupWizardConfigure({
        configure: feishuConfigure,
        cfg: {
          channels: {
            feishu: {
              appId: { source: "env", id: "FEISHU_APP_ID", provider: "default" },
              appSecret: { source: "env", id: "FEISHU_APP_SECRET", provider: "default" },
            },
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      }),
    ).resolves.toBeTruthy();
  });

  it("falls back to local browser binding guidance on loopback-only gateways", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-note-"));
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const note = vi.fn(async () => {});
    const text = vi
      .fn()
      .mockResolvedValueOnce("secret_from_prompt")
      .mockResolvedValueOnce("cli_from_prompt")
      .mockResolvedValueOnce("oc_group_1");
    const select = vi.fn(async ({ message, initialValue }: { message: string; initialValue?: string }) => {
      if (message === "Feishu connection mode") {
        return "websocket";
      }
      if (message === "Which Feishu domain?") {
        return initialValue ?? "feishu";
      }
      if (message === "Group chat policy") {
        return "allowlist";
      }
      return initialValue ?? "allowlist";
    });
    const prompter = createTestWizardPrompter({
      note,
      text,
      confirm: vi.fn(async () => true),
      select: select as never,
    });
    resolvePublicCallbackAvailabilityMock.mockResolvedValue({
      available: false,
      reason: "loopback-only-no-tunnel",
      detail: "Gateway only exposes loopback and no public callback URL or managed tunnel is available.",
    });

    try {
      await runSetupWizardConfigure({
        configure: feishuConfigure,
        cfg: {
          gateway: {
            bind: "loopback",
            port: 18789,
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      });

      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("当前 gateway 只有本机地址，暂时没有可供手机访问的绑定链接。"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("服务器/远程主机场景推荐方式: 用飞书扫码打开机器人"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("机器人链接: https://applink.feishu.cn/client/bot/open?appId=cli_from_prompt"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("同机浏览器备用: http://127.0.0.1:18789/openclaw/bind/feishu/"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("Quick actions"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(expect.stringContaining("QR ASCII"), "绑定飞书操作员");
      expect(qrGenerateMock).toHaveBeenCalledWith(
        "https://applink.feishu.cn/client/bot/open?appId=cli_from_prompt",
        { small: true },
        expect.any(Function),
      );
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("shows a qr binding note when a remote callback url is available", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-public-note-"));
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const note = vi.fn(async () => {});
    const text = vi
      .fn()
      .mockResolvedValueOnce("secret_from_prompt")
      .mockResolvedValueOnce("cli_from_prompt")
      .mockResolvedValueOnce("oc_group_1");
    const select = vi.fn(async ({ message, initialValue }: { message: string; initialValue?: string }) => {
      if (message === "Feishu connection mode") {
        return "websocket";
      }
      if (message === "Which Feishu domain?") {
        return initialValue ?? "feishu";
      }
      if (message === "Group chat policy") {
        return "allowlist";
      }
      return initialValue ?? "allowlist";
    });
    const prompter = createTestWizardPrompter({
      note,
      text,
      confirm: vi.fn(async () => true),
      select: select as never,
    });
    resolvePublicCallbackAvailabilityMock.mockResolvedValue({
      available: true,
      baseUrl: "https://gateway.example.com/openclaw",
      source: "configured-public-base-url",
      detail: "gateway.remote.url",
    });

    try {
      await runSetupWizardConfigure({
        configure: feishuConfigure,
        cfg: {
          gateway: {
            mode: "remote",
            remote: {
              url: "wss://gateway.example.com/openclaw",
            },
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      });

      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("推荐方式: 用飞书扫码绑定"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("绑定链接: https://gateway.example.com/openclaw/bind/feishu/"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("已配置公网地址: gateway.remote.url"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(expect.stringContaining("QR ASCII"), "绑定飞书操作员");
      expect(qrGenerateMock).toHaveBeenCalled();
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("prefers device-pair publicUrl for a scannable qr binding link", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-device-pair-note-"));
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const note = vi.fn(async () => {});
    const text = vi
      .fn()
      .mockResolvedValueOnce("secret_from_prompt")
      .mockResolvedValueOnce("cli_from_prompt")
      .mockResolvedValueOnce("oc_group_1");
    const select = vi.fn(async ({ message, initialValue }: { message: string; initialValue?: string }) => {
      if (message === "Feishu connection mode") {
        return "websocket";
      }
      if (message === "Which Feishu domain?") {
        return initialValue ?? "feishu";
      }
      if (message === "Group chat policy") {
        return "allowlist";
      }
      return initialValue ?? "allowlist";
    });
    const prompter = createTestWizardPrompter({
      note,
      text,
      confirm: vi.fn(async () => true),
      select: select as never,
    });
    resolvePublicCallbackAvailabilityMock.mockResolvedValue({
      available: true,
      baseUrl: "https://pair.example.com/gateway",
      source: "configured-public-base-url",
      detail: "plugins.entries.device-pair.config.publicUrl",
    });

    try {
      await runSetupWizardConfigure({
        configure: feishuConfigure,
        cfg: {
          gateway: {
            bind: "loopback",
            port: 18789,
          },
          plugins: {
            entries: {
              "device-pair": {
                config: {
                  publicUrl: "wss://pair.example.com/gateway",
                },
              },
            },
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      });

      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("绑定链接: https://pair.example.com/openclaw/bind/feishu/"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(
          "已配置公网地址: plugins.entries.device-pair.config.publicUrl",
        ),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(expect.stringContaining("QR ASCII"), "绑定飞书操作员");
      expect(qrGenerateMock).toHaveBeenCalled();
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("prefers device-pair publicUrl for a scannable qr binding link", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-device-pair-note-"));
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const note = vi.fn(async () => {});
    const text = vi
      .fn()
      .mockResolvedValueOnce("secret_from_prompt")
      .mockResolvedValueOnce("cli_from_prompt")
      .mockResolvedValueOnce("oc_group_1");
    const select = vi.fn(async ({ message, initialValue }: { message: string; initialValue?: string }) => {
      if (message === "Feishu connection mode") {
        return "websocket";
      }
      if (message === "Which Feishu domain?") {
        return initialValue ?? "feishu";
      }
      if (message === "Group chat policy") {
        return "allowlist";
      }
      return initialValue ?? "allowlist";
    });
    const prompter = createTestWizardPrompter({
      note,
      text,
      confirm: vi.fn(async () => true),
      select: select as never,
    });
    resolvePublicCallbackAvailabilityMock.mockResolvedValue({
      available: true,
      baseUrl: "https://pair.example.com/openclaw",
      source: "configured-public-base-url",
      detail: "plugins.entries.device-pair.config.publicUrl",
    });

    try {
      await runSetupWizardConfigure({
        configure: feishuConfigure,
        cfg: {
          gateway: {
            bind: "loopback",
            port: 18789,
          },
          plugins: {
            entries: {
              "device-pair": {
                config: {
                  publicUrl: "wss://pair.example.com/gateway",
                },
              },
            },
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      });

      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("绑定链接: https://pair.example.com/openclaw/bind/feishu/"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(expect.stringContaining("QR ASCII"), "绑定飞书操作员");
      expect(qrGenerateMock).toHaveBeenCalled();
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("does not show the qr binding note when a feishu target is already bound", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-skip-"));
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    await setPreferredOperatorChatTarget({
      stateDir,
      channel: "feishu",
      target: "user:ou_bound",
      source: "test",
    });

    const note = vi.fn(async () => {});
    const text = vi
      .fn()
      .mockResolvedValueOnce("secret_from_prompt")
      .mockResolvedValueOnce("cli_from_prompt")
      .mockResolvedValueOnce("oc_group_1");
    const select = vi.fn(async ({ message, initialValue }: { message: string; initialValue?: string }) => {
      if (message === "Feishu connection mode") {
        return "websocket";
      }
      if (message === "Which Feishu domain?") {
        return initialValue ?? "feishu";
      }
      if (message === "Group chat policy") {
        return "allowlist";
      }
      return initialValue ?? "allowlist";
    });
    const prompter = createTestWizardPrompter({
      note,
      text,
      confirm: vi.fn(async () => true),
      select: select as never,
    });

    try {
      await runSetupWizardConfigure({
        configure: feishuConfigure,
        cfg: {
          gateway: {
            bind: "loopback",
            port: 18789,
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      });

      expect(note).not.toHaveBeenCalledWith(expect.any(String), "绑定飞书操作员");
      expect(qrGenerateMock).not.toHaveBeenCalled();
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });
});

describe("feishu setup wizard status", () => {
  it("does not fallback to top-level appId when account explicitly sets empty appId", async () => {
    const status = await feishuGetStatus({
      cfg: {
        channels: {
          feishu: {
            appId: "top_level_app",
            accounts: {
              main: {
                appId: "",
                appSecret: "sample-app-credential", // pragma: allowlist secret
              },
            },
          },
        },
      } as never,
      ...baseStatusContext,
    });

    expect(status.configured).toBe(false);
  });

  it("treats env SecretRef appId as not configured when env var is missing", async () => {
    const appIdKey = "FEISHU_APP_ID_STATUS_MISSING_TEST";
    const appSecretKey = "FEISHU_APP_CREDENTIAL_STATUS_MISSING_TEST"; // pragma: allowlist secret
    await withEnvVars(
      {
        [appIdKey]: undefined,
        [appSecretKey]: "env-credential-456", // pragma: allowlist secret
      },
      async () => {
        const status = await getStatusWithEnvRefs({ appIdKey, appSecretKey });
        expect(status.configured).toBe(false);
      },
    );
  });

  it("treats env SecretRef appId/appSecret as configured in status", async () => {
    const appIdKey = "FEISHU_APP_ID_STATUS_TEST";
    const appSecretKey = "FEISHU_APP_CREDENTIAL_STATUS_TEST"; // pragma: allowlist secret
    await withEnvVars(
      {
        [appIdKey]: "cli_env_123",
        [appSecretKey]: "env-credential-456", // pragma: allowlist secret
      },
      async () => {
        const status = await getStatusWithEnvRefs({ appIdKey, appSecretKey });
        expect(status.configured).toBe(true);
      },
    );
  });
});
