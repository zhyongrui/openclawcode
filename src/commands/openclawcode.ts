import path from "node:path";
import type { WorkflowRun } from "../openclawcode/index.js";
import {
  FileSystemWorkflowRunStore,
  GitHubPullRequestMerger,
  GitHubPullRequestPublisher,
  GitHubRestClient,
  GitWorktreeManager,
  HeuristicPlanner,
  HostShellRunner,
  OpenClawAgentRunner,
  AgentBackedBuilder,
  AgentBackedVerifier,
  resolveGitHubRepoFromGit,
  runIssueWorkflow,
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
  json?: boolean;
}

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--issue must be a positive integer");
  }
  return parsed;
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

function resolvePublishedPullRequest(run: WorkflowRun): {
  pullRequestPublished: boolean;
  publishedPullRequestOpenedAt: string | null;
} {
  const published = run.draftPullRequest?.number != null || run.draftPullRequest?.url != null;
  return {
    pullRequestPublished: published,
    publishedPullRequestOpenedAt: published ? (run.draftPullRequest?.openedAt ?? null) : null,
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

function resolveRunSummary(run: WorkflowRun): string {
  if (run.verificationReport?.summary) {
    return run.verificationReport.summary;
  }

  if (run.buildResult?.summary) {
    return run.buildResult.summary;
  }

  return `Run is at the ${run.stage} stage.`;
}

function toWorkflowRunJson(run: WorkflowRun) {
  const autoMergePolicy = resolveAutoMergePolicy(run);
  const publishedPullRequest = resolvePublishedPullRequest(run);
  const mergedPullRequest = resolveMergedPullRequest(run);
  return {
    ...run,
    changedFiles: run.buildResult?.changedFiles ?? [],
    issueClassification: run.buildResult?.issueClassification ?? null,
    scopeCheck: run.buildResult?.scopeCheck ?? null,
    draftPullRequestBranchName: run.draftPullRequest?.branchName ?? null,
    draftPullRequestBaseBranch: run.draftPullRequest?.baseBranch ?? null,
    draftPullRequestNumber: run.draftPullRequest?.number ?? null,
    draftPullRequestUrl: run.draftPullRequest?.url ?? null,
    pullRequestPublished: publishedPullRequest.pullRequestPublished,
    publishedPullRequestOpenedAt: publishedPullRequest.publishedPullRequestOpenedAt,
    pullRequestMerged: mergedPullRequest.pullRequestMerged,
    mergedPullRequestMergedAt: mergedPullRequest.mergedPullRequestMergedAt,
    verificationDecision: run.verificationReport?.decision ?? null,
    verificationSummary: run.verificationReport?.summary ?? null,
    runSummary: resolveRunSummary(run),
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
  const repoRef =
    opts.owner && opts.repo
      ? { owner: opts.owner, repo: opts.repo }
      : await resolveGitHubRepoFromGit(repoRoot);
  const stateDir = path.resolve(opts.stateDir ?? path.join(repoRoot, ".openclawcode"));
  const shellRunner = new HostShellRunner();
  const worktreeManager = new GitWorktreeManager();
  const github = new GitHubRestClient();
  const planner = new HeuristicPlanner();
  const agentRunner = new OpenClawAgentRunner();
  const builder = new AgentBackedBuilder({
    agentRunner,
    shellRunner,
    testCommands: opts.test ?? [],
    agentId: opts.builderAgent,
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
