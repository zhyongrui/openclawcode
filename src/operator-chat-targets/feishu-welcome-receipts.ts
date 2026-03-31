import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../plugin-sdk/json-store.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

export type FeishuOperatorWelcomeReceipt = {
  accountId: string;
  openId: string;
  sentAt: string;
  source?: string;
};

type FeishuOperatorWelcomeReceiptStore = {
  version: 1;
  receipts: FeishuOperatorWelcomeReceipt[];
};

function normalizeAccountId(value?: string): string {
  return value?.trim() || DEFAULT_ACCOUNT_ID;
}

function normalizeOpenId(value: string): string {
  return value.trim();
}

function normalizeReceipt(
  raw: unknown,
  index: number,
): FeishuOperatorWelcomeReceipt | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<FeishuOperatorWelcomeReceipt>;
  if (typeof candidate.openId !== "string") {
    return undefined;
  }
  const accountId = normalizeAccountId(candidate.accountId);
  const openId = normalizeOpenId(candidate.openId);
  if (!openId) {
    return undefined;
  }
  return {
    accountId,
    openId,
    sentAt:
      typeof candidate.sentAt === "string" && candidate.sentAt.trim()
        ? candidate.sentAt
        : new Date(index).toISOString(),
    source: typeof candidate.source === "string" ? candidate.source.trim() || undefined : undefined,
  };
}

function normalizeStore(raw: unknown): FeishuOperatorWelcomeReceiptStore {
  const candidate =
    raw && typeof raw === "object"
      ? (raw as Partial<FeishuOperatorWelcomeReceiptStore>)
      : undefined;
  const deduped = new Map<string, FeishuOperatorWelcomeReceipt>();
  for (const [index, receipt] of (Array.isArray(candidate?.receipts) ? candidate.receipts : []).entries()) {
    const normalized = normalizeReceipt(receipt, index);
    if (!normalized) {
      continue;
    }
    deduped.set(`${normalized.accountId}\u0000${normalized.openId}`, normalized);
  }
  return {
    version: 1,
    receipts: [...deduped.values()],
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

function resolveFeishuOperatorWelcomeReceiptsPath(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return path.join(resolveEffectiveStateDir(params), "feishu-operator-welcome-receipts.json");
}

async function loadStore(params?: {
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuOperatorWelcomeReceiptStore> {
  const { value } = await readJsonFileWithFallback<FeishuOperatorWelcomeReceiptStore>(
    resolveFeishuOperatorWelcomeReceiptsPath(params),
    {
      version: 1,
      receipts: [],
    },
  );
  return normalizeStore(value);
}

async function saveStore(
  store: FeishuOperatorWelcomeReceiptStore,
  params?: {
    stateDir?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await writeJsonFileAtomically(resolveFeishuOperatorWelcomeReceiptsPath(params), store);
}

export async function getFeishuOperatorWelcomeReceipt(params: {
  accountId?: string;
  openId: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuOperatorWelcomeReceipt | undefined> {
  const accountId = normalizeAccountId(params.accountId);
  const openId = normalizeOpenId(params.openId);
  if (!openId) {
    return undefined;
  }
  return (await loadStore(params)).receipts.find(
    (receipt) => receipt.accountId === accountId && receipt.openId === openId,
  );
}

export async function hasFeishuOperatorWelcomeReceipt(params: {
  accountId?: string;
  openId: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  return Boolean(await getFeishuOperatorWelcomeReceipt(params));
}

export async function markFeishuOperatorWelcomeReceiptSent(params: {
  accountId?: string;
  openId: string;
  source?: string;
  sentAt?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FeishuOperatorWelcomeReceipt> {
  const accountId = normalizeAccountId(params.accountId);
  const openId = normalizeOpenId(params.openId);
  if (!openId) {
    throw new Error("openId is required");
  }

  const now = params.sentAt?.trim() || new Date().toISOString();
  const store = await loadStore(params);
  const key = `${accountId}\u0000${openId}`;
  const nextReceipt: FeishuOperatorWelcomeReceipt = {
    accountId,
    openId,
    sentAt: now,
    source: params.source?.trim() || undefined,
  };
  const existingIndex = store.receipts.findIndex(
    (receipt) => `${receipt.accountId}\u0000${receipt.openId}` === key,
  );
  if (existingIndex >= 0) {
    store.receipts[existingIndex] = nextReceipt;
  } else {
    store.receipts.push(nextReceipt);
  }
  await saveStore(store, params);
  return nextReceipt;
}
