import type {
  BuildResult,
  ExecutionSpec,
  IssueRef,
  PullRequestDraft,
  VerificationReport,
  WorkflowRun,
} from "../contracts/index.js";
import type { WorkflowRunStore } from "../persistence/index.js";
import type { Builder, Planner, Verifier } from "../roles/index.js";
import {
  applyVerificationDecision,
  transitionRun,
  type TimestampFactory,
} from "../workflow/index.js";

export interface WorkflowAgents {
  planner: Planner;
  builder: Builder;
  verifier: Verifier;
}

export interface OrchestratorHooks {
  onStageChange?: (run: WorkflowRun) => void;
}

export interface OrchestratorOptions extends OrchestratorHooks {
  now?: TimestampFactory;
  store?: WorkflowRunStore;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function persistRun(run: WorkflowRun, options: OrchestratorOptions): Promise<WorkflowRun> {
  if (options.store) {
    await options.store.save(run);
  }
  options.onStageChange?.(run);
  return run;
}

function attachExecutionSpec(
  run: WorkflowRun,
  spec: ExecutionSpec,
  now: TimestampFactory = nowIso,
): WorkflowRun {
  return {
    ...run,
    executionSpec: spec,
    updatedAt: now(),
    history: [...run.history, "Planning completed"],
  };
}

export function createRun(issue: IssueRef, now: TimestampFactory = nowIso): WorkflowRun {
  const createdAt = now();
  return {
    id: `${issue.owner}-${issue.repo}-${issue.number}-${Date.parse(createdAt)}`,
    stage: "intake",
    issue,
    createdAt,
    updatedAt: createdAt,
    attempts: {
      total: 0,
      planning: 0,
      building: 0,
      verifying: 0,
    },
    stageRecords: [
      {
        toStage: "intake",
        note: "Workflow created from issue intake",
        enteredAt: createdAt,
      },
    ],
    history: ["Workflow created from issue intake"],
  };
}

export async function executePlanning(
  run: WorkflowRun,
  planner: Planner,
  now: TimestampFactory = nowIso,
): Promise<WorkflowRun> {
  const planning =
    run.stage === "planning" ? run : transitionRun(run, "planning", "Planning started", now);
  const spec = await planner.plan(run.issue);
  return attachExecutionSpec(planning, spec, now);
}

function createPullRequestDraft(run: WorkflowRun, result: BuildResult): PullRequestDraft {
  return {
    title: `[Issue #${run.issue.number}] ${run.issue.title}`,
    body: buildPullRequestBody({
      ...run,
      buildResult: result,
    }),
    branchName: result.branchName,
    baseBranch: "main",
  };
}

export async function executeBuild(run: WorkflowRun, builder: Builder): Promise<WorkflowRun> {
  const building = run.stage === "building" ? run : transitionRun(run, "building", "Build started");
  const result = await builder.build(building);
  return {
    ...transitionRun(building, "draft-pr-opened", "Build completed and draft PR prepared"),
    buildResult: result,
    draftPullRequest: {
      ...createPullRequestDraft(building, result),
      openedAt: building.updatedAt,
    },
  };
}

export async function executeVerification(
  run: WorkflowRun,
  verifier: Verifier,
  now: TimestampFactory = nowIso,
): Promise<WorkflowRun> {
  const verifying =
    run.stage === "verifying" ? run : transitionRun(run, "verifying", "Verification started", now);
  const report = await verifier.verify(verifying);
  return applyVerificationDecision(verifying, report, now);
}

export async function orchestrateIssue(
  issue: IssueRef,
  agents: WorkflowAgents,
  options: OrchestratorOptions = {},
): Promise<WorkflowRun> {
  const now = options.now ?? nowIso;

  let run = await persistRun(createRun(issue, now), options);

  run = await persistRun(transitionRun(run, "planning", "Planning started", now), options);
  const spec = await agents.planner.plan(run.issue);
  run = await persistRun(attachExecutionSpec(run, spec, now), options);

  run = await persistRun(transitionRun(run, "building", "Build started", now), options);
  const result = await agents.builder.build(run);
  run = await persistRun(
    {
      ...transitionRun(run, "draft-pr-opened", "Build completed and draft PR prepared", now),
      buildResult: result,
      draftPullRequest: {
        ...createPullRequestDraft(run, result),
        openedAt: now(),
      },
    },
    options,
  );

  run = await persistRun(transitionRun(run, "verifying", "Verification started", now), options);
  const report = await agents.verifier.verify(run);
  run = await persistRun(applyVerificationDecision(run, report, now), options);

  return run;
}

export function buildPullRequestBody(run: WorkflowRun): string {
  const spec = run.executionSpec;
  const result = run.buildResult;
  const report = run.verificationReport;

  return [
    "## Summary",
    spec?.summary ?? "No summary recorded.",
    "",
    "## Scope",
    ...(spec?.scope ?? ["No scope recorded."]),
    "",
    "## Changed Files",
    ...(result?.changedFiles ?? ["No changed files recorded."]),
    "",
    "## Implementation Scope",
    `Classification: ${result?.issueClassification ?? "unknown"}`,
    `Scope Check: ${result?.scopeCheck?.summary ?? "No scope-check summary recorded."}`,
    "",
    "## Acceptance Criteria",
    ...(spec?.acceptanceCriteria.map((criterion) => `- [ ] ${criterion.text}`) ?? [
      "- [ ] No acceptance criteria recorded.",
    ]),
    "",
    "## Tests",
    ...(result?.testCommands ?? ["No test commands recorded."]),
    "",
    "## Test Results",
    ...(result?.testResults ?? ["No test results recorded."]),
    "",
    "## Verification",
    report?.summary ?? "Verification pending.",
  ].join("\n");
}

export type { BuildResult, ExecutionSpec, VerificationReport };
