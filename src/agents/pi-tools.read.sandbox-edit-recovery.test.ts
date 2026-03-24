import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SandboxFsBridge, SandboxFsStat } from "./sandbox/fs-bridge.js";

const { createSandboxedEditTool } = await import("./pi-tools.read.js");

function createTestBridge(root: string, options?: { corruptWrites?: boolean }): SandboxFsBridge {
  const resolveAbsolute = (filePath: string, cwd?: string) => {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(cwd ?? root, filePath);
  };

  const statFile = async (absolutePath: string): Promise<SandboxFsStat | null> => {
    try {
      const value = await fs.stat(absolutePath);
      return {
        type: value.isFile() ? "file" : value.isDirectory() ? "directory" : "other",
        size: value.size,
        mtimeMs: value.mtimeMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return /ENOENT|no such file/i.test(message) ? null : Promise.reject(error);
    }
  };

  return {
    resolvePath(params) {
      const hostPath = resolveAbsolute(params.filePath, params.cwd);
      return {
        hostPath,
        relativePath: path.relative(root, hostPath),
        containerPath: hostPath,
      };
    },
    async readFile(params) {
      return await fs.readFile(resolveAbsolute(params.filePath, params.cwd));
    },
    async writeFile(params) {
      const absolutePath = resolveAbsolute(params.filePath, params.cwd);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      if (options?.corruptWrites) {
        await fs.writeFile(absolutePath, "");
        return;
      }
      await fs.writeFile(absolutePath, params.data);
    },
    async mkdirp(params) {
      await fs.mkdir(resolveAbsolute(params.filePath, params.cwd), { recursive: true });
    },
    async remove(params) {
      await fs.rm(resolveAbsolute(params.filePath, params.cwd), {
        recursive: params.recursive,
        force: params.force,
      });
    },
    async rename(params) {
      await fs.rename(
        resolveAbsolute(params.from, params.cwd),
        resolveAbsolute(params.to, params.cwd),
      );
    },
    async stat(params) {
      return await statFile(resolveAbsolute(params.filePath, params.cwd));
    },
  };
}

describe("createSandboxedEditTool", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("replaces exact text deterministically through the sandbox bridge", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-recovery-"));
    const filePath = path.join(tmpDir, "file.ts");
    await fs.writeFile(filePath, "const value = 'old text';\n", "utf-8");

    const tool = createSandboxedEditTool({
      root: tmpDir,
      bridge: createTestBridge(tmpDir),
    });
    const result = await tool.execute(
      "call-1",
      { path: "file.ts", oldText: "old text", newText: "new text" },
      undefined,
    );

    const content = Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: Array<{ type?: string; text?: string }> }).content
      : [];
    expect(content.find((entry) => entry?.type === "text")?.text).toContain(
      "Successfully replaced text",
    );
    await expect(fs.readFile(filePath, "utf-8")).resolves.toContain("new text");
  });

  it("rejects ambiguous replacements instead of editing the wrong occurrence", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-recovery-"));
    const filePath = path.join(tmpDir, "file.ts");
    const original = "const value = 'old text';\nconst another = 'old text';\n";
    await fs.writeFile(filePath, original, "utf-8");

    const tool = createSandboxedEditTool({
      root: tmpDir,
      bridge: createTestBridge(tmpDir),
    });
    await expect(
      tool.execute(
        "call-1",
        { path: "file.ts", oldText: "old text", newText: "new text" },
        undefined,
      ),
    ).rejects.toThrow(/unambiguous/);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(original);
  });

  it("supports Claude-style alias params in sandbox mode", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-recovery-"));
    const filePath = path.join(tmpDir, "file-alias.ts");
    const original = "const value = 'old text';\n";
    await fs.writeFile(filePath, original, "utf-8");

    const tool = createSandboxedEditTool({
      root: tmpDir,
      bridge: createTestBridge(tmpDir),
    });
    const result = await tool.execute(
      "call-1",
      { file_path: "file-alias.ts", old_string: "old text", new_string: "new text" },
      undefined,
    );
    const content = Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: Array<{ type?: string; text?: string }> }).content
      : [];
    expect(content.find((entry) => entry?.type === "text")?.text).toContain(
      "Successfully replaced text",
    );
    await expect(fs.readFile(filePath, "utf-8")).resolves.toContain("new text");
  });

  it("accepts replacements when the new block contains the old block as a prefix", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-recovery-"));
    const filePath = path.join(tmpDir, "README.md");
    const original = [
      "- `/occode-start`",
      "- `/occode-rerun`",
      "- `/occode-status`",
      "- `/occode-sync`",
      "",
    ].join("\n");
    await fs.writeFile(filePath, original, "utf-8");

    const tool = createSandboxedEditTool({
      root: tmpDir,
      bridge: createTestBridge(tmpDir),
    });
    const oldText = [
      "- `/occode-start`",
      "- `/occode-rerun`",
      "- `/occode-status`",
      "- `/occode-sync`",
      "",
    ].join("\n");
    const newText = [
      "- `/occode-start`",
      "- `/occode-rerun`",
      "- `/occode-status`",
      "- `/occode-sync`",
      "- `/occode-sync` runs a manual reconciliation pass across local state",
      "",
    ].join("\n");

    const result = await tool.execute(
      "call-1",
      { file_path: "README.md", old_string: oldText, new_string: newText },
      undefined,
    );
    const content = Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: Array<{ type?: string; text?: string }> }).content
      : [];
    expect(content.find((entry) => entry?.type === "text")?.text).toContain(
      "Successfully replaced text",
    );
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(newText);
  });

  it("falls back to host-path restoration when bridge writes keep leaving the sandbox file empty", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-recovery-"));
    const filePath = path.join(tmpDir, "file-host-restore.ts");
    const original = "const value = 'old text';\n";
    await fs.writeFile(filePath, original, "utf-8");

    const tool = createSandboxedEditTool({
      root: tmpDir,
      bridge: createTestBridge(tmpDir, { corruptWrites: true }),
    });
    await expect(
      tool.execute(
        "call-1",
        { file_path: "file-host-restore.ts", old_string: "old text", new_string: "new text" },
        undefined,
      ),
    ).rejects.toThrow(/The original file contents were restored/);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(original);
  });
});
