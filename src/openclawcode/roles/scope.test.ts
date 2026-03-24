import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../contracts/index.js";
import { buildScopeGuardrail, checkBuildScope, classifyIssueScope } from "./scope.js";

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

describe("issue scope classification", () => {
  it("classifies CLI-oriented issues as command-layer", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        number: 2,
        title: "Include changed file list in openclaw code run --json output",
        body: "Ensure the CLI command exposes a stable --json field for changed files.",
      },
    };

    expect(classifyIssueScope(run)).toBe("command-layer");
    expect(buildScopeGuardrail(run).preferredPaths).toContain("src/commands/openclawcode.ts");
  });

  it("keeps the real issue #2 wording in command-layer classification", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        number: 2,
        title: "[Feature]: Include changed file list in openclaw code run --json output",
        body: [
          "### Summary",
          "",
          "Persist and print the builder changed file list in a clearer JSON structure.",
          "",
          "### Problem to solve",
          "",
          "The workflow already tracks changed files, but CLI users need a stable JSON field they can consume directly when inspecting a run result.",
          "",
          "### Proposed solution",
          "",
          "Ensure `openclaw code run --json` includes the builder changed file list in a stable structured field and add/update targeted tests.",
        ].join("\n"),
      },
    };

    expect(classifyIssueScope(run)).toBe("command-layer");
  });

  it("keeps verification-derived JSON output issues in command-layer classification", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        number: 25,
        title: "[Feature]: Expose verification follow-up count in openclaw code run --json output",
        body: [
          "### Summary",
          "",
          "Expose a stable top-level verification follow-up count in `openclaw code run --json` output.",
          "",
          "### Problem to solve",
          "",
          "`openclawcode` now exposes verification findings and missing coverage counts, but downstream automation still has to inspect the nested `verificationReport.followUps` array to know how many concrete next actions the verifier produced.",
          "",
          "### Proposed solution",
          "",
          "Update `openclaw code run --json` so the top-level JSON output includes `verificationFollowUpCount` and add/update targeted command-level tests.",
          "",
          "### Additional information",
          "",
          "This is intentionally a small command-layer slice suitable for validating the full `--open-pr --merge-on-approve` workflow.",
        ].join("\n"),
      },
    };

    expect(classifyIssueScope(run)).toBe("command-layer");
  });

  it("treats marked operator-doc validation issues as command-layer-safe", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        number: 86,
        title: "[Docs]: Clarify provider-pause behavior for auto-queued work",
        body: [
          "<!-- openclawcode-validation template=operator-doc-note class=operator-docs -->",
          "",
          "Summary",
          "Clarify how auto-queued work behaves when a provider pause is active.",
          "",
          "Proposed solution",
          "Update `docs/openclawcode/operator-setup.md` with a short note that explains the observable behavior during an active provider pause, including that queue intake can succeed before execution resumes.",
          "- keep the change docs-only",
          "- keep the note specific to operator behavior during active provider pauses",
        ].join("\n"),
      },
    };

    expect(classifyIssueScope(run)).toBe("command-layer");
    expect(buildScopeGuardrail(run).preferredPaths).toContain("docs/openclawcode/");
  });

  it("classifies orchestration work as workflow-core", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        number: 3,
        title: "Persist workflow retry metadata for orchestrator resumes",
        body: "Expand workflow persistence and orchestrator resume behavior.",
      },
    };

    expect(classifyIssueScope(run)).toBe("workflow-core");
  });

  it("classifies overlapping command and workflow issues as mixed", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        number: 4,
        title: "Expose orchestrator retry metadata in openclaw code run --json output",
        body: [
          "Update the CLI output and workflow persistence so rerun metadata is visible.",
          "This also requires orchestrator resume behavior and stored run record updates.",
        ].join(" "),
      },
    };

    expect(classifyIssueScope(run)).toBe("mixed");
  });
});

describe("build scope checks", () => {
  it("passes command-layer changes that stay in command files", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        title: "Include changed file list in openclaw code run --json output",
        body: "Ensure the CLI command exposes a stable --json field for changed files.",
      },
    };

    expect(
      checkBuildScope(run, ["src/commands/openclawcode.ts", "src/commands/openclawcode.test.ts"]),
    ).toEqual({
      ok: true,
      classification: "command-layer",
      blockedFiles: [],
      summary: "Scope check passed for command-layer issue.",
    });
  });

  it("fails command-layer changes that drift into workflow-core files", () => {
    const run: WorkflowRun = {
      ...createRun(),
      issue: {
        ...createRun().issue,
        title: "Include changed file list in openclaw code run --json output",
        body: "Ensure the CLI command exposes a stable --json field for changed files.",
      },
    };

    const result = checkBuildScope(run, [
      "src/commands/openclawcode.ts",
      "src/openclawcode/contracts/types.ts",
      "src/openclawcode/orchestrator/run.ts",
    ]);

    expect(result.ok).toBe(false);
    expect(result.classification).toBe("command-layer");
    expect(result.blockedFiles).toEqual([
      "src/openclawcode/contracts/types.ts",
      "src/openclawcode/orchestrator/run.ts",
    ]);
    expect(result.summary).toContain("Command-layer issue drifted into workflow-core files.");
  });
});
