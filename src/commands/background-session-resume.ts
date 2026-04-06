import fs from "node:fs";
import { resolveAcpThreadSessionDetailLines } from "../acp/runtime/session-identifiers.js";
import { formatCliCommand } from "../cli/command-format.js";
import {
  loadSessionStore,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionStoreTargets,
  type SessionEntry,
  type SessionStoreTarget,
} from "../config/sessions.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { parseAgentSessionKey } from "../routing/session-key.js";

export const DEFAULT_BACKGROUND_RESUME_MESSAGE =
  "Continue from the latest background task state.";

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

export type BackgroundSessionCompletionRouting = {
  mode: "detached_delivery" | "foreground_reattached";
  summary: string;
  reattachedAt?: number;
};

export type BackgroundSessionTranscriptHandoff = {
  mode: "detached_resume" | "foreground_history" | "missing";
  summary: string;
};

export type BackgroundSessionResumeDetail = {
  sessionKey: string;
  sessionId?: string;
  agentId?: string;
  transcriptPath: string | null;
  transcriptExists: boolean;
  transcriptHandoff: BackgroundSessionTranscriptHandoff;
  completionRouting: BackgroundSessionCompletionRouting;
  continueWith: string;
  reattachWith: string;
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

function resolveBackgroundSessionTranscriptState(params: {
  sessionKey: string;
  entry?: SessionEntry;
  target?: SessionStoreTarget;
}): { transcriptPath: string | null; transcriptExists: boolean } {
  const sessionId = params.entry?.sessionId?.trim();
  if (!sessionId) {
    return {
      transcriptPath: null,
      transcriptExists: false,
    };
  }
  const agentId =
    parseAgentSessionKey(params.sessionKey)?.agentId ?? params.target?.agentId ?? undefined;
  const transcriptPath = resolveSessionFilePath(sessionId, params.entry, {
    agentId,
    ...resolveSessionFilePathOptions({
      agentId,
      storePath: params.target?.storePath,
    }),
  });
  return {
    transcriptPath,
    transcriptExists: fs.existsSync(transcriptPath),
  };
}

function buildResumeWithCommand(params: {
  sessionKey: string;
  entry?: SessionEntry;
}): string {
  const sessionId = params.entry?.sessionId?.trim();
  if (sessionId) {
    return formatCliCommand(
      `openclaw agent --session-id ${quoteCliArg(sessionId)} --message ${quoteCliArg(DEFAULT_BACKGROUND_RESUME_MESSAGE)}`,
    );
  }
  return formatCliCommand(
    `openclaw agent --session-key ${quoteCliArg(params.sessionKey)} --message ${quoteCliArg(DEFAULT_BACKGROUND_RESUME_MESSAGE)}`,
  );
}

function buildContinueWithCommand(sessionKey: string): string {
  return formatCliCommand(
    `openclaw sessions continue ${quoteCliArg(sessionKey)} --message ${quoteCliArg(DEFAULT_BACKGROUND_RESUME_MESSAGE)}`,
  );
}

function buildReattachWithCommand(sessionKey: string): string {
  return formatCliCommand(
    `openclaw sessions reattach ${quoteCliArg(sessionKey)} --message ${quoteCliArg(DEFAULT_BACKGROUND_RESUME_MESSAGE)}`,
  );
}

export function buildBackgroundSessionCompletionRouting(params?: {
  reattachedAt?: number | null;
}): BackgroundSessionCompletionRouting {
  const reattachedAt = params?.reattachedAt ?? undefined;
  if (typeof reattachedAt === "number") {
    return {
      mode: "foreground_reattached",
      summary:
        "Detached completion stays with the foreground reattached session instead of detached delivery.",
      reattachedAt,
    };
  }
  return {
    mode: "detached_delivery",
    summary: "Detached completion will still be delivered or queued back to the owner session.",
  };
}

export function buildBackgroundSessionTranscriptHandoff(params: {
  transcriptExists: boolean;
  completionRouting?: BackgroundSessionCompletionRouting;
}): BackgroundSessionTranscriptHandoff {
  const completionRouting = params.completionRouting ?? buildBackgroundSessionCompletionRouting();
  if (!params.transcriptExists) {
    return {
      mode: "missing",
      summary:
        completionRouting.mode === "foreground_reattached"
          ? "Detached transcript snapshot is missing; live continuation now belongs to the foreground reattached session."
          : "Detached transcript snapshot is missing; direct transcript recovery is unavailable.",
    };
  }
  if (completionRouting.mode === "foreground_reattached") {
    return {
      mode: "foreground_history",
      summary:
        "Transcript remains available as detached history, but live continuation now belongs to the foreground reattached session.",
    };
  }
  return {
    mode: "detached_resume",
    summary:
      "Transcript remains the live detached handoff and can still be used for direct resume or recovery.",
  };
}

export function describeBackgroundSessionResume(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  entry?: SessionEntry;
  target?: SessionStoreTarget;
  completionRouting?: BackgroundSessionCompletionRouting;
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
  const transcriptState = resolveBackgroundSessionTranscriptState({
    sessionKey,
    entry: resolved.entry,
    target: resolved.target,
  });
  const completionRouting = params.completionRouting ?? buildBackgroundSessionCompletionRouting();
  return {
    sessionKey,
    ...(resolved.entry?.sessionId?.trim() ? { sessionId: resolved.entry.sessionId.trim() } : {}),
    ...((parseAgentSessionKey(sessionKey)?.agentId ?? resolved.target?.agentId)
      ? { agentId: parseAgentSessionKey(sessionKey)?.agentId ?? resolved.target?.agentId }
      : {}),
    ...transcriptState,
    transcriptHandoff: buildBackgroundSessionTranscriptHandoff({
      transcriptExists: transcriptState.transcriptExists,
      completionRouting,
    }),
    completionRouting,
    continueWith: buildContinueWithCommand(sessionKey),
    reattachWith: buildReattachWithCommand(sessionKey),
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
  completionRouting?: BackgroundSessionCompletionRouting;
  indent?: string;
}): string[] {
  const detail = describeBackgroundSessionResume({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    entry: params.entry,
    target: params.target,
    completionRouting: params.completionRouting,
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
  lines.push(`${indent}resumeTranscript: ${detail.transcriptPath ?? "n/a"}`);
  lines.push(`${indent}resumeTranscriptExists: ${detail.transcriptExists ? "yes" : "no"}`);
  lines.push(`${indent}transcriptHandoff: ${detail.transcriptHandoff.mode}`);
  lines.push(`${indent}transcriptHandoffSummary: ${detail.transcriptHandoff.summary}`);
  lines.push(`${indent}completionRouting: ${detail.completionRouting.mode}`);
  lines.push(`${indent}completionRoutingSummary: ${detail.completionRouting.summary}`);
  if (detail.completionRouting.reattachedAt) {
    lines.push(
      `${indent}completionRoutingAt: ${new Date(detail.completionRouting.reattachedAt).toISOString()}`,
    );
  }
  lines.push(`${indent}continueWith: ${detail.continueWith}`);
  lines.push(`${indent}reattachWith: ${detail.reattachWith}`);
  lines.push(`${indent}resumeWith: ${detail.resumeWith}`);
  for (const line of detail.acpDetailLines) {
    lines.push(`${indent}${line}`);
  }
  return lines;
}

export function describeBackgroundChildSessions(params: {
  cfg: OpenClawConfig;
  sessionKeys: Iterable<string | undefined>;
  completionRoutingBySessionKey?:
    | ReadonlyMap<string, BackgroundSessionCompletionRouting>
    | Readonly<Record<string, BackgroundSessionCompletionRouting | undefined>>;
}): BackgroundSessionResumeDetail[] {
  const uniqueKeys = Array.from(
    new Set(
      Array.from(params.sessionKeys, (value) => value?.trim()).filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  return uniqueKeys.flatMap((sessionKey) => {
    const completionRouting =
      params.completionRoutingBySessionKey instanceof Map
        ? params.completionRoutingBySessionKey.get(sessionKey)
        : params.completionRoutingBySessionKey?.[sessionKey];
    const detail = describeBackgroundSessionResume({
      cfg: params.cfg,
      sessionKey,
      completionRouting,
    });
    return detail ? [detail] : [];
  });
}

export function formatBackgroundChildSessionGroupLines(params: {
  cfg: OpenClawConfig;
  sessionKeys: Iterable<string | undefined>;
  completionRoutingBySessionKey?:
    | ReadonlyMap<string, BackgroundSessionCompletionRouting>
    | Readonly<Record<string, BackgroundSessionCompletionRouting | undefined>>;
}): string[] {
  const childSessions = describeBackgroundChildSessions(params);
  if (childSessions.length === 0) {
    return [];
  }
  const lines = ["Child sessions:"];
  for (const childSession of childSessions) {
    lines.push(`- ${childSession.sessionKey}`);
    const detailLines = formatBackgroundSessionResumeLines({
      cfg: params.cfg,
      sessionKey: childSession.sessionKey,
      completionRouting: childSession.completionRouting,
      indent: "  ",
    }).filter((line) => !line.startsWith("  resumeSessionKey: "));
    lines.push(...detailLines);
  }
  return lines;
}
