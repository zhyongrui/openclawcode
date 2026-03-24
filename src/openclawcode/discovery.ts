import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveConfigDir } from "../utils.js";
import {
  inspectProjectBlueprintClarifications,
  readProjectBlueprintDocument,
  type ProjectBlueprintRoleAssignments,
} from "./blueprint.js";
import { resolveGitHubRepoFromGit } from "./github/index.js";
import { readOpenClawCodeOperatorStatusSnapshot } from "./operator-status.js";
import { readProjectPromotionGateArtifact } from "./promotion-artifacts.js";
import { readProjectWorkItemInventory, type ProjectWorkItem } from "./work-items.js";

export const PROJECT_DISCOVERY_SCHEMA_VERSION = 1;
export const PROJECT_DISCOVERY_SEVERITIES = ["low", "medium", "high"] as const;
export const PROJECT_DISCOVERY_PRIORITIES = ["low", "medium", "high"] as const;

export type ProjectDiscoverySeverity = (typeof PROJECT_DISCOVERY_SEVERITIES)[number];
export type ProjectDiscoveryPriority = (typeof PROJECT_DISCOVERY_PRIORITIES)[number];
export type ProjectDiscoverySource =
  | "blueprint-open-questions"
  | "work-item-artifact-missing"
  | "work-item-artifact-stale"
  | "setup-check-regression"
  | "provider-pause-active"
  | "upstream-sync-drift"
  | "tracked-run-failed"
  | "tracked-run-changes-requested";

export interface ProjectDiscoveryEvidence {
  id: string;
  dedupeKey: string;
  source: ProjectDiscoverySource;
  severity: ProjectDiscoverySeverity;
  priority: ProjectDiscoveryPriority;
  summary: string;
  detail: string;
  discoveredWorkItem: ProjectWorkItem;
}

export interface ProjectDiscoveryInventory {
  repoRoot: string;
  inventoryPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  workItemInventoryExists: boolean;
  workItemInventoryPath: string;
  workItemArtifactStale: boolean | null;
  evidenceCount: number;
  blockerCount: number;
  blockers: string[];
  discoveredWorkItemCount: number;
  highestPriority: ProjectDiscoveryPriority | null;
  evidence: ProjectDiscoveryEvidence[];
}

function resolveProjectDiscoveryInventoryPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "discovery-work-items.json");
}

function compareDiscoveryPriority(
  left: ProjectDiscoveryPriority,
  right: ProjectDiscoveryPriority,
): number {
  const order: ProjectDiscoveryPriority[] = ["low", "medium", "high"];
  return order.indexOf(left) - order.indexOf(right);
}

function highestDiscoveryPriority(
  priorities: ProjectDiscoveryPriority[],
): ProjectDiscoveryPriority | null {
  if (priorities.length === 0) {
    return null;
  }
  return [...priorities].toSorted(compareDiscoveryPriority).at(-1) ?? null;
}

function discoveredIssueDraft(params: {
  title: string;
  summary: string;
  detail: string;
  severity: ProjectDiscoverySeverity;
  priority: ProjectDiscoveryPriority;
  dedupeKey: string;
}): { title: string; body: string } {
  return {
    title: `[Discovery]: ${params.title}`,
    body: [
      "Summary",
      params.summary,
      "",
      "Evidence",
      `- Severity: ${params.severity}`,
      `- Priority: ${params.priority}`,
      `- Dedupe key: ${params.dedupeKey}`,
      `- Detail: ${params.detail}`,
      "",
      "Proposed next step",
      "- Convert this discovered work item into an operator-reviewed execution issue or refresh the repo-local artifacts directly.",
    ].join("\n"),
  };
}

