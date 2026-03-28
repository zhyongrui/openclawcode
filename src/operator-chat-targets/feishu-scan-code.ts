import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { withFileLock } from "../infra/file-lock.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../plugin-sdk/json-store.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

const FEISHU_SCAN_CODE_LENGTH = 6;
const FEISHU_SCAN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FEISHU_SCAN_CODE_TTL_MS = 30 * 60 * 1000;
const FEISHU_SCAN_CODE_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 10_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

export type FeishuOperatorScanCodeBinding = {
  accountId: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  claimedByOpenId?: string;
  claimedAt?: string;
};

type FeishuOperatorScanCodeStore = {
  version: 1;
  bindings: FeishuOperatorScanCodeBinding[];
};

type FeishuTransportReadyStore = {
  version: 1;
  accounts: Array<{
    accountId: string;
    readyAt: string;
  }>;
};

export type ClaimFeishuOperatorScanCodeResult =
  | {
      status: "claimed";
      binding: FeishuOperatorScanCodeBinding;
    }
  | {
      status: "missing" | "mismatch" | "expired" | "already-claimed";
      binding?: FeishuOperatorScanCodeBinding;
    };

function normalizeAccountId(value?: string): string {
  return value?.trim() || DEFAULT_ACCOUNT_ID;
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isExpired(binding: FeishuOperatorScanCodeBinding, nowMs: number): boolean {
  const expiresAt = parseTimestamp(binding.expiresAt);
  if (expiresAt == null) {
    return true;
  }
  return nowMs >= expiresAt;
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

export function resolveFeishuOperatorScanCodesPath(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return path.join(resolveEffectiveStateDir(params), "feishu-operator-scan-codes.json");
}

function resolveFeishuTransportReadyPath(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return path.join(resolveEffectiveStateDir(params), "feishu-transport-ready.json");
}

function normalizeBinding(
  raw: unknown,
  index: number,
): FeishuOperatorScanCodeBinding | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<FeishuOperatorScanCodeBinding>;
  if (typeof candidate.code !== "string") {
    return undefined;
  }
  const accountId = normalizeAccountId(candidate.accountId);
  const code = normalizeCode(candidate.code);
  if (!code) {
    return undefined;
  }
  const fallbackTimestamp = new Date(index).toISOString();
  return {
    accountId,
    code,
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
    expiresAt:
      typeof candidate.expiresAt === "string" && candidate.expiresAt.trim()
        ? candidate.expiresAt
        : new Date(Date.parse(fallbackTimestamp) + FEISHU_SCAN_CODE_TTL_MS).toISOString(),
    claimedByOpenId:
      typeof candidate.claimedByOpenId === "string" && candidate.claimedByOpenId.trim()
        ? candidate.claimedByOpenId.trim()
        : undefined,
    claimedAt:
      typeof candidate.claimedAt === "string" && candidate.claimedAt.trim()
        ? candidate.claimedAt
        : undefined,
  };
}

function normalizeStore(raw: unknown): FeishuOperatorScanCodeStore {
  const candidate =
    raw && typeof raw === "object" ? (raw as Partial<FeishuOperatorScanCodeStore>) : undefined;
  const deduped = new Map<string, FeishuOperatorScanCodeBinding>();
  for (const [index, binding] of (Array.isArray(candidate?.bindings) ? candidate.bindings : []).entries()) {
    const normalized = normalizeBinding(binding, index);
    if (!normalized) {
      continue;
    }
    deduped.set(normalized.accountId, normalized);
  }
  return {
    version: 1,
    bindings: [...deduped.values()],
  };
}

async function loadStore(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuOperatorScanCodeStore> {
  const { value } = await readJsonFileWithFallback<FeishuOperatorScanCodeStore>(
    resolveFeishuOperatorScanCodesPath(params),
    {
      version: 1,
      bindings: [],
    },
  );
  return normalizeStore(value);
}

async function saveStore(
  store: FeishuOperatorScanCodeStore,
  params?: {
    stateDir?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await writeJsonFileAtomically(resolveFeishuOperatorScanCodesPath(params), store);
}

async function loadTransportReadyStore(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuTransportReadyStore> {
  const { value } = await readJsonFileWithFallback<FeishuTransportReadyStore>(
    resolveFeishuTransportReadyPath(params),
    {
      version: 1,
      accounts: [],
    },
  );
  const accounts = Array.isArray(value.accounts) ? value.accounts : [];
  return {
    version: 1,
    accounts: accounts
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return undefined;
        }
        const candidate = entry as { accountId?: unknown; readyAt?: unknown };
        const accountId = normalizeAccountId(
          typeof candidate.accountId === "string" ? candidate.accountId : undefined,
        );
        const readyAt =
          typeof candidate.readyAt === "string" && candidate.readyAt.trim()
            ? candidate.readyAt
            : undefined;
        return readyAt ? { accountId, readyAt } : undefined;
      })
      .filter((entry): entry is { accountId: string; readyAt: string } => Boolean(entry)),
  };
}

async function saveTransportReadyStore(
  store: FeishuTransportReadyStore,
  params?: {
    stateDir?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await writeJsonFileAtomically(resolveFeishuTransportReadyPath(params), store);
}

function pruneStore(
  store: FeishuOperatorScanCodeStore,
  nowMs: number,
): FeishuOperatorScanCodeStore {
  return {
    version: 1,
    bindings: store.bindings.filter(
      (binding) => !binding.claimedByOpenId && !isExpired(binding, nowMs),
    ),
  };
}

function randomCode(): string {
  let output = "";
  for (let index = 0; index < FEISHU_SCAN_CODE_LENGTH; index += 1) {
    output += FEISHU_SCAN_CODE_ALPHABET[crypto.randomInt(0, FEISHU_SCAN_CODE_ALPHABET.length)];
  }
  return output;
}

function generateUniqueCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = randomCode();
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error("failed to generate a unique Feishu scan code");
}

export async function getPendingFeishuOperatorScanCode(params: {
  accountId?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuOperatorScanCodeBinding | undefined> {
  const accountId = normalizeAccountId(params.accountId);
  const nowMs = Date.now();
  const store = pruneStore(await loadStore(params), nowMs);
  return store.bindings.find((binding) => binding.accountId === accountId);
}

export async function ensurePendingFeishuOperatorScanCode(params: {
  accountId?: string;
  ttlMs?: number;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuOperatorScanCodeBinding> {
  const accountId = normalizeAccountId(params.accountId);
  const filePath = resolveFeishuOperatorScanCodesPath(params);
  return await withFileLock(filePath, FEISHU_SCAN_CODE_LOCK_OPTIONS, async () => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const ttlMs = params.ttlMs && params.ttlMs > 0 ? params.ttlMs : FEISHU_SCAN_CODE_TTL_MS;
    const store = pruneStore(await loadStore(params), nowMs);
    const existing = store.bindings.find((binding) => binding.accountId === accountId);
    if (existing) {
      return existing;
    }
    const next: FeishuOperatorScanCodeBinding = {
      accountId,
      code: generateUniqueCode(new Set(store.bindings.map((binding) => binding.code))),
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
    };
    store.bindings.push(next);
    await saveStore(store, params);
    return next;
  });
}

export async function claimPendingFeishuOperatorScanCode(params: {
  accountId?: string;
  code: string;
  openId: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ClaimFeishuOperatorScanCodeResult> {
  const accountId = normalizeAccountId(params.accountId);
  const code = normalizeCode(params.code);
  const openId = params.openId.trim();
  if (!code || !openId) {
    return { status: "missing" };
  }
  const filePath = resolveFeishuOperatorScanCodesPath(params);
  return await withFileLock(filePath, FEISHU_SCAN_CODE_LOCK_OPTIONS, async () => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const store = await loadStore(params);
    const index = store.bindings.findIndex((binding) => binding.accountId === accountId);
    if (index < 0) {
      return { status: "missing" };
    }
    const current = store.bindings[index];
    if (current.claimedByOpenId) {
      return { status: "already-claimed", binding: current };
    }
    if (isExpired(current, nowMs)) {
      store.bindings = store.bindings.filter((binding) => binding.accountId !== accountId);
      await saveStore(store, params);
      return { status: "expired", binding: current };
    }
    if (current.code !== code) {
      return { status: "mismatch", binding: current };
    }
    const claimed: FeishuOperatorScanCodeBinding = {
      ...current,
      claimedByOpenId: openId,
      claimedAt: nowIso,
      updatedAt: nowIso,
    };
    store.bindings.splice(index, 1);
    await saveStore(store, params);
    return { status: "claimed", binding: claimed };
  });
}

export async function markFeishuTransportReady(params?: {
  accountId?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const accountId = normalizeAccountId(params?.accountId);
  const filePath = resolveFeishuTransportReadyPath(params);
  await withFileLock(filePath, FEISHU_SCAN_CODE_LOCK_OPTIONS, async () => {
    const store = await loadTransportReadyStore(params);
    const readyAt = new Date().toISOString();
    const existingIndex = store.accounts.findIndex((entry) => entry.accountId === accountId);
    if (existingIndex >= 0) {
      store.accounts[existingIndex] = { accountId, readyAt };
    } else {
      store.accounts.push({ accountId, readyAt });
    }
    await saveTransportReadyStore(store, params);
  });
}

export async function clearFeishuTransportReady(params?: {
  accountId?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const accountId = normalizeAccountId(params?.accountId);
  const filePath = resolveFeishuTransportReadyPath(params);
  await withFileLock(filePath, FEISHU_SCAN_CODE_LOCK_OPTIONS, async () => {
    const store = await loadTransportReadyStore(params);
    store.accounts = store.accounts.filter((entry) => entry.accountId !== accountId);
    await saveTransportReadyStore(store, params);
  });
}

export async function getFeishuTransportReady(params?: {
  accountId?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ accountId: string; readyAt: string } | undefined> {
  const accountId = normalizeAccountId(params?.accountId);
  const store = await loadTransportReadyStore(params);
  return store.accounts.find((entry) => entry.accountId === accountId);
}

export function buildFeishuBotOpenUrl(params: {
  appId: string;
  domain?: string;
}): string {
  const appId = params.appId.trim();
  const host =
    params.domain?.trim().toLowerCase() === "lark"
      ? "applink.larksuite.com"
      : "applink.feishu.cn";
  return `https://${host}/client/bot/open?appId=${encodeURIComponent(appId)}`;
}
