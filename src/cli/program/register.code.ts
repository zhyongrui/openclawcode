import type { Command } from "commander";
import { openclawCodeRunCommand } from "../../commands/openclawcode.js";
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
}
