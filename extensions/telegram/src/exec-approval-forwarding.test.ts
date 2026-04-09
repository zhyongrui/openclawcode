import { describe, expect, it } from "vitest";
import { buildTelegramExecApprovalPendingPayload } from "./exec-approval-forwarding.js";

describe("buildTelegramExecApprovalPendingPayload", () => {
  it("reuses the shared exec approval request view", () => {
    const payload = buildTelegramExecApprovalPendingPayload({
      request: {
        id: "approval-telegram-1",
        request: {
          command: "bash safe\u200B.sh",
          ask: "always",
          host: "node",
          nodeId: "node-1",
          cwd: "/tmp/work",
          agentId: "ops-agent",
          sessionKey: "agent:ops-agent:telegram",
        },
        createdAtMs: 100,
        expiresAtMs: 4000,
      },
      nowMs: 2000,
    });

    expect(payload.channelData).toEqual({
      execApproval: {
        approvalId: "approval-telegram-1",
        approvalSlug: "approval",
        approvalKind: "exec",
        agentId: "ops-agent",
        allowedDecisions: ["allow-once", "deny"],
        sessionKey: "agent:ops-agent:telegram",
      },
    });
    expect(payload.text).toContain("```txt\n/approve approval allow-once\n```");
    expect(payload.text).toContain("```sh\nbash safe\\u{200B}.sh\n```");
    expect(payload.text).toContain("Host: node\nNode: node-1\nCWD: /tmp/work\nExpires in: 2s");
    expect(payload.text).not.toContain("allow-always");
  });
});
