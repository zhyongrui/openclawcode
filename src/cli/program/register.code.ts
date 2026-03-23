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
  openclawCodeIssueMaterializeCommand,
  openclawCodeIssueMaterializationShowCommand,
  openclawCodeListValidationIssuesCommand,
  openclawCodeNextWorkShowCommand,
  openclawCodeAutonomousLoopRunCommand,
  openclawCodeAutonomousLoopShowCommand,
  openclawCodeCapabilityMapShowCommand,
  openclawCodeOperatorProgramInitCommand,
  openclawCodeOperatorProgramShowCommand,
  openclawCodeOperatorStatusSnapshotShowCommand,
  openclawCodePolicyShowCommand,
  openclawCodePromotionGateRefreshCommand,
  openclawCodePromotionGateShowCommand,
  openclawCodePromotionReceiptRecordCommand,
  openclawCodePromotionReceiptShowCommand,
  openclawCodeProjectProgressShowCommand,
  openclawCodeRuntimeSteeringSetCommand,
  openclawCodeRuntimeSteeringShowCommand,
  openclawCodeRuntimeSteeringStageIds,
  openclawCodeRoleRoutingRefreshCommand,
  openclawCodeRoleRoutingShowCommand,
  openclawCodeReconcileValidationIssuesCommand,
  openclawCodeRepoPlanCommand,
  openclawCodeRerouteRunCommand,
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
    'openclaw code repo-plan --project "Shared image gallery for iOS and web"',
    "Suggest a few GitHub repo names for a new project before bootstrap.",
  ],
  [
    "openclaw code repo-plan --existing --limit 5 --json",
    "List a few recent accessible repos when the user wants to point openclawcode at an existing repository.",
  ],
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
    "openclaw code next-work-show --json",
    "Explain the next blueprint-backed work item to execute or why the system is blocked.",
  ],
  [
    "openclaw code reroute-run --issue 123 --coder-agent codex-alt --json",
    "Reroute a queued, failed, or paused operator-managed run onto a different coder/verifier agent.",
  ],
  [
    "openclaw code issue-materialize --json",
    "Create or reuse the GitHub issue for the selected blueprint-backed work item.",
  ],
  [
    "openclaw code project-progress-show --json",
    "Summarize blueprint-aware project progress and operator queue state.",
  ],
  [
    "openclaw code autonomous-loop-run --once --json",
    "Run one autonomous progress iteration and persist its result.",
  ],
  [
    "openclaw code runtime-steering-show --json",
    "Inspect the repo-local per-stage runtime steering overrides.",
  ],
  [
    "openclaw code runtime-steering-set --stage building --agent codex-alt --json",
    "Steer one workflow stage onto an explicit runtime agent before the next run.",
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
    "openclaw code capability-map-show --json",
    "Inspect the stable command/capability map across chat, CLI, artifacts, and runtime roles.",
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
    "openclaw code run --issue 123 --require-plan-approval --json",
    "Stop after planning and emit the current plan digest for explicit approval before code execution.",
  ],
  [
    "openclaw code run --issue 123 --plan-edit-file .openclawcode/plan-edit.json --require-plan-approval --json",
    "Apply a repo-local plan edit patch before code execution, then emit the new digest for approval.",
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
    .command("repo-plan")
    .description(
      "Suggest or create a GitHub repository for a new project, or list recent existing repos before bootstrap",
    )
    .option("--owner <owner>", "GitHub owner to use; defaults to the authenticated viewer")
    .option("--project <text>", "Project description used to derive new repo name suggestions")
    .option("--repo <name>", "Explicit repository name to suggest or create")
    .option("--existing", "List recent accessible repositories instead of generating new names", false)
    .option("--create", "Create the selected repository on GitHub", false)
    .option("--visibility <visibility>", "Repository visibility (public, private)", "private")
    .option("--description <text>", "Repository description to use when creating a repo")
    .option("--limit <n>", "Number of suggestions or existing repos to show", "5")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRepoPlanCommand(
          {
            owner: opts.owner as string | undefined,
            project: opts.project as string | undefined,
            repo: opts.repo as string | undefined,
            existing: Boolean(opts.existing),
            create: Boolean(opts.create),
            visibility: opts.visibility as "public" | "private",
            description: opts.description as string | undefined,
            limit: Number.parseInt(opts.limit as string, 10),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
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
    .option(
      "--chat-target <target>",
      "Chat target identifier to persist for notifications, or 'auto' to reuse a unique saved binding",
    )
    .option(
      "--webhook-url <url>",
      "Explicit public webhook base URL or full route URL; when omitted bootstrap tries to discover a running tunnel URL",
    )
    .option("--base-branch <branch>", "Base branch for issue work")
    .option("--builder-agent <id>", "Builder agent id to persist in repo config")
    .option("--verifier-agent <id>", "Verifier agent id to persist in repo config")
    .option("--test <command>", "Test command to persist in repo config", collectOption, [])
    .option("--no-configure-webhook", "Skip GitHub webhook create/reuse during bootstrap")
    .option("--no-start-gateway", "Do not try to start the local gateway after writing config")
    .option(
      "--no-start-tunnel",
      "Do not try to start the managed webhook tunnel when bootstrap cannot discover a public URL",
    )
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
            webhookUrl: opts.webhookUrl as string | undefined,
            baseBranch: opts.baseBranch as string | undefined,
            builderAgent: opts.builderAgent as string | undefined,
            verifierAgent: opts.verifierAgent as string | undefined,
            test: (opts.test as string[] | undefined) ?? [],
            configureWebhook: Boolean(opts.configureWebhook),
            startGateway: Boolean(opts.startGateway),
            startTunnel: Boolean(opts.startTunnel),
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
    .command("next-work-show")
    .description("Show the current next-work decision for blueprint-backed execution")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeNextWorkShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("issue-materialize")
    .description("Create or reuse the GitHub issue for the selected blueprint-backed work item")
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeIssueMaterializeCommand(
          {
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("issue-materialization-show")
    .description("Show the current issue-materialization artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeIssueMaterializationShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("operator-program-init")
    .description("Create the repo-local operator program artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--title <text>", "Operator program title")
    .option("--summary <text>", "Operator program summary")
    .option("--force", "Overwrite an existing operator program artifact", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeOperatorProgramInitCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            title: opts.title as string | undefined,
            summary: opts.summary as string | undefined,
            force: Boolean(opts.force),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("operator-program-show")
    .description("Show the current repo-local operator program artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeOperatorProgramShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("project-progress-show")
    .description("Show the current blueprint-aware project progress artifact")
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--state-dir <dir>", "Operator state directory")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeProjectProgressShowCommand(
          {
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            stateDir: opts.stateDir as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("autonomous-loop-run")
    .description("Run one or more supervised autonomous blueprint-backed progress iterations")
    .option("--owner <owner>", "GitHub repository owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--state-dir <dir>", "Operator state directory")
    .option("--once", "Run a single iteration", false)
    .option("--iterations <count>", "Run up to this many supervised iterations", "1")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeAutonomousLoopRunCommand(
          {
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            stateDir: opts.stateDir as string | undefined,
            once: Boolean(opts.once),
            iterations: Number.parseInt(String(opts.iterations ?? "1"), 10),
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("autonomous-loop-show")
    .description("Show the current autonomous-loop artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeAutonomousLoopShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("runtime-steering-show")
    .description("Show the current repo-local per-stage runtime steering artifact")
    .option("--repo-root <dir>", "Local repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRuntimeSteeringShowCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  code
    .command("runtime-steering-set")
    .description("Persist a repo-local per-stage runtime steering override")
    .requiredOption(
      "--stage <stage>",
      `Workflow stage (${openclawCodeRuntimeSteeringStageIds().join(", ")})`,
    )
    .option("--repo-root <dir>", "Local repository root")
    .option("--adapter <id>", "Preferred adapter id for the stage")
    .option("--agent <id>", "Explicit agent id for the stage")
    .option("--actor <text>", "Actor recording the override")
    .option("--note <text>", "Override note")
    .option("--clear", "Clear the override for the stage", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRuntimeSteeringSetCommand(
          {
            repoRoot: opts.repoRoot as string | undefined,
            stage: opts.stage as string,
            adapter: opts.adapter as string | undefined,
            agent: opts.agent as string | undefined,
            actor: opts.actor as string | undefined,
            note: opts.note as string | undefined,
            clear: Boolean(opts.clear),
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
    .command("capability-map-show")
    .description("Show the stable command/capability map for openclawcode")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeCapabilityMapShowCommand(
          {
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
    .option(
      "--plan-edit-file <path>",
      "JSON file containing top-level ExecutionSpec overrides to apply before code execution",
    )
    .option("--plan-edit-actor <actor>", "Actor recording the plan edit")
    .option("--plan-edit-note <text>", "Optional note recorded with the plan edit")
    .option(
      "--require-plan-approval",
      "Pause after planning until the current plan digest is explicitly approved",
      false,
    )
    .option(
      "--approve-plan-digest <digest>",
      "Approve the exact current plan digest and continue into workspace/build if it still matches",
    )
    .option("--plan-approval-actor <actor>", "Actor recording an approved plan digest")
    .option("--plan-approval-note <text>", "Optional note recorded with the approved plan digest")
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
            planEditFile: opts.planEditFile as string | undefined,
            planEditActor: opts.planEditActor as string | undefined,
            planEditNote: opts.planEditNote as string | undefined,
            requirePlanApproval: Boolean(opts.requirePlanApproval),
            approvePlanDigest: opts.approvePlanDigest as string | undefined,
            planApprovalActor: opts.planApprovalActor as string | undefined,
            planApprovalNote: opts.planApprovalNote as string | undefined,
            rerunPriorRunId: opts.rerunPriorRunId as string | undefined,
            rerunPriorStage: opts.rerunPriorStage as
              | "intake"
              | "planning"
              | "awaiting-plan-approval"
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
    .command("reroute-run")
    .description(
      "Change the coder/verifier runtime for a queued run or queue a reroute rerun from a failed or paused snapshot",
    )
    .requiredOption("--issue <number>", "GitHub issue number")
    .option("--owner <owner>", "GitHub owner")
    .option("--repo <repo>", "GitHub repository name")
    .option("--repo-root <dir>", "Local repository root")
    .option("--state-dir <dir>", "Override OPENCLAW_STATE_DIR for operator-managed state")
    .option("--coder-agent <id>", "Replacement coder agent id")
    .option("--verifier-agent <id>", "Replacement verifier agent id")
    .option("--actor <actor>", "Actor recording the reroute request")
    .option("--note <text>", "Optional note recorded in the reroute request")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await openclawCodeRerouteRunCommand(
          {
            issue: opts.issue as string,
            owner: opts.owner as string | undefined,
            repo: opts.repo as string | undefined,
            repoRoot: opts.repoRoot as string | undefined,
            stateDir: opts.stateDir as string | undefined,
            coderAgent: opts.coderAgent as string | undefined,
            verifierAgent: opts.verifierAgent as string | undefined,
            actor: opts.actor as string | undefined,
            note: opts.note as string | undefined,
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
