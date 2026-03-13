import path from "node:path";
import type { WorkflowRerunContext, WorkflowRun } from "../openclawcode/index.js";
import {
  classifyValidationIssue,
  FileSystemWorkflowRunStore,
  buildValidationIssueDraft,
  GitHubPullRequestMerger,
  GitHubPullRequestPublisher,
  GitHubRestClient,
  GitWorktreeManager,
  HeuristicPlanner,
  HostShellRunner,
  listValidationIssueTemplates,
  OpenClawAgentRunner,
  AgentBackedBuilder,
  AgentBackedVerifier,
  resolveGitHubRepoFromGit,
  runIssueWorkflow,
  type ValidationIssueTemplateId,
} from "../openclawcode/index.js";
import type { RuntimeEnv } from "../runtime.js";

export interface OpenClawCodeRunOpts {
  issue: string;
  owner?: string;
  repo?: string;
  repoRoot?: string;
  stateDir?: string;
  baseBranch?: string;
  branchName?: string;
  builderAgent?: string;
  verifierAgent?: string;
  test?: string[];
  openPr?: boolean;
  mergeOnApprove?: boolean;
  rerunPriorRunId?: string;
  rerunPriorStage?: WorkflowRun["stage"];
  rerunReason?: string;
  rerunRequestedAt?: string;
  rerunReviewDecision?: "approved" | "changes-requested";
  rerunReviewSubmittedAt?: string;
  rerunReviewSummary?: string;
  rerunReviewUrl?: string;
  json?: boolean;
}

export interface OpenClawCodeSeedValidationIssueOpts {
  template: ValidationIssueTemplateId;
  owner?: string;
  repo?: string;
  repoRoot?: string;
  fieldName?: string;
  sourcePath?: string;
  docPath?: string;
  summary?: string;
  dryRun?: boolean;
  json?: boolean;
}

export interface OpenClawCodeListValidationIssuesOpts {
  owner?: string;
  repo?: string;
  repoRoot?: string;
  state?: "open" | "closed" | "all";
  json?: boolean;
}

export const OPENCLAWCODE_RUN_JSON_CONTRACT_VERSION = 1;
export const DEFAULT_OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS = 300;
export const DEFAULT_OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS = 180;

const OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS_ENV = "OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS";
const OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS_ENV = "OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS";

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--issue must be a positive integer");
  }
  return parsed;
}

