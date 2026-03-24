import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../plugin-sdk/json-store.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

export type FeishuQrBindingState =
  | "pending-gateway-ready"
  | "ready-to-claim"
  | "claimed"
  | "expired";

export interface FeishuQrBindingSession {
  bindingId: string;
  channel: "feishu";
  accountId: string;
  createdAt: string;
  expiresAt: string;
  state: FeishuQrBindingState;
  source: "qr";
  claimSecret: string;
  claimedAt?: string;
  claimedByOpenId?: string;
  claimedByUserId?: string;
  pendingClaimOpenId?: string;
  pendingClaimUserId?: string;
  repoKey?: string;
  setupIntent?: string;
}

type FeishuQrBindingStore = {
  version: 1;
  sessions: FeishuQrBindingSession[];
};

function normalizeAccountId(value?: string): string {
  return value?.trim() || DEFAULT_ACCOUNT_ID;
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

export function resolveFeishuQrBindingStorePath(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return path.join(resolveEffectiveStateDir(params), "feishu-qr-binding-sessions.json");
}

function normalizeSession(raw: unknown): FeishuQrBindingSession | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<FeishuQrBindingSession>;
  if (
    candidate.channel !== "feishu" ||
    typeof candidate.bindingId !== "string" ||
    typeof candidate.accountId !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    typeof candidate.state !== "string" ||
    candidate.source !== "qr" ||
    typeof candidate.claimSecret !== "string"
  ) {
    return undefined;
  }
  const bindingId = candidate.bindingId.trim();
  const accountId = normalizeAccountId(candidate.accountId);
  const claimSecret = candidate.claimSecret.trim();
  if (!bindingId || !claimSecret) {
    return undefined;
  }
  return {
    bindingId,
    channel: "feishu",
    accountId,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    state:
      candidate.state === "pending-gateway-ready" ||
      candidate.state === "ready-to-claim" ||
      candidate.state === "claimed" ||
      candidate.state === "expired"
        ? candidate.state
        : "expired",
    source: "qr",
    claimSecret,
    claimedAt:
      typeof candidate.claimedAt === "string" && candidate.claimedAt.trim()
        ? candidate.claimedAt
        : undefined,
    claimedByOpenId:
      typeof candidate.claimedByOpenId === "string" && candidate.claimedByOpenId.trim()
        ? candidate.claimedByOpenId.trim()
        : undefined,
    claimedByUserId:
      typeof candidate.claimedByUserId === "string" && candidate.claimedByUserId.trim()
        ? candidate.claimedByUserId.trim()
        : undefined,
    pendingClaimOpenId:
      typeof candidate.pendingClaimOpenId === "string" && candidate.pendingClaimOpenId.trim()
        ? candidate.pendingClaimOpenId.trim()
        : undefined,
    pendingClaimUserId:
      typeof candidate.pendingClaimUserId === "string" && candidate.pendingClaimUserId.trim()
        ? candidate.pendingClaimUserId.trim()
        : undefined,
    repoKey:
      typeof candidate.repoKey === "string" && candidate.repoKey.trim()
        ? candidate.repoKey.trim()
        : undefined,
    setupIntent:
      typeof candidate.setupIntent === "string" && candidate.setupIntent.trim()
        ? candidate.setupIntent.trim()
        : undefined,
  };
}

function normalizeStore(raw: unknown): FeishuQrBindingStore {
  const candidate =
    raw && typeof raw === "object" ? (raw as Partial<FeishuQrBindingStore>) : undefined;
  const sessions = (Array.isArray(candidate?.sessions) ? candidate.sessions : [])
    .map((entry) => normalizeSession(entry))
    .filter((entry): entry is FeishuQrBindingSession => Boolean(entry));
  return {
    version: 1,
    sessions,
  };
}

