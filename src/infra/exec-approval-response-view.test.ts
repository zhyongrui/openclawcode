import { describe, expect, it } from "vitest";
import { buildExecApprovalResponseView } from "./exec-approval-response-view.js";
import type { ExecApprovalRequest } from "./exec-approvals.js";

describe("buildExecApprovalResponseView", () => {
  it("builds a canonical operator-facing view from an exec approval request", () => {
    const request: ExecApprovalRequest = {
      id: "approval-1",
      request: {
        command: "bash safe\u200B.sh",
        commandPreview: "safe\u200B.sh",
        envKeys: ["A_VAR", "Z_VAR"],
        host: "node",
        nodeId: "node-1",
        ask: "always",
        agentId: "main",
        cwd: "/real/cwd",
        resolvedPath: "/usr/bin/bash",
        sessionKey: "agent:main:main",
      },
      createdAtMs: 100,
      expiresAtMs: 200,
    };

    expect(buildExecApprovalResponseView(request)).toEqual({
      id: "approval-1",
      commandText: "bash safe\\u{200B}.sh",
      commandPreview: "safe\\u{200B}.sh",
      allowedDecisions: ["allow-once", "deny"],
      host: "node",
      nodeId: "node-1",
      agentId: "main",
      cwd: "/real/cwd",
      envKeys: ["A_VAR", "Z_VAR"],
      resolvedPath: "/usr/bin/bash",
      sessionKey: "agent:main:main",
      createdAtMs: 100,
      expiresAtMs: 200,
    });
  });
});
