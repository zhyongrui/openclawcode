import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGatewayPort, resolveIsNixMode, resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.js";
import { resolveOpenClawPackageRootSync } from "../infra/openclaw-root.js";
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
      reason: "loopback-only-no-tunnel" | "tunnel-start-failed" | "public-base-url-misconfigured";
      detail?: string;
    };

export type ManagedTunnelStartResult = {
  baseUrl: string;
  expiresAt?: string;
  detail?: string;
};

export type PublicCallbackToolPreparation =
  | {
      status: "not-needed";
      source: "configured-public-base-url";
      detail?: string;
    }
  | {
      status: "ready";
      source:
        | "explicit-cloudflared"
        | "existing-cloudflared"
        | "managed-cloudflared-cache"
        | "downloaded-cloudflared";
      binaryPath: string;
    }
  | {
      status: "failed";
      reason: "public-base-url-misconfigured" | "cloudflared-prepare-failed";
      detail: string;
    };

type ManagedTunnelStarter = (params: {
  stateDir: string;
  targetUrl: string;
  env: NodeJS.ProcessEnv;
}) => Promise<ManagedTunnelStartResult>;

type ManagedCloudflaredResolution =
  | {
      binaryPath: string;
      source: "explicit-cloudflared" | "existing-cloudflared" | "managed-cloudflared-cache";
    }
  | {
      binaryPath: string;
      source: "downloaded-cloudflared";
    };

type CloudflaredDownloadSpec = {
  url: string;
  archive: "binary" | "tgz";
};

const MANAGED_TUNNEL_SCRIPT_BASENAME = "openclawcode-webhook-tunnel.sh";

