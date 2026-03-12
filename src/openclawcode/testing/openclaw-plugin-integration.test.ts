import { describe, expect, it } from "vitest";
import {
  buildIssueApprovalMessage,
  buildIssueEscalationMessage,
  buildOpenClawCodeRunArgv,
  buildRunRequestFromCommand,
  buildRunStatusMessage,
  decideIssueWebhookIntake,
  extractWorkflowRunFromCommandOutput,
  parseChatopsCommand,
  resolveOpenClawCodePluginConfig,
} from "../../integrations/openclaw-plugin/index.js";
import type { WorkflowRun } from "../contracts/index.js";

const repoConfig = {
  owner: "zhyongrui",
  repo: "openclawcode",
  repoRoot: "/home/zyr/pros/openclawcode",
  baseBranch: "main",
  notifyChannel: "telegram",
  notifyTarget: "chat:123",
  builderAgent: "main",
  verifierAgent: "main",
  testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
  triggerLabels: ["openclawcode:auto"],
  skipLabels: ["openclawcode:manual-only"],
  openPullRequest: true,
  mergeOnApprove: true,
} satisfies Parameters<typeof decideIssueWebhookIntake>[0]["config"];

function createRun(): WorkflowRun {
  return {
    id: "run-1",
    stage: "merged",
    issue: {
      owner: "zhyongrui",
      repo: "openclawcode",
      number: 34,
      title: "Expose top-level scope blocked files",
      labels: ["openclawcode:auto"],
    },
    createdAt: "2026-03-10T06:11:00.000Z",
    updatedAt: "2026-03-10T06:14:38.530Z",
    attempts: {
      total: 1,
      planning: 1,
      building: 1,
      verifying: 1,
    },
    stageRecords: [],
    history: ["Pull request opened: https://github.com/zhyongrui/openclawcode/pull/35"],
    buildResult: {
      branchName: "openclawcode/issue-34-scope-blocked-files",
      summary: "Added scopeBlockedFiles to command JSON output.",
      changedFiles: ["src/commands/openclawcode.ts", "src/commands/openclawcode.test.ts"],
      issueClassification: "command-layer",
      scopeCheck: {
        ok: true,
        blockedFiles: [],
        summary: "Scope check passed for command-layer issue.",
      },
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
      testResults: ["PASS pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
      notes: [],
    },
    draftPullRequest: {
      title: "feat: implement issue #34",
      body: "body",
      branchName: "openclawcode/issue-34-scope-blocked-files",
      baseBranch: "main",
      number: 35,
      url: "https://github.com/zhyongrui/openclawcode/pull/35",
      openedAt: "2026-03-10T06:13:21.001Z",
    },
    verificationReport: {
      decision: "approve-for-human-review",
      summary: "The implementation matches issue #34.",
      findings: [],
      missingCoverage: [],
      followUps: [],
    },
  };
}

describe("openclaw plugin integration helpers", () => {
  it("accepts labeled issues that match the configured trigger labels", () => {
    const decision = decideIssueWebhookIntake({
      config: repoConfig,
      event: {
        action: "labeled",
        repository: {
          owner: "zhyongrui",
          name: "openclawcode",
        },
        issue: {
          number: 40,
          title: "Add chatops trigger",
          labels: [{ name: "bug" }, { name: "openclawcode:auto" }],
        },
        label: {
          name: "openclawcode:auto",
        },
      },
    });

    expect(decision.accept).toBe(true);
    expect(decision.issue?.labels).toEqual(["bug", "openclawcode:auto"]);
  });

  it("rejects issues that match a skip label", () => {
    const decision = decideIssueWebhookIntake({
      config: repoConfig,
      event: {
        action: "opened",
        repository: {
          owner: "zhyongrui",
          name: "openclawcode",
        },
        issue: {
          number: 41,
          title: "Needs manual handling",
          labels: [{ name: "openclawcode:auto" }, { name: "openclawcode:manual-only" }],
        },
      },
    });

    expect(decision.accept).toBe(false);
    expect(decision.reason).toContain("skip label");
  });

  it("rejects issues that do not match any trigger label", () => {
    const decision = decideIssueWebhookIntake({
      config: repoConfig,
      event: {
        action: "opened",
        repository: {
          owner: "zhyongrui",
          name: "openclawcode",
        },
        issue: {
          number: 42,
          title: "No trigger label",
          labels: [{ name: "bug" }],
        },
      },
    });

    expect(decision.accept).toBe(false);
    expect(decision.reason).toContain("trigger label");
  });

  it("prechecks obviously high-risk issues into escalation instead of approval", () => {
    const decision = decideIssueWebhookIntake({
      config: {
        ...repoConfig,
        triggerLabels: [],
      },
      event: {
        action: "opened",
        repository: {
          owner: "zhyongrui",
          name: "openclawcode",
        },
        issue: {
          number: 420,
          title: "Rotate auth secrets for webhook permissions",
          body: "Update authentication, secret handling, and permission checks.",
          labels: [{ name: "security" }],
        },
      },
    });

    expect(decision.accept).toBe(true);
    expect(decision.precheck).toMatchObject({
      decision: "escalate",
    });
    expect(decision.precheck?.summary).toContain("Webhook intake precheck escalated");
    expect(decision.precheck?.reasons).toEqual([
      "Issue text references high-risk areas: auth, secrets, security, permissions.",
    ]);
  });

  it("builds a cross-channel approval message with explicit commands", () => {
    const message = buildIssueApprovalMessage({
      config: repoConfig,
      issue: {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 43,
        title: "Add chatops status command",
        labels: ["openclawcode:auto", "enhancement"],
      },
    });

    expect(message).toContain("/occode-start zhyongrui/openclawcode#43");
    expect(message).toContain("/occode-skip zhyongrui/openclawcode#43");
    expect(message).toContain("auto-merge");
  });

  it("builds an escalation message for high-risk intake prechecks", () => {
    const message = buildIssueEscalationMessage({
      issue: {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 53,
        title: "Rotate auth secrets for webhook permissions",
      },
      summary: "Webhook intake precheck escalated the issue before chat approval.",
      reasons: ["Issue text references high-risk areas: auth, secrets, security, permissions."],
    });

    expect(message).toContain("escalated a new GitHub issue before chat approval");
    expect(message).toContain("/occode-status zhyongrui/openclawcode#53");
    expect(message).toContain("auth, secrets, security, permissions");
  });

  it("parses explicit and defaulted chatops commands", () => {
    expect(parseChatopsCommand("/occode-start zhyongrui/openclawcode#44")).toEqual({
      action: "start",
      issue: {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 44,
      },
    });

    expect(
      parseChatopsCommand("/occode-status #45", {
        owner: "zhyongrui",
        repo: "openclawcode",
      }),
    ).toEqual({
      action: "status",
      issue: {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 45,
      },
    });
  });

  it("derives a stable run request from a start command", () => {
    const request = buildRunRequestFromCommand({
      config: repoConfig,
      command: {
        action: "start",
        issue: {
          owner: "zhyongrui",
          repo: "openclawcode",
          number: 46,
        },
      },
    });

    expect(request).toEqual({
      owner: "zhyongrui",
      repo: "openclawcode",
      issueNumber: 46,
      repoRoot: "/home/zyr/pros/openclawcode",
      baseBranch: "main",
      branchName: "openclawcode/issue-46",
      builderAgent: "main",
      verifierAgent: "main",
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
      openPullRequest: true,
      mergeOnApprove: true,
    });
  });

  it("resolves plugin config and builds the final code-run argv", () => {
    const pluginConfig = resolveOpenClawCodePluginConfig({
      githubWebhookSecretEnv: "OPENCLAWCODE_GITHUB_WEBHOOK_SECRET",
      pollIntervalMs: 5000,
      repos: [
        {
          ...repoConfig,
          triggerMode: "auto",
        },
      ],
    });

    expect(pluginConfig.githubWebhookSecretEnv).toBe("OPENCLAWCODE_GITHUB_WEBHOOK_SECRET");
    expect(pluginConfig.pollIntervalMs).toBe(5000);
    expect(pluginConfig.repos).toHaveLength(1);
    expect(pluginConfig.repos[0]?.triggerMode).toBe("auto");

    const argv = buildOpenClawCodeRunArgv({
      owner: "zhyongrui",
      repo: "openclawcode",
      issueNumber: 47,
      repoRoot: "/home/zyr/pros/openclawcode",
      baseBranch: "main",
      branchName: "openclawcode/issue-47",
      builderAgent: "main",
      verifierAgent: "main",
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
      openPullRequest: true,
      mergeOnApprove: true,
    });

    expect(argv[1]).toContain("dist/index.js");
    expect(argv).toContain("--issue");
    expect(argv).toContain("47");
    expect(argv).toContain("--merge-on-approve");
    expect(argv).toContain("--json");
  });

  it("extracts workflow json even when logs appear before the payload", () => {
    const run = createRun();
    const parsed = extractWorkflowRunFromCommandOutput(
      `info: starting workflow\n${JSON.stringify(run, null, 2)}`,
    );

    expect(parsed?.id).toBe(run.id);
    expect(parsed?.draftPullRequest?.url).toBe(run.draftPullRequest?.url);
  });

  it("formats run status updates for chat notifications", () => {
    const message = buildRunStatusMessage(createRun());

    expect(message).toContain("zhyongrui/openclawcode#34");
    expect(message).toContain("Stage: Merged");
    expect(message).toContain("PR: https://github.com/zhyongrui/openclawcode/pull/35");
    expect(message).toContain("Verification: approve-for-human-review");
  });
});
