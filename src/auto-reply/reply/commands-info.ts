import { listAgentIds, resolveSessionAgentId } from "../../agents/agent-scope.js";
import {
  resolveEffectiveToolInventory,
  resolveEffectiveToolInventoryDiff,
} from "../../agents/tools-effective-inventory.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import { logVerbose } from "../../globals.js";
import { resolveSessionToolsEffectiveInventoryParams } from "../../gateway/tools-effective-context.js";
import { listSkillCommandsForAgents } from "../skill-commands.js";
import {
  buildCommandsMessage,
  buildCommandsMessagePaginated,
  buildHelpMessage,
  buildToolsDiffMessage,
  buildToolsMessage,
} from "../status.js";
import { buildThreadingToolContext } from "./agent-runner-utils.js";
import { resolveChannelAccountId } from "./channel-context.js";
import { buildExportSessionReply } from "./commands-export-session.js";
import { buildStatusReply } from "./commands-status.js";
import type { CommandHandler } from "./commands-types.js";
import { extractExplicitGroupId } from "./group-id.js";
import { resolveReplyToMode } from "./reply-threading.js";
export { handleContextCommand } from "./commands-context-command.js";
export { handleWhoamiCommand } from "./commands-whoami.js";

export const handleHelpCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/help") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /help from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  return {
    shouldContinue: false,
    reply: { text: buildHelpMessage(params.cfg) },
  };
};

export const handleCommandsListCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/commands") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /commands from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const skillCommands =
    params.skillCommands ??
    listSkillCommandsForAgents({
      cfg: params.cfg,
      agentIds: params.agentId ? [params.agentId] : undefined,
    });
  const surface = params.ctx.Surface;
  const commandPlugin = surface ? getChannelPlugin(surface) : null;
  const paginated = buildCommandsMessagePaginated(params.cfg, skillCommands, {
    page: 1,
    surface,
  });
  const channelData = commandPlugin?.commands?.buildCommandsListChannelData?.({
    currentPage: paginated.currentPage,
    totalPages: paginated.totalPages,
    agentId: params.agentId,
  });
  if (channelData) {
    return {
      shouldContinue: false,
      reply: {
        text: paginated.text,
        channelData,
      },
    };
  }

  return {
    shouldContinue: false,
    reply: { text: buildCommandsMessage(params.cfg, skillCommands, { surface }) },
  };
};

