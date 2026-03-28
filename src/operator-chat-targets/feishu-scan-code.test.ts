import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFeishuBotOpenUrl,
  clearFeishuTransportReady,
  claimPendingFeishuOperatorScanCode,
  ensurePendingFeishuOperatorScanCode,
  getFeishuTransportReady,
  getPendingFeishuOperatorScanCode,
  markFeishuTransportReady,
} from "./feishu-scan-code.js";

describe("feishu operator scan code store", () => {
  it("creates and reuses one pending code per account", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-scan-code-"));

    const first = await ensurePendingFeishuOperatorScanCode({
      stateDir,
      accountId: "default",
    });
    const second = await ensurePendingFeishuOperatorScanCode({
      stateDir,
      accountId: "default",
    });

    expect(first.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(second.code).toBe(first.code);
    expect(
      await getPendingFeishuOperatorScanCode({
        stateDir,
        accountId: "default",
      }),
    ).toMatchObject({
      code: first.code,
    });
  });

  it("claims a matching code exactly once", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-scan-code-"));
    const created = await ensurePendingFeishuOperatorScanCode({
      stateDir,
      accountId: "default",
    });

    await expect(
      claimPendingFeishuOperatorScanCode({
        stateDir,
        accountId: "default",
        code: "wrong",
        openId: "ou_sender",
      }),
    ).resolves.toEqual({
      status: "mismatch",
      binding: expect.objectContaining({
        code: created.code,
      }),
    });

    await expect(
      claimPendingFeishuOperatorScanCode({
        stateDir,
        accountId: "default",
        code: created.code.toLowerCase(),
        openId: "ou_sender",
      }),
    ).resolves.toEqual({
      status: "claimed",
      binding: expect.objectContaining({
        code: created.code,
        claimedByOpenId: "ou_sender",
      }),
    });

    expect(
      await getPendingFeishuOperatorScanCode({
        stateDir,
        accountId: "default",
      }),
    ).toBeUndefined();
  });

  it("matches a code embedded in a natural-language message", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-scan-code-"));
    const created = await ensurePendingFeishuOperatorScanCode({
      stateDir,
      accountId: "default",
    });

    await expect(
      claimPendingFeishuOperatorScanCode({
        stateDir,
        accountId: "default",
        code: `My code is ${created.code}.`,
        openId: "ou_sender",
      }),
    ).resolves.toEqual({
      status: "claimed",
      binding: expect.objectContaining({
        code: created.code,
        claimedByOpenId: "ou_sender",
      }),
    });
  });

  it("matches a code even if the user inserts spaces or punctuation", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-scan-code-"));
    const created = await ensurePendingFeishuOperatorScanCode({
      stateDir,
      accountId: "default",
    });

    const segmented = created.code.split("").join(" ");
    await expect(
      claimPendingFeishuOperatorScanCode({
        stateDir,
        accountId: "default",
        code: `验证码：${segmented}`,
        openId: "ou_sender",
      }),
    ).resolves.toEqual({
      status: "claimed",
      binding: expect.objectContaining({
        code: created.code,
        claimedByOpenId: "ou_sender",
      }),
    });
  });

  it("builds a bot-open URL for Feishu and Lark", () => {
    expect(buildFeishuBotOpenUrl({ appId: "cli_123" })).toBe(
      "https://applink.feishu.cn/client/bot/open?appId=cli_123",
    );
    expect(buildFeishuBotOpenUrl({ appId: "cli_123", domain: "lark" })).toBe(
      "https://applink.larksuite.com/client/bot/open?appId=cli_123",
    );
  });

  it("tracks Feishu transport readiness per account", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-scan-ready-"));

    expect(
      await getFeishuTransportReady({
        stateDir,
        accountId: "default",
      }),
    ).toBeUndefined();

    await markFeishuTransportReady({
      stateDir,
      accountId: "default",
    });

    expect(
      await getFeishuTransportReady({
        stateDir,
        accountId: "default",
      }),
    ).toMatchObject({
      accountId: "default",
      readyAt: expect.any(String),
    });

    await clearFeishuTransportReady({
      stateDir,
      accountId: "default",
    });

    expect(
      await getFeishuTransportReady({
        stateDir,
        accountId: "default",
      }),
    ).toBeUndefined();
  });
});
