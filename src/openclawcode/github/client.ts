import { execFileUtf8 } from "../../daemon/exec-file.js";
import type { IssueRef } from "../contracts/index.js";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface PullRequestRef {
  number: number;
  url: string;
}

export interface CreatedIssueRef extends IssueRef {
  url: string;
}

export interface ListedIssueRef extends CreatedIssueRef {
  state: "open" | "closed";
  createdAt?: string;
  updatedAt?: string;
}

export interface IssueStateRef extends RepoRef {
  issueNumber: number;
}

export interface GitHubIssueState {
  state: "open" | "closed";
}

export interface GitHubPullRequestState extends PullRequestRef {
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  mergedAt?: string;
}

export interface GitHubPullRequestReviewState {
  decision: "approved" | "changes-requested";
  submittedAt?: string;
}

export interface DraftPullRequestRequest extends RepoRef {
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface CreateIssueRequest extends RepoRef {
  title: string;
  body: string;
}

export interface ListIssuesRequest extends RepoRef {
  state?: "open" | "closed" | "all";
  perPage?: number;
}

export interface MergePullRequestRequest extends RepoRef {
  pullNumber: number;
  mergeMethod?: "merge" | "squash" | "rebase";
}

export interface CloseIssueRequest extends RepoRef {
  issueNumber: number;
}

export interface ReadyForReviewRequest extends RepoRef {
  pullNumber: number;
}

export interface GitHubIssueClient {
  fetchIssue(ref: IssueStateRef): Promise<IssueRef>;
  createIssue(request: CreateIssueRequest): Promise<CreatedIssueRef>;
  listIssues(request: ListIssuesRequest): Promise<ListedIssueRef[]>;
  fetchIssueState(ref: IssueStateRef): Promise<GitHubIssueState>;
  fetchPullRequest(ref: RepoRef & { pullNumber: number }): Promise<GitHubPullRequestState>;
  fetchLatestPullRequestReview(
    ref: RepoRef & { pullNumber: number },
  ): Promise<GitHubPullRequestReviewState | undefined>;
  findOpenPullRequestForBranch(
    ref: RepoRef & { head: string; base?: string },
  ): Promise<PullRequestRef | undefined>;
  createDraftPullRequest(request: DraftPullRequestRequest): Promise<PullRequestRef>;
  markPullRequestReadyForReview(request: ReadyForReviewRequest): Promise<void>;
  mergePullRequest(request: MergePullRequestRequest): Promise<void>;
  closeIssue(request: CloseIssueRequest): Promise<void>;
}

type GitHubIssueResponse = {
  number: number;
  title: string;
  html_url?: string;
  body?: string | null;
  state?: "open" | "closed";
  created_at?: string | null;
  updated_at?: string | null;
  pull_request?: { url?: string | null } | null;
  labels?: { nodes?: Array<{ name?: string | null } | null> | null } | Array<{ name?: string }>;
};

type GitHubPullRequestResponse = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at?: string | null;
  merged?: boolean;
};

type GitHubPullRequestReviewResponse = {
  state?: string | null;
  submitted_at?: string | null;
};

function resolveToken(env: NodeJS.ProcessEnv): string | undefined {
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  return token?.trim() || undefined;
}

