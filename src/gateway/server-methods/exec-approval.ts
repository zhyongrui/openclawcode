import {
  resolveExecApprovalCommandDisplay,
} from "../../infra/exec-approval-command-display.js";
import type { ExecApprovalForwarder } from "../../infra/exec-approval-forwarder.js";
import {
  DEFAULT_EXEC_APPROVAL_TIMEOUT_MS,
  resolveExecApprovalAllowedDecisions,
  resolveExecApprovalRequestAllowedDecisions,
  type ExecApprovalDecision,
  type ExecApprovalRequest,
  type ExecApprovalResolved,
} from "../../infra/exec-approvals.js";
import {
  buildExecApprovalRequestPayload,
  resolveExecApprovalEffectiveRequest,
} from "../../infra/exec-approval-effective-request.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import type { ExecApprovalManager } from "../exec-approval-manager.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateExecApprovalGetParams,
  validateExecApprovalRequestParams,
  validateExecApprovalResolveParams,
} from "../protocol/index.js";
import {
  handleApprovalWaitDecision,
  handlePendingApprovalRequest,
  handleApprovalResolve,
  isApprovalDecision,
  respondPendingApprovalLookupError,
  resolvePendingApprovalRecord,
} from "./approval-shared.js";
import type { GatewayRequestHandlers } from "./types.js";

const APPROVAL_ALLOW_ALWAYS_UNAVAILABLE_DETAILS = {
  reason: "APPROVAL_ALLOW_ALWAYS_UNAVAILABLE",
} as const;
const RESERVED_PLUGIN_APPROVAL_ID_PREFIX = "plugin:";

type ExecApprovalIosPushDelivery = {
  handleRequested?: (request: ExecApprovalRequest) => Promise<boolean>;
  handleResolved?: (resolved: ExecApprovalResolved) => Promise<void>;
  handleExpired?: (request: ExecApprovalRequest) => Promise<void>;
};

