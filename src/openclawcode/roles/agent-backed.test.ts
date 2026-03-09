import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../contracts/index.js";
import { __testing } from "./agent-backed.js";

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

describe("AgentBackedBuilder prompt", () => {
  it("guides the agent toward targeted openclawcode paths", () => {
    const prompt = __testing.buildBuilderPrompt(createRun(), [
      "npx --yes -p vitest@4.0.18 vitest run --config vitest.openclawcode.config.mjs",
    ]);

    expect(prompt).toContain(
      "Start with targeted reads in the hinted files below, plus nearby tests and docs/openclawcode/",
    );
    expect(prompt).toContain("Avoid broad scans such as `rg ... .`");
    expect(prompt).toContain("- src/openclawcode/app/run-issue.ts");
    expect(prompt).toContain("- src/openclawcode/testing/run-issue.test.ts");
    expect(prompt).toContain("The workflow host will run these final validation commands");
    expect(prompt).toContain(
      "Do not run the full final validation command inside the agent sandbox",
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
      "When the issue mentions CLI flags, JSON output, or `openclaw code run`",
    );
    expect(prompt).toContain("- src/commands/openclawcode.ts");
    expect(prompt).toContain("- src/commands/openclawcode.test.ts");
    expect(prompt).toContain(
      "This issue appears command-layer focused. Prefer the smallest fix in src/commands/openclawcode.ts and its tests first.",
    );
    expect(prompt).toContain(
      "If the requested JSON field can be derived from existing WorkflowRun data",
    );
  });
});
