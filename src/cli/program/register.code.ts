import type { Command } from "commander";
import {
  openclawCodeBootstrapCommand,
  openclawCodeBlueprintClarifyCommand,
  openclawCodeBlueprintDecomposeCommand,
  openclawCodeBlueprintInitCommand,
  openclawCodeBlueprintRoleIds,
  openclawCodeBlueprintSectionIds,
  openclawCodeBlueprintSetSectionCommand,
  openclawCodeBlueprintSetProviderRoleCommand,
  openclawCodeBlueprintSetStatusCommand,
  openclawCodeBlueprintShowCommand,
  openclawCodeBlueprintStatusIds,
  openclawCodeDiscoverWorkItemsCommand,
  openclawCodeListValidationIssuesCommand,
  openclawCodeOperatorStatusSnapshotShowCommand,
  openclawCodePolicyShowCommand,
  openclawCodePromotionGateRefreshCommand,
  openclawCodePromotionGateShowCommand,
  openclawCodePromotionReceiptRecordCommand,
  openclawCodePromotionReceiptShowCommand,
  openclawCodeRoleRoutingRefreshCommand,
  openclawCodeRoleRoutingShowCommand,
  openclawCodeReconcileValidationIssuesCommand,
  openclawCodeRollbackReceiptRecordCommand,
  openclawCodeRollbackReceiptShowCommand,
  openclawCodeRollbackSuggestionRefreshCommand,
  openclawCodeRollbackSuggestionShowCommand,
  openclawCodeRunCommand,
  openclawCodeSeedValidationIssueCommand,
  openclawCodeSeedValidationIssueTemplateIds,
  openclawCodeStageGatesDecideCommand,
  openclawCodeStageGatesRefreshCommand,
  openclawCodeStageGatesShowCommand,
  openclawCodeStageGateDecisionIds,
  openclawCodeStageGateIds,
  openclawCodeWorkItemsShowCommand,
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
    .description("Run issue-driven and blueprint-first coding workflows")
    .addHelpText(
      "after",
      () =>
        `
${theme.heading("Examples:")}
${formatHelpExamples([
  [
    "openclaw code bootstrap --repo owner/repo --json",
    "Clone or attach a target repo, persist operator config, seed blueprint artifacts, and run readiness checks.",
  ],
  [
    'openclaw code blueprint-init --title "OpenClawCode Blueprint" --goal "Ship blueprint-first autonomous development"',
    "Create the fixed repo-local project blueprint scaffold.",
  ],
  [
    "openclaw code blueprint-show --json",
    "Inspect the current project blueprint state in machine-readable form.",
  ],
  [
    "openclaw code blueprint-clarify --json",
    "Ask the repo-local blueprint what still needs clarification before work decomposition.",
  ],
  [
    "openclaw code blueprint-set-status --status agreed",
    "Record the explicit blueprint agreement checkpoint.",
  ],
  [
    'openclaw code blueprint-set-provider-role --role coder --provider "Codex" --json',
    "Update one provider role in the blueprint and refresh routing artifacts.",
  ],
  [
    'openclaw code blueprint-set-section --section goal --body "Clarify the repo-level objective before issue creation." --json',
    "Update one blueprint section without opening the markdown file manually.",
  ],
  [
    "openclaw code blueprint-decompose --json",
    "Derive and persist repo-local work items from the fixed project blueprint.",
  ],
  [
    "openclaw code work-items-show --json",
    "Inspect the latest persisted work-item inventory and stale-state signals.",
  ],
  [
    "openclaw code discover-work-items --json",
    "Run the first non-validation discovery pipeline and persist discovered work items.",
  ],
  [
    "openclaw code role-routing-refresh --json",
    "Persist the current provider-neutral role routing plan.",
  ],
  ["openclaw code role-routing-show --json", "Inspect the latest persisted role-routing artifact."],
  [
    "openclaw code stage-gates-refresh --json",
    "Persist the current stage-gate artifact for blueprint-backed execution.",
  ],
  [
    "openclaw code promotion-gate-refresh --json",
    "Persist the current promotion-readiness artifact for release and sync decisions.",
  ],
  [
    "openclaw code rollback-suggestion-refresh --json",
    "Persist the current rollback-target artifact for release and sync decisions.",
  ],
  [
    'openclaw code promotion-receipt-record --actor operator --note "Promoted refreshed sync branch onto main" --json',
    "Persist a machine-readable promotion receipt after a successful promotion.",
  ],
  [
    'openclaw code rollback-receipt-record --actor operator --note "Rolled the operator back to the last known-good baseline" --json',
    "Persist a machine-readable rollback receipt after a rollback.",
  ],
  [
    "openclaw code operator-status-snapshot-show --json",
    "Inspect the stable machine-readable operator state snapshot behind chat-visible status.",
  ],
  [
    "openclaw code policy-show --json",
    "Inspect the stable machine-readable suitability, guardrail, and provider-pause policy surface.",
  ],
  [
    'openclaw code stage-gates-decide --gate execution-start --decision approved --note "Proceed with autonomous execution" --json',
    "Record a structured human decision for a stage gate.",
  ],
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
    "openclaw code seed-validation-issue --balanced --dry-run --json",
    "Preview the minimum balanced validation pool without creating GitHub issues.",
  ],
  [
    "openclaw code list-validation-issues --json",
    "Inspect the current validation-pool inventory for the current repo.",
  ],
  [
    "openclaw code reconcile-validation-issues --close-implemented --enforce-minimum-pool-size --json",
    "Close already-implemented validation issues and replenish any missing minimum-pool entries.",
  ],
])}

${theme.muted("Docs:")} ${formatDocsLink("/cli/code", "docs.openclaw.ai/cli/code")}`,
    )
    .action(() => {
      code.help({ error: true });
    });

  code
    .command("bootstrap")
    .description(
      "Bootstrap a target repository into the local openclawcode operator with minimal manual setup",
    )
    .requiredOption("--repo <owner/repo>", "GitHub repo to bootstrap")
    .option("--repo-root <dir>", "Target repository checkout path")
    .option("--state-dir <dir>", "Operator state directory")
    .option("--mode <mode>", "Bootstrap mode (auto, cli-only, chatops)", "auto")
    .option("--channel <channel>", "Chat channel to bind immediately, such as feishu")
    .option("--chat-target <target>", "Chat target identifier to persist for notifications")
    .option("--base-branch <branch>", "Base branch for issue work")
    .option("--builder-agent <id>", "Builder agent id to persist in repo config")
    .option("--verifier-agent <id>", "Verifier agent id to persist in repo config")
    .option("--test <command>", "Test command to persist in repo config", collectOption, [])
    .option("--no-start-gateway", "Do not try to start the local gateway after writing config")
    .option("--no-probe-built-startup", "Skip the isolated built-startup proof during setup-check")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBootstrapCommand(
          {
            repo: opts.repo as string,
            repoRoot: opts.repoRoot as string | undefined,
            stateDir: opts.stateDir as string | undefined,
            mode: opts.mode as "auto" | "cli-only" | "chatops",
            channel: opts.channel as string | undefined,
            chatTarget: opts.chatTarget as string | undefined,
            baseBranch: opts.baseBranch as string | undefined,
            builderAgent: opts.builderAgent as string | undefined,
            verifierAgent: opts.verifierAgent as string | undefined,
            test: (opts.test as string[] | undefined) ?? [],
            startGateway: Boolean(opts.startGateway),
            probeBuiltStartup: Boolean(opts.probeBuiltStartup),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-init")
    .description("Create the fixed project blueprint scaffold in the current repo")
    .option("--repo-root <dir>", "Local repository root")
    .option("--title <text>", "Blueprint title")
    .option("--goal <text>", "Initial goal summary for the blueprint")
    .option("--force", "Overwrite an existing blueprint scaffold", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintInitCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            title: opts.title as string | undefined,
            goal: opts.goal as string | undefined,
            force: Boolean(opts.force),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-show")
    .description("Show the current fixed project blueprint state")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-clarify")
    .description("Report clarification questions and suggestions for the current blueprint")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintClarifyCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-set-status")
    .description("Update the fixed project blueprint lifecycle status")
    .requiredOption(
      "--status <status>",
      `Blueprint status (${openclawCodeBlueprintStatusIds().join(", ")})`,
    )
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintSetStatusCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            status: opts.status as string,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-set-provider-role")
    .description("Update one provider role assignment in the fixed project blueprint")
    .requiredOption(
      "--role <role>",
      `Blueprint role (${openclawCodeBlueprintRoleIds().join(", ")})`,
    )
    .option("--provider <provider>", "Provider assignment text to persist in Provider Strategy")
    .option("--clear", "Clear the current provider assignment for this role", false)
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintSetProviderRoleCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            role: opts.role as string,
            provider: opts.provider as string | undefined,
            clear: Boolean(opts.clear),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-set-section")
    .description("Update one blueprint section and refresh clarification and gate artifacts")
    .requiredOption(
      "--section <section>",
      `Blueprint section (${openclawCodeBlueprintSectionIds().join(", ")})`,
    )
    .requiredOption("--body <text>", "Replacement text for the selected blueprint section")
    .option("--append", "Append the new text instead of replacing the section body", false)
    .option("--create-if-missing", "Create the blueprint scaffold if it does not exist", false)
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintSetSectionCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            section: opts.section as string,
            body: opts.body as string,
            append: Boolean(opts.append),
            createIfMissing: Boolean(opts.createIfMissing),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("blueprint-decompose")
    .description("Derive and persist work items from the current fixed project blueprint")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeBlueprintDecomposeCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("work-items-show")
    .description("Show the current repo-local work-item inventory artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeWorkItemsShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("discover-work-items")
    .description("Run repo-local discovery and persist discovered work items")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeDiscoverWorkItemsCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("role-routing-refresh")
    .description("Persist the current provider-neutral role routing plan")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRoleRoutingRefreshCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("role-routing-show")
    .description("Show the current provider-neutral role routing artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRoleRoutingShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("stage-gates-refresh")
    .description("Persist the current repo-local stage-gate artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeStageGatesRefreshCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("stage-gates-show")
    .description("Show the current repo-local stage-gate artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeStageGatesShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("stage-gates-decide")
    .description("Record a structured human decision for a repo-local stage gate")
    .requiredOption("--gate <gate>", `Stage gate (${openclawCodeStageGateIds().join(", ")})`)
    .requiredOption(
      "--decision <decision>",
      `Decision (${openclawCodeStageGateDecisionIds().join(", ")})`,
    )
    .option("--repo-root <dir>", "Local repository root")
    .option("--actor <text>", "Actor recording the decision")
    .option("--note <text>", "Decision note")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeStageGatesDecideCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            gate: opts.gate as string,
            decision: opts.decision as string,
            actor: opts.actor as string | undefined,
            note: opts.note as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("promotion-gate-refresh")
    .description("Persist the current promotion-readiness artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodePromotionGateRefreshCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("promotion-gate-show")
    .description("Show the latest persisted promotion-readiness artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodePromotionGateShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("rollback-suggestion-refresh")
    .description("Persist the current rollback-target suggestion artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRollbackSuggestionRefreshCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("rollback-suggestion-show")
    .description("Show the latest persisted rollback-target suggestion artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRollbackSuggestionShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("promotion-receipt-record")
    .description("Persist a machine-readable receipt after a successful promotion")
    .option("--repo-root <dir>", "Local repository root")
    .option("--actor <text>", "Actor recording the receipt")
    .option("--note <text>", "Promotion note")
    .option("--promoted-branch <branch>", "Explicit promoted branch")
    .option("--promoted-commit <sha>", "Explicit promoted commit SHA")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodePromotionReceiptRecordCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            actor: opts.actor as string | undefined,
            note: opts.note as string | undefined,
            promotedBranch: opts.promotedBranch as string | undefined,
            promotedCommitSha: opts.promotedCommit as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("promotion-receipt-show")
    .description("Show the latest persisted promotion receipt")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodePromotionReceiptShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("rollback-receipt-record")
    .description("Persist a machine-readable receipt after a rollback")
    .option("--repo-root <dir>", "Local repository root")
    .option("--actor <text>", "Actor recording the receipt")
    .option("--note <text>", "Rollback note")
    .option("--restored-branch <branch>", "Explicit restored branch")
    .option("--restored-commit <sha>", "Explicit restored commit SHA")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRollbackReceiptRecordCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            actor: opts.actor as string | undefined,
            note: opts.note as string | undefined,
            restoredBranch: opts.restoredBranch as string | undefined,
            restoredCommitSha: opts.restoredCommit as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("rollback-receipt-show")
    .description("Show the latest persisted rollback receipt")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRollbackReceiptShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("operator-status-snapshot-show")
    .description("Show the stable machine-readable operator state snapshot")
    .option(
      "--state-dir <dir>",
      "OpenClaw state dir (defaults to OPENCLAW_STATE_DIR or ~/.openclaw)",
    )
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeOperatorStatusSnapshotShowCommand(
          {
            stateDir: opts.stateDir as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("policy-show")
    .description("Show the stable machine-readable openclawcode policy surface")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodePolicyShowCommand(
          {
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
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
    .option("--rerun-coder-agent <id>", "Requested coder agent id for this rerun")
    .option("--rerun-verifier-agent <id>", "Requested verifier agent id for this rerun")
    .option(
      "--suitability-override-actor <actor>",
      "Actor recording a structured suitability override",
    )
    .option("--suitability-override-reason <text>", "Reason for a structured suitability override")
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
            rerunRequestedCoderAgentId: opts.rerunCoderAgent as string | undefined,
            rerunRequestedVerifierAgentId: opts.rerunVerifierAgent as string | undefined,
            suitabilityOverrideActor: opts.suitabilityOverrideActor as string | undefined,
            suitabilityOverrideReason: opts.suitabilityOverrideReason as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("seed-validation-issue")
    .description("Create or preview a repository-local validation issue for openclawcode")
    .option(
      "--template <id>",
      `Template id (${openclawCodeSeedValidationIssueTemplateIds().join(", ")})`,
    )
    .option(
      "--balanced",
      "Seed or preview the balanced validation pool using the minimum-pool policy",
      false,
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
            balanced: Boolean(opts.balanced),
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

  code
    .command("reconcile-validation-issues")
    .description("Close already-implemented validation issues and summarize the next pool action")
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option(
      "--close-implemented",
      "Close command-layer validation issues already satisfied by the repo",
      false,
    )
    .option(
      "--enforce-minimum-pool-size",
      "Seed the balanced minimum validation pool after reconciliation if any class is below policy",
      false,
    )
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeReconcileValidationIssuesCommand(
          {
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            closeImplemented: Boolean(opts.closeImplemented),
            enforceMinimumPoolSize: Boolean(opts.enforceMinimumPoolSize),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });
}
