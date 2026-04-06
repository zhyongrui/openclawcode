import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@mariozechner/pi-coding-agent";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  abortEmbeddedPiRun,
  isEmbeddedPiRunActive,
  waitForEmbeddedPiRunEnd,
} from "../../agents/pi-embedded-runner/runs.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue/cleanup.js";
import {
  DEFAULT_BACKGROUND_RESUME_MESSAGE,
  buildBackgroundSessionCompletionRouting,
  buildBackgroundSessionTranscriptHandoff,
  formatBackgroundSessionResumeLines,
} from "../../commands/background-session-resume.js";
import {
  buildSessionLifecycleAssessment,
  inspectDetachedSessionLifecycle,
  resolveSessionTranscriptState,
} from "../../commands/sessions.js";
import { loadConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveMainSessionKey,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import {
  hasInternalHookListeners,
  triggerInternalHook,
  type SessionPatchHookContext,
  type SessionPatchHookEvent,
} from "../../hooks/internal-hooks.js";
import {
  normalizeAgentId,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
  toAgentStoreSessionKey,
} from "../../routing/session-key.js";
import { GATEWAY_CLIENT_IDS } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  validateSessionsAbortParams,
  validateSessionsCompactParams,
  validateSessionsCreateParams,
  validateSessionsDeleteParams,
  validateSessionsInspectParams,
  validateSessionsListParams,
  validateSessionsMessagesSubscribeParams,
  validateSessionsMessagesUnsubscribeParams,
  validateSessionsPatchParams,
  validateSessionsPreviewParams,
  validateSessionsReattachParams,
  validateSessionsResetParams,
  validateSessionsResolveParams,
  validateSessionsSendParams,
} from "../protocol/index.js";
import { reactivateCompletedSubagentSession } from "../session-subagent-reactivation.js";
import {
  archiveFileOnDisk,
  buildGatewaySessionRow,
  listSessionsFromStore,
  loadCombinedSessionStoreForGateway,
  loadGatewaySessionRow,
  loadSessionEntry,
  migrateAndPruneGatewaySessionStoreKey,
  readSessionPreviewItemsFromTranscript,
  resolveFreshestSessionEntryFromStoreKeys,
  resolveGatewaySessionStoreTarget,
  resolveSessionModelRef,
  resolveSessionTranscriptCandidates,
  type SessionsPatchResult,
  type SessionsPreviewEntry,
  type SessionsPreviewResult,
  readSessionMessages,
} from "../session-utils.js";
import { applySessionsPatchToStore } from "../sessions-patch.js";
import { resolveSessionKeyFromResolveParams } from "../sessions-resolve.js";
import { markTaskFlowsReattachedForOwnerKey } from "../../tasks/task-flow-runtime-internal.js";
import { markTasksReattachedForRelatedSessionKey } from "../../tasks/runtime-internal.js";
import { chatHandlers } from "./chat.js";
import type {
  GatewayClient,
  GatewayRequestContext,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
  RespondFn,
} from "./types.js";
import { assertValidParams } from "./validation.js";

function requireSessionKey(key: unknown, respond: RespondFn): string | null {
  const raw =
    typeof key === "string"
      ? key
      : typeof key === "number"
        ? String(key)
        : typeof key === "bigint"
          ? String(key)
          : "";
  const normalized = raw.trim();
  if (!normalized) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
    return null;
  }
  return normalized;
}

function resolveGatewaySessionTargetFromKey(key: string) {
  const cfg = loadConfig();
  const target = resolveGatewaySessionStoreTarget({ cfg, key });
  return { cfg, target, storePath: target.storePath };
}

function resolveOptionalInitialSessionMessage(params: {
  task?: unknown;
  message?: unknown;
}): string | undefined {
  if (typeof params.task === "string" && params.task.trim()) {
    return params.task;
  }
  if (typeof params.message === "string" && params.message.trim()) {
    return params.message;
  }
  return undefined;
}

function shouldAttachPendingMessageSeq(params: { payload: unknown; cached?: boolean }): boolean {
  if (params.cached) {
    return false;
  }
  const status =
    params.payload && typeof params.payload === "object"
      ? (params.payload as { status?: unknown }).status
      : undefined;
  return status === "started";
}

