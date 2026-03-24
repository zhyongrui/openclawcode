import type { OpenClawCodeChatopsRepoConfig } from "../integrations/openclaw-plugin/chatops.js";
import { discoverPreferredOperatorChatTarget } from "../operator-chat-targets/store.js";

export function isBindPendingNotifyTarget(target: string | undefined): boolean {
  const normalized = target?.trim().toLowerCase() ?? "";
  return normalized.startsWith("bind-pending:");
}

export function isCliOnlyNotifyTarget(target: string | undefined): boolean {
  const normalized = target?.trim().toLowerCase() ?? "";
  return normalized.startsWith("cli-only:");
}

export function isConcreteChatNotifyTarget(target: string | undefined): boolean {
  const trimmed = target?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return !isBindPendingNotifyTarget(trimmed) && !isCliOnlyNotifyTarget(trimmed);
}

export async function resolveConcreteChatNotifyTarget(params: {
  stateDir: string;
  repoConfig: Pick<OpenClawCodeChatopsRepoConfig, "notifyChannel" | "notifyTarget">;
}): Promise<
  | {
      notifyChannel: string;
      notifyTarget: string;
      source: "configured" | "operator-target";
    }
  | undefined
> {
  if (isConcreteChatNotifyTarget(params.repoConfig.notifyTarget)) {
    return {
      notifyChannel: params.repoConfig.notifyChannel,
      notifyTarget: params.repoConfig.notifyTarget.trim(),
      source: "configured",
    };
  }
  if (!isBindPendingNotifyTarget(params.repoConfig.notifyTarget)) {
    return undefined;
  }
  const discovered = await discoverPreferredOperatorChatTarget({
    stateDir: params.stateDir,
    requestedChannel: params.repoConfig.notifyChannel,
  });
  if (!discovered) {
    return undefined;
  }
  return {
    notifyChannel: discovered.channel,
    notifyTarget: discovered.target,
    source: "operator-target",
  };
}
