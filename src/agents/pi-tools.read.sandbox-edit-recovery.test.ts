import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EditToolOptions } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxFsBridge, SandboxFsStat } from "./sandbox/fs-bridge.js";

const mocks = vi.hoisted(() => ({
  executeMode: "throw" as "throw" | "pass-through" | "corrupt-success",
}));

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
  return {
    ...actual,
    createEditTool: (cwd: string, options?: EditToolOptions) => {
      const base = actual.createEditTool(cwd, options);
      return {
        ...base,
        execute: async (...args: Parameters<typeof base.execute>) => {
          if (mocks.executeMode === "throw") {
            throw new Error("Simulated sandbox post-write failure");
          }
          if (mocks.executeMode === "corrupt-success") {
            const params = args[1] as { path?: string };
            if (typeof params?.path === "string") {
              await fs.writeFile(path.join(cwd, params.path), "", "utf-8");
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Successfully replaced text in ${params?.path ?? "unknown"}.`,
                },
              ],
              details: { diff: "", firstChangedLine: undefined },
            };
          }
          return base.execute(...args);
        },
      };
    },
  };
});

const { createSandboxedEditTool } = await import("./pi-tools.read.js");

function createTestBridge(root: string): SandboxFsBridge {
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

describe("createSandboxedEditTool post-write recovery", () => {
  let tmpDir = "";

  afterEach(async () => {
    mocks.executeMode = "throw";
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("returns success when upstream throws but the sandbox file already contains the requested text", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-recovery-"));
    const filePath = path.join(tmpDir, "file.ts");
    const oldText = "old text";
    const newText = "new text";
    await fs.writeFile(filePath, `${newText}\n`, "utf-8");

    const tool = createSandboxedEditTool({
      root: tmpDir,
      bridge: createTestBridge(tmpDir),
    });
    const result = await tool.execute("call-1", { path: "file.ts", oldText, newText }, undefined);

    const content = Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: Array<{ type?: string; text?: string }> }).content
      : [];
    expect(content.find((entry) => entry?.type === "text")?.text).toContain(
      "Successfully replaced text",
    );
  });

  it("restores the original sandbox file when the tool reports success but leaves corrupted contents on disk", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-recovery-"));
    const filePath = path.join(tmpDir, "file.ts");
    const original = "const value = 'old text';\n";
    await fs.writeFile(filePath, original, "utf-8");
    mocks.executeMode = "corrupt-success";

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
    ).rejects.toThrow(/Sandbox edit verification failed/);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(original);
  });

  it("verifies and restores file_path alias edits in sandbox mode", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sandbox-edit-recovery-"));
    const filePath = path.join(tmpDir, "file-alias.ts");
    const original = "const value = 'old text';\n";
    await fs.writeFile(filePath, original, "utf-8");
    mocks.executeMode = "corrupt-success";

    const tool = createSandboxedEditTool({
      root: tmpDir,
      bridge: createTestBridge(tmpDir),
    });
    await expect(
      tool.execute(
        "call-1",
        { file_path: "file-alias.ts", old_string: "old text", new_string: "new text" },
        undefined,
      ),
    ).rejects.toThrow(/Sandbox edit verification failed/);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(original);
  });
});