function resolvePositiveTimeoutSeconds(params: { envName: string; fallback: number }): number {
  const raw = process.env[params.envName]?.trim();
  if (!raw) {
    return params.fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${params.envName} must be a positive integer when set.`);
  }
  return parsed;
}

async function resolveRepoRef(params: {
  owner?: string;
  repo?: string;
  repoRoot: string;
}): Promise<{ owner: string; repo: string }> {
  if (params.owner && params.repo) {
    return { owner: params.owner, repo: params.repo };
  }
  return await resolveGitHubRepoFromGit(params.repoRoot);
}

function resolveAutoMergePolicy(run: WorkflowRun): {
  autoMergePolicyEligible: boolean;
  autoMergePolicyReason: string;
} {
  if (run.stage !== "ready-for-human-review" && run.stage !== "merged") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason: "Not eligible for auto-merge: verification has not approved the run.",
    };
  }

  if (run.stage !== "merged" && run.verificationReport?.decision !== "approve-for-human-review") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason: "Not eligible for auto-merge: verification has not approved the run.",
    };
  }

  if (run.suitability?.decision !== "auto-run") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "Not eligible for auto-merge: suitability did not accept autonomous execution.",
    };
  }

  if (run.buildResult?.issueClassification !== "command-layer") {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason:
        "Not eligible for auto-merge: the run is not classified as command-layer.",
    };
  }

  if (run.buildResult.scopeCheck?.ok === false) {
    return {
      autoMergePolicyEligible: false,
      autoMergePolicyReason: "Not eligible for auto-merge: the scope check did not pass.",
    };
  }

  return {
    autoMergePolicyEligible: true,
    autoMergePolicyReason: "Eligible for auto-merge under the current command-layer policy.",
  };
}

function resolveAutoMergeDisposition(run: WorkflowRun): {
  autoMergeDisposition: "merged" | "skipped" | "failed" | null;
  autoMergeDispositionReason: string | null;
} {
  const note = [...(run.history ?? [])]
    .toReversed()
    .find(
      (entry) =>
        entry === "Pull request merged automatically" ||
        entry.startsWith("Auto-merge skipped:") ||
        entry.startsWith("Auto-merge failed:"),
    );

  if (note === "Pull request merged automatically") {
    return {
      autoMergeDisposition: "merged",
      autoMergeDispositionReason: note,
    };
  }

  if (note?.startsWith("Auto-merge skipped:")) {
    return {
      autoMergeDisposition: "skipped",
      autoMergeDispositionReason: note,
    };
  }

  if (note?.startsWith("Auto-merge failed:")) {
    return {
      autoMergeDisposition: "failed",
      autoMergeDispositionReason: note,
    };
  }

  return {
    autoMergeDisposition: null,
    autoMergeDispositionReason: null,
  };
}

function resolvePublishedPullRequest(run: WorkflowRun): {
  pullRequestPublished: boolean;
  publishedPullRequestNumber: number | null;
  publishedPullRequestOpenedAt: string | null;
} {
  // Workflow runs only persist one PR object. Once GitHub assigns a number or URL,
  // that same draft metadata becomes the published PR source of truth.
  const published = run.draftPullRequest?.number != null || run.draftPullRequest?.url != null;
  return {
    pullRequestPublished: published,
    publishedPullRequestNumber: published ? (run.draftPullRequest?.number ?? null) : null,
    publishedPullRequestOpenedAt: published ? (run.draftPullRequest?.openedAt ?? null) : null,
  };
}

function resolveDraftPullRequestDisposition(run: WorkflowRun): {
  draftPullRequestDisposition: "published" | "skipped" | null;
  draftPullRequestDispositionReason: string | null;
} {
  const history = run.history ?? [];
  const published = resolvePublishedPullRequest(run).pullRequestPublished;
  if (published) {
    const note =
      [...history]
        .toReversed()
        .find(
          (entry) =>
            entry.startsWith("Draft PR opened:") || entry.startsWith("Pull request opened:"),
        ) ?? "Draft PR published.";
    return {
      draftPullRequestDisposition: "published",
      draftPullRequestDispositionReason: note,
    };
  }

  const skippedNote = [...history]
    .toReversed()
    .find((entry) => entry.startsWith("Draft PR skipped:"));
  if (skippedNote) {
    return {
      draftPullRequestDisposition: "skipped",
      draftPullRequestDispositionReason: skippedNote,
    };
  }

  return {
    draftPullRequestDisposition: null,
    draftPullRequestDispositionReason: null,
  };
}

function resolveMergedPullRequest(run: WorkflowRun): {
  pullRequestMerged: boolean;
  mergedPullRequestMergedAt: string | null;
} {
  const merged = run.stage === "merged";
  return {
    pullRequestMerged: merged,
    mergedPullRequestMergedAt: merged ? run.updatedAt : null,
  };
}

function resolveChangeDisposition(run: WorkflowRun): {
  changeDisposition: "modified" | "no-op" | null;
  changeDispositionReason: string | null;
} {
  const history = run.history ?? [];
  if (!run.buildResult) {
    return {
      changeDisposition: null,
      changeDispositionReason: null,
    };
  }

  if (run.buildResult.changedFiles.length > 0) {
    return {
      changeDisposition: "modified",
      changeDispositionReason: `Run produced ${run.buildResult.changedFiles.length} changed file(s).`,
    };
  }

  const noOpNote = [...history].toReversed().find((entry) => entry.startsWith("Draft PR skipped:"));
  return {
    changeDisposition: "no-op",
    changeDispositionReason: noOpNote ?? "Run produced no changed files.",
  };
}

function formatWorkflowStageLabel(stage: WorkflowRun["stage"]): string {
  return stage
    .split("-")
    .map((segment) => {
      const upper = segment.toUpperCase();
      if (upper === "PR") {
        return upper;
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" ");
}

function resolveValidationIssueAgeDays(
  createdAt: string | undefined,
  now = Date.now(),
): number | null {
  if (!createdAt) {
    return null;
  }
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(((now - parsed) / 86_400_000) * 10) / 10;
}

function resolveRunSummary(run: WorkflowRun): string {
  if (run.verificationReport?.summary) {
    return run.verificationReport.summary;
  }

  if (run.buildResult?.summary) {
    return run.buildResult.summary;
  }

  return `Run is at the ${run.stage} stage.`;
}

function resolveVerificationApprovedForHumanReview(run: WorkflowRun): boolean | null {
  const decision = run.verificationReport?.decision;
  if (!decision) {
    return null;
  }

  return decision === "approve-for-human-review";
}

function resolveRerunContext(opts: OpenClawCodeRunOpts): WorkflowRerunContext | undefined {
  if (
    !opts.rerunReason &&
    !opts.rerunPriorRunId &&
    !opts.rerunPriorStage &&
    !opts.rerunReviewDecision &&
    !opts.rerunReviewSubmittedAt &&
    !opts.rerunReviewSummary &&
    !opts.rerunReviewUrl
  ) {
    return undefined;
  }

  return {
    reason: opts.rerunReason ?? "Manual rerun requested.",
    requestedAt: opts.rerunRequestedAt ?? new Date().toISOString(),
    priorRunId: opts.rerunPriorRunId,
    priorStage: opts.rerunPriorStage,
    reviewDecision: opts.rerunReviewDecision,
    reviewSubmittedAt: opts.rerunReviewSubmittedAt,
    reviewSummary: opts.rerunReviewSummary,
    reviewUrl: opts.rerunReviewUrl,
  };
}

function toWorkflowRunJson(run: WorkflowRun) {
  const autoMergePolicy = resolveAutoMergePolicy(run);
  const autoMergeDisposition = resolveAutoMergeDisposition(run);
  const publishedPullRequest = resolvePublishedPullRequest(run);
  const draftPullRequestDisposition = resolveDraftPullRequestDisposition(run);
  const changeDisposition = resolveChangeDisposition(run);
  const mergedPullRequest = resolveMergedPullRequest(run);
  const rerunHasReviewContext =
    run.rerunContext?.reviewDecision != null ||
    run.rerunContext?.reviewSubmittedAt != null ||
    run.rerunContext?.reviewSummary != null ||
    run.rerunContext?.reviewUrl != null;
  return {
    ...run,
    contractVersion: OPENCLAWCODE_RUN_JSON_CONTRACT_VERSION,
    stageLabel: formatWorkflowStageLabel(run.stage),
    totalAttemptCount: run.attempts?.total ?? null,
    planningAttemptCount: run.attempts?.planning ?? null,
    buildAttemptCount: run.attempts?.building ?? null,
    verificationAttemptCount: run.attempts?.verifying ?? null,
    changedFiles: run.buildResult?.changedFiles ?? [],
    changedFileCount: run.buildResult?.changedFiles.length ?? null,
    changeDisposition: changeDisposition.changeDisposition,
    changeDispositionReason: changeDisposition.changeDispositionReason,
    issueClassification: run.buildResult?.issueClassification ?? null,
    scopeCheck: run.buildResult?.scopeCheck ?? null,
    scopeCheckSummary: run.buildResult?.scopeCheck?.summary ?? null,
    scopeCheckSummaryPresent: (run.buildResult?.scopeCheck?.summary?.length ?? 0) > 0,
    scopeCheckPassed: run.buildResult?.scopeCheck?.ok ?? null,
    scopeCheckHasBlockedFiles:
      run.buildResult?.scopeCheck == null
        ? false
        : run.buildResult.scopeCheck.blockedFiles.length > 0,
    scopeBlockedFiles: run.buildResult?.scopeCheck?.blockedFiles ?? null,
    scopeBlockedFileCount: run.buildResult?.scopeCheck?.blockedFiles.length ?? null,
    testCommandCount: run.buildResult?.testCommands.length ?? null,
    testResultCount: run.buildResult?.testResults.length ?? null,
    noteCount: run.buildResult?.notes.length ?? null,
    failureDiagnostics: run.failureDiagnostics ?? null,
    failureDiagnosticsSummary: run.failureDiagnostics?.summary ?? null,
    suitabilityDecision: run.suitability?.decision ?? null,
    suitabilitySummary: run.suitability?.summary ?? null,
    suitabilityReasons: run.suitability?.reasons ?? null,
    suitabilityReasonCount: run.suitability?.reasons.length ?? null,
    suitabilityClassification: run.suitability?.classification ?? null,
    suitabilityRiskLevel: run.suitability?.riskLevel ?? null,
    suitabilityEvaluatedAt: run.suitability?.evaluatedAt ?? null,
    acceptanceCriteriaCount: run.executionSpec?.acceptanceCriteria.length ?? null,
    openQuestionCount: run.executionSpec?.openQuestions.length ?? null,
    riskCount: run.executionSpec?.risks.length ?? null,
    assumptionCount: run.executionSpec?.assumptions.length ?? null,
    testPlanCount: run.executionSpec?.testPlan.length ?? null,
    scopeItemCount: run.executionSpec?.scope.length ?? null,
    outOfScopeCount: run.executionSpec?.outOfScope.length ?? null,
    draftPullRequestBranchName: run.draftPullRequest?.branchName ?? null,
    draftPullRequestBaseBranch: run.draftPullRequest?.baseBranch ?? null,
    draftPullRequestNumber: run.draftPullRequest?.number ?? null,
    publishedPullRequestNumber: publishedPullRequest.publishedPullRequestNumber,
    draftPullRequestUrl: run.draftPullRequest?.url ?? null,
    draftPullRequestDisposition: draftPullRequestDisposition.draftPullRequestDisposition,
    draftPullRequestDispositionReason:
      draftPullRequestDisposition.draftPullRequestDispositionReason,
    pullRequestPublished: publishedPullRequest.pullRequestPublished,
    publishedPullRequestOpenedAt: publishedPullRequest.publishedPullRequestOpenedAt,
    pullRequestMerged: mergedPullRequest.pullRequestMerged,
    mergedPullRequestMergedAt: mergedPullRequest.mergedPullRequestMergedAt,
    verificationDecision: run.verificationReport?.decision ?? null,
    verificationApprovedForHumanReview: resolveVerificationApprovedForHumanReview(run),
    verificationSummary: run.verificationReport?.summary ?? null,
    verificationHasFindings:
      run.verificationReport == null ? false : run.verificationReport.findings.length > 0,
    verificationHasMissingCoverage:
      run.verificationReport == null ? false : run.verificationReport.missingCoverage.length > 0,
    verificationHasSignals:
      run.verificationReport == null
        ? false
        : run.verificationReport.findings.length > 0 ||
          run.verificationReport.missingCoverage.length > 0 ||
          run.verificationReport.followUps.length > 0,
    verificationHasFollowUps:
      run.verificationReport == null ? false : run.verificationReport.followUps.length > 0,
    verificationFindingCount: run.verificationReport?.findings.length ?? null,
    verificationMissingCoverageCount: run.verificationReport?.missingCoverage.length ?? null,
    verificationFollowUpCount: run.verificationReport?.followUps.length ?? null,
    stageRecordCount: run.stageRecords?.length ?? null,
    historyEntryCount: run.history?.length ?? null,
    rerunRequested: Boolean(run.rerunContext),
    rerunHasReviewContext,
    rerunReason: run.rerunContext?.reason ?? null,
    rerunRequestedAt: run.rerunContext?.requestedAt ?? null,
    rerunPriorRunId: run.rerunContext?.priorRunId ?? null,
    rerunPriorStage: run.rerunContext?.priorStage ?? null,
    rerunReviewDecision: run.rerunContext?.reviewDecision ?? null,
    rerunReviewSubmittedAt: run.rerunContext?.reviewSubmittedAt ?? null,
    rerunReviewSummary: run.rerunContext?.reviewSummary ?? null,
    rerunReviewUrl: run.rerunContext?.reviewUrl ?? null,
    runSummary: resolveRunSummary(run),
    autoMergeDisposition: autoMergeDisposition.autoMergeDisposition,
    autoMergeDispositionReason: autoMergeDisposition.autoMergeDispositionReason,
    autoMergePolicyEligible: autoMergePolicy.autoMergePolicyEligible,
    autoMergePolicyReason: autoMergePolicy.autoMergePolicyReason,
  };
}

export async function openclawCodeRunCommand(
  opts: OpenClawCodeRunOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const issueNumber = parseIssueNumber(opts.issue);
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const stateDir = path.resolve(opts.stateDir ?? path.join(repoRoot, ".openclawcode"));
  const shellRunner = new HostShellRunner();
  const worktreeManager = new GitWorktreeManager();
  const github = new GitHubRestClient();
  const planner = new HeuristicPlanner();
  const agentRunner = new OpenClawAgentRunner();
  const builderTimeoutSeconds = resolvePositiveTimeoutSeconds({
    envName: OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS_ENV,
    fallback: DEFAULT_OPENCLAWCODE_BUILDER_TIMEOUT_SECONDS,
  });
  const verifierTimeoutSeconds = resolvePositiveTimeoutSeconds({
    envName: OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS_ENV,
    fallback: DEFAULT_OPENCLAWCODE_VERIFIER_TIMEOUT_SECONDS,
  });
  const builder = new AgentBackedBuilder({
    agentRunner,
    shellRunner,
    testCommands: opts.test ?? [],
    agentId: opts.builderAgent,
    timeoutSeconds: builderTimeoutSeconds,
    collectChangedFiles: async (run) => {
      if (!run.workspace) {
        return [];
      }
      return await worktreeManager.collectChangedFiles(run.workspace);
    },
  });
  const verifier = new AgentBackedVerifier({
    agentRunner,
    agentId: opts.verifierAgent,
    timeoutSeconds: verifierTimeoutSeconds,
  });
  const store = new FileSystemWorkflowRunStore(path.join(stateDir, "runs"));

  const run = await runIssueWorkflow(
    {
      owner: repoRef.owner,
      repo: repoRef.repo,
      issueNumber,
      repoRoot,
      stateDir,
      baseBranch: opts.baseBranch ?? "main",
      branchName: opts.branchName,
      openPullRequest: Boolean(opts.openPr),
      mergeOnApprove: Boolean(opts.mergeOnApprove),
      rerunContext: resolveRerunContext(opts),
    },
    {
      github,
      planner,
      builder,
      verifier,
      store,
      worktreeManager,
      shellRunner,
      publisher: opts.openPr ? new GitHubPullRequestPublisher(github, shellRunner) : undefined,
      merger: opts.mergeOnApprove ? new GitHubPullRequestMerger(github) : undefined,
    },
  );

  if (opts.json) {
    runtime.log(JSON.stringify(toWorkflowRunJson(run), null, 2));
    return;
  }

  runtime.log(`Run: ${run.id}`);
  runtime.log(`Stage: ${run.stage}`);
  if (run.workspace) {
    runtime.log(`Worktree: ${run.workspace.worktreePath}`);
    runtime.log(`Branch: ${run.workspace.branchName}`);
  }
  if (run.draftPullRequest?.url) {
    runtime.log(`Draft PR: ${run.draftPullRequest.url}`);
  }
}

export async function openclawCodeSeedValidationIssueCommand(
  opts: OpenClawCodeSeedValidationIssueOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const draft = buildValidationIssueDraft({
    template: opts.template,
    fieldName: opts.fieldName,
    sourcePath: opts.sourcePath,
    docPath: opts.docPath,
    summary: opts.summary,
  });

  if (opts.dryRun) {
    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            ...draft,
            owner: repoRef.owner,
            repo: repoRef.repo,
            dryRun: true,
          },
          null,
          2,
        ),
      );
      return;
    }
    runtime.log(`Template: ${draft.template}`);
    runtime.log(`Issue class: ${draft.issueClass}`);
    runtime.log(`Repo: ${repoRef.owner}/${repoRef.repo}`);
    runtime.log(`Title: ${draft.title}`);
    runtime.log("Body:");
    runtime.log(draft.body);
    return;
  }

  const github = new GitHubRestClient();
  const existing = (
    await github.listIssues({
      owner: repoRef.owner,
      repo: repoRef.repo,
      state: "open",
    })
  )
    .filter((issue) => {
      const classified = classifyValidationIssue({
        title: issue.title,
        body: issue.body,
      });
      return classified?.template === draft.template && issue.title === draft.title;
    })
    .toSorted((left, right) => left.number - right.number)[0];

  if (existing) {
    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            ...draft,
            owner: existing.owner,
            repo: existing.repo,
            issueNumber: existing.number,
            issueUrl: existing.url,
            dryRun: false,
            created: false,
            reusedExisting: true,
          },
          null,
          2,
        ),
      );
      return;
    }
    runtime.log(`Using existing issue #${existing.number}: ${existing.url}`);
    runtime.log(`Template: ${draft.template}`);
    runtime.log(`Issue class: ${draft.issueClass}`);
    return;
  }

  const created = await github.createIssue({
    owner: repoRef.owner,
    repo: repoRef.repo,
    title: draft.title,
    body: draft.body,
  });

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          ...draft,
          owner: created.owner,
          repo: created.repo,
          issueNumber: created.number,
          issueUrl: created.url,
          dryRun: false,
          created: true,
          reusedExisting: false,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Created issue #${created.number}: ${created.url}`);
  runtime.log(`Template: ${draft.template}`);
  runtime.log(`Issue class: ${draft.issueClass}`);
}

