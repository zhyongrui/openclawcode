import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setPreferredOperatorChatTarget } from "../../../src/operator-chat-targets/store.js";
import { createNonExitingTypedRuntimeEnv } from "../../../test/helpers/extensions/runtime-env.js";
import {
  createPluginSetupWizardConfigure,
  createPluginSetupWizardStatus,
  createTestWizardPrompter,
  runSetupWizardConfigure,
} from "../../../test/helpers/extensions/setup-wizard.js";

vi.mock("./probe.js", () => ({
  probeFeishu: vi.fn(async () => ({ ok: false, error: "mocked" })),
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
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("notes configured openclawcode feishu contact binding instead of qr guidance", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-contact-binding-"));
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const note = vi.fn(async () => {});
    const text = vi.fn(
      async ({ message, initialValue }: { message: string; initialValue?: string }) => {
        if (message === "Enter Feishu App Secret") {
          return "secret_from_prompt";
        }
        if (message === "Enter Feishu App ID") {
          return "cli_from_prompt";
        }
        if (message === "输入要绑定的飞书邮箱") {
          return initialValue ?? "owner@example.com";
        }
        if (message === "Group chat allowlist (chat_ids)") {
          return "oc_group_1";
        }
        return initialValue ?? "";
      },
    );
    const select = vi.fn(
      async ({ message, initialValue }: { message: string; initialValue?: string }) => {
        if (message === "OpenClaw Code 飞书绑定方式") {
          return "email";
        }
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
      },
    );
    const prompter = createTestWizardPrompter({
      note,
      text: text as never,
      confirm: vi.fn(async () => true),
      select: select as never,
    });

    try {
      await runSetupWizardConfigure({
        configure: feishuConfigure,
        cfg: {
          plugins: {
            entries: {
              openclawcode: {
                config: {
                  feishuOperatorBinding: {
                    email: "owner@example.com",
                  },
                },
              },
            },
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      });

      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("已检测到 openclawcode 的飞书联系方式直绑配置。"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("邮箱: owner@example.com"),
        "绑定飞书操作员",
      );
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("当前已不再提供二维码绑定。"),
        "绑定飞书操作员",
      );
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("prompts for an openclawcode feishu operator email after credentials and stores it", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-contact-prompt-"));
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const note = vi.fn(async () => {});
    const text = vi.fn(
      async ({ message, initialValue }: { message: string; initialValue?: string }) => {
        if (message === "Enter Feishu App Secret") {
          return "secret_from_prompt";
        }
        if (message === "Enter Feishu App ID") {
          return "cli_from_prompt";
        }
        if (message === "输入要绑定的飞书邮箱") {
          return initialValue ?? "owner@example.com";
        }
        if (message === "Group chat allowlist (chat_ids)") {
          return "oc_group_1";
        }
        return initialValue ?? "";
      },
    );
    const select = vi.fn(
      async ({ message, initialValue }: { message: string; initialValue?: string }) => {
        if (message === "OpenClaw Code 飞书绑定方式") {
          return "email";
        }
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
      },
    );
    const prompter = createTestWizardPrompter({
      note,
      text: text as never,
      confirm: vi.fn(async () => true),
      select: select as never,
    });

    try {
      const result = await runSetupWizardConfigure({
        configure: feishuConfigure,
        cfg: {
          plugins: {
            entries: {
              openclawcode: {},
            },
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      });

      expect(
        (
          result as {
            cfg?: {
              plugins?: {
                entries?: {
                  openclawcode?: {
                    config?: {
                      feishuOperatorBinding?: {
                        email?: string;
                      };
                    };
                  };
                };
              };
            };
          }
        ).cfg?.plugins?.entries?.openclawcode?.config?.feishuOperatorBinding,
      ).toEqual({
        email: "owner@example.com",
      });
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("OpenClaw 启动后会自动查询该用户的 open_id"),
        "绑定飞书操作员",
      );
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("allows skipping direct binding and explains qr binding is no longer offered", async () => {
    const note = vi.fn(async () => {});
    const text = vi
      .fn()
      .mockResolvedValueOnce("secret_from_prompt")
      .mockResolvedValueOnce("cli_from_prompt")
      .mockResolvedValueOnce("oc_group_1");
    const select = vi.fn(
      async ({ message, initialValue }: { message: string; initialValue?: string }) => {
        if (message === "OpenClaw Code 飞书绑定方式") {
          return "skip";
        }
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
      },
    );
    const prompter = createTestWizardPrompter({
      note,
      text,
      confirm: vi.fn(async () => true),
      select: select as never,
    });

    const result = await runSetupWizardConfigure({
      configure: feishuConfigure,
      cfg: {
        plugins: {
          entries: {
            openclawcode: {},
          },
        },
      } as never,
      prompter,
      runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
    });

    expect(
      (
        result as {
          cfg?: {
            plugins?: {
              entries?: {
                openclawcode?: {
                  config?: {
                    feishuOperatorBinding?: unknown;
                  };
                };
              };
            };
          };
        }
      ).cfg?.plugins?.entries?.openclawcode?.config?.feishuOperatorBinding,
    ).toBeUndefined();
    expect(note).toHaveBeenCalledWith(
      expect.stringContaining("OpenClaw Code 已不再提供二维码绑定。"),
      "绑定飞书操作员",
    );
  });

  it("does not show the operator binding note when a feishu target is already bound", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-bind-skip-"));
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
    const select = vi.fn(
      async ({ message, initialValue }: { message: string; initialValue?: string }) => {
        if (message === "OpenClaw Code 飞书绑定方式") {
          return "skip";
        }
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
      },
    );
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
          plugins: {
            entries: {
              openclawcode: {},
            },
          },
        } as never,
        prompter,
        runtime: createNonExitingTypedRuntimeEnv<FeishuConfigureRuntime>(),
      });

      expect(note).not.toHaveBeenCalledWith(expect.any(String), "绑定飞书操作员");
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
  it("treats SecretRef appSecret as configured when appId is present", async () => {
    const status = await feishuGetStatus({
      cfg: {
        channels: {
          feishu: {
            appId: "cli_a123456",
            appSecret: {
              source: "env",
              provider: "default",
              id: "FEISHU_APP_SECRET",
            },
          },
        },
      } as never,
      accountOverrides: {},
    });

    expect(status.configured).toBe(true);
  });

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
