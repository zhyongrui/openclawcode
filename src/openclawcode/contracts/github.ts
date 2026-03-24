import type { IssueRef } from "./types.js";

export interface GitHubIssuePayload {
  repository: {
    owner: string;
    name: string;
  };
  issue: {
    number: number;
    title: string;
    body?: string;
    labels?: Array<{ name: string }>;
  };
}

export function mapGitHubIssue(payload: GitHubIssuePayload): IssueRef {
  return {
    owner: payload.repository.owner,
    repo: payload.repository.name,
    number: payload.issue.number,
    title: payload.issue.title,
    body: payload.issue.body,
    labels: payload.issue.labels?.map((label) => label.name) ?? []
  };
}