async function loadStore(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuQrBindingStore> {
  const { value } = await readJsonFileWithFallback<FeishuQrBindingStore>(
    resolveFeishuQrBindingStorePath(params),
    {
      version: 1,
      sessions: [],
    },
  );
  return normalizeStore(value);
}

async function saveStore(
  store: FeishuQrBindingStore,
  params?: {
    stateDir?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await writeJsonFileAtomically(resolveFeishuQrBindingStorePath(params), store);
}

function isSessionExpired(session: FeishuQrBindingSession, nowMs = Date.now()): boolean {
  const expiresAtMs = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function buildClaimSignature(bindingId: string, claimSecret: string): string {
  return crypto.createHmac("sha256", claimSecret).update(bindingId).digest("hex");
}

export function buildFeishuQrBindingClaimUrl(params: {
  baseHttpUrl: string;
  session: Pick<FeishuQrBindingSession, "bindingId" | "claimSecret">;
}): string {
  const normalizedBase = `${params.baseHttpUrl.trim().replace(/\/+$/, "")}/`;
  const url = new URL(
    `/openclaw/bind/feishu/${encodeURIComponent(params.session.bindingId)}`,
    normalizedBase,
  );
  url.searchParams.set(
    "sig",
    buildClaimSignature(params.session.bindingId, params.session.claimSecret),
  );
  return url.toString();
}

export async function getActiveFeishuQrBindingSession(params?: {
  accountId?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuQrBindingSession | undefined> {
  const accountId = normalizeAccountId(params?.accountId);
  const store = await loadStore(params);
  const nowMs = Date.now();
  return store.sessions.find(
    (session) =>
      session.accountId === accountId &&
      (session.state === "pending-gateway-ready" || session.state === "ready-to-claim") &&
      !isSessionExpired(session, nowMs),
  );
}

export async function listFeishuQrBindingSessions(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuQrBindingSession[]> {
  return (await loadStore(params)).sessions.map((session) =>
    isSessionExpired(session) && session.state !== "claimed" ? { ...session, state: "expired" } : session,
  );
}

export async function getFeishuQrBindingSessionById(params: {
  bindingId: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuQrBindingSession | undefined> {
  const bindingId = params.bindingId.trim();
  if (!bindingId) {
    return undefined;
  }
  const store = await loadStore(params);
  return store.sessions.find((session) => session.bindingId === bindingId);
}

export function validateFeishuQrBindingClaim(params: {
  session: Pick<FeishuQrBindingSession, "bindingId" | "claimSecret" | "expiresAt" | "state">;
  signature?: string | null;
  nowMs?: number;
}): {
  ok: boolean;
  reason?: "missing-signature" | "invalid-signature" | "expired";
} {
  const signature = params.signature?.trim() ?? "";
  if (!signature) {
    return {
      ok: false,
      reason: "missing-signature",
    };
  }
  if (isSessionExpired(params.session as FeishuQrBindingSession, params.nowMs)) {
    return {
      ok: false,
      reason: "expired",
    };
  }
  const expected = buildClaimSignature(params.session.bindingId, params.session.claimSecret);
  const provided = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    provided.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(provided, expectedBuffer)
  ) {
    return {
      ok: false,
      reason: "invalid-signature",
    };
  }
  return {
    ok: true,
  };
}

async function updateSession(
  params: {
    bindingId: string;
    stateDir?: string;
    env?: NodeJS.ProcessEnv;
  },
  mutate: (session: FeishuQrBindingSession) => FeishuQrBindingSession,
): Promise<FeishuQrBindingSession | undefined> {
  const bindingId = params.bindingId.trim();
  if (!bindingId) {
    return undefined;
  }
  const store = await loadStore(params);
  const index = store.sessions.findIndex((session) => session.bindingId === bindingId);
  if (index < 0) {
    return undefined;
  }
  const current = store.sessions[index]!;
  const next = mutate(
    isSessionExpired(current) && current.state !== "claimed" ? { ...current, state: "expired" } : current,
  );
  store.sessions[index] = next;
  await saveStore(store, params);
  return next;
}

export async function markFeishuQrBindingSessionReadyToClaim(params: {
  bindingId: string;
  pendingClaimOpenId?: string;
  pendingClaimUserId?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuQrBindingSession | undefined> {
  const pendingClaimOpenId = params.pendingClaimOpenId?.trim() || undefined;
  const pendingClaimUserId = params.pendingClaimUserId?.trim() || undefined;
  return await updateSession(params, (session) => {
    if (session.state === "claimed" || session.state === "expired" || isSessionExpired(session)) {
      return isSessionExpired(session) && session.state !== "claimed"
        ? { ...session, state: "expired" }
        : session;
    }
    return {
      ...session,
      state: "ready-to-claim",
      pendingClaimOpenId: pendingClaimOpenId ?? session.pendingClaimOpenId,
      pendingClaimUserId: pendingClaimUserId ?? session.pendingClaimUserId,
    };
  });
}

export async function claimFeishuQrBindingSession(params: {
  bindingId: string;
  claimedByOpenId: string;
  claimedByUserId?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuQrBindingSession | undefined> {
  const claimedByOpenId = params.claimedByOpenId.trim();
  if (!claimedByOpenId) {
    throw new Error("claimedByOpenId is required");
  }
  return await updateSession(params, (session) => {
    if (isSessionExpired(session)) {
      return {
        ...session,
        state: "expired",
      };
    }
    const now = new Date().toISOString();
    return {
      ...session,
      state: "claimed",
      claimedAt: session.claimedAt ?? now,
      claimedByOpenId,
      claimedByUserId: params.claimedByUserId?.trim() || session.claimedByUserId,
      pendingClaimOpenId: undefined,
      pendingClaimUserId: undefined,
    };
  });
}

export async function createFeishuQrBindingSession(params: {
  accountId?: string;
  repoKey?: string;
  setupIntent?: string;
  ttlMs?: number;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ session: FeishuQrBindingSession; created: boolean }> {
  const accountId = normalizeAccountId(params.accountId);
  const existing = await getActiveFeishuQrBindingSession({
    accountId,
    stateDir: params.stateDir,
    env: params.env,
  });
  if (existing) {
    return {
      session: existing,
      created: false,
    };
  }

  const store = await loadStore(params);
  const now = new Date();
  const ttlMs = params.ttlMs ?? 10 * 60_000;
  const session: FeishuQrBindingSession = {
    bindingId: crypto.randomUUID(),
    channel: "feishu",
    accountId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    state: "pending-gateway-ready",
    source: "qr",
    claimSecret: crypto.randomBytes(24).toString("hex"),
    repoKey: params.repoKey?.trim() || undefined,
    setupIntent: params.setupIntent?.trim() || undefined,
  };
  const sessions = store.sessions
    .map((entry) =>
      isSessionExpired(entry) && entry.state !== "claimed"
        ? { ...entry, state: "expired" as const }
        : entry,
    )
    .concat(session);
  await saveStore(
    {
      version: 1,
      sessions,
    },
    params,
  );
  return {
    session,
    created: true,
  };
}
