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

async function verifySandboxEditApplied(params: {
  bridge: SandboxFsBridge;
  root: string;
  pathParam: string;
  oldText?: string;
  newText?: string;
}): Promise<boolean> {
  const content = (
    await params.bridge.readFile({
      filePath: params.pathParam,
      cwd: params.root,
    })
  ).toString("utf-8");
  const hasNew = params.newText ? content.includes(params.newText) : true;
  const stillHasOld =
    params.oldText !== undefined && params.oldText.length > 0 && content.includes(params.oldText);
  return hasNew && !stillHasOld;
}

export function wrapSandboxEditToolWithPostWriteRecovery(
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
        const result = await base.execute(toolCallId, rawParams, signal, onUpdate);
        if (!pathParam || (!newText && !oldText)) {
          return result;
        }

        const applied = await verifySandboxEditApplied({
          bridge: params.bridge,
          root: params.root,
          pathParam,
          oldText,
          newText,
        }).catch(() => false);
        if (applied) {
          return result;
        }

        if (pathParam && originalContent !== undefined) {
          await params.bridge.writeFile({
            filePath: pathParam,
            cwd: params.root,
            data: originalContent,
            mkdir: true,
            signal,
          });
        }

        throw new Error(
          `Sandbox edit verification failed for ${pathParam}: file content on disk did not match the requested replacement after the tool reported success.${originalContent !== undefined ? " The original file contents were restored." : ""}`,
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

        throw error;
      }
    },
  };
}
