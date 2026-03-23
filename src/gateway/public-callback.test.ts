import { describe, expect, it, vi } from "vitest";
import { resolvePublicCallbackAvailability } from "./public-callback.js";

describe("resolvePublicCallbackAvailability", () => {
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
