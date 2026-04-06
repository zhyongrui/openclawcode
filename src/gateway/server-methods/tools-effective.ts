import { ADMIN_SCOPE } from "../method-scopes.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateToolsEffectiveParams,
} from "../protocol/index.js";
import { resolveSessionToolsEffectiveInventoryParams } from "../tools-effective-context.js";
import {
  listAgentIds,
  loadConfig,
  resolveEffectiveToolInventory,
} from "./tools-effective.runtime.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function resolveRequestedAgentIdOrRespondError(params: {
  rawAgentId: unknown;
  cfg: ReturnType<typeof loadConfig>;
  respond: RespondFn;
}) {
  const knownAgents = listAgentIds(params.cfg);
  const requestedAgentId = typeof params.rawAgentId === "string" ? params.rawAgentId.trim() : "";
  if (!requestedAgentId) {
    return undefined;
  }
  if (!knownAgents.includes(requestedAgentId)) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id "${requestedAgentId}"`),
    );
    return null;
  }
  return requestedAgentId;
}

export const toolsEffectiveHandlers: GatewayRequestHandlers = {
  "tools.effective": ({ params, respond, client }) => {
    if (!validateToolsEffectiveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tools.effective params: ${formatValidationErrors(validateToolsEffectiveParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const requestedAgentId = resolveRequestedAgentIdOrRespondError({
      rawAgentId: params.agentId,
      cfg,
      respond,
    });
    if (requestedAgentId === null) {
      return;
    }
    let trustedContext;
    try {
      trustedContext = resolveSessionToolsEffectiveInventoryParams({
        sessionKey: params.sessionKey,
        requestedAgentId,
        senderIsOwner: Array.isArray(client?.connect?.scopes)
          ? client.connect.scopes.includes(ADMIN_SCOPE)
          : false,
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
      return;
    }
    respond(
      true,
      resolveEffectiveToolInventory(trustedContext),
      undefined,
    );
  },
};
