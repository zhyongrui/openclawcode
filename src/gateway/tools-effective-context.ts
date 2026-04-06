import { resolveSessionAgentId } from "../agents/agent-scope.js";
import type { ResolveEffectiveToolInventoryParams } from "../agents/tools-effective-inventory.js";
import { resolveReplyToMode } from "../auto-reply/reply/reply-threading.js";
import { deliveryContextFromSession } from "../utils/delivery-context.js";
import { loadSessionEntry, resolveSessionModelRef } from "./session-utils.js";

export function resolveSessionToolsEffectiveInventoryParams(params: {
  sessionKey: string;
  requestedAgentId?: string;
  senderIsOwner: boolean;
}): ResolveEffectiveToolInventoryParams {
  const loaded = loadSessionEntry(params.sessionKey);
  if (!loaded.entry) {
    throw new Error(`unknown session key "${params.sessionKey}"`);
  }

  const sessionAgentId = resolveSessionAgentId({
    sessionKey: loaded.canonicalKey ?? params.sessionKey,
    config: loaded.cfg,
  });
  if (params.requestedAgentId && params.requestedAgentId !== sessionAgentId) {
    throw new Error(
      `agent id "${params.requestedAgentId}" does not match session agent "${sessionAgentId}"`,
    );
  }

  const delivery = deliveryContextFromSession(loaded.entry);
  const resolvedModel = resolveSessionModelRef(loaded.cfg, loaded.entry, sessionAgentId);
  return {
    cfg: loaded.cfg,
    agentId: sessionAgentId,
    sessionKey: params.sessionKey,
    senderIsOwner: params.senderIsOwner,
    modelProvider: resolvedModel.provider,
    modelId: resolvedModel.model,
    messageProvider:
      delivery?.channel ??
      loaded.entry.lastChannel ??
      loaded.entry.channel ??
      loaded.entry.origin?.provider,
    accountId: delivery?.accountId ?? loaded.entry.lastAccountId ?? loaded.entry.origin?.accountId,
    currentChannelId: delivery?.to,
    currentThreadTs:
      delivery?.threadId != null
        ? String(delivery.threadId)
        : loaded.entry.lastThreadId != null
          ? String(loaded.entry.lastThreadId)
          : loaded.entry.origin?.threadId != null
            ? String(loaded.entry.origin.threadId)
            : undefined,
    groupId: loaded.entry.groupId,
    groupChannel: loaded.entry.groupChannel,
    groupSpace: loaded.entry.space,
    replyToMode: resolveReplyToMode(
      loaded.cfg,
      delivery?.channel ??
        loaded.entry.lastChannel ??
        loaded.entry.channel ??
        loaded.entry.origin?.provider,
      delivery?.accountId ?? loaded.entry.lastAccountId ?? loaded.entry.origin?.accountId,
      loaded.entry.chatType ?? loaded.entry.origin?.chatType,
    ),
  };
}
