import { formatCliCommand } from "../cli/command-format.js";
import type { PairingChannel } from "./pairing-store.js";

export function buildPairingReply(params: {
  channel: PairingChannel;
  idLine: string;
  code: string;
}): string {
  const { channel, idLine, code } = params;
  return [
    "OpenClaw: access not configured.",
    "",
    idLine,
    "",
    `Pairing code: ${code}`,
    "",
    "Ask the bot owner to approve with:",
    formatCliCommand(`openclaw pairing approve ${channel} ${code}`),
  ].join("\n");
}

export function buildPairingCommandRetryReply(params: {
  channel: PairingChannel;
  idLine: string;
  code: string;
  commandBody: string;
}): string {
  const { commandBody } = params;
  return [
    buildPairingReply(params),
    "",
    "This chat command is blocked until pairing is approved.",
    "After approval, resend:",
    commandBody,
  ].join("\n");
}
