import { describe, expect, it } from "vitest";
import {
  buildExpiredApprovalView,
  buildPendingApprovalView,
  buildResolvedApprovalView,
} from "./approval-view-model.js";
import type { ExecApprovalRequest } from "./exec-approvals.js";
import {
  buildExecApprovalRequestPayload,
  resolveExecApprovalEffectiveRequest,
} from "./exec-approval-effective-request.js";

function createExecRequest(): ExecApprovalRequest {
  const effective = resolveExecApprovalEffectiveRequest({
    host: "node",
    nodeId: "node-1",
    command: "echo stale",
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
  });
  if (!effective.ok) {
    throw new Error(effective.message);
  }
  return {
    id: "req-1",
    createdAtMs: 1_000,
    expiresAtMs: 6_000,
    request: buildExecApprovalRequestPayload({
      effective: effective.effective,
      ask: "always",
      env: { B_VAR: "b", A_VAR: "a" },
    }),
  };
}

describe("approval view model", () => {
  it("reuses the shared exec approval response view for pending exec approvals", () => {
    const view = buildPendingApprovalView(createExecRequest());
    expect(view).toMatchObject({
      approvalId: "req-1",
      approvalKind: "exec",
      phase: "pending",
      title: "Exec Approval Required",
      description: "A command needs your approval.",
      ask: "always",
      agentId: "main",
      commandText: "/usr/bin/echo ok",
      commandPreview: "echo ok",
      cwd: "/real/cwd",
      envKeys: ["A_VAR", "B_VAR"],
      host: "node",
      nodeId: "node-1",
      sessionKey: "agent:main:main",
      metadata: [
        { label: "Agent", value: "main" },
        { label: "CWD", value: "/real/cwd" },
        { label: "Host", value: "node" },
        { label: "Env Overrides", value: "A_VAR, B_VAR" },
      ],
      actions: [
        {
          decision: "allow-once",
          label: "Allow Once",
          style: "success",
          command: "/approve req-1 allow-once",
        },
        {
          decision: "deny",
          label: "Deny",
          style: "danger",
          command: "/approve req-1 deny",
        },
      ],
      expiresAtMs: 6_000,
    });
  });

  it("reuses the shared exec approval response view for resolved and expired exec approvals", () => {
    const request = createExecRequest();
    expect(
      buildResolvedApprovalView(request, {
        id: "req-1",
        decision: "allow-once",
        resolvedBy: "operator",
        ts: 2_000,
      }),
    ).toMatchObject({
      approvalKind: "exec",
      phase: "resolved",
      commandText: "/usr/bin/echo ok",
      commandPreview: "echo ok",
      cwd: "/real/cwd",
      agentId: "main",
      decision: "allow-once",
      resolvedBy: "operator",
    });

    expect(buildExpiredApprovalView(request)).toMatchObject({
      approvalKind: "exec",
      phase: "expired",
      commandText: "/usr/bin/echo ok",
      commandPreview: "echo ok",
      cwd: "/real/cwd",
      agentId: "main",
    });
  });
});
