import fs from "node:fs/promises";
import path from "node:path";

import type { WorkflowRun } from "../contracts/index.js";

export interface WorkflowRunStore {
  save(run: WorkflowRun): Promise<WorkflowRun>;
  get(runId: string): Promise<WorkflowRun | undefined>;
  list(): Promise<WorkflowRun[]>;
}

function sortByCreatedAt(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export class FileSystemWorkflowRunStore implements WorkflowRunStore {
  constructor(private readonly rootDir: string) {}

  private getRunPath(runId: string): string {
    return path.join(this.rootDir, `${runId}.json`);
  }

  async save(run: WorkflowRun): Promise<WorkflowRun> {
    await fs.mkdir(this.rootDir, { recursive: true });

    const target = this.getRunPath(run.id);
    const temp = `${target}.tmp`;
    const body = JSON.stringify(run, null, 2);

    await fs.writeFile(temp, body, "utf8");
    await fs.rename(temp, target);

    return run;
  }

  async get(runId: string): Promise<WorkflowRun | undefined> {
    try {
      const body = await fs.readFile(this.getRunPath(runId), "utf8");
      return JSON.parse(body) as WorkflowRun;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async list(): Promise<WorkflowRun[]> {
    try {
      const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
      const runs = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const body = await fs.readFile(path.join(this.rootDir, entry.name), "utf8");
            return JSON.parse(body) as WorkflowRun;
          })
      );

      return sortByCreatedAt(runs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}
