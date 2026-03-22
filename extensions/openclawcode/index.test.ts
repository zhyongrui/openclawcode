import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenClawCodeChatopsStore } from "../../src/integrations/openclaw-plugin/index.js";
import { setPreferredOperatorChatTarget } from "../../src/operator-chat-targets/store.js";
import {
  readProjectAutonomousLoopArtifact,
} from "../../src/openclawcode/autonomous-loop.js";
import {
  createProjectBlueprint,
  readProjectBlueprintDocument,
} from "../../src/openclawcode/blueprint.js";
import { readProjectBlueprintDiscussionArtifact } from "../../src/openclawcode/blueprint-discussion.js";
import type { WorkflowRun } from "../../src/openclawcode/contracts/index.js";
import { writeProjectDiscoveryInventory } from "../../src/openclawcode/discovery.js";
import { readProjectIssueMaterializationArtifact } from "../../src/openclawcode/issue-materialization.js";
import { readProjectProgressArtifact } from "../../src/openclawcode/project-progress.js";
import {
  readProjectStageGateArtifact,
  writeProjectStageGateArtifact,
} from "../../src/openclawcode/stage-gates.js";
import {
  readProjectWorkItemInventory,
  writeProjectWorkItemInventory,
} from "../../src/openclawcode/work-items.js";
import type {
  OpenClawPluginCommandDefinition,
  OpenClawPluginService,
} from "../../src/plugins/types.js";
import { createMockServerResponse } from "../../src/test-utils/mock-http-response.js";
import { createPluginRuntimeMock } from "../../test/helpers/extensions/plugin-runtime-mock.js";
import { onboardingOpenClawCodeDeps } from "../../src/wizard/setup.code.js";
import plugin from "./index.js";

const mocked = vi.hoisted(() => ({
  readRequestBodyWithLimit: vi.fn(),
  runMessageAction: vi.fn(),
  resolveOnboardingGitHubToken: vi.fn(() => null),
  startOnboardingGitHubCliDeviceLogin: vi.fn(),
  inspectOnboardingGitHubCliDeviceLogin: vi.fn(),
  createOnboardingRepositoryViaGh: vi.fn(),
  runOnboardingOpenClawCodeBootstrap: vi.fn(),
}));

vi.mock("../../src/infra/http-body.js", () => ({
  readRequestBodyWithLimit: mocked.readRequestBodyWithLimit,
}));

vi.mock("../../src/infra/outbound/message-action-runner.js", () => ({
  runMessageAction: mocked.runMessageAction,
}));

vi.mock("../../src/wizard/setup.code.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/wizard/setup.code.js")>();
  return {
    ...actual,
    resolveOnboardingGitHubToken: mocked.resolveOnboardingGitHubToken,
    startOnboardingGitHubCliDeviceLogin: mocked.startOnboardingGitHubCliDeviceLogin,
    inspectOnboardingGitHubCliDeviceLogin: mocked.inspectOnboardingGitHubCliDeviceLogin,
    createOnboardingRepositoryViaGh: mocked.createOnboardingRepositoryViaGh,
    runOnboardingOpenClawCodeBootstrap: mocked.runOnboardingOpenClawCodeBootstrap,
  };
});

function createApi(params: {
  stateDir: string;
  config?: Record<string, unknown>;
  pluginConfig: Record<string, unknown>;
  runtime: OpenClawPluginApi["runtime"];
  runCommandWithTimeout: ReturnType<typeof vi.fn>;
  registerCommand: (command: OpenClawPluginCommandDefinition) => void;
  registerHttpRoute: (params: {
    path: string;
    auth: "plugin" | "gateway";
    handler: (
      req: IncomingMessage,
      res: ReturnType<typeof createMockServerResponse>,
    ) => Promise<boolean>;
  }) => void;
  registerService: (service: OpenClawPluginService) => void;
}): OpenClawPluginApi {
  return {
    id: "openclawcode",
    name: "openclawcode",
    source: "test",
    config: params.config ?? {},
    pluginConfig: params.pluginConfig,
    runtime: params.runtime,
    logger: { info() {}, warn() {}, error() {} },
    registerTool() {},
    registerHook() {},
    registerHttpRoute: params.registerHttpRoute,
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService: params.registerService,
    registerProvider() {},
    registerContextEngine() {},
    registerCommand: params.registerCommand,
    resolvePath(input: string) {
      return input;
    },
    on() {},
  };
}

function localReq(input: {
  method: string;
  url: string;
  headers?: IncomingMessage["headers"];
}): IncomingMessage {
  return {
    ...input,
    headers: input.headers ?? {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

function issueWebhookPayload(issueNumber: number) {
  return JSON.stringify({
    action: "opened",
    repository: {
      owner: "zhyongrui",
      name: "openclawcode",
    },
    issue: {
      number: issueNumber,
      title: `Issue ${issueNumber}`,
      labels: [],
    },
  });
}

function issueWebhookPayloadWithOverrides(
  issueNumber: number,
  overrides: {
    title?: string;
    body?: string;
    labels?: Array<{ name: string }>;
  },
) {
  return JSON.stringify({
    action: "opened",
    repository: {
      owner: "zhyongrui",
      name: "openclawcode",
    },
    issue: {
      number: issueNumber,
      title: overrides.title ?? `Issue ${issueNumber}`,
      body: overrides.body,
      labels: overrides.labels ?? [],
    },
  });
}

function issueWebhookPayloadWithOwnerObject(issueNumber: number) {
  return JSON.stringify({
    action: "opened",
    repository: {
      owner: {
        login: "zhyongrui",
      },
      name: "openclawcode",
    },
    issue: {
      number: issueNumber,
      title: `Issue ${issueNumber}`,
      labels: [],
    },
  });
}

function blueprintFixtureContent(title: string) {
  return [
    "---",
    "schemaVersion: 1",
    `title: ${title}`,
    "status: agreed",
    "createdAt: 2026-03-16T00:00:00.000Z",
    "updatedAt: 2026-03-16T00:00:00.000Z",
    "statusChangedAt: 2026-03-16T00:00:00.000Z",
    "agreedAt: 2026-03-16T00:00:00.000Z",
    "---",
    "",
    `# ${title}`,
    "",
    "## Goal",
    "Exercise merge-promotion overrides from tests.",
    "",
    "## Success Criteria",
    "- Merge override can be approved from chat.",
    "",
    "## Scope",
    "- In scope: merge override tests.",
    "- Out of scope: live promotion.",
    "",
    "## Non-Goals",
    "- None.",
    "",
    "## Constraints",
    "- Keep artifacts deterministic.",
    "",
    "## Risks",
    "- None.",
    "",
    "## Assumptions",
    "- None.",
    "",
    "## Human Gates",
    "- Goal agreement: required",
    "- Merge or promotion: operator may intervene",
    "",
    "## Provider Strategy",
    "- Planner: Claude Code",
    "- Coder: Codex",
    "- Reviewer: Claude Code",
    "- Verifier: Codex",
    "- Doc-writer: Codex",
    "",
    "## Workstreams",
    "- Exercise merge override behavior.",
    "",
    "## Open Questions",
    "- None.",
    "",
    "## Change Log",
    "- 2026-03-16: merge override test fixture.",
    "",
  ].join("\n");
}

function pullRequestWebhookPayload(params: {
  pullRequestNumber: number;
  action?: string;
  state?: "open" | "closed";
  merged?: boolean;
  updatedAt?: string;
  mergedAt?: string | null;
  closedAt?: string | null;
}) {
  return JSON.stringify({
    action: params.action ?? "closed",
    repository: {
      owner: "zhyongrui",
      name: "openclawcode",
    },
    pull_request: {
      number: params.pullRequestNumber,
      html_url: `https://github.com/zhyongrui/openclawcode/pull/${params.pullRequestNumber}`,
      state: params.state ?? "closed",
      draft: false,
      merged: params.merged ?? false,
      merged_at: params.mergedAt ?? null,
      updated_at: params.updatedAt ?? "2026-03-11T02:00:00.000Z",
      closed_at: params.closedAt ?? params.updatedAt ?? "2026-03-11T02:00:00.000Z",
    },
  });
}

function pullRequestReviewWebhookPayload(params: {
  pullRequestNumber: number;
  reviewState: string;
  action?: string;
  submittedAt?: string;
  updatedAt?: string;
}) {
  return JSON.stringify({
    action: params.action ?? "submitted",
    repository: {
      owner: "zhyongrui",
      name: "openclawcode",
    },
    pull_request: {
      number: params.pullRequestNumber,
      html_url: `https://github.com/zhyongrui/openclawcode/pull/${params.pullRequestNumber}`,
      state: "open",
      draft: false,
      merged: false,
      updated_at: params.updatedAt ?? params.submittedAt ?? "2026-03-11T02:00:00.000Z",
    },
    review: {
      state: params.reviewState,
      submitted_at: params.submittedAt ?? "2026-03-11T02:00:00.000Z",
      html_url: `https://github.com/zhyongrui/openclawcode/pull/${params.pullRequestNumber}#pullrequestreview-1`,
    },
  });
}

function createGitHubIssueResponse(params: {
  issueNumber: number;
  title: string;
  body: string;
  labels?: string[];
}) {
  return {
    number: params.issueNumber,
    title: params.title,
    body: params.body,
    html_url: `https://github.com/zhyongrui/openclawcode/issues/${params.issueNumber}`,
    labels: (params.labels ?? []).map((name) => ({ name })),
  };
}

async function waitForAssertion(
  assertion: () => void | Promise<void>,
  attempts = 200,
): Promise<void> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function writeLocalRun(params: {
  repoRoot: string;
  issueNumber: number;
  stage: string;
  updatedAt?: string;
  summary?: string;
  prUrl?: string;
}) {
  const updatedAt = params.updatedAt ?? "2026-03-10T08:00:00.000Z";
  const runsDir = path.join(params.repoRoot, ".openclawcode", "runs");
  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `run-${params.issueNumber}.json`),
    `${JSON.stringify(
      {
        id: `run-${params.issueNumber}`,
        stage: params.stage,
        issue: {
          owner: "zhyongrui",
          repo: "openclawcode",
          number: params.issueNumber,
          title: `Issue ${params.issueNumber}`,
          labels: [],
        },
        createdAt: updatedAt,
        updatedAt,
        attempts: {
          total: 1,
          planning: 1,
          building: 1,
          verifying: 1,
        },
        stageRecords: [],
        history: [],
        buildResult: {
          branchName: `openclawcode/issue-${params.issueNumber}`,
          summary: params.summary ?? `Summary for issue ${params.issueNumber}`,
          changedFiles: ["src/example.ts"],
          issueClassification: "command-layer",
          testCommands: [],
          testResults: [],
          notes: [],
        },
        draftPullRequest: params.prUrl
          ? {
              title: `feat: implement issue #${params.issueNumber}`,
              body: "body",
              branchName: `openclawcode/issue-${params.issueNumber}`,
              baseBranch: "main",
              number: params.issueNumber,
              url: params.prUrl,
              openedAt: updatedAt,
            }
          : undefined,
        verificationReport: {
          decision: "approve-for-human-review",
          summary: params.summary ?? `Summary for issue ${params.issueNumber}`,
          findings: [],
          missingCoverage: [],
          followUps: [],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function buildTransientProviderFailedStatus(issueNumber: number): string {
  return [
    `openclawcode status for zhyongrui/openclawcode#${issueNumber}`,
    "Stage: Failed",
    "Summary: Build failed: HTTP 400: Internal server error",
  ].join("\n");
}

function createWorkflowRun(params: {
  issueNumber: number;
  stage?: WorkflowRun["stage"];
  updatedAt?: string;
  failureDiagnostics?: WorkflowRun["failureDiagnostics"];
  suitability?: WorkflowRun["suitability"];
  rerunContext?: WorkflowRun["rerunContext"];
  handoffs?: WorkflowRun["handoffs"];
}): WorkflowRun {
  const updatedAt = params.updatedAt ?? "2026-03-12T12:00:00.000Z";
  return {
    id: `run-${params.issueNumber}`,
    stage: params.stage ?? "ready-for-human-review",
    issue: {
      owner: "zhyongrui",
      repo: "openclawcode",
      number: params.issueNumber,
      title: `Issue ${params.issueNumber}`,
      labels: [],
    },
    createdAt: updatedAt,
    updatedAt,
    attempts: {
      total: 1,
      planning: 1,
      building: 1,
      verifying: 1,
    },
    stageRecords: [],
    history: [],
    workspace: {
      repoRoot: "/home/zyr/pros/openclawcode",
      baseBranch: "main",
      branchName: `openclawcode/issue-${params.issueNumber}`,
      worktreePath: `/tmp/openclawcode-${params.issueNumber}`,
      preparedAt: updatedAt,
    },
    buildResult: {
      branchName: `openclawcode/issue-${params.issueNumber}`,
      summary: `Summary for issue ${params.issueNumber}`,
      changedFiles: ["src/example.ts"],
      issueClassification: "command-layer",
      testCommands: [],
      testResults: [],
      notes: [],
    },
    verificationReport: {
      decision: "approve-for-human-review",
      summary: `Summary for issue ${params.issueNumber}`,
      findings: [],
      missingCoverage: [],
      followUps: [],
    },
    rerunContext: params.rerunContext,
    handoffs: params.handoffs,
    suitability: params.suitability,
    failureDiagnostics: params.failureDiagnostics,
  };
}

async function registerPluginFixture(params?: {
  triggerMode?: "approve" | "auto";
  repoRoot?: string;
  pollIntervalMs?: number;
  mergeOnApprove?: boolean;
  config?: Record<string, unknown>;
  pluginConfigOverride?: Record<string, unknown>;
}) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-plugin-test-"));
  const repoRoot =
    params?.repoRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-plugin-repo-")));
  const commands = new Map<string, OpenClawPluginCommandDefinition>();
  const runCommandWithTimeout = vi.fn();
  const runtime = createPluginRuntimeMock({
    state: {
      resolveStateDir: () => stateDir,
    },
    system: {
      runCommandWithTimeout,
    },
  }) as unknown as OpenClawPluginApi["runtime"];
  let service: OpenClawPluginService | undefined;
  let route:
    | {
        path: string;
        auth: "plugin" | "gateway";
        handler: (
          req: IncomingMessage,
          res: ReturnType<typeof createMockServerResponse>,
        ) => Promise<boolean>;
      }
    | undefined;
  const pluginConfig = {
    repos: [
      {
        owner: "zhyongrui",
        repo: "openclawcode",
        repoRoot,
        baseBranch: "main",
        triggerMode: params?.triggerMode ?? "approve",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        builderAgent: "main",
        verifierAgent: "main",
        testCommands: [
          "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
        ],
        mergeOnApprove: params?.mergeOnApprove,
        pollIntervalMs: params?.pollIntervalMs,
      },
    ],
    pollIntervalMs: params?.pollIntervalMs,
    ...(params?.pluginConfigOverride ?? {}),
  };

  plugin.register?.(
    createApi({
      stateDir,
      config: params?.config,
      runtime,
      pluginConfig,
      runCommandWithTimeout,
      registerCommand(command) {
        commands.set(command.name, command);
      },
      registerHttpRoute(params) {
        route = params;
      },
      registerService(registered) {
        service = registered;
      },
    }),
  );

  return {
    repoRoot,
    stateDir,
    runtime,
    pluginConfig,
    store: OpenClawCodeChatopsStore.fromStateDir(stateDir),
    commands,
    route,
    service,
    runCommandWithTimeout,
  };
}

async function cleanupPluginFixture(fixture: Awaited<ReturnType<typeof registerPluginFixture>>) {
  await fixture.service?.stop?.({
    config: {},
    stateDir: fixture.stateDir,
    logger: { info() {}, warn() {}, error() {} },
  });
  await fixture.store.snapshot();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await fs.rm(fixture.repoRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 20,
  });
  await fs.rm(fixture.stateDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 20,
  });
}

