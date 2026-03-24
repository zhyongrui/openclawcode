import { describe, expect, it } from "vitest";
import {
  buildFeishuQrOAuthAuthorizeUrl,
  decodeFeishuQrOAuthState,
  encodeFeishuQrOAuthState,
} from "./feishu-qr-oauth.js";

describe("feishu qr oauth helper", () => {
  it("encodes and decodes oauth state", () => {
    const state = encodeFeishuQrOAuthState({
      bindingId: "bind_123",
      sig: "sig_456",
    });

    expect(decodeFeishuQrOAuthState(state)).toEqual({
      bindingId: "bind_123",
      sig: "sig_456",
    });
  });

  it("builds a Feishu authorize url", () => {
    const url = new URL(
      buildFeishuQrOAuthAuthorizeUrl({
        credentials: {
          appId: "cli_app",
          appSecret: "secret",
          domain: "feishu",
        },
        redirectUri: "https://example.com/openclaw/bind/feishu/oauth/callback",
        state: "state_abc",
      }),
    );

    expect(url.origin).toBe("https://open.feishu.cn");
    expect(url.pathname).toBe("/open-apis/authen/v1/index");
    expect(url.searchParams.get("app_id")).toBe("cli_app");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.com/openclaw/bind/feishu/oauth/callback",
    );
    expect(url.searchParams.get("state")).toBe("state_abc");
  });
});
