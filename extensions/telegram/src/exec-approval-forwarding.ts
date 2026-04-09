import {
  buildExecApprovalPendingReplyPayloadFromRequest,
} from "openclaw/plugin-sdk/approval-reply-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ExecApprovalRequest } from "openclaw/plugin-sdk/infra-runtime";
import { normalizeMessageChannel } from "openclaw/plugin-sdk/routing";
import { isTelegramExecApprovalClientEnabled } from "./exec-approvals.js";

export function shouldSuppressTelegramExecApprovalForwardingFallback(params: {
  cfg: OpenClawConfig;
  target: { channel: string; accountId?: string | null };
  request: ExecApprovalRequest;
}): boolean {
  const channel = normalizeMessageChannel(params.target.channel) ?? params.target.channel;
  if (channel !== "telegram") {
    return false;
  }
  const requestChannel = normalizeMessageChannel(params.request.request.turnSourceChannel ?? "");
  if (requestChannel !== "telegram") {
    return false;
  }
  const accountId =
    params.target.accountId?.trim() || params.request.request.turnSourceAccountId?.trim();
  return isTelegramExecApprovalClientEnabled({ cfg: params.cfg, accountId });
}

export function buildTelegramExecApprovalPendingPayload(params: {
  request: ExecApprovalRequest;
  nowMs: number;
}) {
  return buildExecApprovalPendingReplyPayloadFromRequest({
    request: params.request,
    nowMs: params.nowMs,
  });
}
