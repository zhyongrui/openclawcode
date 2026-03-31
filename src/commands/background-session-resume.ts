import { resolveAcpThreadSessionDetailLines } from "../acp/runtime/session-identifiers.js";
import { formatCliCommand } from "../cli/command-format.js";
import {
  loadSessionStore,
  resolveSessionStoreTargets,
  type SessionEntry,
  type SessionStoreTarget,
} from "../config/sessions.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

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

export function formatBackgroundSessionResumeLines(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  indent?: string;
}): string[] {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return [];
  }
  const indent = params.indent ?? "";
  const resolved = resolveBackgroundSessionEntry(params.cfg, sessionKey);
  const lines = [`${indent}resumeSessionKey: ${sessionKey}`];
  const sessionId = resolved.entry?.sessionId?.trim();
  if (sessionId) {
    lines.push(`${indent}resumeSessionId: ${sessionId}`);
  }
  if (resolved.target?.agentId) {
    lines.push(`${indent}resumeAgent: ${resolved.target.agentId}`);
  }
  lines.push(
    `${indent}resumeWith: ${buildResumeWithCommand({
      sessionKey,
      entry: resolved.entry,
    })}`,
  );
  if (resolved.entry?.acp) {
    for (const line of resolveAcpThreadSessionDetailLines({
      sessionKey,
      meta: resolved.entry.acp,
    })) {
      lines.push(`${indent}${line}`);
    }
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
