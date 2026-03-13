import crypto from "node:crypto";
import path from "node:path";
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
import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
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

export interface AgentRunFailureDiagnostics {
  stopReason?: string;
  provider?: string;
  model?: string;
  systemPromptChars?: number;
  skillsPromptChars?: number;
  toolSchemaChars?: number;
  toolCount?: number;
  skillCount?: number;
  injectedWorkspaceFileCount?: number;
  bootstrapWarningShown?: boolean;
  lastCallUsageTotal?: number;
}

export class AgentRunFailureError extends Error {
  constructor(
    message: string,
    readonly diagnostics: AgentRunFailureDiagnostics,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = "AgentRunFailureError";
  }
}

const OPENCLAWCODE_DEFAULT_DENIED_TOOLS = ["write"] as const;
const OPENCLAWCODE_ENABLE_FS_TOOLS_ENV = "OPENCLAWCODE_ENABLE_FS_TOOLS";
const OPENCLAWCODE_MODEL_FALLBACKS_ENV = "OPENCLAWCODE_MODEL_FALLBACKS";
const OPENCLAWCODE_WORKTREE_MARKER = `${path.sep}.openclawcode${path.sep}worktrees${path.sep}`;
const OPENCLAWCODE_WORKTREE_COORDINATION_TOOLS = [
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "subagents",
  "session_status",
] as const;
const OPENCLAWCODE_WORKTREE_SKILL_FILTER = ["coding-agent"] as const;

function resolveOpenClawCodeDeniedTools(env: NodeJS.ProcessEnv = process.env): string[] {
  const enabled = new Set(
    String(env[OPENCLAWCODE_ENABLE_FS_TOOLS_ENV] ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry): entry is "edit" | "write" => entry === "edit" || entry === "write"),
  );
  return OPENCLAWCODE_DEFAULT_DENIED_TOOLS.filter((tool) => !enabled.has(tool));
}

