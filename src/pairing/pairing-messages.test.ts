import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { buildPairingCommandRetryReply, buildPairingReply } from "./pairing-messages.js";

describe("buildPairingReply", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["OPENCLAW_PROFILE"]);
    process.env.OPENCLAW_PROFILE = "isolated";
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  const cases = [
    {
      channel: "telegram",
      idLine: "Your Telegram user id: 42",
      code: "QRS678",
    },
    {
      channel: "discord",
      idLine: "Your Discord user id: 1",
      code: "ABC123",
    },
    {
      channel: "slack",
      idLine: "Your Slack user id: U1",
      code: "DEF456",
    },
    {
      channel: "signal",
      idLine: "Your Signal number: +15550001111",
      code: "GHI789",
    },
    {
      channel: "imessage",
      idLine: "Your iMessage sender id: +15550002222",
      code: "JKL012",
    },
    {
      channel: "whatsapp",
      idLine: "Your WhatsApp phone number: +15550003333",
      code: "MNO345",
    },
  ] as const;

  for (const testCase of cases) {
    it(`formats pairing reply for ${testCase.channel}`, () => {
      const text = buildPairingReply(testCase);
      expect(text).toContain(testCase.idLine);
      expect(text).toContain(`Pairing code: ${testCase.code}`);
      // CLI commands should respect OPENCLAW_PROFILE when set (most tests run with isolated profile)
      const commandRe = new RegExp(
        `(?:openclaw|openclaw) --profile isolated pairing approve ${testCase.channel} ${testCase.code}`,
      );
      expect(text).toMatch(commandRe);
    });
  }

  it("formats a retry hint for blocked chat commands", () => {
    const text = buildPairingCommandRetryReply({
      channel: "feishu",
      idLine: "Your Feishu user id: ou-123",
      code: "ABCDEFGH",
      commandBody: "/occode-setup",
    });

    expect(text).toContain("OpenClaw: access not configured.");
    expect(text).toContain("Pairing code: ABCDEFGH");
    expect(text).toContain("This chat command is blocked until pairing is approved.");
    expect(text).toContain("After approval, resend:");
    expect(text).toContain("/occode-setup");
  });
});
