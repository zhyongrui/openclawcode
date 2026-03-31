import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenClawCodeChatopsStore } from "../integrations/openclaw-plugin/store.js";
import { writeProjectWorkItemInventory } from "./work-items.js";

function initGitRepo(repoRoot: string, remote: string): void {
  execFileSync("git", ["init"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["remote", "add", "origin", remote], {
    cwd: repoRoot,
    stdio: "ignore",
  });
}

async function writeAgreedBlueprint(repoRoot: string): Promise<void> {
  await writeFile(
    path.join(repoRoot, "PROJECT-BLUEPRINT.md"),
    [
      "---",
      "schemaVersion: 1",
      "title: Auto Advance Blueprint",
      "status: agreed",
      "createdAt: 2026-03-31T00:00:00.000Z",
      "updatedAt: 2026-03-31T00:00:00.000Z",
      "statusChangedAt: 2026-03-31T00:00:00.000Z",
      "agreedAt: 2026-03-31T00:00:00.000Z",
      "---",
      "",
      "# Auto Advance Blueprint",
      "",
      "## Goal",
      "Advance to the next work item after tracked work is merged.",
      "",
      "## Success Criteria",
      "- A merged tracked issue marks the linked work item completed.",
      "",
      "## Scope",
      "- In scope: repo-local work item status reconciliation.",
      "",
      "## Non-Goals",
      "- None.",
      "",
      "## Constraints",
      "- Keep the inventory machine-readable.",
      "",
      "## Risks",
      "- None.",
      "",
      "## Assumptions",
      "- The linked issue is already tracked by openclawcode.",
      "",
      "## Human Gates",
      "- Goal agreement: required",
      "",
      "## Provider Strategy",
      "- Coder: Codex",
      "",
      "## Workstreams",
      "- Build the interviewer task management slice.",
      "",
      "## Open Questions",
      "- None.",
      "",
      "## Change Log",
      "- 2026-03-31: baseline.",
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("writeProjectWorkItemInventory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("marks a linked work item completed after the tracked issue is merged", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "openclawcode-work-items-"));
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "openclawcode-work-items-state-"));
    initGitRepo(repoRoot, "git@github.com:zhyongrui/openclawcode.git");
    await writeAgreedBlueprint(repoRoot);
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);

    const initialInventory = await writeProjectWorkItemInventory(repoRoot);
    const [firstWorkItem] = initialInventory.workItems;
    expect(firstWorkItem).toBeDefined();

    const linkedInventory = {
      ...initialInventory,
      exists: true,
      workItems: initialInventory.workItems.map((item, index) =>
        index === 0
          ? {
              ...item,
              githubIssue: {
                current: {
                  issueNumber: 101,
                  issueUrl: "https://github.com/zhyongrui/openclawcode/issues/101",
                  issueTitle: "[Blueprint]: Build the interviewer task management slice.",
                  issueState: "open" as const,
                  linkedAt: "2026-03-31T00:05:00.000Z",
                  linkedFrom: "created" as const,
                  blueprintRevisionId: item.blueprintRevisionId,
                },
                history: [
                  {
                    issueNumber: 101,
                    issueUrl: "https://github.com/zhyongrui/openclawcode/issues/101",
                    issueTitle: "[Blueprint]: Build the interviewer task management slice.",
                    issueState: "open" as const,
                    linkedAt: "2026-03-31T00:05:00.000Z",
                    linkedFrom: "created" as const,
                    blueprintRevisionId: item.blueprintRevisionId,
                  },
                ],
              },
            }
          : item,
      ),
    };
    await writeFile(
      linkedInventory.inventoryPath,
      `${JSON.stringify(linkedInventory, null, 2)}\n`,
      "utf8",
    );

    const store = OpenClawCodeChatopsStore.fromStateDir(stateDir);
    await store.setStatusSnapshot({
      issueKey: "zhyongrui/openclawcode#101",
      status: "openclawcode status for zhyongrui/openclawcode#101\nStage: Merged",
      stage: "merged",
      runId: "run-101",
      updatedAt: "2026-03-31T00:10:00.000Z",
      owner: "zhyongrui",
      repo: "openclawcode",
      issueNumber: 101,
      notifyChannel: "telegram",
      notifyTarget: "chat:primary",
    });

    await writeProjectWorkItemInventory(repoRoot);
    const persisted = JSON.parse(
      await readFile(path.join(repoRoot, ".openclawcode", "work-items.json"), "utf8"),
    ) as {
      workItems: Array<{
        status: string;
        githubIssue: {
          current: {
            issueState: string;
          } | null;
        };
      }>;
    };

    expect(persisted.workItems[0]).toMatchObject({
      status: "completed",
      githubIssue: {
        current: {
          issueState: "closed",
        },
      },
    });
  });
});
