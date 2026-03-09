import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { orchestrateIssue } from "../orchestrator/index.js";
import { FileSystemWorkflowRunStore } from "../persistence/index.js";
import { FakeBuilder, FakePlanner, FakeVerifier } from "./fakes.js";

function createSequenceNow(startAt = Date.UTC(2026, 2, 9, 12, 0, 0)): () => string {
  let tick = 0;
  return () => new Date(startAt + tick++ * 1_000).toISOString();
}

describe("openclawcode orchestrator", () => {
  it("drives an issue to ready-for-human-review when verification approves", async () => {
    const run = await orchestrateIssue(
      {
        owner: "openclaw",
        repo: "openclawcode",
        number: 42,
        title: "Prototype GitHub workflow engine"
      },
      {
        planner: new FakePlanner(),
        builder: new FakeBuilder(),
        verifier: new FakeVerifier(true)
      },
      {
        now: createSequenceNow()
      }
    );

    expect(run.stage).toBe("ready-for-human-review");
    expect(run.attempts).toEqual({
      total: 3,
      planning: 1,
      building: 1,
      verifying: 1
    });
    expect(run.executionSpec?.acceptanceCriteria).toHaveLength(1);
    expect(run.buildResult?.branchName).toBe("issue/42");
    expect(run.draftPullRequest?.branchName).toBe("issue/42");
    expect(run.verificationReport?.summary).toMatch(/ready for human review/);
    expect(run.stageRecords.map((record) => record.toStage)).toEqual([
      "intake",
      "planning",
      "building",
      "draft-pr-opened",
      "verifying",
      "ready-for-human-review"
    ]);
    expect(run.history).toEqual([
      "Workflow created from issue intake",
      "Planning started",
      "Planning completed",
      "Build started",
      "Build completed and draft PR prepared",
      "Verification started",
      "Verification approved for human review"
    ]);
  });

  it("moves to changes-requested when verification requests revision", async () => {
    const run = await orchestrateIssue(
      {
        owner: "openclaw",
        repo: "openclawcode",
        number: 43,
        title: "Handle failed verification"
      },
      {
        planner: new FakePlanner(),
        builder: new FakeBuilder(),
        verifier: new FakeVerifier(false)
      },
      {
        now: createSequenceNow()
      }
    );

    expect(run.stage).toBe("changes-requested");
    expect(run.verificationReport?.decision).toBe("request-changes");
  });

  it("persists snapshots after each major transition when a store is configured", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclawcode-run-store-"));

    try {
      const run = await orchestrateIssue(
        {
          owner: "openclaw",
          repo: "openclawcode",
          number: 44,
          title: "Persist workflow runs"
        },
        {
          planner: new FakePlanner(),
          builder: new FakeBuilder(),
          verifier: new FakeVerifier(true)
        },
        {
          now: createSequenceNow(),
          store: new FileSystemWorkflowRunStore(rootDir)
        }
      );

      const store = new FileSystemWorkflowRunStore(rootDir);
      const stored = await store.get(run.id);
      const listed = await store.list();

      expect(stored).toEqual(run);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.stage).toBe("ready-for-human-review");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