function makeDiscoveredWorkItem(params: {
  id: string;
  title: string;
  summary: string;
  source: ProjectDiscoveryEvidence["source"];
  blueprintPath: string;
  blueprintRevisionId: string | null;
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
  detail: string;
  severity: ProjectDiscoverySeverity;
  priority: ProjectDiscoveryPriority;
  dedupeKey: string;
}): ProjectWorkItem {
  const executionMode = resolveDiscoveryExecutionMode(params.source);
  const workItemClass = resolveDiscoveryWorkItemClass(params.source);
  return {
    id: params.id,
    kind: "discovered",
    status: "planned",
    class: workItemClass,
    executionMode,
    fingerprint: params.dedupeKey,
    title: params.title,
    summary: params.summary,
    source: "blueprint",
    sourceSection: "Workstreams",
    workstreamIndex: 0,
    blueprintPath: params.blueprintPath,
    blueprintRevisionId: params.blueprintRevisionId,
    acceptanceCriteria: [
      "Capture the underlying evidence in a stable artifact or issue body.",
      "Leave the repository in a state where the discovered condition is no longer true.",
    ],
    openQuestions: [],
    humanGates: ["Operator may review discovered work items before issue projection."],
    providerRoleAssignments: params.providerRoleAssignments,
    githubIssueDraft: discoveredIssueDraft({
      title: params.title,
      summary: params.summary,
      detail: params.detail,
      severity: params.severity,
      priority: params.priority,
      dedupeKey: params.dedupeKey,
    }),
    githubIssue: {
      current: null,
      history: [],
    },
  };
}

function resolveDiscoveryExecutionMode(
  source: ProjectDiscoverySource,
): ProjectWorkItem["executionMode"] {
  switch (source) {
    case "blueprint-open-questions":
      return "research";
    case "setup-check-regression":
    case "provider-pause-active":
    case "tracked-run-failed":
    case "tracked-run-changes-requested":
      return "bugfix";
    default:
      return "feature";
  }
}

function resolveDiscoveryWorkItemClass(
  source: ProjectDiscoverySource,
): ProjectWorkItem["class"] {
  switch (source) {
    case "work-item-artifact-missing":
    case "work-item-artifact-stale":
    case "upstream-sync-drift":
      return "sync";
    case "setup-check-regression":
      return "validation";
    case "provider-pause-active":
    case "tracked-run-failed":
      return "incident";
    case "tracked-run-changes-requested":
      return "bugfix";
    default:
      return "feature";
  }
}

function runGitCommand(repoRoot: string, args: string[]): string | null {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  const stdout = result.stdout.trim();
  return stdout.length > 0 ? stdout : null;
}

function extractStatusSummary(status: string): string | null {
  const summaryLine = status
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("Summary: "));
  if (!summaryLine) {
    return null;
  }
  const summary = summaryLine.slice("Summary: ".length).trim();
  return summary.length > 0 ? summary : null;
}

function resolveUpstreamBranchRef(repoRoot: string): { ref: string; label: string } | null {
  const remoteHead = runGitCommand(repoRoot, ["symbolic-ref", "--short", "refs/remotes/upstream/HEAD"]);
  if (remoteHead?.startsWith("upstream/")) {
    return {
      ref: `refs/remotes/${remoteHead}`,
      label: remoteHead,
    };
  }
  for (const candidate of ["main", "master"]) {
    const ref = `refs/remotes/upstream/${candidate}`;
    if (runGitCommand(repoRoot, ["rev-parse", "--verify", ref])) {
      return {
        ref,
        label: `upstream/${candidate}`,
      };
    }
  }
  return null;
}

function readUpstreamSyncStatus(repoRoot: string): {
  currentBranch: string;
  upstreamLabel: string;
  ahead: number;
  behind: number;
} | null {
  const currentBranch = runGitCommand(repoRoot, ["branch", "--show-current"]);
  const upstream = resolveUpstreamBranchRef(repoRoot);
  if (!currentBranch || !upstream) {
    return null;
  }
  const counts = runGitCommand(repoRoot, ["rev-list", "--left-right", "--count", `HEAD...${upstream.ref}`]);
  if (!counts) {
    return null;
  }
  const match = /^(\d+)\s+(\d+)$/.exec(counts);
  if (!match) {
    return null;
  }
  return {
    currentBranch,
    upstreamLabel: upstream.label,
    ahead: Number.parseInt(match[1] ?? "0", 10),
    behind: Number.parseInt(match[2] ?? "0", 10),
  };
}