function buildManagedTunnelScriptCandidates(opts: {
  argv1?: string;
  cwd?: string;
  moduleUrl?: string;
}): string[] {
  const candidates = new Set<string>();
  const packageRoot = resolveOpenClawPackageRootSync({
    argv1: opts.argv1,
    cwd: opts.cwd,
    moduleUrl: opts.moduleUrl,
  });
  if (packageRoot) {
    candidates.add(path.join(packageRoot, "scripts", MANAGED_TUNNEL_SCRIPT_BASENAME));
  }

  const startDirs = new Set<string>();
  if (opts.cwd?.trim()) {
    startDirs.add(path.resolve(opts.cwd));
  }
  if (opts.argv1?.trim()) {
    startDirs.add(path.dirname(path.resolve(opts.argv1)));
  }
  if (opts.moduleUrl) {
    try {
      startDirs.add(path.dirname(fileURLToPath(opts.moduleUrl)));
    } catch {
      // Ignore invalid file URLs and keep other candidates.
    }
  }

  for (const startDir of startDirs) {
    let current = startDir;
    for (let depth = 0; depth < 8; depth += 1) {
      candidates.add(path.join(current, "scripts", MANAGED_TUNNEL_SCRIPT_BASENAME));
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return [...candidates];
}

export function resolveManagedTunnelScriptPath(
  opts: {
    argv1?: string;
    cwd?: string;
    moduleUrl?: string;
  } = {},
): string {
  for (const candidate of buildManagedTunnelScriptCandidates({
    argv1: opts.argv1 ?? process.argv[1],
    cwd: opts.cwd ?? process.cwd(),
    moduleUrl: opts.moduleUrl ?? import.meta.url,
  })) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Failed to locate ${MANAGED_TUNNEL_SCRIPT_BASENAME}. Checked: ${buildManagedTunnelScriptCandidates(
      {
        argv1: opts.argv1 ?? process.argv[1],
        cwd: opts.cwd ?? process.cwd(),
        moduleUrl: opts.moduleUrl ?? import.meta.url,
      },
    ).join(", ")}`,
  );
}

async function verifyPublicBaseUrlReachable(baseUrl: string): Promise<void> {
  const probeUrl = `${baseUrl.replace(/\/+$/, "")}/`;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(probeUrl, {
        method: "GET",
        redirect: "manual",
      });
      if (response.status < 500 || response.status === 401 || response.status === 403) {
        return;
      }
      lastError = `public tunnel returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Managed tunnel created a public URL, but it never became reachable (${lastError ?? "unknown error"}).`,
  );
}

function resolveCandidateHomeDir(env: NodeJS.ProcessEnv): string | null {
  const fromEnv = env.HOME?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return os.homedir();
  } catch {
    return null;
  }
}

function resolveCloudflaredCandidatePaths(env: NodeJS.ProcessEnv): string[] {
  const candidates = new Set<string>();
  candidates.add(resolveManagedCloudflaredInstallPath(env));
  const pathEntries = (env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of pathEntries) {
    candidates.add(path.join(entry, "cloudflared"));
  }
  const homeDir = resolveCandidateHomeDir(env);
  if (homeDir) {
    candidates.add(path.join(homeDir, ".local", "bin", "cloudflared"));
    candidates.add(path.join(homeDir, "bin", "cloudflared"));
  }
  candidates.add("/usr/local/bin/cloudflared");
  candidates.add("/opt/homebrew/bin/cloudflared");
  candidates.add("/usr/bin/cloudflared");
  return [...candidates];
}

function probeCloudflaredBinary(candidate: string, env: NodeJS.ProcessEnv): boolean {
  const probe = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    env,
  });
  return probe.status === 0;
}

export function resolveCloudflaredBinary(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.OPENCLAWCODE_CLOUDFLARED_BIN?.trim();
  if (explicit) {
    return explicit;
  }
  for (const candidate of resolveCloudflaredCandidatePaths(env)) {
    if (!candidate || !existsSync(candidate)) {
      continue;
    }
    if (probeCloudflaredBinary(candidate, env)) {
      return candidate;
    }
  }
  return null;
}

function resolveManagedCloudflaredInstallPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  const filename = platform === "win32" ? "cloudflared.exe" : "cloudflared";
  return path.join(resolveStateDir(env), "bin", filename);
}

function resolveCloudflaredDownloadSpec(
  platform: NodeJS.Platform,
  arch: string,
): CloudflaredDownloadSpec | null {
  if (platform === "linux") {
    switch (arch) {
      case "x64":
        return {
          url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
          archive: "binary",
        };
      case "arm64":
        return {
          url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
          archive: "binary",
        };
      case "arm":
        return {
          url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm",
          archive: "binary",
        };
      case "ia32":
        return {
          url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-386",
          archive: "binary",
        };
      default:
        return null;
    }
  }
  if (platform === "darwin") {
    switch (arch) {
      case "x64":
        return {
          url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
          archive: "tgz",
        };
      case "arm64":
        return {
          url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
          archive: "tgz",
        };
      default:
        return null;
    }
  }
  return null;
}

async function installManagedCloudflaredBinary(params: {
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const platform = params.platform ?? process.platform;
  const arch = params.arch ?? process.arch;
  const spec = resolveCloudflaredDownloadSpec(platform, arch);
  if (!spec) {
    throw new Error(
      `cloudflared auto-install is not supported on ${platform}/${arch}. Install it manually or set OPENCLAWCODE_CLOUDFLARED_BIN.`,
    );
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(spec.url, {
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Failed to download cloudflared: HTTP ${response.status} from ${spec.url}`);
  }

  const targetPath = resolveManagedCloudflaredInstallPath(params.env, platform);
  await mkdir(path.dirname(targetPath), { recursive: true });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-cloudflared-"));
  const downloadPath = path.join(
    tempDir,
    path.basename(new URL(spec.url).pathname) || "cloudflared",
  );
  const stagedPath = path.join(tempDir, path.basename(targetPath));

  try {
    const payload = Buffer.from(await response.arrayBuffer());
    await writeFile(downloadPath, payload, { mode: 0o755 });

    let extractedPath = downloadPath;
    if (spec.archive === "tgz") {
      const extractResult = spawnSync("tar", ["-xzf", downloadPath, "-C", tempDir], {
        encoding: "utf8",
      });
      if (extractResult.status !== 0) {
        const detail =
          extractResult.stderr.trim() ||
          extractResult.stdout.trim() ||
          "tar failed while extracting cloudflared.";
        throw new Error(detail);
      }
      extractedPath = path.join(tempDir, "cloudflared");
      if (!existsSync(extractedPath)) {
        throw new Error("Downloaded cloudflared archive did not contain the expected binary.");
      }
    }

    await copyFile(extractedPath, stagedPath);
    await chmod(stagedPath, 0o755);
    await rm(targetPath, { force: true });
    await copyFile(stagedPath, targetPath);
    await chmod(targetPath, 0o755);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  if (!probeCloudflaredBinary(targetPath, params.env)) {
    await rm(targetPath, { force: true });
    throw new Error("Downloaded cloudflared, but the installed binary failed validation.");
  }
  return targetPath;
}

export async function ensureManagedCloudflaredBinary(
  params: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    arch?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<ManagedCloudflaredResolution> {
  const env = params.env ?? process.env;
  const explicit = env.OPENCLAWCODE_CLOUDFLARED_BIN?.trim();
  if (explicit) {
    if (existsSync(explicit) && probeCloudflaredBinary(explicit, env)) {
      return {
        binaryPath: explicit,
        source: "explicit-cloudflared",
      };
    }
    throw new Error(
      `OPENCLAWCODE_CLOUDFLARED_BIN points to ${explicit}, but cloudflared --version failed.`,
    );
  }

  const discoveryEnv = { ...env };
  delete discoveryEnv.OPENCLAWCODE_CLOUDFLARED_BIN;
  const discovered = resolveCloudflaredBinary(discoveryEnv);
  if (discovered) {
    return {
      binaryPath: discovered,
      source:
        path.resolve(discovered) ===
        path.resolve(resolveManagedCloudflaredInstallPath(env, params.platform))
          ? "managed-cloudflared-cache"
          : "existing-cloudflared",
    };
  }

  if (resolveIsNixMode(env)) {
    throw new Error(
      "cloudflared was not found and auto-install is disabled in Nix mode. Install it via Nix or set OPENCLAWCODE_CLOUDFLARED_BIN.",
    );
  }

  const binaryPath = await installManagedCloudflaredBinary({
    env,
    platform: params.platform,
    arch: params.arch,
    fetchImpl: params.fetchImpl,
  });
  return {
    binaryPath,
    source: "downloaded-cloudflared",
  };
}

function isLoopbackLikeHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .toLowerCase();
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
        typeof err.status === "number" ? err.status : typeof err.code === "number" ? err.code : 1,
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
  const cloudflared = await ensureManagedCloudflaredBinary({
    env: params.env,
  });
  const scriptPath = resolveManagedTunnelScriptPath();
  const result = spawnSync("bash", [scriptPath, "start-tunnel"], {
    cwd: path.dirname(path.dirname(scriptPath)),
    encoding: "utf8",
    env: {
      ...params.env,
      OPENCLAW_STATE_DIR: params.stateDir,
      OPENCLAWCODE_TUNNEL_OPERATOR_ROOT: params.stateDir,
      OPENCLAWCODE_TUNNEL_TARGET_URL: params.targetUrl,
      OPENCLAWCODE_CLOUDFLARED_BIN: cloudflared.binaryPath,
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
  try {
    await verifyPublicBaseUrlReachable(baseUrl);
    return { baseUrl };
  } catch (error) {
    return {
      baseUrl,
      detail:
        error instanceof Error
          ? `${error.message} 仍会继续提供该公网链接，优先用手机扫码尝试。`
          : "Managed tunnel self-check failed. The public link may still work from your phone.",
    };
  }
}

async function resolveDirectPublicCallbackAvailability(params: {
  cfg: OpenClawConfig;
  runCommandWithTimeout: TailscaleStatusCommandRunner;
}): Promise<
  | {
      available: true;
      baseUrl: string;
      detail?: string;
    }
  | {
      available: false;
      reason: "public-base-url-misconfigured";
      detail: string;
    }
  | null
> {
  const configured = resolveConfiguredBaseUrl(params.cfg);
  if (configured && "baseUrl" in configured) {
    return {
      available: true,
      baseUrl: configured.baseUrl,
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

  const tailscale = await resolveTailscaleBaseUrl(params.cfg, params.runCommandWithTimeout);
  if (tailscale && "baseUrl" in tailscale) {
    return {
      available: true,
      baseUrl: tailscale.baseUrl,
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

  return null;
}

export async function preparePublicCallbackTooling(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  runCommandWithTimeout?: TailscaleStatusCommandRunner;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
}): Promise<PublicCallbackToolPreparation> {
  const env = params.env ?? process.env;
  const direct = await resolveDirectPublicCallbackAvailability({
    cfg: params.cfg,
    runCommandWithTimeout: params.runCommandWithTimeout ?? defaultRunTailscaleStatus,
  });
  if (direct?.available) {
    return {
      status: "not-needed",
      source: "configured-public-base-url",
      detail: direct.detail,
    };
  }
  if (direct && !direct.available) {
    return {
      status: "failed",
      reason: direct.reason,
      detail: direct.detail,
    };
  }

  try {
    const result = await ensureManagedCloudflaredBinary({
      env,
      platform: params.platform,
      arch: params.arch,
      fetchImpl: params.fetchImpl,
    });
    return {
      status: "ready",
      source: result.source,
      binaryPath: result.binaryPath,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: "cloudflared-prepare-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resolvePublicCallbackAvailability(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  runCommandWithTimeout?: TailscaleStatusCommandRunner;
  startManagedTunnel?: ManagedTunnelStarter | false;
}): Promise<PublicCallbackAvailability> {
  const env = params.env ?? process.env;
  const direct = await resolveDirectPublicCallbackAvailability({
    cfg: params.cfg,
    runCommandWithTimeout: params.runCommandWithTimeout ?? defaultRunTailscaleStatus,
  });
  if (direct?.available) {
    return {
      available: true,
      baseUrl: direct.baseUrl,
      source: "configured-public-base-url",
      detail: direct.detail,
    };
  }
  if (direct && !direct.available) {
    return {
      available: false,
      reason: "public-base-url-misconfigured",
      detail: direct.detail,
    };
  }

  const starter =
    params.startManagedTunnel === undefined ? defaultStartManagedTunnel : params.startManagedTunnel;
  if (starter) {
    try {
      const stateDir = resolveStateDir(env);
      const targetUrl = `http://127.0.0.1:${resolveGatewayPort(params.cfg, env)}`;
      const result = await starter({ stateDir, targetUrl, env });
      return {
        available: true,
        baseUrl: result.baseUrl.replace(/\/+$/, ""),
        source: "managed-tunnel",
        detail: result.detail,
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