export function createExecApprovalHandlers(
  manager: ExecApprovalManager,
  opts?: { forwarder?: ExecApprovalForwarder; iosPushDelivery?: ExecApprovalIosPushDelivery },
): GatewayRequestHandlers {
  return {
    "exec.approval.get": async ({ params, respond }) => {
      if (!validateExecApprovalGetParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid exec.approval.get params: ${formatValidationErrors(
              validateExecApprovalGetParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string };
      const resolved = resolvePendingApprovalRecord({
        manager,
        inputId: p.id,
        exposeAmbiguousPrefixError: true,
      });
      if (!resolved.ok) {
        respondPendingApprovalLookupError({ respond, response: resolved.response });
        return;
      }
      const { commandText, commandPreview } = resolveExecApprovalCommandDisplay(
        resolved.snapshot.request,
      );
      respond(
        true,
        {
          id: resolved.approvalId,
          commandText,
          commandPreview,
          allowedDecisions: resolveExecApprovalRequestAllowedDecisions(resolved.snapshot.request),
          host: resolved.snapshot.request.host ?? null,
          nodeId: resolved.snapshot.request.nodeId ?? null,
          agentId: resolved.snapshot.request.agentId ?? null,
          expiresAtMs: resolved.snapshot.expiresAtMs,
        },
        undefined,
      );
    },
    "exec.approval.list": async ({ respond }) => {
      respond(
        true,
        manager.listPendingRecords().map((record) => ({
          id: record.id,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        })),
        undefined,
      );
    },
    "exec.approval.request": async ({ params, respond, context, client }) => {
      if (!validateExecApprovalRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid exec.approval.request params: ${formatValidationErrors(
              validateExecApprovalRequestParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as {
        id?: string;
        command: string;
        commandArgv?: string[];
        env?: Record<string, string>;
        cwd?: string;
        systemRunPlan?: unknown;
        nodeId?: string;
        host?: string;
        security?: string;
        ask?: string;
        agentId?: string;
        resolvedPath?: string;
        sessionKey?: string;
        turnSourceChannel?: string;
        turnSourceTo?: string;
        turnSourceAccountId?: string;
        turnSourceThreadId?: string | number;
        timeoutMs?: number;
        twoPhase?: boolean;
      };
      const twoPhase = p.twoPhase === true;
      const timeoutMs =
        typeof p.timeoutMs === "number" ? p.timeoutMs : DEFAULT_EXEC_APPROVAL_TIMEOUT_MS;
      const explicitId = normalizeOptionalString(p.id) ?? null;
      const effectiveRequest = resolveExecApprovalEffectiveRequest({
        host: p.host,
        nodeId: p.nodeId,
        command: p.command,
        commandArgv: p.commandArgv,
        systemRunPlan: p.systemRunPlan,
        cwd: p.cwd,
        agentId: p.agentId,
        sessionKey: p.sessionKey,
      });
      if (!effectiveRequest.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, effectiveRequest.message),
        );
        return;
      }
      if (explicitId?.startsWith(RESERVED_PLUGIN_APPROVAL_ID_PREFIX)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `approval ids starting with ${RESERVED_PLUGIN_APPROVAL_ID_PREFIX} are reserved`,
          ),
        );
        return;
      }
      if (explicitId && manager.getSnapshot(explicitId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "approval id already pending"),
        );
        return;
      }
      const request = buildExecApprovalRequestPayload({
        effective: effectiveRequest.effective,
        env: p.env,
        security: p.security,
        ask: p.ask,
        allowedDecisions: resolveExecApprovalAllowedDecisions({ ask: p.ask ?? null }),
        resolvedPath: p.resolvedPath,
        turnSourceChannel: p.turnSourceChannel,
        turnSourceTo: p.turnSourceTo,
        turnSourceAccountId: p.turnSourceAccountId,
        turnSourceThreadId: p.turnSourceThreadId,
      });
      const record = manager.create(request, timeoutMs, explicitId);
      record.requestedByConnId = client?.connId ?? null;
      record.requestedByDeviceId = client?.connect?.device?.id ?? null;
      record.requestedByClientId = client?.connect?.client?.id ?? null;
      // Use register() to synchronously add to pending map before sending any response.
      // This ensures the approval ID is valid immediately after the "accepted" response.
      let decisionPromise: Promise<
        import("../../infra/exec-approvals.js").ExecApprovalDecision | null
      >;
      try {
        decisionPromise = manager.register(record, timeoutMs);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `registration failed: ${String(err)}`),
        );
        return;
      }
      const requestEvent: ExecApprovalRequest = {
        id: record.id,
        request: record.request,
        createdAtMs: record.createdAtMs,
        expiresAtMs: record.expiresAtMs,
      };
      await handlePendingApprovalRequest({
        manager,
        record,
        decisionPromise,
        respond,
        context,
        clientConnId: client?.connId,
        requestEventName: "exec.approval.requested",
        requestEvent,
        twoPhase,
        deliverRequest: () => {
          const deliveryTasks: Array<Promise<boolean>> = [];
          if (opts?.forwarder) {
            deliveryTasks.push(
              opts.forwarder.handleRequested(requestEvent).catch((err) => {
                context.logGateway?.error?.(
                  `exec approvals: forward request failed: ${String(err)}`,
                );
                return false;
              }),
            );
          }
          if (opts?.iosPushDelivery?.handleRequested) {
            deliveryTasks.push(
              opts.iosPushDelivery.handleRequested(requestEvent).catch((err) => {
                context.logGateway?.error?.(
                  `exec approvals: iOS push request failed: ${String(err)}`,
                );
                return false;
              }),
            );
          }
          if (deliveryTasks.length === 0) {
            return false;
          }
          return (async () => {
            let delivered = false;
            for (const task of deliveryTasks) {
              delivered = (await task) || delivered;
            }
            return delivered;
          })();
        },
        afterDecision: async (decision) => {
          if (decision === null) {
            await opts?.iosPushDelivery?.handleExpired?.(requestEvent);
          }
        },
        afterDecisionErrorLabel: "exec approvals: iOS push expire failed",
      });
    },
    "exec.approval.waitDecision": async ({ params, respond }) => {
      await handleApprovalWaitDecision({
        manager,
        inputId: (params as { id?: string }).id,
        respond,
      });
    },
    "exec.approval.resolve": async ({ params, respond, client, context }) => {
      if (!validateExecApprovalResolveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid exec.approval.resolve params: ${formatValidationErrors(
              validateExecApprovalResolveParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string; decision: string };
      if (!isApprovalDecision(p.decision)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid decision"));
        return;
      }
      const decision: ExecApprovalDecision = p.decision;
      await handleApprovalResolve({
        manager,
        inputId: p.id,
        decision,
        respond,
        context,
        client,
        exposeAmbiguousPrefixError: true,
        validateDecision: (snapshot) => {
          const allowedDecisions = resolveExecApprovalRequestAllowedDecisions(snapshot.request);
          return allowedDecisions.includes(decision)
            ? null
            : {
                message:
                  "allow-always is unavailable because the effective policy requires approval every time",
                details: APPROVAL_ALLOW_ALWAYS_UNAVAILABLE_DETAILS,
              };
        },
        resolvedEventName: "exec.approval.resolved",
        buildResolvedEvent: ({ approvalId, decision, resolvedBy, snapshot, nowMs }) =>
          ({
            id: approvalId,
            decision,
            resolvedBy,
            ts: nowMs,
            request: snapshot.request,
          }) satisfies ExecApprovalResolved,
        forwardResolved: (resolvedEvent) => opts?.forwarder?.handleResolved(resolvedEvent),
        forwardResolvedErrorLabel: "exec approvals: forward resolve failed",
        extraResolvedHandlers: opts?.iosPushDelivery?.handleResolved
          ? [
              {
                run: (resolvedEvent) => opts.iosPushDelivery!.handleResolved!(resolvedEvent),
                errorLabel: "exec approvals: iOS push resolve failed",
              },
            ]
          : undefined,
      });
    },
  };
}
