#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getReplyFromConfig } from "./auto-reply/reply.js";
import { applyTemplate } from "./auto-reply/templating.js";
import { monitorWebChannel } from "./channel-web.js";
import { createDefaultDeps } from "./cli/deps.js";
import { promptYesNo } from "./cli/prompt.js";
import { waitForever } from "./cli/wait.js";
import { loadConfig } from "./config/config.js";
import {
  deriveSessionKey,
  loadSessionStore,
  resolveSessionKey,
  resolveStorePath,
  saveSessionStore,
} from "./config/sessions.js";
import { ensureBinary } from "./infra/binaries.js";
import { formatUncaughtError } from "./infra/errors.js";
import { isMainModule } from "./infra/is-main.js";
import {
  describePortOwner,
  ensurePortAvailable,
  handlePortError,
  PortInUseError,
} from "./infra/ports.js";
import { runCommandWithTimeout, runExec } from "./process/exec.js";
import { assertWebChannel, normalizeE164, toWhatsappJid } from "./utils.js";

export {
  assertWebChannel,
  applyTemplate,
  createDefaultDeps,
  deriveSessionKey,
  describePortOwner,
  ensureBinary,
  ensurePortAvailable,
  getReplyFromConfig,
  handlePortError,
  loadConfig,
  loadSessionStore,
  monitorWebChannel,
  normalizeE164,
  PortInUseError,
  promptYesNo,
  resolveSessionKey,
  resolveStorePath,
  runCommandWithTimeout,
  runExec,
  saveSessionStore,
  toWhatsappJid,
  waitForever,
};

const isMain = isMainModule({
  currentFile: fileURLToPath(import.meta.url),
});

if (isMain) {
  void import("./cli/run-main.js")
    .then(({ runCli }) => runCli(process.argv))
    .catch((err) => {
      console.error("[openclaw] CLI failed:", formatUncaughtError(err));
      process.exit(1);
    });
}
