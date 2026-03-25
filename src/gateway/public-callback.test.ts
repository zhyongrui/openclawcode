import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ensureManagedCloudflaredBinary,
  preparePublicCallbackTooling,
  resolveCloudflaredBinary,
  resolvePublicCallbackAvailability,
} from "./public-callback.js";

describe("resolvePublicCallbackAvailability", () => {
  it("finds cloudflared in ~/.local/bin even when PATH is stripped", async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cloudflared-home-"));
    const localBinDir = path.join(fakeHome, ".local", "bin");
    const fakeBinary = path.join(localBinDir, "cloudflared");
    await fs.mkdir(localBinDir, { recursive: true });
    await fs.writeFile(
      fakeBinary,
      "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then echo 'cloudflared version test'; exit 0; fi\nexit 1\n",
      { mode: 0o755 },
    );

    const resolved = resolveCloudflaredBinary({
      HOME: fakeHome,
      PATH: "/usr/bin:/bin",
    });

    expect(resolved).toBe(fakeBinary);
  });

  it("prefers configured device-pair public url", async () => {
    const result = await resolvePublicCallbackAvailability({
      cfg: {
        plugins: {
          entries: {
            "device-pair": {
              config: {
                publicUrl: "wss://pair.example.com/gateway",
              },
            },
          },
        },
        gateway: {
          remote: {
            url: "wss://remote.example.com/openclaw",
          },
        },
      } as never,
      startManagedTunnel: false,
    });

    expect(result).toEqual({
      available: true,
      baseUrl: "https://pair.example.com/gateway",
      source: "configured-public-base-url",
      detail: "plugins.entries.device-pair.config.publicUrl",
    });
  });

  it("uses tailscale serve when magicdns is available", async () => {
    const runCommandWithTimeout = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        Self: {
          DNSName: "demo.tail-scale.ts.net.",
        },
      }),
    }));

    const result = await resolvePublicCallbackAvailability({
      cfg: {
        gateway: {
          tailscale: {
            mode: "serve",
          },
        },
      } as never,
      runCommandWithTimeout,
      startManagedTunnel: false,
    });

    expect(result).toEqual({
      available: true,
      baseUrl: "https://demo.tail-scale.ts.net",
      source: "configured-public-base-url",
      detail: "gateway.tailscale.mode=serve",
    });
  });

  it("starts a managed tunnel when no public callback url is configured", async () => {
    const startManagedTunnel = vi.fn(async () => ({
      baseUrl: "https://qr-bind.trycloudflare.com",
    }));

    const result = await resolvePublicCallbackAvailability({
      cfg: {
        gateway: {
          bind: "loopback",
          port: 18789,
        },
      } as never,
      startManagedTunnel,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: "/tmp/openclaw-feishu-public-callback-test",
      },
    });

    expect(result).toEqual({
      available: true,
      baseUrl: "https://qr-bind.trycloudflare.com",
      source: "managed-tunnel",
    });
    expect(startManagedTunnel).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUrl: "http://127.0.0.1:18789",
      }),
    );
  });

  it("keeps the managed tunnel qr flow when tunnel self-check returns a warning", async () => {
    const startManagedTunnel = vi.fn(async () => ({
      baseUrl: "https://qr-bind.trycloudflare.com",
      detail: "Managed tunnel created a public URL, but it never became reachable (fetch failed). 仍会继续提供该公网链接，优先用手机扫码尝试。",
    }));

    const result = await resolvePublicCallbackAvailability({
      cfg: {
        gateway: {
          bind: "loopback",
          port: 18789,
        },
      } as never,
      startManagedTunnel,
    });

    expect(result).toEqual({
      available: true,
      baseUrl: "https://qr-bind.trycloudflare.com",
      source: "managed-tunnel",
      detail:
        "Managed tunnel created a public URL, but it never became reachable (fetch failed). 仍会继续提供该公网链接，优先用手机扫码尝试。",
    });
  });

  it("downloads cloudflared into the managed state bin when missing", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cloudflared-state-"));
    const fetchMock = vi.fn(async () =>
      new Response(
        "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then echo 'cloudflared version downloaded'; exit 0; fi\nexit 1\n",
        { status: 200 },
      ),
    );

    const result = await ensureManagedCloudflaredBinary({
      env: {
        HOME: stateDir,
        PATH: "/usr/bin:/bin",
        OPENCLAW_STATE_DIR: stateDir,
      },
      platform: "linux",
      arch: "x64",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.source).toBe("downloaded-cloudflared");
    expect(result.binaryPath).toBe(path.join(stateDir, "bin", "cloudflared"));
    expect(resolveCloudflaredBinary({
      HOME: stateDir,
      PATH: "/usr/bin:/bin",
      OPENCLAW_STATE_DIR: stateDir,
    })).toBe(result.binaryPath);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  it("prepares cloudflared during setup when no direct public callback exists", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cloudflared-prepare-"));
    const fetchMock = vi.fn(async () =>
      new Response(
        "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then echo 'cloudflared version prepared'; exit 0; fi\nexit 1\n",
        { status: 200 },
      ),
    );

    const result = await preparePublicCallbackTooling({
      cfg: {
        gateway: {
          bind: "loopback",
          port: 18789,
        },
      } as never,
      env: {
        HOME: stateDir,
        PATH: "/usr/bin:/bin",
        OPENCLAW_STATE_DIR: stateDir,
      },
      platform: "linux",
      arch: "x64",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result).toEqual({
      status: "ready",
      source: "downloaded-cloudflared",
      binaryPath: path.join(stateDir, "bin", "cloudflared"),
    });
  });

  it("reports a managed tunnel failure explicitly", async () => {
    const result = await resolvePublicCallbackAvailability({
      cfg: {
        gateway: {
          bind: "loopback",
          port: 18789,
        },
      } as never,
      startManagedTunnel: vi.fn(async () => {
        throw new Error("cloudflared not found");
      }),
    });

    expect(result).toEqual({
      available: false,
      reason: "tunnel-start-failed",
      detail: "cloudflared not found",
    });
  });

  it("reports invalid configured public urls instead of pretending qr scan works", async () => {
    const result = await resolvePublicCallbackAvailability({
      cfg: {
        plugins: {
          entries: {
            "device-pair": {
              config: {
                publicUrl: "http://127.0.0.1:18789",
              },
            },
          },
        },
      } as never,
      startManagedTunnel: false,
    });

    expect(result).toEqual({
      available: false,
      reason: "public-base-url-misconfigured",
      detail: "plugins.entries.device-pair.config.publicUrl points to loopback.",
    });
  });
});
