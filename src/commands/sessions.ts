import fs from "node:fs";
import { lookupContextTokens } from "../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../agents/defaults.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveFreshSessionTotalTokens,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionStoreTargets,
  type SessionEntry,
  type SessionStoreTarget,
} from "../config/sessions.js";
import { classifySessionKey } from "../gateway/session-utils.js";
import { info } from "../globals.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { resolveSessionIdMatchSelection } from "../sessions/session-id-resolution.js";
import {
  listTaskFlowsForOwnerKey,
  markTaskFlowsReattachedForOwnerKey,
} from "../tasks/task-flow-runtime-internal.js";
import {
  listTasksForRelatedSessionKey,
  markTasksReattachedForRelatedSessionKey,
} from "../tasks/runtime-internal.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import { agentCliCommand } from "./agent-via-gateway.js";
import {
  DEFAULT_BACKGROUND_RESUME_MESSAGE,
  buildBackgroundSessionCompletionRouting,
  buildBackgroundSessionTranscriptHandoff,
  type BackgroundSessionResumeDetail,
  describeBackgroundSessionResume,
  formatBackgroundSessionResumeLines,
} from "./background-session-resume.js";
import { resolveSessionStoreTargetsOrExit } from "./session-store-targets.js";
import {
  formatSessionAgeCell,
  formatSessionFlagsCell,
  formatSessionKeyCell,
  formatSessionModelCell,
  resolveSessionDisplayDefaults,
  resolveSessionDisplayModel,
  SESSION_AGE_PAD,
  SESSION_KEY_PAD,
  SESSION_MODEL_PAD,
  type SessionDisplayRow,
  toSessionDisplayRows,
} from "./sessions-table.js";

type SessionRow = SessionDisplayRow & {
  agentId: string;
  kind: "direct" | "group" | "global" | "unknown";
};

type SessionListRow = SessionRow & {
  entry: SessionEntry;
  target: SessionStoreTarget;
  transcriptPath: string | null;
  transcriptExists: boolean;
  transcriptHandoff: ReturnType<typeof buildBackgroundSessionTranscriptHandoff>;
  lifecycle: SessionLifecycleAssessment;
  resume?: BackgroundSessionResumeDetail;
};

const AGENT_PAD = 10;
const KIND_PAD = 6;
const LIFECYCLE_PAD = 18;
const TOKENS_PAD = 20;

type SessionLookupMatch = {
  sessionKey: string;
  entry: SessionEntry;
  target: SessionStoreTarget;
};

type ResolvedSessionLookup =
  | {
      kind: "found";
      resolvedBy: "session_key" | "session_id";
      match: SessionLookupMatch;
    }
  | {
      kind: "ambiguous";
      resolvedBy: "session_key" | "session_id";
      matches: SessionLookupMatch[];
    }
  | {
      kind: "missing";
    };

type FoundSessionLookup = Extract<ResolvedSessionLookup, { kind: "found" }>;
export type SessionLifecycleStatus =
  | "missing_transcript"
  | "blocked_detached"
  | "waiting_detached"
  | "running_detached"
  | "aborted_last_run"
  | "resumable";

export type SessionLifecycleAssessment = {
  status: SessionLifecycleStatus;
  summary: string;
  resumeAvailable: boolean;
  activeTaskCount: number;
  activeFlowCount: number;
  waitingFlowCount: number;
  blockedFlowCount: number;
};

export type DetachedSessionLifecycleSnapshot = {
  sessionKey: string;
  entry?: SessionEntry;
  target?: SessionStoreTarget;
  transcriptPath: string | null;
  transcriptExists: boolean;
  relatedTasks: ReturnType<typeof listTasksForRelatedSessionKey>;
  relatedTaskFlows: ReturnType<typeof listTaskFlowsForOwnerKey>;
  completionRouting: ReturnType<typeof buildBackgroundSessionCompletionRouting>;
  resumeDetail?: BackgroundSessionResumeDetail;
  lifecycle: SessionLifecycleAssessment;
};