function resolveOpenClawCodeModelFallbacks(env: NodeJS.ProcessEnv = process.env): string[] {
  return Array.from(
    new Set(
      String(env[OPENCLAWCODE_MODEL_FALLBACKS_ENV] ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
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

function resolveOpenClawCodeBootstrapContextMode(workspaceDir: string): "lightweight" | undefined {
  return workspaceDir.includes(OPENCLAWCODE_WORKTREE_MARKER) ? "lightweight" : undefined;
}

function resolveOpenClawCodeWorktreeDeniedTools(workspaceDir: string): string[] {
  return workspaceDir.includes(OPENCLAWCODE_WORKTREE_MARKER)
    ? [...OPENCLAWCODE_WORKTREE_COORDINATION_TOOLS]
    : [];
}

function resolveOpenClawCodeWorktreeSkillFilter(workspaceDir: string): string[] | undefined {
  return workspaceDir.includes(OPENCLAWCODE_WORKTREE_MARKER)
    ? [...OPENCLAWCODE_WORKTREE_SKILL_FILTER]
    : undefined;
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

function extractStopReason(raw: unknown): string | undefined {
  const stopReason = (raw as { meta?: { stopReason?: unknown } } | null | undefined)?.meta
    ?.stopReason;
  return typeof stopReason === "string" && stopReason.trim() ? stopReason.trim() : undefined;
}

function extractSystemPromptReport(raw: unknown): SessionSystemPromptReport | undefined {
  const report = (raw as { meta?: { systemPromptReport?: unknown } } | null | undefined)?.meta
    ?.systemPromptReport;
  return report && typeof report === "object" ? (report as SessionSystemPromptReport) : undefined;
}

function extractAgentRunFailureDiagnostics(
  raw: unknown,
  stopReason?: string,
): AgentRunFailureDiagnostics {
  const meta = (
    raw as
      | {
          meta?: {
            agentMeta?: {
              provider?: unknown;
              model?: unknown;
              lastCallUsage?: { total?: unknown };
            };
            systemPromptReport?: unknown;
          };
        }
      | null
      | undefined
  )?.meta;
  const report = extractSystemPromptReport(raw);
  const provider =
    typeof meta?.agentMeta?.provider === "string"
      ? meta.agentMeta.provider
      : typeof report?.provider === "string"
        ? report.provider
        : undefined;
  const model =
    typeof meta?.agentMeta?.model === "string"
      ? meta.agentMeta.model
      : typeof report?.model === "string"
        ? report.model
        : undefined;
  const lastCallUsageTotal =
    typeof meta?.agentMeta?.lastCallUsage?.total === "number"
      ? meta.agentMeta.lastCallUsage.total
      : undefined;

  return {
    stopReason,
    provider,
    model,
    systemPromptChars:
      typeof report?.systemPrompt?.chars === "number" ? report.systemPrompt.chars : undefined,
    skillsPromptChars:
      typeof report?.skills?.promptChars === "number" ? report.skills.promptChars : undefined,
    toolSchemaChars:
      typeof report?.tools?.schemaChars === "number" ? report.tools.schemaChars : undefined,
    toolCount: Array.isArray(report?.tools?.entries) ? report.tools.entries.length : undefined,
    skillCount: Array.isArray(report?.skills?.entries) ? report.skills.entries.length : undefined,
    injectedWorkspaceFileCount: Array.isArray(report?.injectedWorkspaceFiles)
      ? report.injectedWorkspaceFiles.length
      : undefined,
    bootstrapWarningShown:
      typeof report?.bootstrapTruncation?.warningShown === "boolean"
        ? report.bootstrapTruncation.warningShown
        : undefined,
    lastCallUsageTotal,
  };
}

export function formatAgentRunFailureDiagnostics(
  diagnostics: AgentRunFailureDiagnostics | undefined,
): string | undefined {
  if (!diagnostics) {
    return undefined;
  }

  const modelId =
    diagnostics.provider && diagnostics.model
      ? `${diagnostics.provider}/${diagnostics.model}`
      : (diagnostics.provider ?? diagnostics.model);
  const parts = [
    modelId ? `model=${modelId}` : undefined,
    typeof diagnostics.systemPromptChars === "number"
      ? `prompt=${diagnostics.systemPromptChars}`
      : undefined,
    typeof diagnostics.skillsPromptChars === "number"
      ? `skillsPrompt=${diagnostics.skillsPromptChars}`
      : undefined,
    typeof diagnostics.toolSchemaChars === "number"
      ? `schema=${diagnostics.toolSchemaChars}`
      : undefined,
    typeof diagnostics.toolCount === "number" ? `tools=${diagnostics.toolCount}` : undefined,
    typeof diagnostics.skillCount === "number" ? `skills=${diagnostics.skillCount}` : undefined,
    typeof diagnostics.injectedWorkspaceFileCount === "number"
      ? `files=${diagnostics.injectedWorkspaceFileCount}`
      : undefined,
    typeof diagnostics.lastCallUsageTotal === "number"
      ? `usage=${diagnostics.lastCallUsageTotal}`
      : undefined,
    diagnostics.bootstrapWarningShown === true
      ? "bootstrap=warned"
      : diagnostics.bootstrapWarningShown === false
        ? "bootstrap=clean"
        : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? parts.join(", ") : undefined;
}

function assertSuccessfulAgentRun(raw: unknown): void {
  const stopReason = extractStopReason(raw);
  if (stopReason !== "error") {
    return;
  }
  const message = extractText(raw) || "Agent run failed.";
  throw new AgentRunFailureError(message, extractAgentRunFailureDiagnostics(raw, stopReason), raw);
}

function forceSessionScopedSandboxForAgent(
  config: OpenClawConfig,
  agentIdRaw?: string,
  options?: { env?: NodeJS.ProcessEnv; workspaceDir?: string },
): OpenClawConfig {
  const next = structuredClone(config);
  const agentId = normalizeAgentId(agentIdRaw);
  const modelFallbacks = resolveOpenClawCodeModelFallbacks(options?.env);
  const deniedTools = Array.from(
    new Set([
      ...resolveOpenClawCodeDeniedTools(options?.env),
      ...resolveOpenClawCodeWorktreeDeniedTools(options?.workspaceDir ?? ""),
    ]),
  );
  const skillFilter = resolveOpenClawCodeWorktreeSkillFilter(options?.workspaceDir ?? "");
  const appendModelFallbacks = <
    T extends { model?: string | { primary?: string; fallbacks?: string[] } } | undefined,
  >(
    entry: T,
  ): T => {
    if (!entry || modelFallbacks.length === 0) {
      return entry;
    }
    const currentModel = entry.model;
    if (
      currentModel &&
      typeof currentModel === "object" &&
      Object.hasOwn(currentModel, "fallbacks")
    ) {
      return entry;
    }
    return {
      ...entry,
      model:
        typeof currentModel === "string"
          ? {
              primary: currentModel,
              fallbacks: [...modelFallbacks],
            }
          : {
              ...currentModel,
              fallbacks: [...modelFallbacks],
            },
    } as T;
  };
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
  next.agents.defaults = appendModelFallbacks(appendDeniedTools(next.agents.defaults));
  next.agents.defaults.sandbox = {
    ...next.agents.defaults.sandbox,
    scope: "session",
  };

  if (agentId) {
    let matchedAgent = false;
    next.agents.list = (next.agents.list ?? []).map((entry) => {
      if (entry.id === agentId) {
        matchedAgent = true;
      }
      return entry.id === agentId
        ? {
            ...appendModelFallbacks(appendDeniedTools(entry)),
            ...(skillFilter ? { skills: [...skillFilter] } : {}),
            sandbox: {
              ...entry.sandbox,
              scope: "session",
            },
          }
        : entry;
    });
    if (!matchedAgent && skillFilter) {
      next.agents.list.push({
        id: agentId,
        skills: [...skillFilter],
        ...(modelFallbacks.length > 0 ? { model: { fallbacks: [...modelFallbacks] } } : {}),
      });
    }
  }

  return next;
}

export const __testing = {
  forceSessionScopedSandboxForAgent,
  resolveOpenClawCodeDeniedTools,
  resolveOpenClawCodeModelFallbacks,
  extractStopReason,
  extractAgentRunFailureDiagnostics,
  formatAgentRunFailureDiagnostics,
  assertSuccessfulAgentRun,
  resolveOpenClawCodeBootstrapContextMode,
  resolveOpenClawCodeWorktreeDeniedTools,
  resolveOpenClawCodeWorktreeSkillFilter,
};

export class OpenClawAgentRunner implements AgentRunner {
  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const config = forceSessionScopedSandboxForAgent(loadConfig(), request.agentId, {
      workspaceDir: request.workspaceDir,
    });
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
          bootstrapContextMode: resolveOpenClawCodeBootstrapContextMode(request.workspaceDir),
          json: true,
        },
        createNonExitingRuntime(),
        createDefaultDeps(),
      );
      assertSuccessfulAgentRun(raw);

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
