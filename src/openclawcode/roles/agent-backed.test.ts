import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execFileUtf8 } from "../../daemon/exec-file.js";
import type { WorkflowRun } from "../contracts/index.js";
import { HostShellRunner, type AgentRunner, type ShellRunner } from "../runtime/index.js";
import { AgentBackedBuilder, AgentBackedVerifier, __testing } from "./agent-backed.js";

function createRun(): WorkflowRun {
  return {
    id: "run-1",
    stage: "planning",
    issue: {
      owner: "zhyongrui",
      repo: "openclawcode",
      number: 1,
      title: "Persist draft PR number in workflow output",
      body: "Record the draft PR number in structured workflow artifacts.",
      labels: ["enhancement"],
    },
    createdAt: "2026-03-09T14:00:00.000Z",
    updatedAt: "2026-03-09T14:00:00.000Z",
    attempts: {
      total: 1,
      planning: 1,
      building: 0,
      verifying: 0,
    },
    stageRecords: [],
    executionSpec: {
      summary: "Implement issue #1",
      scope: ["Persist draft PR number in workflow output."],
      outOfScope: ["Unrelated refactors"],
      acceptanceCriteria: [
        {
          id: "persist-number",
          text: "Workflow artifacts include the draft PR number.",
          required: true,
        },
      ],
      testPlan: ["Run targeted openclawcode tests."],
      risks: [],
      assumptions: [],
      openQuestions: [],
      riskLevel: "medium",
    },
    workspace: {
      repoRoot: "/repo",
      baseBranch: "main",
      branchName: "openclawcode/issue-1",
      worktreePath: "/repo/.openclawcode/worktrees/run-1",
      preparedAt: "2026-03-09T14:00:00.000Z",
    },
    history: [],
  };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileUtf8("git", ["-C", cwd, ...args]);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

async function createTempRepo(): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
  await runGit(rootDir, ["init"]);
  await runGit(rootDir, ["config", "user.name", "OpenClaw Code Tests"]);
  await runGit(rootDir, ["config", "user.email", "tests@openclawcode.local"]);
  await fs.mkdir(path.join(rootDir, "src", "commands"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "src", "commands", "openclawcode.ts"),
    "export const value = 1;\n",
    "utf8",
  );
  await runGit(rootDir, ["add", "src/commands/openclawcode.ts"]);
  await runGit(rootDir, ["commit", "-m", "init"]);
  await runGit(rootDir, ["branch", "-M", "main"]);
  return rootDir;
}

