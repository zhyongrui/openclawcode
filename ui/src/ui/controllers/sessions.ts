import { toNumber } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionInspectResult, SessionsListResult, SessionsReattachResult } from "../types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const DEFAULT_DETACHED_RESUME_MESSAGE = "Continue from the latest background task state.";

export type SessionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  sessionsInspectKey: string | null;
  sessionsInspectLoading: boolean;
  sessionsInspectResult: SessionInspectResult | null;
  sessionsInspectError: string | null;
  sessionsInspectDraft: string;
  sessionsInspectActionLoading: boolean;
  sessionsInspectActionError: string | null;
  sessionsInspectActionStatus: string | null;
};

export async function subscribeSessions(state: SessionsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("sessions.subscribe", {});
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export async function loadSessions(
  state: SessionsState,
  overrides?: {
    activeMinutes?: number;
    limit?: number;
    includeGlobal?: boolean;
    includeUnknown?: boolean;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    const includeGlobal = overrides?.includeGlobal ?? state.sessionsIncludeGlobal;
    const includeUnknown = overrides?.includeUnknown ?? state.sessionsIncludeUnknown;
    const activeMinutes = overrides?.activeMinutes ?? toNumber(state.sessionsFilterActive, 0);
    const limit = overrides?.limit ?? toNumber(state.sessionsFilterLimit, 0);
    const params: Record<string, unknown> = {
      includeGlobal,
      includeUnknown,
    };
    if (activeMinutes > 0) {
      params.activeMinutes = activeMinutes;
    }
    if (limit > 0) {
      params.limit = limit;
    }
    const res = await state.client.request<SessionsListResult | undefined>("sessions.list", params);
    if (res) {
      state.sessionsResult = res;
    }
  } catch (err) {
    if (isMissingOperatorReadScopeError(err)) {
      state.sessionsResult = null;
      state.sessionsError = formatMissingOperatorReadScopeMessage("sessions");
    } else {
      state.sessionsError = String(err);
    }
  } finally {
    state.sessionsLoading = false;
  }
}

export async function patchSession(
  state: SessionsState,
  key: string,
  patch: {
    label?: string | null;
    thinkingLevel?: string | null;
    fastMode?: boolean | null;
    verboseLevel?: string | null;
    reasoningLevel?: string | null;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const params: Record<string, unknown> = { key };
  if ("label" in patch) {
    params.label = patch.label;
  }
  if ("thinkingLevel" in patch) {
    params.thinkingLevel = patch.thinkingLevel;
  }
  if ("fastMode" in patch) {
    params.fastMode = patch.fastMode;
  }
  if ("verboseLevel" in patch) {
    params.verboseLevel = patch.verboseLevel;
  }
  if ("reasoningLevel" in patch) {
    params.reasoningLevel = patch.reasoningLevel;
  }
  try {
    await state.client.request("sessions.patch", params);
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export async function loadSessionInspect(state: SessionsState, key: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const sessionKey = key.trim();
  if (!sessionKey) {
    return;
  }
  if (state.sessionsInspectLoading && state.sessionsInspectKey === sessionKey) {
    return;
  }
  state.sessionsInspectKey = sessionKey;
  state.sessionsInspectLoading = true;
  state.sessionsInspectError = null;
  try {
    const res = await state.client.request<SessionInspectResult>("sessions.inspect", {
      key: sessionKey,
    });
    state.sessionsInspectResult = res;
  } catch (err) {
    state.sessionsInspectResult = null;
    if (isMissingOperatorReadScopeError(err)) {
      state.sessionsInspectError = formatMissingOperatorReadScopeMessage("session inspect");
    } else {
      state.sessionsInspectError = String(err);
    }
  } finally {
    state.sessionsInspectLoading = false;
  }
}

export function clearSessionInspect(state: SessionsState) {
  state.sessionsInspectKey = null;
  state.sessionsInspectLoading = false;
  state.sessionsInspectResult = null;
  state.sessionsInspectError = null;
  state.sessionsInspectActionError = null;
  state.sessionsInspectActionStatus = null;
}

export async function sendSessionInspectFollowup(
  state: SessionsState,
  key: string,
  message: string,
) {
  if (!state.client || !state.connected || state.sessionsInspectActionLoading) {
    return;
  }
  const sessionKey = key.trim();
  if (!sessionKey) {
    return;
  }
  const resolvedMessage = message.trim() || DEFAULT_DETACHED_RESUME_MESSAGE;
  state.sessionsInspectActionLoading = true;
  state.sessionsInspectActionError = null;
  state.sessionsInspectActionStatus = null;
  try {
    await state.client.request("sessions.send", {
      key: sessionKey,
      message: resolvedMessage,
    });
    state.sessionsInspectDraft = "";
    state.sessionsInspectActionStatus = "Detached follow-up sent.";
    await loadSessionInspect(state, sessionKey);
  } catch (err) {
    state.sessionsInspectActionError = String(err);
  } finally {
    state.sessionsInspectActionLoading = false;
  }
}

export async function reattachSessionInspect(
  state: SessionsState,
  key: string,
  message: string,
) {
  if (!state.client || !state.connected || state.sessionsInspectActionLoading) {
    return null;
  }
  const sessionKey = key.trim();
  if (!sessionKey) {
    return null;
  }
  const resolvedMessage = message.trim() || DEFAULT_DETACHED_RESUME_MESSAGE;
  state.sessionsInspectActionLoading = true;
  state.sessionsInspectActionError = null;
  state.sessionsInspectActionStatus = null;
  try {
    const res = await state.client.request<SessionsReattachResult>("sessions.reattach", {
      key: sessionKey,
      message: resolvedMessage,
    });
    if (res.inspect) {
      state.sessionsInspectResult = res.inspect;
    } else {
      await loadSessionInspect(state, sessionKey);
    }
    state.sessionsInspectDraft = "";
    state.sessionsInspectActionStatus = "Session reattached in foreground.";
    return res;
  } catch (err) {
    state.sessionsInspectActionError = String(err);
    return null;
  } finally {
    state.sessionsInspectActionLoading = false;
  }
}

export async function deleteSessionsAndRefresh(
  state: SessionsState,
  keys: string[],
): Promise<string[]> {
  if (!state.client || !state.connected || keys.length === 0) {
    return [];
  }
  if (state.sessionsLoading) {
    return [];
  }
  const noun = keys.length === 1 ? "session" : "sessions";
  const confirmed = window.confirm(
    `Delete ${keys.length} ${noun}?\n\nThis will delete the session entries and archive their transcripts.`,
  );
  if (!confirmed) {
    return [];
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  const deleted: string[] = [];
  const deleteErrors: string[] = [];
  try {
    for (const key of keys) {
      try {
        await state.client.request("sessions.delete", { key, deleteTranscript: true });
        deleted.push(key);
      } catch (err) {
        deleteErrors.push(String(err));
      }
    }
  } finally {
    state.sessionsLoading = false;
  }
  if (deleted.length > 0) {
    await loadSessions(state);
  }
  if (deleteErrors.length > 0) {
    state.sessionsError = deleteErrors.join("; ");
  }
  return deleted;
}
