import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentCommand: vi.fn(async () => ({
    payloads: [{ text: "builder output" }],
  })),
  loadConfig: vi.fn(() => ({
    skills: { load: { extraDirs: ["/tmp/extra-skills"] } },
    agents: {
      defaults: {
        sandbox: {
          mode: "all",
          scope: "agent",
          workspaceAccess: "rw",
        },
      },
    },
  })),
  setRuntimeConfigSnapshot: vi.fn(),
  getRuntimeConfigSnapshot: vi.fn(() => null),
  getRuntimeConfigSourceSnapshot: vi.fn(() => null),
  clearRuntimeConfigSnapshot: vi.fn(),
  mirrorMergedSkillsToProjectWorkspace: vi.fn(async () => undefined),
}));

vi.mock("../../commands/agent.js", () => ({
  agentCommand: mocks.agentCommand,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
  setRuntimeConfigSnapshot: mocks.setRuntimeConfigSnapshot,
  getRuntimeConfigSnapshot: mocks.getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot: mocks.getRuntimeConfigSourceSnapshot,
  clearRuntimeConfigSnapshot: mocks.clearRuntimeConfigSnapshot,
}));

vi.mock("../../agents/skills.js", () => ({
  mirrorMergedSkillsToProjectWorkspace: mocks.mirrorMergedSkillsToProjectWorkspace,
}));

describe("OpenClawAgentRunner", () => {
  beforeEach(() => {
    mocks.agentCommand.mockClear();
    mocks.loadConfig.mockClear();
    mocks.setRuntimeConfigSnapshot.mockClear();
    mocks.getRuntimeConfigSnapshot.mockClear();
    mocks.getRuntimeConfigSourceSnapshot.mockClear();
    mocks.clearRuntimeConfigSnapshot.mockClear();
    mocks.mirrorMergedSkillsToProjectWorkspace.mockClear();
  });

  it("mirrors merged skills into the workspace before invoking the agent command", async () => {
    const { OpenClawAgentRunner } = await import("./agent-runner.js");

    const runner = new OpenClawAgentRunner();
    const result = await runner.run({
      prompt: "Implement the issue",
      workspaceDir: "/tmp/openclawcode-worktree",
      agentId: "main",
    });

    expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
    expect(mocks.mirrorMergedSkillsToProjectWorkspace).toHaveBeenCalledWith({
      workspaceDir: "/tmp/openclawcode-worktree",
      config: expect.objectContaining({
        skills: { load: { extraDirs: ["/tmp/extra-skills"] } },
        agents: expect.objectContaining({
          defaults: expect.objectContaining({
            sandbox: expect.objectContaining({
              mode: "all",
              scope: "session",
              workspaceAccess: "rw",
            }),
          }),
        }),
      }),
    });
    expect(mocks.setRuntimeConfigSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          deny: expect.arrayContaining(["edit", "write"]),
        }),
        agents: expect.objectContaining({
          defaults: expect.objectContaining({
            sandbox: expect.objectContaining({ scope: "session" }),
            tools: expect.objectContaining({
              deny: expect.arrayContaining(["edit", "write"]),
            }),
          }),
        }),
      }),
      expect.anything(),
    );
    expect(mocks.agentCommand).toHaveBeenCalledTimes(1);
    expect(mocks.agentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Implement the issue",
        workspaceDir: "/tmp/openclawcode-worktree",
        agentId: "main",
        sessionId: expect.stringMatching(/^openclawcode-/),
        sessionKey: expect.stringMatching(/^agent:main:openclawcode-/),
        json: true,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.text).toBe("builder output");
    expect(mocks.clearRuntimeConfigSnapshot).toHaveBeenCalledTimes(1);
  });

  it("passes through an explicit isolated session id when provided", async () => {
    const { OpenClawAgentRunner } = await import("./agent-runner.js");

    const runner = new OpenClawAgentRunner();
    await runner.run({
      prompt: "Review the implementation",
      workspaceDir: "/tmp/openclawcode-worktree",
      agentId: "main",
      sessionId: "openclawcode-builder-issue-1",
    });

    expect(mocks.agentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "openclawcode-builder-issue-1",
        sessionKey: "agent:main:openclawcode-builder-issue-1",
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("forces session-scoped sandbox overrides for the target agent", async () => {
    const { __testing } = await import("./agent-runner.js");

    const config = __testing.forceSessionScopedSandboxForAgent(
      {
        tools: {
          deny: ["browser"],
        },
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              scope: "agent",
              workspaceAccess: "rw",
            },
            tools: {
              deny: ["browser"],
            },
          },
          list: [
            {
              id: "main",
              sandbox: {
                mode: "all",
                scope: "agent",
                workspaceAccess: "rw",
              },
              tools: {
                deny: ["process"],
              },
            },
          ],
        },
      },
      "main",
    );

    expect(config.agents?.defaults?.sandbox?.scope).toBe("session");
    expect(config.tools?.deny).toEqual(expect.arrayContaining(["browser", "edit", "write"]));
    expect(config.agents?.defaults?.tools?.deny).toEqual(
      expect.arrayContaining(["browser", "edit", "write"]),
    );
    expect(config.agents?.list?.[0]?.sandbox?.scope).toBe("session");
    expect(config.agents?.list?.[0]?.tools?.deny).toEqual(
      expect.arrayContaining(["process", "edit", "write"]),
    );
  });
});
