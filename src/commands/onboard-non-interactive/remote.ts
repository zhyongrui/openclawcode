import { formatCliCommand } from "../../cli/command-format.js";
import type { OpenClawConfig } from "../../config/config.js";
import { writeConfigFile } from "../../config/config.js";
import { logConfigUpdated } from "../../config/logging.js";
import { type RuntimeEnv, writeRuntimeJson } from "../../runtime.js";
import { applyWizardMetadata } from "../onboard-helpers.js";
import type { OnboardOptions } from "../onboard-types.js";

function formatChatCommandWithAlias(command: string): string {
  if (!command.startsWith("/occode-")) {
    return formatCliCommand(command);
  }
  const alias = command.replace(/^\/occode-/, "/occ-");
  return `${formatCliCommand(command)} (alias ${formatCliCommand(alias)})`;
}

export async function runNonInteractiveRemoteSetup(params: {
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  baseConfig: OpenClawConfig;
}) {
  const { opts, runtime, baseConfig } = params;
  const mode = "remote" as const;

  const remoteUrl = opts.remoteUrl?.trim();
  if (!remoteUrl) {
    runtime.error("Missing --remote-url for remote mode.");
    runtime.exit(1);
    return;
  }

  let nextConfig: OpenClawConfig = {
    ...baseConfig,
    gateway: {
      ...baseConfig.gateway,
      mode: "remote",
      remote: {
        url: remoteUrl,
        token: opts.remoteToken?.trim() || undefined,
      },
    },
  };
  nextConfig = applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);
  logConfigUpdated(runtime);

  const payload = {
    mode,
    remoteUrl,
    auth: opts.remoteToken ? "token" : "none",
    openClawCode: {
      bootstrapCommand: "openclaw code bootstrap --repo owner/repo --json",
      chatSetupCommand: "/occode-setup",
      remoteHostAuthCommand: "gh auth login",
      remoteHostNote:
        "Run OpenClaw Code bootstrap and GitHub auth on the remote host, or use a bound chat surface.",
    },
  };
  if (opts.json) {
    writeRuntimeJson(runtime, payload);
  } else {
    runtime.log(`Remote gateway: ${remoteUrl}`);
    runtime.log(`Auth: ${payload.auth}`);
    runtime.log(
      [
        "OpenClaw Code for this remote gateway must continue from the remote host or a bound chat.",
        `Remote host CLI: ${formatCliCommand(payload.openClawCode.bootstrapCommand)}`,
        `Chat path: ${formatChatCommandWithAlias(payload.openClawCode.chatSetupCommand)}`,
        `If GitHub auth is missing on the remote host, run ${formatCliCommand(payload.openClawCode.remoteHostAuthCommand)} there first.`,
      ].join("\n"),
    );
    runtime.log(
      `Tip: run \`${formatCliCommand("openclaw configure --section web")}\` to store your Brave API key for web_search. Docs: https://docs.openclaw.ai/tools/web`,
    );
  }
}
