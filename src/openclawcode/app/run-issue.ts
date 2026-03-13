import path from "node:path";
import type {
  WorkflowFailureDiagnostics,
  WorkflowRerunContext,
  WorkflowRun,
  WorkflowWorkspace,
} from "../contracts/index.js";
import type { GitHubIssueClient, PullRequestRef, RepoRef } from "../github/index.js";
import {
  buildPullRequestBody,
  createRun,
  executeBuild,
  executePlanning,
  executeVerification,
} from "../orchestrator/index.js";
import type { WorkflowRunStore } from "../persistence/index.js";
import {
  assessIssueSuitability,
  type Builder,
  type Planner,
  type Verifier,
} from "../roles/index.js";
import {
  AgentRunFailureError,
  formatAgentRunFailureDiagnostics,
  type ShellRunner,
} from "../runtime/index.js";
import { transitionRun, type TimestampFactory } from "../workflow/index.js";
import type { WorkflowWorkspaceManager } from "../worktree/index.js";

export interface IssueWorkflowRequest extends RepoRef {
  issueNumber: number;
  repoRoot: string;
  stateDir: string;
  baseBranch: string;
  branchName?: string;
  openPullRequest?: boolean;
  mergeOnApprove?: boolean;
  rerunContext?: WorkflowRerunContext;
}

export interface PullRequestPublisher {
  publish(params: { run: WorkflowRun; repo: RepoRef; draft?: boolean }): Promise<PullRequestRef>;
}

export interface PullRequestMerger {
  merge(params: { run: WorkflowRun; repo: RepoRef; pullRequest: PullRequestRef }): Promise<void>;
}

export interface IssueWorkflowDeps {
  github: GitHubIssueClient;
  planner: Planner;
  builder: Builder;
  verifier: Verifier;
  store: WorkflowRunStore;
  worktreeManager: WorkflowWorkspaceManager;
  shellRunner: ShellRunner;
  publisher?: PullRequestPublisher;
  merger?: PullRequestMerger;
  now?: TimestampFactory;
}

function noteRun(run: WorkflowRun, note: string, now: TimestampFactory): WorkflowRun {
  return {
    ...run,
    updatedAt: now(),
    history: [...run.history, note],
  };
}

function trimSingleLine(value: string | undefined): string | undefined {
  const singleLine = value
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return singleLine && singleLine.length > 0 ? singleLine : undefined;
}

function formatWorkflowFailureNote(stageLabel: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const summary = trimSingleLine(message) ?? `${stageLabel} failed.`;
  const diagnostics =
    error instanceof AgentRunFailureError
      ? formatAgentRunFailureDiagnostics(error.diagnostics)
      : undefined;
  return diagnostics
    ? `${stageLabel} failed: ${summary} (${diagnostics})`
    : `${stageLabel} failed: ${summary}`;
}

function extractWorkflowFailureDiagnostics(error: unknown): WorkflowFailureDiagnostics | undefined {
  if (!(error instanceof AgentRunFailureError)) {
    return undefined;
  }

  return {
    summary: trimSingleLine(error.message) ?? "Agent run failed.",
    provider: error.diagnostics.provider,
    model: error.diagnostics.model,
    systemPromptChars: error.diagnostics.systemPromptChars,
    skillsPromptChars: error.diagnostics.skillsPromptChars,
    toolSchemaChars: error.diagnostics.toolSchemaChars,
    toolCount: error.diagnostics.toolCount,
    skillCount: error.diagnostics.skillCount,
    injectedWorkspaceFileCount: error.diagnostics.injectedWorkspaceFileCount,
    bootstrapWarningShown: error.diagnostics.bootstrapWarningShown,
    lastCallUsageTotal: error.diagnostics.lastCallUsageTotal,
  };
}