describe("AgentBackedBuilder prompt", () => {
  it("guides the agent toward targeted openclawcode paths", () => {
    const prompt = __testing.buildBuilderPrompt(createRun(), [
      "npx --yes -p vitest@4.0.18 vitest run --config vitest.openclawcode.config.mjs",
    ]);

    expect(prompt).toContain(
      "Start with targeted reads in the hinted files below, plus nearby tests and docs/openclawcode/",
    );
    expect(prompt).toContain("Avoid broad scans such as `rg ... .`");
    expect(prompt).toContain("Issue Classification:");
    expect(prompt).toContain("- src/openclawcode/app/run-issue.ts");
    expect(prompt).toContain("- src/openclawcode/testing/run-issue.test.ts");
    expect(prompt).toContain("The workflow host will run these final validation commands");
    expect(prompt).toContain(
      "Do not run the full final validation command inside the agent sandbox",
    );
    expect(prompt).toContain(
      "Do not run package-manager or formatter commands inside the agent sandbox",
    );
    expect(prompt).toContain(
      "Do not assume optional runtimes such as `bun` or `bunx` are installed on the workflow host",
    );
  });

  it("adds command-layer hints for CLI-facing issues", () => {
    const prompt = __testing.buildBuilderPrompt(
      {
        ...createRun(),
        issue: {
          ...createRun().issue,
          number: 2,
          title: "Include changed file list in openclaw code run --json output",
          body: "Ensure the CLI command exposes a stable --json field for changed files.",
        },
      },
      ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
    );

    expect(prompt).toContain(
      "This issue appears command-layer focused. Prefer the smallest fix in src/commands/openclawcode.ts and its tests first.",
    );
    expect(prompt).toContain("- command-layer");
    expect(prompt).toContain("- src/commands/openclawcode.ts");
    expect(prompt).toContain("- src/commands/openclawcode.test.ts");
    expect(prompt).toContain(
      "If the requested behavior can be derived from existing workflow state",
    );
    expect(prompt).toContain(
      "replace a unique multi-line block or rewrite the full local test case/function",
    );
    expect(prompt).toContain("If an edit reports multiple matches or verification failure");
  });

  it("prefers exact documentation hints for README issues that mention plugin integration", () => {
    const prompt = __testing.buildBuilderPrompt(
      {
        ...createRun(),
        issue: {
          ...createRun().issue,
          number: 36,
          title: "[Feature]: Document /occode-sync in openclawcode README",
          body: [
            "Summary",
            "Add a short operator-facing note in `docs/openclawcode/README.md` that mentions the `/occode-sync` chat command.",
            "",
            "Problem to solve",
            "The plugin integration doc already describes `/occode-sync`, but the product README under `docs/openclawcode/` does not mention that operators can force a reconciliation pass from chat.",
          ].join("\n"),
        },
      },
      ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
    );

    expect(prompt).toContain("- docs/openclawcode/README.md");
    expect(prompt).toContain("- docs/openclawcode/openclaw-plugin-integration.md");
    expect(prompt).not.toContain("- docs/openclawcode/plugin-integration.md");
  });

  it("deduplicates repeated explicit path hints to keep large-worktree prompts compact", () => {
    const prompt = __testing.buildBuilderPrompt(
      {
        ...createRun(),
        issue: {
          ...createRun().issue,
          number: 44,
          title: "Keep builder hints narrow in a large repo",
          body: [
            "Summary",
            "Focus on `src/commands/openclawcode.ts`, `src/commands/openclawcode.ts`, and `src/commands/openclawcode.test.ts`.",
            "Do not scan the whole repo when `src/commands/openclawcode.ts` is already the target.",
          ].join("\n"),
        },
      },
      ["pnpm exec vitest run src/commands/openclawcode.test.ts --pool threads"],
    );

    expect(prompt.match(/- src\/commands\/openclawcode\.ts/g)).toHaveLength(1);
    expect(prompt.match(/- src\/commands\/openclawcode\.test\.ts/g)).toHaveLength(1);
    expect(prompt).toContain("Avoid broad scans such as `rg ... .`");
  });
});

describe("AgentBacked transient retry timing", () => {
  it("keeps HTTP 400 internal provider retries on a short leash", () => {
    expect(
      __testing.resolveTransientRetryDelayMs({
        error: new Error("HTTP 400: Internal server error"),
        attempt: 1,
        delayMs: 1_000,
      }),
    ).toBe(250);
    expect(
      __testing.resolveTransientRetryDelayMs({
        error: new Error("HTTP 400: Internal server error"),
        attempt: 2,
        delayMs: 1_000,
      }),
    ).toBe(250);
  });

  it("keeps overload and timeout retries on the original linear backoff", () => {
    expect(
      __testing.resolveTransientRetryDelayMs({
        error: new Error("Request timed out after waiting for the provider."),
        attempt: 1,
        delayMs: 1_000,
      }),
    ).toBe(1_000);
    expect(
      __testing.resolveTransientRetryDelayMs({
        error: new Error("Provider overloaded, please retry later."),
        attempt: 2,
        delayMs: 1_000,
      }),
    ).toBe(2_000);
  });
});

