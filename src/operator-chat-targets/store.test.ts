import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverPreferredOperatorChatTarget,
  getPreferredOperatorChatTarget,
  listPreferredOperatorChatTargets,
  setPreferredOperatorChatTarget,
} from "./store.js";

const createdDirs: string[] = [];

async function createStateDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-operator-chat-targets-"));
  createdDirs.push(dir);
  return dir;
}

describe("preferred operator chat targets", () => {
  afterEach(async () => {
    await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("persists and reloads a preferred operator chat target", async () => {
    const stateDir = await createStateDir();
    await setPreferredOperatorChatTarget({
      stateDir,
      channel: "feishu",
      target: "user:ou_operator",
      source: "feishu-bot-menu",
    });

    expect(
      await getPreferredOperatorChatTarget({
        stateDir,
        channel: "feishu",
      }),
    ).toMatchObject({
      channel: "feishu",
      accountId: "default",
      target: "user:ou_operator",
      source: "feishu-bot-menu",
    });
    expect(await listPreferredOperatorChatTargets({ stateDir })).toHaveLength(1);
  });

  it("does not replace an existing target without an explicit replace flag", async () => {
    const stateDir = await createStateDir();
    await setPreferredOperatorChatTarget({
      stateDir,
      channel: "feishu",
      target: "user:first",
      source: "feishu-bot-menu",
    });

    const result = await setPreferredOperatorChatTarget({
      stateDir,
      channel: "feishu",
      target: "user:second",
      source: "feishu-bot-menu",
    });

    expect(result.status).toBe("conflict");
    expect(result.binding.target).toBe("user:first");
    expect(
      await discoverPreferredOperatorChatTarget({
        stateDir,
        requestedChannel: "feishu",
      }),
    ).toMatchObject({
      target: "user:first",
    });
  });
});
