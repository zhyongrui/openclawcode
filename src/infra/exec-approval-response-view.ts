import { resolveExecApprovalCommandDisplay } from "./exec-approval-command-display.js";
import {
  resolveExecApprovalRequestAllowedDecisions,
  type ExecApprovalRequest,
} from "./exec-approvals.js";

export type ExecApprovalResponseView = {
  id: string;
  commandText: string;
  commandPreview: string | null;
  allowedDecisions: readonly ("allow-once" | "allow-always" | "deny")[];
  host: string | null;
  nodeId: string | null;
  agentId: string | null;
  cwd: string | null;
  envKeys?: string[];
  resolvedPath: string | null;
  sessionKey: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

export function buildExecApprovalResponseView(
  request: ExecApprovalRequest,
): ExecApprovalResponseView {
  const { commandText, commandPreview } = resolveExecApprovalCommandDisplay(request.request);
  return {
    id: request.id,
    commandText,
    commandPreview,
    allowedDecisions: resolveExecApprovalRequestAllowedDecisions(request.request),
    host: request.request.host ?? null,
    nodeId: request.request.nodeId ?? null,
    agentId: request.request.agentId ?? null,
    cwd: request.request.cwd ?? null,
    envKeys: request.request.envKeys,
    resolvedPath: request.request.resolvedPath ?? null,
    sessionKey: request.request.sessionKey ?? null,
    createdAtMs: request.createdAtMs,
    expiresAtMs: request.expiresAtMs,
  };
}
