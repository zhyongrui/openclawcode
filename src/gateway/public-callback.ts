import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveGatewayPort, resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.js";
import { runExec } from "../process/exec.js";
import { resolveGatewayBindUrl } from "../shared/gateway-bind-url.js";
import {
  resolveTailnetHostWithRunner,
  type TailscaleStatusCommandRunner,
} from "../shared/tailscale-status.js";

export type PublicCallbackAvailability =
  | {
      available: true;
      baseUrl: string;
      source: "configured-public-base-url" | "managed-tunnel";
      detail?: string;
      expiresAt?: string;
    }
  | {
      available: false;
      reason:
        | "loopback-only-no-tunnel"
        | "tunnel-start-failed"
        | "public-base-url-misconfigured";
      detail?: string;
    };

export type ManagedTunnelStartResult = {
  baseUrl: string;
  expiresAt?: string;
};

type ManagedTunnelStarter = (params: {
  stateDir: string;
  targetUrl: string;
  env: NodeJS.ProcessEnv;
}) => Promise<ManagedTunnelStartResult>;

function isLoopbackLikeHostname(hostname: string): boolean {
  const normalized = hostname.trim().replace(/^\[(.*)\]$/, "$1").toLowerCase();
  return (
    normalized === "" ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized === "::"
  );
}

function pickLanHost(): string | null {
  return null;
}

function pickTailnetHost(): string | null {
  return null;
}

function normalizeHttpBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let normalized = trimmed;
  if (normalized.startsWith("wss://")) {
    normalized = normalized.replace(/^wss:/, "https:");
  } else if (normalized.startsWith("ws://")) {
    normalized = normalized.replace(/^ws:/, "http:");
  }
  try {
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function resolveConfiguredBaseUrl(
  cfg: OpenClawConfig,
): { baseUrl: string; detail: string } | { error: string } | null {
  const devicePairPublicUrl = cfg.plugins?.entries?.["device-pair"]?.config?.["publicUrl"];
  if (typeof devicePairPublicUrl === "string" && devicePairPublicUrl.trim()) {
    const baseUrl = normalizeHttpBaseUrl(devicePairPublicUrl);
    if (!baseUrl) {
      return { error: "plugins.entries.device-pair.config.publicUrl is invalid." };
    }
    const parsed = new URL(baseUrl);
    if (isLoopbackLikeHostname(parsed.hostname)) {
      return { error: "plugins.entries.device-pair.config.publicUrl points to loopback." };
    }
    return {
      baseUrl,
      detail: "plugins.entries.device-pair.config.publicUrl",
    };
  }

  const remoteUrl = cfg.gateway?.remote?.url;
  if (typeof remoteUrl === "string" && remoteUrl.trim()) {
    const baseUrl = normalizeHttpBaseUrl(remoteUrl);
    if (!baseUrl) {
      return { error: "gateway.remote.url is invalid." };
    }
    const parsed = new URL(baseUrl);
    if (isLoopbackLikeHostname(parsed.hostname)) {
      return { error: "gateway.remote.url points to loopback." };
    }
    return {
      baseUrl,
      detail: "gateway.remote.url",
    };
  }

  const scheme = cfg.gateway?.tls?.enabled === true ? "wss" : "ws";
  const bindResult = resolveGatewayBindUrl({
    bind: cfg.gateway?.bind,
    customBindHost: cfg.gateway?.customBindHost,
    scheme,
    port: resolveGatewayPort(cfg),
    pickLanHost,
    pickTailnetHost,
  });
  if (!bindResult) {
    return null;
  }
  if ("error" in bindResult) {
    return { error: bindResult.error };
  }
  const baseUrl = normalizeHttpBaseUrl(bindResult.url);
  if (!baseUrl) {
    return { error: `${bindResult.source} is invalid.` };
  }
  const parsed = new URL(baseUrl);
  if (isLoopbackLikeHostname(parsed.hostname)) {
    return { error: `${bindResult.source} points to loopback.` };
  }
  return {
    baseUrl,
    detail: bindResult.source,
  };
}

async function defaultRunTailscaleStatus(
  argv: string[],
  opts: { timeoutMs: number },
): Promise<{ code: number | null; stdout: string }> {
  try {
    const result = await runExec(argv[0] ?? "tailscale", argv.slice(1), {
      timeoutMs: opts.timeoutMs,
      maxBuffer: 400_000,
    });
    return {
      code: 0,
      stdout: result.stdout,
    };
  } catch (error) {
    const err = error as { stdout?: unknown; status?: unknown; code?: unknown };
    return {
      code:
        typeof err.status === "number"
          ? err.status
          : typeof err.code === "number"
            ? err.code
            : 1,
      stdout: typeof err.stdout === "string" ? err.stdout : "",
    };
  }
}

async function resolveTailscaleBaseUrl(
  cfg: OpenClawConfig,
  runCommandWithTimeout: TailscaleStatusCommandRunner,
): Promise<{ baseUrl: string; detail: string } | { error: string } | null> {
  const tailscaleMode = cfg.gateway?.tailscale?.mode ?? "off";
  if (tailscaleMode !== "serve" && tailscaleMode !== "funnel") {
    return null;
  }
  const host = await resolveTailnetHostWithRunner(runCommandWithTimeout);
  if (!host) {
    return {
      error: `gateway.tailscale.mode=${tailscaleMode} is enabled, but MagicDNS could not be resolved.`,
    };
  }
  return {
    baseUrl: `https://${host}`,
    detail: `gateway.tailscale.mode=${tailscaleMode}`,
  };
}

async function defaultStartManagedTunnel(params: {
  stateDir: string;
  targetUrl: string;
  env: NodeJS.ProcessEnv;
}): Promise<ManagedTunnelStartResult> {
  const scriptPath = fileURLToPath(
    new URL("../../scripts/openclawcode-webhook-tunnel.sh", import.meta.url),
  );
  const result = spawnSync("bash", [scriptPath, "start-tunnel"], {
    cwd: path.dirname(path.dirname(scriptPath)),
    encoding: "utf8",
    env: {
      ...params.env,
      OPENCLAW_STATE_DIR: params.stateDir,
      OPENCLAWCODE_TUNNEL_OPERATOR_ROOT: params.stateDir,
      OPENCLAWCODE_TUNNEL_TARGET_URL: params.targetUrl,
    },
  });
  if (result.status !== 0) {
    const error =
      result.stderr.trim() || result.stdout.trim() || "Failed to start the managed tunnel.";
    throw new Error(error);
  }
  const lines = result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const baseUrl = normalizeHttpBaseUrl(lines.at(-1) ?? "");
  if (!baseUrl) {
    throw new Error(
      "Managed tunnel command exited successfully, but no public URL was discovered.",
    );
  }
  return { baseUrl };
}

export async function resolvePublicCallbackAvailability(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  runCommandWithTimeout?: TailscaleStatusCommandRunner;
  startManagedTunnel?: ManagedTunnelStarter | false;
}): Promise<PublicCallbackAvailability> {
  const env = params.env ?? process.env;
  const configured = resolveConfiguredBaseUrl(params.cfg);
  if (configured && "baseUrl" in configured) {
    return {
      available: true,
      baseUrl: configured.baseUrl,
      source: "configured-public-base-url",
      detail: configured.detail,
    };
  }
  if (configured && "error" in configured) {
    return {
      available: false,
      reason: "public-base-url-misconfigured",
      detail: configured.error,
    };
  }

  const tailscale = await resolveTailscaleBaseUrl(
    params.cfg,
    params.runCommandWithTimeout ?? defaultRunTailscaleStatus,
  );
  if (tailscale && "baseUrl" in tailscale) {
    return {
      available: true,
      baseUrl: tailscale.baseUrl,
      source: "configured-public-base-url",
      detail: tailscale.detail,
    };
  }
  if (tailscale && "error" in tailscale) {
    return {
      available: false,
      reason: "public-base-url-misconfigured",
      detail: tailscale.error,
    };
  }

  const starter = params.startManagedTunnel === undefined ? defaultStartManagedTunnel : params.startManagedTunnel;
  if (starter) {
    try {
      const stateDir = resolveStateDir(env);
      const targetUrl = `http://127.0.0.1:${resolveGatewayPort(params.cfg, env)}`;
      const result = await starter({ stateDir, targetUrl, env });
      return {
        available: true,
        baseUrl: result.baseUrl.replace(/\/+$/, ""),
        source: "managed-tunnel",
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      return {
        available: false,
        reason: "tunnel-start-failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    available: false,
    reason: "loopback-only-no-tunnel",
    detail:
      "Gateway only exposes loopback and no public callback URL or managed tunnel is available.",
  };
}
