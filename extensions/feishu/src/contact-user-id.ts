import type { ClawdbotConfig } from "../runtime-api.js";
import { resolveFeishuAccount } from "./accounts.js";
import { createFeishuClient } from "./client.js";

type FeishuBatchGetIdClient = {
  contact: {
    user: {
      batchGetId: (payload?: {
        data?: {
          emails?: string[];
          mobiles?: string[];
          include_resigned?: boolean;
        };
        params?: {
          user_id_type?: "open_id" | "union_id" | "user_id";
        };
      }) => Promise<{
        code?: number;
        msg?: string;
        data?: {
          user_list?: Array<{
            user_id?: string;
            email?: string;
            mobile?: string;
          }>;
        };
      }>;
    };
  };
};

export type ResolvedFeishuContactUserId = {
  openId: string;
  matchedBy: "email" | "mobile";
  matchedValue: string;
};

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function normalizeMobile(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveFeishuUserOpenIdByContact(
  params: {
    cfg: ClawdbotConfig;
    accountId?: string;
    email?: string;
    mobile?: string;
  },
  deps?: {
    createClient?: (params: {
      accountId?: string;
      appId?: string;
      appSecret?: string;
      domain?: string;
      config?: { httpTimeoutMs?: number };
    }) => FeishuBatchGetIdClient;
  },
): Promise<ResolvedFeishuContactUserId> {
  const email = normalizeEmail(params.email);
  const mobile = normalizeMobile(params.mobile);
  if (!email && !mobile) {
    throw new Error("Feishu contact binding requires email or mobile.");
  }

  const account = resolveFeishuAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  if (!account.configured || !account.appId || !account.appSecret) {
    throw new Error(`Feishu credentials are not configured for account "${account.accountId}".`);
  }

  const client = (deps?.createClient ?? createFeishuClient)({
    accountId: account.accountId,
    appId: account.appId,
    appSecret: account.appSecret,
    domain: account.domain,
    config: account.config,
  });

  const response = await client.contact.user.batchGetId({
    data: {
      ...(email ? { emails: [email] } : {}),
      ...(mobile ? { mobiles: [mobile] } : {}),
    },
    params: {
      user_id_type: "open_id",
    },
  });
  if (response.code !== 0) {
    throw new Error(`Feishu contact lookup failed: ${response.msg || `code ${response.code}`}`);
  }

  const userList = Array.isArray(response.data?.user_list) ? response.data.user_list : [];
  const emailMatch =
    email == null
      ? undefined
      : userList.find(
          (entry) =>
            normalizeEmail(typeof entry.email === "string" ? entry.email : undefined) === email &&
            typeof entry.user_id === "string" &&
            entry.user_id.trim(),
        );
  if (emailMatch?.user_id?.trim()) {
    return {
      openId: emailMatch.user_id.trim(),
      matchedBy: "email",
      matchedValue: email,
    };
  }

  const mobileMatch =
    mobile == null
      ? undefined
      : userList.find(
          (entry) =>
            normalizeMobile(typeof entry.mobile === "string" ? entry.mobile : undefined) ===
              mobile &&
            typeof entry.user_id === "string" &&
            entry.user_id.trim(),
        );
  if (mobileMatch?.user_id?.trim()) {
    return {
      openId: mobileMatch.user_id.trim(),
      matchedBy: "mobile",
      matchedValue: mobile,
    };
  }

  const requestedContact = email ? `email ${email}` : `mobile ${mobile}`;
  throw new Error(`No Feishu user ID found for ${requestedContact}.`);
}