const formatKTokens = (value: number) => `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

const colorByPct = (label: string, pct: number | null, rich: boolean) => {
  if (!rich || pct === null) {
    return label;
  }
  if (pct >= 95) {
    return theme.error(label);
  }
  if (pct >= 80) {
    return theme.warn(label);
  }
  if (pct >= 60) {
    return theme.success(label);
  }
  return theme.muted(label);
};

const formatTokensCell = (
  total: number | undefined,
  contextTokens: number | null,
  rich: boolean,
) => {
  if (total === undefined) {
    const ctxLabel = contextTokens ? formatKTokens(contextTokens) : "?";
    const label = `unknown/${ctxLabel} (?%)`;
    return rich ? theme.muted(label.padEnd(TOKENS_PAD)) : label.padEnd(TOKENS_PAD);
  }
  const totalLabel = formatKTokens(total);
  const ctxLabel = contextTokens ? formatKTokens(contextTokens) : "?";
  const pct = contextTokens ? Math.min(999, Math.round((total / contextTokens) * 100)) : null;
  const label = `${totalLabel}/${ctxLabel} (${pct ?? "?"}%)`;
  const padded = label.padEnd(TOKENS_PAD);
  return colorByPct(padded, pct, rich);
};

const formatKindCell = (kind: SessionRow["kind"], rich: boolean) => {
  const label = kind.padEnd(KIND_PAD);
  if (!rich) {
    return label;
  }
  if (kind === "group") {
    return theme.accentBright(label);
  }
  if (kind === "global") {
    return theme.warn(label);
  }
  if (kind === "direct") {
    return theme.accent(label);
  }
  return theme.muted(label);
};

const LIFECYCLE_LABELS: Record<SessionLifecycleStatus, string> = {
  missing_transcript: "missing-xcript",
  blocked_detached: "blocked",
  waiting_detached: "waiting",
  running_detached: "running",
  aborted_last_run: "aborted",
  resumable: "resumable",
};

export function formatSessionLifecycleStatusLabel(status: SessionLifecycleStatus): string {
  return LIFECYCLE_LABELS[status] ?? status;
}

function formatLifecycleCell(lifecycle: SessionLifecycleAssessment, rich: boolean) {
  const label = formatSessionLifecycleStatusLabel(lifecycle.status).padEnd(LIFECYCLE_PAD);
  if (!rich) {
    return label;
  }
  if (lifecycle.status === "blocked_detached" || lifecycle.status === "missing_transcript") {
    return theme.warn(label);
  }
  if (lifecycle.status === "running_detached") {
    return theme.accentBright(label);
  }
  if (lifecycle.status === "aborted_last_run") {
    return theme.error(label);
  }
  if (lifecycle.status === "waiting_detached" || lifecycle.status === "resumable") {
    return theme.success(label);
  }
  return theme.muted(label);
}

export function resolveSessionTranscriptState(params: {
  entry: SessionEntry;
  target: SessionStoreTarget;
}): { transcriptPath: string | null; transcriptExists: boolean } {
  const sessionId = params.entry.sessionId?.trim();
  if (!sessionId) {
    return {
      transcriptPath: null,
      transcriptExists: false,
    };
  }
  const transcriptPath = resolveSessionFilePath(sessionId, params.entry, {
    agentId: params.target.agentId,
    ...resolveSessionFilePathOptions({
      agentId: params.target.agentId,
      storePath: params.target.storePath,
    }),
  });
  return {
    transcriptPath,
    transcriptExists: fs.existsSync(transcriptPath),
  };
}

function buildSessionListRows(params: {
  cfg: ReturnType<typeof loadConfig>;
  targets: SessionStoreTarget[];
  activeMinutes?: number;
}): SessionListRow[] {
  return params.targets
    .flatMap((target) => {
      const store = loadSessionStore(target.storePath);
      return toSessionDisplayRows(store).map((row) => {
        const entry = store[row.key];
        const resolvedRow = {
          ...row,
          entry,
          target,
          agentId: parseAgentSessionKey(row.key)?.agentId ?? target.agentId,
          kind: classifySessionKey(row.key, entry),
        } satisfies SessionRow & { entry: SessionEntry; target: SessionStoreTarget };
        const snapshot = inspectDetachedSessionLifecycle({
          cfg: params.cfg,
          sessionKey: row.key,
          entry,
          target,
          abortedLastRun: resolvedRow.abortedLastRun === true,
        });
        return {
          ...resolvedRow,
          transcriptPath: snapshot?.transcriptPath ?? null,
          transcriptExists: snapshot?.transcriptExists ?? false,
          transcriptHandoff: buildBackgroundSessionTranscriptHandoff({
            transcriptExists: snapshot?.transcriptExists ?? false,
            completionRouting: snapshot?.completionRouting,
          }),
          resume: snapshot?.resumeDetail,
          lifecycle:
            snapshot?.lifecycle ??
            buildSessionLifecycleAssessment({
              abortedLastRun: resolvedRow.abortedLastRun === true,
              transcriptExists: false,
              relatedTasks: [],
              relatedTaskFlows: [],
            }),
        } satisfies SessionListRow;
      });
    })
    .filter((row) => {
      if (params.activeMinutes === undefined) {
        return true;
      }
      if (!row.updatedAt) {
        return false;
      }
      return Date.now() - row.updatedAt <= params.activeMinutes * 60_000;
    })
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function collectSessionLookupMatches(targets: SessionStoreTarget[]): SessionLookupMatch[] {
  return targets.flatMap((target) => {
    const store = loadSessionStore(target.storePath);
    return Object.entries(store).map(([sessionKey, entry]) => ({
      sessionKey,
      entry,
      target,
    }));
  });
}

function resolveSessionLookup(params: {
  lookup: string;
  targets: SessionStoreTarget[];
}): ResolvedSessionLookup {
  const lookup = params.lookup.trim();
  if (!lookup) {
    return { kind: "missing" };
  }
  const matches = collectSessionLookupMatches(params.targets);
  const directMatches = matches.filter((match) => match.sessionKey.trim() === lookup);
  if (directMatches.length === 1) {
    return {
      kind: "found",
      resolvedBy: "session_key",
      match: directMatches[0],
    };
  }
  if (directMatches.length > 1) {
    return {
      kind: "ambiguous",
      resolvedBy: "session_key",
      matches: directMatches.toSorted((left, right) => (right.entry.updatedAt ?? 0) - (left.entry.updatedAt ?? 0)),
    };
  }

  const normalizedLookup = normalizeLookupValue(lookup);
  const sessionIdMatches = matches.filter(
    (match) => normalizeLookupValue(match.entry.sessionId) === normalizedLookup,
  );
  if (sessionIdMatches.length === 0) {
    return { kind: "missing" };
  }

  const selection = resolveSessionIdMatchSelection(
    sessionIdMatches.map((match) => [match.sessionKey, match.entry]),
    lookup,
  );
  if (selection.kind === "selected") {
    const selected =
      sessionIdMatches.find((match) => match.sessionKey === selection.sessionKey) ?? sessionIdMatches[0];
    return {
      kind: "found",
      resolvedBy: "session_id",
      match: selected,
    };
  }
  if (selection.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      resolvedBy: "session_id",
      matches: sessionIdMatches.filter((match) => selection.sessionKeys.includes(match.sessionKey)),
    };
  }
  return { kind: "missing" };
}

function formatSessionLookupCandidates(matches: SessionLookupMatch[]): string[] {
  return matches.map(
    (match) =>
      `- ${match.sessionKey} | agent=${match.target.agentId} | store=${match.target.storePath} | updated=${match.entry.updatedAt ? new Date(match.entry.updatedAt).toISOString() : "unknown"}`,
  );
}

export function buildSessionLifecycleAssessment(params: {
  abortedLastRun?: boolean;
  transcriptExists: boolean;
  relatedTasks: ReturnType<typeof listTasksForRelatedSessionKey>;
  relatedTaskFlows: ReturnType<typeof listTaskFlowsForOwnerKey>;
  resumeDetail?: BackgroundSessionResumeDetail;
}): SessionLifecycleAssessment {
  const activeTaskCount = params.relatedTasks.filter(
    (task) => task.status === "queued" || task.status === "running",
  ).length;
  const activeFlowCount = params.relatedTaskFlows.filter(
    (flow) => flow.status === "queued" || flow.status === "running",
  ).length;
  const waitingFlowCount = params.relatedTaskFlows.filter((flow) => flow.status === "waiting").length;
  const blockedFlowCount = params.relatedTaskFlows.filter((flow) => flow.status === "blocked").length;
  const resumeAvailable = Boolean(params.resumeDetail);

  if (!params.transcriptExists) {
    return {
      status: "missing_transcript",
      summary: "Transcript file is missing; continue must rely on stored session identity.",
      resumeAvailable,
      activeTaskCount,
      activeFlowCount,
      waitingFlowCount,
      blockedFlowCount,
    };
  }
  if (blockedFlowCount > 0) {
    return {
      status: "blocked_detached",
      summary: "Detached TaskFlow is blocked and waiting for operator follow-up.",
      resumeAvailable,
      activeTaskCount,
      activeFlowCount,
      waitingFlowCount,
      blockedFlowCount,
    };
  }
  if (waitingFlowCount > 0) {
    return {
      status: "waiting_detached",
      summary: "Detached TaskFlow is waiting for the next continuation turn.",
      resumeAvailable,
      activeTaskCount,
      activeFlowCount,
      waitingFlowCount,
      blockedFlowCount,
    };
  }
  if (activeTaskCount > 0 || activeFlowCount > 0) {
    return {
      status: "running_detached",
      summary: "Detached work is still active.",
      resumeAvailable,
      activeTaskCount,
      activeFlowCount,
      waitingFlowCount,
      blockedFlowCount,
    };
  }
  if (params.abortedLastRun === true) {
    return {
      status: "aborted_last_run",
      summary: "The last recorded run aborted, but the session still has resumable identity.",
      resumeAvailable,
      activeTaskCount,
      activeFlowCount,
      waitingFlowCount,
      blockedFlowCount,
    };
  }
  return {
    status: "resumable",
    summary: "Session transcript and resume metadata are available for another turn.",
    resumeAvailable,
    activeTaskCount,
    activeFlowCount,
    waitingFlowCount,
    blockedFlowCount,
  };
}

function resolveDetachedSessionStoreEntry(params: {
  cfg: ReturnType<typeof loadConfig>;
  sessionKey: string;
  entry?: SessionEntry;
  target?: SessionStoreTarget;
}): {
  entry?: SessionEntry;
  target?: SessionStoreTarget;
} {
  if (params.entry && params.target) {
    return {
      entry: params.entry,
      target: params.target,
    };
  }
  const targets = resolveSessionStoreTargets(params.cfg, { allAgents: true });
  for (const target of targets) {
    const entry = loadSessionStore(target.storePath)[params.sessionKey];
    if (entry) {
      return {
        entry,
        target,
      };
    }
  }
  return {
    entry: params.entry,
    target: params.target,
  };
}

function resolveDetachedSessionCompletionRouting(params: {
  relatedTasks: ReturnType<typeof listTasksForRelatedSessionKey>;
  relatedTaskFlows: ReturnType<typeof listTaskFlowsForOwnerKey>;
}) {
  const reattachedAt = Math.max(
    0,
    ...params.relatedTasks.map((task) => task.reattachedAt ?? 0),
    ...params.relatedTaskFlows.map((flow) => flow.reattachedAt ?? 0),
  );
  return buildBackgroundSessionCompletionRouting({
    reattachedAt: reattachedAt > 0 ? reattachedAt : undefined,
  });
}

export function inspectDetachedSessionLifecycle(params: {
  cfg: ReturnType<typeof loadConfig>;
  sessionKey?: string;
  entry?: SessionEntry;
  target?: SessionStoreTarget;
  abortedLastRun?: boolean;
}): DetachedSessionLifecycleSnapshot | undefined {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return undefined;
  }
  const resolved = resolveDetachedSessionStoreEntry({
    cfg: params.cfg,
    sessionKey,
    entry: params.entry,
    target: params.target,
  });
  const transcript =
    resolved.entry && resolved.target
      ? resolveSessionTranscriptState({
          entry: resolved.entry,
          target: resolved.target,
        })
      : {
          transcriptPath: null,
          transcriptExists: false,
        };
  const relatedTasks = listTasksForRelatedSessionKey(sessionKey);
  const relatedTaskFlows = listTaskFlowsForOwnerKey(sessionKey);
  const completionRouting = resolveDetachedSessionCompletionRouting({
    relatedTasks,
    relatedTaskFlows,
  });
  const resumeDetail = describeBackgroundSessionResume({
    cfg: params.cfg,
    sessionKey,
    entry: resolved.entry,
    target: resolved.target,
    completionRouting,
  });
  return {
    sessionKey,
    entry: resolved.entry,
    target: resolved.target,
    transcriptPath: transcript.transcriptPath,
    transcriptExists: transcript.transcriptExists,
    relatedTasks,
    relatedTaskFlows,
    completionRouting,
    resumeDetail,
    lifecycle: buildSessionLifecycleAssessment({
      abortedLastRun: params.abortedLastRun ?? (resolved.entry?.abortedLastRun === true),
      transcriptExists: transcript.transcriptExists,
      relatedTasks,
      relatedTaskFlows,
      resumeDetail,
    }),
  };
}

function resolveSessionLookupOrExit(params: {
  lookup: string;
  targets: SessionStoreTarget[];
  runtime: RuntimeEnv;
}): FoundSessionLookup | undefined {
  const resolved = resolveSessionLookup({
    lookup: params.lookup,
    targets: params.targets,
  });
  if (resolved.kind === "missing") {
    params.runtime.error(`Session not found: ${params.lookup}`);
    params.runtime.exit(1);
    return undefined;
  }
  if (resolved.kind === "ambiguous") {
    params.runtime.error(
      `Session lookup is ambiguous by ${resolved.resolvedBy === "session_key" ? "session key" : "session id"}: ${params.lookup}`,
    );
    for (const line of formatSessionLookupCandidates(resolved.matches)) {
      params.runtime.error(line);
    }
    params.runtime.exit(1);
    return undefined;
  }
  return resolved;
}

function buildSessionShowPayload(params: {
  lookup: string;
  resolvedBy: "session_key" | "session_id";
  match: SessionLookupMatch;
  row: SessionRow;
  model: string;
  configContextTokens: number;
  transcriptPath: string;
  transcriptExists: boolean;
  transcriptHandoff: ReturnType<typeof buildBackgroundSessionTranscriptHandoff>;
  relatedTasks: ReturnType<typeof listTasksForRelatedSessionKey>;
  relatedTaskFlows: ReturnType<typeof listTaskFlowsForOwnerKey>;
  lifecycle: SessionLifecycleAssessment;
  completionRouting: ReturnType<typeof buildBackgroundSessionCompletionRouting>;
  resumeDetail?: BackgroundSessionResumeDetail;
  resumeLines: string[];
}) {
  const { match, row, model } = params;
  const agentId = parseAgentSessionKey(match.sessionKey)?.agentId ?? match.target.agentId;
  return {
    lookup: params.lookup,
    resolvedBy: params.resolvedBy,
    agentId,
    storePath: match.target.storePath,
    session: {
      key: match.sessionKey,
      sessionId: match.entry.sessionId,
      kind: row.kind,
      updatedAt: match.entry.updatedAt,
      ageMs: row.ageMs,
      age: row.ageMs != null ? formatTimeAgo(row.ageMs) : null,
      model,
      modelProvider: match.entry.modelProvider ?? null,
      totalTokens: resolveFreshSessionTotalTokens(row) ?? null,
      totalTokensFresh:
        typeof row.totalTokens === "number" ? row.totalTokensFresh !== false : false,
      contextTokens:
        row.contextTokens ?? lookupContextTokens(model) ?? params.configContextTokens ?? null,
      transcriptPath: params.transcriptPath,
      transcriptExists: params.transcriptExists,
      transcriptHandoff: params.transcriptHandoff,
      flags: {
        thinkingLevel: row.thinkingLevel ?? null,
        verboseLevel: row.verboseLevel ?? null,
        reasoningLevel: row.reasoningLevel ?? null,
        elevatedLevel: row.elevatedLevel ?? null,
        responseUsage: row.responseUsage ?? null,
        groupActivation: row.groupActivation ?? null,
        systemSent: row.systemSent === true,
        abortedLastRun: row.abortedLastRun === true,
      },
    },
    relatedTaskCount: params.relatedTasks.length,
    relatedTaskFlowCount: params.relatedTaskFlows.length,
    lifecycle: params.lifecycle,
    completionRouting: params.completionRouting,
    relatedTasks: params.relatedTasks.map((task) => ({
      taskId: task.taskId,
      runtime: task.runtime,
      status: task.status,
      runId: task.runId ?? null,
      label: task.label ?? null,
      task: task.task,
      originKind: task.originKind ?? null,
      originSessionKey: task.originSessionKey ?? null,
      childSessionKey: task.childSessionKey ?? null,
      parentFlowId: task.parentFlowId ?? null,
      updatedAt: task.lastEventAt ?? task.createdAt,
      reattachedAt: task.reattachedAt ?? null,
    })),
    relatedTaskFlows: params.relatedTaskFlows.map((flow) => ({
      flowId: flow.flowId,
      syncMode: flow.syncMode,
      status: flow.status,
      goal: flow.goal,
      controllerId: flow.controllerId ?? null,
      currentStep: flow.currentStep ?? null,
      blockedTaskId: flow.blockedTaskId ?? null,
      blockedSummary: flow.blockedSummary ?? null,
      cancelRequestedAt: flow.cancelRequestedAt ?? null,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
      endedAt: flow.endedAt ?? null,
      reattachedAt: flow.reattachedAt ?? null,
      revision: flow.revision,
    })),
    resume: params.resumeDetail ?? null,
    resumeLines: params.resumeLines,
  };
}

export async function sessionsCommand(
  opts: { json?: boolean; store?: string; active?: string; agent?: string; allAgents?: boolean },
  runtime: RuntimeEnv,
) {
  const aggregateAgents = opts.allAgents === true;
  const cfg = loadConfig();
  const displayDefaults = resolveSessionDisplayDefaults(cfg);
  const configContextTokens =
    cfg.agents?.defaults?.contextTokens ??
    lookupContextTokens(displayDefaults.model) ??
    DEFAULT_CONTEXT_TOKENS;
  const targets = resolveSessionStoreTargetsOrExit({
    cfg,
    opts: {
      store: opts.store,
      agent: opts.agent,
      allAgents: opts.allAgents,
    },
    runtime,
  });
  if (!targets) {
    return;
  }

  let activeMinutes: number | undefined;
  if (opts.active !== undefined) {
    const parsed = Number.parseInt(String(opts.active), 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      runtime.error("--active must be a positive integer (minutes)");
      runtime.exit(1);
      return;
    }
    activeMinutes = parsed;
  }

  const rows = buildSessionListRows({
    cfg,
    targets,
    activeMinutes,
  });

  if (opts.json) {
    const multi = targets.length > 1;
    const aggregate = aggregateAgents || multi;
    writeRuntimeJson(runtime, {
      path: aggregate ? null : (targets[0]?.storePath ?? null),
      stores: aggregate
        ? targets.map((target) => ({
            agentId: target.agentId,
            path: target.storePath,
          }))
        : undefined,
      allAgents: aggregateAgents ? true : undefined,
      count: rows.length,
      activeMinutes: activeMinutes ?? null,
      sessions: rows.map((r) => {
        const model = resolveSessionDisplayModel(cfg, r, displayDefaults);
        const { entry: _entry, target: _target, ...row } = r;
        return {
          ...row,
          totalTokens: resolveFreshSessionTotalTokens(row) ?? null,
          totalTokensFresh:
            typeof row.totalTokens === "number" ? row.totalTokensFresh !== false : false,
          contextTokens:
            row.contextTokens ?? lookupContextTokens(model) ?? configContextTokens ?? null,
          model,
        };
      }),
    });
    return;
  }

  if (targets.length === 1 && !aggregateAgents) {
    runtime.log(info(`Session store: ${targets[0]?.storePath}`));
  } else {
    runtime.log(
      info(`Session stores: ${targets.length} (${targets.map((t) => t.agentId).join(", ")})`),
    );
  }
  runtime.log(info(`Sessions listed: ${rows.length}`));
  if (activeMinutes) {
    runtime.log(info(`Filtered to last ${activeMinutes} minute(s)`));
  }
  if (rows.length === 0) {
    runtime.log("No sessions found.");
    return;
  }

  const rich = isRich();
  const showAgentColumn = aggregateAgents || targets.length > 1;
  const header = [
    ...(showAgentColumn ? ["Agent".padEnd(AGENT_PAD)] : []),
    "Kind".padEnd(KIND_PAD),
    "Lifecycle".padEnd(LIFECYCLE_PAD),
    "Key".padEnd(SESSION_KEY_PAD),
    "Age".padEnd(SESSION_AGE_PAD),
    "Model".padEnd(SESSION_MODEL_PAD),
    "Tokens (ctx %)".padEnd(TOKENS_PAD),
    "Flags",
  ].join(" ");

  runtime.log(rich ? theme.heading(header) : header);

  for (const row of rows) {
    const model = resolveSessionDisplayModel(cfg, row, displayDefaults);
    const contextTokens = row.contextTokens ?? lookupContextTokens(model) ?? configContextTokens;
    const total = resolveFreshSessionTotalTokens(row);

    const line = [
      ...(showAgentColumn
        ? [rich ? theme.accentBright(row.agentId.padEnd(AGENT_PAD)) : row.agentId.padEnd(AGENT_PAD)]
        : []),
      formatKindCell(row.kind, rich),
      formatLifecycleCell(row.lifecycle, rich),
      formatSessionKeyCell(row.key, rich),
      formatSessionAgeCell(row.updatedAt, rich),
      formatSessionModelCell(model, rich),
      formatTokensCell(total, contextTokens ?? null, rich),
      formatSessionFlagsCell(row, rich),
    ].join(" ");

    runtime.log(line.trimEnd());
  }
}

export async function sessionsShowCommand(
  opts: {
    lookup: string;
    json?: boolean;
    store?: string;
    agent?: string;
    allAgents?: boolean;
  },
  runtime: RuntimeEnv,
) {
  const lookup = opts.lookup.trim();
  if (!lookup) {
    runtime.error("Session lookup must not be empty.");
    runtime.exit(1);
    return;
  }

  const cfg = loadConfig();
  const displayDefaults = resolveSessionDisplayDefaults(cfg);
  const configContextTokens =
    cfg.agents?.defaults?.contextTokens ??
    lookupContextTokens(displayDefaults.model) ??
    DEFAULT_CONTEXT_TOKENS;
  const targets = resolveSessionStoreTargetsOrExit({
    cfg,
    opts: {
      store: opts.store,
      agent: opts.agent,
      allAgents: opts.allAgents,
    },
    runtime,
  });
  if (!targets) {
    return;
  }

  const resolved = resolveSessionLookupOrExit({
    lookup,
    targets,
    runtime,
  });
  if (!resolved) {
    return;
  }

  const { match } = resolved;
  const store = loadSessionStore(match.target.storePath);
  const row = {
    ...toSessionDisplayRows({ [match.sessionKey]: store[match.sessionKey] })[0],
    agentId: parseAgentSessionKey(match.sessionKey)?.agentId ?? match.target.agentId,
    kind: classifySessionKey(match.sessionKey, match.entry),
  } satisfies SessionRow;
  const model = resolveSessionDisplayModel(cfg, row, displayDefaults);
  const transcript = resolveSessionTranscriptState({
    entry: match.entry,
    target: match.target,
  });
  const snapshot = inspectDetachedSessionLifecycle({
    cfg,
    sessionKey: match.sessionKey,
    entry: match.entry,
    target: match.target,
    abortedLastRun: row.abortedLastRun === true,
  });
  const relatedTasks = snapshot?.relatedTasks ?? [];
  const relatedTaskFlows = snapshot?.relatedTaskFlows ?? [];
  const resumeDetail = snapshot?.resumeDetail;
  const completionRouting =
    snapshot?.completionRouting ?? buildBackgroundSessionCompletionRouting();
  const transcriptHandoff = buildBackgroundSessionTranscriptHandoff({
    transcriptExists: transcript.transcriptExists,
    completionRouting,
  });
  const resumeLines = formatBackgroundSessionResumeLines({
    cfg,
    sessionKey: match.sessionKey,
    entry: match.entry,
    target: match.target,
    completionRouting,
  });
  const lifecycle =
    snapshot?.lifecycle ??
    buildSessionLifecycleAssessment({
      abortedLastRun: row.abortedLastRun === true,
      transcriptExists: transcript.transcriptExists,
      relatedTasks,
      relatedTaskFlows,
      resumeDetail,
    });
  const payload = buildSessionShowPayload({
    lookup,
    resolvedBy: resolved.resolvedBy,
    match,
    row,
    model,
    configContextTokens,
    transcriptPath: transcript.transcriptPath ?? "n/a",
    transcriptExists: transcript.transcriptExists,
    transcriptHandoff,
    relatedTasks,
    relatedTaskFlows,
    lifecycle,
    completionRouting,
    resumeDetail,
    resumeLines,
  });

  if (opts.json) {
    writeRuntimeJson(runtime, payload);
    return;
  }

  runtime.log("Session:");
  runtime.log(`lookup: ${lookup}`);
  runtime.log(`resolvedBy: ${resolved.resolvedBy}`);
  runtime.log(`key: ${match.sessionKey}`);
  runtime.log(`sessionId: ${match.entry.sessionId}`);
  runtime.log(`agent: ${parseAgentSessionKey(match.sessionKey)?.agentId ?? match.target.agentId}`);
  runtime.log(`store: ${match.target.storePath}`);
  runtime.log(`kind: ${row.kind}`);
  runtime.log(`updatedAt: ${new Date(match.entry.updatedAt).toISOString()}`);
  runtime.log(`age: ${row.ageMs != null ? formatTimeAgo(row.ageMs) : "unknown"}`);
  runtime.log(`model: ${model}`);
  runtime.log(
    `tokens: ${formatTokensCell(resolveFreshSessionTotalTokens(row), row.contextTokens ?? lookupContextTokens(model) ?? configContextTokens ?? null, false).trim()}`,
  );
  runtime.log(`transcript: ${transcript.transcriptPath ?? "n/a"}`);
  runtime.log(`transcriptExists: ${transcript.transcriptExists ? "yes" : "no"}`);
  runtime.log(`transcriptHandoff: ${transcriptHandoff.mode}`);
  runtime.log(`transcriptHandoffSummary: ${transcriptHandoff.summary}`);
  runtime.log(`lifecycle: ${lifecycle.status}`);
  runtime.log(`lifecycleSummary: ${lifecycle.summary}`);
  runtime.log(`completionRouting: ${completionRouting.mode}`);
  runtime.log(`completionRoutingSummary: ${completionRouting.summary}`);
  runtime.log(`relatedTasks: ${relatedTasks.length}`);
  runtime.log(`relatedTaskFlows: ${relatedTaskFlows.length}`);
  if (relatedTasks.length > 0) {
    runtime.log("Related tasks:");
    for (const task of relatedTasks.slice(0, 8)) {
      runtime.log(
        `- ${task.taskId} ${task.status} ${task.runtime} ${task.runId ?? "n/a"} ${task.label ?? task.task}${task.reattachedAt ? ` [reattached ${new Date(task.reattachedAt).toISOString()}]` : ""}`,
      );
    }
  }
  if (relatedTaskFlows.length > 0) {
    runtime.log("Related TaskFlows:");
    for (const flow of relatedTaskFlows.slice(0, 8)) {
      runtime.log(
        `- ${flow.flowId} ${flow.status} ${flow.syncMode} ${flow.controllerId ?? "n/a"} ${flow.goal}${flow.reattachedAt ? ` [reattached ${new Date(flow.reattachedAt).toISOString()}]` : ""}`,
      );
    }
  }
  if (resumeDetail) {
    runtime.log("Resume:");
    for (const line of resumeLines) {
      runtime.log(line);
    }
  }
}

export async function sessionsContinueCommand(
  opts: {
    lookup: string;
    message: string;
    store?: string;
    agent?: string;
    allAgents?: boolean;
    background?: boolean;
    thinking?: string;
    verbose?: string;
    timeout?: string;
    deliver?: boolean;
    local?: boolean;
    json?: boolean;
  },
  runtime: RuntimeEnv,
) {
  const lookup = opts.lookup.trim();
  if (!lookup) {
    runtime.error("Session lookup must not be empty.");
    runtime.exit(1);
    return;
  }
  const message = opts.message.trim();
  if (!message) {
    runtime.error("Message (--message) is required.");
    runtime.exit(1);
    return;
  }

  const cfg = loadConfig();
  const targets = resolveSessionStoreTargetsOrExit({
    cfg,
    opts: {
      store: opts.store,
      agent: opts.agent,
      allAgents: opts.allAgents,
    },
    runtime,
  });
  if (!targets) {
    return;
  }

  const resolved = resolveSessionLookupOrExit({
    lookup,
    targets,
    runtime,
  });
  if (!resolved) {
    return;
  }

  const sessionId = resolved.match.entry.sessionId?.trim();
  const continuedSessionAgentId =
    parseAgentSessionKey(resolved.match.sessionKey)?.agentId ?? resolved.match.target.agentId;
  const commandOpts = {
    message,
    ...(sessionId ? { sessionId } : { sessionKey: resolved.match.sessionKey }),
    background: opts.background,
    thinking: opts.thinking,
    verbose: opts.verbose,
    timeout: opts.timeout,
    deliver: opts.deliver,
    local: opts.local,
  };
  const snapshot = inspectDetachedSessionLifecycle({
    cfg,
    sessionKey: resolved.match.sessionKey,
    entry: resolved.match.entry,
    target: resolved.match.target,
    abortedLastRun: resolved.match.entry.abortedLastRun === true,
  });
  const reattachedAt = opts.background === true ? null : Date.now();
  const completionRoutingAfterContinue = buildBackgroundSessionCompletionRouting({
    reattachedAt,
  });

  if (opts.json) {
    const quietRuntime: RuntimeEnv = {
      ...runtime,
      log: () => {},
    };
    const agentResult = await agentCliCommand(
      {
        ...commandOpts,
        json: false,
      },
        quietRuntime,
    );
    if (reattachedAt != null) {
      markTasksReattachedForRelatedSessionKey({
        sessionKey: resolved.match.sessionKey,
        reattachedAt,
      });
      markTaskFlowsReattachedForOwnerKey({
        ownerKey: resolved.match.sessionKey,
        reattachedAt,
      });
    }
    writeRuntimeJson(runtime, {
      ...((agentResult && typeof agentResult === "object" && !Array.isArray(agentResult))
        ? agentResult
        : {}),
      lookup,
      resolvedBy: resolved.resolvedBy,
      continuedSession: {
        key: resolved.match.sessionKey,
        sessionId: sessionId ?? null,
        agentId: continuedSessionAgentId,
        storePath: resolved.match.target.storePath,
        transcriptPath: snapshot?.transcriptPath ?? null,
        transcriptExists: snapshot?.transcriptExists ?? false,
        lifecycleBeforeContinue: snapshot?.lifecycle ?? null,
        resumeBeforeContinue: snapshot?.resumeDetail ?? null,
        completionRoutingAfterContinue,
        reattachedAt,
      },
      continueRequest: {
        message,
        background: opts.background === true,
        thinking: opts.thinking ?? null,
        verbose: opts.verbose ?? null,
        timeout: opts.timeout ?? null,
        deliver: opts.deliver === true,
        local: opts.local === true,
      },
    });
    return;
  }

  runtime.log("Continuing session:");
  runtime.log(`lookup: ${lookup}`);
  runtime.log(`resolvedBy: ${resolved.resolvedBy}`);
  runtime.log(`key: ${resolved.match.sessionKey}`);
  runtime.log(`sessionId: ${sessionId ?? "n/a"}`);
  runtime.log(`agent: ${continuedSessionAgentId}`);
  runtime.log(`store: ${resolved.match.target.storePath}`);
  runtime.log(`transcriptExists: ${snapshot?.transcriptExists ? "yes" : "no"}`);
  if (snapshot?.lifecycle) {
    runtime.log(`lifecycleBeforeContinue: ${snapshot.lifecycle.status}`);
    runtime.log(`lifecycleSummary: ${snapshot.lifecycle.summary}`);
  }
  runtime.log(`completionRoutingAfterContinue: ${completionRoutingAfterContinue.mode}`);
  runtime.log(`completionRoutingSummary: ${completionRoutingAfterContinue.summary}`);
  if (snapshot?.resumeDetail) {
    runtime.log("Resume before continue:");
    for (const line of formatBackgroundSessionResumeLines({
      cfg,
      sessionKey: resolved.match.sessionKey,
      entry: resolved.match.entry,
      target: resolved.match.target,
      completionRouting: snapshot?.completionRouting,
    })) {
      runtime.log(line);
    }
  }

  await agentCliCommand(
    {
      ...commandOpts,
      json: false,
    },
    runtime,
  );
  if (reattachedAt != null) {
    markTasksReattachedForRelatedSessionKey({
      sessionKey: resolved.match.sessionKey,
      reattachedAt,
    });
    markTaskFlowsReattachedForOwnerKey({
      ownerKey: resolved.match.sessionKey,
      reattachedAt,
    });
  }
}

export async function sessionsReattachCommand(
  opts: {
    lookup: string;
    message?: string;
    store?: string;
    agent?: string;
    allAgents?: boolean;
    thinking?: string;
    verbose?: string;
    timeout?: string;
    deliver?: boolean;
    local?: boolean;
    json?: boolean;
  },
  runtime: RuntimeEnv,
) {
  return sessionsContinueCommand(
    {
      ...opts,
      message: opts.message?.trim() || DEFAULT_BACKGROUND_RESUME_MESSAGE,
      background: false,
    },
    runtime,
  );
}
