import fs from "node:fs";
import { lookupContextTokens } from "../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../agents/defaults.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveFreshSessionTotalTokens,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  type SessionEntry,
  type SessionStoreTarget,
} from "../config/sessions.js";
import { classifySessionKey } from "../gateway/session-utils.js";
import { info } from "../globals.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { resolveSessionIdMatchSelection } from "../sessions/session-id-resolution.js";
import { listTaskFlowsForOwnerKey } from "../tasks/task-flow-runtime-internal.js";
import { listTasksForRelatedSessionKey } from "../tasks/task-registry.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import {
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

const AGENT_PAD = 10;
const KIND_PAD = 6;
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

function buildSessionShowPayload(params: {
  lookup: string;
  resolvedBy: "session_key" | "session_id";
  match: SessionLookupMatch;
  row: SessionRow;
  model: string;
  configContextTokens: number;
  transcriptPath: string;
  transcriptExists: boolean;
  relatedTasks: ReturnType<typeof listTasksForRelatedSessionKey>;
  relatedTaskFlows: ReturnType<typeof listTaskFlowsForOwnerKey>;
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
      revision: flow.revision,
    })),
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

  const rows = targets
    .flatMap((target) => {
      const store = loadSessionStore(target.storePath);
      return toSessionDisplayRows(store).map((row) => ({
        ...row,
        agentId: parseAgentSessionKey(row.key)?.agentId ?? target.agentId,
        kind: classifySessionKey(row.key, store[row.key]),
      }));
    })
    .filter((row) => {
      if (activeMinutes === undefined) {
        return true;
      }
      if (!row.updatedAt) {
        return false;
      }
      return Date.now() - row.updatedAt <= activeMinutes * 60_000;
    })
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

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
        return {
          ...r,
          totalTokens: resolveFreshSessionTotalTokens(r) ?? null,
          totalTokensFresh:
            typeof r.totalTokens === "number" ? r.totalTokensFresh !== false : false,
          contextTokens:
            r.contextTokens ?? lookupContextTokens(model) ?? configContextTokens ?? null,
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

  const resolved = resolveSessionLookup({
    lookup,
    targets,
  });
  if (resolved.kind === "missing") {
    runtime.error(`Session not found: ${lookup}`);
    runtime.exit(1);
    return;
  }
  if (resolved.kind === "ambiguous") {
    runtime.error(
      `Session lookup is ambiguous by ${resolved.resolvedBy === "session_key" ? "session key" : "session id"}: ${lookup}`,
    );
    for (const line of formatSessionLookupCandidates(resolved.matches)) {
      runtime.error(line);
    }
    runtime.exit(1);
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
  const transcriptPath = resolveSessionFilePath(match.entry.sessionId, match.entry, {
    agentId: match.target.agentId,
    ...resolveSessionFilePathOptions({ agentId: match.target.agentId, storePath: match.target.storePath }),
  });
  const transcriptExists = fs.existsSync(transcriptPath);
  const relatedTasks = listTasksForRelatedSessionKey(match.sessionKey);
  const relatedTaskFlows = listTaskFlowsForOwnerKey(match.sessionKey);
  const resumeLines = formatBackgroundSessionResumeLines({
    cfg,
    sessionKey: match.sessionKey,
    entry: match.entry,
    target: match.target,
  });
  const payload = buildSessionShowPayload({
    lookup,
    resolvedBy: resolved.resolvedBy,
    match,
    row,
    model,
    configContextTokens,
    transcriptPath,
    transcriptExists,
    relatedTasks,
    relatedTaskFlows,
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
  runtime.log(`transcript: ${transcriptPath}`);
  runtime.log(`transcriptExists: ${transcriptExists ? "yes" : "no"}`);
  runtime.log(`relatedTasks: ${relatedTasks.length}`);
  runtime.log(`relatedTaskFlows: ${relatedTaskFlows.length}`);
  if (relatedTasks.length > 0) {
    runtime.log("Related tasks:");
    for (const task of relatedTasks.slice(0, 8)) {
      runtime.log(
        `- ${task.taskId} ${task.status} ${task.runtime} ${task.runId ?? "n/a"} ${task.label ?? task.task}`,
      );
    }
  }
  if (relatedTaskFlows.length > 0) {
    runtime.log("Related TaskFlows:");
    for (const flow of relatedTaskFlows.slice(0, 8)) {
      runtime.log(
        `- ${flow.flowId} ${flow.status} ${flow.syncMode} ${flow.controllerId ?? "n/a"} ${flow.goal}`,
      );
    }
  }
  const resumeDetail = describeBackgroundSessionResume({
    cfg,
    sessionKey: match.sessionKey,
    entry: match.entry,
    target: match.target,
  });
  if (resumeDetail) {
    runtime.log("Resume:");
    for (const line of resumeLines) {
      runtime.log(line);
    }
  }
}
