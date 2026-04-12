import type {
  ApprovalMetadataView,
  ApprovalRequest,
  ApprovalResolved,
  ExecApprovalViewBase,
  ExpiredApprovalView,
  PendingApprovalView,
  PluginApprovalViewBase,
  ResolvedApprovalView,
} from "./approval-view-model.types.js";
import { buildExecApprovalActionDescriptors } from "./exec-approval-reply.js";
import { buildExecApprovalResponseView } from "./exec-approval-response-view.js";
import type { ExecApprovalRequest } from "./exec-approvals.js";
import type { PluginApprovalRequest } from "./plugin-approvals.js";

type ApprovalPhase = "pending" | "resolved" | "expired";

function buildExecMetadata(
  view: ReturnType<typeof buildExecApprovalResponseView>,
): ApprovalMetadataView[] {
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
  const responseView = buildExecApprovalResponseView(execRequest);
  return {
    ...buildExecViewBase(execRequest, "pending"),
    actions: buildExecApprovalActionDescriptors({
      approvalCommandId: execRequest.id,
      ask: execRequest.request.ask,
      allowedDecisions: responseView.allowedDecisions,
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
