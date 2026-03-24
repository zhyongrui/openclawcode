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
      list: [{ id: "main" }],
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
          deny: expect.arrayContaining(["write"]),
        }),
        agents: expect.objectContaining({
          defaults: expect.objectContaining({
            sandbox: expect.objectContaining({ scope: "session" }),
            tools: expect.objectContaining({
              deny: expect.arrayContaining(["write"]),
            }),
          }),
        }),
      }),
      expect.anything(),
    );
    const runtimeConfig = mocks.setRuntimeConfigSnapshot.mock.calls[0]?.[0];
    expect(runtimeConfig?.tools?.deny).not.toContain("edit");
    expect(runtimeConfig?.agents?.defaults?.tools?.deny).not.toContain("edit");
    expect(mocks.agentCommand).toHaveBeenCalledTimes(1);
    expect(mocks.agentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Implement the issue",
        workspaceDir: "/tmp/openclawcode-worktree",
        agentId: "main",
        sessionId: expect.stringMatching(/^openclawcode-/),
        sessionKey: expect.stringMatching(/^agent:main:openclawcode-/),
        bootstrapContextMode: undefined,
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

  it("uses lightweight bootstrap context for openclawcode issue worktrees", async () => {
    const { OpenClawAgentRunner } = await import("./agent-runner.js");

    const runner = new OpenClawAgentRunner();
    await runner.run({
      prompt: "Implement the issue",
      workspaceDir: "/tmp/repo/.openclawcode/worktrees/run-87",
      agentId: "main",
    });

    expect(mocks.agentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/tmp/repo/.openclawcode/worktrees/run-87",
        bootstrapContextMode: "lightweight",
      }),
      expect.anything(),
      expect.anything(),
    );

    const runtimeConfig = mocks.setRuntimeConfigSnapshot.mock.calls.at(-1)?.[0];
    expect(runtimeConfig?.tools?.deny).toEqual(
      expect.arrayContaining(["sessions_spawn", "subagents", "session_status"]),
    );
    expect(runtimeConfig?.agents?.list?.[0]?.skills).toEqual(["coding-agent"]);
  });

  it("throws when the agent command ends with stopReason=error", async () => {
    mocks.agentCommand.mockResolvedValueOnce({
      payloads: [{ text: "HTTP 400: Internal server error" }],
      meta: {
        stopReason: "error",
        agentMeta: {
          provider: "crs",
          model: "gpt-5.4",
          lastCallUsage: {
            total: 0,
          },
        },
        systemPromptReport: {
          source: "run",
          generatedAt: 1,
          provider: "crs",
          model: "gpt-5.4",
          systemPrompt: {
            chars: 8629,
            projectContextChars: 1000,
            nonProjectContextChars: 7629,
          },
          injectedWorkspaceFiles: [],
          skills: {
            promptChars: 1245,
            entries: [{ name: "coding-agent", blockChars: 876 }],
          },
          tools: {
            listChars: 400,
            schemaChars: 3030,
            entries: [
              { name: "read", summaryChars: 100, schemaChars: 200 },
              { name: "edit", summaryChars: 100, schemaChars: 300 },
              { name: "exec", summaryChars: 100, schemaChars: 400 },
              { name: "process", summaryChars: 100, schemaChars: 500 },
            ],
          },
          bootstrapTruncation: {
            warningShown: false,
          },
        },
      },
    });
    const { AgentRunFailureError, OpenClawAgentRunner, formatAgentRunFailureDiagnostics } =
      await import("./agent-runner.js");

    const runner = new OpenClawAgentRunner();

    let caught: unknown;
    try {
      await runner.run({
        prompt: "Implement the issue",
        workspaceDir: "/tmp/openclawcode-worktree",
        agentId: "main",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentRunFailureError);
    expect((caught as Error | undefined)?.message).toBe("HTTP 400: Internal server error");
    expect((caught as AgentRunFailureError).diagnostics).toMatchObject({
      stopReason: "error",
      provider: "crs",
      model: "gpt-5.4",
      systemPromptChars: 8629,
      skillsPromptChars: 1245,
      toolSchemaChars: 3030,
      toolCount: 4,
      skillCount: 1,
      injectedWorkspaceFileCount: 0,
      bootstrapWarningShown: false,
      lastCallUsageTotal: 0,
    });
    expect(formatAgentRunFailureDiagnostics((caught as AgentRunFailureError).diagnostics)).toBe(
      "model=crs/gpt-5.4, prompt=8629, skillsPrompt=1245, schema=3030, tools=4, skills=1, files=0, usage=0, bootstrap=clean",
    );

    expect(mocks.clearRuntimeConfigSnapshot).toHaveBeenCalledTimes(1);
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
    expect(config.tools?.deny).toEqual(expect.arrayContaining(["browser", "write"]));
    expect(config.tools?.deny).not.toContain("edit");
    expect(config.agents?.defaults?.tools?.deny).toEqual(
      expect.arrayContaining(["browser", "write"]),
    );
    expect(config.agents?.defaults?.tools?.deny).not.toContain("edit");
    expect(config.agents?.list?.[0]?.sandbox?.scope).toBe("session");
    expect(config.agents?.list?.[0]?.tools?.deny).toEqual(
      expect.arrayContaining(["process", "write"]),
    );
    expect(config.agents?.list?.[0]?.tools?.deny).not.toContain("edit");
  });

  it("allows staged fs tool re-enable through OPENCLAWCODE_ENABLE_FS_TOOLS", async () => {
    const { __testing } = await import("./agent-runner.js");

    expect(__testing.resolveOpenClawCodeDeniedTools({})).toEqual(["write"]);
    expect(
      __testing.resolveOpenClawCodeDeniedTools({
        OPENCLAWCODE_ENABLE_FS_TOOLS: "edit",
      }),
    ).toEqual(["write"]);
    expect(
      __testing.resolveOpenClawCodeDeniedTools({
        OPENCLAWCODE_ENABLE_FS_TOOLS: "write",
      }),
    ).toEqual([]);
    expect(
      __testing.resolveOpenClawCodeDeniedTools({
        OPENCLAWCODE_ENABLE_FS_TOOLS: "edit,write",
      }),
    ).toEqual([]);

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
          },
          list: [
            {
              id: "main",
              sandbox: {
                mode: "all",
                scope: "agent",
                workspaceAccess: "rw",
              },
            },
          ],
        },
      },
      "main",
      {
        env: {
          OPENCLAWCODE_ENABLE_FS_TOOLS: "write",
        },
      },
    );

    expect(config.tools?.deny).toEqual(expect.arrayContaining(["browser"]));
    expect(config.tools?.deny).not.toContain("edit");
    expect(config.tools?.deny).not.toContain("write");
    expect(config.agents?.defaults?.tools?.deny ?? []).toEqual([]);
    expect(config.agents?.defaults?.tools?.deny).not.toContain("edit");
    expect(config.agents?.defaults?.tools?.deny).not.toContain("write");
    expect(config.agents?.list?.[0]?.tools?.deny ?? []).toEqual([]);
    expect(config.agents?.list?.[0]?.tools?.deny).not.toContain("edit");
    expect(config.agents?.list?.[0]?.tools?.deny).not.toContain("write");
  });

  it("parses OPENCLAWCODE_MODEL_FALLBACKS into a unique ordered list", async () => {
    const { __testing } = await import("./agent-runner.js");

    expect(__testing.resolveOpenClawCodeModelFallbacks({})).toEqual([]);
    expect(
      __testing.resolveOpenClawCodeModelFallbacks({
        OPENCLAWCODE_MODEL_FALLBACKS:
          " openai/gpt-5-mini , anthropic/claude-haiku-3-5, openai/gpt-5-mini ,, ",
      }),
    ).toEqual(["openai/gpt-5-mini", "anthropic/claude-haiku-3-5"]);
  });

  it("injects model fallbacks for openclawcode runs without overriding explicit fallbacks", async () => {
    const { __testing } = await import("./agent-runner.js");

    const injected = __testing.forceSessionScopedSandboxForAgent(
      {
        agents: {
          defaults: {
            model: "crs/gpt-5.4",
            sandbox: {
              mode: "all",
              scope: "agent",
              workspaceAccess: "rw",
            },
          },
          list: [
            {
              id: "main",
              model: { primary: "crs/gpt-5.4" },
              sandbox: {
                mode: "all",
                scope: "agent",
                workspaceAccess: "rw",
              },
            },
          ],
        },
      },
      "main",
      {
        env: {
          OPENCLAWCODE_MODEL_FALLBACKS: "openai/gpt-5-mini,anthropic/claude-haiku-3-5",
        },
      },
    );

    expect(injected.agents?.defaults?.model).toEqual({
      primary: "crs/gpt-5.4",
      fallbacks: ["openai/gpt-5-mini", "anthropic/claude-haiku-3-5"],
    });
    expect(injected.agents?.list?.[0]?.model).toEqual({
      primary: "crs/gpt-5.4",
      fallbacks: ["openai/gpt-5-mini", "anthropic/claude-haiku-3-5"],
    });

    const preserved = __testing.forceSessionScopedSandboxForAgent(
      {
        agents: {
          defaults: {
            model: {
              primary: "crs/gpt-5.4",
              fallbacks: ["google/gemini-2.5-flash"],
            },
            sandbox: {
              mode: "all",
              scope: "agent",
              workspaceAccess: "rw",
            },
          },
          list: [
            {
              id: "main",
              model: {
                primary: "crs/gpt-5.4",
                fallbacks: [],
              },
              sandbox: {
                mode: "all",
                scope: "agent",
                workspaceAccess: "rw",
              },
            },
          ],
        },
      },
      "main",
      {
        env: {
          OPENCLAWCODE_MODEL_FALLBACKS: "openai/gpt-5-mini",
        },
      },
    );

    expect(preserved.agents?.defaults?.model).toEqual({
      primary: "crs/gpt-5.4",
      fallbacks: ["google/gemini-2.5-flash"],
    });
    expect(preserved.agents?.list?.[0]?.model).toEqual({
      primary: "crs/gpt-5.4",
      fallbacks: [],
    });
  });

  it("detects openclawcode issue worktrees for lightweight bootstrap context", async () => {
    const { __testing } = await import("./agent-runner.js");

    expect(
      __testing.resolveOpenClawCodeBootstrapContextMode("/tmp/repo/.openclawcode/worktrees/run-99"),
    ).toBe("lightweight");
    expect(__testing.resolveOpenClawCodeBootstrapContextMode("/tmp/openclawcode-worktree")).toBe(
      undefined,
    );
    expect(
      __testing.resolveOpenClawCodeWorktreeDeniedTools("/tmp/repo/.openclawcode/worktrees/run-99"),
    ).toEqual(
      expect.arrayContaining([
        "sessions_list",
        "sessions_history",
        "sessions_send",
        "sessions_spawn",
        "subagents",
        "session_status",
      ]),
    );
    expect(__testing.resolveOpenClawCodeWorktreeDeniedTools("/tmp/openclawcode-worktree")).toEqual(
      [],
    );
    expect(
      __testing.resolveOpenClawCodeWorktreeSkillFilter("/tmp/repo/.openclawcode/worktrees/run-99"),
    ).toEqual(["coding-agent"]);
    expect(__testing.resolveOpenClawCodeWorktreeSkillFilter("/tmp/openclawcode-worktree")).toBe(
      undefined,
    );
  });

  it("upserts an agent entry for worktree skill filtering when only defaults exist", async () => {
    const { __testing } = await import("./agent-runner.js");

    const config = __testing.forceSessionScopedSandboxForAgent(
      {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              scope: "agent",
              workspaceAccess: "rw",
            },
          },
        },
      },
      "main",
      {
        workspaceDir: "/tmp/repo/.openclawcode/worktrees/run-99",
      },
    );

    expect(config.agents?.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "main",
          skills: ["coding-agent"],
        }),
      ]),
    );
  });

  it("adds fallback overrides to upserted worktree agent entries when configured", async () => {
    const { __testing } = await import("./agent-runner.js");

    const config = __testing.forceSessionScopedSandboxForAgent(
      {
        agents: {
          defaults: {
            model: {
              primary: "crs/gpt-5.4",
            },
            sandbox: {
              mode: "all",
              scope: "agent",
              workspaceAccess: "rw",
            },
          },
        },
      },
      "main",
      {
        workspaceDir: "/tmp/repo/.openclawcode/worktrees/run-99",
        env: {
          OPENCLAWCODE_MODEL_FALLBACKS: "openai/gpt-5-mini,anthropic/claude-haiku-3-5",
        },
      },
    );

    expect(config.agents?.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "main",
          skills: ["coding-agent"],
          model: {
            fallbacks: ["openai/gpt-5-mini", "anthropic/claude-haiku-3-5"],
          },
        }),
      ]),
    );
  });
});
