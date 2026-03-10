import path from "node:path";
import type { WorkflowRun } from "../contracts/index.js";
import type { GitHubIssueClient, PullRequestRef, RepoRef } from "../github/index.js";
import {
  buildPullRequestBody,
  createRun,
  executeBuild,
  executePlanning,
  executeVerification,
} from "../orchestrator/index.js";
import type { WorkflowRunStore } from "../persistence/index.js";
import type { Builder, Planner, Verifier } from "../roles/index.js";
import type { ShellRunner } from "../runtime/index.js";
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

function defaultBranchName(issueNumber: number): string {
  return `openclawcode/issue-${issueNumber}`;
}

function shouldAutoMerge(run: WorkflowRun): boolean {
  return (
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

    const push = await this.shellRunner.run({
      cwd: params.run.workspace.worktreePath,
      command: `git push -u origin ${params.run.workspace.branchName}`,
    });
    if (push.code !== 0) {
      throw new Error(push.stderr || "Failed to push branch to origin");
    }

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
  await deps.store.save(run);

  run = await executePlanning(run, deps.planner, now);
  await deps.store.save(run);

  const workspace = await deps.worktreeManager.prepare({
    repoRoot: request.repoRoot,
    worktreeRoot: path.join(request.stateDir, "worktrees"),
    branchName: request.branchName ?? defaultBranchName(request.issueNumber),
    baseBranch: request.baseBranch,
    runId: run.id,
  });
  run = noteRun(
    {
      ...run,
      workspace,
    },
    `Workspace prepared at ${workspace.worktreePath}`,
    now,
  );
  await deps.store.save(run);

  run = await executeBuild(run, deps.builder);
  await deps.store.save(run);

  let publishedPullRequest: PullRequestRef | undefined;
  const publishAsDraft = !request.mergeOnApprove;
  if (request.openPullRequest && deps.publisher) {
    if (shouldSkipDraftPullRequest(run)) {
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

  run = await executeVerification(run, deps.verifier, now);
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
      } catch (error) {
        run = noteRun(run, formatAutoMergeFailure(error), now);
      }
    } else {
      run = noteRun(
        run,
        "Auto-merge skipped: policy requires human review for non-command-layer or failed-scope runs",
        now,
      );
    }
    await deps.store.save(run);
  }

  return run;
}