function emitSessionsChanged(
  context: Pick<GatewayRequestContext, "broadcastToConnIds" | "getSessionEventSubscriberConnIds">,
  payload: { sessionKey?: string; reason: string; compacted?: boolean },
) {
  const connIds = context.getSessionEventSubscriberConnIds();
  if (connIds.size === 0) {
    return;
  }
  const sessionRow = payload.sessionKey ? loadGatewaySessionRow(payload.sessionKey) : null;
  context.broadcastToConnIds(
    "sessions.changed",
    {
      ...payload,
      ts: Date.now(),
      ...(sessionRow
        ? {
            updatedAt: sessionRow.updatedAt ?? undefined,
            sessionId: sessionRow.sessionId,
            kind: sessionRow.kind,
            channel: sessionRow.channel,
            subject: sessionRow.subject,
            groupChannel: sessionRow.groupChannel,
            space: sessionRow.space,
            chatType: sessionRow.chatType,
            origin: sessionRow.origin,
            spawnedBy: sessionRow.spawnedBy,
            spawnedWorkspaceDir: sessionRow.spawnedWorkspaceDir,
            forkedFromParent: sessionRow.forkedFromParent,
            spawnDepth: sessionRow.spawnDepth,
            subagentRole: sessionRow.subagentRole,
            subagentControlScope: sessionRow.subagentControlScope,
            label: sessionRow.label,
            displayName: sessionRow.displayName,
            deliveryContext: sessionRow.deliveryContext,
            parentSessionKey: sessionRow.parentSessionKey,
            childSessions: sessionRow.childSessions,
            thinkingLevel: sessionRow.thinkingLevel,
            fastMode: sessionRow.fastMode,
            verboseLevel: sessionRow.verboseLevel,
            reasoningLevel: sessionRow.reasoningLevel,
            elevatedLevel: sessionRow.elevatedLevel,
            sendPolicy: sessionRow.sendPolicy,
            systemSent: sessionRow.systemSent,
            abortedLastRun: sessionRow.abortedLastRun,
            inputTokens: sessionRow.inputTokens,
            outputTokens: sessionRow.outputTokens,
            lastChannel: sessionRow.lastChannel,
            lastTo: sessionRow.lastTo,
            lastAccountId: sessionRow.lastAccountId,
            lastThreadId: sessionRow.lastThreadId,
            totalTokens: sessionRow.totalTokens,
            totalTokensFresh: sessionRow.totalTokensFresh,
            contextTokens: sessionRow.contextTokens,
            estimatedCostUsd: sessionRow.estimatedCostUsd,
            responseUsage: sessionRow.responseUsage,
            modelProvider: sessionRow.modelProvider,
            model: sessionRow.model,
            status: sessionRow.status,
            startedAt: sessionRow.startedAt,
            endedAt: sessionRow.endedAt,
            runtimeMs: sessionRow.runtimeMs,
          }
        : {}),
    },
    connIds,
    { dropIfSlow: true },
  );
}

function rejectWebchatSessionMutation(params: {
  action: "patch" | "delete";
  client: GatewayClient | null;
  isWebchatConnect: (params: GatewayClient["connect"] | null | undefined) => boolean;
  respond: RespondFn;
}): boolean {
  if (!params.client?.connect || !params.isWebchatConnect(params.client.connect)) {
    return false;
  }
  if (params.client.connect.client.id === GATEWAY_CLIENT_IDS.CONTROL_UI) {
    return false;
  }
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `webchat clients cannot ${params.action} sessions; use chat.send for session-scoped updates`,
    ),
  );
  return true;
}

