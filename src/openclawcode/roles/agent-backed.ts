import fs from "node:fs/promises";
import path from "node:path";
import type { BuildResult, VerificationReport, WorkflowRun } from "../contracts/index.js";
import type { AgentRunner, ShellRunner } from "../runtime/index.js";
import type { Builder, Verifier } from "./interfaces.js";

export interface AgentBackedBuilderOptions {
  agentRunner: AgentRunner;
  shellRunner: ShellRunner;
  testCommands: string[];
  agentId?: string;
  autoCommit?: boolean;
}

export interface AgentBackedVerifierOptions {
  agentRunner: AgentRunner;
  agentId?: string;
}

function renderIssueBody(run: WorkflowRun): string {
  return run.issue.body?.trim() ? run.issue.body.trim() : "No issue body provided.";
}

function buildRelevantPathHints(run: WorkflowRun): string[] {
  const issueText = `${run.issue.title}\n${run.issue.body ?? ""}`.toLowerCase();
  const hints = [
    "src/openclawcode/app/run-issue.ts",
    "src/openclawcode/contracts/types.ts",
    "src/openclawcode/testing/run-issue.test.ts",
    "src/openclawcode/testing/orchestrator.test.ts",
    "src/openclawcode/orchestrator/run.ts",
  ];

  if (
    issueText.includes("openclaw code run") ||
    issueText.includes("--json") ||
    issueText.includes("cli") ||
    issueText.includes("command")
  ) {
    hints.unshift("src/commands/openclawcode.test.ts");
    hints.unshift("src/commands/openclawcode.ts");
  }

  return hints;
}

function buildBuilderPrompt(run: WorkflowRun, testCommands: string[]): string {
  const workspaceRoot = run.workspace?.worktreePath ?? "unknown";
  const issueText = `${run.issue.title}\n${run.issue.body ?? ""}`.toLowerCase();
  const isCommandLayerIssue =
    issueText.includes("openclaw code run") ||
    issueText.includes("--json") ||
    issueText.includes("cli") ||
    issueText.includes("command");
  const postBuildTestLine =
    testCommands.length > 0
      ? `- The workflow host will run these final validation commands after you finish: ${testCommands.join("; ")}`
      : "- Prepare the code so post-build tests can run.";
  const commandLayerGuardrail = isCommandLayerIssue
    ? [
        "- This issue appears command-layer focused. Prefer the smallest fix in src/commands/openclawcode.ts and its tests first.",
        "- If the requested JSON field can be derived from existing WorkflowRun data, do that instead of changing workflow contracts or persistence.",
        "- Only change src/openclawcode/contracts/types.ts, orchestrator persistence, or stored run structure when the issue explicitly requires new persisted data.",
      ]
    : [];
  return [
    `You are implementing GitHub issue #${run.issue.number} in the current repository.`,
    `Workspace Root: ${workspaceRoot}`,
    "",
    "Issue Title:",
    run.issue.title,
    "",
    "Issue Body:",
    renderIssueBody(run),
    "",
    "Execution Summary:",
    run.executionSpec?.summary ?? "No execution summary available.",
    "",
    "Scope:",
    ...(run.executionSpec?.scope ?? ["No scope recorded."]).map((entry) => `- ${entry}`),
    "",
    "Acceptance Criteria:",
    ...(run.executionSpec?.acceptanceCriteria ?? []).map((criterion) => `- ${criterion.text}`),
    "",
    "Required behavior:",
    "- Modify code directly in this workspace.",
    "- Treat the workspace root above as the repository root. Use paths relative to it and do not prepend the repository name.",
    "- Start with targeted reads in the hinted files below, plus nearby tests and docs/openclawcode/, before any repo-wide search.",
    "- When the issue mentions CLI flags, JSON output, or `openclaw code run`, inspect src/commands/openclawcode.ts and src/commands/openclawcode.test.ts early.",
    "- Avoid broad scans such as `rg ... .` unless narrower paths were insufficient.",
    "- Add or update tests when needed.",
    "- Do not run the full final validation command inside the agent sandbox unless absolutely necessary; prefer lightweight, issue-specific checks.",
    ...commandLayerGuardrail,
    "- Keep changes scoped to the issue.",
    "- Do not ask for clarification unless the issue is impossible to implement safely.",
    "",
    "Likely relevant files:",
    ...buildRelevantPathHints(run).map((entry) => `- ${entry}`),
    "",
    postBuildTestLine,
  ].join("\n");
}

