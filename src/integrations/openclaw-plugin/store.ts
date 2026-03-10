import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowRun, WorkflowStage } from "../../openclawcode/contracts/index.js";
import type { OpenClawCodeChatopsRunRequest } from "./chatops.js";

export interface OpenClawCodeQueuedRun {
  request: OpenClawCodeChatopsRunRequest;
  notifyChannel: string;
  notifyTarget: string;
  issueKey: string;
}

export interface OpenClawCodePendingApproval {
  issueKey: string;
  notifyChannel: string;
  notifyTarget: string;
}

export interface OpenClawCodeIssueStatusSnapshot {
  issueKey: string;
  status: string;
  stage: WorkflowStage;
  runId: string;
  updatedAt: string;
  owner: string;
  repo: string;
  issueNumber: number;
  branchName?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
}

export interface OpenClawCodeRepoNotificationBinding {
  repoKey: string;
  notifyChannel: string;
  notifyTarget: string;
  updatedAt: string;
}

export interface OpenClawCodeGitHubDeliveryRecord {
  deliveryId: string;
  eventName: string;
  action: string;
  accepted: boolean;
  reason: string;
  receivedAt: string;
  issueKey?: string;
}

interface OpenClawCodeQueueState {
  version: 1;
  pendingApprovals: OpenClawCodePendingApproval[];
  queue: OpenClawCodeQueuedRun[];
  currentRun?: OpenClawCodeQueuedRun;
  statusByIssue: Record<string, string>;
  statusSnapshotsByIssue: Record<string, OpenClawCodeIssueStatusSnapshot>;
  repoBindingsByRepo: Record<string, OpenClawCodeRepoNotificationBinding>;
  githubDeliveriesById: Record<string, OpenClawCodeGitHubDeliveryRecord>;
}

const MAX_GITHUB_DELIVERY_RECORDS = 200;

function cloneDefaultState(): OpenClawCodeQueueState {
  return {
    version: 1,
    pendingApprovals: [],
    queue: [],
    statusByIssue: {},
    statusSnapshotsByIssue: {},
    repoBindingsByRepo: {},
    githubDeliveriesById: {},
  };
}

function normalizeStatusSnapshot(raw: unknown): OpenClawCodeIssueStatusSnapshot | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeIssueStatusSnapshot>;
  if (
    typeof candidate.issueKey !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.stage !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.owner !== "string" ||
    typeof candidate.repo !== "string" ||
    typeof candidate.issueNumber !== "number"
  ) {
    return undefined;
  }
  return {
    issueKey: candidate.issueKey,
    status: candidate.status,
    stage: candidate.stage,
    runId: candidate.runId,
    updatedAt: candidate.updatedAt,
    owner: candidate.owner,
    repo: candidate.repo,
    issueNumber: candidate.issueNumber,
    branchName: typeof candidate.branchName === "string" ? candidate.branchName : undefined,
    pullRequestNumber:
      typeof candidate.pullRequestNumber === "number" ? candidate.pullRequestNumber : undefined,
    pullRequestUrl:
      typeof candidate.pullRequestUrl === "string" ? candidate.pullRequestUrl : undefined,
  };
}

function normalizeRepoNotificationBinding(
  raw: unknown,
): OpenClawCodeRepoNotificationBinding | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeRepoNotificationBinding>;
  if (
    typeof candidate.repoKey !== "string" ||
    typeof candidate.notifyChannel !== "string" ||
    typeof candidate.notifyTarget !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    repoKey: candidate.repoKey,
    notifyChannel: candidate.notifyChannel,
    notifyTarget: candidate.notifyTarget,
    updatedAt: candidate.updatedAt,
  };
}

function normalizeGitHubDeliveryRecord(raw: unknown): OpenClawCodeGitHubDeliveryRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<OpenClawCodeGitHubDeliveryRecord>;
  if (
    typeof candidate.deliveryId !== "string" ||
    typeof candidate.eventName !== "string" ||
    typeof candidate.action !== "string" ||
    typeof candidate.accepted !== "boolean" ||
    typeof candidate.reason !== "string" ||
    typeof candidate.receivedAt !== "string"
  ) {
    return undefined;
  }
  return {
    deliveryId: candidate.deliveryId,
    eventName: candidate.eventName,
    action: candidate.action,
    accepted: candidate.accepted,
    reason: candidate.reason,
    receivedAt: candidate.receivedAt,
    issueKey: typeof candidate.issueKey === "string" ? candidate.issueKey : undefined,
  };
}