function transitionRunToFailure(
  run: WorkflowRun,
  stageLabel: string,
  error: unknown,
  now: TimestampFactory,
): WorkflowRun {
  const failedRun = transitionRun(
    {
      ...run,
      failureDiagnostics: undefined,
    },
    "failed",
    formatWorkflowFailureNote(stageLabel, error),
    now,
  );
  const diagnostics = extractWorkflowFailureDiagnostics(error);
  return diagnostics
    ? {
        ...failedRun,
        failureDiagnostics: diagnostics,
      }
    : failedRun;
}

function attachRerunContext(
  run: WorkflowRun,
  rerunContext: WorkflowRerunContext,
  now: TimestampFactory,
): WorkflowRun {
  const normalizedReason = rerunContext.reason.trim() || "Manual rerun requested.";
  const normalizedContext: WorkflowRerunContext = {
    ...rerunContext,
    reason: normalizedReason,
    reviewSummary: rerunContext.reviewSummary?.trim() || undefined,
    reviewUrl: rerunContext.reviewUrl?.trim() || undefined,
  };

  const notes = [
    `Rerun requested: ${trimSingleLine(normalizedReason) ?? "Manual rerun requested."}`,
  ];

  if (normalizedContext.priorRunId || normalizedContext.priorStage) {
    notes.push(
      `Rerun context: prior run ${normalizedContext.priorRunId ?? "unknown"} from stage ${normalizedContext.priorStage ?? "unknown"}.`,
    );
  }

  if (normalizedContext.reviewDecision || normalizedContext.reviewSubmittedAt) {
    notes.push(
      `Latest review context: ${normalizedContext.reviewDecision ?? "unknown"} at ${normalizedContext.reviewSubmittedAt ?? "unknown"}.`,
    );
  }

  const reviewSummary = trimSingleLine(normalizedContext.reviewSummary);
  if (reviewSummary) {
    notes.push(`Latest review summary: ${reviewSummary}`);
  }

  if (normalizedContext.reviewUrl) {
    notes.push(`Latest review URL: ${normalizedContext.reviewUrl}`);
  }

  return {
    ...run,
    updatedAt: now(),
    rerunContext: normalizedContext,
    history: [...run.history, ...notes],
  };
}

function defaultBranchName(issueNumber: number): string {
  return `openclawcode/issue-${issueNumber}`;
}

function shouldAutoMerge(run: WorkflowRun): boolean {
  return (
    run.suitability?.decision === "auto-run" &&
    run.buildResult?.issueClassification === "command-layer" &&
    (run.buildResult.scopeCheck?.ok ?? true)
  );
}

function shouldSkipDraftPullRequest(run: WorkflowRun): boolean {
  return (run.buildResult?.changedFiles.length ?? 0) === 0;
}

function isNoCommitPullRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("No commits between");
}

function formatNoCommitPullRequestNote(run: WorkflowRun): string {
  const branchName = run.workspace?.branchName ?? "the issue branch";
  return `Draft PR skipped: no new commits were produced between the base branch and ${branchName}.`;
}

function formatAutoMergeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Resource not accessible by personal access token")) {
    return [
      "Auto-merge failed: GitHub token cannot merge pull requests.",
      "Ensure GH_TOKEN/GITHUB_TOKEN has pull request and contents write access.",
      `Original error: ${message}`,
    ].join(" ");
  }
  return `Auto-merge failed: ${message}`;
}

function formatIssueClosedNote(issueNumber: number): string {
  return `Issue #${issueNumber} closed automatically after merge.`;
}

function formatIssueCloseFailure(issueNumber: number, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Resource not accessible by personal access token")) {
    return [
      `Issue close failed for #${issueNumber}: GitHub token cannot update issues.`,
      "Ensure GH_TOKEN/GITHUB_TOKEN has issues write access.",
      `Original error: ${message}`,
    ].join(" ");
  }
  return `Issue close failed for #${issueNumber}: ${message}`;
}

