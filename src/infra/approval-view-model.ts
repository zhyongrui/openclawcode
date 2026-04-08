import type { ChannelApprovalKind } from "../channels/plugins/types.adapters.js";
import {
  buildExecApprovalActionDescriptors,
  type ExecApprovalActionDescriptor,
} from "./exec-approval-reply.js";
import {
  type ExecApprovalDecision,
  type ExecApprovalRequest,
  type ExecApprovalResolved,
} from "./exec-approvals.js";
import { buildExecApprovalResponseView } from "./exec-approval-response-view.js";
import type { PluginApprovalRequest, PluginApprovalResolved } from "./plugin-approvals.js";

type ApprovalRequest = ExecApprovalRequest | PluginApprovalRequest;
type ApprovalResolved = ExecApprovalResolved | PluginApprovalResolved;
type ApprovalPhase = "pending" | "resolved" | "expired";

export type ApprovalActionView = ExecApprovalActionDescriptor;

export type ApprovalMetadataView = {
  label: string;
  value: string;
};

type ApprovalViewBase = {
  approvalId: string;
  approvalKind: ChannelApprovalKind;
  phase: "pending" | "resolved" | "expired";
  title: string;
  description?: string | null;
  metadata: ApprovalMetadataView[];
};

type ExecApprovalViewBase = ApprovalViewBase & {
  approvalKind: "exec";
  ask?: string | null;
  agentId?: string | null;
  commandText: string;
  commandPreview?: string | null;
  cwd?: string | null;
  envKeys?: readonly string[];
  host?: string | null;
  nodeId?: string | null;
  sessionKey?: string | null;
};

export type ExecApprovalPendingView = ExecApprovalViewBase & {
  phase: "pending";
  actions: ApprovalActionView[];
  expiresAtMs: number;
};

export type ExecApprovalResolvedView = ExecApprovalViewBase & {
  phase: "resolved";
  decision: ExecApprovalDecision;
  resolvedBy?: string | null;
};

export type ExecApprovalExpiredView = ExecApprovalViewBase & {
  phase: "expired";
};

type PluginApprovalViewBase = ApprovalViewBase & {
  approvalKind: "plugin";
  agentId?: string | null;
  pluginId?: string | null;
  toolName?: string | null;
  severity: "info" | "warning" | "critical";
};

export type PluginApprovalPendingView = PluginApprovalViewBase & {
  phase: "pending";
  actions: ApprovalActionView[];
  expiresAtMs: number;
};

export type PluginApprovalResolvedView = PluginApprovalViewBase & {
  phase: "resolved";
  decision: ExecApprovalDecision;
  resolvedBy?: string | null;
};

export type PluginApprovalExpiredView = PluginApprovalViewBase & {
  phase: "expired";
};

export type PendingApprovalView = ExecApprovalPendingView | PluginApprovalPendingView;
export type ResolvedApprovalView = ExecApprovalResolvedView | PluginApprovalResolvedView;
export type ExpiredApprovalView = ExecApprovalExpiredView | PluginApprovalExpiredView;
export type ApprovalViewModel = PendingApprovalView | ResolvedApprovalView | ExpiredApprovalView;

function buildExecMetadata(view: ReturnType<typeof buildExecApprovalResponseView>): ApprovalMetadataView[] {
  const metadata: ApprovalMetadataView[] = [];
  if (view.agentId) {
    metadata.push({ label: "Agent", value: view.agentId });
  }
  if (view.cwd) {
    metadata.push({ label: "CWD", value: view.cwd });
  }
  if (view.host) {
    metadata.push({ label: "Host", value: view.host });
  }
  if (Array.isArray(view.envKeys) && view.envKeys.length > 0) {
    metadata.push({ label: "Env Overrides", value: view.envKeys.join(", ") });
  }
  return metadata;
}

