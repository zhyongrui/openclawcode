import fs from "node:fs/promises";
import path from "node:path";
import type { BuildResult, VerificationReport, WorkflowRun } from "../contracts/index.js";
import type { AgentRunner, ShellRunner } from "../runtime/index.js";
import type { Builder, Verifier } from "./interfaces.js";
import { buildScopeGuardrail, checkBuildScope } from "./scope.js";

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

const EXPLICIT_PATH_HINT_EXTENSIONS = /\.(?:md|ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|sh)$/i;

const KEYWORD_PATH_HINTS: Array<{ matches: string[]; path: string }> = [
  {
    matches: ["plugin integration", "/occode-sync"],
    path: "docs/openclawcode/openclaw-plugin-integration.md",
  },
];

function collectIssueText(run: WorkflowRun): string[] {
  return [
    run.issue.title,
    run.issue.body ?? "",
    run.executionSpec?.summary ?? "",
    ...(run.executionSpec?.scope ?? []),
    ...(run.executionSpec?.acceptanceCriteria.map((entry) => entry.text) ?? []),
  ];
}

function collectExplicitPathHints(run: WorkflowRun): string[] {
  const hints: string[] = [];
  for (const segment of collectIssueText(run)) {
    for (const match of segment.matchAll(/`([^`\n]+)`/g)) {
      const candidate = match[1]?.trim();
      if (!candidate) {
        continue;
      }
      const normalized = candidate.replace(/\\/g, "/").replace(/^\.\//, "");
      if (
        normalized.includes("/") &&
        (normalized.endsWith("/") || EXPLICIT_PATH_HINT_EXTENSIONS.test(normalized))
      ) {
        hints.push(normalized);
      }
    }
  }
  return hints;
}

function collectKeywordPathHints(run: WorkflowRun): string[] {
  const issueText = collectIssueText(run).join("\n").toLowerCase();
  return KEYWORD_PATH_HINTS.filter((hint) =>
    hint.matches.every((term) => issueText.includes(term)),
  ).map((hint) => hint.path);
}

function buildRelevantPathHints(run: WorkflowRun): string[] {
  const hints = [
    "src/openclawcode/app/run-issue.ts",
    "src/openclawcode/contracts/types.ts",
    "src/openclawcode/testing/run-issue.test.ts",
    "src/openclawcode/testing/orchestrator.test.ts",
    "src/openclawcode/orchestrator/run.ts",
  ];
  const guardrail = buildScopeGuardrail(run);

  return Array.from(
    new Set([
      ...collectExplicitPathHints(run),
      ...collectKeywordPathHints(run),
      ...guardrail.preferredPaths,
      ...hints,
    ]),
  );
}

function buildBuilderPrompt(run: WorkflowRun, testCommands: string[]): string {
  const workspaceRoot = run.workspace?.worktreePath ?? "unknown";
  const guardrail = buildScopeGuardrail(run);
  const postBuildTestLine =
    testCommands.length > 0
      ? `- The workflow host will run these final validation commands after you finish: ${testCommands.join("; ")}`
      : "- Prepare the code so post-build tests can run.";
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
    "- Use the issue classification and file hints below to keep the change set narrow.",
    "- Avoid broad scans such as `rg ... .` unless narrower paths were insufficient.",
    "- Add or update tests when needed.",
    "- Do not run the full final validation command inside the agent sandbox unless absolutely necessary; prefer lightweight, issue-specific checks.",
    "- Do not run package-manager or formatter commands inside the agent sandbox (for example `pnpm`, `npm`, `yarn`, or `prettier`); use file-local sanity checks instead and leave validation to the workflow host.",
    ...guardrail.notes.map((entry) => `- ${entry}`),
    "- Keep changes scoped to the issue.",
    "- Do not ask for clarification unless the issue is impossible to implement safely.",
    "",
    "Issue Classification:",
    `- ${guardrail.classification}`,
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
    "Recorded Issue Classification:",
    `- ${run.buildResult?.issueClassification ?? "No issue classification recorded."}`,
    "",
    "Recorded Scope Check:",
    `- ${run.buildResult?.scopeCheck?.summary ?? "No scope-check summary recorded."}`,
    ...(run.buildResult?.scopeCheck?.blockedFiles.length
      ? [
          "- Blocked files:",
          ...run.buildResult.scopeCheck.blockedFiles.map((entry) => `  - ${entry}`),
        ]
      : []),
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
  changedFiles: string[],
): Promise<void> {
  if (changedFiles.length === 0) {
    return;
  }

  const pathArgs = changedFiles.map((entry) => JSON.stringify(entry)).join(" ");
  const status = await shellRunner.run({
    cwd: workspaceDir,
    command: `git status --porcelain -- ${pathArgs}`,
  });
  if (status.code !== 0) {
    throw new Error(status.stderr || "Failed to inspect git status");
  }
  if (!status.stdout.trim()) {
    return;
  }

  const add = await shellRunner.run({
    cwd: workspaceDir,
    command: `git add -A -- ${pathArgs}`,
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

async function readTrackedFileSizeFromHead(
  workspaceDir: string,
  shellRunner: ShellRunner,
  relativePath: string,
): Promise<number | null> {
  const result = await shellRunner.run({
    cwd: workspaceDir,
    command: `git ls-tree -l HEAD -- ${JSON.stringify(relativePath)}`,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to inspect tracked file size for ${relativePath}`);
  }

  const line = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) {
    return null;
  }

  const fields = line.split(/\s+/);
  const size = Number.parseInt(fields[3] ?? "", 10);
  return Number.isFinite(size) ? size : null;
}