function buildSessionInspectPayload(params: {
  cfg: ReturnType<typeof loadConfig>;
  key: string;
  storePath: string;
  store: Record<string, SessionEntry>;
  entry: SessionEntry;
  previewLimit?: number;
  previewMaxChars?: number;
}) {
  const target = resolveGatewaySessionStoreTarget({
    cfg: params.cfg,
    key: params.key,
    store: params.store,
  });
  const row = buildGatewaySessionRow({
    cfg: params.cfg,
    storePath: params.storePath,
    store: params.store,
    key: params.key,
    entry: params.entry,
  });
  const transcript = resolveSessionTranscriptState({
    entry: params.entry,
    target,
  });
  const snapshot = inspectDetachedSessionLifecycle({
    cfg: params.cfg,
    sessionKey: params.key,
    entry: params.entry,
    target,
    abortedLastRun: row.abortedLastRun === true,
  });
  const relatedTasks = snapshot?.relatedTasks ?? [];
  const relatedTaskFlows = snapshot?.relatedTaskFlows ?? [];
  const completionRouting =
    snapshot?.completionRouting ?? buildBackgroundSessionCompletionRouting();
  const lifecycle =
    snapshot?.lifecycle ??
    buildSessionLifecycleAssessment({
      abortedLastRun: row.abortedLastRun === true,
      transcriptExists: transcript.transcriptExists,
      relatedTasks,
      relatedTaskFlows,
      resumeDetail: snapshot?.resumeDetail,
    });
  const previewLimit =
    typeof params.previewLimit === "number" && Number.isFinite(params.previewLimit)
      ? Math.max(1, Math.floor(params.previewLimit))
      : 12;
  const previewMaxChars =
    typeof params.previewMaxChars === "number" && Number.isFinite(params.previewMaxChars)
      ? Math.max(20, Math.floor(params.previewMaxChars))
      : 240;
  const previewItems =
    params.entry.sessionId?.trim() && transcript.transcriptExists
      ? readSessionPreviewItemsFromTranscript(
          params.entry.sessionId,
          params.storePath,
          params.entry.sessionFile,
          target.agentId,
          previewLimit,
          previewMaxChars,
        )
      : [];

  return {
    key: params.key,
    row,
    transcript: {
      path: transcript.transcriptPath,
      exists: transcript.transcriptExists,
      handoff: buildBackgroundSessionTranscriptHandoff({
        transcriptExists: transcript.transcriptExists,
        completionRouting,
      }),
    },
    lifecycle,
    completionRouting,
    relatedTasks: relatedTasks.map((task) => ({
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
    relatedTaskFlows: relatedTaskFlows.map((flow) => ({
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
    resume: snapshot?.resumeDetail ?? null,
    resumeLines: formatBackgroundSessionResumeLines({
      cfg: params.cfg,
      sessionKey: params.key,
      entry: params.entry,
      target,
      completionRouting,
    }),
    preview: {
      status: !params.entry.sessionId?.trim()
        ? "missing"
        : !transcript.transcriptExists
          ? "missing"
          : previewItems.length > 0
            ? "ok"
            : "empty",
      items: previewItems,
    },
  };
}

function buildDashboardSessionKey(agentId: string): string {
  return `agent:${agentId}:dashboard:${randomUUID()}`;
}

function ensureSessionTranscriptFile(params: {
  sessionId: string;
  storePath: string;
  sessionFile?: string;
  agentId: string;
}): { ok: true; transcriptPath: string } | { ok: false; error: string } {
  try {
    const transcriptPath = resolveSessionFilePath(
      params.sessionId,
      params.sessionFile ? { sessionFile: params.sessionFile } : undefined,
      resolveSessionFilePathOptions({
        storePath: params.storePath,
        agentId: params.agentId,
      }),
    );
    if (!fs.existsSync(transcriptPath)) {
      fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
      const header = {
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: params.sessionId,
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      };
      fs.writeFileSync(transcriptPath, `${JSON.stringify(header)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
      });
    }
    return { ok: true, transcriptPath };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveAbortSessionKey(params: {
  context: Pick<GatewayRequestContext, "chatAbortControllers">;
  requestedKey: string;
  canonicalKey: string;
  runId?: string;
}): string {
  const activeRunKey =
    typeof params.runId === "string"
      ? params.context.chatAbortControllers.get(params.runId)?.sessionKey
      : undefined;
  if (activeRunKey) {
    return activeRunKey;
  }
  for (const active of params.context.chatAbortControllers.values()) {
    if (active.sessionKey === params.canonicalKey) {
      return params.canonicalKey;
    }
    if (active.sessionKey === params.requestedKey) {
      return params.requestedKey;
    }
  }
  return params.requestedKey;
}

function hasTrackedActiveSessionRun(params: {
  context: Pick<GatewayRequestContext, "chatAbortControllers">;
  requestedKey: string;
  canonicalKey: string;
}): boolean {
  for (const active of params.context.chatAbortControllers.values()) {
    if (active.sessionKey === params.canonicalKey || active.sessionKey === params.requestedKey) {
      return true;
    }
  }
  return false;
}

async function interruptSessionRunIfActive(params: {
  req: GatewayRequestHandlerOptions["req"];
  context: GatewayRequestContext;
  client: GatewayClient | null;
  isWebchatConnect: GatewayRequestHandlerOptions["isWebchatConnect"];
  requestedKey: string;
  canonicalKey: string;
  sessionId?: string;
}): Promise<{ interrupted: boolean; error?: ReturnType<typeof errorShape> }> {
  const hasTrackedRun = hasTrackedActiveSessionRun({
    context: params.context,
    requestedKey: params.requestedKey,
    canonicalKey: params.canonicalKey,
  });
  const hasEmbeddedRun =
    typeof params.sessionId === "string" && params.sessionId
      ? isEmbeddedPiRunActive(params.sessionId)
      : false;

  if (!hasTrackedRun && !hasEmbeddedRun) {
    return { interrupted: false };
  }

  if (hasTrackedRun) {
    let abortOk = true;
    let abortError: ReturnType<typeof errorShape> | undefined;
    const abortSessionKey = resolveAbortSessionKey({
      context: params.context,
      requestedKey: params.requestedKey,
      canonicalKey: params.canonicalKey,
    });

    await chatHandlers["chat.abort"]({
      req: params.req,
      params: {
        sessionKey: abortSessionKey,
      },
      respond: (ok, _payload, error) => {
        abortOk = ok;
        abortError = error;
      },
      context: params.context,
      client: params.client,
      isWebchatConnect: params.isWebchatConnect,
    });

    if (!abortOk) {
      return {
        interrupted: true,
        error:
          abortError ?? errorShape(ErrorCodes.UNAVAILABLE, "failed to interrupt active session"),
      };
    }
  }

  if (hasEmbeddedRun && params.sessionId) {
    abortEmbeddedPiRun(params.sessionId);
  }

  clearSessionQueues([params.requestedKey, params.canonicalKey, params.sessionId]);

  if (hasEmbeddedRun && params.sessionId) {
    const ended = await waitForEmbeddedPiRunEnd(params.sessionId, 15_000);
    if (!ended) {
      return {
        interrupted: true,
        error: errorShape(
          ErrorCodes.UNAVAILABLE,
          `Session ${params.requestedKey} is still active; try again in a moment.`,
        ),
      };
    }
  }

  return { interrupted: true };
}

async function handleSessionSend(params: {
  method: "sessions.send" | "sessions.steer";
  req: GatewayRequestHandlerOptions["req"];
  params: Record<string, unknown>;
  respond: RespondFn;
  context: GatewayRequestContext;
  client: GatewayClient | null;
  isWebchatConnect: GatewayRequestHandlerOptions["isWebchatConnect"];
  interruptIfActive: boolean;
}) {
  if (
    !assertValidParams(params.params, validateSessionsSendParams, params.method, params.respond)
  ) {
    return;
  }
  const p = params.params;
  const key = requireSessionKey((p as { key?: unknown }).key, params.respond);
  if (!key) {
    return;
  }
  const { entry, canonicalKey, storePath } = loadSessionEntry(key);
  if (!entry?.sessionId) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${key}`),
    );
    return;
  }

  let interruptedActiveRun = false;
  if (params.interruptIfActive) {
    const interruptResult = await interruptSessionRunIfActive({
      req: params.req,
      context: params.context,
      client: params.client,
      isWebchatConnect: params.isWebchatConnect,
      requestedKey: key,
      canonicalKey,
      sessionId: entry.sessionId,
    });
    if (interruptResult.error) {
      params.respond(false, undefined, interruptResult.error);
      return;
    }
    interruptedActiveRun = interruptResult.interrupted;
  }

  const messageSeq = readSessionMessages(entry.sessionId, storePath, entry.sessionFile).length + 1;
  let sendAcked = false;
  let sendPayload: unknown;
  let sendCached = false;
  let startedRunId: string | undefined;
  const rawIdempotencyKey = (p as { idempotencyKey?: string }).idempotencyKey;
  const idempotencyKey =
    typeof rawIdempotencyKey === "string" && rawIdempotencyKey.trim()
      ? rawIdempotencyKey.trim()
      : randomUUID();
  await chatHandlers["chat.send"]({
    req: params.req,
    params: {
      sessionKey: canonicalKey,
      message: (p as { message: string }).message,
      thinking: (p as { thinking?: string }).thinking,
      attachments: (p as { attachments?: unknown[] }).attachments,
      timeoutMs: (p as { timeoutMs?: number }).timeoutMs,
      idempotencyKey,
    },
    respond: (ok, payload, error, meta) => {
      sendAcked = ok;
      sendPayload = payload;
      sendCached = meta?.cached === true;
      startedRunId =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { runId?: unknown }).runId === "string"
          ? (payload as { runId: string }).runId
          : undefined;
      if (ok && shouldAttachPendingMessageSeq({ payload, cached: meta?.cached === true })) {
        params.respond(
          true,
          {
            ...(payload && typeof payload === "object" ? payload : {}),
            messageSeq,
            ...(interruptedActiveRun ? { interruptedActiveRun: true } : {}),
          },
          undefined,
          meta,
        );
        return;
      }
      params.respond(
        ok,
        ok && payload && typeof payload === "object"
          ? {
              ...payload,
              ...(interruptedActiveRun ? { interruptedActiveRun: true } : {}),
            }
          : payload,
        error,
        meta,
      );
    },
    context: params.context,
    client: params.client,
    isWebchatConnect: params.isWebchatConnect,
  });
  if (sendAcked) {
    if (shouldAttachPendingMessageSeq({ payload: sendPayload, cached: sendCached })) {
      await reactivateCompletedSubagentSession({
        sessionKey: canonicalKey,
        runId: startedRunId,
      });
    }
    emitSessionsChanged(params.context, {
      sessionKey: canonicalKey,
      reason: interruptedActiveRun ? "steer" : "send",
    });
  }
}
export const sessionsHandlers: GatewayRequestHandlers = {
  "sessions.list": ({ params, respond }) => {
    if (!assertValidParams(params, validateSessionsListParams, "sessions.list", respond)) {
      return;
    }
    const p = params;
    const cfg = loadConfig();
    const { storePath, store } = loadCombinedSessionStoreForGateway(cfg);
    const result = listSessionsFromStore({
      cfg,
      storePath,
      store,
      opts: p,
    });
    respond(true, result, undefined);
  },
  "sessions.subscribe": ({ client, context, respond }) => {
    const connId = client?.connId?.trim();
    if (connId) {
      context.subscribeSessionEvents(connId);
    }
    respond(true, { subscribed: Boolean(connId) }, undefined);
  },
  "sessions.unsubscribe": ({ client, context, respond }) => {
    const connId = client?.connId?.trim();
    if (connId) {
      context.unsubscribeSessionEvents(connId);
    }
    respond(true, { subscribed: false }, undefined);
  },
  "sessions.messages.subscribe": ({ params, client, context, respond }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsMessagesSubscribeParams,
        "sessions.messages.subscribe",
        respond,
      )
    ) {
      return;
    }
    const connId = client?.connId?.trim();
    const key = requireSessionKey((params as { key?: unknown }).key, respond);
    if (!key) {
      return;
    }
    const { canonicalKey } = loadSessionEntry(key);
    if (connId) {
      context.subscribeSessionMessageEvents(connId, canonicalKey);
      respond(true, { subscribed: true, key: canonicalKey }, undefined);
      return;
    }
    respond(true, { subscribed: false, key: canonicalKey }, undefined);
  },
  "sessions.messages.unsubscribe": ({ params, client, context, respond }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsMessagesUnsubscribeParams,
        "sessions.messages.unsubscribe",
        respond,
      )
    ) {
      return;
    }
    const connId = client?.connId?.trim();
    const key = requireSessionKey((params as { key?: unknown }).key, respond);
    if (!key) {
      return;
    }
    const { canonicalKey } = loadSessionEntry(key);
    if (connId) {
      context.unsubscribeSessionMessageEvents(connId, canonicalKey);
    }
    respond(true, { subscribed: false, key: canonicalKey }, undefined);
  },
  "sessions.preview": ({ params, respond }) => {
    if (!assertValidParams(params, validateSessionsPreviewParams, "sessions.preview", respond)) {
      return;
    }
    const p = params;
    const keysRaw = Array.isArray(p.keys) ? p.keys : [];
    const keys = keysRaw
      .map((key) => String(key ?? "").trim())
      .filter(Boolean)
      .slice(0, 64);
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit) ? Math.max(1, p.limit) : 12;
    const maxChars =
      typeof p.maxChars === "number" && Number.isFinite(p.maxChars)
        ? Math.max(20, p.maxChars)
        : 240;

    if (keys.length === 0) {
      respond(true, { ts: Date.now(), previews: [] } satisfies SessionsPreviewResult, undefined);
      return;
    }

    const cfg = loadConfig();
    const storeCache = new Map<string, Record<string, SessionEntry>>();
    const previews: SessionsPreviewEntry[] = [];

    for (const key of keys) {
      try {
        const storeTarget = resolveGatewaySessionStoreTarget({ cfg, key, scanLegacyKeys: false });
        const store =
          storeCache.get(storeTarget.storePath) ?? loadSessionStore(storeTarget.storePath);
        storeCache.set(storeTarget.storePath, store);
        const target = resolveGatewaySessionStoreTarget({
          cfg,
          key,
          store,
        });
        const entry = resolveFreshestSessionEntryFromStoreKeys(store, target.storeKeys);
        if (!entry?.sessionId) {
          previews.push({ key, status: "missing", items: [] });
          continue;
        }
        const items = readSessionPreviewItemsFromTranscript(
          entry.sessionId,
          target.storePath,
          entry.sessionFile,
          target.agentId,
          limit,
          maxChars,
        );
        previews.push({
          key,
          status: items.length > 0 ? "ok" : "empty",
          items,
        });
      } catch {
        previews.push({ key, status: "error", items: [] });
      }
    }

    respond(true, { ts: Date.now(), previews } satisfies SessionsPreviewResult, undefined);
  },
  "sessions.inspect": ({ params, respond }) => {
    if (!assertValidParams(params, validateSessionsInspectParams, "sessions.inspect", respond)) {
      return;
    }
    const p = params as {
      key?: unknown;
      previewLimit?: unknown;
      previewMaxChars?: unknown;
    };
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const { cfg, storePath, store, entry, canonicalKey } = loadSessionEntry(key);
    if (!entry?.sessionId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${key}`),
      );
      return;
    }
    respond(
      true,
      buildSessionInspectPayload({
        cfg,
        key: canonicalKey,
        storePath,
        store,
        entry,
        previewLimit: typeof p.previewLimit === "number" ? p.previewLimit : undefined,
        previewMaxChars: typeof p.previewMaxChars === "number" ? p.previewMaxChars : undefined,
      }),
      undefined,
    );
  },
  "sessions.resolve": async ({ params, respond }) => {
    if (!assertValidParams(params, validateSessionsResolveParams, "sessions.resolve", respond)) {
      return;
    }
    const p = params;
    const cfg = loadConfig();

    const resolved = await resolveSessionKeyFromResolveParams({ cfg, p });
    if (!resolved.ok) {
      respond(false, undefined, resolved.error);
      return;
    }
    respond(true, { ok: true, key: resolved.key }, undefined);
  },
  "sessions.create": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsCreateParams, "sessions.create", respond)) {
      return;
    }
    const p = params;
    const cfg = loadConfig();
    const requestedKey = typeof p.key === "string" && p.key.trim() ? p.key.trim() : undefined;
    const agentId = normalizeAgentId(
      typeof p.agentId === "string" && p.agentId.trim() ? p.agentId : resolveDefaultAgentId(cfg),
    );
    if (requestedKey) {
      const requestedAgentId = parseAgentSessionKey(requestedKey)?.agentId;
      if (
        requestedAgentId &&
        requestedAgentId !== agentId &&
        typeof p.agentId === "string" &&
        p.agentId.trim()
      ) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `sessions.create key agent (${requestedAgentId}) does not match agentId (${agentId})`,
          ),
        );
        return;
      }
    }
    const parentSessionKey =
      typeof p.parentSessionKey === "string" && p.parentSessionKey.trim()
        ? p.parentSessionKey.trim()
        : undefined;
    let canonicalParentSessionKey: string | undefined;
    if (parentSessionKey) {
      const parent = loadSessionEntry(parentSessionKey);
      if (!parent.entry?.sessionId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown parent session: ${parentSessionKey}`),
        );
        return;
      }
      canonicalParentSessionKey = parent.canonicalKey;
    }
    const loweredRequestedKey = requestedKey?.toLowerCase();
    const key = requestedKey
      ? loweredRequestedKey === "global" || loweredRequestedKey === "unknown"
        ? loweredRequestedKey
        : toAgentStoreSessionKey({
            agentId,
            requestKey: requestedKey,
            mainKey: cfg.session?.mainKey,
          })
      : buildDashboardSessionKey(agentId);
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const targetAgentId = resolveAgentIdFromSessionKey(target.canonicalKey);
    const created = await updateSessionStore(target.storePath, async (store) => {
      const patched = await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: target.canonicalKey,
        patch: {
          key: target.canonicalKey,
          label: typeof p.label === "string" ? p.label.trim() : undefined,
          model: typeof p.model === "string" ? p.model.trim() : undefined,
        },
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
      if (!patched.ok || !canonicalParentSessionKey) {
        return patched;
      }
      const nextEntry: SessionEntry = {
        ...patched.entry,
        parentSessionKey: canonicalParentSessionKey,
      };
      store[target.canonicalKey] = nextEntry;
      return {
        ...patched,
        entry: nextEntry,
      };
    });
    if (!created.ok) {
      respond(false, undefined, created.error);
      return;
    }
    const ensured = ensureSessionTranscriptFile({
      sessionId: created.entry.sessionId,
      storePath: target.storePath,
      sessionFile: created.entry.sessionFile,
      agentId: targetAgentId,
    });
    if (!ensured.ok) {
      await updateSessionStore(target.storePath, (store) => {
        delete store[target.canonicalKey];
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to create session transcript: ${ensured.error}`),
      );
      return;
    }

    const createdEntry =
      created.entry.sessionFile === ensured.transcriptPath
        ? created.entry
        : {
            ...created.entry,
            sessionFile: ensured.transcriptPath,
          };
    if (createdEntry !== created.entry) {
      await updateSessionStore(target.storePath, (store) => {
        const existing = store[target.canonicalKey];
        if (existing) {
          store[target.canonicalKey] = {
            ...existing,
            sessionFile: ensured.transcriptPath,
          };
        }
      });
    }

    const initialMessage = resolveOptionalInitialSessionMessage(p);
    let runPayload: Record<string, unknown> | undefined;
    let runError: unknown;
    let runMeta: Record<string, unknown> | undefined;
    const messageSeq = initialMessage
      ? readSessionMessages(createdEntry.sessionId, target.storePath, createdEntry.sessionFile)
          .length + 1
      : undefined;

    if (initialMessage) {
      await chatHandlers["chat.send"]({
        req,
        params: {
          sessionKey: target.canonicalKey,
          message: initialMessage,
          idempotencyKey: randomUUID(),
        },
        respond: (ok, payload, error, meta) => {
          if (ok && payload && typeof payload === "object") {
            runPayload = payload as Record<string, unknown>;
          } else {
            runError = error;
          }
          runMeta = meta;
        },
        context,
        client,
        isWebchatConnect,
      });
    }

    const runStarted =
      runPayload !== undefined &&
      shouldAttachPendingMessageSeq({
        payload: runPayload,
        cached: runMeta?.cached === true,
      });

    respond(
      true,
      {
        ok: true,
        key: target.canonicalKey,
        sessionId: createdEntry.sessionId,
        entry: createdEntry,
        runStarted,
        ...(runPayload ? runPayload : {}),
        ...(runStarted && typeof messageSeq === "number" ? { messageSeq } : {}),
        ...(runError ? { runError } : {}),
      },
      undefined,
    );
    emitSessionsChanged(context, {
      sessionKey: target.canonicalKey,
      reason: "create",
    });
    if (runStarted) {
      emitSessionsChanged(context, {
        sessionKey: target.canonicalKey,
        reason: "send",
      });
    }
  },
  "sessions.send": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    await handleSessionSend({
      method: "sessions.send",
      req,
      params,
      respond,
      context,
      client,
      isWebchatConnect,
      interruptIfActive: false,
    });
  },
  "sessions.reattach": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsReattachParams, "sessions.reattach", respond)) {
      return;
    }
    const p = params as {
      key?: unknown;
      message?: unknown;
      thinking?: unknown;
      attachments?: unknown[];
      timeoutMs?: unknown;
      idempotencyKey?: unknown;
    };
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const { cfg, storePath, store, entry, canonicalKey } = loadSessionEntry(key);
    if (!entry?.sessionId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${key}`),
      );
      return;
    }
    const message =
      typeof p.message === "string" && p.message.trim()
        ? p.message
        : DEFAULT_BACKGROUND_RESUME_MESSAGE;
    const before = buildSessionInspectPayload({
      cfg,
      key: canonicalKey,
      storePath,
      store,
      entry,
    });

    let sendOk = false;
    let sendPayload: unknown;
    let sendError: ReturnType<typeof errorShape> | undefined;
    await handleSessionSend({
      method: "sessions.send",
      req,
      params: {
        key: canonicalKey,
        message,
        ...(typeof p.thinking === "string" ? { thinking: p.thinking } : {}),
        ...(Array.isArray(p.attachments) ? { attachments: p.attachments } : {}),
        ...(typeof p.timeoutMs === "number" ? { timeoutMs: p.timeoutMs } : {}),
        ...(typeof p.idempotencyKey === "string" ? { idempotencyKey: p.idempotencyKey } : {}),
      },
      respond: (ok, payload, error) => {
        sendOk = ok;
        sendPayload = payload;
        sendError = error;
      },
      context,
      client,
      isWebchatConnect,
      interruptIfActive: false,
    });
    if (!sendOk) {
      respond(false, undefined, sendError);
      return;
    }

    const reattachedAt = Date.now();
    markTasksReattachedForRelatedSessionKey({
      sessionKey: canonicalKey,
      reattachedAt,
    });
    markTaskFlowsReattachedForOwnerKey({
      ownerKey: canonicalKey,
      reattachedAt,
    });

    const after = buildSessionInspectPayload({
      cfg,
      key: canonicalKey,
      storePath,
      store,
      entry,
    });

    respond(
      true,
      {
        ...((sendPayload && typeof sendPayload === "object" && !Array.isArray(sendPayload))
          ? sendPayload
          : {}),
        continuedSession: {
          key: canonicalKey,
          sessionId: entry.sessionId,
          transcriptPath: before.transcript.path,
          transcriptExists: before.transcript.exists,
          lifecycleBeforeContinue: before.lifecycle,
          resumeBeforeContinue: before.resume,
          completionRoutingAfterContinue: after.completionRouting,
          reattachedAt,
        },
        continueRequest: {
          message,
          background: false,
          thinking: typeof p.thinking === "string" ? p.thinking : null,
          timeoutMs: typeof p.timeoutMs === "number" ? p.timeoutMs : null,
        },
        inspect: after,
      },
      undefined,
    );
    emitSessionsChanged(context, {
      sessionKey: canonicalKey,
      reason: "reattach",
    });
  },
  "sessions.steer": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    await handleSessionSend({
      method: "sessions.steer",
      req,
      params,
      respond,
      context,
      client,
      isWebchatConnect,
      interruptIfActive: true,
    });
  },
  "sessions.abort": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsAbortParams, "sessions.abort", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const { canonicalKey } = loadSessionEntry(key);
    const abortSessionKey = resolveAbortSessionKey({
      context,
      requestedKey: key,
      canonicalKey,
      runId: typeof p.runId === "string" ? p.runId : undefined,
    });
    let abortedRunId: string | null = null;
    await chatHandlers["chat.abort"]({
      req,
      params: {
        sessionKey: abortSessionKey,
        runId: typeof p.runId === "string" ? p.runId : undefined,
      },
      respond: (ok, payload, error, meta) => {
        if (!ok) {
          respond(ok, payload, error, meta);
          return;
        }
        const runIds =
          payload &&
          typeof payload === "object" &&
          Array.isArray((payload as { runIds?: unknown[] }).runIds)
            ? (payload as { runIds: unknown[] }).runIds.filter(
                (value): value is string => typeof value === "string" && value.trim().length > 0,
              )
            : [];
        abortedRunId = runIds[0] ?? null;
        respond(
          true,
          {
            ok: true,
            abortedRunId,
            status: abortedRunId ? "aborted" : "no-active-run",
          },
          undefined,
          meta,
        );
      },
      context,
      client,
      isWebchatConnect,
    });
    if (abortedRunId) {
      emitSessionsChanged(context, {
        sessionKey: canonicalKey,
        reason: "abort",
      });
    }
  },
  "sessions.patch": async ({ params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsPatchParams, "sessions.patch", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    if (rejectWebchatSessionMutation({ action: "patch", client, isWebchatConnect, respond })) {
      return;
    }

    const { cfg, target, storePath } = resolveGatewaySessionTargetFromKey(key);
    const applied = await updateSessionStore(storePath, async (store) => {
      const { primaryKey } = migrateAndPruneGatewaySessionStoreKey({ cfg, key, store });
      return await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: primaryKey,
        patch: p,
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }

    if (hasInternalHookListeners("session", "patch")) {
      const hookContext: SessionPatchHookContext = structuredClone({
        sessionEntry: applied.entry,
        patch: p,
        cfg,
      });
      const hookEvent: SessionPatchHookEvent = {
        type: "session",
        action: "patch",
        sessionKey: target.canonicalKey ?? key,
        context: hookContext,
        timestamp: new Date(),
        messages: [],
      };
      void triggerInternalHook(hookEvent);
    }

    const parsed = parseAgentSessionKey(target.canonicalKey ?? key);
    const agentId = normalizeAgentId(parsed?.agentId ?? resolveDefaultAgentId(cfg));
    const resolved = resolveSessionModelRef(cfg, applied.entry, agentId);
    const result: SessionsPatchResult = {
      ok: true,
      path: storePath,
      key: target.canonicalKey,
      entry: applied.entry,
      resolved: {
        modelProvider: resolved.provider,
        model: resolved.model,
      },
    };
    respond(true, result, undefined);
    emitSessionsChanged(context, {
      sessionKey: target.canonicalKey,
      reason: "patch",
    });
  },
  "sessions.reset": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsResetParams, "sessions.reset", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }

    const reason = p.reason === "new" ? "new" : "reset";
    const { performGatewaySessionReset } = await import("./sessions.runtime.js");
    const result = await performGatewaySessionReset({
      key,
      reason,
      commandSource: "gateway:sessions.reset",
    });
    if (!result.ok) {
      respond(false, undefined, result.error);
      return;
    }
    respond(true, { ok: true, key: result.key, entry: result.entry }, undefined);
    emitSessionsChanged(context, {
      sessionKey: result.key,
      reason,
    });
  },
  "sessions.delete": async ({ params, respond, client, isWebchatConnect, context }) => {
    if (!assertValidParams(params, validateSessionsDeleteParams, "sessions.delete", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    if (rejectWebchatSessionMutation({ action: "delete", client, isWebchatConnect, respond })) {
      return;
    }

    const { cfg, target, storePath } = resolveGatewaySessionTargetFromKey(key);
    const mainKey = resolveMainSessionKey(cfg);
    if (target.canonicalKey === mainKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Cannot delete the main session (${mainKey}).`),
      );
      return;
    }

    const deleteTranscript = typeof p.deleteTranscript === "boolean" ? p.deleteTranscript : true;
    const {
      archiveSessionTranscriptsForSessionDetailed,
      cleanupSessionBeforeMutation,
      emitGatewaySessionEndPluginHook,
      emitSessionUnboundLifecycleEvent,
    } = await import("./sessions.runtime.js");

    const { entry, legacyKey, canonicalKey } = loadSessionEntry(key);
    const mutationCleanupError = await cleanupSessionBeforeMutation({
      cfg,
      key,
      target,
      entry,
      legacyKey,
      canonicalKey,
      reason: "session-delete",
    });
    if (mutationCleanupError) {
      respond(false, undefined, mutationCleanupError);
      return;
    }
    const sessionId = entry?.sessionId;
    const deleted = await updateSessionStore(storePath, (store) => {
      const { primaryKey } = migrateAndPruneGatewaySessionStoreKey({ cfg, key, store });
      const hadEntry = Boolean(store[primaryKey]);
      if (hadEntry) {
        delete store[primaryKey];
      }
      return hadEntry;
    });

    const archivedTranscripts =
      deleted && deleteTranscript
        ? archiveSessionTranscriptsForSessionDetailed({
            sessionId,
            storePath,
            sessionFile: entry?.sessionFile,
            agentId: target.agentId,
            reason: "deleted",
          })
        : [];
    const archived = archivedTranscripts.map((entry) => entry.archivedPath);
    if (deleted) {
      emitGatewaySessionEndPluginHook({
        cfg,
        sessionKey: target.canonicalKey ?? key,
        sessionId,
        storePath,
        sessionFile: entry?.sessionFile,
        agentId: target.agentId,
        reason: "deleted",
        archivedTranscripts,
      });
      const emitLifecycleHooks = p.emitLifecycleHooks !== false;
      await emitSessionUnboundLifecycleEvent({
        targetSessionKey: target.canonicalKey ?? key,
        reason: "session-delete",
        emitHooks: emitLifecycleHooks,
      });
    }

    respond(true, { ok: true, key: target.canonicalKey, deleted, archived }, undefined);
    if (deleted) {
      emitSessionsChanged(context, {
        sessionKey: target.canonicalKey,
        reason: "delete",
      });
    }
  },
  "sessions.get": ({ params, respond }) => {
    const p = params;
    const key = requireSessionKey(p.key ?? p.sessionKey, respond);
    if (!key) {
      return;
    }
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit)
        ? Math.max(1, Math.floor(p.limit))
        : 200;

    const { target, storePath } = resolveGatewaySessionTargetFromKey(key);
    const store = loadSessionStore(storePath);
    const entry = resolveFreshestSessionEntryFromStoreKeys(store, target.storeKeys);
    if (!entry?.sessionId) {
      respond(true, { messages: [] }, undefined);
      return;
    }
    const allMessages = readSessionMessages(entry.sessionId, storePath, entry.sessionFile);
    const messages = limit < allMessages.length ? allMessages.slice(-limit) : allMessages;
    respond(true, { messages }, undefined);
  },
  "sessions.compact": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsCompactParams, "sessions.compact", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }

    const maxLines =
      typeof p.maxLines === "number" && Number.isFinite(p.maxLines)
        ? Math.max(1, Math.floor(p.maxLines))
        : 400;

    const { cfg, target, storePath } = resolveGatewaySessionTargetFromKey(key);
    // Lock + read in a short critical section; transcript work happens outside.
    const compactTarget = await updateSessionStore(storePath, (store) => {
      const { entry, primaryKey } = migrateAndPruneGatewaySessionStoreKey({ cfg, key, store });
      return { entry, primaryKey };
    });
    const entry = compactTarget.entry;
    const sessionId = entry?.sessionId;
    if (!sessionId) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no sessionId",
        },
        undefined,
      );
      return;
    }

    const filePath = resolveSessionTranscriptCandidates(
      sessionId,
      storePath,
      entry?.sessionFile,
      target.agentId,
    ).find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no transcript",
        },
        undefined,
      );
      return;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= maxLines) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          kept: lines.length,
        },
        undefined,
      );
      return;
    }

    const archived = archiveFileOnDisk(filePath, "bak");
    const keptLines = lines.slice(-maxLines);
    fs.writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf-8");

    await updateSessionStore(storePath, (store) => {
      const entryKey = compactTarget.primaryKey;
      const entryToUpdate = store[entryKey];
      if (!entryToUpdate) {
        return;
      }
      delete entryToUpdate.inputTokens;
      delete entryToUpdate.outputTokens;
      delete entryToUpdate.totalTokens;
      delete entryToUpdate.totalTokensFresh;
      entryToUpdate.updatedAt = Date.now();
    });

    respond(
      true,
      {
        ok: true,
        key: target.canonicalKey,
        compacted: true,
        archived,
        kept: keptLines.length,
      },
      undefined,
    );
    emitSessionsChanged(context, {
      sessionKey: target.canonicalKey,
      reason: "compact",
      compacted: true,
    });
  },
};
