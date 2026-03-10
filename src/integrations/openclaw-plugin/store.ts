import fs from "node:fs/promises";
import path from "node:path";
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

interface OpenClawCodeQueueState {
  version: 1;
  pendingApprovals: OpenClawCodePendingApproval[];
  queue: OpenClawCodeQueuedRun[];
  currentRun?: OpenClawCodeQueuedRun;
  statusByIssue: Record<string, string>;
}

function cloneDefaultState(): OpenClawCodeQueueState {
  return {
    version: 1,
    pendingApprovals: [],
    queue: [],
    statusByIssue: {},
  };
}

function normalizeState(raw: unknown): OpenClawCodeQueueState {
  if (!raw || typeof raw !== "object") {
    return cloneDefaultState();
  }
  const candidate = raw as Partial<OpenClawCodeQueueState>;
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
  };
}

export class OpenClawCodeChatopsStore {
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

  private async saveState(state: OpenClawCodeQueueState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.statePath);
  }

  async getStatus(issueKey: string): Promise<string | undefined> {
    const state = await this.loadState();
    return state.statusByIssue[issueKey];
  }

  async getPendingApproval(issueKey: string): Promise<OpenClawCodePendingApproval | undefined> {
    const state = await this.loadState();
    return state.pendingApprovals.find((entry) => entry.issueKey === issueKey);
  }

  async setStatus(issueKey: string, status: string): Promise<void> {
    const state = await this.loadState();
    state.statusByIssue[issueKey] = status;
    await this.saveState(state);
  }

  async reconcileStatuses(statuses: Record<string, string>): Promise<void> {
    const state = await this.loadState();
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
    await this.saveState(state);
  }

  async addPendingApproval(
    pending: OpenClawCodePendingApproval,
    status = "Awaiting chat approval.",
  ): Promise<boolean> {
    const state = await this.loadState();
    if (
      state.pendingApprovals.some((entry) => entry.issueKey === pending.issueKey) ||
      state.currentRun?.issueKey === pending.issueKey ||
      state.queue.some((entry) => entry.issueKey === pending.issueKey)
    ) {
      return false;
    }
    state.pendingApprovals.push(pending);
    state.statusByIssue[pending.issueKey] = status;
    await this.saveState(state);
    return true;
  }

  async consumePendingApproval(issueKey: string): Promise<OpenClawCodePendingApproval | undefined> {
    const state = await this.loadState();
    const index = state.pendingApprovals.findIndex((entry) => entry.issueKey === issueKey);
    if (index < 0) {
      return undefined;
    }
    const [pending] = state.pendingApprovals.splice(index, 1);
    await this.saveState(state);
    return pending;
  }

  async removePendingApproval(
    issueKey: string,
    status = "Skipped before execution.",
  ): Promise<boolean> {
    const state = await this.loadState();
    const index = state.pendingApprovals.findIndex((entry) => entry.issueKey === issueKey);
    if (index < 0) {
      return false;
    }
    state.pendingApprovals.splice(index, 1);
    state.statusByIssue[issueKey] = status;
    await this.saveState(state);
    return true;
  }

  async isPendingApproval(issueKey: string): Promise<boolean> {
    const state = await this.loadState();
    return state.pendingApprovals.some((entry) => entry.issueKey === issueKey);
  }

  async isQueuedOrRunning(issueKey: string): Promise<boolean> {
    const state = await this.loadState();
    return (
      state.currentRun?.issueKey === issueKey ||
      state.queue.some((entry) => entry.issueKey === issueKey)
    );
  }

  async enqueue(run: OpenClawCodeQueuedRun, status = "Queued."): Promise<boolean> {
    const state = await this.loadState();
    if (
      state.pendingApprovals.some((entry) => entry.issueKey === run.issueKey) ||
      state.currentRun?.issueKey === run.issueKey ||
      state.queue.some((entry) => entry.issueKey === run.issueKey)
    ) {
      return false;
    }
    state.queue.push(run);
    state.statusByIssue[run.issueKey] = status;
    await this.saveState(state);
    return true;
  }

  async promotePendingApprovalToQueue(params: {
    issueKey: string;
    request: OpenClawCodeChatopsRunRequest;
    fallbackNotifyChannel: string;
    fallbackNotifyTarget: string;
    status?: string;
  }): Promise<OpenClawCodeQueuedRun | undefined> {
    const state = await this.loadState();
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
    await this.saveState(state);
    return queuedRun;
  }

  async removeQueued(issueKey: string, status = "Skipped before execution."): Promise<boolean> {
    const state = await this.loadState();
    const index = state.queue.findIndex((entry) => entry.issueKey === issueKey);
    if (index < 0) {
      return false;
    }
    state.queue.splice(index, 1);
    state.statusByIssue[issueKey] = status;
    await this.saveState(state);
    return true;
  }

  async startNext(status = "Running."): Promise<OpenClawCodeQueuedRun | undefined> {
    const state = await this.loadState();
    if (state.currentRun) {
      return undefined;
    }
    const next = state.queue.shift();
    if (!next) {
      return undefined;
    }
    state.currentRun = next;
    state.statusByIssue[next.issueKey] = status;
    await this.saveState(state);
    return next;
  }

  async finishCurrent(issueKey: string, status: string): Promise<void> {
    const state = await this.loadState();
    if (state.currentRun?.issueKey === issueKey) {
      state.currentRun = undefined;
    }
    state.statusByIssue[issueKey] = status;
    await this.saveState(state);
  }

  async recoverInterruptedRun(
    status = "Recovered after restart; waiting to resume.",
  ): Promise<OpenClawCodeQueuedRun | undefined> {
    const state = await this.loadState();
    const current = state.currentRun;
    if (!current) {
      return undefined;
    }
    state.currentRun = undefined;
    if (!state.queue.some((entry) => entry.issueKey === current.issueKey)) {
      state.queue.unshift(current);
    }
    state.statusByIssue[current.issueKey] = status;
    await this.saveState(state);
    return current;
  }

  async snapshot(): Promise<OpenClawCodeQueueState> {
    return await this.loadState();
  }
}