describe("openclawcode extension", () => {
  beforeEach(() => {
    mocked.readRequestBodyWithLimit.mockReset();
    mocked.runMessageAction.mockReset();
    mocked.runMessageAction.mockResolvedValue({ kind: "send" });
    mocked.resolveOnboardingGitHubToken.mockReset();
    mocked.resolveOnboardingGitHubToken.mockReturnValue(null);
    mocked.startOnboardingGitHubCliDeviceLogin.mockReset();
    mocked.inspectOnboardingGitHubCliDeviceLogin.mockReset();
    mocked.createOnboardingRepositoryViaGh.mockReset();
    mocked.runOnboardingOpenClawCodeBootstrap.mockReset();
    mocked.runOnboardingOpenClawCodeBootstrap.mockResolvedValue({
      repo: {
        owner: "zhyongrui",
        repo: "openclawcode",
        repoKey: "zhyongrui/openclawcode",
        repoRoot: "/home/zyr/pros/openclawcode-target",
        checkoutAction: "cloned",
      },
      blueprint: {
        blueprintPath: "/home/zyr/pros/openclawcode-target/PROJECT-BLUEPRINT.md",
        status: "clarified",
        revisionId: "rev-1",
      },
      handoff: {
        cliRunCommand:
          "openclaw code run --issue <issue-number> --owner zhyongrui --repo openclawcode",
        blueprintCommand: "/occode-blueprint zhyongrui/openclawcode",
        blueprintClarifyCommand:
          "openclaw code blueprint-clarify --repo-root /home/zyr/pros/openclawcode-target --json",
        blueprintAgreeCommand:
          "openclaw code blueprint-set-status --repo-root /home/zyr/pros/openclawcode-target --status agreed --json",
        blueprintDecomposeCommand:
          "openclaw code blueprint-decompose --repo-root /home/zyr/pros/openclawcode-target --json",
        gatesCommand: "/occode-gates zhyongrui/openclawcode",
      },
      nextAction: "clarify-project-blueprint",
      proofReadiness: {
        cliProofReady: true,
        chatProofReady: false,
        recommendedProofMode: "cli-only",
      },
    });
    onboardingOpenClawCodeDeps.fetchAuthenticatedViewer = vi.fn(
      async () => ({ login: "zhyongrui" }),
    );
    onboardingOpenClawCodeDeps.fetchRepositorySummary = vi.fn(async (_token, repoRef) => ({
      owner: repoRef.owner,
      repo: repoRef.repo,
      private: true,
      url: `https://github.com/${repoRef.owner}/${repoRef.repo}`,
    }));
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("records pending approvals and sends a chat prompt in approve mode", async () => {
    const fixture = await registerPluginFixture();
    try {
      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(201));
      const res = createMockServerResponse();

      const handled = await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-201-a",
          },
        }),
        res,
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        issue: "zhyongrui/openclawcode#201",
      });
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        action: "send",
        params: expect.objectContaining({
          channel: "telegram",
          to: "chat:primary",
          message: expect.stringContaining("/occode-start zhyongrui/openclawcode#201"),
        }),
      });

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingApprovals).toEqual([
        {
          issueKey: "zhyongrui/openclawcode#201",
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
        },
      ]);
      expect(snapshot.queue).toEqual([]);
    } finally {
      await fixture.service?.stop?.({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("prechecks obviously high-risk issues into escalated snapshots instead of pending approvals", async () => {
    const fixture = await registerPluginFixture();
    try {
      mocked.readRequestBodyWithLimit.mockResolvedValue(
        issueWebhookPayloadWithOverrides(2053, {
          title: "Rotate auth secrets for webhook permissions",
          body: "Update authentication, secret handling, and permission checks.",
          labels: [{ name: "security" }],
        }),
      );
      const res = createMockServerResponse();

      const handled = await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-2053-a",
          },
        }),
        res,
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        reason: "precheck-escalated",
        issue: "zhyongrui/openclawcode#2053",
        suitabilityDecision: "escalate",
      });
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        action: "send",
        params: expect.objectContaining({
          channel: "telegram",
          to: "chat:primary",
          message: expect.stringContaining("escalated a new GitHub issue before chat approval"),
        }),
      });

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.queue).toEqual([]);
      expect(snapshot.statusSnapshotsByIssue["zhyongrui/openclawcode#2053"]).toMatchObject({
        stage: "escalated",
        issueNumber: 2053,
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        suitabilityDecision: "escalate",
      });
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#2053"]).toContain(
        "Webhook intake precheck escalated the issue before chat approval",
      );
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#2053"]).toContain(
        "Suitability: escalate",
      );
    } finally {
      await fixture.service?.stop?.({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });
      await fixture.store.snapshot();
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("accepts the real GitHub repository owner object shape", async () => {
    const fixture = await registerPluginFixture();
    try {
      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayloadWithOwnerObject(210));
      const res = createMockServerResponse();

      const handled = await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-210-a",
          },
        }),
        res,
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        issue: "zhyongrui/openclawcode#210",
      });
      expect(await fixture.store.getPendingApproval("zhyongrui/openclawcode#210")).toEqual({
        issueKey: "zhyongrui/openclawcode#210",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("returns webhook acceptance without waiting for chat notification delivery", async () => {
    const fixture = await registerPluginFixture();
    try {
      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(211));
      mocked.runMessageAction.mockImplementation(
        () => new Promise(() => undefined) as Promise<never>,
      );
      const res = createMockServerResponse();

      const handled = await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-211-a",
          },
        }),
        res,
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        issue: "zhyongrui/openclawcode#211",
      });
      expect(await fixture.store.getPendingApproval("zhyongrui/openclawcode#211")).toEqual({
        issueKey: "zhyongrui/openclawcode#211",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("ignores a repeated GitHub delivery id before it can retrigger intake", async () => {
    const fixture = await registerPluginFixture();
    try {
      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(202));

      const firstRes = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-202-a",
          },
        }),
        firstRes,
      );

      const secondRes = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-202-a",
          },
        }),
        secondRes,
      );

      expect(JSON.parse(String(secondRes.body))).toMatchObject({
        accepted: false,
        reason: "duplicate-delivery",
        issue: "zhyongrui/openclawcode#202",
        delivery: "delivery-202-a",
        previousReason: "announced-for-approval",
      });
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("keeps already-tracked semantics for a new delivery on the same issue", async () => {
    const fixture = await registerPluginFixture();
    try {
      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(203));

      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-203-a",
          },
        }),
        createMockServerResponse(),
      );

      const secondRes = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-203-b",
          },
        }),
        secondRes,
      );

      expect(JSON.parse(String(secondRes.body))).toMatchObject({
        accepted: false,
        reason: "already-tracked",
        issue: "zhyongrui/openclawcode#203",
      });
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("applies approved review webhook events to tracked snapshots and notifies the original chat target", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setRepoBinding({
        repoKey: "zhyongrui/openclawcode",
        notifyChannel: "feishu",
        notifyTarget: "user:bound-chat",
      });
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#212",
        status: "openclawcode status for zhyongrui/openclawcode#212\nStage: Changes Requested",
        stage: "changes-requested",
        runId: "run-212",
        updatedAt: "2026-03-11T01:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 212,
        branchName: "openclawcode/issue-212",
        pullRequestNumber: 312,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/312",
        notifyChannel: "telegram",
        notifyTarget: "chat:original",
      });
      mocked.readRequestBodyWithLimit.mockResolvedValue(
        pullRequestReviewWebhookPayload({
          pullRequestNumber: 312,
          reviewState: "approved",
          submittedAt: "2026-03-11T02:15:00.000Z",
        }),
      );

      const res = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "pull_request_review",
            "x-github-delivery": "delivery-212-review-a",
          },
        }),
        res,
      );

      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        reason: "review-approved",
        issue: "zhyongrui/openclawcode#212",
        pullRequest: 312,
      });
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        params: expect.objectContaining({
          channel: "telegram",
          to: "chat:original",
          message: expect.stringContaining("Stage: Ready For Human Review"),
        }),
      });
      expect(await fixture.store.getGitHubDelivery("delivery-212-review-a")).toMatchObject({
        eventName: "pull_request_review",
        reason: "review-approved",
        issueKey: "zhyongrui/openclawcode#212",
        pullRequestNumber: 312,
      });
      await waitForAssertion(async () => {
        expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#212")).toMatchObject({
          stage: "ready-for-human-review",
          updatedAt: "2026-03-11T02:15:00.000Z",
          notifyChannel: "telegram",
          notifyTarget: "chat:original",
          lastNotificationChannel: "telegram",
          lastNotificationTarget: "chat:original",
          lastNotificationStatus: "sent",
        });
      });
      expect(
        (await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#212"))?.lastNotificationAt,
      ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("auto-merges after an approved review when mergeOnApprove is enabled and policy allows it", async () => {
    const fixture = await registerPluginFixture({ mergeOnApprove: true });
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ merged: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: "closed" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#312",
        status: "openclawcode status for zhyongrui/openclawcode#312\nStage: Changes Requested",
        stage: "changes-requested",
        runId: "run-312",
        updatedAt: "2026-03-11T01:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 312,
        branchName: "openclawcode/issue-312",
        pullRequestNumber: 412,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/412",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        autoMergePolicyEligible: true,
        autoMergePolicyReason: "Eligible for auto-merge under the current command-layer policy.",
      });
      mocked.readRequestBodyWithLimit.mockResolvedValue(
        pullRequestReviewWebhookPayload({
          pullRequestNumber: 412,
          reviewState: "approved",
          submittedAt: "2026-03-11T02:15:00.000Z",
        }),
      );

      const res = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "pull_request_review",
            "x-github-delivery": "delivery-312-review-a",
          },
        }),
        res,
      );

      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        reason: "review-approved-auto-merged",
        issue: "zhyongrui/openclawcode#312",
        pullRequest: 412,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.github.com/repos/zhyongrui/openclawcode/pulls/412/merge",
      );
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        "https://api.github.com/repos/zhyongrui/openclawcode/issues/312",
      );
      await waitForAssertion(async () => {
        expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#312")).toMatchObject({
          stage: "merged",
          autoMergeDisposition: "merged",
        });
      });
      expect(mocked.runMessageAction.mock.calls.at(-1)?.[0]).toMatchObject({
        params: expect.objectContaining({
          message: expect.stringContaining("Stage: Merged"),
        }),
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("uses an approved merge-promotion gate to override a blocked auto-merge policy after review approval", async () => {
    const fixture = await registerPluginFixture({ mergeOnApprove: true });
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ merged: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: "closed" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        blueprintFixtureContent("Merge Override Blueprint"),
        "utf8",
      );
      await writeProjectStageGateArtifact(fixture.repoRoot);
      await fixture.commands.get("occode-gate-decide")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-gate-decide merge-promotion approved allow merge override",
        args: "merge-promotion approved allow merge override",
        config: {},
      });

      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#313",
        status: "openclawcode status for zhyongrui/openclawcode#313\nStage: Changes Requested",
        stage: "changes-requested",
        runId: "run-313",
        updatedAt: "2026-03-11T01:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 313,
        branchName: "openclawcode/issue-313",
        pullRequestNumber: 413,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/413",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
        autoMergePolicyEligible: false,
        autoMergePolicyReason:
          "Not eligible for auto-merge: the run is not classified as command-layer.",
      });
      mocked.readRequestBodyWithLimit.mockResolvedValue(
        pullRequestReviewWebhookPayload({
          pullRequestNumber: 413,
          reviewState: "approved",
          submittedAt: "2026-03-11T02:15:00.000Z",
        }),
      );

      const res = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "pull_request_review",
            "x-github-delivery": "delivery-313-review-a",
          },
        }),
        res,
      );

      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        reason: "review-approved-override-merged",
        issue: "zhyongrui/openclawcode#313",
        pullRequest: 413,
      });
      await waitForAssertion(async () => {
        expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#313")).toMatchObject({
          stage: "merged",
          autoMergeDisposition: "merged",
          autoMergeDispositionReason: expect.stringContaining("merge-promotion override"),
        });
      });
      expect(mocked.runMessageAction.mock.calls.at(-1)?.[0]).toMatchObject({
        params: expect.objectContaining({
          message: expect.stringContaining("override"),
        }),
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("applies changes-requested review webhook events using the repo binding when no snapshot target is stored", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setRepoBinding({
        repoKey: "zhyongrui/openclawcode",
        notifyChannel: "feishu",
        notifyTarget: "user:bound-chat",
      });
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#213",
        status: "openclawcode status for zhyongrui/openclawcode#213\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-213",
        updatedAt: "2026-03-11T01:05:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 213,
        branchName: "openclawcode/issue-213",
        pullRequestNumber: 313,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/313",
      });
      mocked.readRequestBodyWithLimit.mockResolvedValue(
        pullRequestReviewWebhookPayload({
          pullRequestNumber: 313,
          reviewState: "changes_requested",
          submittedAt: "2026-03-11T02:20:00.000Z",
        }),
      );

      const res = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "pull_request_review",
            "x-github-delivery": "delivery-213-review-a",
          },
        }),
        res,
      );

      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        reason: "review-changes-requested",
        issue: "zhyongrui/openclawcode#213",
        pullRequest: 313,
      });
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        params: expect.objectContaining({
          channel: "feishu",
          to: "user:bound-chat",
          message: expect.stringContaining("Stage: Changes Requested"),
        }),
      });
      await waitForAssertion(async () => {
        expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#213")).toMatchObject({
          stage: "changes-requested",
          updatedAt: "2026-03-11T02:20:00.000Z",
          notifyChannel: "feishu",
          notifyTarget: "user:bound-chat",
          lastNotificationChannel: "feishu",
          lastNotificationTarget: "user:bound-chat",
          lastNotificationStatus: "sent",
        });
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("applies merged pull request webhook events and deduplicates repeated lifecycle deliveries", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#214",
        status: "openclawcode status for zhyongrui/openclawcode#214\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-214",
        updatedAt: "2026-03-11T01:10:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 214,
        branchName: "openclawcode/issue-214",
        pullRequestNumber: 314,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/314",
        notifyChannel: "telegram",
        notifyTarget: "chat:merge-target",
      });
      mocked.readRequestBodyWithLimit.mockResolvedValue(
        pullRequestWebhookPayload({
          pullRequestNumber: 314,
          merged: true,
          updatedAt: "2026-03-11T02:25:00.000Z",
          mergedAt: "2026-03-11T02:25:00.000Z",
        }),
      );

      const firstRes = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "pull_request",
            "x-github-delivery": "delivery-214-pr-a",
          },
        }),
        firstRes,
      );

      expect(JSON.parse(String(firstRes.body))).toMatchObject({
        accepted: true,
        reason: "pull-request-merged",
        issue: "zhyongrui/openclawcode#214",
        pullRequest: 314,
      });

      const secondRes = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "pull_request",
            "x-github-delivery": "delivery-214-pr-a",
          },
        }),
        secondRes,
      );

      expect(JSON.parse(String(secondRes.body))).toMatchObject({
        accepted: false,
        reason: "duplicate-delivery",
        issue: "zhyongrui/openclawcode#214",
        pullRequest: 314,
        delivery: "delivery-214-pr-a",
        previousReason: "pull-request-merged",
      });
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        params: expect.objectContaining({
          channel: "telegram",
          to: "chat:merge-target",
          message: expect.stringContaining("Stage: Merged"),
        }),
      });
      expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#214")).toMatchObject({
        stage: "merged",
        updatedAt: "2026-03-11T02:25:00.000Z",
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("applies closed-without-merge pull request webhook events to tracked snapshots", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#215",
        status: "openclawcode status for zhyongrui/openclawcode#215\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-215",
        updatedAt: "2026-03-11T01:12:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 215,
        branchName: "openclawcode/issue-215",
        pullRequestNumber: 315,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/315",
      });
      mocked.readRequestBodyWithLimit.mockResolvedValue(
        pullRequestWebhookPayload({
          pullRequestNumber: 315,
          merged: false,
          updatedAt: "2026-03-11T02:30:00.000Z",
          closedAt: "2026-03-11T02:30:00.000Z",
        }),
      );

      const res = createMockServerResponse();
      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "pull_request",
            "x-github-delivery": "delivery-215-pr-a",
          },
        }),
        res,
      );

      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        reason: "pull-request-closed-without-merge",
        issue: "zhyongrui/openclawcode#215",
        pullRequest: 315,
      });
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        params: expect.objectContaining({
          message: expect.stringContaining("Stage: Escalated"),
        }),
      });
      expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#215")).toMatchObject({
        stage: "escalated",
        updatedAt: "2026-03-11T02:30:00.000Z",
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("queues issue runs immediately in auto mode", async () => {
    const fixture = await registerPluginFixture({ triggerMode: "auto" });
    try {
      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(203));
      const res = createMockServerResponse();

      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-204-a",
          },
        }),
        res,
      );

      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        issue: "zhyongrui/openclawcode#203",
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.queue[0]?.issueKey).toBe("zhyongrui/openclawcode#203");
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#203"]).toBe(
        "Auto-started from issue webhook.",
      );
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        params: expect.objectContaining({
          message: expect.stringContaining("auto-started"),
        }),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("starts auto-enqueued issues immediately once the runner service is active", async () => {
    const fixture = await registerPluginFixture({ triggerMode: "auto", pollIntervalMs: 60_000 });
    let resolveRun: ((value: { code: number; stdout: string; stderr: string }) => void) | undefined;
    try {
      fixture.runCommandWithTimeout.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRun = resolve;
          }),
      );
      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(204));
      const res = createMockServerResponse();

      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-204-b",
          },
        }),
        res,
      );

      await waitForAssertion(async () => {
        expect(fixture.runCommandWithTimeout).toHaveBeenCalledTimes(1);
        const snapshot = await fixture.store.snapshot();
        expect(snapshot.currentRun?.issueKey).toBe("zhyongrui/openclawcode#204");
      });
      expect(
        mocked.runMessageAction.mock.calls.some((call) =>
          String(call[0]?.params?.message ?? "").includes(
            "openclawcode is starting zhyongrui/openclawcode#204.",
          ),
        ),
      ).toBe(true);

      resolveRun?.({
        code: 0,
        stdout: JSON.stringify(
          createWorkflowRun({
            issueNumber: 204,
            stage: "ready-for-human-review",
            updatedAt: "2026-03-12T12:10:00.000Z",
          }),
        ),
        stderr: "",
      });

      await waitForAssertion(async () => {
        const snapshot = await fixture.store.snapshot();
        expect(snapshot.currentRun).toBeUndefined();
        expect(await fixture.store.getStatus("zhyongrui/openclawcode#204")).toContain(
          "Stage: Ready For Human Review",
        );
        expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#204")).toMatchObject({
          lastNotificationStatus: "sent",
        });
      });
    } finally {
      resolveRun?.({
        code: 0,
        stdout: JSON.stringify(createWorkflowRun({ issueNumber: 204 })),
        stderr: "",
      });
      await cleanupPluginFixture(fixture);
    }
  });

  it("mentions an active provider pause when auto mode queues a webhook issue", async () => {
    const fixture = await registerPluginFixture({ triggerMode: "auto" });
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6201,
          stage: "failed",
          updatedAt: "2099-03-12T12:00:00.000Z",
        }),
        buildTransientProviderFailedStatus(6201),
      );
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6202,
          stage: "failed",
          updatedAt: "2099-03-12T12:05:00.000Z",
        }),
        buildTransientProviderFailedStatus(6202),
      );
      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(205));
      const res = createMockServerResponse();

      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-205-a",
          },
        }),
        res,
      );

      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        reason: "auto-enqueued",
        issue: "zhyongrui/openclawcode#205",
      });
      expect(
        mocked.runMessageAction.mock.calls.some((call) =>
          String(call[0]?.params?.message ?? "").includes("Provider pause: active until"),
        ),
      ).toBe(true);
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.currentRun).toBeUndefined();
      expect(snapshot.queue.map((entry) => entry.issueKey)).toEqual(["zhyongrui/openclawcode#205"]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("holds auto webhook issues for execution-start gate approval when the gate is not ready", async () => {
    const fixture = await registerPluginFixture({ triggerMode: "auto" });
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Auto Gate Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Auto Gate Blueprint",
          "",
          "## Goal",
          "Stop auto execution when the execution-start gate still needs a human decision.",
          "",
          "## Success Criteria",
          "- Auto webhook intake waits for gate approval instead of queueing immediately.",
          "",
          "## Scope",
          "- In scope: gate-aware auto intake.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Preserve deterministic gate output.",
          "",
          "## Risks",
          "- Auto execution may start too early without a gate check.",
          "",
          "## Assumptions",
          "- A human can approve the gate from chat.",
          "",
          "## Human Gates",
          "- Execution start: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: OpenClaw Default",
          "- Doc-writer: Claude Code",
          "",
          "## Workstreams",
          "- Gate auto webhook intake on execution-start.",
          "",
          "## Open Questions",
          "- Should the operator accept the remaining risk now?",
          "",
          "## Change Log",
          "- 2026-03-16: gate-aware auto intake test.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await writeProjectDiscoveryInventory(fixture.repoRoot);

      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(206));
      const res = createMockServerResponse();

      await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-206-a",
          },
        }),
        res,
      );

      expect(JSON.parse(String(res.body))).toMatchObject({
        accepted: true,
        reason: "execution-start-gated",
        issue: "zhyongrui/openclawcode#206",
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toEqual([]);
      expect(snapshot.pendingApprovals).toEqual([
        {
          issueKey: "zhyongrui/openclawcode#206",
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
          approvalKind: "execution-start-gated",
        },
      ]);
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#206"]).toBe(
        "Awaiting execution-start gate approval.",
      );
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        params: expect.objectContaining({
          message: expect.stringContaining("execution start is currently gated"),
        }),
      });

      const decision = await fixture.commands.get("occode-gate-decide")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-gate-decide execution-start approved Accepted for this run",
        args: "execution-start approved Accepted for this run",
        senderId: "user:operator",
        config: {},
      });

      expect(decision?.text).toContain("Decision: approved");
      expect(decision?.text).toContain("Readiness: ready");
      expect(decision?.text).toContain("Resumed held executions: 1");
      const resumed = await fixture.store.snapshot();
      expect(resumed.pendingApprovals).toEqual([]);
      expect(resumed.queue).toHaveLength(1);
      expect(resumed.statusByIssue["zhyongrui/openclawcode#206"]).toBe(
        "Execution-start gate approved and queued.",
      );
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("creates and queues a low-risk issue through /occode-intake", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createGitHubIssueResponse({
              issueNumber: 220,
              title: "[Feature]: Expose issueCount in openclaw code run --json output",
              body: "Summary\nAdd a stable top-level issueCount field.",
            }),
          ),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "[Feature]: Expose issueCount in openclaw code run --json output",
          "Summary",
          "Add a stable top-level issueCount field.",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://api.github.com/repos/zhyongrui/openclawcode/issues",
      );
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: "POST",
      });
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        title: "[Feature]: Expose issueCount in openclaw code run --json output",
        body: "Summary\nAdd a stable top-level issueCount field.",
      });
      expect(result).toEqual({
        text: [
          "openclawcode created and queued a new GitHub issue from chat.",
          "Issue: zhyongrui/openclawcode#220",
          "Title: [Feature]: Expose issueCount in openclaw code run --json output",
          "URL: https://github.com/zhyongrui/openclawcode/issues/220",
          "Status: queued for execution",
          "Use /occode-status zhyongrui/openclawcode#220 to inspect progress.",
        ].join("\n"),
      });

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.queue[0]).toMatchObject({
        issueKey: "zhyongrui/openclawcode#220",
        notifyChannel: "feishu",
        notifyTarget: "user:intake-chat",
        request: {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 220,
          branchName: "openclawcode/issue-220",
        },
      });
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#220"]).toBe("Queued from chat intake.");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("creates but does not queue /occode-intake issues when execution-start is gated", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Intake Gate Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Intake Gate Blueprint",
          "",
          "## Goal",
          "Create issues from chat without auto-queueing them when execution-start still needs approval.",
          "",
          "## Success Criteria",
          "- /occode-intake creates the issue but stops before queueing.",
          "",
          "## Scope",
          "- In scope: gate-aware chat intake.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Preserve the created issue link in the response.",
          "",
          "## Risks",
          "- Queueing too early could bypass human intent.",
          "",
          "## Assumptions",
          "- Operators can approve the gate from chat.",
          "",
          "## Human Gates",
          "- Execution start: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: OpenClaw Default",
          "- Doc-writer: Claude Code",
          "",
          "## Workstreams",
          "- Gate chat intake before queueing work.",
          "",
          "## Open Questions",
          "- Should the operator accept the remaining execution-start risk now?",
          "",
          "## Change Log",
          "- 2026-03-16: gate-aware intake test.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await writeProjectDiscoveryInventory(fixture.repoRoot);

      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createGitHubIssueResponse({
              issueNumber: 223,
              title: "[Feature]: Expose issueCount in openclaw code run --json output",
              body: "Summary\nAdd a stable top-level issueCount field.",
            }),
          ),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "[Feature]: Expose issueCount in openclaw code run --json output",
          "Summary",
          "Add a stable top-level issueCount field.",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(result?.text).toContain(
        "openclawcode created a new GitHub issue from chat, but execution start is currently gated.",
      );
      expect(result?.text).toContain("Issue: zhyongrui/openclawcode#223");
      expect(result?.text).toContain("Gate: execution-start");

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toEqual([]);
      expect(snapshot.pendingApprovals).toEqual([
        {
          issueKey: "zhyongrui/openclawcode#223",
          notifyChannel: "feishu",
          notifyTarget: "user:intake-chat",
          approvalKind: "execution-start-gated",
        },
      ]);
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#223"]).toBe(
        "Awaiting execution-start gate approval.",
      );
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("prechecks high-risk /occode-intake issues into escalated snapshots", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify(
              createGitHubIssueResponse({
                issueNumber: 221,
                title: "Rotate auth secrets for webhook permissions",
                body: "Update authentication, secret handling, and permission checks.",
                labels: ["security"],
              }),
            ),
            {
              status: 201,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      const result = await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Rotate auth secrets for webhook permissions",
          "Update authentication, secret handling, and permission checks.",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode created a new GitHub issue from chat, but suitability escalated it immediately.",
          "Issue: zhyongrui/openclawcode#221",
          "Title: Rotate auth secrets for webhook permissions",
          "URL: https://github.com/zhyongrui/openclawcode/issues/221",
          "Summary: Webhook intake precheck escalated the issue before chat approval. Issue labels matched denylisted high-risk labels: security.",
          "Escalation path: human review required before execution.",
          "Use /occode-status zhyongrui/openclawcode#221 to inspect the tracked status.",
          "Use /occode-start-override zhyongrui/openclawcode#221 only after a human accepts a one-run exception.",
        ].join("\n"),
      });

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toEqual([]);
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.statusSnapshotsByIssue["zhyongrui/openclawcode#221"]).toMatchObject({
        stage: "escalated",
        issueNumber: 221,
        notifyChannel: "feishu",
        notifyTarget: "user:intake-chat",
        suitabilityDecision: "escalate",
      });
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#221"]).toContain(
        "Webhook intake precheck escalated the issue before chat approval",
      );
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#221"]).toContain(
        "Next: /occode-start-override zhyongrui/openclawcode#221 only after a human accepts a one-run exception.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("turns a one-line /occode-intake request into a pending draft with clarification prompts", async () => {
    const fixture = await registerPluginFixture();
    try {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Expose issueCount in openclaw code run --json output",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(result?.text).toContain("waiting for confirmation");
      expect(result?.text).toContain("Intake mode: feature");
      expect(result?.text).toContain(
        "Priority question: What exact behavior, contract, or operator surface should change?",
      );
      expect(result?.text).toContain("Clarifications: 3");
      expect(result?.text).toContain(
        "Use /occode-intake-answer zhyongrui/openclawcode [index] <answer...>",
      );
      expect(result?.text).toContain("Use /occode-intake-confirm zhyongrui/openclawcode");
      expect(fetchMock).not.toHaveBeenCalled();

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingIntakeDrafts).toHaveLength(1);
      expect(snapshot.pendingIntakeDrafts[0]).toMatchObject({
        repoKey: "zhyongrui/openclawcode",
        title: "Expose issueCount in openclaw code run --json output",
        bodySynthesized: true,
        scopedDrafts: [],
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shapes one-line bug-fix intake into a triage-first pending draft", async () => {
    const fixture = await registerPluginFixture();
    try {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Fix duplicate issue materialization after blueprint edits",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(result?.text).toContain("waiting for confirmation");
      expect(result?.text).toContain("Intake mode: bugfix");
      expect(result?.text).toContain("Priority question: What is the observed behavior right now?");
      expect(result?.text).toContain("Clarifications: 3");
      expect(result?.text).toContain(
        "Capture observed behavior, expected behavior, and the smallest reproduction before confirming the draft.",
      );
      expect(fetchMock).not.toHaveBeenCalled();

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingIntakeDrafts[0]).toMatchObject({
        title: "Fix duplicate issue materialization after blueprint edits",
        bodySynthesized: true,
      });
      expect(snapshot.pendingIntakeDrafts[0]?.body).toContain("Observed behavior");
      expect(snapshot.pendingIntakeDrafts[0]?.body).toContain("Regression proof");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("records clarification answers into the pending chat intake draft before confirmation", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createGitHubIssueResponse({
              issueNumber: 224,
              title: "Expose issueCount in openclaw code run --json output",
              body: [
                "Summary",
                "Expose issueCount in openclaw code run --json output",
                "",
                "Problem to solve",
                "This issue was drafted directly from chat intake and needs the workflow to translate the request into the concrete code change.",
                "",
                "Requested from chat intake",
                "Expose issueCount in openclaw code run --json output",
                "",
                "Clarifications from operator",
                "",
                "Q: What exact behavior, contract, or operator surface should change?",
                "A: Add a stable top-level `issueCount` mirror to `openclaw code run --json`.",
              ].join("\n"),
            }),
          ),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Expose issueCount in openclaw code run --json output",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      const answered = await fixture.commands.get("occode-intake-answer")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake-answer",
          "Add a stable top-level `issueCount` mirror to `openclaw code run --json`.",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(answered?.text).toContain("recording a clarification answer");
      expect(answered?.text).toContain("Clarification answers: 1");
      expect(answered?.text).toContain("Clarifications from operator");
      expect(answered?.text).toContain(
        "Q: What exact behavior, contract, or operator surface should change?",
      );
      expect(answered?.text).toContain(
        "A: Add a stable top-level `issueCount` mirror to `openclaw code run --json`.",
      );
      expect(answered?.text).toContain("Clarifications: 2");
      expect(fetchMock).not.toHaveBeenCalled();

      const confirmed = await fixture.commands.get("occode-intake-confirm")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-intake-confirm",
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(confirmed?.text).toContain("Issue: zhyongrui/openclawcode#224");
      const requestPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(requestPayload).toMatchObject({
        title: "Expose issueCount in openclaw code run --json output",
      });
      expect(String(requestPayload.body)).toContain("Clarifications from operator");
      expect(String(requestPayload.body)).toContain(
        "Q: What exact behavior, contract, or operator surface should change?",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows the current pending chat intake draft through /occode-intake-preview", async () => {
    const fixture = await registerPluginFixture();
    try {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Expose issueCount and issueRepo in openclaw code run --json output",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      const preview = await fixture.commands.get("occode-intake-preview")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-intake-preview",
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(preview?.text).toContain(
        "openclawcode is holding a pending chat intake draft for zhyongrui/openclawcode.",
      );
      expect(preview?.text).toContain(
        "Title: Expose issueCount and issueRepo in openclaw code run --json output",
      );
      expect(preview?.text).toContain("Body preview:");
      expect(preview?.text).toContain("Scoped drafts: 2");
      expect(preview?.text).toContain("Use /occode-intake-preview zhyongrui/openclawcode");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("offers multiple scoped drafts for ambiguous one-line intake requests", async () => {
    const fixture = await registerPluginFixture();
    try {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Expose issueCount and issueRepo in openclaw code run --json output",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(result?.text).toContain("Scoped drafts: 2");
      expect(result?.text).toContain("/occode-intake-choose");
      expect(fetchMock).not.toHaveBeenCalled();

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingIntakeDrafts[0]?.scopedDrafts).toEqual([
        expect.objectContaining({
          title: "Expose issueCount in openclaw code run --json output",
        }),
        expect.objectContaining({
          title: "Expose issueRepo in openclaw code run --json output",
        }),
      ]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("supports editing and confirming a pending chat intake draft before issue creation", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createGitHubIssueResponse({
              issueNumber: 222,
              title: "Expose issueCount and issueRepo in openclaw code run --json output",
              body: [
                "Summary",
                "Expose issueCount and issueRepo in openclaw code run --json output",
                "",
                "Problem to solve",
                "Add two stable top-level mirrors so external automation does not need nested issue reads.",
                "",
                "Acceptance",
                "- [ ] `issueCount` is present at the top level.",
                "- [ ] `issueRepo` is present at the top level.",
              ].join("\n"),
            }),
          ),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Expose issueCount in openclaw code run --json output",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      const edited = await fixture.commands.get("occode-intake-edit")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake-edit",
          "Expose issueCount and issueRepo in openclaw code run --json output",
          "",
          "Summary",
          "Expose issueCount and issueRepo in openclaw code run --json output",
          "",
          "Problem to solve",
          "Add two stable top-level mirrors so external automation does not need nested issue reads.",
          "",
          "Acceptance",
          "- [ ] `issueCount` is present at the top level.",
          "- [ ] `issueRepo` is present at the top level.",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(edited?.text).toContain("Body source: edited draft");
      expect(edited?.text).toContain("Expose issueCount and issueRepo");

      const confirmed = await fixture.commands.get("occode-intake-confirm")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-intake-confirm",
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(confirmed).toEqual({
        text: [
          "openclawcode created and queued a new GitHub issue from chat.",
          "Issue: zhyongrui/openclawcode#222",
          "Title: Expose issueCount and issueRepo in openclaw code run --json output",
          "URL: https://github.com/zhyongrui/openclawcode/issues/222",
          "Status: queued for execution",
          "Use /occode-status zhyongrui/openclawcode#222 to inspect progress.",
        ].join("\n"),
      });
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        title: "Expose issueCount and issueRepo in openclaw code run --json output",
        body: [
          "Summary",
          "Expose issueCount and issueRepo in openclaw code run --json output",
          "",
          "Problem to solve",
          "Add two stable top-level mirrors so external automation does not need nested issue reads.",
          "",
          "Acceptance",
          "- [ ] `issueCount` is present at the top level.",
          "- [ ] `issueRepo` is present at the top level.",
        ].join("\n"),
      });

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingIntakeDrafts).toEqual([]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("supports rejecting a pending chat intake draft before issue creation", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Expose issueCount in openclaw code run --json output",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      const rejected = await fixture.commands.get("occode-intake-reject")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-intake-reject too broad for one issue",
        args: "too broad for one issue",
        to: "user:intake-chat",
        config: {},
      });

      expect(rejected?.text).toContain("discarded the pending intake draft");
      expect(rejected?.text).toContain("Reason: too broad for one issue");

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingIntakeDrafts).toEqual([]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("can choose a scoped draft before confirming chat intake", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createGitHubIssueResponse({
              issueNumber: 223,
              title: "Expose issueRepo in openclaw code run --json output",
              body: [
                "Summary",
                "Expose issueRepo in openclaw code run --json output",
                "",
                "Problem to solve",
                "This issue was drafted directly from chat intake and needs the workflow to translate the request into the concrete code change.",
                "",
                "Requested from chat intake",
                "Expose issueRepo in openclaw code run --json output",
              ].join("\n"),
            }),
          ),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: [
          "/occode-intake",
          "Expose issueCount and issueRepo in openclaw code run --json output",
        ].join("\n"),
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      const chosen = await fixture.commands.get("occode-intake-choose")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-intake-choose 2",
        args: "2",
        to: "user:intake-chat",
        config: {},
      });
      expect(chosen?.text).toContain("Title: Expose issueRepo in openclaw code run --json output");
      expect(chosen?.text).toContain("Scoped drafts: 0");

      const confirmed = await fixture.commands.get("occode-intake-confirm")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-intake-confirm",
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(confirmed?.text).toContain("Issue: zhyongrui/openclawcode#223");
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        title: "Expose issueRepo in openclaw code run --json output",
      });

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingIntakeDrafts).toEqual([]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("requires a non-empty title or request line for /occode-intake", async () => {
    const fixture = await registerPluginFixture();
    try {
      const result = await fixture.commands.get("occode-intake")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-intake",
        args: "",
        to: "user:intake-chat",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "Usage: /occode-intake owner/repo",
          "[issue title or one-line request]",
          "[optional issue body...]",
          "Or, when exactly one repo is configured:",
          "/occode-intake",
          "[issue title or one-line request]",
          "[optional issue body...]",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("recovers failed local run artifacts into tracked snapshots so /occode-rerun can use them", async () => {
    const fixture = await registerPluginFixture({ pollIntervalMs: 10 });
    try {
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#230",
          notifyChannel: "feishu",
          notifyTarget: "user:failure-chat",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 230,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-230",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            openPullRequest: true,
            mergeOnApprove: false,
          },
        },
        "Queued from test.",
      );
      fixture.runCommandWithTimeout.mockImplementation(async () => {
        await writeLocalRun({
          repoRoot: fixture.repoRoot,
          issueNumber: 230,
          stage: "failed",
          updatedAt: new Date().toISOString(),
          summary: "Builder failed after a transient provider error.",
        });
        return {
          code: 1,
          stdout: "",
          stderr: "400 Internal server error",
        };
      });

      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      await waitForAssertion(async () => {
        expect(await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#230")).toMatchObject({
          stage: "failed",
          issueNumber: 230,
          notifyChannel: "feishu",
          notifyTarget: "user:failure-chat",
          lastNotificationStatus: "sent",
        });
      }, 60);
      expect(await fixture.store.getStatus("zhyongrui/openclawcode#230")).toContain(
        "Stage: Failed",
      );

      await fixture.service?.stop?.({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      const rerun = await fixture.commands.get("occode-rerun")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-rerun #230",
        args: "#230",
        to: "user:rerun-chat",
        config: {},
      });

      expect(rerun).toEqual({
        text: "Queued rerun for zhyongrui/openclawcode#230 from Failed state. I will post status updates here.",
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("promotes pending approvals into the queue through /occode-start", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#204",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });

      const result = await fixture.commands.get("occode-start")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-start #204",
        args: "#204",
        from: "chat:override",
        to: "user:current-chat",
        config: {},
      });

      expect(result).toEqual({
        text: "Queued zhyongrui/openclawcode#204. I will post status updates here.",
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.queue[0]?.notifyTarget).toBe("chat:primary");
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#204"]).toBe(
        "Approved in chat and queued.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("queues suitability overrides through /occode-start-override", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#205",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });

      const result = await fixture.commands.get("occode-start-override")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-start-override #205",
        args: "#205",
        senderId: "user:operator",
        to: "user:current-chat",
        config: {},
      });

      expect(result).toEqual({
        text: "Queued zhyongrui/openclawcode#205 with an explicit suitability override. I will post status updates here.",
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.queue[0]).toMatchObject({
        issueKey: "zhyongrui/openclawcode#205",
        request: {
          issueNumber: 205,
          suitabilityOverride: {
            actor: "user:current-chat",
            reason: "Chat operator approved a suitability override for this run.",
          },
        },
      });
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#205"]).toBe(
        "Suitability override approved in chat and queued.",
      );
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("mentions an active provider pause when /occode-start queues work", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#214",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6601,
          stage: "failed",
          updatedAt: "2099-03-12T12:00:00.000Z",
        }),
        buildTransientProviderFailedStatus(6601),
      );
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6602,
          stage: "failed",
          updatedAt: "2099-03-12T12:05:00.000Z",
        }),
        buildTransientProviderFailedStatus(6602),
      );

      const result = await fixture.commands.get("occode-start")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-start #214",
        args: "#214",
        to: "user:current-chat",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "Queued zhyongrui/openclawcode#214. I will post status updates here.",
          "Provider pause: active until 2099-03-12T12:15:00.000Z",
          "- failures: 2 | last failure: 2099-03-12T12:05:00.000Z",
          "- reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
          "- impact: new work can still queue, but queued runs will not start until the pause clears.",
          "- recovery: queue drain resumes automatically after the pause window elapses.",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("blocks /occode-start when the execution-start gate is not ready", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#240",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Execution Gate Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Execution Gate Blueprint",
          "",
          "## Goal",
          "Require a human decision before execution starts when open questions remain.",
          "",
          "## Success Criteria",
          "- /occode-start refuses to queue until the execution-start gate is approved.",
          "",
          "## Scope",
          "- In scope: gate-aware start flow.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Preserve deterministic gate behavior.",
          "",
          "## Risks",
          "- Autonomous execution could start too early without this guard.",
          "",
          "## Assumptions",
          "- Operators can inspect stage gates from chat.",
          "",
          "## Human Gates",
          "- Execution start: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: OpenClaw Default",
          "- Doc-writer: Claude Code",
          "",
          "## Workstreams",
          "- Block start until the execution-start gate is approved.",
          "",
          "## Open Questions",
          "- Should the operator accept the remaining open question before execution?",
          "",
          "## Change Log",
          "- 2026-03-16: gate-aware start test.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await writeProjectDiscoveryInventory(fixture.repoRoot);

      const result = await fixture.commands.get("occode-start")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-start #240",
        args: "#240",
        to: "user:current-chat",
        config: {},
      });

      expect(result?.text).toContain(
        "Execution start is currently gated for zhyongrui/openclawcode.",
      );
      expect(result?.text).toContain("Gate: execution-start");
      expect(result?.text).toContain("Readiness: needs-human-decision");

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toHaveLength(0);
      expect(snapshot.pendingApprovals).toEqual([
        {
          issueKey: "zhyongrui/openclawcode#240",
          notifyChannel: "telegram",
          notifyTarget: "user:current-chat",
          approvalKind: "execution-start-gated",
        },
      ]);
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#240"]).toBe(
        "Awaiting execution-start gate approval.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("automatically resumes held /occode-start work after execution-start is approved in chat", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#241",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Execution Resume Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Execution Resume Blueprint",
          "",
          "## Goal",
          "Allow execution to proceed after a human approves the execution-start gate.",
          "",
          "## Success Criteria",
          "- /occode-start queues once the execution-start gate is approved.",
          "",
          "## Scope",
          "- In scope: approved override for needs-human-decision gates.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Only override needs-human-decision, not blocked gates.",
          "",
          "## Risks",
          "- Approval should be explicit and auditable.",
          "",
          "## Assumptions",
          "- Chat operators can record gate decisions.",
          "",
          "## Human Gates",
          "- Execution start: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: OpenClaw Default",
          "- Doc-writer: Claude Code",
          "",
          "## Workstreams",
          "- Let approved execution-start gates unblock /occode-start.",
          "",
          "## Open Questions",
          "- Should the remaining question be accepted for now?",
          "",
          "## Change Log",
          "- 2026-03-16: gate approval resume test.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await writeProjectDiscoveryInventory(fixture.repoRoot);

      const blocked = await fixture.commands.get("occode-start")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-start #241",
        args: "#241",
        to: "user:current-chat",
        config: {},
      });
      expect(blocked?.text).toContain("Execution start is currently gated");

      const decision = await fixture.commands.get("occode-gate-decide")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-gate-decide execution-start approved Accepted for this run",
        args: "execution-start approved Accepted for this run",
        senderId: "user:operator",
        config: {},
      });
      expect(decision?.text).toContain("Decision: approved");
      expect(decision?.text).toContain("Readiness: ready");
      expect(decision?.text).toContain("Resumed held executions: 1");
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#241"]).toBe(
        "Execution-start gate approved and queued.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("does not auto-resume untouched manual approvals when execution-start is approved", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#242",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Manual Approval Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Manual Approval Blueprint",
          "",
          "## Goal",
          "Keep ordinary pending approvals manual until someone explicitly starts them.",
          "",
          "## Success Criteria",
          "- Gate approval alone does not bypass manual approval.",
          "",
          "## Scope",
          "- In scope: preserve manual approval semantics.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Only execution-start-held items should auto resume.",
          "",
          "## Risks",
          "- Auto-resuming manual approvals would skip operator intent.",
          "",
          "## Assumptions",
          "- Operators can still use /occode-start later.",
          "",
          "## Human Gates",
          "- Execution start: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: OpenClaw Default",
          "- Doc-writer: Claude Code",
          "",
          "## Workstreams",
          "- Preserve manual approval semantics.",
          "",
          "## Open Questions",
          "- Should gate approval alone bypass manual review? No.",
          "",
          "## Change Log",
          "- 2026-03-16: protect manual approvals from auto resume.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await writeProjectDiscoveryInventory(fixture.repoRoot);

      const decision = await fixture.commands.get("occode-gate-decide")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-gate-decide execution-start approved Accepted for this repo",
        args: "execution-start approved Accepted for this repo",
        senderId: "user:operator",
        config: {},
      });

      expect(decision?.text).toContain("Decision: approved");
      expect(decision?.text).not.toContain("Resumed held executions:");
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toEqual([]);
      expect(snapshot.pendingApprovals).toEqual([
        {
          issueKey: "zhyongrui/openclawcode#242",
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
        },
      ]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("queues /occode-rerun with review context and prefers the current chat target", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#215",
        status: [
          "openclawcode status for zhyongrui/openclawcode#215",
          "Stage: Changes Requested",
          "Summary: GitHub pull request review requested changes after the latest tracked workflow state.",
        ].join("\n"),
        stage: "changes-requested",
        runId: "run-215",
        updatedAt: "2026-03-11T03:10:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 215,
        branchName: "openclawcode/issue-215",
        pullRequestNumber: 315,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/315",
        notifyChannel: "telegram",
        notifyTarget: "chat:old-thread",
        latestReviewDecision: "changes-requested",
        latestReviewSubmittedAt: "2026-03-11T03:09:00.000Z",
        latestReviewSummary: [
          "Please add a regression test for the rerun flow.",
          "Keep the existing PR open.",
        ].join("\n"),
        latestReviewUrl: "https://github.com/zhyongrui/openclawcode/pull/315#pullrequestreview-11",
      });

      const result = await fixture.commands.get("occode-rerun")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-rerun #215",
        args: "#215",
        to: "user:rerun-chat",
        config: {},
      });

      expect(result).toEqual({
        text: "Queued rerun for zhyongrui/openclawcode#215 from Changes Requested state. I will post status updates here.",
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.queue[0]).toMatchObject({
        issueKey: "zhyongrui/openclawcode#215",
        notifyChannel: "feishu",
        notifyTarget: "user:rerun-chat",
        request: {
          owner: "zhyongrui",
          repo: "openclawcode",
          issueNumber: 215,
          branchName: "openclawcode/issue-215",
          openPullRequest: true,
          mergeOnApprove: false,
          rerunContext: {
            reason: [
              "Please add a regression test for the rerun flow.",
              "Keep the existing PR open.",
            ].join("\n"),
            priorRunId: "run-215",
            priorStage: "changes-requested",
            reviewDecision: "changes-requested",
            reviewSubmittedAt: "2026-03-11T03:09:00.000Z",
            reviewSummary: [
              "Please add a regression test for the rerun flow.",
              "Keep the existing PR open.",
            ].join("\n"),
            reviewUrl: "https://github.com/zhyongrui/openclawcode/pull/315#pullrequestreview-11",
          },
        },
      });
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#215"]).toBe(
        "Queued rerun from Changes Requested state.",
      );
      expect(snapshot.queue[0]?.request.rerunContext?.requestedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("mentions an active provider pause when /occode-rerun queues work", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#2150",
        status: "openclawcode status for zhyongrui/openclawcode#2150\nStage: Failed",
        stage: "failed",
        runId: "run-2150",
        updatedAt: "2026-03-11T03:10:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 2150,
        branchName: "openclawcode/issue-2150",
        notifyChannel: "telegram",
        notifyTarget: "chat:old-thread",
      });
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6611,
          stage: "failed",
          updatedAt: "2099-03-12T12:00:00.000Z",
        }),
        buildTransientProviderFailedStatus(6611),
      );
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6612,
          stage: "failed",
          updatedAt: "2099-03-12T12:05:00.000Z",
        }),
        buildTransientProviderFailedStatus(6612),
      );

      const result = await fixture.commands.get("occode-rerun")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-rerun #2150",
        args: "#2150",
        to: "user:rerun-chat",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "Queued rerun for zhyongrui/openclawcode#2150 from Failed state. I will post status updates here.",
          "Provider pause: active until 2099-03-12T12:15:00.000Z",
          "- failures: 2 | last failure: 2099-03-12T12:05:00.000Z",
          "- reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
          "- impact: new work can still queue, but queued runs will not start until the pause clears.",
          "- recovery: queue drain resumes automatically after the pause window elapses.",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("mentions cleared provider pause context when /occode-rerun probes recovery", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#2151",
        status: "openclawcode status for zhyongrui/openclawcode#2151\nStage: Failed",
        stage: "failed",
        runId: "run-2151",
        updatedAt: "2026-03-12T12:05:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 2151,
        branchName: "openclawcode/issue-2151",
        notifyChannel: "telegram",
        notifyTarget: "chat:old-thread",
        providerFailureCount: 2,
        lastProviderFailureAt: "2026-03-12T12:05:00.000Z",
        providerPauseUntil: "2026-03-12T12:15:00.000Z",
        providerPauseReason:
          "Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
      });

      const result = await fixture.commands.get("occode-rerun")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-rerun #2151",
        args: "#2151",
        to: "user:rerun-chat",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "Queued rerun for zhyongrui/openclawcode#2151 from Failed state. I will post status updates here.",
          "Provider recovery: pause cleared after 2026-03-12T12:15:00.000Z",
          "- last failure: 2026-03-12T12:05:00.000Z | failures: 2",
          "- reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
          "- note: this rerun is probing recovery after the cleared pause window.",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("falls back to the stored snapshot notification target for /occode-rerun", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#216",
        status: "openclawcode status for zhyongrui/openclawcode#216\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-216",
        updatedAt: "2026-03-11T03:20:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 216,
        branchName: "openclawcode/issue-216",
        notifyChannel: "telegram",
        notifyTarget: "chat:snapshot-thread",
      });

      const result = await fixture.commands.get("occode-rerun")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-rerun #216",
        args: "#216",
        config: {},
      });

      expect(result).toEqual({
        text: "Queued rerun for zhyongrui/openclawcode#216 from Ready For Human Review state. I will post status updates here.",
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue[0]).toMatchObject({
        issueKey: "zhyongrui/openclawcode#216",
        notifyChannel: "telegram",
        notifyTarget: "chat:snapshot-thread",
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("prefers the current escalated status summary over stale review text for /occode-rerun", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#2160",
        status: [
          "openclawcode status for zhyongrui/openclawcode#2160",
          "Stage: Escalated",
          "Summary: GitHub pull request was closed without merge after the latest tracked workflow state.",
          "PR: https://github.com/zhyongrui/openclawcode/pull/3160",
        ].join("\n"),
        stage: "escalated",
        runId: "run-2160",
        updatedAt: "2026-03-11T03:25:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 2160,
        branchName: "openclawcode/issue-2160",
        pullRequestNumber: 3160,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/3160",
        notifyChannel: "telegram",
        notifyTarget: "chat:escalated-thread",
        latestReviewDecision: "approved",
        latestReviewSubmittedAt: "2026-03-11T03:24:00.000Z",
        latestReviewSummary: "This stale review summary should not become the rerun reason.",
        latestReviewUrl:
          "https://github.com/zhyongrui/openclawcode/pull/3160#pullrequestreview-2160",
      });

      const result = await fixture.commands.get("occode-rerun")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-rerun #2160",
        args: "#2160",
        config: {},
      });

      expect(result).toEqual({
        text: "Queued rerun for zhyongrui/openclawcode#2160 from Escalated state. I will post status updates here.",
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.queue[0]).toMatchObject({
        issueKey: "zhyongrui/openclawcode#2160",
        notifyChannel: "telegram",
        notifyTarget: "chat:escalated-thread",
        request: {
          branchName: "openclawcode/issue-2160",
          rerunContext: {
            reason:
              "GitHub pull request was closed without merge after the latest tracked workflow state.",
            priorRunId: "run-2160",
            priorStage: "escalated",
            reviewDecision: "approved",
            reviewSubmittedAt: "2026-03-11T03:24:00.000Z",
            reviewSummary: "This stale review summary should not become the rerun reason.",
            reviewUrl: "https://github.com/zhyongrui/openclawcode/pull/3160#pullrequestreview-2160",
          },
        },
      });
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#2160"]).toBe(
        "Queued rerun from Escalated state.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("requires an existing tracked run before /occode-rerun can queue work", async () => {
    const fixture = await registerPluginFixture();
    try {
      const result = await fixture.commands.get("occode-rerun")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-rerun #217",
        args: "#217",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "No tracked openclawcode run found for zhyongrui/openclawcode#217.",
          "Use /occode-start zhyongrui/openclawcode#217 for the first run.",
        ].join("\n"),
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toEqual([]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("binds the current chat as the repo notification target through /occode-bind", async () => {
    const fixture = await registerPluginFixture();
    try {
      const result = await fixture.commands.get("occode-bind")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-bind",
        args: "",
        to: "user:bound-chat",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "Bound zhyongrui/openclawcode notifications to this chat.",
          "Channel: feishu",
          "Target: user:bound-chat",
        ].join("\n"),
      });
      expect(await fixture.store.getRepoBinding("zhyongrui/openclawcode")).toMatchObject({
        repoKey: "zhyongrui/openclawcode",
        notifyChannel: "feishu",
        notifyTarget: "user:bound-chat",
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("starts chat-native setup by launching GitHub device auth and persisting the session", async () => {
    const fixture = await registerPluginFixture();
    mocked.startOnboardingGitHubCliDeviceLogin.mockResolvedValue({
      pid: 321,
      logPath: "/tmp/gh-auth.log",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      startedAt: "2026-03-19T02:30:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-setup")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup",
        args: "",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("OpenClaw Code setup is waiting for GitHub approval.");
      expect(result?.text).toContain("https://github.com/login/device");
      expect(result?.text).toContain("ABCD-EFGH");
      expect(result?.text).toContain("/occode-setup-status");
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toMatchObject({
        stage: "awaiting-github-device-auth",
        githubDeviceAuth: {
          pid: 321,
          userCode: "ABCD-EFGH",
        },
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("starts a blueprint-first new-project setup draft without forcing GitHub auth", async () => {
    const fixture = await registerPluginFixture();

    try {
      const result = await fixture.commands.get("occode-setup")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup new-project",
        args: "new-project",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain(
        "OpenClaw Code is drafting a blueprint-first new-project setup for this chat.",
      );
      expect(result?.text).toContain("/occode-goal <goal text>");
      expect(mocked.startOnboardingGitHubCliDeviceLogin).not.toHaveBeenCalled();
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toMatchObject({
        projectMode: "new-project",
        stage: "drafting-blueprint",
        blueprintDraft: {
          status: "draft",
        },
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("routes /occode-goal into the active new-project setup draft", async () => {
    const fixture = await registerPluginFixture();
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "new-project",
      stage: "drafting-blueprint",
      blueprintDraft: {
        status: "draft",
        sections: {},
      },
      createdAt: "2026-03-19T03:00:00.000Z",
      updatedAt: "2026-03-19T03:00:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-goal")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-goal Shared image gallery for family albums",
        args: "Shared image gallery for family albums",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("Updated setup draft section `Goal`.");
      expect(result?.text).toContain("Goal: Shared image gallery for family albums");
      expect(
        (
          await fixture.store.getSetupSession({
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
          })
        )?.blueprintDraft?.sections?.Goal,
      ).toBe("Shared image gallery for family albums");
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("routes /occode-blueprint-edit into the active new-project setup draft", async () => {
    const fixture = await registerPluginFixture();
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "new-project",
      stage: "drafting-blueprint",
      blueprintDraft: {
        status: "draft",
        sections: {
          Goal: "Shared image gallery for family albums",
        },
      },
      createdAt: "2026-03-19T03:05:00.000Z",
      updatedAt: "2026-03-19T03:05:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-blueprint-edit")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody:
          "/occode-blueprint-edit constraints\n- Stay inside chat until repo creation is necessary.",
        args: "constraints",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("Updated setup draft section `Constraints`.");
      expect(
        (
          await fixture.store.getSetupSession({
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
          })
        )?.blueprintDraft?.sections?.Constraints,
      ).toBe("- Stay inside chat until repo creation is necessary.");
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("agrees a new-project setup draft and suggests repo names", async () => {
    const fixture = await registerPluginFixture();
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "new-project",
      stage: "drafting-blueprint",
      blueprintDraft: {
        status: "draft",
        sections: {
          Goal: "Shared image gallery for family albums",
          "Success Criteria":
            "- Create the repo from chat and return the next proof commands.",
          Scope: "- Start with repo bootstrap and blueprint alignment only.",
          "Non-Goals": "- No mobile app or public sharing in the first MVP.",
          Constraints: "- Stay inside chat until repo creation is necessary.",
        },
      },
      createdAt: "2026-03-19T03:10:00.000Z",
      updatedAt: "2026-03-19T03:10:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-blueprint-agree")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-blueprint-agree",
        args: "",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain(
        "OpenClaw Code has an agreed blueprint draft for this new-project setup.",
      );
      expect(result?.text).toContain("shared-image-gallery-family");
      const saved = await fixture.store.getSetupSession({
        notifyChannel: "feishu",
        notifyTarget: "user:setup-chat",
      });
      expect(saved).toMatchObject({
        stage: "awaiting-repo-choice",
        blueprintDraft: {
          status: "agreed",
        },
      });
      expect(saved?.blueprintDraft?.repoNameSuggestions?.[0]).toBe(
        "shared-image-gallery-family",
      );
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("creates a repo from an agreed setup draft and syncs the draft into PROJECT-BLUEPRINT.md", async () => {
    const fixture = await registerPluginFixture();
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });
    mocked.createOnboardingRepositoryViaGh.mockResolvedValue({
      owner: "zhyongrui",
      repo: "shared-image-gallery",
      private: true,
      url: "https://github.com/zhyongrui/shared-image-gallery",
    });
    mocked.runOnboardingOpenClawCodeBootstrap.mockResolvedValue({
      repo: {
        owner: "zhyongrui",
        repo: "shared-image-gallery",
        repoKey: "zhyongrui/shared-image-gallery",
        repoRoot: fixture.repoRoot,
        checkoutAction: "attached",
      },
      blueprint: {
        blueprintPath: path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        status: "draft",
        revisionId: "rev-bootstrap",
      },
      handoff: {
        blueprintCommand: "/occode-blueprint zhyongrui/shared-image-gallery",
        gatesCommand: "/occode-gates zhyongrui/shared-image-gallery",
      },
      nextAction: "clarify-project-blueprint",
    });
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "new-project",
      stage: "awaiting-repo-choice",
      githubAuthSource: "gh-auth-token",
      blueprintDraft: {
        status: "agreed",
        agreedAt: "2026-03-19T03:15:00.000Z",
        repoNameSuggestions: ["shared-image-gallery"],
        sections: {
          Goal: "Shared image gallery for family albums",
          "Success Criteria":
            "- Create the repo from chat and return the next proof commands.",
          Scope: "- Start with repo bootstrap and blueprint alignment only.",
          "Non-Goals": "- No mobile app or public sharing in the first MVP.",
          Constraints: "- Stay inside chat until repo creation is necessary.",
          "Open Questions": "- None.",
          Workstreams: "- Bootstrap the repo and return the first proof path.",
        },
      },
      createdAt: "2026-03-19T03:15:00.000Z",
      updatedAt: "2026-03-19T03:15:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-setup")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup new shared-image-gallery",
        args: "new shared-image-gallery",
        to: "user:setup-chat",
        config: {},
      });

      expect(mocked.createOnboardingRepositoryViaGh).toHaveBeenCalledWith({
        owner: "zhyongrui",
        repo: "shared-image-gallery",
      });
      expect(mocked.runOnboardingOpenClawCodeBootstrap).toHaveBeenCalledWith({
        repo: "zhyongrui/shared-image-gallery",
      });
      expect(result?.text).toContain("Repo: zhyongrui/shared-image-gallery");
      expect(result?.text).toContain("Work items: total=1 | planned=1");

      const blueprint = await readProjectBlueprintDocument(fixture.repoRoot);
      expect(blueprint.status).toBe("agreed");
      expect(blueprint.goalSummary).toBe("Shared image gallery for family albums");
      expect(blueprint.sectionBodies["Open Questions"]).toContain("- None.");
      expect(blueprint.sectionBodies.Workstreams).toContain(
        "- Bootstrap the repo and return the first proof path.",
      );

      const workItems = await readProjectWorkItemInventory(fixture.repoRoot);
      expect(workItems.workItemCount).toBe(1);
      expect(workItems.workItems[0]?.title).toContain("Bootstrap the repo");

      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toMatchObject({
        stage: "bootstrap-complete",
        repoKey: "zhyongrui/shared-image-gallery",
        bootstrap: {
          workItemCount: 1,
          plannedWorkItemCount: 1,
          firstWorkItemTitle: expect.stringContaining("Bootstrap the repo"),
        },
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("reports authenticated setup status and preserves the selected repo", async () => {
    const fixture = await registerPluginFixture();
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });

    try {
      const result = await fixture.commands.get("occode-setup")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup zhyongrui/iGallery",
        args: "zhyongrui/iGallery",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("OpenClaw Code bootstrap finished for this setup session.");
      expect(result?.text).toContain("Source: gh-auth-token");
      expect(result?.text).toContain("Repo: zhyongrui/iGallery");
      expect(result?.text).toContain("Local path: /home/zyr/pros/openclawcode-target");
      expect(result?.text).toContain("Blueprint: /home/zyr/pros/openclawcode-target/PROJECT-BLUEPRINT.md");
      expect(result?.text).toContain("Status: clarify-project-blueprint");
      expect(result?.text).toContain("/occode-blueprint zhyongrui/openclawcode");
      expect(mocked.runOnboardingOpenClawCodeBootstrap).toHaveBeenCalledWith({
        repo: "zhyongrui/iGallery",
      });
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toMatchObject({
        projectMode: "existing-repo",
        repoKey: "zhyongrui/iGallery",
        stage: "bootstrap-complete",
        githubAuthSource: "gh-auth-token",
        bootstrap: {
          repoRoot: "/home/zyr/pros/openclawcode-target",
          nextAction: "clarify-project-blueprint",
        },
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("auto-binds the current chat after bootstrap when no repo binding exists yet", async () => {
    const fixture = await registerPluginFixture();
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });

    try {
      const result = await fixture.commands.get("occode-setup")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup existing zhyongrui/iGallery",
        args: "existing zhyongrui/iGallery",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("Auto-bind: bound (feishu:user:setup-chat)");
      expect(await fixture.store.getRepoBinding("zhyongrui/iGallery")).toMatchObject({
        repoKey: "zhyongrui/iGallery",
        notifyChannel: "feishu",
        notifyTarget: "user:setup-chat",
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("keeps an existing repo binding when bootstrap runs from a different chat", async () => {
    const fixture = await registerPluginFixture();
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });
    await fixture.store.setRepoBinding({
      repoKey: "zhyongrui/iGallery",
      notifyChannel: "feishu",
      notifyTarget: "user:existing-chat",
    });

    try {
      const result = await fixture.commands.get("occode-setup")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup existing zhyongrui/iGallery",
        args: "existing zhyongrui/iGallery",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("Auto-bind: existing-binding-kept (feishu:user:existing-chat)");
      expect(await fixture.store.getRepoBinding("zhyongrui/iGallery")).toMatchObject({
        repoKey: "zhyongrui/iGallery",
        notifyChannel: "feishu",
        notifyTarget: "user:existing-chat",
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("creates a new GitHub repo from chat-native setup after auth is ready", async () => {
    const fixture = await registerPluginFixture();
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });
    mocked.createOnboardingRepositoryViaGh.mockResolvedValue({
      owner: "zhyongrui",
      repo: "iGallery",
      private: true,
      url: "https://github.com/zhyongrui/iGallery",
    });

    try {
      const result = await fixture.commands.get("occode-setup")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup new iGallery",
        args: "new iGallery",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("OpenClaw Code bootstrap finished for this setup session.");
      expect(result?.text).toContain("Repo: zhyongrui/iGallery");
      expect(mocked.createOnboardingRepositoryViaGh).toHaveBeenCalledWith({
        owner: "zhyongrui",
        repo: "iGallery",
      });
      expect(mocked.runOnboardingOpenClawCodeBootstrap).toHaveBeenCalledWith({
        repo: "zhyongrui/iGallery",
      });
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toMatchObject({
        projectMode: "new-project",
        repoKey: "zhyongrui/iGallery",
        stage: "bootstrap-complete",
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("retries a failed bootstrap setup session", async () => {
    const fixture = await registerPluginFixture();
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });
    mocked.runOnboardingOpenClawCodeBootstrap.mockResolvedValue({
      repo: {
        owner: "zhyongrui",
        repo: "openclawcode",
        repoKey: "zhyongrui/openclawcode",
        repoRoot: "/home/zyr/pros/openclawcode-target",
        checkoutAction: "attached",
      },
      blueprint: {
        blueprintPath: "/home/zyr/pros/openclawcode-target/PROJECT-BLUEPRINT.md",
        status: "draft",
        revisionId: "rev-bootstrap",
      },
      handoff: {
        blueprintCommand: "/occode-blueprint zhyongrui/openclawcode",
      },
      nextAction: "clarify-project-blueprint",
    });
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "existing-repo",
      repoKey: "zhyongrui/openclawcode",
      stage: "github-authenticated",
      githubAuthSource: "gh-auth-token",
      lastFailure: {
        step: "bootstrap",
        reason: "previous bootstrap failure",
        occurredAt: "2026-03-19T02:39:00.000Z",
      },
      createdAt: "2026-03-19T02:35:00.000Z",
      updatedAt: "2026-03-19T02:39:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-setup-retry")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup-retry",
        args: "",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("OpenClaw Code bootstrap finished for this setup session.");
      expect(mocked.runOnboardingOpenClawCodeBootstrap).toHaveBeenCalledWith({
        repo: "zhyongrui/openclawcode",
      });
      expect(
        (
          await fixture.store.getSetupSession({
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
          })
        )?.lastFailure,
      ).toBeUndefined();
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("cancels the active setup session for the current chat", async () => {
    const fixture = await registerPluginFixture();
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "new-project",
      stage: "drafting-blueprint",
      blueprintDraft: {
        status: "draft",
        sections: {
          Goal: "Ship chat-native setup.",
        },
      },
      createdAt: "2026-03-19T03:00:00.000Z",
      updatedAt: "2026-03-19T03:00:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-setup-cancel")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup-cancel",
        args: "",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("Cancelled the active openclawcode setup session");
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toBeUndefined();
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("reports pairing-gated setup state through /occode-setup-status", async () => {
    const fixture = await registerPluginFixture();
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      repoKey: "zhyongrui/openclawcode",
      stage: "awaiting-chat-pairing",
      createdAt: "2026-03-19T02:35:00.000Z",
      updatedAt: "2026-03-19T02:35:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-setup-status")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup-status",
        args: "",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("OpenClaw Code setup is waiting for chat pairing approval.");
      expect(result?.text).toContain("Selected repo: zhyongrui/openclawcode");
      expect(result?.text).toContain(
        "OpenClaw Code will automatically continue setup here and start GitHub login.",
      );
      expect(mocked.runOnboardingOpenClawCodeBootstrap).not.toHaveBeenCalled();
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("promotes a pending setup session to authenticated through /occode-setup-status", async () => {
    const fixture = await registerPluginFixture();
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      repoKey: "zhyongrui/openclawcode",
      stage: "awaiting-github-device-auth",
      githubDeviceAuth: {
        pid: 321,
        logPath: "/tmp/gh-auth.log",
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device",
        startedAt: "2026-03-19T02:35:00.000Z",
      },
      createdAt: "2026-03-19T02:35:00.000Z",
      updatedAt: "2026-03-19T02:35:00.000Z",
    });
    mocked.inspectOnboardingGitHubCliDeviceLogin.mockResolvedValue({
      state: "authorized",
      running: false,
      source: "gh-auth-token",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      startedAt: "2026-03-19T02:35:00.000Z",
      completedAt: "2026-03-19T02:36:00.000Z",
    });

    try {
      const result = await fixture.commands.get("occode-setup-status")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup-status",
        args: "",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("OpenClaw Code bootstrap finished for this setup session.");
      expect(result?.text).toContain("Repo: zhyongrui/openclawcode");
      expect(mocked.runOnboardingOpenClawCodeBootstrap).toHaveBeenCalledWith({
        repo: "zhyongrui/openclawcode",
      });
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toMatchObject({
        stage: "bootstrap-complete",
        githubAuthSource: "gh-auth-token",
        githubDeviceAuth: {
          completedAt: "2026-03-19T02:36:00.000Z",
        },
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("replays the saved bootstrap summary through /occode-setup-status", async () => {
    const fixture = await registerPluginFixture();
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "existing-repo",
      repoKey: "zhyongrui/openclawcode",
      stage: "bootstrap-complete",
      githubAuthSource: "gh-auth-token",
      bootstrap: {
        completedAt: "2026-03-19T02:40:00.000Z",
        repoRoot: "/home/zyr/pros/openclawcode-target",
        blueprintPath: "/home/zyr/pros/openclawcode-target/PROJECT-BLUEPRINT.md",
        pluginActivation: {
          ready: false,
          pluginsEnabled: true,
          allowlisted: false,
          entryEnabled: true,
        },
        proofReadiness: {
          chatSetupRoutingReady: false,
        },
        pluginActivationRepairCommand: "openclaw gateway restart",
        chatSetupStatusCommand: "/occode-setup-status",
        nextAction: "clarify-project-blueprint",
        blueprintCommand: "/occode-blueprint zhyongrui/openclawcode",
      },
      createdAt: "2026-03-19T02:35:00.000Z",
      updatedAt: "2026-03-19T02:40:00.000Z",
    });
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });

    try {
      const result = await fixture.commands.get("occode-setup-status")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup-status",
        args: "",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("OpenClaw Code bootstrap finished for this setup session.");
      expect(result?.text).toContain("Repo: zhyongrui/openclawcode");
      expect(result?.text).toContain("/occode-blueprint zhyongrui/openclawcode");
      expect(result?.text).toContain("Repair: openclaw gateway restart");
      expect(result?.text).toContain("Chat retry: /occode-setup-status");
      expect(mocked.runOnboardingOpenClawCodeBootstrap).not.toHaveBeenCalled();
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("proactively starts GitHub auth on service start for configured chat targets", async () => {
    const fixture = await registerPluginFixture();
    mocked.startOnboardingGitHubCliDeviceLogin.mockResolvedValue({
      pid: 654,
      logPath: "/tmp/proactive-gh-auth.log",
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      startedAt: "2026-03-21T09:00:00.000Z",
    });

    try {
      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      expect(mocked.startOnboardingGitHubCliDeviceLogin).toHaveBeenCalledWith({
        stateDir: fixture.stateDir,
      });
      expect(mocked.runOnboardingOpenClawCodeBootstrap).not.toHaveBeenCalled();
      expect(mocked.runMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "send",
          params: expect.objectContaining({
            channel: "telegram",
            to: "chat:primary",
            message: expect.stringContaining(
              "OpenClaw Code setup is waiting for GitHub approval.",
            ),
          }),
        }),
      );
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
        }),
      ).toMatchObject({
        projectMode: "existing-repo",
        repoKey: "zhyongrui/openclawcode",
        stage: "awaiting-github-device-auth",
        githubDeviceAuth: {
          pid: 654,
          userCode: "WXYZ-1234",
          verificationUri: "https://github.com/login/device",
        },
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("resolves bind-pending targets through the preferred operator chat target store", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-bind-pending-repo-"));
    const fixture = await registerPluginFixture({
      repoRoot,
      pluginConfigOverride: {
        repos: [
          {
            owner: "zhyongrui",
            repo: "openclawcode",
            repoRoot,
            baseBranch: "main",
            triggerMode: "approve",
            notifyChannel: "feishu",
            notifyTarget: "bind-pending:zhyongrui/openclawcode",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
          },
        ],
      },
    });
    mocked.startOnboardingGitHubCliDeviceLogin.mockResolvedValue({
      pid: 654,
      logPath: "/tmp/proactive-gh-auth.log",
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      startedAt: "2026-03-21T09:00:00.000Z",
    });
    await setPreferredOperatorChatTarget({
      stateDir: fixture.stateDir,
      channel: "feishu",
      target: "user:bound-operator",
      source: "feishu-quick-actions-menu",
    });

    try {
      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      expect(mocked.startOnboardingGitHubCliDeviceLogin).toHaveBeenCalledWith({
        stateDir: fixture.stateDir,
      });
      expect(mocked.runMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "send",
          params: expect.objectContaining({
            channel: "feishu",
            to: "user:bound-operator",
            message: expect.stringContaining(
              "OpenClaw Code setup is waiting for GitHub approval.",
            ),
          }),
        }),
      );
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:bound-operator",
        }),
      ).toMatchObject({
        repoKey: "zhyongrui/openclawcode",
        stage: "awaiting-github-device-auth",
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("proactively requests pairing before GitHub auth for pairing-gated user chat targets", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-plugin-repo-"));
    const fixture = await registerPluginFixture({
      repoRoot,
      config: {
        channels: {
          feishu: {
            dmPolicy: "pairing",
          },
        },
      },
      pluginConfigOverride: {
        repos: [
          {
            owner: "zhyongrui",
            repo: "openclawcode",
            repoRoot,
            baseBranch: "main",
            triggerMode: "approve",
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
          },
        ],
      },
    });
    const readAllowFromStore = fixture.runtime.channel.pairing.readAllowFromStore as unknown as ReturnType<
      typeof vi.fn
    >;
    const upsertPairingRequest = fixture.runtime.channel.pairing.upsertPairingRequest as unknown as ReturnType<
      typeof vi.fn
    >;
    readAllowFromStore.mockResolvedValue([]);
    upsertPairingRequest.mockResolvedValue({
      code: "PAIR-1234",
      created: true,
    });

    try {
      await fixture.service?.start({
        config: fixture.runtime.config.loadConfig(),
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      expect(mocked.startOnboardingGitHubCliDeviceLogin).not.toHaveBeenCalled();
      expect(upsertPairingRequest).toHaveBeenCalledWith({
        channel: "feishu",
        accountId: "default",
        id: "setup-chat",
      });
      expect(mocked.runMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "send",
          params: expect.objectContaining({
            channel: "feishu",
            to: "user:setup-chat",
            message: expect.stringContaining(
              "pairing must be approved first",
            ),
          }),
        }),
      );
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toMatchObject({
        projectMode: "existing-repo",
        repoKey: "zhyongrui/openclawcode",
        stage: "awaiting-chat-pairing",
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("automatically continues from pairing approval into proactive GitHub auth", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-plugin-repo-"));
    const fixture = await registerPluginFixture({
      pollIntervalMs: 10,
      repoRoot,
      config: {
        channels: {
          feishu: {
            dmPolicy: "pairing",
          },
        },
      },
      pluginConfigOverride: {
        repos: [
          {
            owner: "zhyongrui",
            repo: "openclawcode",
            repoRoot,
            baseBranch: "main",
            triggerMode: "approve",
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            pollIntervalMs: 10,
          },
        ],
      },
    });
    const readAllowFromStore = fixture.runtime.channel.pairing.readAllowFromStore as unknown as ReturnType<
      typeof vi.fn
    >;
    readAllowFromStore.mockResolvedValueOnce([]).mockResolvedValue(["setup-chat"]);
    mocked.startOnboardingGitHubCliDeviceLogin.mockResolvedValue({
      pid: 654,
      logPath: "/tmp/proactive-gh-auth.log",
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      startedAt: "2026-03-21T09:00:00.000Z",
    });

    try {
      await fixture.service?.start({
        config: fixture.runtime.config.loadConfig(),
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      await waitForAssertion(async () => {
        expect(mocked.startOnboardingGitHubCliDeviceLogin).toHaveBeenCalledWith({
          stateDir: fixture.stateDir,
        });
      });

      await waitForAssertion(async () => {
        expect(
          mocked.runMessageAction.mock.calls.some((call) =>
            String(call[0]?.params?.message ?? "").includes(
              "pairing must be approved first",
            ),
          ),
        ).toBe(true);
        expect(
          mocked.runMessageAction.mock.calls.some((call) =>
            String(call[0]?.params?.message ?? "").includes(
              "OpenClaw Code setup is waiting for GitHub approval.",
            ),
          ),
        ).toBe(true);
        expect(
          await fixture.store.getSetupSession({
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
          }),
        ).toMatchObject({
          stage: "awaiting-github-device-auth",
          githubDeviceAuth: {
            pid: 654,
            userCode: "WXYZ-1234",
          },
        });
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("does not proactively restart GitHub auth when the target chat already has a setup session", async () => {
    const fixture = await registerPluginFixture();
    await fixture.store.upsertSetupSession({
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
      projectMode: "new-project",
      stage: "drafting-blueprint",
      blueprintDraft: {
        status: "draft",
        sections: {
          Goal: "Bootstrap setup from the default chat target.",
        },
      },
      createdAt: "2026-03-21T09:05:00.000Z",
      updatedAt: "2026-03-21T09:05:00.000Z",
    });

    try {
      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      expect(mocked.startOnboardingGitHubCliDeviceLogin).not.toHaveBeenCalled();
      expect(mocked.runMessageAction).not.toHaveBeenCalled();
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
        }),
      ).toMatchObject({
        stage: "drafting-blueprint",
        blueprintDraft: {
          status: "draft",
        },
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("does not proactively start GitHub auth when host auth is already ready", async () => {
    const fixture = await registerPluginFixture();
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });

    try {
      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      expect(mocked.startOnboardingGitHubCliDeviceLogin).not.toHaveBeenCalled();
      expect(mocked.runMessageAction).not.toHaveBeenCalled();
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
        }),
      ).toBeUndefined();
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("discovers newly configured setup targets while the runner is already active", async () => {
    const fixture = await registerPluginFixture({
      pollIntervalMs: 10,
      pluginConfigOverride: {
        repos: [],
      },
    });
    mocked.startOnboardingGitHubCliDeviceLogin.mockResolvedValue({
      pid: 654,
      logPath: "/tmp/proactive-gh-auth.log",
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      startedAt: "2026-03-21T09:00:00.000Z",
    });

    try {
      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      expect(mocked.startOnboardingGitHubCliDeviceLogin).not.toHaveBeenCalled();
      fixture.pluginConfig.repos.push({
        owner: "zhyongrui",
        repo: "openclawcode",
        repoRoot: fixture.repoRoot,
        baseBranch: "main",
        triggerMode: "approve",
        notifyChannel: "telegram",
        notifyTarget: "chat:new-target",
        builderAgent: "main",
        verifierAgent: "main",
        testCommands: [
          "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
        ],
      });

      await waitForAssertion(async () => {
        expect(mocked.startOnboardingGitHubCliDeviceLogin).toHaveBeenCalledWith({
          stateDir: fixture.stateDir,
        });
        expect(
          await fixture.store.getSetupSession({
            notifyChannel: "telegram",
            notifyTarget: "chat:new-target",
          }),
        ).toMatchObject({
          stage: "awaiting-github-device-auth",
          repoKey: "zhyongrui/openclawcode",
          githubDeviceAuth: {
            pid: 654,
            userCode: "WXYZ-1234",
          },
        });
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("pushes the next setup message automatically after GitHub auth completes", async () => {
    const fixture = await registerPluginFixture({ pollIntervalMs: 10 });
    mocked.resolveOnboardingGitHubToken.mockReturnValue(null);
    mocked.inspectOnboardingGitHubCliDeviceLogin.mockResolvedValue({
      state: "authorized",
      running: false,
      source: "gh-auth-token",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      startedAt: "2026-03-19T02:35:00.000Z",
      completedAt: "2026-03-19T02:36:00.000Z",
    });
    mocked.runOnboardingOpenClawCodeBootstrap.mockResolvedValue({
      repo: {
        owner: "zhyongrui",
        repo: "openclawcode",
        repoKey: "zhyongrui/openclawcode",
        repoRoot: fixture.repoRoot,
        checkoutAction: "attached",
      },
      blueprint: {
        blueprintPath: path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        status: "draft",
        revisionId: "rev-bootstrap",
      },
      pluginActivation: {
        ready: true,
        pluginsEnabled: true,
        allowlisted: true,
        entryEnabled: true,
      },
      proofReadiness: {
        cliProofReady: true,
        chatProofReady: true,
        chatSetupRoutingReady: true,
      },
      handoff: {
        blueprintCommand: "/occode-blueprint zhyongrui/openclawcode",
      },
      nextAction: "clarify-project-blueprint",
    });
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "existing-repo",
      repoKey: "zhyongrui/openclawcode",
      stage: "awaiting-github-device-auth",
      githubDeviceAuth: {
        pid: 321,
        logPath: "/tmp/gh-auth.log",
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device",
        startedAt: "2026-03-19T02:35:00.000Z",
      },
      createdAt: "2026-03-19T02:35:00.000Z",
      updatedAt: "2026-03-19T02:35:00.000Z",
    });

    try {
      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      await waitForAssertion(async () => {
        expect(mocked.runMessageAction).toHaveBeenCalled();
        expect(
          mocked.runMessageAction.mock.calls.some((call) =>
            String(call[0]?.params?.message ?? "").includes(
              "OpenClaw Code bootstrap finished for this setup session.",
            ),
          ),
        ).toBe(true);
      });

      expect(
        mocked.runMessageAction.mock.calls.some((call) =>
          String(call[0]?.params?.message ?? "").includes("Plugin activation: ready"),
        ),
      ).toBe(true);
      expect(mocked.runOnboardingOpenClawCodeBootstrap).toHaveBeenCalledWith({
        repo: "zhyongrui/openclawcode",
      });
      await waitForAssertion(async () => {
        expect(
          await fixture.store.getSetupSession({
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
          }),
        ).toMatchObject({
          stage: "bootstrap-complete",
          githubAuthSource: "gh-auth-token",
          githubDeviceAuth: {
            completedAt: "2026-03-19T02:36:00.000Z",
            notificationState: "authorized",
          },
          bootstrap: {
            pluginActivation: {
              ready: true,
            },
            proofReadiness: {
              chatSetupRoutingReady: true,
            },
          },
        });
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("pushes a retry message automatically after GitHub auth fails", async () => {
    const fixture = await registerPluginFixture({ pollIntervalMs: 10 });
    mocked.resolveOnboardingGitHubToken.mockReturnValue(null);
    mocked.inspectOnboardingGitHubCliDeviceLogin.mockResolvedValue({
      state: "failed",
      running: false,
      reason: "GitHub device approval expired.",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      startedAt: "2026-03-19T02:35:00.000Z",
      completedAt: "2026-03-19T02:40:00.000Z",
    });
    await fixture.store.upsertSetupSession({
      notifyChannel: "feishu",
      notifyTarget: "user:setup-chat",
      projectMode: "existing-repo",
      repoKey: "zhyongrui/openclawcode",
      stage: "awaiting-github-device-auth",
      githubDeviceAuth: {
        pid: 321,
        logPath: "/tmp/gh-auth.log",
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device",
        startedAt: "2026-03-19T02:35:00.000Z",
      },
      createdAt: "2026-03-19T02:35:00.000Z",
      updatedAt: "2026-03-19T02:35:00.000Z",
    });

    try {
      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      await waitForAssertion(async () => {
        expect(mocked.runMessageAction).toHaveBeenCalled();
        expect(
          mocked.runMessageAction.mock.calls.some((call) =>
            String(call[0]?.params?.message ?? "").includes("GitHub device approval expired."),
          ),
        ).toBe(true);
      });

      expect(mocked.runOnboardingOpenClawCodeBootstrap).not.toHaveBeenCalled();
      await waitForAssertion(async () => {
        expect(
          await fixture.store.getSetupSession({
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
          }),
        ).toMatchObject({
          stage: "awaiting-github-device-auth",
          githubDeviceAuth: {
            failureReason: "GitHub device approval expired.",
            notificationState: "failed",
          },
        });
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("captures blueprint alignment details after bootstrap completes", async () => {
    const fixture = await registerPluginFixture();
    mocked.resolveOnboardingGitHubToken.mockReturnValue({
      token: "gho_test",
      source: "gh-auth-token",
    });
    await createProjectBlueprint({
      repoRoot: fixture.repoRoot,
      title: "OpenClawCode target blueprint",
      goal: "Ship chat-native setup with clear operator guidance.",
    });
    mocked.runOnboardingOpenClawCodeBootstrap.mockResolvedValue({
      repo: {
        owner: "zhyongrui",
        repo: "openclawcode",
        repoKey: "zhyongrui/openclawcode",
        repoRoot: fixture.repoRoot,
        checkoutAction: "attached",
      },
      blueprint: {
        blueprintPath: path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        status: "draft",
        revisionId: "rev-blueprint",
      },
      handoff: {
        blueprintCommand: "/occode-blueprint zhyongrui/openclawcode",
      },
      nextAction: "clarify-project-blueprint",
    });

    try {
      const result = await fixture.commands.get("occode-setup")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-setup existing zhyongrui/openclawcode",
        args: "existing zhyongrui/openclawcode",
        to: "user:setup-chat",
        config: {},
      });

      expect(result?.text).toContain("Blueprint goal: Ship chat-native setup with clear operator guidance.");
      expect(result?.text).toContain("Clarifications:");
      expect(result?.text).toContain("/occode-blueprint zhyongrui/openclawcode");
      expect(
        await fixture.store.getSetupSession({
          notifyChannel: "feishu",
          notifyTarget: "user:setup-chat",
        }),
      ).toMatchObject({
        stage: "bootstrap-complete",
        bootstrap: {
          blueprintGoalSummary: "Ship chat-native setup with clear operator guidance.",
        },
      });
      expect(
        (
          await fixture.store.getSetupSession({
            notifyChannel: "feishu",
            notifyTarget: "user:setup-chat",
          })
        )?.bootstrap?.clarificationQuestions?.length,
      ).toBeGreaterThan(0);
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("uses a saved repo binding as the webhook notification target", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setRepoBinding({
        repoKey: "zhyongrui/openclawcode",
        notifyChannel: "feishu",
        notifyTarget: "user:bound-chat",
      });
      mocked.readRequestBodyWithLimit.mockResolvedValue(issueWebhookPayload(209));
      const res = createMockServerResponse();

      const handled = await fixture.route?.handler(
        localReq({
          method: "POST",
          url: "/plugins/openclawcode/github",
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": "delivery-209-a",
          },
        }),
        res,
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(202);
      await waitForAssertion(() => {
        expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
      });
      expect(mocked.runMessageAction.mock.calls[0]?.[0]).toMatchObject({
        action: "send",
        params: expect.objectContaining({
          channel: "feishu",
          to: "user:bound-chat",
          message: expect.stringContaining("/occode-start zhyongrui/openclawcode#209"),
        }),
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingApprovals).toEqual([
        {
          issueKey: "zhyongrui/openclawcode#209",
          notifyChannel: "feishu",
          notifyTarget: "user:bound-chat",
        },
      ]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("removes a saved repo binding through /occode-unbind", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setRepoBinding({
        repoKey: "zhyongrui/openclawcode",
        notifyChannel: "feishu",
        notifyTarget: "user:bound-chat",
      });

      const result = await fixture.commands.get("occode-unbind")?.handler({
        channel: "feishu",
        isAuthorizedSender: true,
        commandBody: "/occode-unbind",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: "Removed notification binding for zhyongrui/openclawcode.",
      });
      expect(await fixture.store.getRepoBinding("zhyongrui/openclawcode")).toBeUndefined();
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("skips pending approvals through /occode-skip", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#205",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });

      const result = await fixture.commands.get("occode-skip")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-skip #205",
        args: "#205",
        config: {},
      });

      expect(result).toEqual({
        text: "Skipped pending approval for zhyongrui/openclawcode#205.",
      });
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.pendingApprovals).toEqual([]);
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#205"]).toBe(
        "Skipped before execution.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("falls back to local workflow run records in /occode-status", async () => {
    const fixture = await registerPluginFixture();
    try {
      await writeLocalRun({
        repoRoot: fixture.repoRoot,
        issueNumber: 206,
        stage: "merged",
        prUrl: "https://github.com/zhyongrui/openclawcode/pull/206",
      });

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #206",
        args: "#206",
        config: {},
      });

      expect(result?.text).toContain("Stage: Merged");
      expect(result?.text).toContain("PR: https://github.com/zhyongrui/openclawcode/pull/206");
      expect(result?.text).toContain(`Operator repo root: ${fixture.repoRoot}`);
      expect(result?.text).toContain("Operator baseline: main");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows completed-without-changes local runs through /occode-status", async () => {
    const fixture = await registerPluginFixture();
    try {
      await writeLocalRun({
        repoRoot: fixture.repoRoot,
        issueNumber: 244,
        stage: "completed-without-changes",
        summary: "The issue was already satisfied; no code changes or PR were needed.",
      });

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #244",
        args: "#244",
        config: {},
      });

      expect(result?.text).toContain("Stage: Completed Without Changes");
      expect(result?.text).toContain(
        "Summary: The issue was already satisfied; no code changes or PR were needed.",
      );
      expect(result?.text).toContain(`Operator repo root: ${fixture.repoRoot}`);
      expect(result?.text).toContain("Operator baseline: main");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("annotates validation issue metadata through /occode-status", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createGitHubIssueResponse({
              issueNumber: 266,
              title: "[Feature]: Expose stageRecordCount in openclaw code run --json output",
              body: [
                "<!-- openclawcode-validation template=command-json-number class=command-layer -->",
                "",
                "Summary",
                "Add one stable top-level numeric field to `openclaw code run --json` named `stageRecordCount`.",
              ].join("\n"),
            }),
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #266",
        args: "#266",
        config: {},
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/repos/zhyongrui/openclawcode/issues/266",
        expect.any(Object),
      );
      expect(result).toEqual({
        text: [
          "No openclawcode status recorded yet for zhyongrui/openclawcode#266.",
          `Operator repo root: ${fixture.repoRoot}`,
          "Operator baseline: main",
          "Validation issue: command-layer",
          "Validation template: command-json-number",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows an active provider pause through /occode-status", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6621,
          stage: "failed",
          updatedAt: "2099-03-12T12:00:00.000Z",
        }),
        buildTransientProviderFailedStatus(6621),
      );
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6622,
          stage: "failed",
          updatedAt: "2099-03-12T12:05:00.000Z",
        }),
        buildTransientProviderFailedStatus(6622),
      );

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #267",
        args: "#267",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "No openclawcode status recorded yet for zhyongrui/openclawcode#267.",
          "Provider pause: active until 2099-03-12T12:15:00.000Z",
          "- failures: 2 | last failure: 2099-03-12T12:05:00.000Z",
          "- reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
          "- impact: new work can still queue, but queued runs will not start until the pause clears.",
          "- recovery: queue drain resumes automatically after the pause window elapses.",
          `Operator repo root: ${fixture.repoRoot}`,
          "Operator baseline: main",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("keeps recent provider failure context in /occode-status after the pause clears", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6621,
          stage: "failed",
          updatedAt: "2026-03-12T12:00:00.000Z",
        }),
        buildTransientProviderFailedStatus(6621),
      );
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6622,
          stage: "failed",
          updatedAt: "2026-03-12T12:05:00.000Z",
        }),
        buildTransientProviderFailedStatus(6622),
      );

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #6622",
        args: "#6622",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode status for zhyongrui/openclawcode#6622",
          "Stage: Failed",
          "Summary: Build failed: HTTP 400: Internal server error",
          "Provider failure context: pause cleared after 2026-03-12T12:15:00.000Z | last transient failure at 2026-03-12T12:05:00.000Z | failures: 2",
          "Provider failure reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
          `Operator repo root: ${fixture.repoRoot}`,
          "Operator baseline: main",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows structured failure diagnostics through /occode-status after a failed run is recorded", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6623,
          stage: "failed",
          updatedAt: "2026-03-12T12:06:00.000Z",
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
        }),
        buildTransientProviderFailedStatus(6623),
      );

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #6623",
        args: "#6623",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode status for zhyongrui/openclawcode#6623",
          "Stage: Failed",
          "Summary: Build failed: HTTP 400: Internal server error",
          "Provider failure context: last transient failure at 2026-03-12T12:06:00.000Z | failures: 1",
          "Failure diagnostics: model=crs/gpt-5.4, prompt=8629, skillsPrompt=1245, schema=3030, tools=4, skills=1, files=0, usage=0, bootstrap=clean",
          `Operator repo root: ${fixture.repoRoot}`,
          "Operator baseline: main",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows suitability policy explanation through /occode-status when autonomous execution is blocked", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#6624",
        status: [
          "openclawcode status for zhyongrui/openclawcode#6624",
          "Stage: Escalated",
          "Summary: Escalated before execution.",
        ].join("\n"),
        stage: "escalated",
        runId: "run-6624",
        updatedAt: "2026-03-12T12:07:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 6624,
        suitabilityDecision: "needs-human-review",
        suitabilitySummary:
          "Needs human review because the issue requests policy changes outside command-layer scope.",
      });

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #6624",
        args: "#6624",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode status for zhyongrui/openclawcode#6624",
          "Stage: Escalated",
          "Summary: Escalated before execution.",
          "Suitability policy: needs-human-review | Needs human review because the issue requests policy changes outside command-layer scope.",
          `Operator repo root: ${fixture.repoRoot}`,
          "Operator baseline: main",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows suitability override details through /occode-status", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6626,
          stage: "ready-for-human-review",
          suitability: {
            decision: "auto-run",
            summary: "Suitability override accepted for this run.",
            reasons: ["Operator approved a narrow exception."],
            classification: "mixed",
            riskLevel: "medium",
            evaluatedAt: "2026-03-17T10:00:00.000Z",
            allowlisted: false,
            denylisted: false,
            originalDecision: "needs-human-review",
            overrideApplied: true,
            overrideActor: "user:operator",
            overrideReason: "Approved for this one run.",
          },
        }),
        "Verification approved the run for human review.",
      );

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #6626",
        args: "#6626",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "Verification approved the run for human review.",
          "Suitability policy: auto-run | Suitability override accepted for this run.",
          "Suitability override: applied | Approved for this one run.",
          "Auto-merge policy: blocked | Not eligible for auto-merge: manual suitability overrides still require a human merge decision.",
          `Operator repo root: ${fixture.repoRoot}`,
          "Operator baseline: main",
        ].join("\n"),
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows handoff summary through /occode-status", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#6628",
        status: "Verification approved the run for human review.",
        stage: "ready-for-human-review",
        runId: "run-6628",
        updatedAt: "2026-03-21T01:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 6628,
        runtimeRoutingSummary:
          "coder=codex-alt | adapter=codex | source=stage-steering || verifier=claude-main | adapter=claude-code | source=role-env",
        handoffEntries: [
          {
            kind: "stage-gate-decision",
            recordedAt: "2026-03-21T00:55:00.000Z",
            summary: "execution-start approved | Accepted for this run",
            gateId: "execution-start",
            decision: "approved",
          },
          {
            kind: "runtime-reroute",
            recordedAt: "2026-03-21T00:56:00.000Z",
            summary: "coder=codex-alt",
            requestedCoderAgentId: "codex-alt",
          },
          {
            kind: "runtime-steering",
            recordedAt: "2026-03-21T00:56:30.000Z",
            summary: "stage=building | role=coder | adapter=codex | agent=codex-alt",
          },
          {
            kind: "suitability-override",
            recordedAt: "2026-03-21T00:57:00.000Z",
            summary: "Approved for this one run.",
            actor: "user:operator",
          },
        ],
      });

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #6628",
        args: "#6628",
        config: {},
      });

      expect(result?.text).toContain(
        "Runtime routing: coder=codex-alt | adapter=codex | source=stage-steering || verifier=claude-main | adapter=claude-code | source=role-env",
      );
      expect(result?.text).toContain(
        "Handoffs: runtime-reroute=1, runtime-steering=1, stage-gate-decision=1, suitability-override=1",
      );
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows repo-level policy guidance through /occode-policy", async () => {
    const fixture = await registerPluginFixture();
    try {
      const result = await fixture.commands.get("occode-policy")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-policy",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode policy for zhyongrui/openclawcode",
          "Policy contract version: 1",
          "Suitability allowlist labels: cli, json, command-layer, docs, operator-docs, validation",
          "Suitability denylist labels: auth, authentication, billing, database, infra, migration, permissions, rbac, secret, secrets, security",
          "Build guardrails: lines>=300 | files>=12 | fan-out files>=8 | dirs>=4",
          "Provider auto-pause classes: provider-internal-error",
          "Suitability override path: /occode-start-override zhyongrui/openclawcode#123",
          "Merge override path: /occode-gate-decide zhyongrui/openclawcode merge-promotion approved [note]",
          "Auto-merge policy doc: docs/openclawcode/auto-merge-policy.md",
          "Use /occode-status owner/repo#issue to inspect the latest tracked policy decision for a specific run.",
        ].join("\n"),
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows issue-specific policy context through /occode-policy", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6627,
          stage: "ready-for-human-review",
          suitability: {
            decision: "auto-run",
            summary: "Suitability override accepted for this run.",
            reasons: ["Operator approved a narrow exception."],
            classification: "mixed",
            riskLevel: "medium",
            evaluatedAt: "2026-03-17T10:00:00.000Z",
            allowlisted: false,
            denylisted: false,
            originalDecision: "needs-human-review",
            overrideApplied: true,
            overrideActor: "user:operator",
            overrideReason: "Approved for this one run.",
          },
        }),
        "Verification approved the run for human review.",
      );

      const result = await fixture.commands.get("occode-policy")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-policy #6627",
        args: "#6627",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode policy for zhyongrui/openclawcode",
          "Issue: zhyongrui/openclawcode#6627",
          "Policy contract version: 1",
          "Suitability allowlist labels: cli, json, command-layer, docs, operator-docs, validation",
          "Suitability denylist labels: auth, authentication, billing, database, infra, migration, permissions, rbac, secret, secrets, security",
          "Build guardrails: lines>=300 | files>=12 | fan-out files>=8 | dirs>=4",
          "Provider auto-pause classes: provider-internal-error",
          "Current suitability: auto-run | Suitability override accepted for this run.",
          "Current suitability override: applied | Approved for this one run.",
          "Current auto-merge: blocked | Not eligible for auto-merge: manual suitability overrides still require a human merge decision.",
          "Suitability override path: /occode-start-override zhyongrui/openclawcode#6627",
          "Merge override path: /occode-gate-decide zhyongrui/openclawcode merge-promotion approved [note]",
          "Auto-merge policy doc: docs/openclawcode/auto-merge-policy.md",
          "Use /occode-status owner/repo#issue to inspect the latest tracked policy decision for a specific run.",
        ].join("\n"),
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows auto-merge policy explanation through /occode-status when auto-merge is disallowed", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#6625",
        status: [
          "openclawcode status for zhyongrui/openclawcode#6625",
          "Stage: Ready For Human Review",
          "Summary: Verification approved the run for human review.",
        ].join("\n"),
        stage: "ready-for-human-review",
        runId: "run-6625",
        updatedAt: "2026-03-12T12:08:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 6625,
        autoMergePolicyEligible: false,
        autoMergePolicyReason:
          "Not eligible for auto-merge: the run is not classified as command-layer.",
      });

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #6625",
        args: "#6625",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode status for zhyongrui/openclawcode#6625",
          "Stage: Ready For Human Review",
          "Summary: Verification approved the run for human review.",
          "Auto-merge policy: blocked | Not eligible for auto-merge: the run is not classified as command-layer.",
          `Operator repo root: ${fixture.repoRoot}`,
          "Operator baseline: main",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("heals /occode-status from GitHub when a tracked pull request was merged externally", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#207",
        status: "openclawcode status for zhyongrui/openclawcode#207\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-207",
        updatedAt: "2026-03-10T09:10:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 207,
        branchName: "openclawcode/issue-207",
        pullRequestNumber: 307,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/307",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              number: 307,
              html_url: "https://github.com/zhyongrui/openclawcode/pull/307",
              state: "closed",
              draft: false,
              merged: true,
              merged_at: "2026-03-10T09:15:00.000Z",
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            },
          ),
        ),
      );

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #207",
        args: "#207",
        config: {},
      });

      expect(result?.text).toContain("Stage: Merged");
      const snapshot = await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#207");
      expect(snapshot?.stage).toBe("merged");
      expect(snapshot?.updatedAt).toBe("2026-03-10T09:15:00.000Z");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("heals /occode-status from GitHub when a tracked pull request review requests changes", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#210",
        status: "openclawcode status for zhyongrui/openclawcode#210\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-210",
        updatedAt: "2026-03-10T09:10:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 210,
        branchName: "openclawcode/issue-210",
        pullRequestNumber: 310,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/310",
      });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                number: 310,
                html_url: "https://github.com/zhyongrui/openclawcode/pull/310",
                state: "open",
                draft: false,
                merged: false,
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            ),
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify([
                {
                  state: "CHANGES_REQUESTED",
                  submitted_at: "2026-03-10T09:15:00.000Z",
                },
              ]),
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            ),
          ),
      );

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #210",
        args: "#210",
        config: {},
      });

      expect(result?.text).toContain("Stage: Changes Requested");
      const snapshot = await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#210");
      expect(snapshot?.stage).toBe("changes-requested");
      expect(snapshot?.updatedAt).toBe("2026-03-10T09:15:00.000Z");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("heals /occode-status from GitHub when a tracked pull request was closed without merge", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#211",
        status: "openclawcode status for zhyongrui/openclawcode#211\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-211",
        updatedAt: "2026-03-10T09:10:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 211,
        branchName: "openclawcode/issue-211",
        pullRequestNumber: 311,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/311",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              number: 311,
              html_url: "https://github.com/zhyongrui/openclawcode/pull/311",
              state: "closed",
              draft: false,
              merged: false,
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            },
          ),
        ),
      );

      const result = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #211",
        args: "#211",
        config: {},
      });

      expect(result?.text).toContain("Stage: Escalated");
      const snapshot = await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#211");
      expect(snapshot?.stage).toBe("escalated");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows pending, running, queued, and recent activity through /occode-inbox", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.addPendingApproval({
        issueKey: "zhyongrui/openclawcode#301",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#303",
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 303,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-303",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            openPullRequest: true,
            mergeOnApprove: true,
          },
        },
        "Queued.",
      );
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#302",
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 302,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-302",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            openPullRequest: true,
            mergeOnApprove: true,
            rerunContext: {
              reason: "Address GitHub review feedback",
              requestedAt: "2026-03-11T02:50:00.000Z",
              priorRunId: "run-301",
              priorStage: "changes-requested",
            },
          },
        },
        "Queued.",
      );
      await fixture.store.startNext("Running.");
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#304",
        status: "openclawcode status for zhyongrui/openclawcode#304\nStage: Merged",
        stage: "merged",
        runId: "run-304",
        updatedAt: "2026-03-11T03:00:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 304,
        branchName: "openclawcode/issue-304",
        pullRequestNumber: 404,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/404",
        suitabilityDecision: "auto-run",
        suitabilitySummary:
          "Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
        lastNotificationChannel: "telegram",
        lastNotificationTarget: "chat:merge-target",
        lastNotificationAt: "2026-03-11T03:01:00.000Z",
        lastNotificationStatus: "sent",
      });
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#305",
        status: "openclawcode status for zhyongrui/openclawcode#305\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-305",
        updatedAt: "2026-03-11T02:58:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 305,
        branchName: "openclawcode/issue-305",
        rerunReason: "Address GitHub review feedback",
        rerunRequestedAt: "2026-03-11T02:40:00.000Z",
        rerunPriorRunId: "run-300",
        rerunPriorStage: "changes-requested",
        suitabilityDecision: "needs-human-review",
        suitabilitySummary:
          "Suitability recommends human review before autonomous execution. Issue is classified as mixed scope instead of command-layer.",
        lastNotificationChannel: "feishu",
        lastNotificationTarget: "user:review-chat",
        lastNotificationAt: "2026-03-11T02:59:00.000Z",
        lastNotificationStatus: "sent",
      });
      await fixture.store.recordGitHubDelivery({
        deliveryId: "delivery-304-merged",
        eventName: "pull_request",
        action: "closed",
        accepted: true,
        reason: "pull-request-merged",
        receivedAt: "2026-03-11T03:00:30.000Z",
        issueKey: "zhyongrui/openclawcode#304",
        pullRequestNumber: 404,
      });
      await fixture.store.recordGitHubDelivery({
        deliveryId: "delivery-305-approved",
        eventName: "pull_request_review",
        action: "submitted",
        accepted: true,
        reason: "review-approved",
        receivedAt: "2026-03-11T02:58:30.000Z",
        issueKey: "zhyongrui/openclawcode#305",
      });

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode inbox for zhyongrui/openclawcode",
          "Pending approvals: 1",
          "- zhyongrui/openclawcode#301 | Awaiting chat approval.",
          "  action: /occode-start zhyongrui/openclawcode#301",
          "Running: 1",
          "- zhyongrui/openclawcode#303 | Running.",
          "  action: /occode-status zhyongrui/openclawcode#303",
          "  takeover: /occode-takeover zhyongrui/openclawcode#303 [note]",
          "Queued: 1",
          "- zhyongrui/openclawcode#302 | Queued.",
          "  action: /occode-status zhyongrui/openclawcode#302",
          "  skip: /occode-skip zhyongrui/openclawcode#302 [reason]",
          "  rerun: run-301 | from Changes Requested | 2026-03-11T02:50:00.000Z",
          "  reason: Address GitHub review feedback",
          "Recent ledger: 2",
          "- zhyongrui/openclawcode#304 | Merged | final: merged | PR #404 | 2026-03-11T03:00:00.000Z",
          "  events: pull request merged @ 2026-03-11T03:00:30.000Z",
          "  suitability: auto-run | Suitability accepted for autonomous execution. Issue stays within command-layer scope.",
          "  notify: sent | telegram:chat:merge-target | 2026-03-11T03:01:00.000Z",
          "- zhyongrui/openclawcode#305 | Ready For Human Review | final: awaiting human review | 2026-03-11T02:58:00.000Z",
          "  events: review approved @ 2026-03-11T02:58:30.000Z",
          "  suitability: needs-human-review | Suitability recommends human review before autonomous execution. Issue is classified as mixed scope instead of command-layer.",
          "  policy: /occode-policy zhyongrui/openclawcode#305",
          "  rerun: run-300 | from Changes Requested | 2026-03-11T02:40:00.000Z",
          "  reason: Address GitHub review feedback",
          "  notify: sent | feishu:user:review-chat | 2026-03-11T02:59:00.000Z",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows an empty summary through /occode-inbox when there is no tracked activity", async () => {
    const fixture = await registerPluginFixture();
    try {
      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode inbox for zhyongrui/openclawcode",
          "Pending approvals: 0",
          "Running: 0",
          "Queued: 0",
          "Recent ledger: 0",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows execution-start approval actions through /occode-inbox", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.upsertPendingApproval(
        {
          issueKey: "zhyongrui/openclawcode#307",
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
          approvalKind: "execution-start-gated",
        },
        "Awaiting execution-start gate approval.",
      );

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result?.text).toContain(
        "- zhyongrui/openclawcode#307 | Awaiting execution-start gate approval.",
      );
      expect(result?.text).toContain("  action: /occode-gates zhyongrui/openclawcode");
      expect(result?.text).toContain(
        "  approve: /occode-gate-decide zhyongrui/openclawcode execution-start approved [note]",
      );
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows policy shortcuts for queued policy-sensitive issues through /occode-inbox", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 306,
          stage: "ready-for-human-review",
          updatedAt: "2026-03-11T03:05:00.000Z",
          suitability: {
            decision: "auto-run",
            summary: "Suitability override accepted for this run.",
            reasons: ["Operator approved a narrow exception."],
            classification: "mixed",
            riskLevel: "medium",
            evaluatedAt: "2026-03-11T03:04:00.000Z",
            allowlisted: false,
            denylisted: false,
            originalDecision: "needs-human-review",
            overrideApplied: true,
            overrideActor: "user:operator",
            overrideReason: "Approved for this queued rerun.",
          },
        }),
        "Queued after explicit override approval.",
      );
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#306",
          notifyChannel: "telegram",
          notifyTarget: "chat:override",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 306,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-306-rerun",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            openPullRequest: true,
            mergeOnApprove: false,
          },
        },
        "Queued after explicit override approval.",
      );

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result?.text).toContain(
        "- zhyongrui/openclawcode#306 | Queued after explicit override approval.",
      );
      expect(result?.text).toContain("  action: /occode-status zhyongrui/openclawcode#306");
      expect(result?.text).toContain("  skip: /occode-skip zhyongrui/openclawcode#306 [reason]");
      expect(result?.text).toContain("  policy: /occode-policy zhyongrui/openclawcode#306");
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows promotion and rollback readiness through /occode-inbox when setup-check succeeds", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.mkdir(path.join(fixture.repoRoot, ".openclawcode"), { recursive: true });
      await fs.writeFile(
        path.join(fixture.repoRoot, ".openclawcode", "promotion-receipt.json"),
        `${JSON.stringify(
          {
            exists: true,
            schemaVersion: 1,
            recordedAt: "2026-03-16T09:00:00.000Z",
            actor: "user:promoter",
            promotedRef: "main@abc123",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(fixture.repoRoot, ".openclawcode", "rollback-receipt.json"),
        `${JSON.stringify(
          {
            exists: true,
            schemaVersion: 1,
            recordedAt: "2026-03-16T09:05:00.000Z",
            actor: "user:rollback",
            restoredRef: "main@def456",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      fixture.runCommandWithTimeout.mockResolvedValue({
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          strict: true,
          repoRoot: fixture.repoRoot,
          operatorRoot: fixture.repoRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: true,
            fallbackProofReady: false,
            promotionReady: true,
            gatewayReachable: true,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: false,
            builtStartupProofReady: true,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 19,
            warn: 0,
            fail: 0,
          },
        }),
        stderr: "",
      });

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result?.text).toContain("Promotion readiness: ready | next=ready-for-low-risk-proof");
      expect(result?.text).toContain("Proof readiness: low-risk=ready | fallback=blocked");
      expect(result?.text).toContain("Rollback readiness: ready | target=main");
      expect(result?.text).toContain("Setup-check summary: pass=19 | warn=0 | fail=0");
      expect(result?.text).toContain(
        "Latest promotion receipt: main@abc123 | actor=user:promoter | 2026-03-16T09:00:00.000Z",
      );
      expect(result?.text).toContain(
        "Latest rollback receipt: main@def456 | actor=user:rollback | 2026-03-16T09:05:00.000Z",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows a compact promotion checklist command", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.mkdir(path.join(fixture.repoRoot, ".openclawcode"), { recursive: true });
      await fs.writeFile(
        path.join(fixture.repoRoot, ".openclawcode", "promotion-receipt.json"),
        `${JSON.stringify(
          {
            exists: true,
            schemaVersion: 1,
            recordedAt: "2026-03-16T09:10:00.000Z",
            actor: "user:promoter",
            promotedRef: "main@aaa111",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      fixture.runCommandWithTimeout.mockResolvedValue({
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          strict: true,
          repoRoot: fixture.repoRoot,
          operatorRoot: fixture.repoRoot,
          readiness: {
            basic: true,
            strict: true,
            lowRiskProofReady: false,
            fallbackProofReady: false,
            promotionReady: false,
            gatewayReachable: true,
            routeProbeReady: true,
            routeProbeSkipped: false,
            builtStartupProofRequested: true,
            builtStartupProofReady: true,
            nextAction: "ready-for-low-risk-proof",
          },
          summary: {
            pass: 18,
            warn: 1,
            fail: 0,
          },
        }),
        stderr: "",
      });

      const result = await fixture.commands.get("occode-promotion-checklist")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-promotion-checklist",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode promotion checklist for zhyongrui/openclawcode",
          `Operator repo root: ${fixture.repoRoot}`,
          "Operator baseline: main",
          `Operator root: ${fixture.repoRoot}`,
          "Promotion readiness: blocked | next=ready-for-low-risk-proof",
          "Proof readiness: low-risk=blocked | fallback=blocked",
          "Rollback readiness: ready | target=main",
          "Setup-check summary: pass=18 | warn=1 | fail=0",
          "Latest promotion receipt: main@aaa111 | actor=user:promoter | 2026-03-16T09:10:00.000Z",
          "Checklist: strict=yes | gateway=yes | route-probe=yes | built-startup=yes",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows validation pool inventory through /occode-inbox", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify([
              createGitHubIssueResponse({
                issueNumber: 60,
                title: "[Docs]: Clarify copied-root fresh-operator proof expectations",
                body: [
                  "<!-- openclawcode-validation template=operator-doc-note class=operator-docs -->",
                  "",
                  "Summary",
                  "Clarify the copied-root validation proof in the operator runbook.",
                ].join("\n"),
              }),
              createGitHubIssueResponse({
                issueNumber: 66,
                title: "[Feature]: Expose stageRecordCount in openclaw code run --json output",
                body: [
                  "<!-- openclawcode-validation template=command-json-number class=command-layer -->",
                  "",
                  "Summary",
                  "Add one stable top-level numeric field to `openclaw code run --json` named `stageRecordCount`.",
                ].join("\n"),
              }),
              createGitHubIssueResponse({
                issueNumber: 99,
                title: "Non-validation issue",
                body: "Leave me out of the validation pool.",
              }),
            ]),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            },
          ),
        ),
      );

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode inbox for zhyongrui/openclawcode",
          "Pending approvals: 0",
          "Running: 0",
          "Queued: 0",
          "Recent ledger: 0",
          "Validation pool: 2",
          "- classes: command-layer 1, operator-docs 1",
          "- templates: command-json-number 1, operator-doc-note 1",
          "- #60 | operator-docs | operator-doc-note | [Docs]: Clarify copied-root fresh-operator proof expectations",
          "- #66 | command-layer | command-json-number | [Feature]: Expose stageRecordCount in openclaw code run --json output",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows blueprint work-item backlog through /occode-inbox", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Inbox Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:00:00.000Z",
          "statusChangedAt: 2026-03-16T00:00:00.000Z",
          "agreedAt: 2026-03-16T00:00:00.000Z",
          "---",
          "",
          "# Inbox Blueprint",
          "",
          "## Goal",
          "Surface work-item backlog counts in chat-visible inbox output.",
          "",
          "## Success Criteria",
          "- /occode-inbox shows projected work-item totals and readiness.",
          "",
          "## Scope",
          "- In scope: operator-facing backlog summaries.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Keep the output compact.",
          "",
          "## Risks",
          "- Backlog drift could stay invisible without chat exposure.",
          "",
          "## Assumptions",
          "- The blueprint has already been agreed.",
          "",
          "## Human Gates",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "",
          "## Workstreams",
          "- Add a compact backlog summary to /occode-inbox.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-16: backlog inbox proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      const inventory = await writeProjectWorkItemInventory(fixture.repoRoot);

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result?.text).toContain(
        "Blueprint backlog: 1 items | planned=1 | discovered=0 | stale=no",
      );
      expect(result?.text).toContain(
        `- blueprint: agreed | revision ${inventory.blueprintRevisionId}`,
      );
      expect(result?.text).toContain(
        "- issue projection: ready | execution: ready | blockers=0 | suggestions=3",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows blueprint summary and clarification prompts through /occode-blueprint", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Chat Blueprint",
          "status: clarified",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Chat Blueprint",
          "",
          "## Goal",
          "Move the blueprint discussion loop into chat-visible operator flows.",
          "",
          "## Success Criteria",
          "- Operators can inspect the blueprint summary from chat.",
          "",
          "## Scope",
          "- In scope: read-only blueprint status and clarification output.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Keep the summary concise enough for chat.",
          "",
          "## Risks",
          "- Operators may miss unresolved questions if the summary is too sparse.",
          "",
          "## Assumptions",
          "- Chat users still need deterministic prompts.",
          "",
          "## Human Gates",
          "- Goal agreement: required",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "",
          "## Workstreams",
          "- Add a read-only blueprint summary command for chat.",
          "- Follow with a mutable chat discussion loop later.",
          "",
          "## Open Questions",
          "- Who should be allowed to mark the blueprint as agreed from chat?",
          "",
          "## Change Log",
          "- 2026-03-16: initial chat blueprint view.",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await fixture.commands.get("occode-blueprint")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-blueprint",
        args: "",
        config: {},
      });

      expect(result?.text).toContain("openclawcode blueprint for zhyongrui/openclawcode");
      expect(result?.text).toContain("Title: Chat Blueprint");
      expect(result?.text).toContain("Status: clarified");
      expect(result?.text).toContain(
        "Goal: Move the blueprint discussion loop into chat-visible operator flows.",
      );
      expect(result?.text).toContain(
        "Counts: workstreams=2 | openQuestions=1 | humanGates=2 | defaulted=0",
      );
      expect(result?.text).toContain("Provider strategy: planner=Claude Code, coder=Codex");
      expect(result?.text).toContain("Clarifications: 1");
      expect(result?.text).toContain(
        "Priority question: Confirm the remaining `Open Questions` entries or replace them with `- None.` when settled.",
      );
      expect(result?.text).toContain(
        "- Confirm the remaining `Open Questions` entries or replace them with `- None.` when settled.",
      );
      expect(result?.text).toContain("Suggestions: 3");
      expect(result?.text).toContain(
        "- When the team agrees on the target, record it with `openclaw code blueprint-set-status --status agreed`.",
      );
      expect(result?.text).toContain(
        "- Record explicit assignments for Reviewer, Verifier, and Doc-writer under `Provider Strategy` when you want a fixed multi-agent plan.",
      );
      expect(result?.text).toContain(
        "- Capture at least one user or operator story in `Scope` or `Workstreams` so the first slice has a concrete beneficiary.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("captures a repo-level goal from chat before issue creation", async () => {
    const fixture = await registerPluginFixture();
    try {
      const result = await fixture.commands.get("occode-goal")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody:
          "/occode-goal Move the operator from issue-first execution to blueprint-first planning.",
        args: "Move the operator from issue-first execution to blueprint-first planning.",
        config: {},
      });

      expect(result?.text).toContain("updated the blueprint goal");
      expect(result?.text).toContain("Goal: Move the operator from issue-first execution");
      expect(result?.text).toContain("Priority question:");
      expect(result?.text).toContain("Clarifications:");

      const content = await fs.readFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        "utf8",
      );
      expect(content).toContain(
        "Move the operator from issue-first execution to blueprint-first planning.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("marks the blueprint as agreed from chat", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Agreement Blueprint",
          "status: clarified",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# Agreement Blueprint",
          "",
          "## Goal",
          "Deliver blueprint-first releases safely.",
          "",
          "## Success Criteria",
          "- Operators can mark the blueprint as agreed from chat.",
          "",
          "## Scope",
          "- In scope: repo-local agreement and gate refresh.",
          "- Out of scope: external live proof.",
          "",
          "## Non-Goals",
          "- Replace the existing issue runner.",
          "",
          "## Constraints",
          "- Keep the change in chat-facing control paths.",
          "",
          "## Risks",
          "- Agreement may happen before validation is complete.",
          "",
          "## Assumptions",
          "- Operators will resolve placeholders first.",
          "",
          "## Human Gates",
          "- Goal agreement: required",
          "",
          "## Provider Strategy",
          "- Planner: Codex",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- [ ] Mark the blueprint as agreed from chat.",
          "",
          "## Open Questions",
          "- None.",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await fixture.commands.get("occode-blueprint-agree")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-blueprint-agree",
        args: "",
        config: {},
      });

      expect(result?.text).toContain("marked the blueprint as agreed");
      expect(result?.text).toContain("Status: agreed");
      const content = await fs.readFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        "utf8",
      );
      expect(content).toContain("status: agreed");
      expect(content).toContain("agreedAt:");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("blocks /occode-blueprint-agree when blueprint validation errors remain", async () => {
    const fixture = await registerPluginFixture();
    try {
      await createProjectBlueprint({
        repoRoot: fixture.repoRoot,
        title: "Blocked Agreement Blueprint",
      });
      const result = await fixture.commands.get("occode-blueprint-agree")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-blueprint-agree",
        args: "",
        config: {},
      });

      expect(result?.text).toContain("Cannot mark the blueprint as agreed");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("updates arbitrary blueprint sections from chat without manual file edits", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Mutable Blueprint",
          "status: clarified",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Mutable Blueprint",
          "",
          "## Goal",
          "Clarify the target from chat.",
          "",
          "## Success Criteria",
          "- Operators can update sections from chat.",
          "",
          "## Scope",
          "- In scope: section editing.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Keep edits deterministic.",
          "",
          "## Risks",
          "- None.",
          "",
          "## Assumptions",
          "- None.",
          "",
          "## Human Gates",
          "- Goal agreement: required",
          "",
          "## Provider Strategy",
          "- Planner:",
          "- Coder:",
          "- Reviewer:",
          "- Verifier:",
          "- Doc-writer:",
          "",
          "## Workstreams",
          "- [ ] Add a chat edit command.",
          "",
          "## Open Questions",
          "- Who is allowed to edit the blueprint from chat?",
          "",
          "## Change Log",
          "- 2026-03-16: mutable blueprint test scaffold.",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await fixture.commands.get("occode-blueprint-edit")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: ["/occode-blueprint-edit open-questions", "- None."].join("\n"),
        args: "open-questions",
        config: {},
      });

      expect(result?.text).toContain("Updated blueprint section `Open Questions`");
      const content = await fs.readFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        "utf8",
      );
      expect(content).toContain("## Open Questions\n- None.");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("answers one blueprint clarification from chat and records history", async () => {
    const fixture = await registerPluginFixture();
    try {
      const result = await fixture.commands.get("occode-blueprint-answer")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-blueprint-answer 1 Ship a chat-native blueprint agreement loop.",
        args: "1 Ship a chat-native blueprint agreement loop.",
        config: {},
        senderId: "user:operator",
        to: "chat:blueprint",
      });

      expect(result?.text).toContain("Applied blueprint answer 1 to `Goal`");
      expect(result?.text).toContain("Clarification history: 1");
      const blueprint = await readProjectBlueprintDocument(fixture.repoRoot);
      expect(blueprint.goalSummary).toBe("Ship a chat-native blueprint agreement loop.");
      const discussion = await readProjectBlueprintDiscussionArtifact(fixture.repoRoot);
      expect(discussion.entryCount).toBe(1);
      expect(discussion.entries[0]).toMatchObject({
        appliedSection: "Goal",
        actor: "chat:blueprint",
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows provider-role routing through /occode-routing", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Routing Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Routing Blueprint",
          "",
          "## Goal",
          "Expose provider-role routing in chat.",
          "",
          "## Success Criteria",
          "- Operators can inspect the current role-routing plan.",
          "",
          "## Scope",
          "- In scope: read-only routing summary.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Keep the summary compact.",
          "",
          "## Risks",
          "- Operators may miss unresolved roles.",
          "",
          "## Assumptions",
          "- Chat users want adapter-level visibility.",
          "",
          "## Human Gates",
          "- Goal agreement: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "",
          "## Workstreams",
          "- Show the current role-routing plan in chat.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-16: chat routing summary.",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await fixture.commands.get("occode-routing")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-routing",
        args: "",
        config: {},
      });

      expect(result?.text).toContain("openclawcode role routing for zhyongrui/openclawcode");
      expect(result?.text).toContain("planner=claude-code");
      expect(result?.text).toContain("coder=codex");
      expect(result?.text).toContain("reviewer=claude-code");
      expect(result?.text).toContain("planning=claude-code/planner");
      expect(result?.text).toContain("building=codex/coder");
      expect(result?.text).toContain("Unresolved roles: 2");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("updates provider-role routing through /occode-route-set", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Route Set Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Route Set Blueprint",
          "",
          "## Goal",
          "Let chat operators reroute blueprint roles without editing markdown by hand.",
          "",
          "## Success Criteria",
          "- Chat can update one provider role and refresh artifacts.",
          "",
          "## Scope",
          "- In scope: provider role assignment updates.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Keep the mutation deterministic.",
          "",
          "## Risks",
          "- Routing drift if artifacts are not refreshed.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Goal agreement: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer:",
          "- Verifier:",
          "- Doc-writer:",
          "",
          "## Workstreams",
          "- Update routing from chat.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-16: chat route mutation.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await writeProjectDiscoveryInventory(fixture.repoRoot);

      const result = await fixture.commands.get("occode-route-set")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-route-set reviewer Claude Code",
        args: "reviewer Claude Code",
        config: {},
      });

      expect(result?.text).toContain("Updated provider routing for zhyongrui/openclawcode");
      expect(result?.text).toContain("Role: reviewer");
      expect(result?.text).toContain("Provider: Claude Code");
      expect(result?.text).toContain("Execution routing gate:");
      expect(result?.text).toContain("reviewer=claude-code");
      expect(result?.text).toContain("planning=claude-code/planner");

      const content = await fs.readFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        "utf8",
      );
      expect(content).toContain("- Reviewer: Claude Code");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows repo-local runtime steering through /occode-runtime-steering", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.mkdir(path.join(fixture.repoRoot, ".openclawcode"), { recursive: true });
      await fs.writeFile(
        path.join(fixture.repoRoot, ".openclawcode", "runtime-steering.json"),
        JSON.stringify(
          {
            repoRoot: fixture.repoRoot,
            artifactPath: path.join(fixture.repoRoot, ".openclawcode", "runtime-steering.json"),
            exists: true,
            schemaVersion: 1,
            generatedAt: "2026-03-21T17:10:00.000Z",
            overrideCount: 1,
            overrides: [
              {
                stageId: "building",
                roleId: "coder",
                adapterId: "codex",
                agentId: "codex-alt",
                actor: "user:operator",
                note: "prefer alternate build runtime",
                updatedAt: "2026-03-21T17:10:00.000Z",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const result = await fixture.commands.get("occode-runtime-steering")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-runtime-steering",
        args: "",
        config: {},
      });

      expect(result?.text).toContain("openclawcode runtime steering for zhyongrui/openclawcode");
      expect(result?.text).toContain("Overrides: 1");
      expect(result?.text).toContain(
        "- building: role=coder | agent=codex-alt | adapter=codex | updated=2026-03-21T17:10:00.000Z",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("updates repo-local runtime steering through /occode-runtime-steering-set", async () => {
    const fixture = await registerPluginFixture();
    try {
      const result = await fixture.commands.get("occode-runtime-steering-set")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody:
          "/occode-runtime-steering-set building codex-alt adapter=claude-code hold verifier on alternate path",
        args: "building codex-alt adapter=claude-code hold verifier on alternate path",
        to: "user:operator",
        config: {},
      });

      expect(result?.text).toContain("Updated runtime steering for zhyongrui/openclawcode.");
      expect(result?.text).toContain("Stage: building");
      expect(result?.text).toContain("Agent: codex-alt");
      expect(result?.text).toContain("Adapter: claude-code");
      expect(result?.text).toContain("Note: hold verifier on alternate path");

      const persisted = JSON.parse(
        await fs.readFile(
          path.join(fixture.repoRoot, ".openclawcode", "runtime-steering.json"),
          "utf8",
        ),
      );
      expect(persisted.overrides).toEqual([
        expect.objectContaining({
          stageId: "building",
          roleId: "coder",
          adapterId: "claude-code",
          agentId: "codex-alt",
          actor: "user:operator",
          note: "hold verifier on alternate path",
        }),
      ]);
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("records a manual takeover and exposes it through /occode-status", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 241,
          stage: "ready-for-human-review",
        }),
        "openclawcode status for zhyongrui/openclawcode#241\nStage: Ready For Human Review",
      );

      const takeover = await fixture.commands.get("occode-takeover")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-takeover #241 human validating the worktree locally",
        args: "#241 human validating the worktree locally",
        to: "user:takeover-chat",
        config: {},
      });

      expect(takeover?.text).toContain("Recorded manual takeover for zhyongrui/openclawcode#241.");
      expect(takeover?.text).toContain("Worktree: /tmp/openclawcode-241");

      const status = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #241",
        args: "#241",
        to: "user:takeover-chat",
        config: {},
      });

      expect(status?.text).toContain("Manual takeover: active");
      expect(status?.text).toContain("worktree=/tmp/openclawcode-241");
      expect(await fixture.store.getManualTakeover("zhyongrui/openclawcode#241")).toMatchObject({
        note: "human validating the worktree locally",
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("queues a structured rerun after manual edits and clears the takeover hold", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 242,
          stage: "ready-for-human-review",
        }),
        "openclawcode status for zhyongrui/openclawcode#242\nStage: Ready For Human Review",
      );
      await fixture.store.upsertManualTakeover({
        issueKey: "zhyongrui/openclawcode#242",
        runId: "run-242",
        stage: "ready-for-human-review",
        branchName: "openclawcode/issue-242",
        worktreePath: "/tmp/openclawcode-242",
        notifyChannel: "telegram",
        notifyTarget: "user:takeover-chat",
        actor: "user:takeover-chat",
        note: "Human updated the worktree locally.",
        requestedAt: "2026-03-16T12:00:00.000Z",
      });

      const result = await fixture.commands.get("occode-resume-after-edit")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-resume-after-edit #242 rerun after human edits",
        args: "#242 rerun after human edits",
        to: "user:takeover-chat",
        config: {},
      });

      expect(result?.text).toContain(
        "Queued rerun for zhyongrui/openclawcode#242 after manual edits from Ready For Human Review state.",
      );
      const snapshot = await fixture.store.snapshot();
      expect(snapshot.manualTakeovers).toEqual([]);
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.queue[0]?.request.rerunContext).toMatchObject({
        manualTakeoverRequestedAt: "2026-03-16T12:00:00.000Z",
        manualTakeoverActor: "user:takeover-chat",
        manualTakeoverWorktreePath: "/tmp/openclawcode-242",
        manualResumeNote: "rerun after human edits",
      });

      const inbox = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        to: "user:takeover-chat",
        config: {},
      });

      expect(inbox?.text).toContain(
        "  manual-resume: actor=user:takeover-chat | requestedAt=2026-03-16T12:00:00.000Z",
      );
      expect(inbox?.text).toContain("  manual-worktree: /tmp/openclawcode-242");
      expect(inbox?.text).toContain("  manual-note: rerun after human edits");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows rerun review and manual resume lineage through /occode-status", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 243,
          stage: "ready-for-human-review",
          rerunContext: {
            reason: "Address GitHub review feedback",
            requestedAt: "2026-03-16T12:05:00.000Z",
            priorRunId: "run-242",
            priorStage: "changes-requested",
            reviewDecision: "changes-requested",
            reviewSubmittedAt: "2026-03-16T12:00:00.000Z",
            reviewSummary: "Please add a regression test for the rerun path.",
            reviewUrl: "https://github.com/zhyongrui/openclawcode/pull/243#pullrequestreview-2",
            manualTakeoverRequestedAt: "2026-03-16T11:50:00.000Z",
            manualTakeoverActor: "user:takeover-chat",
            manualTakeoverWorktreePath: "/tmp/openclawcode-243",
            manualResumeNote: "rerun after human edits",
          },
        }),
        "openclawcode status for zhyongrui/openclawcode#243\nStage: Ready For Human Review",
        {
          notifyChannel: "telegram",
          notifyTarget: "user:takeover-chat",
        },
      );

      const status = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #243",
        args: "#243",
        to: "user:takeover-chat",
        config: {},
      });

      expect(status?.text).toContain(
        "Rerun: run-242 | from Changes Requested | 2026-03-16T12:05:00.000Z",
      );
      expect(status?.text).toContain("Rerun reason: Address GitHub review feedback");
      expect(status?.text).toContain(
        "Rerun review: Changes Requested | 2026-03-16T12:00:00.000Z",
      );
      expect(status?.text).toContain(
        "Rerun review summary: Please add a regression test for the rerun path.",
      );
      expect(status?.text).toContain(
        "Rerun review URL: https://github.com/zhyongrui/openclawcode/pull/243#pullrequestreview-2",
      );
      expect(status?.text).toContain(
        "Manual resume: actor=user:takeover-chat | requestedAt=2026-03-16T11:50:00.000Z",
      );
      expect(status?.text).toContain("Manual worktree: /tmp/openclawcode-243");
      expect(status?.text).toContain("Manual note: rerun after human edits");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("updates queued runtime overrides through /occode-reroute-run before execution starts", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#243",
          notifyChannel: "telegram",
          notifyTarget: "user:reroute-chat",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 243,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-243",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            openPullRequest: true,
            mergeOnApprove: false,
          },
        },
        "Queued from test.",
      );

      const result = await fixture.commands.get("occode-reroute-run")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-reroute-run #243 coder codex-alt",
        args: "#243 coder codex-alt",
        to: "user:reroute-chat",
        config: {},
      });

      expect(result?.text).toContain(
        "Updated the queued runtime override for zhyongrui/openclawcode#243.",
      );
      expect(result?.text).toContain(
        "Execution has not started yet, so the next run will start with coder -> codex-alt.",
      );

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue[0]?.request.builderAgent).toBe("codex-alt");
      expect(snapshot.queue[0]?.request.verifierAgent).toBe("main");
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("records deferred runtime reroutes for active runs and exposes them through /occode-status", async () => {
    const fixture = await registerPluginFixture({ pollIntervalMs: 10 });
    let resolveRun: ((value: { code: number; stdout: string; stderr: string }) => void) | undefined;
    try {
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#244",
          notifyChannel: "telegram",
          notifyTarget: "user:reroute-chat",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 244,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-244",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            openPullRequest: true,
            mergeOnApprove: false,
          },
        },
        "Queued from test.",
      );
      fixture.runCommandWithTimeout.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRun = resolve;
          }),
      );

      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      await waitForAssertion(async () => {
        const snapshot = await fixture.store.snapshot();
        expect(snapshot.currentRun?.issueKey).toBe("zhyongrui/openclawcode#244");
      });

      const reroute = await fixture.commands.get("occode-reroute-run")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-reroute-run #244 verifier claude-alt",
        args: "#244 verifier claude-alt",
        to: "user:reroute-chat",
        senderId: "user:operator",
        config: {},
      });

      expect(reroute?.text).toContain(
        "Recorded a deferred runtime reroute for zhyongrui/openclawcode#244.",
      );
      expect(reroute?.text).toContain(
        "if it finishes Failed, openclawcode will queue a rerun automatically",
      );

      const deferred = await fixture.store.getDeferredRuntimeReroute("zhyongrui/openclawcode#244");
      expect(deferred).toMatchObject({
        requestedVerifierAgentId: "claude-alt",
        actor: "user:reroute-chat",
      });

      const status = await fixture.commands.get("occode-status")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-status #244",
        args: "#244",
        to: "user:reroute-chat",
        config: {},
      });

      expect(status?.text).toContain("Pending runtime reroute: verifier=claude-alt");
      expect(status?.text).toContain(
        "Pending reroute note: Runtime reroute requested while the current run is active.",
      );
    } finally {
      resolveRun?.({
        code: 0,
        stdout: JSON.stringify(createWorkflowRun({ issueNumber: 244 })),
        stderr: "",
      });
      await cleanupPluginFixture(fixture);
    }
  });

  it("automatically queues a rerun with deferred runtime overrides after a failed run", async () => {
    const fixture = await registerPluginFixture({ pollIntervalMs: 10 });
    let resolveFirstRun:
      | ((value: { code: number; stdout: string; stderr: string }) => void)
      | undefined;
    let secondRunStarted = false;
    try {
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#245",
          notifyChannel: "telegram",
          notifyTarget: "user:reroute-chat",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 245,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-245",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            openPullRequest: true,
            mergeOnApprove: false,
          },
        },
        "Queued from test.",
      );
      fixture.runCommandWithTimeout.mockImplementation(() => {
        if (!resolveFirstRun) {
          return new Promise((resolve) => {
            resolveFirstRun = resolve;
          });
        }
        secondRunStarted = true;
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify(
            createWorkflowRun({
              issueNumber: 245,
              stage: "ready-for-human-review",
              updatedAt: "2026-03-16T05:20:00.000Z",
            }),
          ),
          stderr: "",
        });
      });

      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      await waitForAssertion(async () => {
        const snapshot = await fixture.store.snapshot();
        expect(snapshot.currentRun?.issueKey).toBe("zhyongrui/openclawcode#245");
      });

      const reroute = await fixture.commands.get("occode-reroute-run")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-reroute-run #245 coder codex-rerun",
        args: "#245 coder codex-rerun",
        to: "user:reroute-chat",
        senderId: "user:operator",
        config: {},
      });

      expect(reroute?.text).toContain(
        "Recorded a deferred runtime reroute for zhyongrui/openclawcode#245.",
      );

      resolveFirstRun?.({
        code: 0,
        stdout: JSON.stringify(
          createWorkflowRun({
            issueNumber: 245,
            stage: "failed",
            updatedAt: "2026-03-16T05:10:00.000Z",
          }),
        ),
        stderr: "",
      });

      await waitForAssertion(async () => {
        expect(fixture.runCommandWithTimeout).toHaveBeenCalledTimes(2);
        expect(secondRunStarted).toBe(true);
        expect(
          await fixture.store.getDeferredRuntimeReroute("zhyongrui/openclawcode#245"),
        ).toBeUndefined();
      });

      const secondInvocation = fixture.runCommandWithTimeout.mock.calls[1]?.[0];
      const serializedSecondInvocation = JSON.stringify(secondInvocation);
      expect(serializedSecondInvocation).toContain("--rerun-coder-agent");
      expect(serializedSecondInvocation).toContain("codex-rerun");
      expect(serializedSecondInvocation).not.toContain("--rerun-verifier-agent");
    } finally {
      resolveFirstRun?.({
        code: 0,
        stdout: JSON.stringify(createWorkflowRun({ issueNumber: 245 })),
        stderr: "",
      });
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows blueprint stage gates through /occode-gates", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Gate Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Gate Blueprint",
          "",
          "## Goal",
          "Surface stage gates in chat and allow chat-side approval records.",
          "",
          "## Success Criteria",
          "- Operators can inspect gate readiness from chat.",
          "",
          "## Scope",
          "- In scope: gate summaries and decisions.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Keep the first surface deterministic.",
          "",
          "## Risks",
          "- Hidden gate blockers slow operator intervention.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Goal agreement: required",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: OpenClaw Default",
          "- Doc-writer: Claude Code",
          "",
          "## Workstreams",
          "- Add a chat-visible gate summary command.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-16: initial gate chat view.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await writeProjectStageGateArtifact(fixture.repoRoot);

      const result = await fixture.commands.get("occode-gates")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-gates",
        args: "",
        config: {},
      });

      expect(result?.text).toContain("openclawcode stage gates for zhyongrui/openclawcode");
      expect(result?.text).toContain("Gate counts: blocked=0 | needsHuman=1 | total=5");
      expect(result?.text).toContain("- goal-agreement | ready | decisionRequired=yes");
      expect(result?.text).toContain(
        "- merge-promotion | needs-human-decision | decisionRequired=yes",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows the next blueprint-backed work item through /occode-next", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Next Work Chat Blueprint",
          "status: agreed",
          "createdAt: 2026-03-19T00:00:00.000Z",
          "updatedAt: 2026-03-19T00:00:00.000Z",
          "statusChangedAt: 2026-03-19T00:00:00.000Z",
          "agreedAt: 2026-03-19T00:00:00.000Z",
          "---",
          "",
          "# Next Work Chat Blueprint",
          "",
          "## Goal",
          "Show the next blueprint-backed work item directly in chat.",
          "",
          "## Success Criteria",
          "- /occode-next explains the next selected work item.",
          "",
          "## Scope",
          "- In scope: chat-visible next-work summary.",
          "",
          "## Non-Goals",
          "- Issue creation.",
          "",
          "## Constraints",
          "- Keep the message concise.",
          "",
          "## Risks",
          "- Operators could lose project context without a direct summary.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Add a chat summary for the next selected work item.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-19: next-work chat proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);

      const result = await fixture.commands.get("occode-next")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-next",
        args: "",
        config: {},
      });

      expect(result?.text).toContain("openclawcode next work for zhyongrui/openclawcode");
      expect(result?.text).toContain("Decision: ready-to-execute");
      expect(result?.text).toContain(
        "Selected: Add a chat summary for the next selected work item. | work-item-inventory | planned",
      );
      expect(result?.text).toContain("Execution mode: feature");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("creates the selected work-item issue through /occode-materialize", async () => {
    const fixture = await registerPluginFixture({ triggerMode: "auto" });
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Materialize Chat Blueprint",
          "status: agreed",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "agreedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# Materialize Chat Blueprint",
          "",
          "## Goal",
          "Materialize the selected work item from chat.",
          "",
          "## Success Criteria",
          "- /occode-materialize creates or reuses the next execution issue.",
          "",
          "## Scope",
          "- In scope: issue materialization from chat.",
          "",
          "## Non-Goals",
          "- Full execution.",
          "",
          "## Constraints",
          "- Keep the issue mapping deterministic.",
          "",
          "## Risks",
          "- Duplicate issues without stable markers.",
          "",
          "## Assumptions",
          "- GitHub auth is available on the operator host.",
          "",
          "## Human Gates",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Create or reuse the selected execution issue from chat.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-20: materialize chat proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              number: 77,
              title: "[Blueprint]: Create or reuse the selected execution issue from chat.",
              body: "materialized body",
              html_url: "https://github.com/zhyongrui/openclawcode/issues/77",
              state: "open",
              labels: [],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("GH_TOKEN", "test-gh-token");

      const result = await fixture.commands.get("occode-materialize")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-materialize",
        args: "",
        senderId: "user:operator",
        config: {},
      });

      expect(result?.text).toContain("openclawcode issue materialization for zhyongrui/openclawcode");
      expect(result?.text).toContain("Outcome: created");
      expect(result?.text).toContain("Execution mode: feature");
      expect(result?.text).toContain("Selected issue: #77");

      const artifact = await readProjectIssueMaterializationArtifact(fixture.repoRoot);
      expect(artifact.selectedIssueNumber).toBe(77);
      expect(artifact.selectedWorkItemExecutionMode).toBe("feature");
      expect(artifact.outcome).toBe("created");
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("precheck-escalates /occode-materialize when the blueprint-backed issue body is high risk", async () => {
    const fixture = await registerPluginFixture({ triggerMode: "auto" });
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: High Risk Materialize Blueprint",
          "status: agreed",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "agreedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# High Risk Materialize Blueprint",
          "",
          "## Goal",
          "Tighten setup handling around database migration safety and rollback visibility.",
          "",
          "## Success Criteria",
          "- /occode-materialize escalates high-risk work before queueing it.",
          "",
          "## Scope",
          "- In scope: high-risk materialization precheck.",
          "",
          "## Non-Goals",
          "- Full execution.",
          "",
          "## Constraints",
          "- Keep the issue linkage deterministic.",
          "",
          "## Risks",
          "- Database work should never auto-queue by accident.",
          "",
          "## Assumptions",
          "- GitHub auth is available on the operator host.",
          "",
          "## Human Gates",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Tighten setup logging during risky migrations.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-20: high-risk materialize proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              number: 78,
              title: "[Blueprint]: Tighten setup logging during risky migrations.",
              body: "materialized body",
              html_url: "https://github.com/zhyongrui/openclawcode/issues/78",
              state: "open",
              labels: [],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("GH_TOKEN", "test-gh-token");

      const result = await fixture.commands.get("occode-materialize")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-materialize",
        args: "",
        senderId: "user:operator",
        config: {},
      });

      expect(result?.text).toContain("Outcome: created");
      expect(result?.text).toContain("Selected issue: #78");
      expect(result?.text).toContain("Suitability: escalate | Webhook intake precheck escalated");

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toEqual([]);
      expect(snapshot.statusSnapshotsByIssue["zhyongrui/openclawcode#78"]).toMatchObject({
        stage: "escalated",
        issueNumber: 78,
        suitabilityDecision: "escalate",
      });
      expect(snapshot.statusByIssue["zhyongrui/openclawcode#78"]).toContain(
        "Webhook intake precheck escalated the issue before chat approval.",
      );
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows project progress and autopilot state through chat commands", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Progress Chat Blueprint",
          "status: agreed",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "agreedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# Progress Chat Blueprint",
          "",
          "## Goal",
          "Show project progress and autopilot state in chat.",
          "",
          "## Success Criteria",
          "- /occode-progress summarizes blueprint-aware progress.",
          "",
          "## Scope",
          "- In scope: progress and autopilot status.",
          "",
          "## Non-Goals",
          "- Full execution.",
          "",
          "## Constraints",
          "- Keep the status concise.",
          "",
          "## Risks",
          "- Operators could lose context without a single progress view.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Show project progress in chat.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-20: progress chat proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);

      const progressResult = await fixture.commands.get("occode-progress")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-progress",
        args: "",
        config: {},
      });
      expect(progressResult?.text).toContain("openclawcode progress for zhyongrui/openclawcode");
      expect(progressResult?.text).toContain("Next work: ready-to-execute");
      expect(progressResult?.text).toContain(
        "Active workstream: Workstream 1/1 | Show project progress in chat.",
      );
      expect(progressResult?.text).toContain("Execution mode: feature");
      expect(progressResult?.text).toContain("Next: /occode-materialize zhyongrui/openclawcode");

      const offResult = await fixture.commands.get("occode-autopilot")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-autopilot off",
        args: "off",
        config: {},
      });
      expect(offResult?.text).toContain("Status: disabled");

      const artifact = await readProjectAutonomousLoopArtifact(fixture.repoRoot);
      expect(artifact.status).toBe("disabled");
      const progressArtifact = await readProjectProgressArtifact(fixture.repoRoot);
      expect(progressArtifact.nextWorkDecision).toBe("ready-to-execute");
      expect(progressArtifact.selectedWorkItemExecutionMode).toBe("feature");
      expect(progressArtifact.activeWorkstreamSummary).toBe(
        "Workstream 1/1 | Show project progress in chat.",
      );
      expect(progressArtifact.nextSuggestedChatCommand).toBe(
        "/occode-materialize zhyongrui/openclawcode",
      );
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows why autopilot is blocked for refactor work through chat commands", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Refactor Progress Chat Blueprint",
          "status: agreed",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "agreedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# Refactor Progress Chat Blueprint",
          "",
          "## Goal",
          "Show why execution-mode-aware autopilot is blocked in chat.",
          "",
          "## Success Criteria",
          "- /occode-progress and /occode-autopilot explain the execution-start pause.",
          "",
          "## Scope",
          "- In scope: refactor-aware progress and autopilot messaging.",
          "",
          "## Non-Goals",
          "- Full execution.",
          "",
          "## Constraints",
          "- Keep the status concise.",
          "",
          "## Risks",
          "- Structural work may look ready when it is not.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Execution start: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Refactor chat progress formatting into a dedicated presenter.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-20: refactor progress chat proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);

      const progressResult = await fixture.commands.get("occode-progress")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-progress",
        args: "",
        config: {},
      });
      expect(progressResult?.text).toContain("Next work: blocked-on-human");
      expect(progressResult?.text).toContain("Next-work gate: execution-start");
      expect(progressResult?.text).toContain(
        "Active workstream: Workstream 1/1 | Refactor chat progress formatting into a dedicated presenter.",
      );
      expect(progressResult?.text).toContain("Execution mode: refactor");
      expect(progressResult?.text).toContain(
        "Primary blocker: Selected refactor slice requires explicit execution-start approval: Refactor chat progress formatting into a dedicated presenter.",
      );

      const onceResult = await fixture.commands.get("occode-autopilot")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-autopilot once",
        args: "once",
        senderId: "user:operator",
        config: {},
      });
      expect(onceResult?.text).toContain("Status: blocked");
      expect(onceResult?.text).toContain("Next-work gate: execution-start");
      expect(onceResult?.text).toContain(
        "Active workstream: Workstream 1/1 | Refactor chat progress formatting into a dedicated presenter.",
      );
      expect(onceResult?.text).toContain("Execution mode: refactor");
      expect(onceResult?.text).toContain(
        "Primary blocker: Selected refactor slice requires explicit execution-start approval: Refactor chat progress formatting into a dedicated presenter.",
      );
      expect(onceResult?.text).toContain(`Next: /occode-gates zhyongrui/openclawcode`);
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("unblocks refactor progress and autopilot after execution-start approval in chat", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Refactor Progress Approved Chat Blueprint",
          "status: agreed",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "agreedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# Refactor Progress Approved Chat Blueprint",
          "",
          "## Goal",
          "Allow chat-side refactor progress once execution-start is approved.",
          "",
          "## Success Criteria",
          "- /occode-progress shows ready-to-execute after approval.",
          "- /occode-autopilot once materializes the approved refactor issue.",
          "",
          "## Scope",
          "- In scope: chat progress alignment with execution-start decisions.",
          "",
          "## Non-Goals",
          "- Full execution.",
          "",
          "## Constraints",
          "- Keep the status concise.",
          "",
          "## Risks",
          "- Approved refactor work may still look blocked if progress ignores gate state.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Execution start: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Refactor chat progress formatting into a dedicated presenter.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-20: approved refactor progress chat proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);

      const decision = await fixture.commands.get("occode-gate-decide")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-gate-decide execution-start approved Accepted for this run",
        args: "execution-start approved Accepted for this run",
        senderId: "user:operator",
        config: {},
      });
      expect(decision?.text).toContain("Decision: approved");
      expect(decision?.text).toContain("Readiness: ready");

      const progressResult = await fixture.commands.get("occode-progress")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-progress",
        args: "",
        config: {},
      });
      expect(progressResult?.text).toContain("Next work: ready-to-execute");
      expect(progressResult?.text).toContain("Execution mode: refactor");
      expect(progressResult?.text).toContain("Next: /occode-materialize zhyongrui/openclawcode");

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              number: 207,
              title: "[Blueprint]: Refactor chat progress formatting into a dedicated presenter.",
              body: "materialized body",
              html_url: "https://github.com/zhyongrui/openclawcode/issues/207",
              state: "open",
              labels: [],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("GH_TOKEN", "test-gh-token");

      const onceResult = await fixture.commands.get("occode-autopilot")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-autopilot once",
        args: "once",
        senderId: "user:operator",
        config: {},
      });
      expect(onceResult?.text).toContain("Status: materialized-and-queued");
      expect(onceResult?.text).toContain("Next work: ready-to-execute");
      expect(onceResult?.text).toContain("Execution mode: refactor");
      expect(onceResult?.text).toContain("Queued issue: zhyongrui/openclawcode#207");
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("runs a supervised repeat autopilot loop until queued work blocks the next iteration", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Repeat Autopilot Chat Blueprint",
          "status: agreed",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "agreedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# Repeat Autopilot Chat Blueprint",
          "",
          "## Goal",
          "Let chat operators run a bounded supervised autopilot loop.",
          "",
          "## Success Criteria",
          "- /occode-autopilot repeat records each iteration until the loop blocks.",
          "",
          "## Scope",
          "- In scope: repeat-loop orchestration and reporting.",
          "",
          "## Non-Goals",
          "- Full end-to-end execution.",
          "",
          "## Constraints",
          "- Stop cleanly when work is already queued.",
          "",
          "## Risks",
          "- Repeat mode could queue duplicate work without a queue-aware stop.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Run a bounded repeat autopilot loop from chat.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-20: repeat autopilot chat proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              number: 88,
              title: "[Blueprint]: Run a bounded repeat autopilot loop from chat.",
              body: "materialized body",
              html_url: "https://github.com/zhyongrui/openclawcode/issues/88",
              state: "open",
              labels: [],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("GH_TOKEN", "test-gh-token");
      await fixture.service?.stop?.({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      const result = await fixture.commands.get("occode-autopilot")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-autopilot repeat 2",
        args: "repeat 2",
        senderId: "user:operator",
        config: {},
      });

      expect(result?.text).toContain("Mode: repeat");
      expect(result?.text).toContain("Status: blocked");
      expect(result?.text).toContain("Iterations: 2/2");
      expect(result?.text).toContain(
        "Active workstream: Workstream 1/1 | Run a bounded repeat autopilot loop from chat.",
      );
      expect(result?.text).toContain("Operator: queued=1 | currentRun=no | pause=no");
      expect(result?.text).toContain("Stop reason: A run is already queued for this repository.");
      expect(result?.text).toContain(`Next: /occode-progress zhyongrui/openclawcode`);
      expect(result?.text).toContain(
        "- iteration 1: materialized-and-queued | ready-to-execute | #88 | zhyongrui/openclawcode#88 | message=Queued zhyongrui/openclawcode#88 after issue materialization. | workstream=Workstream 1/1 | Run a bounded repeat autopilot loop from chat.",
      );
      expect(result?.text).toContain(
        "- iteration 2: blocked | ready-to-execute | #88 | stop=A run is already queued for this repository. | workstream=Workstream 1/1 | Run a bounded repeat autopilot loop from chat.",
      );

      const artifact = await readProjectAutonomousLoopArtifact(fixture.repoRoot);
      expect(artifact).toMatchObject({
        mode: "repeat",
        status: "blocked",
        requestedIterationCount: 2,
        completedIterationCount: 2,
        queuedRunCount: 1,
        stopReason: "A run is already queued for this repository.",
        activeWorkstreamSummary: "Workstream 1/1 | Run a bounded repeat autopilot loop from chat.",
        nextSuggestedChatCommand: "/occode-progress zhyongrui/openclawcode",
      });
      expect(artifact.iterations).toEqual([
        expect.objectContaining({
          iteration: 1,
          status: "materialized-and-queued",
          selectedIssueNumber: 88,
          queuedIssueKey: "zhyongrui/openclawcode#88",
          activeWorkstreamSummary:
            "Workstream 1/1 | Run a bounded repeat autopilot loop from chat.",
        }),
        expect.objectContaining({
          iteration: 2,
          status: "blocked",
          selectedIssueNumber: 88,
          stopReason: "A run is already queued for this repository.",
          activeWorkstreamSummary:
            "Workstream 1/1 | Run a bounded repeat autopilot loop from chat.",
        }),
      ]);

      const snapshot = await fixture.store.snapshot();
      expect(snapshot.queue).toHaveLength(1);
      expect(snapshot.queue[0]?.issueKey).toBe("zhyongrui/openclawcode#88");
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("stops autopilot cleanly when queued work already exists for the repository", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Queued Work Autopilot Blueprint",
          "status: agreed",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "agreedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# Queued Work Autopilot Blueprint",
          "",
          "## Goal",
          "Stop autopilot with a precise reason when queued work already exists.",
          "",
          "## Success Criteria",
          "- /occode-autopilot explains that a queued run already exists.",
          "",
          "## Scope",
          "- In scope: already-tracked queue handoff behavior.",
          "",
          "## Non-Goals",
          "- Full execution.",
          "",
          "## Constraints",
          "- Keep the stop reason explicit.",
          "",
          "## Risks",
          "- Existing queued work could be hidden without a clear stop reason.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Stop autopilot when queued work already exists.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-20: queued-work autopilot proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#89",
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 89,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-89",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: ["pnpm test"],
            openPullRequest: true,
            mergeOnApprove: false,
          },
        },
        "Queued from test.",
      );

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                number: 89,
                title: "[Blueprint]: Stop autopilot when queued work already exists.",
                body: "materialized body",
                html_url: "https://github.com/zhyongrui/openclawcode/issues/89",
                state: "open",
                labels: [],
              },
            ]),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("GH_TOKEN", "test-gh-token");

      const result = await fixture.commands.get("occode-autopilot")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-autopilot once",
        args: "once",
        senderId: "user:operator",
        config: {},
      });

      expect(result?.text).toContain("Status: blocked");
      expect(result?.text).toContain("Stop reason: A run is already queued for this repository.");
      expect(result?.text).toContain(
        "- iteration 1: blocked | ready-to-execute | stop=A run is already queued for this repository.",
      );

      const artifact = await readProjectAutonomousLoopArtifact(fixture.repoRoot);
      expect(artifact).toMatchObject({
        status: "blocked",
        selectedIssueNumber: null,
        queuedIssueKey: null,
        stopReason: "A run is already queued for this repository.",
        nextSuggestedChatCommand: "/occode-progress zhyongrui/openclawcode",
      });
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("shows active-run stage and role routing through progress and autopilot chat commands", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID", "codex-main");
      vi.stubEnv("OPENCLAWCODE_ADAPTER_CLAUDE_CODE_AGENT_ID", "claude-main");

      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Active Run Chat Progress Blueprint",
          "status: agreed",
          "createdAt: 2026-03-20T00:00:00.000Z",
          "updatedAt: 2026-03-20T00:00:00.000Z",
          "statusChangedAt: 2026-03-20T00:00:00.000Z",
          "agreedAt: 2026-03-20T00:00:00.000Z",
          "---",
          "",
          "# Active Run Chat Progress Blueprint",
          "",
          "## Goal",
          "Show active-run stage and role routing in chat progress surfaces.",
          "",
          "## Success Criteria",
          "- /occode-progress shows the current run stage and roles.",
          "",
          "## Scope",
          "- In scope: project-level chat progress context.",
          "",
          "## Non-Goals",
          "- Real workflow execution.",
          "",
          "## Constraints",
          "- Keep the status concise.",
          "",
          "## Risks",
          "- Active work may be opaque without a project-level summary.",
          "",
          "## Assumptions",
          "- The blueprint is already agreed.",
          "",
          "## Human Gates",
          "- Merge promotion: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: Codex",
          "- Doc-writer: Codex",
          "",
          "## Workstreams",
          "- Show active-run progress in chat.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-20: active-run chat proof.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#910",
          notifyChannel: "telegram",
          notifyTarget: "chat:primary",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 910,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-910",
            builderAgent: "codex-main",
            verifierAgent: "claude-main",
            testCommands: ["pnpm test"],
            openPullRequest: true,
            mergeOnApprove: false,
          },
        },
        "Queued.",
      );
      await fixture.store.startNext("Running.");
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#910",
        status: "openclawcode status for zhyongrui/openclawcode#910\nStage: Building",
        stage: "building",
        runId: "run-910",
        updatedAt: "2026-03-20T08:20:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 910,
        branchName: "openclawcode/issue-910",
        pullRequestNumber: 9910,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/9910",
        notifyChannel: "telegram",
        notifyTarget: "chat:primary",
      });

      const progressResult = await fixture.commands.get("occode-progress")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-progress",
        args: "",
        config: {},
      });
      expect(progressResult?.text).toContain(
        "Roles: planner=Claude Code@claude-main, coder=Codex@codex-main, reviewer=Claude Code@claude-main, verifier=Codex@codex-main, doc-writer=Codex@codex-main",
      );
      expect(progressResult?.text).toContain("Current run: zhyongrui/openclawcode#910");
      expect(progressResult?.text).toContain("Current run stage: building");
      expect(progressResult?.text).toContain("Current run branch: openclawcode/issue-910");
      expect(progressResult?.text).toContain("Current run PR: #9910");

      const onceResult = await fixture.commands.get("occode-autopilot")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-autopilot once",
        args: "once",
        config: {},
      });
      expect(onceResult?.text).toContain("Status: blocked");
      expect(onceResult?.text).toContain(
        "Roles: planner=Claude Code@claude-main, coder=Codex@codex-main, reviewer=Claude Code@claude-main, verifier=Codex@codex-main, doc-writer=Codex@codex-main",
      );
      expect(onceResult?.text).toContain("Current run: zhyongrui/openclawcode#910");
      expect(onceResult?.text).toContain("Current run stage: building");
      expect(onceResult?.text).toContain("Current run branch: openclawcode/issue-910");
      expect(onceResult?.text).toContain("Current run PR: #9910");
      expect(onceResult?.text).toContain("Stop reason: A run is already active for this repository.");

      const progressArtifact = await readProjectProgressArtifact(fixture.repoRoot);
      expect(progressArtifact.roleRouteSummary).toEqual([
        "planner=Claude Code@claude-main",
        "coder=Codex@codex-main",
        "reviewer=Claude Code@claude-main",
        "verifier=Codex@codex-main",
        "doc-writer=Codex@codex-main",
      ]);
      expect(progressArtifact.roleRoutes).toEqual([
        expect.objectContaining({
          roleId: "planner",
          resolvedBackend: "Claude Code",
          resolvedAgentId: "claude-main",
        }),
        expect.objectContaining({
          roleId: "coder",
          resolvedBackend: "Codex",
          resolvedAgentId: "codex-main",
          runtimeCapable: true,
        }),
        expect.objectContaining({
          roleId: "reviewer",
          resolvedBackend: "Claude Code",
          resolvedAgentId: "claude-main",
        }),
        expect.objectContaining({
          roleId: "verifier",
          resolvedBackend: "Codex",
          resolvedAgentId: "codex-main",
          rerouteCapable: true,
        }),
        expect.objectContaining({
          roleId: "docWriter",
          resolvedBackend: "Codex",
          resolvedAgentId: "codex-main",
        }),
      ]);
      expect(progressArtifact.operator.currentRunStage).toBe("building");

      const loopArtifact = await readProjectAutonomousLoopArtifact(fixture.repoRoot);
      expect(loopArtifact.currentRunIssueKey).toBe("zhyongrui/openclawcode#910");
      expect(loopArtifact.currentRunStage).toBe("building");
      expect(loopArtifact.roleRoutes).toEqual(progressArtifact.roleRoutes);
      expect(loopArtifact.roleRouteSummary).toEqual(progressArtifact.roleRouteSummary);
    } finally {
      await cleanupPluginFixture(fixture);
    }
  });

  it("records a stage-gate decision through /occode-gate-decide", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fs.writeFile(
        path.join(fixture.repoRoot, "PROJECT-BLUEPRINT.md"),
        [
          "---",
          "schemaVersion: 1",
          "title: Gate Decision Blueprint",
          "status: agreed",
          "createdAt: 2026-03-16T00:00:00.000Z",
          "updatedAt: 2026-03-16T00:05:00.000Z",
          "statusChangedAt: 2026-03-16T00:05:00.000Z",
          "agreedAt: 2026-03-16T00:05:00.000Z",
          "---",
          "",
          "# Gate Decision Blueprint",
          "",
          "## Goal",
          "Allow chat users to record stage-gate decisions.",
          "",
          "## Success Criteria",
          "- A chat command persists a stage-gate decision.",
          "",
          "## Scope",
          "- In scope: stage-gate decision recording.",
          "",
          "## Non-Goals",
          "- None.",
          "",
          "## Constraints",
          "- Keep the first command explicit.",
          "",
          "## Risks",
          "- Bad decisions could hide blockers.",
          "",
          "## Assumptions",
          "- Operators understand the gate they are deciding.",
          "",
          "## Human Gates",
          "- Goal agreement: required",
          "",
          "## Provider Strategy",
          "- Planner: Claude Code",
          "- Coder: Codex",
          "- Reviewer: Claude Code",
          "- Verifier: OpenClaw Default",
          "- Doc-writer: Claude Code",
          "",
          "## Workstreams",
          "- Persist gate decisions from chat.",
          "",
          "## Open Questions",
          "- None.",
          "",
          "## Change Log",
          "- 2026-03-16: initial gate decision command.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeProjectWorkItemInventory(fixture.repoRoot);
      await writeProjectStageGateArtifact(fixture.repoRoot);

      const result = await fixture.commands.get("occode-gate-decide")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-gate-decide goal-agreement blocked Need human signoff",
        args: "goal-agreement blocked Need human signoff",
        senderId: "user:operator",
        config: {},
      });

      expect(result?.text).toContain("Recorded stage-gate decision for zhyongrui/openclawcode");
      expect(result?.text).toContain("Gate: goal-agreement");
      expect(result?.text).toContain("Decision: blocked");
      expect(result?.text).toContain("Readiness: blocked");

      const artifact = await readProjectStageGateArtifact(fixture.repoRoot);
      const gate = artifact.gates.find((entry) => entry.gateId === "goal-agreement");
      expect(gate?.latestDecision?.decision).toBe("blocked");
      expect(gate?.latestDecision?.actor).toBe("user:operator");
      expect(gate?.latestDecision?.note).toBe("Need human signoff");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows an active provider pause through /occode-inbox", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6601,
          stage: "failed",
          updatedAt: "2099-03-12T12:00:00.000Z",
        }),
        buildTransientProviderFailedStatus(6601),
      );
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6602,
          stage: "failed",
          updatedAt: "2099-03-12T12:05:00.000Z",
        }),
        buildTransientProviderFailedStatus(6602),
      );

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode inbox for zhyongrui/openclawcode",
          "Provider pause: active until 2099-03-12T12:15:00.000Z",
          "- failures: 2 | last failure: 2099-03-12T12:05:00.000Z",
          "- reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
          "- impact: new work can still queue, but queued runs will not start until the pause clears.",
          "- recovery: queue drain resumes automatically after the pause window elapses.",
          "Pending approvals: 0",
          "Running: 0",
          "Queued: 0",
          "Recent ledger: 2",
          "- zhyongrui/openclawcode#6602 | Failed | final: failed | 2099-03-12T12:05:00.000Z",
          "  policy: /occode-policy zhyongrui/openclawcode#6602",
          "  provider: active pause until 2099-03-12T12:15:00.000Z | last transient failure at 2099-03-12T12:05:00.000Z | failures: 2",
          "  provider-reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
          "- zhyongrui/openclawcode#6601 | Failed | final: failed | 2099-03-12T12:00:00.000Z",
          "  policy: /occode-policy zhyongrui/openclawcode#6601",
          "  provider: last transient failure at 2099-03-12T12:00:00.000Z | failures: 1",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("keeps recent provider failure context in /occode-inbox after the pause clears", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6711,
          stage: "failed",
          updatedAt: "2026-03-12T12:00:00.000Z",
        }),
        buildTransientProviderFailedStatus(6711),
      );
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6712,
          stage: "failed",
          updatedAt: "2026-03-12T12:05:00.000Z",
        }),
        buildTransientProviderFailedStatus(6712),
      );

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result?.text).toContain(
        "provider: pause cleared after 2026-03-12T12:15:00.000Z | last transient failure at 2026-03-12T12:05:00.000Z | failures: 2",
      );
      expect(result?.text).toContain(
        "provider-reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
      );
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("shows structured failure diagnostics in the inbox ledger for failed runs", async () => {
    const fixture = await registerPluginFixture();
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6713,
          stage: "failed",
          updatedAt: "2026-03-12T12:06:00.000Z",
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
        }),
        buildTransientProviderFailedStatus(6713),
      );

      const result = await fixture.commands.get("occode-inbox")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-inbox",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode inbox for zhyongrui/openclawcode",
          "Pending approvals: 0",
          "Running: 0",
          "Queued: 0",
          "Recent ledger: 1",
          "- zhyongrui/openclawcode#6713 | Failed | final: failed | 2026-03-12T12:06:00.000Z",
          "  provider: last transient failure at 2026-03-12T12:06:00.000Z | failures: 1",
          "  diagnostics: model=crs/gpt-5.4, prompt=8629, skillsPrompt=1245, schema=3030, tools=4, skills=1, files=0, usage=0, bootstrap=clean",
        ].join("\n"),
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("does not start queued work while a provider pause is active", async () => {
    const fixture = await registerPluginFixture({ pollIntervalMs: 10 });
    try {
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6701,
          stage: "failed",
          updatedAt: "2099-03-12T12:00:00.000Z",
        }),
        buildTransientProviderFailedStatus(6701),
      );
      await fixture.store.recordWorkflowRunStatus(
        createWorkflowRun({
          issueNumber: 6702,
          stage: "failed",
          updatedAt: "2099-03-12T12:05:00.000Z",
        }),
        buildTransientProviderFailedStatus(6702),
      );
      await fixture.store.enqueue(
        {
          issueKey: "zhyongrui/openclawcode#6703",
          notifyChannel: "feishu",
          notifyTarget: "user:pause-chat",
          request: {
            owner: "zhyongrui",
            repo: "openclawcode",
            issueNumber: 6703,
            repoRoot: fixture.repoRoot,
            baseBranch: "main",
            branchName: "openclawcode/issue-6703",
            builderAgent: "main",
            verifierAgent: "main",
            testCommands: [
              "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads",
            ],
            openPullRequest: true,
            mergeOnApprove: false,
          },
        },
        "Queued from test.",
      );

      await fixture.service?.start({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });

      await waitForAssertion(async () => {
        expect(fixture.runCommandWithTimeout).not.toHaveBeenCalled();
        const snapshot = await fixture.store.snapshot();
        expect(snapshot.currentRun).toBeUndefined();
        expect(snapshot.queue.map((entry) => entry.issueKey)).toEqual([
          "zhyongrui/openclawcode#6703",
        ]);
        expect(snapshot.providerPause).toMatchObject({
          failureCount: 2,
        });
      });

      await fixture.service?.stop?.({
        config: {},
        stateDir: fixture.stateDir,
        logger: { info() {}, warn() {}, error() {} },
      });
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("reconciles local runs and GitHub snapshots through /occode-sync", async () => {
    const fixture = await registerPluginFixture();
    try {
      await writeLocalRun({
        repoRoot: fixture.repoRoot,
        issueNumber: 208,
        stage: "ready-for-human-review",
        prUrl: "https://github.com/zhyongrui/openclawcode/pull/308",
      });
      await fixture.store.setStatusSnapshot({
        issueKey: "zhyongrui/openclawcode#208",
        status: "openclawcode status for zhyongrui/openclawcode#208\nStage: Ready For Human Review",
        stage: "ready-for-human-review",
        runId: "run-208",
        updatedAt: "2026-03-10T09:20:00.000Z",
        owner: "zhyongrui",
        repo: "openclawcode",
        issueNumber: 208,
        branchName: "openclawcode/issue-208",
        pullRequestNumber: 308,
        pullRequestUrl: "https://github.com/zhyongrui/openclawcode/pull/308",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              number: 308,
              html_url: "https://github.com/zhyongrui/openclawcode/pull/308",
              state: "closed",
              draft: false,
              merged: true,
              merged_at: "2026-03-10T09:25:00.000Z",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      const result = await fixture.commands.get("occode-sync")?.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: "/occode-sync",
        args: "",
        config: {},
      });

      expect(result).toEqual({
        text: [
          "openclawcode sync complete.",
          "Tracked snapshots checked: 1",
          "Statuses healed: 1",
          "GitHub sync failures: 0",
        ].join("\n"),
      });
      const snapshot = await fixture.store.getStatusSnapshot("zhyongrui/openclawcode#208");
      expect(snapshot?.stage).toBe("merged");
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });
});