function buildPluginMetadata(request: PluginApprovalRequest): ApprovalMetadataView[] {
  const metadata: ApprovalMetadataView[] = [];
  const severity = request.request.severity ?? "warning";
  metadata.push({
    label: "Severity",
    value: severity === "critical" ? "Critical" : severity === "info" ? "Info" : "Warning",
  });
  if (request.request.toolName) {
    metadata.push({ label: "Tool", value: request.request.toolName });
  }
  if (request.request.pluginId) {
    metadata.push({ label: "Plugin", value: request.request.pluginId });
  }
  if (request.request.agentId) {
    metadata.push({ label: "Agent", value: request.request.agentId });
  }
  return metadata;
}

function buildExecViewBase<TPhase extends ApprovalPhase>(
  request: ExecApprovalRequest,
  phase: TPhase,
): ExecApprovalViewBase & { phase: TPhase } {
  const responseView = buildExecApprovalResponseView(request);
  return {
    approvalId: request.id,
    approvalKind: "exec",
    phase,
    title: phase === "pending" ? "Exec Approval Required" : "Exec Approval",
    description: phase === "pending" ? "A command needs your approval." : null,
    metadata: buildExecMetadata(responseView),
    ask: request.request.ask ?? null,
    agentId: responseView.agentId,
    commandText: responseView.commandText,
    commandPreview: responseView.commandPreview,
    cwd: responseView.cwd,
    envKeys: responseView.envKeys ?? undefined,
    host: responseView.host,
    nodeId: responseView.nodeId,
    sessionKey: responseView.sessionKey,
  };
}

function buildPluginViewBase<TPhase extends ApprovalPhase>(
  request: PluginApprovalRequest,
  phase: TPhase,
): PluginApprovalViewBase & { phase: TPhase } {
  return {
    approvalId: request.id,
    approvalKind: "plugin",
    phase,
    title: request.request.title,
    description: request.request.description ?? null,
    metadata: buildPluginMetadata(request),
    agentId: request.request.agentId ?? null,
    pluginId: request.request.pluginId ?? null,
    toolName: request.request.toolName ?? null,
    severity: request.request.severity ?? "warning",
  };
}

export function buildPendingApprovalView(request: ApprovalRequest): PendingApprovalView {
  if (request.id.startsWith("plugin:")) {
    const pluginRequest = request as PluginApprovalRequest;
    return {
      ...buildPluginViewBase(pluginRequest, "pending"),
      actions: buildExecApprovalActionDescriptors({
        approvalCommandId: pluginRequest.id,
      }),
      expiresAtMs: pluginRequest.expiresAtMs,
    };
  }
  const execRequest = request as ExecApprovalRequest;
  return {
    ...buildExecViewBase(execRequest, "pending"),
    actions: buildExecApprovalActionDescriptors({
      approvalCommandId: execRequest.id,
      ask: execRequest.request.ask,
      allowedDecisions: buildExecApprovalResponseView(execRequest).allowedDecisions,
    }),
    expiresAtMs: execRequest.expiresAtMs,
  };
}

export function buildResolvedApprovalView(
  request: ApprovalRequest,
  resolved: ApprovalResolved,
): ResolvedApprovalView {
  if (request.id.startsWith("plugin:")) {
    const pluginRequest = request as PluginApprovalRequest;
    return {
      ...buildPluginViewBase(pluginRequest, "resolved"),
      decision: resolved.decision,
      resolvedBy: resolved.resolvedBy,
    };
  }
  const execRequest = request as ExecApprovalRequest;
  return {
    ...buildExecViewBase(execRequest, "resolved"),
    decision: resolved.decision,
    resolvedBy: resolved.resolvedBy,
  };
}

export function buildExpiredApprovalView(request: ApprovalRequest): ExpiredApprovalView {
  if (request.id.startsWith("plugin:")) {
    return buildPluginViewBase(request as PluginApprovalRequest, "expired");
  }
  return buildExecViewBase(request as ExecApprovalRequest, "expired");
}