function buildVerifierPrompt(run: WorkflowRun): string {
  return [
    "Review the implementation in the current workspace against the original issue.",
    "",
    `Issue #${run.issue.number}: ${run.issue.title}`,
    "",
    "Issue Body:",
    renderIssueBody(run),
    "",
    "Acceptance Criteria:",
    ...(run.executionSpec?.acceptanceCriteria ?? []).map((criterion) => `- ${criterion.text}`),
    "",
    "Build Summary:",
    run.buildResult?.summary ?? "No build summary recorded.",
    "",
    "Observed Changed Files:",
    ...(run.buildResult?.changedFiles ?? ["No changed files recorded."]).map(
      (entry) => `- ${entry}`,
    ),
    "",
    "Recorded Test Results:",
    ...(run.buildResult?.testResults ?? ["No tests recorded."]).map((entry) => `- ${entry}`),
    "",
    "Respond with JSON only using this shape:",
    '{"decision":"approve-for-human-review"|"request-changes"|"escalate","summary":"...","findings":["..."],"missingCoverage":["..."],"followUps":["..."]}',
  ].join("\n");
}

function parseVerificationReport(text: string): VerificationReport {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate =
    fenced?.[1] ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  const parsed = JSON.parse(candidate) as VerificationReport;
  if (
    parsed.decision !== "approve-for-human-review" &&
    parsed.decision !== "request-changes" &&
    parsed.decision !== "escalate"
  ) {
    throw new Error("Verifier response is missing a valid decision");
  }
  return {
    decision: parsed.decision,
    summary: typeof parsed.summary === "string" ? parsed.summary : "Verifier returned no summary.",
    findings: Array.isArray(parsed.findings) ? parsed.findings.map(String) : [],
    missingCoverage: Array.isArray(parsed.missingCoverage)
      ? parsed.missingCoverage.map(String)
      : [],
    followUps: Array.isArray(parsed.followUps) ? parsed.followUps.map(String) : [],
  };
}

async function writePromptArtifact(
  workspaceDir: string,
  filename: string,
  body: string,
): Promise<void> {
  const artifactDir = path.join(workspaceDir, ".openclawcode");
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, filename), `${body}\n`, "utf8");
}

async function autoCommitChanges(
  workspaceDir: string,
  shellRunner: ShellRunner,
  message: string,
): Promise<void> {
  const status = await shellRunner.run({
    cwd: workspaceDir,
    command: "git status --porcelain",
  });
  if (status.code !== 0) {
    throw new Error(status.stderr || "Failed to inspect git status");
  }
  if (!status.stdout.trim()) {
    return;
  }

  const add = await shellRunner.run({
    cwd: workspaceDir,
    command: "git add -A",
  });
  if (add.code !== 0) {
    throw new Error(add.stderr || "Failed to stage changes");
  }

  const commit = await shellRunner.run({
    cwd: workspaceDir,
    command: `git commit -m ${JSON.stringify(message)}`,
  });
  if (commit.code !== 0) {
    throw new Error(commit.stderr || "Failed to commit changes");
  }
}

export class AgentBackedBuilder implements Builder {
  constructor(
    private readonly options: AgentBackedBuilderOptions & {
      collectChangedFiles: (run: WorkflowRun) => Promise<string[]>;
    },
  ) {}

  async build(run: WorkflowRun): Promise<BuildResult> {
    if (!run.workspace) {
      throw new Error("Workflow workspace is required before build execution.");
    }

    const prompt = buildBuilderPrompt(run, this.options.testCommands);
    await writePromptArtifact(run.workspace.worktreePath, "builder-prompt.md", prompt);

    const result = await this.options.agentRunner.run({
      prompt,
      workspaceDir: run.workspace.worktreePath,
      agentId: this.options.agentId,
    });

    const testResults: string[] = [];
    for (const command of this.options.testCommands) {
      const outcome = await this.options.shellRunner.run({
        cwd: run.workspace.worktreePath,
        command,
      });
      if (outcome.code !== 0) {
        throw new Error(
          [`Test command failed: ${command}`, outcome.stdout.trim(), outcome.stderr.trim()]
            .filter(Boolean)
            .join("\n"),
        );
      }
      testResults.push(`PASS ${command}`);
    }

    if (this.options.autoCommit !== false) {
      await autoCommitChanges(
        run.workspace.worktreePath,
        this.options.shellRunner,
        `feat: implement issue #${run.issue.number}`,
      );
    }

    const changedFiles = await this.options.collectChangedFiles(run);
    return {
      branchName: run.workspace.branchName,
      summary:
        result.text || `Implemented issue #${run.issue.number} in ${run.workspace.worktreePath}.`,
      changedFiles,
      testCommands: [...this.options.testCommands],
      testResults,
      notes: [`Workspace: ${run.workspace.worktreePath}`],
    };
  }
}

export class AgentBackedVerifier implements Verifier {
  constructor(private readonly options: AgentBackedVerifierOptions) {}

  async verify(run: WorkflowRun): Promise<VerificationReport> {
    if (!run.workspace) {
      throw new Error("Workflow workspace is required before verification.");
    }

    const prompt = buildVerifierPrompt(run);
    await writePromptArtifact(run.workspace.worktreePath, "verifier-prompt.md", prompt);
    const result = await this.options.agentRunner.run({
      prompt,
      workspaceDir: run.workspace.worktreePath,
      agentId: this.options.agentId,
    });
    return parseVerificationReport(result.text);
  }
}

export const __testing = {
  buildBuilderPrompt,
  buildVerifierPrompt,
};