describe("AgentBacked auto-commit staging", () => {
  it("forces staging for tracked paths that are also matched by .gitignore", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    await runGit(repoRoot, ["init"]);
    await runGit(repoRoot, ["config", "user.name", "OpenClaw Code Tests"]);
    await runGit(repoRoot, ["config", "user.email", "tests@openclawcode.local"]);
    await fs.mkdir(path.join(repoRoot, ".agents", "skills", "tracked-ignored"), {
      recursive: true,
    });
    await fs.writeFile(path.join(repoRoot, ".gitignore"), ".agents\n", "utf8");
    await fs.writeFile(
      path.join(repoRoot, ".agents", "skills", "tracked-ignored", "SKILL.md"),
      "tracked\n",
      "utf8",
    );
    await runGit(repoRoot, ["add", ".gitignore"]);
    await runGit(repoRoot, ["add", "-f", ".agents/skills/tracked-ignored/SKILL.md"]);
    await runGit(repoRoot, ["commit", "-m", "init"]);
    await fs.rm(path.join(repoRoot, ".agents", "skills", "tracked-ignored", "SKILL.md"));

    try {
      await __testing.autoCommitChanges(
        repoRoot,
        new HostShellRunner(),
        "remove tracked ignored file",
        [".agents/skills/tracked-ignored/SKILL.md"],
      );

      expect(await runGit(repoRoot, ["status", "--short"])).toBe("");
      expect(await runGit(repoRoot, ["log", "-1", "--pretty=%s"])).toBe(
        "remove tracked ignored file",
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("AgentBacked build policy guardrails", () => {
  it("derives broad fan-out, large diff, and generated-file signals", () => {
    const signals = __testing.deriveBuildPolicySignals({
      changedFiles: [
        "src/commands/openclawcode.ts",
        "src/openclawcode/app/run-issue.ts",
        "src/openclawcode/contracts/types.ts",
        "src/openclawcode/roles/suitability.ts",
        "docs/openclawcode/README.md",
        "docs/openclawcode/policy.md",
        "generated/openclawcode/output.gen.ts",
        "scripts/openclawcode-setup-check.sh",
      ],
      changedLineCount: 420,
    });

    expect(signals.changedLineCount).toBe(420);
    expect(signals.changedDirectoryCount).toBe(7);
    expect(signals.broadFanOut).toBe(true);
    expect(signals.largeDiff).toBe(true);
    expect(signals.generatedFiles).toEqual(["generated/openclawcode/output.gen.ts"]);
  });

  it("keeps narrow command-layer changes below the guardrail thresholds", () => {
    const signals = __testing.deriveBuildPolicySignals({
      changedFiles: ["src/commands/openclawcode.ts", "src/commands/openclawcode.test.ts"],
      changedLineCount: 24,
    });

    expect(signals.changedDirectoryCount).toBe(1);
    expect(signals.broadFanOut).toBe(false);
    expect(signals.largeDiff).toBe(false);
    expect(signals.generatedFiles).toEqual([]);
  });
});

class FakeAgentRunner implements AgentRunner {
  async run() {
    return {
      text: "Implemented the change.",
      raw: {},
    };
  }
}

class TruncatingAgentRunner implements AgentRunner {
  constructor(private readonly targetPath: string) {}

  async run() {
    await fs.writeFile(this.targetPath, "", "utf8");
    return {
      text: "Attempted the change.",
      raw: {},
    };
  }
}

class FakeShellRunner implements ShellRunner {
  async run(request: { cwd: string; command: string }) {
    return {
      command: request.command,
      code: 0,
      stdout: "",
      stderr: "",
    };
  }
}

class FlakyAgentRunner implements AgentRunner {
  private attempt = 0;

  constructor(
    private readonly params: {
      failTimes: number;
      failureMessage: string;
      successText: string;
    },
  ) {}

  async run() {
    this.attempt += 1;
    if (this.attempt <= this.params.failTimes) {
      throw new Error(this.params.failureMessage);
    }
    return {
      text: this.params.successText,
      raw: {},
    };
  }
}

class RecordingAgentRunner implements AgentRunner {
  readonly requests: Array<{
    prompt: string;
    workspaceDir: string;
    agentId?: string;
    timeoutSeconds?: number;
  }> = [];

  constructor(
    private readonly response: {
      text: string;
      raw?: unknown;
    },
  ) {}

  async run(request: {
    prompt: string;
    workspaceDir: string;
    agentId?: string;
    timeoutSeconds?: number;
  }) {
    this.requests.push(request);
    return {
      text: this.response.text,
      raw: this.response.raw ?? {},
    };
  }
}

describe("AgentBackedBuilder scope enforcement", () => {
  it("fails command-layer builds that edit blocked workflow-core files", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const builder = new AgentBackedBuilder({
      agentRunner: new FakeAgentRunner(),
      shellRunner: new FakeShellRunner(),
      testCommands: ["pnpm exec vitest run --config vitest.openclawcode.config.mjs"],
      autoCommit: false,
      collectChangedFiles: async () => [
        "src/commands/openclawcode.ts",
        "src/openclawcode/contracts/types.ts",
      ],
    });

    try {
      await expect(
        builder.build({
          ...createRun(),
          issue: {
            ...createRun().issue,
            number: 2,
            title: "Include changed file list in openclaw code run --json output",
            body: "Ensure the CLI command exposes a stable --json field for changed files.",
          },
          workspace: {
            ...createRun().workspace!,
            worktreePath,
          },
        }),
      ).rejects.toThrow(/workflow-core files/i);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("fails fast when an existing tracked file becomes empty in the isolated worktree", async () => {
    const worktreePath = await createTempRepo();
    const builder = new AgentBackedBuilder({
      agentRunner: new TruncatingAgentRunner(
        path.join(worktreePath, "src", "commands", "openclawcode.ts"),
      ),
      shellRunner: new HostShellRunner(),
      testCommands: [],
      autoCommit: false,
      collectChangedFiles: async () => ["src/commands/openclawcode.ts"],
    });

    try {
      await expect(
        builder.build({
          ...createRun(),
          issue: {
            ...createRun().issue,
            number: 44,
            title: "Expose rerunHasReviewContext in openclaw code run JSON",
          },
          workspace: {
            ...createRun().workspace!,
            repoRoot: worktreePath,
            worktreePath,
          },
        }),
      ).rejects.toThrow(/Builder workspace integrity check failed/i);

      expect(
        await fs.readFile(path.join(worktreePath, "src", "commands", "openclawcode.ts"), "utf8"),
      ).toBe("");
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("retries transient provider failures before succeeding", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const builder = new AgentBackedBuilder({
      agentRunner: new FlakyAgentRunner({
        failTimes: 1,
        failureMessage: "HTTP 400: Internal server error",
        successText: "Implemented after transient provider retry.",
      }),
      shellRunner: new FakeShellRunner(),
      testCommands: [],
      autoCommit: false,
      transientRetryAttempts: 2,
      transientRetryDelayMs: 0,
      collectChangedFiles: async () => [],
    });

    try {
      const result = await builder.build({
        ...createRun(),
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      });

      expect(result.summary).toBe("Implemented after transient provider retry.");
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("passes a bounded timeout to the builder agent run", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const agentRunner = new RecordingAgentRunner({
      text: "Implemented within the bounded timeout window.",
    });
    const builder = new AgentBackedBuilder({
      agentRunner,
      shellRunner: new FakeShellRunner(),
      testCommands: [],
      timeoutSeconds: 123,
      autoCommit: false,
      collectChangedFiles: async () => [],
    });

    try {
      await builder.build({
        ...createRun(),
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      });

      expect(agentRunner.requests).toHaveLength(1);
      expect(agentRunner.requests[0]?.timeoutSeconds).toBe(123);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("routes coder execution through the adapter-mapped agent when role-routing is configured", async () => {
    const previousAgentId = process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID;
    process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID = "codex-coder";
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const agentRunner = new RecordingAgentRunner({
      text: "Implemented through the codex-coded path.",
    });
    const builder = new AgentBackedBuilder({
      agentRunner,
      shellRunner: new FakeShellRunner(),
      testCommands: [],
      autoCommit: false,
      collectChangedFiles: async () => [],
    });

    try {
      const run = {
        ...createRun(),
        roleRouting: {
          artifactExists: true,
          blueprintRevisionId: "blueprint_rev_1",
          mixedMode: true,
          fallbackConfigured: false,
          unresolvedRoleCount: 0,
          routes: [
            {
              roleId: "coder",
              adapterId: "codex",
              source: "blueprint",
              configured: true,
              fallbackChain: [],
            },
          ],
        },
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      };

      expect(builder.previewRuntimeRouting(run)).toMatchObject({
        roleId: "coder",
        adapterId: "codex",
        appliedAgentId: "codex-coder",
        agentSource: "adapter-env",
      });

      await builder.build(run);

      expect(agentRunner.requests).toHaveLength(1);
      expect(agentRunner.requests[0]?.agentId).toBe("codex-coder");
    } finally {
      if (previousAgentId == null) {
        delete process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID;
      } else {
        process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID = previousAgentId;
      }
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("lets an explicit builder agent override role-routing resolution", async () => {
    const previousAgentId = process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID;
    process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID = "codex-coder";
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const agentRunner = new RecordingAgentRunner({
      text: "Implemented through the explicit builder agent.",
    });
    const builder = new AgentBackedBuilder({
      agentRunner,
      shellRunner: new FakeShellRunner(),
      testCommands: [],
      agentId: "manual-builder",
      autoCommit: false,
      collectChangedFiles: async () => [],
    });

    try {
      const run = {
        ...createRun(),
        roleRouting: {
          artifactExists: true,
          blueprintRevisionId: "blueprint_rev_1",
          mixedMode: true,
          fallbackConfigured: false,
          unresolvedRoleCount: 0,
          routes: [
            {
              roleId: "coder",
              adapterId: "codex",
              source: "blueprint",
              configured: true,
              fallbackChain: [],
            },
          ],
        },
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      };

      await builder.build(run);

      expect(agentRunner.requests).toHaveLength(1);
      expect(agentRunner.requests[0]?.agentId).toBe("manual-builder");
    } finally {
      if (previousAgentId == null) {
        delete process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID;
      } else {
        process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID = previousAgentId;
      }
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("reuses a persisted stage-steering runtime selection for the builder", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const agentRunner = new RecordingAgentRunner({
      text: "Implemented through persisted stage steering.",
    });
    const builder = new AgentBackedBuilder({
      agentRunner,
      shellRunner: new FakeShellRunner(),
      testCommands: [],
      autoCommit: false,
      collectChangedFiles: async () => [],
    });

    try {
      const run = {
        ...createRun(),
        roleRouting: {
          artifactExists: true,
          blueprintRevisionId: "blueprint_rev_1",
          mixedMode: true,
          fallbackConfigured: false,
          unresolvedRoleCount: 0,
          routes: [
            {
              roleId: "coder",
              adapterId: "codex",
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
              adapterId: "claude-code",
              assignmentSource: "blueprint",
              configured: true,
              appliedAgentId: "builder-steered",
              agentSource: "stage-steering" as const,
            },
          ],
        },
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      };

      expect(builder.previewRuntimeRouting(run)).toMatchObject({
        roleId: "coder",
        adapterId: "claude-code",
        appliedAgentId: "builder-steered",
        agentSource: "stage-steering",
      });

      await builder.build(run);

      expect(agentRunner.requests).toHaveLength(1);
      expect(agentRunner.requests[0]?.agentId).toBe("builder-steered");
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});

describe("AgentBackedVerifier", () => {
  it("retries transient provider failures before parsing a successful verifier response", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const verifier = new AgentBackedVerifier({
      agentRunner: new FlakyAgentRunner({
        failTimes: 1,
        failureMessage: "HTTP 400: Internal server error",
        successText: JSON.stringify({
          decision: "approve-for-human-review",
          summary: "Looks good after retry.",
          findings: [],
          missingCoverage: [],
          followUps: [],
        }),
      }),
      transientRetryAttempts: 2,
      transientRetryDelayMs: 0,
    });

    try {
      const result = await verifier.verify({
        ...createRun(),
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      });

      expect(result).toMatchObject({
        decision: "approve-for-human-review",
        summary: "Looks good after retry.",
      });
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("passes a bounded timeout to the verifier agent run", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const agentRunner = new RecordingAgentRunner({
      text: JSON.stringify({
        decision: "approve-for-human-review",
        summary: "Looks good within the bounded timeout window.",
        findings: [],
        missingCoverage: [],
        followUps: [],
      }),
    });
    const verifier = new AgentBackedVerifier({
      agentRunner,
      timeoutSeconds: 45,
      transientRetryAttempts: 1,
      transientRetryDelayMs: 0,
    });

    try {
      await verifier.verify({
        ...createRun(),
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      });

      expect(agentRunner.requests).toHaveLength(1);
      expect(agentRunner.requests[0]?.timeoutSeconds).toBe(45);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("prefers role-specific verifier agent routing over adapter defaults", async () => {
    const previousRoleAgentId = process.env.OPENCLAWCODE_ROLE_VERIFIER_AGENT_ID;
    const previousAdapterAgentId = process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID;
    process.env.OPENCLAWCODE_ROLE_VERIFIER_AGENT_ID = "verifier-role-agent";
    process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID = "codex-fallback-agent";
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const agentRunner = new RecordingAgentRunner({
      text: JSON.stringify({
        decision: "approve-for-human-review",
        summary: "Looks good through the role-routed verifier.",
        findings: [],
        missingCoverage: [],
        followUps: [],
      }),
    });
    const verifier = new AgentBackedVerifier({
      agentRunner,
      transientRetryAttempts: 1,
      transientRetryDelayMs: 0,
    });

    try {
      const run = {
        ...createRun(),
        roleRouting: {
          artifactExists: true,
          blueprintRevisionId: "blueprint_rev_1",
          mixedMode: true,
          fallbackConfigured: false,
          unresolvedRoleCount: 0,
          routes: [
            {
              roleId: "verifier",
              adapterId: "codex",
              source: "blueprint",
              configured: true,
              fallbackChain: [],
            },
          ],
        },
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      };

      expect(verifier.previewRuntimeRouting(run)).toMatchObject({
        roleId: "verifier",
        adapterId: "codex",
        appliedAgentId: "verifier-role-agent",
        agentSource: "role-env",
      });

      await verifier.verify(run);

      expect(agentRunner.requests).toHaveLength(1);
      expect(agentRunner.requests[0]?.agentId).toBe("verifier-role-agent");
    } finally {
      if (previousRoleAgentId == null) {
        delete process.env.OPENCLAWCODE_ROLE_VERIFIER_AGENT_ID;
      } else {
        process.env.OPENCLAWCODE_ROLE_VERIFIER_AGENT_ID = previousRoleAgentId;
      }
      if (previousAdapterAgentId == null) {
        delete process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID;
      } else {
        process.env.OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID = previousAdapterAgentId;
      }
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it("reuses a persisted stage-steering runtime selection for the verifier", async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-agent-backed-"));
    const agentRunner = new RecordingAgentRunner({
      text: JSON.stringify({
        decision: "approve-for-human-review",
        summary: "Looks good through persisted stage steering.",
        findings: [],
        missingCoverage: [],
        followUps: [],
      }),
    });
    const verifier = new AgentBackedVerifier({
      agentRunner,
      transientRetryAttempts: 1,
      transientRetryDelayMs: 0,
    });

    try {
      const run = {
        ...createRun(),
        roleRouting: {
          artifactExists: true,
          blueprintRevisionId: "blueprint_rev_1",
          mixedMode: true,
          fallbackConfigured: false,
          unresolvedRoleCount: 0,
          routes: [
            {
              roleId: "verifier",
              adapterId: "codex",
              source: "blueprint",
              configured: true,
              fallbackChain: [],
            },
          ],
        },
        runtimeRouting: {
          selections: [
            {
              roleId: "verifier",
              adapterId: "claude-code",
              assignmentSource: "blueprint",
              configured: true,
              appliedAgentId: "verifier-steered",
              agentSource: "stage-steering" as const,
            },
          ],
        },
        workspace: {
          ...createRun().workspace!,
          worktreePath,
        },
      };

      expect(verifier.previewRuntimeRouting(run)).toMatchObject({
        roleId: "verifier",
        adapterId: "claude-code",
        appliedAgentId: "verifier-steered",
        agentSource: "stage-steering",
      });

      await verifier.verify(run);

      expect(agentRunner.requests).toHaveLength(1);
      expect(agentRunner.requests[0]?.agentId).toBe("verifier-steered");
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});
