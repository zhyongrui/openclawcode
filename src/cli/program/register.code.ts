import type { Command } from "commander";
import {
  openclawCodeListValidationIssuesCommand,
  openclawCodeRunCommand,
  openclawCodeSeedValidationIssueCommand,
  openclawCodeSeedValidationIssueTemplateIds,
} from "../../commands/openclawcode.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";
import { collectOption } from "./helpers.js";

export function registerCodeCommands(program: Command) {
  const code = program
    .command("code")
    .description("Run issue-driven coding workflows")
    .addHelpText(
      "after",
      () =>
        `
${theme.heading("Examples:")}
${formatHelpExamples([
  [
    "openclaw code run --issue 123",
    "Plan and run the workflow for issue #123 in the current repo.",
  ],
  [
    'openclaw code run --issue 123 --test "pnpm exec vitest run --config vitest.openclawcode.config.mjs --pool threads"',
    "Run a targeted test command after the builder edits code.",
  ],
  [
    "openclaw code run --issue 123 --open-pr",
    "Push the issue branch and open a draft PR after build.",
  ],
  [
    "openclaw code seed-validation-issue --template command-json-boolean --field-name verificationHasSignals --source-path verificationReport.followUps --dry-run",
    "Draft a low-risk validation issue without creating it on GitHub.",
  ],
  [
    "openclaw code list-validation-issues --json",
    "Inspect the current validation-pool inventory for the current repo.",
  ],
])}

${theme.muted("Docs:")} ${formatDocsLink("/cli/code", "docs.openclaw.ai/cli/code")}`,
    )
    .action(() => {
      code.help({ error: true });
    });

  code
    .command("run")
    .description("Execute the openclawcode workflow for a GitHub issue")
    .requiredOption("--issue <number>", "GitHub issue number")
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--state-dir <dir>", "State directory for run records and worktrees")
    .option("--base-branch <branch>", "Base branch for the run", "main")
    .option("--branch-name <branch>", "Explicit issue branch name")
    .option("--builder-agent <id>", "Agent id for the builder pass")
    .option("--verifier-agent <id>", "Agent id for the verifier pass")
    .option("--test <command>", "Repeatable test command to run after build", collectOption, [])
    .option("--open-pr", "Push the issue branch and open a draft PR", false)
    .option("--merge-on-approve", "Merge automatically after verifier approval", false)
    .option("--rerun-prior-run-id <id>", "Prior run id when this execution is an explicit rerun")
    .option(
      "--rerun-prior-stage <stage>",
      "Prior workflow stage when this execution is an explicit rerun",
    )
    .option("--rerun-reason <text>", "Human or review reason for rerunning the issue")
    .option("--rerun-requested-at <iso>", "ISO timestamp for when the rerun was requested")
    .option(
      "--rerun-review-decision <decision>",
      "Latest GitHub review decision for the rerun context",
    )
    .option("--rerun-review-submitted-at <iso>", "ISO timestamp for the latest GitHub review")
    .option("--rerun-review-summary <text>", "Latest GitHub review summary or body")
    .option("--rerun-review-url <url>", "URL for the latest GitHub review")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRunCommand(
          {
            issue: opts.issue as string,
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            stateDir: opts.stateDir as string | undefined,
            baseBranch: opts.baseBranch as string | undefined,
            branchName: opts.branchName as string | undefined,
            builderAgent: opts.builderAgent as string | undefined,
            verifierAgent: opts.verifierAgent as string | undefined,
            test: Array.isArray(opts.test) ? (opts.test as string[]) : [],
            openPr: Boolean(opts.openPr),
            mergeOnApprove: Boolean(opts.mergeOnApprove),
            rerunPriorRunId: opts.rerunPriorRunId as string | undefined,
            rerunPriorStage: opts.rerunPriorStage as
              | "intake"
              | "planning"
              | "building"
              | "draft-pr-opened"
              | "verifying"
              | "changes-requested"
              | "ready-for-human-review"
              | "completed-without-changes"
              | "merged"
              | "escalated"
              | "failed"
              | undefined,
            rerunReason: opts.rerunReason as string | undefined,
            rerunRequestedAt: opts.rerunRequestedAt as string | undefined,
            rerunReviewDecision: opts.rerunReviewDecision as
              | "approved"
              | "changes-requested"
              | undefined,
            rerunReviewSubmittedAt: opts.rerunReviewSubmittedAt as string | undefined,
            rerunReviewSummary: opts.rerunReviewSummary as string | undefined,
            rerunReviewUrl: opts.rerunReviewUrl as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("seed-validation-issue")
    .description("Create or preview a repository-local validation issue for openclawcode")
    .requiredOption(
      "--template <id>",
      `Template id (${openclawCodeSeedValidationIssueTemplateIds().join(", ")})`,
    )
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--field-name <name>", "Top-level JSON field name for command-json templates")
    .option("--source-path <path>", "Nested source path for command-json templates")
    .option("--doc-path <path>", "Docs path for operator-doc-note")
    .option("--summary <text>", "Summary for doc-note or high-risk validation templates")
    .option("--dry-run", "Render the seeded issue without creating it on GitHub", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeSeedValidationIssueCommand(
          {
            template: opts.template as ReturnType<
              typeof openclawCodeSeedValidationIssueTemplateIds
            >[number],
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            fieldName: opts.fieldName as string | undefined,
            sourcePath: opts.sourcePath as string | undefined,
            docPath: opts.docPath as string | undefined,
            summary: opts.summary as string | undefined,
            dryRun: Boolean(opts.dryRun),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("list-validation-issues")
    .description("List the current repository-local validation issue pool")
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--state <state>", "Issue state to query (open, closed, all)", "open")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeListValidationIssuesCommand(
          {
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            state: opts.state as "open" | "closed" | "all" | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });
}
