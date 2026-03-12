import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenClawCodeChatopsStore } from "../../src/integrations/openclaw-plugin/index.js";
import type { WorkflowRun } from "../../src/openclawcode/contracts/index.js";
import type {
  OpenClawPluginCommandDefinition,
  OpenClawPluginService,
} from "../../src/plugins/types.js";
import { createMockServerResponse } from "../../src/test-utils/mock-http-response.js";
import plugin from "./index.js";

const mocked = vi.hoisted(() => ({
  readRequestBodyWithLimit: vi.fn(),
  runMessageAction: vi.fn(),
}));

vi.mock("../../src/infra/http-body.js", () => ({
  readRequestBodyWithLimit: mocked.readRequestBodyWithLimit,
}));

vi.mock("../../src/infra/outbound/message-action-runner.js", () => ({
  runMessageAction: mocked.runMessageAction,
}));

function createApi(params: {
  stateDir: string;
  pluginConfig: Record<string, unknown>;
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
    config: {},
    pluginConfig: params.pluginConfig,
    runtime: {
      state: {
        resolveStateDir: () => params.stateDir,
      },
      system: {
        runCommandWithTimeout: params.runCommandWithTimeout,
      },
    } as unknown as OpenClawPluginApi["runtime"],
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
  attempts = 20,
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
  };
}

async function registerPluginFixture(params?: {
  triggerMode?: "approve" | "auto";
  repoRoot?: string;
  pollIntervalMs?: number;
}) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-plugin-test-"));
  const repoRoot =
    params?.repoRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-plugin-repo-")));
  const commands = new Map<string, OpenClawPluginCommandDefinition>();
  const runCommandWithTimeout = vi.fn();
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

  plugin.register?.(
    createApi({
      stateDir,
      pluginConfig: {
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
            pollIntervalMs: params?.pollIntervalMs,
          },
        ],
        pollIntervalMs: params?.pollIntervalMs,
      },
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
  await new Promise((resolve) => setTimeout(resolve, 0));
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
          "Summary: Webhook intake precheck escalated the issue before chat approval. Issue text references high-risk areas: auth, secrets, security, permissions.",
          "Use /occode-status zhyongrui/openclawcode#221 to inspect the tracked status.",
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
    } finally {
      await fs.rm(fixture.repoRoot, { recursive: true, force: true });
      await fs.rm(fixture.stateDir, { recursive: true, force: true });
    }
  });

  it("accepts a one-line request for /occode-intake and synthesizes a minimal body", async () => {
    const fixture = await registerPluginFixture();
    try {
      vi.stubEnv("GH_TOKEN", "test-token");
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            createGitHubIssueResponse({
              issueNumber: 222,
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

      expect(result).toEqual({
        text: [
          "openclawcode created and queued a new GitHub issue from chat.",
          "Issue: zhyongrui/openclawcode#222",
          "Title: Expose issueCount in openclaw code run --json output",
          "URL: https://github.com/zhyongrui/openclawcode/issues/222",
          "Status: queued for execution",
          "Use /occode-status zhyongrui/openclawcode#222 to inspect progress.",
        ].join("\n"),
      });
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
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
        ].join("\n"),
      });
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
      });
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
        ].join("\n"),
      });
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
          "Running: 1",
          "- zhyongrui/openclawcode#303 | Running.",
          "Queued: 1",
          "- zhyongrui/openclawcode#302 | Queued.",
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
          "Pending approvals: 0",
          "Running: 0",
          "Queued: 0",
          "Recent ledger: 2",
          "- zhyongrui/openclawcode#6602 | Failed | final: failed | 2099-03-12T12:05:00.000Z",
          "  provider: active pause until 2099-03-12T12:15:00.000Z | last transient failure at 2099-03-12T12:05:00.000Z | failures: 2",
          "  provider-reason: Paused after 2 recent provider-side transient failures. Recent workflow runs are failing with HTTP 400 internal errors before code changes are produced.",
          "- zhyongrui/openclawcode#6601 | Failed | final: failed | 2099-03-12T12:00:00.000Z",
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
