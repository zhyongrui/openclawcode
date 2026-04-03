import { resolveAcpThreadSessionDetailLines } from "../acp/runtime/session-identifiers.js";
import { formatCliCommand } from "../cli/command-format.js";
import {
  loadSessionStore,
  resolveSessionStoreTargets,
  type SessionEntry,
  type SessionStoreTarget,
} from "../config/sessions.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { parseAgentSessionKey } from "../routing/session-key.js";

const RESUME_MESSAGE = "Continue from the latest background task state.";

function quoteCliArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

type ResolvedBackgroundSession = {
  sessionKey: string;
  entry?: SessionEntry;
  target?: SessionStoreTarget;
};

export type BackgroundSessionResumeDetail = {
  sessionKey: string;
  sessionId?: string;
  agentId?: string;
  resumeWith: string;
  acpDetailLines: string[];
};

function resolveBackgroundSessionEntry(
  cfg: OpenClawConfig,
  sessionKey: string,
): ResolvedBackgroundSession {
  const targets = resolveSessionStoreTargets(cfg, { allAgents: true });
  for (const target of targets) {
    const entry = loadSessionStore(target.storePath)[sessionKey];
    if (entry) {
      return {
        sessionKey,
        entry,
        target,
      };
    }
  }
  return { sessionKey };
}

function buildResumeWithCommand(params: {
  sessionKey: string;
  entry?: SessionEntry;
}): string {
  const sessionId = params.entry?.sessionId?.trim();
  if (sessionId) {
    return formatCliCommand(
      `openclaw agent --session-id ${quoteCliArg(sessionId)} --message ${quoteCliArg(RESUME_MESSAGE)}`,
    );
  }
  return formatCliCommand(
    `openclaw agent --session-key ${quoteCliArg(params.sessionKey)} --message ${quoteCliArg(RESUME_MESSAGE)}`,
  );
}

export function describeBackgroundSessionResume(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  entry?: SessionEntry;
  target?: SessionStoreTarget;
}): BackgroundSessionResumeDetail | undefined {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return undefined;
  }
  const resolved =
    params.entry || params.target
      ? {
          sessionKey,
          entry: params.entry,
          target: params.target,
        }
      : resolveBackgroundSessionEntry(params.cfg, sessionKey);
  return {
    sessionKey,
    ...(resolved.entry?.sessionId?.trim() ? { sessionId: resolved.entry.sessionId.trim() } : {}),
    ...((parseAgentSessionKey(sessionKey)?.agentId ?? resolved.target?.agentId)
      ? { agentId: parseAgentSessionKey(sessionKey)?.agentId ?? resolved.target?.agentId }
      : {}),
    resumeWith: buildResumeWithCommand({
      sessionKey,
      entry: resolved.entry,
    }),
    acpDetailLines: resolved.entry?.acp
      ? resolveAcpThreadSessionDetailLines({
          sessionKey,
          meta: resolved.entry.acp,
        })
      : [],
  };
}

export function formatBackgroundSessionResumeLines(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  entry?: SessionEntry;
  target?: SessionStoreTarget;
  indent?: string;
}): string[] {
  const detail = describeBackgroundSessionResume({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    entry: params.entry,
    target: params.target,
  });
  if (!detail) {
    return [];
  }
  const indent = params.indent ?? "";
  const lines = [`${indent}resumeSessionKey: ${detail.sessionKey}`];
  if (detail.sessionId) {
    lines.push(`${indent}resumeSessionId: ${detail.sessionId}`);
  }
  if (detail.agentId) {
    lines.push(`${indent}resumeAgent: ${detail.agentId}`);
  }
  lines.push(`${indent}resumeWith: ${detail.resumeWith}`);
  for (const line of detail.acpDetailLines) {
    lines.push(`${indent}${line}`);
  }
  return lines;
}

export function formatBackgroundChildSessionGroupLines(params: {
  cfg: OpenClawConfig;
  sessionKeys: Iterable<string | undefined>;
}): string[] {
  const uniqueKeys = Array.from(
    new Set(
      Array.from(params.sessionKeys, (value) => value?.trim()).filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  if (uniqueKeys.length === 0) {
    return [];
  }
  const lines = ["Child sessions:"];
  for (const sessionKey of uniqueKeys) {
    lines.push(`- ${sessionKey}`);
    const detailLines = formatBackgroundSessionResumeLines({
      cfg: params.cfg,
      sessionKey,
      indent: "  ",
    }).filter((line) => !line.startsWith("  resumeSessionKey: "));
    lines.push(...detailLines);
  }
  return lines;
}
