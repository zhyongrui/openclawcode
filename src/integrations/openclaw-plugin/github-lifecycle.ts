import type { OpenClawCodeIssueStatusSnapshot } from "./store.js";

interface GitHubWebhookRepository {
  owner:
    | string
    | {
        login?: string;
      };
  name: string;
}

export interface GitHubPullRequestWebhookEvent {
  action: string;
  repository: GitHubWebhookRepository;
  pull_request: {
    number: number;
    html_url?: string;
    state?: string;
    draft?: boolean;
    merged?: boolean;
    merged_at?: string | null;
    updated_at?: string | null;
    closed_at?: string | null;
  };
}

export interface GitHubPullRequestReviewWebhookEvent {
  action: string;
  repository: GitHubWebhookRepository;
  pull_request: {
    number: number;
    html_url?: string;
    state?: string;
    draft?: boolean;
    merged?: boolean;
    updated_at?: string | null;
  };
  review: {
    state?: string | null;
    submitted_at?: string | null;
    html_url?: string;
    body?: string | null;
  };
}

export interface GitHubLifecycleSnapshotUpdate {
  accepted: boolean;
  reason: string;
  snapshot?: OpenClawCodeIssueStatusSnapshot;
}

function formatMergedStatus(
  snapshot: OpenClawCodeIssueStatusSnapshot,
  pullRequestUrl: string | undefined,
): string {
  const lines = [
    `openclawcode status for ${snapshot.issueKey}`,
    "Stage: Merged",
    "Summary: GitHub pull request was merged after the latest tracked workflow state.",
    pullRequestUrl ? `PR: ${pullRequestUrl}` : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

function formatChangesRequestedStatus(
  snapshot: OpenClawCodeIssueStatusSnapshot,
  pullRequestUrl: string | undefined,
): string {
  const lines = [
    `openclawcode status for ${snapshot.issueKey}`,
    "Stage: Changes Requested",
    "Summary: GitHub pull request review requested changes after the latest tracked workflow state.",
    pullRequestUrl ? `PR: ${pullRequestUrl}` : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

function formatApprovedReviewStatus(
  snapshot: OpenClawCodeIssueStatusSnapshot,
  pullRequestUrl: string | undefined,
): string {
  const lines = [
    `openclawcode status for ${snapshot.issueKey}`,
    "Stage: Ready For Human Review",
    "Summary: GitHub pull request review approved the pull request after the latest tracked workflow state.",
    pullRequestUrl ? `PR: ${pullRequestUrl}` : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

function formatClosedWithoutMergeStatus(
  snapshot: OpenClawCodeIssueStatusSnapshot,
  pullRequestUrl: string | undefined,
): string {
  const lines = [
    `openclawcode status for ${snapshot.issueKey}`,
    "Stage: Escalated",
    "Summary: GitHub pull request was closed without merge after the latest tracked workflow state.",
    pullRequestUrl ? `PR: ${pullRequestUrl}` : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

function normalizeReviewDecision(
  value: string | null | undefined,
): "approved" | "changes-requested" | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "APPROVED") {
    return "approved";
  }
  if (normalized === "CHANGES_REQUESTED") {
    return "changes-requested";
  }
  return undefined;
}

function resolveReviewSummary(
  event: GitHubPullRequestReviewWebhookEvent,
  decision: "approved" | "changes-requested",
): string {
  const body = event.review.body?.trim();
  if (body) {
    return body;
  }
  return decision === "approved"
    ? "GitHub review approved the pull request."
    : "GitHub review requested changes on the pull request.";
}

function shouldApplyLifecycleUpdate(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  stage: OpenClawCodeIssueStatusSnapshot["stage"];
  status: string;
  updatedAt: string;
}): boolean {
  if (params.updatedAt < params.snapshot.updatedAt) {
    return false;
  }
  if (
    params.updatedAt === params.snapshot.updatedAt &&
    params.stage === params.snapshot.stage &&
    params.status === params.snapshot.status
  ) {
    return false;
  }
  return true;
}

export function applyPullRequestWebhookToSnapshot(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  event: GitHubPullRequestWebhookEvent;
}): GitHubLifecycleSnapshotUpdate {
  const { event, snapshot } = params;
  if (event.action !== "closed") {
    return {
      accepted: false,
      reason: "unsupported-pull-request-action",
    };
  }

  const pullRequestUrl = event.pull_request.html_url ?? snapshot.pullRequestUrl;
  const updatedAt =
    event.pull_request.merged_at ??
    event.pull_request.closed_at ??
    event.pull_request.updated_at ??
    snapshot.updatedAt;

  if (event.pull_request.merged) {
    const status = formatMergedStatus(snapshot, pullRequestUrl);
    if (!shouldApplyLifecycleUpdate({ snapshot, stage: "merged", status, updatedAt })) {
      return {
        accepted: false,
        reason: "stale-or-unchanged-pull-request-merge",
      };
    }
    return {
      accepted: true,
      reason: "pull-request-merged",
      snapshot: {
        ...snapshot,
        stage: "merged",
        status,
        updatedAt,
        pullRequestNumber: snapshot.pullRequestNumber ?? event.pull_request.number,
        pullRequestUrl,
      },
    };
  }

  const status = formatClosedWithoutMergeStatus(snapshot, pullRequestUrl);
  if (!shouldApplyLifecycleUpdate({ snapshot, stage: "escalated", status, updatedAt })) {
    return {
      accepted: false,
      reason: "stale-or-unchanged-pull-request-close",
    };
  }
  return {
    accepted: true,
    reason: "pull-request-closed-without-merge",
    snapshot: {
      ...snapshot,
      stage: "escalated",
      status,
      updatedAt,
      pullRequestNumber: snapshot.pullRequestNumber ?? event.pull_request.number,
      pullRequestUrl,
    },
  };
}

export function applyPullRequestReviewWebhookToSnapshot(params: {
  snapshot: OpenClawCodeIssueStatusSnapshot;
  event: GitHubPullRequestReviewWebhookEvent;
}): GitHubLifecycleSnapshotUpdate {
  const { event, snapshot } = params;
  if (event.action !== "submitted") {
    return {
      accepted: false,
      reason: "unsupported-pull-request-review-action",
    };
  }

  if (snapshot.stage === "merged") {
    return {
      accepted: false,
      reason: "pull-request-already-merged",
    };
  }

  const decision = normalizeReviewDecision(event.review.state);
  if (!decision) {
    return {
      accepted: false,
      reason: "unsupported-review-state",
    };
  }

  const pullRequestUrl = event.pull_request.html_url ?? snapshot.pullRequestUrl;
  const updatedAt =
    event.review.submitted_at ?? event.pull_request.updated_at ?? snapshot.updatedAt;

  if (decision === "changes-requested") {
    const status = formatChangesRequestedStatus(snapshot, pullRequestUrl);
    if (!shouldApplyLifecycleUpdate({ snapshot, stage: "changes-requested", status, updatedAt })) {
      return {
        accepted: false,
        reason: "stale-or-unchanged-review",
      };
    }
    return {
      accepted: true,
      reason: "review-changes-requested",
      snapshot: {
        ...snapshot,
        stage: "changes-requested",
        status,
        updatedAt,
        pullRequestNumber: snapshot.pullRequestNumber ?? event.pull_request.number,
        pullRequestUrl,
        latestReviewDecision: "changes-requested",
        latestReviewSubmittedAt: event.review.submitted_at ?? undefined,
        latestReviewSummary: resolveReviewSummary(event, "changes-requested"),
        latestReviewUrl: event.review.html_url ?? undefined,
      },
    };
  }

  if (snapshot.stage !== "changes-requested" && snapshot.stage !== "ready-for-human-review") {
    return {
      accepted: false,
      reason: "review-not-applicable-to-current-stage",
    };
  }

  const status = formatApprovedReviewStatus(snapshot, pullRequestUrl);
  if (
    !shouldApplyLifecycleUpdate({ snapshot, stage: "ready-for-human-review", status, updatedAt })
  ) {
    return {
      accepted: false,
      reason: "stale-or-unchanged-review",
    };
  }
  return {
    accepted: true,
    reason: "review-approved",
    snapshot: {
      ...snapshot,
      stage: "ready-for-human-review",
      status,
      updatedAt,
      pullRequestNumber: snapshot.pullRequestNumber ?? event.pull_request.number,
      pullRequestUrl,
      latestReviewDecision: "approved",
      latestReviewSubmittedAt: event.review.submitted_at ?? undefined,
      latestReviewSummary: resolveReviewSummary(event, "approved"),
      latestReviewUrl: event.review.html_url ?? undefined,
    },
  };
}
