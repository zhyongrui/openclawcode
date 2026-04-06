import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import { listAgentIds } from "../agents/agent-scope.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { CliDeps } from "../cli/deps.js";
import { withProgress } from "../cli/progress.js";
import { loadConfig } from "../config/config.js";
import { callGateway, randomIdempotencyKey } from "../gateway/call.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  normalizeMessageChannel,
} from "../utils/message-channel.js";
import { agentCommand } from "./agent.js";
import { resolveSessionKeyForRequest } from "./agent/session.js";
import {
  type BackgroundSessionResumeDetail,
  type BackgroundSessionTranscriptHandoff,
  describeBackgroundSessionResume,
  formatBackgroundSessionResumeLines,
} from "./background-session-resume.js";

type AgentGatewayResult = {
  payloads?: Array<{
    text?: string;
    mediaUrl?: string | null;
    mediaUrls?: string[];
  }>;
  meta?: unknown;
};

type GatewayAgentResponse = {
  runId?: string;
  status?: string;
  summary?: string;
  acceptedAt?: number;
  sessionId?: string;
  sessionKey?: string;
  result?: AgentGatewayResult;
};

type BackgroundAcceptedHandoff = {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  transcriptPath?: string | null;
  transcriptExists?: boolean;
  transcriptHandoff?: BackgroundSessionTranscriptHandoff;
  waitWith?: string;
  continueWith?: string;
  reattachWith?: string;
  resumeWith?: string;
  resume?: BackgroundSessionResumeDetail;
};

const NO_GATEWAY_TIMEOUT_MS = 2_147_000_000;
const CONTINUE_MESSAGE = "Continue from the latest background task state.";

export type AgentCliOpts = {
  message: string;
  agent?: string;
  to?: string;
  sessionId?: string;
  sessionKey?: string;
  background?: boolean;
  thinking?: string;
  verbose?: string;
  json?: boolean;
  timeout?: string;
  deliver?: boolean;
  channel?: string;
  replyTo?: string;
  replyChannel?: string;
  replyAccount?: string;
  bestEffortDeliver?: boolean;
  lane?: string;
  runId?: string;
  extraSystemPrompt?: string;
  local?: boolean;
};

function parseTimeoutSeconds(opts: { cfg: ReturnType<typeof loadConfig>; timeout?: string }) {
  const raw =
    opts.timeout !== undefined
      ? Number.parseInt(String(opts.timeout), 10)
      : (opts.cfg.agents?.defaults?.timeoutSeconds ?? 600);
  if (Number.isNaN(raw) || raw < 0) {
    throw new Error("--timeout must be a non-negative integer (seconds; 0 means no timeout)");
  }
  return raw;
}

function formatPayloadForLog(payload: {
  text?: string;
  mediaUrls?: string[];
  mediaUrl?: string | null;
}) {
  const parts = resolveSendableOutboundReplyParts({
    text: payload.text,
    mediaUrls: payload.mediaUrls,
    mediaUrl: typeof payload.mediaUrl === "string" ? payload.mediaUrl : undefined,
  });
  const lines: string[] = [];
  if (parts.text) {
    lines.push(parts.text.trimEnd());
  }
  for (const url of parts.mediaUrls) {
    lines.push(`MEDIA:${url}`);
  }
  return lines.join("\n").trimEnd();
}

function quoteCliArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function buildContinueCommand(sessionLookup: string) {
  return formatCliCommand(
    `openclaw sessions continue ${quoteCliArg(sessionLookup)} --message ${quoteCliArg(CONTINUE_MESSAGE)}`,
  );
}

function buildResumeCommand(params: { sessionId?: string; sessionKey?: string }) {
  if (params.sessionId) {
    return formatCliCommand(
      `openclaw agent --session-id ${quoteCliArg(params.sessionId)} --message ${quoteCliArg(CONTINUE_MESSAGE)}`,
    );
  }
  if (params.sessionKey) {
    return formatCliCommand(
      `openclaw agent --session-key ${quoteCliArg(params.sessionKey)} --message ${quoteCliArg(CONTINUE_MESSAGE)}`,
    );
  }
  return null;
}