export const handleToolsCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized.trim();
  const usage = "Usage: /tools [compact|verbose] | /tools compare <agent-id|session-key> [compact|verbose]";
  let verbose = false;
  let compareTarget: string | undefined;
  if (normalized === "/tools" || normalized === "/tools compact") {
    verbose = false;
  } else if (normalized === "/tools verbose") {
    verbose = true;
  } else if (normalized.startsWith("/tools compare ") || normalized.startsWith("/tools diff ")) {
    const prefix = normalized.startsWith("/tools compare ") ? "/tools compare " : "/tools diff ";
    const rawArgs = normalized.slice(prefix.length).trim();
    const parts = rawArgs.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return { shouldContinue: false, reply: { text: usage } };
    }
    const mode = parts.at(-1);
    if (mode === "verbose" || mode === "compact") {
      verbose = mode === "verbose";
      parts.pop();
    }
    if (parts.length !== 1) {
      return { shouldContinue: false, reply: { text: usage } };
    }
    compareTarget = parts[0];
  } else if (normalized.startsWith("/tools ")) {
    return { shouldContinue: false, reply: { text: usage } };
  } else {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /tools from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  try {
    const effectiveAccountId = resolveChannelAccountId({
      cfg: params.cfg,
      ctx: params.ctx,
      command: params.command,
    });
    const agentId =
      params.agentId ??
      resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg });
    const threadingContext = buildThreadingToolContext({
      sessionCtx: params.ctx,
      config: params.cfg,
      hasRepliedRef: undefined,
    });
    const result = resolveEffectiveToolInventory({
      cfg: params.cfg,
      agentId,
      sessionKey: params.sessionKey,
      workspaceDir: params.workspaceDir,
      agentDir: params.agentDir,
      modelProvider: params.provider,
      modelId: params.model,
      messageProvider: params.command.channel,
      senderIsOwner: params.command.senderIsOwner,
      senderId: params.command.senderId,
      senderName: params.ctx.SenderName,
      senderUsername: params.ctx.SenderUsername,
      senderE164: params.ctx.SenderE164,
      accountId: effectiveAccountId,
      currentChannelId: threadingContext.currentChannelId,
      currentThreadTs:
        typeof params.ctx.MessageThreadId === "string" ||
        typeof params.ctx.MessageThreadId === "number"
          ? String(params.ctx.MessageThreadId)
          : undefined,
      currentMessageId: threadingContext.currentMessageId,
      groupId: params.sessionEntry?.groupId ?? extractExplicitGroupId(params.ctx.From),
      groupChannel:
        params.sessionEntry?.groupChannel ?? params.ctx.GroupChannel ?? params.ctx.GroupSubject,
      groupSpace: params.sessionEntry?.space ?? params.ctx.GroupSpace,
      replyToMode: resolveReplyToMode(
        params.cfg,
        params.ctx.OriginatingChannel ?? params.ctx.Provider,
        effectiveAccountId,
        params.ctx.ChatType,
      ),
    });
    if (compareTarget) {
      let target;
      let targetLabel: string;
      if (compareTarget.includes(":")) {
        target = resolveEffectiveToolInventory(
          resolveSessionToolsEffectiveInventoryParams({
            sessionKey: compareTarget,
            senderIsOwner: params.command.senderIsOwner,
          }),
        );
        targetLabel = `Session ${compareTarget}`;
      } else {
        if (!listAgentIds(params.cfg).includes(compareTarget)) {
          return {
            shouldContinue: false,
            reply: { text: `Unknown agent id "${compareTarget}".` },
          };
        }
        target = resolveEffectiveToolInventory({
          cfg: params.cfg,
          agentId: compareTarget,
          sessionKey: params.sessionKey,
          workspaceDir: params.workspaceDir,
          agentDir: params.agentDir,
          modelProvider: params.provider,
          modelId: params.model,
          messageProvider: params.command.channel,
          senderIsOwner: params.command.senderIsOwner,
          senderId: params.command.senderId,
          senderName: params.ctx.SenderName,
          senderUsername: params.ctx.SenderUsername,
          senderE164: params.ctx.SenderE164,
          accountId: params.ctx.AccountId,
          currentChannelId: threadingContext.currentChannelId,
          currentThreadTs:
            typeof params.ctx.MessageThreadId === "string" ||
            typeof params.ctx.MessageThreadId === "number"
              ? String(params.ctx.MessageThreadId)
              : undefined,
          currentMessageId: threadingContext.currentMessageId,
          groupId: params.sessionEntry?.groupId ?? extractExplicitGroupId(params.ctx.From),
          groupChannel:
            params.sessionEntry?.groupChannel ?? params.ctx.GroupChannel ?? params.ctx.GroupSubject,
          groupSpace: params.sessionEntry?.space ?? params.ctx.GroupSpace,
          replyToMode: resolveReplyToMode(
            params.cfg,
            params.ctx.OriginatingChannel ?? params.ctx.Provider,
            params.ctx.AccountId,
            params.ctx.ChatType,
          ),
        });
        targetLabel = `Agent ${compareTarget}`;
      }
      return {
        shouldContinue: false,
        reply: {
          text: buildToolsDiffMessage(
            {
              base: result,
              target,
              diff: resolveEffectiveToolInventoryDiff({
                base: result,
                target,
              }),
            },
            {
              verbose,
              baseLabel: `Current session ${params.sessionKey}`,
              targetLabel,
            },
          ),
        },
      };
    }
    return {
      shouldContinue: false,
      reply: { text: buildToolsMessage(result, { verbose }) },
    };
  } catch (err) {
    const message = String(err);
    const text = message.includes("missing scope:")
      ? "You do not have permission to view available tools."
      : "Couldn't load available tools right now. Try again in a moment.";
    return {
      shouldContinue: false,
      reply: { text },
    };
  }
};

export const handleStatusCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const statusRequested =
    params.directives.hasStatusDirective || params.command.commandBodyNormalized === "/status";
  if (!statusRequested) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /status from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const reply = await buildStatusReply({
    cfg: params.cfg,
    command: params.command,
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    parentSessionKey: params.ctx.ParentSessionKey,
    sessionScope: params.sessionScope,
    provider: params.provider,
    model: params.model,
    contextTokens: params.contextTokens,
    resolvedThinkLevel: params.resolvedThinkLevel,
    resolvedVerboseLevel: params.resolvedVerboseLevel,
    resolvedReasoningLevel: params.resolvedReasoningLevel,
    resolvedElevatedLevel: params.resolvedElevatedLevel,
    resolveDefaultThinkingLevel: params.resolveDefaultThinkingLevel,
    isGroup: params.isGroup,
    defaultGroupActivation: params.defaultGroupActivation,
    mediaDecisions: params.ctx.MediaUnderstandingDecisions,
  });
  return { shouldContinue: false, reply };
};

export const handleExportSessionCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (
    normalized !== "/export-session" &&
    !normalized.startsWith("/export-session ") &&
    normalized !== "/export" &&
    !normalized.startsWith("/export ")
  ) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /export-session from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  return { shouldContinue: false, reply: await buildExportSessionReply(params) };
};
