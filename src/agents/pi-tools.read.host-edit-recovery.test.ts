/**
 * Tests for edit tool post-write recovery: when the upstream library throws after
 * having already written the file (e.g. generateDiffString fails), we catch and
 * if the file on disk contains the intended newText we return success (#32333).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EditToolOptions } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("createHostWorkspaceEditTool post-write recovery", () => {
  let tmpDir = "";

  afterEach(async () => {
    mocks.executeMode = "throw";
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
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
    const textBlock = content.find((b) => b?.type === "text" && typeof b.text === "string");
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
