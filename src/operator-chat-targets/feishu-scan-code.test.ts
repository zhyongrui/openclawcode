import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFeishuBotOpenUrl,
  claimPendingFeishuOperatorScanCode,
  ensurePendingFeishuOperatorScanCode,
  getPendingFeishuOperatorScanCode,
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

  it("builds a bot-open URL for Feishu and Lark", () => {
    expect(buildFeishuBotOpenUrl({ appId: "cli_123" })).toBe(
      "https://applink.feishu.cn/client/bot/open?appId=cli_123",
    );
    expect(buildFeishuBotOpenUrl({ appId: "cli_123", domain: "lark" })).toBe(
      "https://applink.larksuite.com/client/bot/open?appId=cli_123",
    );
  });
});
