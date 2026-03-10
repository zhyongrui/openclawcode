import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi, OpenClawPluginCommandDefinition } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenClawCodeChatopsStore } from "../../src/integrations/openclaw-plugin/index.js";
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
  registerCommand: (command: OpenClawPluginCommandDefinition) => void;
  registerHttpRoute: (params: {
    path: string;
    auth: "plugin" | "gateway";
    handler: (
      req: IncomingMessage,
      res: ReturnType<typeof createMockServerResponse>,
    ) => Promise<boolean>;
  }) => void;
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
        runCommandWithTimeout: vi.fn(),
      },
    } as OpenClawPluginApi["runtime"],
    logger: { info() {}, warn() {}, error() {} },
    registerTool() {},
    registerHook() {},
    registerHttpRoute: params.registerHttpRoute,
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
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

async function registerPluginFixture(params?: {
  triggerMode?: "approve" | "auto";
  repoRoot?: string;
}) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-plugin-test-"));
  const repoRoot =
    params?.repoRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-plugin-repo-")));
  const commands = new Map<string, OpenClawPluginCommandDefinition>();
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
            testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
          },
        ],
      },
      registerCommand(command) {
        commands.set(command.name, command);
      },
      registerHttpRoute(params) {
        route = params;
      },
    }),
  );

  return {
    repoRoot,
    stateDir,
    store: OpenClawCodeChatopsStore.fromStateDir(stateDir),
    commands,
    route,
  };
}

describe("openclawcode extension", () => {
  beforeEach(() => {
    mocked.readRequestBodyWithLimit.mockReset();
    mocked.runMessageAction.mockReset();
    mocked.runMessageAction.mockResolvedValue({ kind: "send" });
    vi.unstubAllGlobals();
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
      expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
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
      expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
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
      expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
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
      expect(mocked.runMessageAction).toHaveBeenCalledTimes(1);
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