function buildStatusSnapshot(params: {
  run: WorkflowRun;
  status: string;
}): OpenClawCodeIssueStatusSnapshot {
  return {
    issueKey: `${params.run.issue.owner}/${params.run.issue.repo}#${params.run.issue.number}`,
    status: params.status,
    stage: params.run.stage,
    runId: params.run.id,
    updatedAt: params.run.updatedAt,
    owner: params.run.issue.owner,
    repo: params.run.issue.repo,
    issueNumber: params.run.issue.number,
    branchName: params.run.workspace?.branchName ?? params.run.buildResult?.branchName,
    pullRequestNumber: params.run.draftPullRequest?.number,
    pullRequestUrl: params.run.draftPullRequest?.url,
  };
}

function normalizeState(raw: unknown): OpenClawCodeQueueState {
  if (!raw || typeof raw !== "object") {
    return cloneDefaultState();
  }
  const candidate = raw as Partial<OpenClawCodeQueueState>;
  const statusSnapshotsByIssue = Object.fromEntries(
    Object.entries(
      candidate.statusSnapshotsByIssue && typeof candidate.statusSnapshotsByIssue === "object"
        ? candidate.statusSnapshotsByIssue
        : {},
    ).flatMap(([issueKey, value]) => {
      const snapshot = normalizeStatusSnapshot(value);
      return snapshot ? [[issueKey, snapshot]] : [];
    }),
  );
  const repoBindingsByRepo = Object.fromEntries(
    Object.entries(
      candidate.repoBindingsByRepo && typeof candidate.repoBindingsByRepo === "object"
        ? candidate.repoBindingsByRepo
        : {},
    ).flatMap(([repoKey, value]) => {
      const binding = normalizeRepoNotificationBinding(value);
      return binding ? [[repoKey, binding]] : [];
    }),
  );
  const githubDeliveriesById = Object.fromEntries(
    Object.entries(
      candidate.githubDeliveriesById && typeof candidate.githubDeliveriesById === "object"
        ? candidate.githubDeliveriesById
        : {},
    ).flatMap(([deliveryId, value]) => {
      const record = normalizeGitHubDeliveryRecord(value);
      return record ? [[deliveryId, record]] : [];
    }),
  );
  return {
    version: 1,
    pendingApprovals: Array.isArray(candidate.pendingApprovals) ? candidate.pendingApprovals : [],
    queue: Array.isArray(candidate.queue) ? candidate.queue : [],
    currentRun:
      candidate.currentRun && typeof candidate.currentRun === "object"
        ? candidate.currentRun
        : undefined,
    statusByIssue:
      candidate.statusByIssue && typeof candidate.statusByIssue === "object"
        ? candidate.statusByIssue
        : {},
    statusSnapshotsByIssue,
    repoBindingsByRepo,
    githubDeliveriesById,
  };
}

export class OpenClawCodeChatopsStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly statePath: string) {}

  static fromStateDir(stateDir: string): OpenClawCodeChatopsStore {
    return new OpenClawCodeChatopsStore(
      path.join(stateDir, "plugins", "openclawcode", "chatops-state.json"),
    );
  }

  private async loadState(): Promise<OpenClawCodeQueueState> {
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      return normalizeState(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return cloneDefaultState();
      }
      throw error;
    }
  }

  private async flushMutations(): Promise<void> {
    await this.mutationQueue;
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationQueue.catch(() => undefined);
    const next = pending.then(operation);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return await next;
  }

  private async mutateState<T>(
    mutator: (state: OpenClawCodeQueueState) => Promise<T> | T,
  ): Promise<T> {
    return await this.withMutationLock(async () => {
      const state = await this.loadState();
      const result = await mutator(state);
      await this.saveState(state);
      return result;
    });
  }

  private async saveState(state: OpenClawCodeQueueState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.statePath);
  }

  async getStatus(issueKey: string): Promise<string | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.statusByIssue[issueKey];
  }

  async getPendingApproval(issueKey: string): Promise<OpenClawCodePendingApproval | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.pendingApprovals.find((entry) => entry.issueKey === issueKey);
  }

  async getStatusSnapshot(issueKey: string): Promise<OpenClawCodeIssueStatusSnapshot | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.statusSnapshotsByIssue[issueKey];
  }

  async getRepoBinding(repoKey: string): Promise<OpenClawCodeRepoNotificationBinding | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.repoBindingsByRepo[repoKey];
  }

  async getGitHubDelivery(
    deliveryId: string,
  ): Promise<OpenClawCodeGitHubDeliveryRecord | undefined> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.githubDeliveriesById[deliveryId];
  }

  async setStatus(issueKey: string, status: string): Promise<void> {
    await this.mutateState((state) => {
      state.statusByIssue[issueKey] = status;
      const currentSnapshot = state.statusSnapshotsByIssue[issueKey];
      if (currentSnapshot) {
        state.statusSnapshotsByIssue[issueKey] = {
          ...currentSnapshot,
          status,
        };
      }
    });
  }

  async recordWorkflowRunStatus(run: WorkflowRun, status: string): Promise<void> {
    await this.mutateState((state) => {
      const snapshot = buildStatusSnapshot({ run, status });
      state.statusByIssue[snapshot.issueKey] = status;
      state.statusSnapshotsByIssue[snapshot.issueKey] = snapshot;
    });
  }

  async setStatusSnapshot(snapshot: OpenClawCodeIssueStatusSnapshot): Promise<void> {
    await this.mutateState((state) => {
      state.statusByIssue[snapshot.issueKey] = snapshot.status;
      state.statusSnapshotsByIssue[snapshot.issueKey] = snapshot;
    });
  }

  async setRepoBinding(params: {
    repoKey: string;
    notifyChannel: string;
    notifyTarget: string;
  }): Promise<OpenClawCodeRepoNotificationBinding> {
    return await this.mutateState((state) => {
      const binding: OpenClawCodeRepoNotificationBinding = {
        repoKey: params.repoKey,
        notifyChannel: params.notifyChannel,
        notifyTarget: params.notifyTarget,
        updatedAt: new Date().toISOString(),
      };
      state.repoBindingsByRepo[params.repoKey] = binding;
      return binding;
    });
  }

  async removeRepoBinding(repoKey: string): Promise<boolean> {
    return await this.mutateState((state) => {
      if (!state.repoBindingsByRepo[repoKey]) {
        return false;
      }
      delete state.repoBindingsByRepo[repoKey];
      return true;
    });
  }

  async recordGitHubDelivery(
    record: OpenClawCodeGitHubDeliveryRecord,
  ): Promise<OpenClawCodeGitHubDeliveryRecord> {
    return await this.mutateState((state) => {
      const existing = state.githubDeliveriesById[record.deliveryId];
      if (existing) {
        return existing;
      }
      state.githubDeliveriesById[record.deliveryId] = record;
      const deliveryIds = Object.keys(state.githubDeliveriesById);
      const overflow = deliveryIds.length - MAX_GITHUB_DELIVERY_RECORDS;
      if (overflow > 0) {
        for (const deliveryId of deliveryIds.slice(0, overflow)) {
          delete state.githubDeliveriesById[deliveryId];
        }
      }
      return record;
    });
  }

  async reconcileStatuses(statuses: Record<string, string>): Promise<void> {
    await this.mutateState((state) => {
      for (const [issueKey, status] of Object.entries(statuses)) {
        const isActive =
          state.pendingApprovals.some((entry) => entry.issueKey === issueKey) ||
          state.currentRun?.issueKey === issueKey ||
          state.queue.some((entry) => entry.issueKey === issueKey);
        if (isActive) {
          continue;
        }
        state.statusByIssue[issueKey] = status;
      }
    });
  }

  async reconcileWorkflowRunStatuses(
    records: Array<{
      issueKey: string;
      status: string;
      run: WorkflowRun;
    }>,
  ): Promise<void> {
    await this.mutateState((state) => {
      for (const record of records) {
        const isActive =
          state.pendingApprovals.some((entry) => entry.issueKey === record.issueKey) ||
          state.currentRun?.issueKey === record.issueKey ||
          state.queue.some((entry) => entry.issueKey === record.issueKey);
        if (isActive) {
          continue;
        }
        const currentSnapshot = state.statusSnapshotsByIssue[record.issueKey];
        if (currentSnapshot && currentSnapshot.updatedAt > record.run.updatedAt) {
          continue;
        }
        state.statusByIssue[record.issueKey] = record.status;
        state.statusSnapshotsByIssue[record.issueKey] = buildStatusSnapshot(record);
      }
    });
  }

  async addPendingApproval(
    pending: OpenClawCodePendingApproval,
    status = "Awaiting chat approval.",
  ): Promise<boolean> {
    return await this.mutateState((state) => {
      if (
        state.pendingApprovals.some((entry) => entry.issueKey === pending.issueKey) ||
        state.currentRun?.issueKey === pending.issueKey ||
        state.queue.some((entry) => entry.issueKey === pending.issueKey)
      ) {
        return false;
      }
      state.pendingApprovals.push(pending);
      state.statusByIssue[pending.issueKey] = status;
      return true;
    });
  }

  async consumePendingApproval(issueKey: string): Promise<OpenClawCodePendingApproval | undefined> {
    return await this.mutateState((state) => {
      const index = state.pendingApprovals.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return undefined;
      }
      const [pending] = state.pendingApprovals.splice(index, 1);
      return pending;
    });
  }

  async removePendingApproval(
    issueKey: string,
    status = "Skipped before execution.",
  ): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.pendingApprovals.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.pendingApprovals.splice(index, 1);
      state.statusByIssue[issueKey] = status;
      return true;
    });
  }

  async isPendingApproval(issueKey: string): Promise<boolean> {
    await this.flushMutations();
    const state = await this.loadState();
    return state.pendingApprovals.some((entry) => entry.issueKey === issueKey);
  }

  async isQueuedOrRunning(issueKey: string): Promise<boolean> {
    await this.flushMutations();
    const state = await this.loadState();
    return (
      state.currentRun?.issueKey === issueKey ||
      state.queue.some((entry) => entry.issueKey === issueKey)
    );
  }

  async enqueue(run: OpenClawCodeQueuedRun, status = "Queued."): Promise<boolean> {
    return await this.mutateState((state) => {
      if (
        state.pendingApprovals.some((entry) => entry.issueKey === run.issueKey) ||
        state.currentRun?.issueKey === run.issueKey ||
        state.queue.some((entry) => entry.issueKey === run.issueKey)
      ) {
        return false;
      }
      state.queue.push(run);
      state.statusByIssue[run.issueKey] = status;
      return true;
    });
  }

  async promotePendingApprovalToQueue(params: {
    issueKey: string;
    request: OpenClawCodeChatopsRunRequest;
    fallbackNotifyChannel: string;
    fallbackNotifyTarget: string;
    status?: string;
  }): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      if (
        state.currentRun?.issueKey === params.issueKey ||
        state.queue.some((entry) => entry.issueKey === params.issueKey)
      ) {
        return undefined;
      }

      const pendingIndex = state.pendingApprovals.findIndex(
        (entry) => entry.issueKey === params.issueKey,
      );
      const pending = pendingIndex >= 0 ? state.pendingApprovals[pendingIndex] : undefined;
      if (pendingIndex >= 0) {
        state.pendingApprovals.splice(pendingIndex, 1);
      }

      const queuedRun: OpenClawCodeQueuedRun = {
        issueKey: params.issueKey,
        request: params.request,
        notifyChannel: pending?.notifyChannel ?? params.fallbackNotifyChannel,
        notifyTarget: pending?.notifyTarget ?? params.fallbackNotifyTarget,
      };
      state.queue.push(queuedRun);
      state.statusByIssue[params.issueKey] = params.status ?? "Queued.";
      return queuedRun;
    });
  }

  async removeQueued(issueKey: string, status = "Skipped before execution."): Promise<boolean> {
    return await this.mutateState((state) => {
      const index = state.queue.findIndex((entry) => entry.issueKey === issueKey);
      if (index < 0) {
        return false;
      }
      state.queue.splice(index, 1);
      state.statusByIssue[issueKey] = status;
      return true;
    });
  }

  async startNext(status = "Running."): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      if (state.currentRun) {
        return undefined;
      }
      const next = state.queue.shift();
      if (!next) {
        return undefined;
      }
      state.currentRun = next;
      state.statusByIssue[next.issueKey] = status;
      return next;
    });
  }

  async finishCurrent(issueKey: string, status: string): Promise<void> {
    await this.mutateState((state) => {
      if (state.currentRun?.issueKey !== issueKey) {
        return;
      }
      state.currentRun = undefined;
      state.statusByIssue[issueKey] = status;
    });
  }

  async recoverInterruptedRun(
    status = "Recovered after restart; waiting to resume.",
  ): Promise<OpenClawCodeQueuedRun | undefined> {
    return await this.mutateState((state) => {
      const current = state.currentRun;
      if (!current) {
        return undefined;
      }
      state.currentRun = undefined;
      if (!state.queue.some((entry) => entry.issueKey === current.issueKey)) {
        state.queue.unshift(current);
      }
      state.statusByIssue[current.issueKey] = status;
      return current;
    });
  }

  async snapshot(): Promise<OpenClawCodeQueueState> {
    await this.flushMutations();
    return await this.loadState();
  }
}
