import { listAgentIds } from "../../agents/agent-scope.js";
import {
  resolveEffectiveToolInventory,
  resolveEffectiveToolInventoryDiff,
} from "../../agents/tools-effective-inventory.js";
import { loadConfig } from "../../config/config.js";
import { ADMIN_SCOPE } from "../method-scopes.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateToolsDiffParams,
} from "../protocol/index.js";
import { resolveSessionToolsEffectiveInventoryParams } from "../tools-effective-context.js";
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const toolsDiffHandlers: GatewayRequestHandlers = {
  "tools.diff": ({ params, respond, client }) => {
    if (!validateToolsDiffParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tools.diff params: ${formatValidationErrors(validateToolsDiffParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const compareAgentId = resolveRequestedAgentIdOrRespondError({
      rawAgentId: "compareAgentId" in params ? params.compareAgentId : undefined,
      cfg,
      respond,
    });
    if (compareAgentId === null) {
      return;
    }
    let baseParams;
    try {
      baseParams = resolveSessionToolsEffectiveInventoryParams({
        sessionKey: params.sessionKey,
        senderIsOwner: Array.isArray(client?.connect?.scopes)
          ? client.connect.scopes.includes(ADMIN_SCOPE)
          : false,
      });
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, toErrorMessage(error)));
      return;
    }

    let targetParams;
    if ("compareSessionKey" in params) {
      try {
        targetParams = resolveSessionToolsEffectiveInventoryParams({
          sessionKey: params.compareSessionKey,
          senderIsOwner: baseParams.senderIsOwner === true,
        });
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, toErrorMessage(error)));
        return;
      }
    } else {
      targetParams = {
        ...baseParams,
        agentId: compareAgentId ?? baseParams.agentId,
      };
    }

    const base = resolveEffectiveToolInventory(baseParams);
    const target = resolveEffectiveToolInventory(targetParams);
    respond(
      true,
      {
        baseSessionKey: params.sessionKey,
        ...(compareAgentId ? { compareAgentId } : {}),
        ...("compareSessionKey" in params ? { compareSessionKey: params.compareSessionKey } : {}),
        base,
        target,
        diff: resolveEffectiveToolInventoryDiff({ base, target }),
      },
      undefined,
    );
  },
};