function normalizeLabels(raw: GitHubIssueResponse["labels"]): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((label) => label.name)
      .filter((name): name is string => typeof name === "string");
  }
  return (
    raw?.nodes
      ?.map((label) => (typeof label?.name === "string" ? label.name : undefined))
      .filter((name): name is string => typeof name === "string") ?? []
  );
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText} ${body}`);
  }
  return (await response.json()) as T;
}

export function resolveGitHubRepoFromRemoteUrl(remote: string): RepoRef {
  const normalized = remote.trim().replace(/\.git$/, "");
  if (normalized.startsWith("git@github.com:")) {
    const slug = normalized.replace("git@github.com:", "");
    const [owner, repo] = slug.split("/");
    if (owner && repo) {
      return { owner, repo };
    }
  }
  if (normalized.startsWith("https://github.com/")) {
    const slug = normalized.replace("https://github.com/", "");
    const [owner, repo] = slug.split("/");
    if (owner && repo) {
      return { owner, repo };
    }
  }
  throw new Error(`Unsupported GitHub remote: ${remote}`);
}

export async function resolveGitHubRepoFromGit(repoRoot: string): Promise<RepoRef> {
  const result = await execFileUtf8("git", [
    "-C",
    repoRoot,
    "config",
    "--get",
    "remote.origin.url",
  ]);
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new Error("Unable to determine GitHub repository from git remote.origin.url");
  }
  return resolveGitHubRepoFromRemoteUrl(result.stdout.trim());
}

export class GitHubRestClient implements GitHubIssueClient {
  constructor(
    private readonly token: string | undefined = resolveToken(process.env),
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    const response = await this.fetchFn(`https://api.github.com${path}`, {
      ...init,
      headers,
    });
    return await parseJsonResponse<T>(response);
  }

  async fetchIssue(ref: RepoRef & { issueNumber: number }): Promise<IssueRef> {
    const issue = await this.request<GitHubIssueResponse>(
      `/repos/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}`,
    );
    return {
      owner: ref.owner,
      repo: ref.repo,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? undefined,
      labels: normalizeLabels(issue.labels),
    };
  }

  async createIssue(request: CreateIssueRequest): Promise<CreatedIssueRef> {
    if (!this.token) {
      throw new Error("GitHub token missing. Set GITHUB_TOKEN or GH_TOKEN to create issues.");
    }
    const issue = await this.request<GitHubIssueResponse>(
      `/repos/${request.owner}/${request.repo}/issues`,
      {
        method: "POST",
        body: JSON.stringify({
          title: request.title,
          body: request.body,
        }),
      },
    );
    return {
      owner: request.owner,
      repo: request.repo,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? undefined,
      labels: normalizeLabels(issue.labels),
      url:
        issue.html_url ??
        `https://github.com/${request.owner}/${request.repo}/issues/${issue.number}`,
    };
  }

  async listIssues(request: ListIssuesRequest): Promise<ListedIssueRef[]> {
    const issues = await this.request<GitHubIssueResponse[]>(
      `/repos/${request.owner}/${request.repo}/issues?state=${request.state ?? "open"}&per_page=${request.perPage ?? 100}`,
    );
    return issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        owner: request.owner,
        repo: request.repo,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? undefined,
        labels: normalizeLabels(issue.labels),
        url:
          issue.html_url ??
          `https://github.com/${request.owner}/${request.repo}/issues/${issue.number}`,
        state: issue.state === "closed" ? "closed" : "open",
        createdAt: typeof issue.created_at === "string" ? issue.created_at : undefined,
        updatedAt: typeof issue.updated_at === "string" ? issue.updated_at : undefined,
      }));
  }

  async fetchIssueState(ref: IssueStateRef): Promise<GitHubIssueState> {
    const issue = await this.request<GitHubIssueResponse>(
      `/repos/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}`,
    );
    return {
      state: issue.state === "closed" ? "closed" : "open",
    };
  }

  async fetchPullRequest(ref: RepoRef & { pullNumber: number }): Promise<GitHubPullRequestState> {
    const pullRequest = await this.request<GitHubPullRequestResponse>(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.pullNumber}`,
    );
    return {
      number: pullRequest.number,
      url: pullRequest.html_url,
      state: pullRequest.state,
      draft: pullRequest.draft,
      merged: Boolean(pullRequest.merged ?? pullRequest.merged_at),
      mergedAt: typeof pullRequest.merged_at === "string" ? pullRequest.merged_at : undefined,
    };
  }

  async fetchLatestPullRequestReview(
    ref: RepoRef & { pullNumber: number },
  ): Promise<GitHubPullRequestReviewState | undefined> {
    const reviews = await this.request<GitHubPullRequestReviewResponse[]>(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.pullNumber}/reviews`,
    );
    const normalized: GitHubPullRequestReviewState[] = [];
    for (const review of reviews) {
      const state = review.state?.trim().toUpperCase();
      if (state === "APPROVED") {
        normalized.push({
          decision: "approved",
          submittedAt: typeof review.submitted_at === "string" ? review.submitted_at : undefined,
        });
        continue;
      }
      if (state === "CHANGES_REQUESTED") {
        normalized.push({
          decision: "changes-requested",
          submittedAt: typeof review.submitted_at === "string" ? review.submitted_at : undefined,
        });
      }
    }
    normalized.sort((left, right) =>
      (right.submittedAt ?? "").localeCompare(left.submittedAt ?? ""),
    );
    return normalized[0];
  }

  async findOpenPullRequestForBranch(
    ref: RepoRef & { head: string; base?: string },
  ): Promise<PullRequestRef | undefined> {
    const params = new URLSearchParams({
      state: "open",
      head: `${ref.owner}:${ref.head}`,
    });
    if (ref.base) {
      params.set("base", ref.base);
    }
    const pullRequests = await this.request<GitHubPullRequestResponse[]>(
      `/repos/${ref.owner}/${ref.repo}/pulls?${params.toString()}`,
    );
    const pullRequest = pullRequests[0];
    if (!pullRequest) {
      return undefined;
    }
    return {
      number: pullRequest.number,
      url: pullRequest.html_url,
    };
  }

  async createDraftPullRequest(request: DraftPullRequestRequest): Promise<PullRequestRef> {
    if (!this.token) {
      throw new Error("GitHub token missing. Set GITHUB_TOKEN or GH_TOKEN to open draft PRs.");
    }
    const response = await this.request<{ number: number; html_url: string }>(
      `/repos/${request.owner}/${request.repo}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: request.title,
          body: request.body,
          head: request.head,
          base: request.base,
          draft: request.draft ?? true,
        }),
      },
    );
    return {
      number: response.number,
      url: response.html_url,
    };
  }

  async markPullRequestReadyForReview(request: ReadyForReviewRequest): Promise<void> {
    if (!this.token) {
      throw new Error(
        "GitHub token missing. Set GITHUB_TOKEN or GH_TOKEN to update pull requests.",
      );
    }
    await this.request(
      `/repos/${request.owner}/${request.repo}/pulls/${request.pullNumber}/ready_for_review`,
      {
        method: "POST",
      },
    );
  }

  async mergePullRequest(request: MergePullRequestRequest): Promise<void> {
    if (!this.token) {
      throw new Error("GitHub token missing. Set GITHUB_TOKEN or GH_TOKEN to merge pull requests.");
    }
    await this.request(
      `/repos/${request.owner}/${request.repo}/pulls/${request.pullNumber}/merge`,
      {
        method: "PUT",
        body: JSON.stringify({
          merge_method: request.mergeMethod ?? "squash",
        }),
      },
    );
  }

  async closeIssue(request: CloseIssueRequest): Promise<void> {
    if (!this.token) {
      throw new Error("GitHub token missing. Set GITHUB_TOKEN or GH_TOKEN to close issues.");
    }
    await this.request(`/repos/${request.owner}/${request.repo}/issues/${request.issueNumber}`, {
      method: "PATCH",
      body: JSON.stringify({
        state: "closed",
      }),
    });
  }
}