async function collectRuntimeDiscoveryEvidence(params: {
  repoRoot: string;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
}): Promise<ProjectDiscoveryEvidence[]> {
  const evidence: ProjectDiscoveryEvidence[] = [];
  const promotion = await readProjectPromotionGateArtifact(params.repoRoot);
  if (
    promotion.setupCheckAvailable &&
    (promotion.setupCheckOk === false || promotion.promotionReady === false)
  ) {
    const dedupeKey = `setup-check-regression:${promotion.branchName ?? "unknown"}:${promotion.nextAction ?? "unknown"}:${promotion.summaryFail ?? 0}`;
    evidence.push({
      id: "discovery-setup-check-regression",
      dedupeKey,
      source: "setup-check-regression",
      severity: "high",
      priority: "high",
      summary: "Fix the operator setup-check regression before continued blueprint execution.",
      detail:
        `The repo-local promotion gate reports setup-check regression state (ok=${promotion.setupCheckOk ?? "unknown"}, promotionReady=${promotion.promotionReady ?? "unknown"}, nextAction=${promotion.nextAction ?? "unknown"}).`,
      discoveredWorkItem: makeDiscoveredWorkItem({
        id: "discovered-fix-setup-check-regression",
        title: "Fix the operator setup-check regression before continued blueprint execution.",
        summary:
          "Inspect the failing setup-check, restore strict readiness, and bring promotion gating back to a passing state.",
        source: "setup-check-regression",
        blueprintPath: params.blueprintPath,
        blueprintRevisionId: params.blueprintRevisionId,
        providerRoleAssignments: params.providerRoleAssignments,
        detail:
          `The repo-local promotion gate reports setup-check regression state (ok=${promotion.setupCheckOk ?? "unknown"}, promotionReady=${promotion.promotionReady ?? "unknown"}, nextAction=${promotion.nextAction ?? "unknown"}).`,
        severity: "high",
        priority: "high",
        dedupeKey,
      }),
    });
  }

  const stateDir = resolveConfigDir();
  const operator = await readOpenClawCodeOperatorStatusSnapshot(stateDir).catch(() => null);
  const repoRef = await resolveGitHubRepoFromGit(params.repoRoot).catch(() => null);
  const repoKey = repoRef ? `${repoRef.owner}/${repoRef.repo}` : null;
  if (operator?.exists && operator.providerPauseActive && repoKey) {
    const trackedRepo = operator.repos.find((entry) => entry.repoKey === repoKey);
    if (trackedRepo) {
      const dedupeKey = `provider-pause-active:${repoKey}:${operator.providerPause?.until ?? "unknown"}:${operator.providerPause?.reason ?? "unknown"}`;
      evidence.push({
        id: "discovery-provider-pause-active",
        dedupeKey,
        source: "provider-pause-active",
        severity: "high",
        priority: "high",
        summary: "Investigate the active provider pause before autonomous execution resumes.",
        detail:
          `The operator state for ${repoKey} currently has an active provider pause (reason=${operator.providerPause?.reason ?? "unknown"}, until=${operator.providerPause?.until ?? "unknown"}).`,
        discoveredWorkItem: makeDiscoveredWorkItem({
          id: "discovered-investigate-provider-pause",
          title: "Investigate the active provider pause before autonomous execution resumes.",
          summary:
            "Review the paused provider state, confirm the triggering failure, and decide whether to clear, reroute, or keep the pause in place.",
          source: "provider-pause-active",
          blueprintPath: params.blueprintPath,
          blueprintRevisionId: params.blueprintRevisionId,
          providerRoleAssignments: params.providerRoleAssignments,
          detail:
            `The operator state for ${repoKey} currently has an active provider pause (reason=${operator.providerPause?.reason ?? "unknown"}, until=${operator.providerPause?.until ?? "unknown"}).`,
          severity: "high",
          priority: "high",
          dedupeKey,
        }),
      });
    }
  }

  if (operator?.exists && repoKey) {
    const trackedSnapshots = operator.issueSnapshots.filter(
      (snapshot) => `${snapshot.owner}/${snapshot.repo}` === repoKey,
    );
    for (const snapshot of trackedSnapshots) {
      const summary = extractStatusSummary(snapshot.status);
      if (snapshot.stage === "failed") {
        const dedupeKey = `tracked-run-failed:${snapshot.issueKey}:${snapshot.runId}:${snapshot.updatedAt}`;
        const detail = [
          `The operator state records ${snapshot.issueKey} at Failed (run=${snapshot.runId}, updatedAt=${snapshot.updatedAt}).`,
          summary ? `Latest summary: ${summary}` : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        evidence.push({
          id: `discovery-tracked-run-failed-${snapshot.issueNumber}`,
          dedupeKey,
          source: "tracked-run-failed",
          severity: "high",
          priority: "high",
          summary: `Investigate the failed tracked run for ${snapshot.issueKey} before continuing autonomous work.`,
          detail,
          discoveredWorkItem: makeDiscoveredWorkItem({
            id: `discovered-investigate-failed-run-${snapshot.issueNumber}`,
            title: `Investigate the failed tracked run for ${snapshot.issueKey} before continuing autonomous work.`,
            summary:
              summary ??
              `Review the failed tracked run for ${snapshot.issueKey}, confirm the root cause, and either fix it or consciously defer it.`,
            source: "tracked-run-failed",
            blueprintPath: params.blueprintPath,
            blueprintRevisionId: params.blueprintRevisionId,
            providerRoleAssignments: params.providerRoleAssignments,
            detail,
            severity: "high",
            priority: "high",
            dedupeKey,
          }),
        });
      }

      if (snapshot.stage === "changes-requested") {
        const dedupeKey = `tracked-run-changes-requested:${snapshot.issueKey}:${snapshot.runId}:${snapshot.updatedAt}`;
        const detail = [
          `The operator state records ${snapshot.issueKey} at Changes Requested (run=${snapshot.runId}, updatedAt=${snapshot.updatedAt}).`,
          summary ? `Latest summary: ${summary}` : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        evidence.push({
          id: `discovery-tracked-run-changes-requested-${snapshot.issueNumber}`,
          dedupeKey,
          source: "tracked-run-changes-requested",
          severity: "medium",
          priority: "medium",
          summary: `Address the requested changes for ${snapshot.issueKey} before selecting new autonomous work.`,
          detail,
          discoveredWorkItem: makeDiscoveredWorkItem({
            id: `discovered-address-requested-changes-${snapshot.issueNumber}`,
            title: `Address the requested changes for ${snapshot.issueKey} before selecting new autonomous work.`,
            summary:
              summary ??
              `Review the requested changes for ${snapshot.issueKey}, update the implementation plan, and rerun with a clear response to the feedback.`,
            source: "tracked-run-changes-requested",
            blueprintPath: params.blueprintPath,
            blueprintRevisionId: params.blueprintRevisionId,
            providerRoleAssignments: params.providerRoleAssignments,
            detail,
            severity: "medium",
            priority: "medium",
            dedupeKey,
          }),
        });
      }
    }
  }

  const syncStatus = readUpstreamSyncStatus(params.repoRoot);
  if (
    syncStatus &&
    ((syncStatus.currentBranch.startsWith("sync/") && (syncStatus.ahead > 0 || syncStatus.behind > 0)) ||
      ((syncStatus.currentBranch === "main" || syncStatus.currentBranch === "master") &&
        syncStatus.behind > 0))
  ) {
    const dedupeKey = `upstream-sync-drift:${syncStatus.currentBranch}:${syncStatus.upstreamLabel}:${syncStatus.ahead}:${syncStatus.behind}`;
    evidence.push({
      id: "discovery-upstream-sync-drift",
      dedupeKey,
      source: "upstream-sync-drift",
      severity: syncStatus.behind > 0 ? "high" : "medium",
      priority: "high",
      summary: "Refresh the current branch against upstream before continuing blueprint execution.",
      detail:
        `The current branch ${syncStatus.currentBranch} differs from ${syncStatus.upstreamLabel} (ahead=${syncStatus.ahead}, behind=${syncStatus.behind}).`,
      discoveredWorkItem: makeDiscoveredWorkItem({
        id: "discovered-refresh-upstream-sync-drift",
        title: "Refresh the current branch against upstream before continuing blueprint execution.",
        summary:
          `Reconcile ${syncStatus.currentBranch} with ${syncStatus.upstreamLabel} so blueprint-backed work resumes from a current upstream baseline.`,
        source: "upstream-sync-drift",
        blueprintPath: params.blueprintPath,
        blueprintRevisionId: params.blueprintRevisionId,
        providerRoleAssignments: params.providerRoleAssignments,
        detail:
          `The current branch ${syncStatus.currentBranch} differs from ${syncStatus.upstreamLabel} (ahead=${syncStatus.ahead}, behind=${syncStatus.behind}).`,
        severity: syncStatus.behind > 0 ? "high" : "medium",
        priority: "high",
        dedupeKey,
      }),
    });
  }

  return evidence;
}

function emptyProjectDiscoveryInventory(params: {
  repoRoot: string;
  inventoryPath: string;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  workItemInventoryExists: boolean;
  workItemInventoryPath: string;
  workItemArtifactStale: boolean | null;
}): ProjectDiscoveryInventory {
  return {
    repoRoot: params.repoRoot,
    inventoryPath: params.inventoryPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.blueprintExists,
    blueprintPath: params.blueprintPath,
    blueprintRevisionId: params.blueprintRevisionId,
    workItemInventoryExists: params.workItemInventoryExists,
    workItemInventoryPath: params.workItemInventoryPath,
    workItemArtifactStale: params.workItemArtifactStale,
    evidenceCount: 0,
    blockerCount: 0,
    blockers: [],
    discoveredWorkItemCount: 0,
    highestPriority: null,
    evidence: [],
  };
}

export async function deriveProjectDiscoveryInventory(
  repoRootInput: string,
): Promise<ProjectDiscoveryInventory> {
  const repoRoot = path.resolve(repoRootInput);
  const inventoryPath = resolveProjectDiscoveryInventoryPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const clarification = await inspectProjectBlueprintClarifications(repoRoot);
  const workItems = await readProjectWorkItemInventory(repoRoot);
  const blockers = [...clarification.questions].toSorted();

  if (!blueprint.exists) {
    return {
      ...emptyProjectDiscoveryInventory({
        repoRoot,
        inventoryPath,
        blueprintExists: false,
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: null,
        workItemInventoryExists: workItems.exists,
        workItemInventoryPath: workItems.inventoryPath,
        workItemArtifactStale: workItems.artifactStale,
      }),
      blockerCount: blockers.length,
      blockers,
    };
  }

  const evidence: ProjectDiscoveryEvidence[] = [];

  if (blueprint.hasAgreementCheckpoint && !workItems.exists) {
    const dedupeKey = `work-item-artifact-missing:${blueprint.revisionId ?? "none"}`;
    evidence.push({
      id: "discovery-work-item-artifact-missing",
      dedupeKey,
      source: "work-item-artifact-missing",
      severity: "high",
      priority: "high",
      summary: "Generate the repo-local work-item inventory for the agreed blueprint.",
      detail:
        "The blueprint is already agreed, but `.openclawcode/work-items.json` does not exist yet.",
      discoveredWorkItem: makeDiscoveredWorkItem({
        id: "discovered-refresh-missing-work-item-artifact",
        title: "Generate the repo-local work-item inventory for the agreed blueprint.",
        summary: "Create `.openclawcode/work-items.json` from the current agreed blueprint.",
        source: "work-item-artifact-missing",
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        providerRoleAssignments: blueprint.providerRoleAssignments,
        detail:
          "The blueprint is already agreed, but `.openclawcode/work-items.json` does not exist yet.",
        severity: "high",
        priority: "high",
        dedupeKey,
      }),
    });
  }

  if (workItems.exists && workItems.artifactStale) {
    const dedupeKey = `work-item-artifact-stale:${blueprint.revisionId ?? "none"}`;
    evidence.push({
      id: "discovery-work-item-artifact-stale",
      dedupeKey,
      source: "work-item-artifact-stale",
      severity: "medium",
      priority: "high",
      summary: "Refresh the repo-local work-item inventory after blueprint changes.",
      detail:
        "The current `PROJECT-BLUEPRINT.md` revision no longer matches the persisted work-item artifact.",
      discoveredWorkItem: makeDiscoveredWorkItem({
        id: "discovered-refresh-stale-work-item-artifact",
        title: "Refresh the repo-local work-item inventory after blueprint changes.",
        summary:
          "Regenerate `.openclawcode/work-items.json` so the persisted backlog matches the current blueprint revision.",
        source: "work-item-artifact-stale",
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        providerRoleAssignments: blueprint.providerRoleAssignments,
        detail:
          "The current `PROJECT-BLUEPRINT.md` revision no longer matches the persisted work-item artifact.",
        severity: "medium",
        priority: "high",
        dedupeKey,
      }),
    });
  }

  if (blueprint.openQuestionCount > 0) {
    const dedupeKey = `blueprint-open-questions:${blueprint.revisionId ?? "none"}:${blueprint.openQuestionCount}`;
    evidence.push({
      id: "discovery-blueprint-open-questions",
      dedupeKey,
      source: "blueprint-open-questions",
      severity: "medium",
      priority: "medium",
      summary: "Resolve the remaining blueprint open questions before autonomous execution.",
      detail:
        "The blueprint still records unresolved items under `Open Questions`, so the operator should close or explicitly accept them.",
      discoveredWorkItem: makeDiscoveredWorkItem({
        id: "discovered-resolve-blueprint-open-questions",
        title: "Resolve the remaining blueprint open questions before autonomous execution.",
        summary:
          "Review the `Open Questions` section in `PROJECT-BLUEPRINT.md` and resolve, clear, or explicitly accept each item.",
        source: "blueprint-open-questions",
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        providerRoleAssignments: blueprint.providerRoleAssignments,
        detail:
          "The blueprint still records unresolved items under `Open Questions`, so the operator should close or explicitly accept them.",
        severity: "medium",
        priority: "medium",
        dedupeKey,
      }),
    });
  }

  evidence.push(
    ...(await collectRuntimeDiscoveryEvidence({
      repoRoot,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      providerRoleAssignments: blueprint.providerRoleAssignments,
    })),
  );

  return {
    repoRoot,
    inventoryPath,
    exists: false,
    schemaVersion: PROJECT_DISCOVERY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    blueprintExists: true,
    blueprintPath: blueprint.blueprintPath,
    blueprintRevisionId: blueprint.revisionId,
    workItemInventoryExists: workItems.exists,
    workItemInventoryPath: workItems.inventoryPath,
    workItemArtifactStale: workItems.artifactStale,
    evidenceCount: evidence.length,
    blockerCount: blockers.length,
    blockers,
    discoveredWorkItemCount: evidence.length,
    highestPriority: highestDiscoveryPriority(evidence.map((item) => item.priority)),
    evidence,
  };
}

export async function writeProjectDiscoveryInventory(
  repoRootInput: string,
): Promise<ProjectDiscoveryInventory> {
  const inventory = await deriveProjectDiscoveryInventory(repoRootInput);
  await mkdir(path.dirname(inventory.inventoryPath), { recursive: true });
  const persisted = {
    ...inventory,
    exists: true,
  };
  await writeFile(inventory.inventoryPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function readProjectDiscoveryInventory(
  repoRootInput: string,
): Promise<ProjectDiscoveryInventory> {
  const repoRoot = path.resolve(repoRootInput);
  const inventoryPath = resolveProjectDiscoveryInventoryPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const workItems = await readProjectWorkItemInventory(repoRoot);

  try {
    const raw = await readFile(inventoryPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectDiscoveryInventory;
    return {
      ...parsed,
      repoRoot,
      inventoryPath,
      blueprintExists: blueprint.exists,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      workItemInventoryExists: workItems.exists,
      workItemInventoryPath: workItems.inventoryPath,
      workItemArtifactStale: workItems.artifactStale,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyProjectDiscoveryInventory({
        repoRoot,
        inventoryPath,
        blueprintExists: blueprint.exists,
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        workItemInventoryExists: workItems.exists,
        workItemInventoryPath: workItems.inventoryPath,
        workItemArtifactStale: workItems.artifactStale,
      });
    }
    throw error;
  }
}
