import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPinnedWritePlan } from "./fs-bridge-mutation-helper.js";
import type { PathSafetyCheck, PinnedSandboxEntry } from "./fs-bridge-path-safety.js";

describe("buildPinnedWritePlan", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("preserves stdin payload for pinned writes", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-fs-bridge-write-"));
    const targetDir = path.join(tempDir, "nested");
    await fs.mkdir(targetDir, { recursive: true });

    const check = {
      target: {
        hostPath: path.join(targetDir, "hello.txt"),
        containerPath: path.join(tempDir, "nested", "hello.txt"),
        relativePath: "nested/hello.txt",
        writable: true,
      },
      options: {
        action: "write files",
        requireWritable: true,
      },
    } satisfies PathSafetyCheck;
    const pinned = {
      mountRootPath: tempDir,
      relativeParentPath: "nested",
      basename: "hello.txt",
    } satisfies PinnedSandboxEntry;
    const plan = buildPinnedWritePlan({
      check,
      pinned,
      mkdir: true,
    });

    const result = spawnSync("sh", ["-c", plan.script, "openclaw-test", ...(plan.args ?? [])], {
      input: Buffer.from("from-stdin"),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    await expect(fs.readFile(path.join(targetDir, "hello.txt"), "utf8")).resolves.toBe(
      "from-stdin",
    );
  });
});
