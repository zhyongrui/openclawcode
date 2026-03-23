import { createFeishuClient } from "../../extensions/feishu/src/client.js";
import type { FeishuDomain } from "../../extensions/feishu/src/types.js";

export interface FeishuQrOAuthCredentials {
  appId: string;
  appSecret: string;
  domain?: FeishuDomain;
}

export interface FeishuQrOAuthUserIdentity {
  openId: string;
  userId?: string;
}

type FeishuQrOAuthStatePayload = {
  bindingId: string;
  sig: string;
};

function normalizeAuthorizationBaseUrl(domain?: FeishuDomain): string {
  if (domain === "lark") {
    return "https://open.larksuite.com/open-apis/authen/v1/index";
  }
  return "https://open.feishu.cn/open-apis/authen/v1/index";
}

export function encodeFeishuQrOAuthState(params: FeishuQrOAuthStatePayload): string {
  return Buffer.from(JSON.stringify(params), "utf8").toString("base64url");
}

export function decodeFeishuQrOAuthState(
  value: string,
): FeishuQrOAuthStatePayload | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.bindingId !== "string" ||
      typeof parsed.sig !== "string"
    ) {
      return undefined;
    }
    const bindingId = parsed.bindingId.trim();
    const sig = parsed.sig.trim();
    if (!bindingId || !sig) {
      return undefined;
    }
    return {
      bindingId,
      sig,
    };
  } catch {
    return undefined;
  }
}

export function buildFeishuQrOAuthAuthorizeUrl(params: {
  credentials: FeishuQrOAuthCredentials;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(normalizeAuthorizationBaseUrl(params.credentials.domain));
  url.searchParams.set("app_id", params.credentials.appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeFeishuQrOAuthCode(params: {
  credentials: FeishuQrOAuthCredentials;
  code: string;
}): Promise<FeishuQrOAuthUserIdentity> {
  const client = createFeishuClient({
    appId: params.credentials.appId,
    appSecret: params.credentials.appSecret,
    domain: params.credentials.domain,
  });
  const response = await client.authen.accessToken.create({
    data: {
      grant_type: "authorization_code",
      code: params.code,
    },
  });
  if (response.code !== 0 || !response.data?.open_id) {
    throw new Error(response.msg || "failed to exchange Feishu OAuth code");
  }
  return {
    openId: response.data.open_id,
    userId: response.data.user_id || undefined,
  };
}
