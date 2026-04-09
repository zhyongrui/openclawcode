import { describe, expect, it, vi } from "vitest";

vi.mock("music-metadata", () => ({
  parseBuffer: vi.fn(async () => ({ format: {} })),
}));

import { matrixApprovalNativeRuntime } from "./approval-handler.runtime.js";

describe("matrixApprovalNativeRuntime", () => {
  it("builds exec pending payloads from the canonical request shape", async () => {
    const result = await matrixApprovalNativeRuntime.presentation.buildPendingPayload({
      cfg: {} as never,
      accountId: "default",
      context: {
        client: {} as never,
      },
      request: {
        id: "req-1",
        request: {
          command: "bash safe\u200B.sh",
          ask: "always",
          host: "node",
          nodeId: "node-1",
          cwd: "/tmp/work",
          agentId: "ops-agent",
          sessionKey: "agent:ops-agent:matrix",
        },
        createdAtMs: 0,
        expiresAtMs: 4_000,
      },
      approvalKind: "exec",
      nowMs: 2_000,
      view: {
        approvalKind: "exec",
        approvalId: "req-1",
        commandText: "view text should not win",
        actions: [
          {
            decision: "allow-once",
            label: "Allow Once",
            command: "/approve req-1 allow-once",
            style: "success",
          },
          {
            decision: "deny",
            label: "Deny",
            command: "/approve req-1 deny",
            style: "danger",
          },
        ],
      } as never,
    });

    expect(result).toEqual({
      approvalId: "req-1",
      allowedDecisions: ["allow-once", "deny"],
      text: expect.stringContaining("React here: ✅ Allow once, ❌ Deny"),
    });
    expect(result.text).toContain("```sh\nbash safe\\u{200B}.sh\n```");
    expect(result.text).toContain("Host: node\nNode: node-1\nCWD: /tmp/work\nExpires in: 2s");
    expect(result.text).not.toContain("view text should not win");
    expect(result.text).toContain(
      "The effective approval policy requires approval every time, so Allow Always is unavailable.",
    );
  });

  it("uses a longer code fence when resolved commands contain triple backticks", async () => {
    const result = await matrixApprovalNativeRuntime.presentation.buildResolvedResult({
      cfg: {} as never,
      accountId: "default",
      context: {
        client: {} as never,
      },
      request: {
        id: "req-1",
        request: {
          command: "echo hi",
        },
        createdAtMs: 0,
        expiresAtMs: 1_000,
      },
      resolved: {
        id: "req-1",
        decision: "allow-once",
        ts: 0,
      },
      view: {
        approvalKind: "exec",
        approvalId: "req-1",
        decision: "allow-once",
        commandText: "echo ```danger```",
      } as never,
      entry: {} as never,
    });

    expect(result).toEqual({
      kind: "update",
      payload: [
        "Exec approval: Allowed once",
        "",
        "Command",
        "````",
        "echo ```danger```",
        "````",
      ].join("\n"),
    });
  });
});