function buildWaitCommand(runId: string) {
  return formatCliCommand(`openclaw gateway call agent.wait --run-id ${quoteCliArg(runId)}`);
}

function buildAcceptedBackgroundHandoff(params: {
  cfg: ReturnType<typeof loadConfig>;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
}): BackgroundAcceptedHandoff {
  const resumeDetail = params.sessionKey
    ? describeBackgroundSessionResume({
        cfg: params.cfg,
        sessionKey: params.sessionKey,
      })
    : undefined;
  const continueLookup = params.sessionKey ?? params.sessionId;
  const resumeWith =
    resumeDetail?.resumeWith ??
    buildResumeCommand({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
    });
  return {
    ...(params.runId ? { runId: params.runId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    ...(resumeDetail?.agentId ? { agentId: resumeDetail.agentId } : {}),
    ...(resumeDetail
      ? {
          transcriptPath: resumeDetail.transcriptPath,
          transcriptExists: resumeDetail.transcriptExists,
          transcriptHandoff: resumeDetail.transcriptHandoff,
        }
      : {}),
    ...(params.runId ? { waitWith: buildWaitCommand(params.runId) } : {}),
    ...(resumeDetail?.continueWith
      ? { continueWith: resumeDetail.continueWith }
      : continueLookup
        ? { continueWith: buildContinueCommand(continueLookup) }
        : {}),
    ...(resumeDetail?.reattachWith ? { reattachWith: resumeDetail.reattachWith } : {}),
    ...(resumeWith ? { resumeWith } : {}),
    ...(resumeDetail ? { resume: resumeDetail } : {}),
  };
}

function logAcceptedBackgroundRun(
  runtime: RuntimeEnv,
  params: {
    cfg: ReturnType<typeof loadConfig>;
    runId?: string;
    sessionId?: string;
    sessionKey?: string;
  },
) {
  const handoff = buildAcceptedBackgroundHandoff(params);
  runtime.log("Accepted background agent run.");
  if (handoff.runId) {
    runtime.log(`runId: ${handoff.runId}`);
  }
  if (handoff.sessionKey) {
    runtime.log(`sessionKey: ${handoff.sessionKey}`);
  }
  if (handoff.sessionId) {
    runtime.log(`sessionId: ${handoff.sessionId}`);
  }
  if (handoff.agentId) {
    runtime.log(`agent: ${handoff.agentId}`);
  }
  if ("transcriptPath" in handoff) {
    runtime.log(`transcript: ${handoff.transcriptPath ?? "n/a"}`);
  }
  if (typeof handoff.transcriptExists === "boolean") {
    runtime.log(`transcriptExists: ${handoff.transcriptExists ? "yes" : "no"}`);
  }
  if (handoff.transcriptHandoff) {
    runtime.log(`transcriptHandoff: ${handoff.transcriptHandoff.mode}`);
    runtime.log(`transcriptHandoffSummary: ${handoff.transcriptHandoff.summary}`);
  }
  if (handoff.waitWith) {
    runtime.log(`wait: ${handoff.waitWith}`);
  }
  if (handoff.continueWith) {
    runtime.log(`continue: ${handoff.continueWith}`);
  }
  if (handoff.reattachWith) {
    runtime.log(`reattach: ${handoff.reattachWith}`);
  }
  if (handoff.resumeWith) {
    runtime.log(`resume: ${handoff.resumeWith}`);
  }
  if (handoff.resume?.sessionKey) {
    runtime.log("Resume:");
    for (const line of formatBackgroundSessionResumeLines({
      cfg: params.cfg,
      sessionKey: handoff.resume.sessionKey,
    })) {
      runtime.log(line);
    }
  }
}

export async function agentViaGatewayCommand(opts: AgentCliOpts, runtime: RuntimeEnv) {
  const body = (opts.message ?? "").trim();
  if (!body) {
    throw new Error("Message (--message) is required");
  }
  if (!opts.to && !opts.sessionId && !opts.sessionKey && !opts.agent) {
    throw new Error("Pass --to <E.164>, --session-id, --session-key, or --agent to choose a session");
  }

  const cfg = loadConfig();
  const agentIdRaw = opts.agent?.trim();
  const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
  if (agentId) {
    const knownAgents = listAgentIds(cfg);
    if (!knownAgents.includes(agentId)) {
      throw new Error(
        `Unknown agent id "${agentIdRaw}". Use "${formatCliCommand("openclaw agents list")}" to see configured agents.`,
      );
    }
  }
  const timeoutSeconds = parseTimeoutSeconds({ cfg, timeout: opts.timeout });
  const gatewayTimeoutMs =
    timeoutSeconds === 0
      ? NO_GATEWAY_TIMEOUT_MS // no timeout (timer-safe max)
      : Math.max(10_000, (timeoutSeconds + 30) * 1000);

  const sessionKey = resolveSessionKeyForRequest({
    cfg,
    agentId,
    to: opts.to,
    sessionId: opts.sessionId,
    sessionKey: opts.sessionKey,
  }).sessionKey;

  const channel = normalizeMessageChannel(opts.channel);
  const idempotencyKey = opts.runId?.trim() || randomIdempotencyKey();

  const response = await withProgress(
    {
      label: opts.background ? "Starting background agent run…" : "Waiting for agent reply…",
      indeterminate: true,
      enabled: opts.json !== true,
    },
    async () =>
      await callGateway<GatewayAgentResponse>({
        method: "agent",
        params: {
          message: body,
          agentId,
          to: opts.to,
          replyTo: opts.replyTo,
          sessionId: opts.sessionId,
          sessionKey,
          thinking: opts.thinking,
          deliver: Boolean(opts.deliver),
          channel,
          replyChannel: opts.replyChannel,
          replyAccountId: opts.replyAccount,
          bestEffortDeliver: opts.bestEffortDeliver,
          timeout: timeoutSeconds,
          lane: opts.lane,
          extraSystemPrompt: opts.extraSystemPrompt,
          idempotencyKey,
        },
        expectFinal: opts.background !== true,
        timeoutMs: gatewayTimeoutMs,
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );

  if (opts.json) {
    const accepted = opts.background
      ? buildAcceptedBackgroundHandoff({
          cfg,
          runId: response?.runId,
          sessionId: response?.sessionId ?? opts.sessionId,
          sessionKey: response?.sessionKey ?? sessionKey,
        })
      : undefined;
    writeRuntimeJson(runtime, {
      ...response,
      ...(accepted ? { handoff: accepted } : {}),
    });
    return response;
  }

  if (opts.background) {
    logAcceptedBackgroundRun(runtime, {
      cfg,
      runId: response?.runId,
      sessionId: response?.sessionId ?? opts.sessionId,
      sessionKey: response?.sessionKey ?? sessionKey,
    });
    return response;
  }

  const result = response?.result;
  const payloads = result?.payloads ?? [];

  if (payloads.length === 0) {
    runtime.log(response?.summary ? String(response.summary) : "No reply from agent.");
    return response;
  }

  for (const payload of payloads) {
    const out = formatPayloadForLog(payload);
    if (out) {
      runtime.log(out);
    }
  }

  return response;
}

export async function agentCliCommand(opts: AgentCliOpts, runtime: RuntimeEnv, deps?: CliDeps) {
  const localOpts = {
    ...opts,
    agentId: opts.agent,
    replyAccountId: opts.replyAccount,
    cleanupBundleMcpOnRunEnd: opts.local === true,
  };
  if (opts.local === true) {
    if (opts.background) {
      throw new Error("--background is only supported when using the gateway");
    }
    return await agentCommand(localOpts, runtime, deps);
  }

  try {
    return await agentViaGatewayCommand(opts, runtime);
  } catch (err) {
    if (opts.background) {
      throw err;
    }
    runtime.error?.(`Gateway agent failed; falling back to embedded: ${String(err)}`);
    return await agentCommand(localOpts, runtime, deps);
  }
}
