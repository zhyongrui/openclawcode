import { describe, expect, it } from "vitest";
import {
  buildWorkflowFailureDiagnosticLines,
  buildOpenClawCodeRunArgv,
  buildRunRequestFromCommand,
  parseChatopsIssueDraftCommand,
  resolveOpenClawCodePluginConfig,
  type OpenClawCodeChatopsRepoConfig,
} from "./chatops.js";

function createRepoConfig(): OpenClawCodeChatopsRepoConfig {
  return {
    owner: "zhyongrui",
    repo: "openclawcode",
    repoRoot: "/repo",
    baseBranch: "main",
    notifyChannel: "telegram",
    notifyTarget: "chat:primary",
    builderAgent: "main-builder",
    verifierAgent: "main-verifier",
    testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"],
    openPullRequest: true,
    mergeOnApprove: false,
  };
}

describe("openclawcode chatops run request plumbing", () => {
  it("falls back to a single-line diagnostic summary when compact fields are absent", () => {
    expect(
      buildWorkflowFailureDiagnosticLines({
        diagnostics: {
          summary: "line one\nline two",
        },
      }),
    ).toEqual(["  diagnostics: line one line two"]);
  });

  it("carries suitability overrides into run requests", () => {
    const request = buildRunRequestFromCommand({
      command: {
        action: "start",
        issue: {
          owner: "zhyongrui",
          repo: "openclawcode",
          number: 411,
        },
      },
      config: createRepoConfig(),
      suitabilityOverride: {
        actor: "chat:operator",
        reason: "Operator approved this narrow exception.",
      },
    });

    expect(request.suitabilityOverride).toEqual({
      actor: "chat:operator",
      reason: "Operator approved this narrow exception.",
    });
  });

  it("emits suitability override flags in the CLI argv", () => {
    const argv = buildOpenClawCodeRunArgv({
      owner: "zhyongrui",
      repo: "openclawcode",
      issueNumber: 411,
      repoRoot: "/repo",
      baseBranch: "main",
      branchName: "openclawcode/issue-411",
      builderAgent: "main-builder",
      verifierAgent: "main-verifier",
      testCommands: ["pnpm test"],
      openPullRequest: true,
      mergeOnApprove: false,
      suitabilityOverride: {
        actor: "chat:operator",
        reason: "Operator approved this narrow exception.",
      },
    });

    expect(argv).toContain("--suitability-override-actor");
    expect(argv).toContain("chat:operator");
    expect(argv).toContain("--suitability-override-reason");
    expect(argv).toContain("Operator approved this narrow exception.");
  });

  it("applies runtime reroute overrides to rerun requests", () => {
    const request = buildRunRequestFromCommand({
      command: {
        action: "rerun",
        issue: {
          owner: "zhyongrui",
          repo: "openclawcode",
          number: 412,
        },
      },
      config: createRepoConfig(),
      rerunContext: {
        reason: "Retry with a different runtime agent.",
        requestedAt: "2026-03-16T12:00:00.000Z",
        priorRunId: "run-411",
        priorStage: "failed",
      },
      runtimeAgentOverrides: {
        coderAgentId: "codex-reroute",
        verifierAgentId: "claude-reroute",
      },
    });

    expect(request.builderAgent).toBe("codex-reroute");
    expect(request.verifierAgent).toBe("claude-reroute");
    expect(request.rerunContext).toMatchObject({
      requestedCoderAgentId: "codex-reroute",
      requestedVerifierAgentId: "claude-reroute",
    });
  });

  it("emits rerun runtime override flags in the CLI argv", () => {
    const argv = buildOpenClawCodeRunArgv({
      owner: "zhyongrui",
      repo: "openclawcode",
      issueNumber: 412,
      repoRoot: "/repo",
      baseBranch: "main",
      branchName: "openclawcode/issue-412",
      builderAgent: "codex-reroute",
      verifierAgent: "claude-reroute",
      testCommands: ["pnpm test"],
      openPullRequest: true,
      mergeOnApprove: false,
      rerunContext: {
        reason: "Retry with a different runtime agent.",
        requestedAt: "2026-03-16T12:00:00.000Z",
        priorRunId: "run-411",
        priorStage: "failed",
        requestedCoderAgentId: "codex-reroute",
        requestedVerifierAgentId: "claude-reroute",
      },
    });

    expect(argv).toContain("--rerun-coder-agent");
    expect(argv).toContain("codex-reroute");
    expect(argv).toContain("--rerun-verifier-agent");
    expect(argv).toContain("claude-reroute");
  });

  it("accepts /occ-intake as an alias for chat issue drafting", () => {
    expect(
      parseChatopsIssueDraftCommand(
        ["/occ-intake zhyongrui/openclawcode", "Tighten onboarding alias guidance"].join("\n"),
      ),
    ).toMatchObject({
      action: "intake",
      repo: {
        owner: "zhyongrui",
        repo: "openclawcode",
      },
      draft: {
        title: "Tighten onboarding alias guidance",
        bodySynthesized: true,
        sourceRequest: "Tighten onboarding alias guidance",
      },
    });
  });

  it("parses an optional Feishu operator binding contact", () => {
    const config = resolveOpenClawCodePluginConfig({
      feishuOperatorBinding: {
        accountId: "ops",
        email: "owner@example.com",
        sendWelcomeMessage: false,
      },
      repos: [
        {
          owner: "zhyongrui",
          repo: "openclawcode",
          repoRoot: "/repo",
          notifyChannel: "feishu",
          notifyTarget: "bind-pending:zhyongrui/openclawcode",
          builderAgent: "main-builder",
          verifierAgent: "main-verifier",
          testCommands: ["pnpm test"],
        },
      ],
    });

    expect(config.feishuOperatorBinding).toEqual({
      accountId: "ops",
      email: "owner@example.com",
      mobile: undefined,
      sendWelcomeMessage: false,
    });
  });
});
