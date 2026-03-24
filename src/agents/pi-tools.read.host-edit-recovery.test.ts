/**
 * Tests for edit tool recovery hardening across host and sandbox flows.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EditToolOptions } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wrapEditToolWithRecovery } from "./pi-tools.host-edit.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
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
            throw new Error("Simulated post-write failure (e.g. generateDiffString)");
          }
          if (mocks.executeMode === "corrupt-success") {
            const params = args[1] as { path?: string };
            if (typeof params?.path === "string") {
              await fs.writeFile(params.path, "", "utf-8");
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

const { createHostWorkspaceEditTool } = await import("./pi-tools.read.js");

function createInMemoryBridge(root: string, files: Map<string, string>): SandboxFsBridge {
  const resolveAbsolute = (filePath: string, cwd?: string) =>
    path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd ?? root, filePath);

  const readStat = (absolutePath: string): SandboxFsStat | null => {
    const content = files.get(absolutePath);
    if (typeof content !== "string") {
      return null;
    }
    return {
      type: "file",
      size: Buffer.byteLength(content, "utf8"),
      mtimeMs: 0,
    };
  };

  return {
    resolvePath: ({ filePath, cwd }) => {
      const absolutePath = resolveAbsolute(filePath, cwd);
      return {
        hostPath: absolutePath,
        relativePath: path.relative(root, absolutePath),
        containerPath: absolutePath,
      };
    },
    readFile: async ({ filePath, cwd }) => {
      const absolutePath = resolveAbsolute(filePath, cwd);
      const content = files.get(absolutePath);
      if (typeof content !== "string") {
        throw new Error(`ENOENT: ${absolutePath}`);
      }
      return Buffer.from(content, "utf8");
    },
    writeFile: async ({ filePath, cwd, data }) => {
      const absolutePath = resolveAbsolute(filePath, cwd);
      files.set(absolutePath, typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
    },
    mkdirp: async () => {},
    remove: async ({ filePath, cwd }) => {
      files.delete(resolveAbsolute(filePath, cwd));
    },
    rename: async ({ from, to, cwd }) => {
      const fromPath = resolveAbsolute(from, cwd);
      const toPath = resolveAbsolute(to, cwd);
      const content = files.get(fromPath);
      if (typeof content !== "string") {
        throw new Error(`ENOENT: ${fromPath}`);
      }
      files.set(toPath, content);
      files.delete(fromPath);
    },
    stat: async ({ filePath, cwd }) => readStat(resolveAbsolute(filePath, cwd)),
  };
}

describe("edit tool recovery hardening", () => {
  let tmpDir = "";

  afterEach(async () => {
    mocks.executeMode = "throw";
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  function createRecoveredEditTool(params: {
    root: string;
    readFile: (absolutePath: string) => Promise<string>;
    execute: AnyAgentTool["execute"];
  }) {
    const base = {
      name: "edit",
      execute: params.execute,
    } as unknown as AnyAgentTool;
    return wrapEditToolWithRecovery(base, {
      root: params.root,
      readFile: params.readFile,
    });
  }

  it("adds current file contents to exact-match mismatch errors", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "demo.txt");
    await fs.writeFile(filePath, "actual current content", "utf-8");

    const tool = createRecoveredEditTool({
      root: tmpDir,
      readFile: (absolutePath) => fs.readFile(absolutePath, "utf-8"),
      execute: async () => {
        throw new Error(
          "Could not find the exact text in demo.txt. The old text must match exactly including all whitespace and newlines.",
        );
      },
    });
    await expect(
      tool.execute(
        "call-1",
        { path: filePath, oldText: "missing", newText: "replacement" },
        undefined,
      ),
    ).rejects.toThrow(/Current file contents:\nactual current content/);
  });

  it("recovers success after a post-write throw when CRLF output contains newText and oldText is only a substring", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "demo.txt");
    await fs.writeFile(filePath, 'const value = "foo";\r\n', "utf-8");

    const tool = createRecoveredEditTool({
      root: tmpDir,
      readFile: (absolutePath) => fs.readFile(absolutePath, "utf-8"),
      execute: async () => {
        await fs.writeFile(filePath, 'const value = "foobar";\r\n', "utf-8");
        throw new Error("Simulated post-write failure (e.g. generateDiffString)");
      },
    });
    const result = await tool.execute(
      "call-1",
      {
        path: filePath,
        oldText: 'const value = "foo";\n',
        newText: 'const value = "foobar";\n',
      },
      undefined,
    );

    expect(result).toMatchObject({ isError: false });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: `Successfully replaced text in ${filePath}.`,
    });
  });

  it("does not recover false success when the file never changed", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "demo.txt");
    await fs.writeFile(filePath, "replacement already present", "utf-8");

    const tool = createRecoveredEditTool({
      root: tmpDir,
      readFile: (absolutePath) => fs.readFile(absolutePath, "utf-8"),
      execute: async () => {
        throw new Error("Simulated post-write failure (e.g. generateDiffString)");
      },
    });
    await expect(
      tool.execute(
        "call-1",
        { path: filePath, oldText: "missing", newText: "replacement already present" },
        undefined,
      ),
    ).rejects.toThrow("Simulated post-write failure");
  });

  it("recovers deletion edits when the file changed and oldText is gone", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "demo.txt");
    await fs.writeFile(filePath, "before delete me after\n", "utf-8");

    const tool = createRecoveredEditTool({
      root: tmpDir,
      readFile: (absolutePath) => fs.readFile(absolutePath, "utf-8"),
      execute: async () => {
        await fs.writeFile(filePath, "before  after\n", "utf-8");
        throw new Error("Simulated post-write failure (e.g. generateDiffString)");
      },
    });
    const result = await tool.execute(
      "call-1",
      { path: filePath, oldText: "delete me", newText: "" },
      undefined,
    );

    expect(result).toMatchObject({ isError: false });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: `Successfully replaced text in ${filePath}.`,
    });
  });

  it("applies the same recovery path to sandboxed edit tools", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "demo.txt");
    const files = new Map<string, string>([[filePath, "before old text after\n"]]);

    const bridge = createInMemoryBridge(tmpDir, files);
    const tool = createRecoveredEditTool({
      root: tmpDir,
      readFile: async (absolutePath: string) =>
        (await bridge.readFile({ filePath: absolutePath, cwd: tmpDir })).toString("utf8"),
      execute: async () => {
        files.set(filePath, "before new text after\n");
        throw new Error("Simulated post-write failure (e.g. generateDiffString)");
      },
    });
    const result = await tool.execute(
      "call-1",
      { path: filePath, oldText: "old text", newText: "new text" },
      undefined,
    );

    expect(result).toMatchObject({ isError: false });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: `Successfully replaced text in ${filePath}.`,
    });
  });

  it("returns success when upstream throws but file has newText and no longer has oldText", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "MEMORY.md");
    const oldText = "# Memory";
    const newText = "Blog Writing";
    await fs.writeFile(filePath, `\n\n${newText}\n`, "utf-8");

    const tool = createHostWorkspaceEditTool(tmpDir);
    const result = await tool.execute("call-1", { path: filePath, oldText, newText }, undefined);

    expect(result).toBeDefined();
    const content = Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: Array<{ type?: string; text?: string }> }).content
      : [];
    const textBlock = content.find((block) => block?.type === "text" && typeof block.text === "string");
    expect(textBlock?.text).toContain("Successfully replaced text");
  });

  it("rethrows when file on disk does not contain newText", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "other.md");
    await fs.writeFile(filePath, "unchanged content", "utf-8");

    const tool = createHostWorkspaceEditTool(tmpDir);
    await expect(
      tool.execute("call-1", { path: filePath, oldText: "x", newText: "never-written" }, undefined),
    ).rejects.toThrow("Simulated post-write failure");
  });

  it("rethrows when file still contains oldText (pre-write failure; avoid false success)", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "pre-write-fail.md");
    const oldText = "replace me";
    const newText = "new content";
    await fs.writeFile(filePath, `before ${oldText} after ${newText}`, "utf-8");

    const tool = createHostWorkspaceEditTool(tmpDir);
    await expect(
      tool.execute("call-1", { path: filePath, oldText, newText }, undefined),
    ).rejects.toThrow("Simulated post-write failure");
  });

  it("restores the original file when upstream reports success but leaves corrupted contents on disk", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "corrupt-success.md");
    const original = "before old text after\n";
    const oldText = "old text";
    const newText = "new text";
    await fs.writeFile(filePath, original, "utf-8");
    mocks.executeMode = "corrupt-success";

    const tool = createHostWorkspaceEditTool(tmpDir);
    await expect(
      tool.execute("call-1", { path: filePath, oldText, newText }, undefined),
    ).rejects.toThrow(/Edit verification failed/);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(original);
  });

  it("verifies and restores file_path alias edits instead of silently trusting the upstream success path", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-recovery-"));
    const filePath = path.join(tmpDir, "corrupt-success-alias.md");
    const original = "before old text after\n";
    await fs.writeFile(filePath, original, "utf-8");
    mocks.executeMode = "corrupt-success";

    const tool = createHostWorkspaceEditTool(tmpDir);
    await expect(
      tool.execute(
        "call-1",
        { file_path: filePath, old_string: "old text", new_string: "new text" },
        undefined,
      ),
    ).rejects.toThrow(/Edit verification failed/);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(original);
  });
});
