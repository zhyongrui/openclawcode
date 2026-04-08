import { describe, expect, test } from "vitest";
import {
  buildExecApprovalRequestPayload,
  resolveExecApprovalEffectiveRequest,
} from "./exec-approval-effective-request.js";

describe("resolveExecApprovalEffectiveRequest", () => {
  test("uses canonical node systemRunPlan fields for the effective request", () => {
    expect(
      resolveExecApprovalEffectiveRequest({
        host: "node",
        nodeId: "node-1",
        command: "echo stale",
        commandArgv: ["echo", "stale"],
        cwd: "/tmp/link",
        agentId: "stale-agent",
        sessionKey: "stale-session",
        systemRunPlan: {
          argv: ["/usr/bin/echo", "ok"],
          cwd: "/real/cwd",
          commandText: "/usr/bin/echo ok",
          commandPreview: "echo ok",
          agentId: "main",
          sessionKey: "agent:main:main",
        },
      }),
    ).toEqual({
      ok: true,
      effective: {
        host: "node",
        nodeId: "node-1",
        commandText: "/usr/bin/echo ok",
        commandPreview: "echo ok",
        commandArgv: ["/usr/bin/echo", "ok"],
        systemRunPlan: {
          argv: ["/usr/bin/echo", "ok"],
          cwd: "/real/cwd",
          commandText: "/usr/bin/echo ok",
          commandPreview: "echo ok",
          agentId: "main",
          sessionKey: "agent:main:main",
        },
        cwd: "/real/cwd",
        agentId: "main",
        sessionKey: "agent:main:main",
      },
    });
  });

  test("rejects node requests without nodeId or systemRunPlan", () => {
    expect(
      resolveExecApprovalEffectiveRequest({
        host: "node",
        command: "echo ok",
      }),
    ).toEqual({
      ok: false,
      message: "nodeId is required for host=node",
    });

    expect(
      resolveExecApprovalEffectiveRequest({
        host: "node",
        nodeId: "node-1",
        command: "echo ok",
      }),
    ).toEqual({
      ok: false,
      message: "systemRunPlan is required for host=node",
    });
  });
});

describe("buildExecApprovalRequestPayload", () => {
  test("builds a canonical node approval payload from the effective request", () => {
    const resolved = resolveExecApprovalEffectiveRequest({
      host: "node",
      nodeId: "node-1",
      command: "bash safe\u200B.sh",
      systemRunPlan: {
        argv: ["bash", "safe\u200B.sh"],
        cwd: "/real/cwd",
        commandText: "bash safe\u200B.sh",
        commandPreview: "safe\u200B.sh",
        agentId: "main",
        sessionKey: "agent:main:main",
      },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error("expected effective request");
    }

    expect(
      buildExecApprovalRequestPayload({
        effective: resolved.effective,
        env: { Z_VAR: "z", A_VAR: "a" },
        security: "allowlist",
        ask: "always",
        allowedDecisions: ["allow-once", "deny"],
        resolvedPath: "/usr/bin/bash",
        turnSourceChannel: "whatsapp",
        turnSourceThreadId: "thread-1",
      }),
    ).toEqual({
      command: "bash safe\\u{200B}.sh",
      commandPreview: undefined,
      commandArgv: undefined,
      envKeys: ["A_VAR", "Z_VAR"],
      systemRunBinding: {
        argv: ["bash", "safe\u200B.sh"],
        cwd: "/real/cwd",
        agentId: "main",
        sessionKey: "agent:main:main",
        envHash: expect.any(String),
      },
      systemRunPlan: {
        argv: ["bash", "safe\u200B.sh"],
        cwd: "/real/cwd",
        commandText: "bash safe\u200B.sh",
        commandPreview: "safe\u200B.sh",
        agentId: "main",
        sessionKey: "agent:main:main",
      },
      cwd: "/real/cwd",
      nodeId: "node-1",
      host: "node",
      security: "allowlist",
      ask: "always",
      allowedDecisions: ["allow-once", "deny"],
      agentId: "main",
      resolvedPath: "/usr/bin/bash",
      sessionKey: "agent:main:main",
      turnSourceChannel: "whatsapp",
      turnSourceTo: null,
      turnSourceAccountId: null,
      turnSourceThreadId: "thread-1",
    });
  });
});
