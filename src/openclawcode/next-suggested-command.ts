import type { RepoRef } from "./github/index.js";

export function parseRepoRefFromRepoKey(repoKey: string | null | undefined): RepoRef | undefined {
  const trimmed = repoKey?.trim();
  if (!trimmed) {
    return undefined;
  }
  const [owner = "", repo = ""] = trimmed.split("/", 2);
  if (!owner || !repo) {
    return undefined;
  }
  return { owner, repo };
}

export function resolveChatNextSuggestedCommand(params: {
  repo?: RepoRef;
  command: string | null;
}): string | null {
  const command = params.command?.trim();
  if (!command) {
    return null;
  }
  if (!params.repo) {
    return command;
  }

  const repoKey = `${params.repo.owner}/${params.repo.repo}`;
  const issueRunMatch = /^openclaw code run --issue (\d+) --repo-root /.exec(command);
  if (issueRunMatch) {
    return `/occode-start ${repoKey}#${issueRunMatch[1]}`;
  }
  if (/^openclaw code stage-gates-show --repo-root /.test(command)) {
    return `/occode-gates ${repoKey}`;
  }
  if (/^openclaw code issue-materialize --repo-root /.test(command)) {
    return `/occode-materialize ${repoKey}`;
  }
  if (/^openclaw code project-progress-show --repo-root /.test(command)) {
    return `/occode-progress ${repoKey}`;
  }
  return command;
}