function formatExistingPullRequestNote(pullRequest: PullRequestRef): string {
  return `Reusing existing pull request: ${pullRequest.url}`;
}

async function pushIssueBranch(params: {
  shellRunner: ShellRunner;
  workspace: WorkflowWorkspace;
}): Promise<void> {
  const push = await params.shellRunner.run({
    cwd: params.workspace.worktreePath,
    command: `git push -u origin ${params.workspace.branchName}`,
  });
  if (push.code !== 0) {
    throw new Error(push.stderr || "Failed to push branch to origin");
  }
}

export class GitHubPullRequestPublisher implements PullRequestPublisher {
  constructor(
    private readonly github: GitHubIssueClient,
    private readonly shellRunner: ShellRunner,
  ) {}

  async publish(params: {
    run: WorkflowRun;
    repo: RepoRef;
    draft?: boolean;
  }): Promise<PullRequestRef> {
    if (!params.run.workspace || !params.run.draftPullRequest) {
      throw new Error("Run workspace and draft pull request are required before publishing.");
    }

    await pushIssueBranch({
      shellRunner: this.shellRunner,
      workspace: params.run.workspace,
    });

    return await this.github.createDraftPullRequest({
      owner: params.repo.owner,
      repo: params.repo.repo,
      title: params.run.draftPullRequest.title,
      body: params.run.draftPullRequest.body,
      head: params.run.workspace.branchName,
      base: params.run.draftPullRequest.baseBranch,
      draft: params.draft,
    });
  }
}

export class GitHubPullRequestMerger implements PullRequestMerger {
  constructor(private readonly github: GitHubIssueClient) {}

  async merge(params: {
    run: WorkflowRun;
    repo: RepoRef;
    pullRequest: PullRequestRef;
  }): Promise<void> {
    await this.github.mergePullRequest({
      owner: params.repo.owner,
      repo: params.repo.repo,
      pullNumber: params.pullRequest.number,
    });
  }
}

