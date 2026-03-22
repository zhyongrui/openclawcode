import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../plugin-sdk/json-store.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

export interface PreferredOperatorChatTarget {
  channel: string;
  accountId: string;
  target: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

type PreferredOperatorChatTargetStore = {
  version: 1;
  bindings: PreferredOperatorChatTarget[];
};

export type SetPreferredOperatorChatTargetResult =
  | {
      status: "created" | "updated" | "existing";
      binding: PreferredOperatorChatTarget;
    }
  | {
      status: "conflict";
      binding: PreferredOperatorChatTarget;
      attemptedTarget: string;
    };

function normalizeChannel(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAccountId(value?: string): string {
  return value?.trim() || DEFAULT_ACCOUNT_ID;
}

function normalizeTarget(value: string): string {
  return value.trim();
}

function normalizeBinding(
  raw: unknown,
  index: number,
): PreferredOperatorChatTarget | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<PreferredOperatorChatTarget>;
  if (
    typeof candidate.channel !== "string" ||
    typeof candidate.accountId !== "string" ||
    typeof candidate.target !== "string"
  ) {
    return undefined;
  }
  const channel = normalizeChannel(candidate.channel);
  const accountId = normalizeAccountId(candidate.accountId);
  const target = normalizeTarget(candidate.target);
  if (!channel || !accountId || !target) {
    return undefined;
  }
  const fallbackTimestamp = new Date(index).toISOString();
  return {
    channel,
    accountId,
    target,
    source: typeof candidate.source === "string" ? candidate.source.trim() || undefined : undefined,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : fallbackTimestamp,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim()
        ? candidate.updatedAt
        : typeof candidate.createdAt === "string" && candidate.createdAt.trim()
          ? candidate.createdAt
          : fallbackTimestamp,
  };
}

function normalizeStore(raw: unknown): PreferredOperatorChatTargetStore {
  const candidate =
    raw && typeof raw === "object" ? (raw as Partial<PreferredOperatorChatTargetStore>) : undefined;
  const deduped = new Map<string, PreferredOperatorChatTarget>();
  for (const [index, binding] of (Array.isArray(candidate?.bindings) ? candidate.bindings : []).entries()) {
    const normalized = normalizeBinding(binding, index);
    if (!normalized) {
      continue;
    }
    deduped.set(`${normalized.channel}\u0000${normalized.accountId}`, normalized);
  }
  return {
    version: 1,
    bindings: [...deduped.values()],
  };
}

function resolveEffectiveStateDir(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  if (params?.stateDir?.trim()) {
    return path.resolve(params.stateDir);
  }
  const env = params?.env ?? process.env;
  return resolveStateDir(env, () => resolveRequiredHomeDir(env, os.homedir));
}

export function resolvePreferredOperatorChatTargetsPath(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return path.join(resolveEffectiveStateDir(params), "operator-chat-targets.json");
}

async function loadStore(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PreferredOperatorChatTargetStore> {
  const { value } = await readJsonFileWithFallback<PreferredOperatorChatTargetStore>(
    resolvePreferredOperatorChatTargetsPath(params),
    {
      version: 1,
      bindings: [],
    },
  );
  return normalizeStore(value);
}

async function saveStore(
  store: PreferredOperatorChatTargetStore,
  params?: {
    stateDir?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await writeJsonFileAtomically(resolvePreferredOperatorChatTargetsPath(params), store);
}

export async function listPreferredOperatorChatTargets(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PreferredOperatorChatTarget[]> {
  return (await loadStore(params)).bindings;
}

export async function getPreferredOperatorChatTarget(params: {
  channel: string;
  accountId?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PreferredOperatorChatTarget | undefined> {
  const channel = normalizeChannel(params.channel);
  const accountId = normalizeAccountId(params.accountId);
  if (!channel) {
    return undefined;
  }
  return (await loadStore(params)).bindings.find(
    (binding) => binding.channel === channel && binding.accountId === accountId,
  );
}

export async function discoverPreferredOperatorChatTarget(params?: {
  requestedChannel?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PreferredOperatorChatTarget | undefined> {
  const bindings = (await loadStore(params)).bindings;
  if (bindings.length === 0) {
    return undefined;
  }
  const requestedChannel = params?.requestedChannel ? normalizeChannel(params.requestedChannel) : "";
  const matches = requestedChannel
    ? bindings.filter((binding) => binding.channel === requestedChannel)
    : bindings;
  const unique = Array.from(
    new Map(
      matches.map((binding) => [
        `${binding.channel}\u0000${binding.accountId}\u0000${binding.target}`,
        binding,
      ]),
    ).values(),
  );
  return unique.length === 1 ? unique[0] : undefined;
}

export async function setPreferredOperatorChatTarget(params: {
  channel: string;
  accountId?: string;
  target: string;
  source?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  replace?: boolean;
}): Promise<SetPreferredOperatorChatTargetResult> {
  const channel = normalizeChannel(params.channel);
  const accountId = normalizeAccountId(params.accountId);
  const target = normalizeTarget(params.target);
  if (!channel) {
    throw new Error("channel is required");
  }
  if (!target) {
    throw new Error("target is required");
  }

  const store = await loadStore(params);
  const key = `${channel}\u0000${accountId}`;
  const existingIndex = store.bindings.findIndex(
    (binding) => `${binding.channel}\u0000${binding.accountId}` === key,
  );
  const now = new Date().toISOString();
  const nextBinding: PreferredOperatorChatTarget = {
    channel,
    accountId,
    target,
    source: params.source?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  if (existingIndex < 0) {
    store.bindings.push(nextBinding);
    await saveStore(store, params);
    return {
      status: "created",
      binding: nextBinding,
    };
  }

  const existing = store.bindings[existingIndex];
  if (existing.target === target) {
    const updated: PreferredOperatorChatTarget = {
      ...existing,
      source: params.source?.trim() || existing.source,
      updatedAt: now,
    };
    store.bindings[existingIndex] = updated;
    await saveStore(store, params);
    return {
      status: "existing",
      binding: updated,
    };
  }

  if (!params.replace) {
    return {
      status: "conflict",
      binding: existing,
      attemptedTarget: target,
    };
  }

  const updated: PreferredOperatorChatTarget = {
    ...existing,
    target,
    source: params.source?.trim() || existing.source,
    updatedAt: now,
  };
  store.bindings[existingIndex] = updated;
  await saveStore(store, params);
  return {
    status: "updated",
    binding: updated,
  };
}
