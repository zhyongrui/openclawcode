import {
  buildSystemRunApprovalBinding,
  buildSystemRunApprovalEnvBinding,
} from "./system-run-approval-binding.js";
import { sanitizeExecApprovalDisplayText } from "./exec-approval-command-display.js";
import type { ExecApprovalDecision, ExecApprovalRequestPayload } from "./exec-approvals.js";
import {
  resolveSystemRunApprovalRequestContext,
  resolveSystemRunApprovalRuntimeContext,
} from "./system-run-approval-context.js";
import {
  normalizeOptionalString,
  normalizeOptionalThreadValue,
} from "../shared/string-coerce.js";

export type ExecApprovalEffectiveRequest = {
  host: string | null;
  nodeId: string | null;
  commandText: string;
  commandPreview: string | null;
  commandArgv: string[] | undefined;
  systemRunPlan: ExecApprovalRequestPayload["systemRunPlan"];
  cwd: string | null;
  agentId: string | null;
  sessionKey: string | null;
};

export function resolveExecApprovalEffectiveRequest(params: {
  host?: unknown;
  nodeId?: unknown;
  command?: unknown;
  commandArgv?: unknown;
  systemRunPlan?: unknown;
  cwd?: unknown;
  agentId?: unknown;
  sessionKey?: unknown;
}):
  | { ok: true; effective: ExecApprovalEffectiveRequest }
  | { ok: false; message: string } {
  const host = normalizeOptionalString(params.host) ?? null;
  const nodeId = normalizeOptionalString(params.nodeId) ?? null;
  const approvalContext = resolveSystemRunApprovalRequestContext({
    host,
    command: params.command,
    commandArgv: params.commandArgv,
    systemRunPlan: params.systemRunPlan,
    cwd: params.cwd,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  if (host === "node" && !nodeId) {
    return { ok: false, message: "nodeId is required for host=node" };
  }
  if (host === "node" && !approvalContext.plan) {
    return { ok: false, message: "systemRunPlan is required for host=node" };
  }
  if (!approvalContext.commandText) {
    return { ok: false, message: "command is required" };
  }
  if (
    host === "node" &&
    (!Array.isArray(approvalContext.commandArgv) || approvalContext.commandArgv.length === 0)
  ) {
    return { ok: false, message: "commandArgv is required for host=node" };
  }
  return {
    ok: true,
    effective: {
      host,
      nodeId,
      commandText: approvalContext.commandText,
      commandPreview: approvalContext.commandPreview,
      commandArgv: approvalContext.commandArgv,
      systemRunPlan: approvalContext.plan,
      cwd: approvalContext.cwd ?? null,
      agentId: approvalContext.agentId ?? null,
      sessionKey: approvalContext.sessionKey ?? null,
    },
  };
}

export function resolveNodeExecApprovalRuntimeRequest(params: {
  nodeId?: unknown;
  command?: unknown;
  rawCommand?: unknown;
  systemRunPlan?: unknown;
  cwd?: unknown;
  agentId?: unknown;
  sessionKey?: unknown;
}):
  | { ok: true; effective: ExecApprovalEffectiveRequest }
  | { ok: false; message: string; details?: Record<string, unknown> } {
  const nodeId = normalizeOptionalString(params.nodeId) ?? null;
  if (!nodeId) {
    return { ok: false, message: "nodeId is required for host=node" };
  }
  const runtimeContext = resolveSystemRunApprovalRuntimeContext({
    plan: params.systemRunPlan,
    command: params.command,
    rawCommand: params.rawCommand,
    cwd: params.cwd,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  if (!runtimeContext.ok) {
    return {
      ok: false,
      message: runtimeContext.message,
      details: runtimeContext.details,
    };
  }
  return {
    ok: true,
    effective: {
      host: "node",
      nodeId,
      commandText: runtimeContext.commandText,
      commandPreview: runtimeContext.plan?.commandPreview ?? null,
      commandArgv: runtimeContext.argv.length > 0 ? runtimeContext.argv : undefined,
      systemRunPlan: runtimeContext.plan,
      cwd: runtimeContext.cwd,
      agentId: runtimeContext.agentId,
      sessionKey: runtimeContext.sessionKey,
    },
  };
}

export function buildExecApprovalRequestPayload(params: {
  effective: ExecApprovalEffectiveRequest;
  env?: unknown;
  security?: unknown;
  ask?: unknown;
  allowedDecisions?: readonly ExecApprovalDecision[];
  resolvedPath?: unknown;
  turnSourceChannel?: unknown;
  turnSourceTo?: unknown;
  turnSourceAccountId?: unknown;
  turnSourceThreadId?: unknown;
}): ExecApprovalRequestPayload {
  const envBinding = buildSystemRunApprovalEnvBinding(params.env);
  const systemRunBinding =
    params.effective.host === "node"
      ? buildSystemRunApprovalBinding({
          argv: params.effective.commandArgv ?? [],
          cwd: params.effective.cwd,
          agentId: params.effective.agentId,
          sessionKey: params.effective.sessionKey,
          env: params.env,
        })
      : null;
  return {
    command: sanitizeExecApprovalDisplayText(params.effective.commandText),
    commandPreview:
      params.effective.host === "node" || !params.effective.commandPreview
        ? undefined
        : sanitizeExecApprovalDisplayText(params.effective.commandPreview),
    commandArgv: params.effective.host === "node" ? undefined : params.effective.commandArgv,
    envKeys: envBinding.envKeys.length > 0 ? envBinding.envKeys : undefined,
    systemRunBinding: systemRunBinding?.binding ?? null,
    systemRunPlan: params.effective.systemRunPlan,
    cwd: params.effective.cwd,
    nodeId: params.effective.host === "node" ? params.effective.nodeId : null,
    host: params.effective.host,
    security: normalizeOptionalString(params.security) ?? null,
    ask: normalizeOptionalString(params.ask) ?? null,
    allowedDecisions: params.allowedDecisions,
    agentId: params.effective.agentId,
    resolvedPath: normalizeOptionalString(params.resolvedPath) ?? null,
    sessionKey: params.effective.sessionKey,
    turnSourceChannel: normalizeOptionalString(params.turnSourceChannel) ?? null,
    turnSourceTo: normalizeOptionalString(params.turnSourceTo) ?? null,
    turnSourceAccountId: normalizeOptionalString(params.turnSourceAccountId) ?? null,
    turnSourceThreadId: normalizeOptionalThreadValue(params.turnSourceThreadId) ?? null,
  };
}
