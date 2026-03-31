import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getFeishuOperatorWelcomeReceipt,
  hasFeishuOperatorWelcomeReceipt,
  markFeishuOperatorWelcomeReceiptSent,
} from "./feishu-welcome-receipts.js";

const createdDirs: string[] = [];

async function createStateDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-welcome-receipts-"));
  createdDirs.push(dir);
  return dir;
}

describe("feishu operator welcome receipts", () => {
  afterEach(async () => {
    await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("persists a sent welcome receipt", async () => {
    const stateDir = await createStateDir();

    await markFeishuOperatorWelcomeReceiptSent({
      stateDir,
      accountId: "default",
      openId: "ou_operator",
      source: "feishu-contact-binding",
      sentAt: "2026-03-31T10:00:00.000Z",
    });

    expect(
      await getFeishuOperatorWelcomeReceipt({
        stateDir,
        accountId: "default",
        openId: "ou_operator",
      }),
    ).toMatchObject({
      accountId: "default",
      openId: "ou_operator",
      source: "feishu-contact-binding",
      sentAt: "2026-03-31T10:00:00.000Z",
    });
    await expect(
      hasFeishuOperatorWelcomeReceipt({
        stateDir,
        accountId: "default",
        openId: "ou_operator",
      }),
    ).resolves.toBe(true);
  });

  it("dedupes by account and open id", async () => {
    const stateDir = await createStateDir();

    await markFeishuOperatorWelcomeReceiptSent({
      stateDir,
      accountId: "default",
      openId: "ou_operator",
      sentAt: "2026-03-31T10:00:00.000Z",
    });
    await markFeishuOperatorWelcomeReceiptSent({
      stateDir,
      accountId: "default",
      openId: "ou_operator",
      sentAt: "2026-03-31T10:05:00.000Z",
    });

    expect(
      await getFeishuOperatorWelcomeReceipt({
        stateDir,
        accountId: "default",
        openId: "ou_operator",
      }),
    ).toMatchObject({
      sentAt: "2026-03-31T10:05:00.000Z",
    });
  });
});
