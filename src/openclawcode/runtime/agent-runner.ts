import crypto from "node:crypto";
import { mirrorMergedSkillsToProjectWorkspace } from "../../agents/skills.js";
import { createDefaultDeps } from "../../cli/deps.js";
import { agentCommand } from "../../commands/agent.js";
import {
  clearRuntimeConfigSnapshot,
  getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot,
  loadConfig,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenClawConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { createNonExitingRuntime } from "../../runtime.js";

export interface AgentRunRequest {
  prompt: string;
  workspaceDir: string;
  agentId?: string;
  sessionId?: string;
  extraSystemPrompt?: string;
  timeoutSeconds?: number;
}

export interface AgentRunResult {
  text: string;
  raw: unknown;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

const OPENCLAWCODE_DEFAULT_DENIED_TOOLS = ["write"] as const;
const OPENCLAWCODE_ENABLE_FS_TOOLS_ENV = "OPENCLAWCODE_ENABLE_FS_TOOLS";

function resolveOpenClawCodeDeniedTools(env: NodeJS.ProcessEnv = process.env): string[] {
  const enabled = new Set(
    String(env[OPENCLAWCODE_ENABLE_FS_TOOLS_ENV] ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry): entry is "edit" | "write" => entry === "edit" || entry === "write"),
  );
  return OPENCLAWCODE_DEFAULT_DENIED_TOOLS.filter((tool) => !enabled.has(tool));
}

function normalizeSessionToken(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || `openclawcode-${crypto.randomUUID()}`
  );
}

function extractText(raw: unknown): string {
  const payloads = (raw as { payloads?: Array<{ text?: string }> } | null | undefined)?.payloads;
  if (!Array.isArray(payloads)) {
    return "";
  }
  return payloads
    .map((payload) => (typeof payload.text === "string" ? payload.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function forceSessionScopedSandboxForAgent(
  config: OpenClawConfig,
  agentIdRaw?: string,
  options?: { env?: NodeJS.ProcessEnv },
): OpenClawConfig {
  const next = structuredClone(config);
  const agentId = normalizeAgentId(agentIdRaw);
  const deniedTools = resolveOpenClawCodeDeniedTools(options?.env);
  const appendDeniedPolicy = <T extends { deny?: string[] } | undefined>(policy: T): T => {
    const nextPolicy = {
      ...policy,
      deny: Array.from(new Set([...(policy?.deny ?? []), ...deniedTools])),
    };
    return nextPolicy as T;
  };

  const appendDeniedTools = <T extends { tools?: { deny?: string[] } }>(entry: T): T => ({
    ...entry,
    tools: appendDeniedPolicy(entry.tools),
  });

  next.tools = appendDeniedPolicy(next.tools);
  next.agents ??= {};
  next.agents.defaults ??= {};
  next.agents.defaults = appendDeniedTools(next.agents.defaults);
  next.agents.defaults.sandbox = {
    ...next.agents.defaults.sandbox,
    scope: "session",
  };

  if (agentId && Array.isArray(next.agents.list)) {
    next.agents.list = next.agents.list.map((entry) =>
      entry.id === agentId
        ? {
            ...appendDeniedTools(entry),
            sandbox: {
              ...entry.sandbox,
              scope: "session",
            },
          }
        : entry,
    );
  }

  return next;
}

export const __testing = {
  forceSessionScopedSandboxForAgent,
  resolveOpenClawCodeDeniedTools,
};

export class OpenClawAgentRunner implements AgentRunner {
  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const config = forceSessionScopedSandboxForAgent(loadConfig(), request.agentId);
    const sessionId = request.sessionId ?? `openclawcode-${crypto.randomUUID()}`;
    const sessionKey = `agent:${normalizeAgentId(request.agentId)}:${normalizeSessionToken(sessionId)}`;
    const previousRuntimeSnapshot = getRuntimeConfigSnapshot();
    const previousSourceSnapshot = getRuntimeConfigSourceSnapshot();

    setRuntimeConfigSnapshot(config, previousSourceSnapshot ?? config);

    try {
      await mirrorMergedSkillsToProjectWorkspace({
        workspaceDir: request.workspaceDir,
        config,
      });

      const raw = await agentCommand(
        {
          message: request.prompt,
          workspaceDir: request.workspaceDir,
          agentId: request.agentId,
          sessionId,
          sessionKey,
          extraSystemPrompt: request.extraSystemPrompt,
          timeout:
            typeof request.timeoutSeconds === "number" ? String(request.timeoutSeconds) : undefined,
          json: true,
        },
        createNonExitingRuntime(),
        createDefaultDeps(),
      );

      return {
        text: extractText(raw),
        raw,
      };
    } finally {
      if (previousRuntimeSnapshot) {
        setRuntimeConfigSnapshot(previousRuntimeSnapshot, previousSourceSnapshot ?? undefined);
      } else {
        clearRuntimeConfigSnapshot();
      }
    }
  }
}
