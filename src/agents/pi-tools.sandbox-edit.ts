import fs from "node:fs/promises";
import path from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { AnyAgentTool } from "./pi-tools.types.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";

function readEditParam(record: Record<string, unknown> | undefined, key: string, altKey: string) {
  if (record && typeof record[key] === "string") {
    return record[key];
  }
  if (record && typeof record[altKey] === "string") {
    return record[altKey];
  }
  return undefined;
}

function readEditPathParam(record: Record<string, unknown> | undefined): string | undefined {
  if (record && typeof record.path === "string") {
    return record.path;
  }
  if (record && typeof record.file_path === "string") {
    return record.file_path;
  }
  return undefined;
}

function formatSuccessfulEditResult(pathParam: string): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: `Successfully replaced text in ${pathParam}.`,
      },
    ],
    details: { diff: "", firstChangedLine: undefined },
  } as AgentToolResult<unknown>;
}

function formatDeterministicEditResult(
  pathParam: string,
  firstChangedLine: number | undefined,
): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: `Successfully replaced text in ${pathParam}.`,
      },
    ],
    details: {
      diff: "",
      firstChangedLine,
    },
  } as AgentToolResult<unknown>;
}

function countOccurrences(content: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}

function findFirstChangedLine(content: string, oldText: string): number | undefined {
  const index = content.indexOf(oldText);
  if (index < 0) {
    return undefined;
  }
  return content.slice(0, index).split("\n").length;
}

function resolveSandboxHostPath(params: {
  bridge: SandboxFsBridge;
  root: string;
  pathParam: string;
}): string {
  return params.bridge.resolvePath({
    filePath: params.pathParam,
    cwd: params.root,
  }).hostPath;
}

async function readSandboxHostFile(params: {
  bridge: SandboxFsBridge;
  root: string;
  pathParam: string;
}): Promise<string> {
  const hostPath = resolveSandboxHostPath(params);
  return await fs.readFile(hostPath, "utf-8");
}

async function verifySandboxEditApplied(params: {
  pathParam: string;
  oldText?: string;
  newText?: string;
  expectedContent?: string;
  bridge: SandboxFsBridge;
  root: string;
}): Promise<boolean> {
  const content = await readSandboxHostFile(params);
  if (params.expectedContent !== undefined) {
    return content === params.expectedContent;
  }
  const hasNew = params.newText ? content.includes(params.newText) : true;
  const oldTextCanRemain =
    params.oldText !== undefined &&
    params.newText !== undefined &&
    params.newText.includes(params.oldText);
  const stillHasOld =
    !oldTextCanRemain &&
    params.oldText !== undefined &&
    params.oldText.length > 0 &&
    content.includes(params.oldText);
  return hasNew && !stillHasOld;
}

async function restoreSandboxFile(params: {
  bridge: SandboxFsBridge;
  root: string;
  pathParam: string;
  originalContent: Buffer;
  signal?: AbortSignal;
}): Promise<boolean> {
  try {
    await params.bridge.writeFile({
      filePath: params.pathParam,
      cwd: params.root,
      data: params.originalContent,
      mkdir: true,
      signal: params.signal,
    });
  } catch {
    // Fall through to host-path restore verification.
  }

  const hostPath = resolveSandboxHostPath(params);
  const expected = params.originalContent.toString("utf-8");
  const matchesAfterBridgeRestore = await fs
    .readFile(hostPath, "utf-8")
    .then((content) => content === expected)
    .catch(() => false);
  if (matchesAfterBridgeRestore) {
    return true;
  }

  await fs.mkdir(path.dirname(hostPath), { recursive: true });
  await fs.writeFile(hostPath, params.originalContent);
  return await fs
    .readFile(hostPath, "utf-8")
    .then((content) => content === expected)
    .catch(() => false);
}

function createExactReplaceContent(params: {
  pathParam: string;
  originalContent: string;
  oldText: string;
  newText: string;
}): { nextContent: string; firstChangedLine: number | undefined } {
  const matches = countOccurrences(params.originalContent, params.oldText);
  if (matches === 0) {
    throw new Error(
      `Could not find the exact text to replace in ${params.pathParam}. The old text must match exactly including all whitespace and newlines.`,
    );
  }
  if (matches > 1) {
    throw new Error(
      `Found ${matches} matches for the requested text in ${params.pathParam}. Provide a more specific oldText/old_string so the edit is unambiguous.`,
    );
  }

  const firstChangedLine = findFirstChangedLine(params.originalContent, params.oldText);
  return {
    nextContent: params.originalContent.replace(params.oldText, params.newText),
    firstChangedLine,
  };
}

export function createDeterministicSandboxEditTool(
  base: AnyAgentTool,
  params: { bridge: SandboxFsBridge; root: string },
): AnyAgentTool {
  return {
    ...base,
    execute: async (
      toolCallId: string,
      rawParams: unknown,
      signal: AbortSignal | undefined,
      onUpdate?: AgentToolUpdateCallback<unknown>,
    ) => {
      const record =
        rawParams && typeof rawParams === "object"
          ? (rawParams as Record<string, unknown>)
          : undefined;
      const pathParam = readEditPathParam(record);
      const newText = readEditParam(record, "newText", "new_string");
      const oldText = readEditParam(record, "oldText", "old_string");
      const originalContent =
        pathParam == null
          ? undefined
          : await params.bridge
              .readFile({ filePath: pathParam, cwd: params.root, signal })
              .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                return /ENOENT|No such file/i.test(message) ? undefined : Promise.reject(error);
              });

      try {
        if (!pathParam || oldText === undefined || newText === undefined) {
          return await base.execute(toolCallId, rawParams, signal, onUpdate);
        }

        if (originalContent === undefined) {
          throw new Error(`File not found: ${pathParam}`);
        }

        const originalText = originalContent.toString("utf-8");
        const replacement = createExactReplaceContent({
          pathParam,
          originalContent: originalText,
          oldText,
          newText,
        });

        await params.bridge.writeFile({
          filePath: pathParam,
          cwd: params.root,
          data: replacement.nextContent,
          mkdir: true,
          signal,
        });

        const applied = await verifySandboxEditApplied({
          bridge: params.bridge,
          root: params.root,
          pathParam,
          oldText,
          newText,
          expectedContent: replacement.nextContent,
        }).catch(() => false);
        if (applied) {
          return formatDeterministicEditResult(pathParam, replacement.firstChangedLine);
        }

        const restored = await restoreSandboxFile({
          bridge: params.bridge,
          root: params.root,
          pathParam,
          originalContent,
          signal,
        });

        throw new Error(
          `Sandbox edit verification failed for ${pathParam}: file content on disk did not match the requested replacement after the tool reported success.${restored ? " The original file contents were restored." : ""}`,
        );
      } catch (error) {
        if (!pathParam || !newText) {
          throw error;
        }

        try {
          const applied = await verifySandboxEditApplied({
            bridge: params.bridge,
            root: params.root,
            pathParam,
            oldText,
            newText,
          });
          if (applied) {
            return formatSuccessfulEditResult(pathParam);
          }
        } catch {
          // Bridge read failed or path is invalid; keep the original error.
        }

        const restored =
          pathParam && originalContent !== undefined
            ? await restoreSandboxFile({
                bridge: params.bridge,
                root: params.root,
                pathParam,
                originalContent,
                signal,
              }).catch(() => false)
            : false;
        if (restored && error instanceof Error && !error.message.includes("restored")) {
          throw new Error(`${error.message} The original file contents were restored.`, {
            cause: error,
          });
        }

        throw error;
      }
    },
  };
}