async function findUnexpectedlyEmptyTrackedFiles(
  workspaceDir: string,
  shellRunner: ShellRunner,
  changedFiles: string[],
): Promise<string[]> {
  const offenders: string[] = [];

  for (const relativePath of changedFiles) {
    const absolutePath = path.join(workspaceDir, relativePath);
    const stat = await fs
      .stat(absolutePath)
      .catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? null : Promise.reject(error),
      );
    if (!stat?.isFile() || stat.size > 0) {
      continue;
    }

    const trackedSize = await readTrackedFileSizeFromHead(workspaceDir, shellRunner, relativePath);
    if (trackedSize != null && trackedSize > 0) {
      offenders.push(relativePath);
    }
  }

  return offenders;
}

function formatUnexpectedEmptyTrackedFilesError(paths: string[]): string {
  return [
    "Builder workspace integrity check failed: existing tracked file(s) became empty in the isolated worktree.",
    `Files: ${paths.join(", ")}`,
    "This usually indicates agent path drift or a broken file-edit bridge.",
  ].join(" ");
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

    const changedFiles = await this.options.collectChangedFiles(run);
    const unexpectedlyEmptyTrackedFiles = await findUnexpectedlyEmptyTrackedFiles(
      run.workspace.worktreePath,
      this.options.shellRunner,
      changedFiles,
    );
    if (unexpectedlyEmptyTrackedFiles.length > 0) {
      throw new Error(formatUnexpectedEmptyTrackedFilesError(unexpectedlyEmptyTrackedFiles));
    }

    const scopeCheck = checkBuildScope(run, changedFiles);
    if (!scopeCheck.ok) {
      throw new Error(scopeCheck.summary);
    }

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
        changedFiles,
      );
    }

    return {
      branchName: run.workspace.branchName,
      summary:
        result.text || `Implemented issue #${run.issue.number} in ${run.workspace.worktreePath}.`,
      changedFiles,
      issueClassification: scopeCheck.classification,
      scopeCheck: {
        ok: scopeCheck.ok,
        blockedFiles: [...scopeCheck.blockedFiles],
        summary: scopeCheck.summary,
      },
      testCommands: [...this.options.testCommands],
      testResults,
      notes: [
        `Workspace: ${run.workspace.worktreePath}`,
        `Issue classification: ${scopeCheck.classification}`,
        scopeCheck.summary,
      ],
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