export async function runIssueWorkflow(
  request: IssueWorkflowRequest,
  deps: IssueWorkflowDeps,
): Promise<WorkflowRun> {
  const now = deps.now ?? (() => new Date().toISOString());
  const issue = await deps.github.fetchIssue({
    owner: request.owner,
    repo: request.repo,
    issueNumber: request.issueNumber,
  });

  let run = createRun(issue, now);
  if (request.rerunContext) {
    run = attachRerunContext(run, request.rerunContext, now);
  }
  await deps.store.save(run);

  run = transitionRun(run, "planning", "Planning started", now);
  await deps.store.save(run);

  try {
    run = await executePlanning(run, deps.planner, now);
  } catch (error) {
    run = transitionRunToFailure(run, "Planning", error, now);
    await deps.store.save(run);
    throw error;
  }
  await deps.store.save(run);

  const suitability = assessIssueSuitability(run, now());
  run = noteRun(
    {
      ...run,
      suitability,
    },
    `Suitability assessed: ${suitability.summary}`,
    now,
  );
  await deps.store.save(run);

  if (suitability.decision === "escalate") {
    run = transitionRun(
      run,
      "escalated",
      `Suitability gate escalated the issue before branch mutation: ${suitability.summary}`,
      now,
    );
    await deps.store.save(run);
    return run;
  }

  let workspace: WorkflowWorkspace;
  try {
    workspace = await deps.worktreeManager.prepare({
      repoRoot: request.repoRoot,
      worktreeRoot: path.join(request.stateDir, "worktrees"),
      branchName: request.branchName ?? defaultBranchName(request.issueNumber),
      baseBranch: request.baseBranch,
      runId: run.id,
    });
  } catch (error) {
    run = transitionRunToFailure(run, "Workspace preparation", error, now);
    await deps.store.save(run);
    throw error;
  }
  run = noteRun(
    {
      ...run,
      workspace,
    },
    `Workspace prepared at ${workspace.worktreePath}`,
    now,
  );
  await deps.store.save(run);

  run = transitionRun(run, "building", "Build started", now);
  await deps.store.save(run);

  try {
    run = await executeBuild(run, deps.builder);
  } catch (error) {
    run = transitionRunToFailure(run, "Build", error, now);
    await deps.store.save(run);
    throw error;
  }
  await deps.store.save(run);

  let publishedPullRequest: PullRequestRef | undefined;
  const publishAsDraft = !request.mergeOnApprove;
  if (request.openPullRequest && deps.publisher) {
    if (!run.workspace) {
      throw new Error("Run workspace is required before publishing a pull request.");
    }
    const existingPullRequest = await deps.github.findOpenPullRequestForBranch({
      owner: request.owner,
      repo: request.repo,
      head: run.workspace.branchName,
      base: request.baseBranch,
    });
    if (existingPullRequest) {
      await pushIssueBranch({
        shellRunner: deps.shellRunner,
        workspace: run.workspace,
      });
      publishedPullRequest = existingPullRequest;
      run = noteRun(
        {
          ...run,
          draftPullRequest: {
            ...run.draftPullRequest!,
            number: existingPullRequest.number,
            url: existingPullRequest.url,
          },
        },
        formatExistingPullRequestNote(existingPullRequest),
        now,
      );
    } else if (shouldSkipDraftPullRequest(run)) {
      run = noteRun(run, formatNoCommitPullRequestNote(run), now);
    } else {
      try {
        publishedPullRequest = await deps.publisher.publish({
          run,
          repo: {
            owner: request.owner,
            repo: request.repo,
          },
          draft: publishAsDraft,
        });
        run = noteRun(
          {
            ...run,
            draftPullRequest: {
              ...run.draftPullRequest!,
              number: publishedPullRequest.number,
              url: publishedPullRequest.url,
              openedAt: now(),
            },
          },
          `${publishAsDraft ? "Draft PR" : "Pull request"} opened: ${publishedPullRequest.url}`,
          now,
        );
      } catch (error) {
        if (!isNoCommitPullRequestError(error)) {
          throw error;
        }
        run = noteRun(run, formatNoCommitPullRequestNote(run), now);
      }
    }
    await deps.store.save(run);
  } else if (run.draftPullRequest) {
    run = {
      ...run,
      draftPullRequest: {
        ...run.draftPullRequest,
        body: buildPullRequestBody(run),
      },
    };
    await deps.store.save(run);
  }

  run = transitionRun(run, "verifying", "Verification started", now);
  await deps.store.save(run);

  try {
    run = await executeVerification(run, deps.verifier, now);
  } catch (error) {
    run = transitionRunToFailure(run, "Verification", error, now);
    await deps.store.save(run);
    throw error;
  }
  await deps.store.save(run);

  if (
    request.mergeOnApprove &&
    publishedPullRequest &&
    run.stage === "ready-for-human-review" &&
    deps.merger
  ) {
    if (shouldAutoMerge(run)) {
      try {
        await deps.merger.merge({
          run,
          repo: {
            owner: request.owner,
            repo: request.repo,
          },
          pullRequest: publishedPullRequest,
        });
        run = transitionRun(run, "merged", "Pull request merged automatically", now);
        await deps.store.save(run);
        try {
          await deps.github.closeIssue({
            owner: request.owner,
            repo: request.repo,
            issueNumber: request.issueNumber,
          });
          run = noteRun(run, formatIssueClosedNote(request.issueNumber), now);
        } catch (error) {
          run = noteRun(run, formatIssueCloseFailure(request.issueNumber, error), now);
        }
      } catch (error) {
        run = noteRun(run, formatAutoMergeFailure(error), now);
      }
    } else {
      run = noteRun(
        run,
        "Auto-merge skipped: policy requires an auto-run suitability decision, command-layer scope, and a passing scope check",
        now,
      );
    }
    await deps.store.save(run);
  }

  return run;
}
