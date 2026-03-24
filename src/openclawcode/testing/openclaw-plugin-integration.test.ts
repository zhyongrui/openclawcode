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
  testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"],
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
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"],
      testResults: [
        "PASS pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
      ],
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
    suitability: {
      decision: "auto-run",
      summary:
        "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
      reasons: [
        "Issue stays within command-layer scope.",
        "Planner risk level is medium.",
        "No high-risk issue signals were detected in the issue text or labels.",
      ],
      classification: "command-layer",
      riskLevel: "medium",
      evaluatedAt: "2026-03-10T06:12:00.000Z",
    },
    blueprintContext: {
      path: "PROJECT-BLUEPRINT.md",
      status: "agreed",
      revisionId: "rev-2026-03-16",
      agreed: true,
      defaultedSectionCount: 1,
      workstreamCandidateCount: 2,
      openQuestionCount: 0,
      humanGateCount: 1,
    },
    roleRouting: {
      artifactExists: true,
      blueprintRevisionId: "rev-2026-03-16",
      mixedMode: true,
      fallbackConfigured: true,
      unresolvedRoleCount: 0,
      routes: [
        {
          roleId: "planner",
          adapterId: "claude-code",
          source: "blueprint",
          configured: true,
          fallbackChain: [],
        },
        {
          roleId: "coder",
          adapterId: "codex",
          source: "blueprint",
          configured: true,
          fallbackChain: ["claude-code"],
        },
        {
          roleId: "reviewer",
          adapterId: "claude-code",
          source: "blueprint",
          configured: true,
          fallbackChain: [],
        },
        {
          roleId: "verifier",
          adapterId: "openclaw-default",
          source: "default",
          configured: false,
          fallbackChain: [],
        },
        {
          roleId: "doc-writer",
          adapterId: "claude-code",
          source: "blueprint",
          configured: true,
          fallbackChain: [],
        },
      ],
    },
    runtimeRouting: {
      selections: [
        {
          roleId: "coder",
          adapterId: "codex",
          assignmentSource: "blueprint",
          configured: true,
          appliedAgentId: "codex-coder",
          agentSource: "adapter-env",
        },
        {
          roleId: "verifier",
          adapterId: "claude-code",
          assignmentSource: "blueprint",
          configured: true,
          appliedAgentId: "verifier-steered",
          agentSource: "stage-steering",
        },
      ],
    },
    stageGates: {
      artifactExists: true,
      blueprintRevisionId: "rev-2026-03-16",
      gateCount: 5,
      blockedGateCount: 0,
      needsHumanDecisionCount: 1,
      gates: [
        {
          gateId: "goal-agreement",
          readiness: "ready",
          decisionRequired: false,
          blockerCount: 0,
          suggestionCount: 0,
          latestDecision: {
            decision: "approved",
            note: "Goal is clear enough to proceed.",
            actor: "user",
            recordedAt: "2026-03-10T06:10:00.000Z",
          },
        },
        {
          gateId: "work-item-projection",
          readiness: "ready",
          decisionRequired: false,
          blockerCount: 0,
          suggestionCount: 1,
          latestDecision: null,
        },
        {
          gateId: "execution-routing",
          readiness: "ready",
          decisionRequired: false,
          blockerCount: 0,
          suggestionCount: 0,
          latestDecision: null,
        },
        {
          gateId: "execution-start",
          readiness: "ready",
          decisionRequired: false,
          blockerCount: 0,
          suggestionCount: 0,
          latestDecision: null,
        },
        {
          gateId: "merge-promotion",
          readiness: "needs-human-decision",
          decisionRequired: true,
          blockerCount: 0,
          suggestionCount: 1,
          latestDecision: null,
        },
      ],
    },
    handoffs: {
      entries: [
        {
          kind: "runtime-steering",
          recordedAt: "2026-03-10T06:12:30.000Z",
          summary: "stage=verifying | role=verifier | adapter=claude-code | agent=verifier-steered",
        },
      ],
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
      "Issue labels matched denylisted high-risk labels: security.",
      "Issue text references high-risk areas: auth, authentication, secret, security, permission.",
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
    expect(message).toContain("/occ-start zhyongrui/openclawcode#43");
    expect(message).toContain("/occode-skip zhyongrui/openclawcode#43");
    expect(message).toContain("/occ-skip zhyongrui/openclawcode#43");
    expect(message).toContain("/occ-status zhyongrui/openclawcode#43");
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
    expect(message).toContain("/occ-status zhyongrui/openclawcode#53");
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
    expect(parseChatopsCommand("/occ-rerun zhyongrui/openclawcode#46")).toEqual({
      action: "rerun",
      issue: {
        owner: "zhyongrui",
        repo: "openclawcode",
        number: 46,
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
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"],
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
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"],
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
    expect(message).toContain("Suitability: auto-run");
    expect(message).toContain(
      "Suitability summary: Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
    );
    expect(message).toContain(
      "Blueprint: status=agreed, revision=rev-2026-03-16, agreed=yes, openQuestions=0, humanGates=1",
    );
    expect(message).toContain(
      "Role routing: planner=claude-code, coder=codex, reviewer=claude-code, verifier=openclaw-default, doc-writer=claude-code, mixed=yes, unresolved=0, fallback=configured",
    );
    expect(message).toContain(
      "Stage gates: blocked=0, needsHuman=1, goal=ready, projection=ready, execution=ready, merge=needs-human-decision",
    );
    expect(message).toContain(
      "Runtime routing: coder=codex-coder | adapter=codex | source=adapter-env || verifier=verifier-steered | adapter=claude-code | source=stage-steering",
    );
    expect(message).toContain("Handoffs: runtime-steering=1");
    expect(message).toContain("PR: https://github.com/zhyongrui/openclawcode/pull/35");
    expect(message).toContain("Verification: approve-for-human-review");
  });

  it("prefers the latest failure note over stale build summaries for failed runs", () => {
    const message = buildRunStatusMessage({
      ...createRun(),
      stage: "failed",
      failureDiagnostics: {
        summary: "HTTP 400: Internal server error",
        provider: "crs",
        model: "gpt-5.4",
        systemPromptChars: 8629,
        skillsPromptChars: 1245,
        toolSchemaChars: 3030,
        toolCount: 4,
        skillCount: 1,
        injectedWorkspaceFileCount: 0,
        lastCallUsageTotal: 0,
        bootstrapWarningShown: false,
      },
      history: [...createRun().history, "Verification failed: HTTP 400: Internal server error"],
    });

    expect(message).toContain("Stage: Failed");
    expect(message).toContain("Summary: Verification failed: HTTP 400: Internal server error");
    expect(message).toContain(
      "diagnostics: model=crs/gpt-5.4, prompt=8629, skillsPrompt=1245, schema=3030, tools=4, skills=1, files=0, usage=0, bootstrap=clean",
    );
  });
});