export async function openclawCodeListValidationIssuesCommand(
  opts: OpenClawCodeListValidationIssuesOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const repoRef = await resolveRepoRef({
    owner: opts.owner,
    repo: opts.repo,
    repoRoot,
  });
  const github = new GitHubRestClient();
  const issues = (
    await github.listIssues({
      owner: repoRef.owner,
      repo: repoRef.repo,
      state: opts.state ?? "open",
    })
  )
    .flatMap((issue) => {
      const classified = classifyValidationIssue({
        title: issue.title,
        body: issue.body,
      });
      if (!classified) {
        return [];
      }
      return [
        {
          issueNumber: issue.number,
          title: issue.title,
          url: issue.url,
          state: issue.state,
          createdAt: issue.createdAt ?? null,
          updatedAt: issue.updatedAt ?? null,
          ageDays: resolveValidationIssueAgeDays(issue.createdAt),
          template: classified.template,
          issueClass: classified.issueClass,
        },
      ];
    })
    .toSorted((left, right) => left.issueNumber - right.issueNumber);

  const counts = {
    commandLayer: issues.filter((issue) => issue.issueClass === "command-layer").length,
    operatorDocs: issues.filter((issue) => issue.issueClass === "operator-docs").length,
    highRiskValidation: issues.filter((issue) => issue.issueClass === "high-risk-validation")
      .length,
  };
  const templateCounts = issues.reduce<Partial<Record<ValidationIssueTemplateId, number>>>(
    (summary, issue) => {
      summary[issue.template] = (summary[issue.template] ?? 0) + 1;
      return summary;
    },
    {},
  );

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          owner: repoRef.owner,
          repo: repoRef.repo,
          state: opts.state ?? "open",
          totalValidationIssues: issues.length,
          counts,
          templateCounts,
          issues,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Repo: ${repoRef.owner}/${repoRef.repo}`);
  runtime.log(`State: ${opts.state ?? "open"}`);
  runtime.log(`Validation issues: ${issues.length}`);
  runtime.log(`- command-layer: ${counts.commandLayer}`);
  runtime.log(`- operator-docs: ${counts.operatorDocs}`);
  runtime.log(`- high-risk-validation: ${counts.highRiskValidation}`);
  for (const [template, count] of Object.entries(templateCounts).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    runtime.log(`- template ${template}: ${count}`);
  }
  for (const issue of issues) {
    const age = issue.ageDays == null ? "unknown age" : `${issue.ageDays.toFixed(1)}d`;
    runtime.log(
      `#${issue.issueNumber} [${issue.issueClass}/${issue.template}] ${age} ${issue.title}`,
    );
    runtime.log(issue.url);
  }
}

export function openclawCodeSeedValidationIssueTemplateIds(): ValidationIssueTemplateId[] {
  return listValidationIssueTemplates().map((entry) => entry.id);
}
