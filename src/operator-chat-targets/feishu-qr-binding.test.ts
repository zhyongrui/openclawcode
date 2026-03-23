import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildFeishuQrBindingClaimUrl,
  claimFeishuQrBindingSession,
  createFeishuQrBindingSession,
  getActiveFeishuQrBindingSession,
  getFeishuQrBindingSessionById,
  markFeishuQrBindingSessionReadyToClaim,
  validateFeishuQrBindingClaim,
} from "./feishu-qr-binding.js";

describe("feishu qr binding store", () => {
  it("creates and reuses an active binding session", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-bind-"));
    const first = await createFeishuQrBindingSession({
      stateDir,
      accountId: "default",
      setupIntent: "feishu-initial-bind",
    });

    expect(first.created).toBe(true);
    expect(first.session.state).toBe("pending-gateway-ready");

    const second = await createFeishuQrBindingSession({
      stateDir,
      accountId: "default",
    });

    expect(second.created).toBe(false);
    expect(second.session.bindingId).toBe(first.session.bindingId);
    await expect(
      getActiveFeishuQrBindingSession({
        stateDir,
        accountId: "default",
      }),
    ).resolves.toMatchObject({
      bindingId: first.session.bindingId,
    });
  });

  it("builds a signed claim url", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-url-"));
    const { session } = await createFeishuQrBindingSession({
      stateDir,
    });
    const url = buildFeishuQrBindingClaimUrl({
      baseHttpUrl: "http://127.0.0.1:18789/",
      session,
    });

    expect(url).toContain(`/openclaw/bind/feishu/${session.bindingId}`);
    expect(url).toContain("sig=");
  });

  it("validates signed claim urls and rejects tampering", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-validate-"));
    const { session } = await createFeishuQrBindingSession({
      stateDir,
    });
    const url = new URL(
      buildFeishuQrBindingClaimUrl({
        baseHttpUrl: "http://127.0.0.1:18789",
        session,
      }),
    );

    expect(
      validateFeishuQrBindingClaim({
        session,
        signature: url.searchParams.get("sig"),
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateFeishuQrBindingClaim({
        session,
        signature: "bad-signature",
      }),
    ).toMatchObject({ ok: false, reason: "invalid-signature" });
  });

  it("marks a session ready and then claimed", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-feishu-qr-claim-"));
    const { session } = await createFeishuQrBindingSession({
      stateDir,
    });

    await expect(
      markFeishuQrBindingSessionReadyToClaim({
        stateDir,
        bindingId: session.bindingId,
      }),
    ).resolves.toMatchObject({
      state: "ready-to-claim",
    });

    await expect(
      claimFeishuQrBindingSession({
        stateDir,
        bindingId: session.bindingId,
        claimedByOpenId: "ou_test_claimed",
        claimedByUserId: "u_test_claimed",
      }),
    ).resolves.toMatchObject({
      state: "claimed",
      claimedByOpenId: "ou_test_claimed",
      claimedByUserId: "u_test_claimed",
    });

    await expect(
      getFeishuQrBindingSessionById({
        stateDir,
        bindingId: session.bindingId,
      }),
    ).resolves.toMatchObject({
      state: "claimed",
      claimedByOpenId: "ou_test_claimed",
    });
  });
});
