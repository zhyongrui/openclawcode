import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  readProjectStageGateArtifact,
  type ProjectStageGateDecisionRecord,
  type ProjectStageGateReadinessId,
} from "./stage-gates.js";

export const PROJECT_PROMOTION_GATE_SCHEMA_VERSION = 1;
export const PROJECT_ROLLBACK_SUGGESTION_SCHEMA_VERSION = 1;
export const PROJECT_PROMOTION_RECEIPT_SCHEMA_VERSION = 1;
export const PROJECT_ROLLBACK_RECEIPT_SCHEMA_VERSION = 1;

interface SetupCheckReadinessPayload {
  basic: boolean;
  strict: boolean;
  lowRiskProofReady: boolean;
  fallbackProofReady: boolean;
  promotionReady: boolean;
  gatewayReachable: boolean;
  routeProbeReady: boolean;
  routeProbeSkipped: boolean;
  builtStartupProofRequested: boolean;
  builtStartupProofReady: boolean;
  nextAction: string;
}

interface SetupCheckSummaryPayload {
  pass: number;
  warn: number;
  fail: number;
}

export interface SetupCheckProbePayload {
  ok: boolean;
  strict: boolean;
  repoRoot: string;
  operatorRoot: string;
  readiness: SetupCheckReadinessPayload;
  summary: SetupCheckSummaryPayload;
}

export interface ProjectPromotionGateArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  branchName: string | null;
  commitSha: string | null;
  baseBranch: string | null;
  rollbackTargetBranch: string | null;
  rollbackTargetCommitSha: string | null;
  setupCheckScriptPath: string;
  setupCheckAvailable: boolean;
  setupCheckOk: boolean | null;
  setupCheckStrict: boolean | null;
  operatorRoot: string | null;
  lowRiskProofReady: boolean | null;
  fallbackProofReady: boolean | null;
  promotionReady: boolean | null;
  gatewayReachable: boolean | null;
  routeProbeReady: boolean | null;
  routeProbeSkipped: boolean | null;
  builtStartupProofRequested: boolean | null;
  builtStartupProofReady: boolean | null;
  nextAction: string | null;
  summaryPass: number | null;
  summaryWarn: number | null;
  summaryFail: number | null;
  stageGateArtifactExists: boolean;
  mergePromotionGateReadiness: ProjectStageGateReadinessId | null;
  mergePromotionLatestDecision: ProjectStageGateDecisionRecord | null;
  ready: boolean;
  blockerCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
}

export interface ProjectRollbackSuggestionArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  branchName: string | null;
  commitSha: string | null;
  baseBranch: string | null;
  targetBranch: string | null;
  targetCommitSha: string | null;
  targetRef: string | null;
  recommended: boolean;
  reason: string;
  promotionArtifactPath: string;
  promotionArtifactExists: boolean;
  promotionReady: boolean | null;
  mergePromotionGateReadiness: ProjectStageGateReadinessId | null;
  blockerCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
}

export interface ProjectPromotionReceiptArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  recordedAt: string | null;
  actor: string | null;
  note: string | null;
  sourceBranch: string | null;
  sourceCommitSha: string | null;
  promotedBranch: string | null;
  promotedCommitSha: string | null;
  promotedRef: string | null;
  promotionArtifactPath: string;
  promotionArtifactExists: boolean;
  promotionReady: boolean | null;
  mergePromotionGateReadiness: ProjectStageGateReadinessId | null;
  setupCheckOk: boolean | null;
  lowRiskProofReady: boolean | null;
  fallbackProofReady: boolean | null;
  rollbackSuggestionArtifactPath: string;
  rollbackSuggestionArtifactExists: boolean;
  rollbackTargetBranch: string | null;
  rollbackTargetCommitSha: string | null;
  rollbackTargetRef: string | null;
  blockerCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
}

export interface ProjectRollbackReceiptArtifact {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  recordedAt: string | null;
  actor: string | null;
  note: string | null;
  sourceBranch: string | null;
  sourceCommitSha: string | null;
  restoredBranch: string | null;
  restoredCommitSha: string | null;
  restoredRef: string | null;
  rollbackSuggestionArtifactPath: string;
  rollbackSuggestionArtifactExists: boolean;
  recommended: boolean | null;
  reason: string | null;
  promotionArtifactPath: string;
  promotionArtifactExists: boolean;
  promotionReady: boolean | null;
  mergePromotionGateReadiness: ProjectStageGateReadinessId | null;
  blockerCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
}

function resolveProjectPromotionGateArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "promotion-gate.json");
}

function resolveProjectRollbackSuggestionArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "rollback-suggestion.json");
}

function resolveProjectPromotionReceiptArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "promotion-receipt.json");
}

function resolveProjectRollbackReceiptArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "rollback-receipt.json");
}

function resolveSetupCheckScriptPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), "scripts", "openclawcode-setup-check.sh");
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

function resolveCurrentBranch(repoRoot: string): string | null {
  return runGitCommand(repoRoot, ["branch", "--show-current"]);
}

function resolveHeadCommitSha(repoRoot: string): string | null {
  return runGitCommand(repoRoot, ["rev-parse", "HEAD"]);
}

function resolveBaseBranch(repoRoot: string): string | null {
  const remoteHead = runGitCommand(repoRoot, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (remoteHead?.startsWith("origin/")) {
    return remoteHead.slice("origin/".length);
  }
  for (const candidate of ["main", "master"]) {
    if (runGitCommand(repoRoot, ["rev-parse", "--verify", `refs/heads/${candidate}`])) {
      return candidate;
    }
  }
  return resolveCurrentBranch(repoRoot);
}

function resolveBranchCommitSha(repoRoot: string, branch: string | null): string | null {
  if (!branch) {
    return null;
  }
  return (
    runGitCommand(repoRoot, ["rev-parse", "--verify", `refs/heads/${branch}`]) ??
    runGitCommand(repoRoot, ["rev-parse", "--verify", `refs/remotes/origin/${branch}`])
  );
}

function isSetupCheckReadinessPayload(value: unknown): value is SetupCheckReadinessPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.basic === "boolean" &&
    typeof candidate.strict === "boolean" &&
    typeof candidate.lowRiskProofReady === "boolean" &&
    typeof candidate.fallbackProofReady === "boolean" &&
    typeof candidate.promotionReady === "boolean" &&
    typeof candidate.gatewayReachable === "boolean" &&
    typeof candidate.routeProbeReady === "boolean" &&
    typeof candidate.routeProbeSkipped === "boolean" &&
    typeof candidate.builtStartupProofRequested === "boolean" &&
    typeof candidate.builtStartupProofReady === "boolean" &&
    typeof candidate.nextAction === "string"
  );
}

function isSetupCheckSummaryPayload(value: unknown): value is SetupCheckSummaryPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.pass === "number" &&
    typeof candidate.warn === "number" &&
    typeof candidate.fail === "number"
  );
}

function parseSetupCheckProbePayload(stdout: string): SetupCheckProbePayload | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.ok !== "boolean" ||
    typeof candidate.strict !== "boolean" ||
    typeof candidate.repoRoot !== "string" ||
    typeof candidate.operatorRoot !== "string" ||
    !isSetupCheckReadinessPayload(candidate.readiness) ||
    !isSetupCheckSummaryPayload(candidate.summary)
  ) {
    return undefined;
  }
  return {
    ok: candidate.ok,
    strict: candidate.strict,
    repoRoot: candidate.repoRoot,
    operatorRoot: candidate.operatorRoot,
    readiness: candidate.readiness,
    summary: candidate.summary,
  };
}

function runSetupCheckProbe(repoRoot: string): SetupCheckProbePayload | undefined {
  const scriptPath = resolveSetupCheckScriptPath(repoRoot);
  const result = spawnSync("bash", [scriptPath, "--strict", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAWCODE_SETUP_REPO_ROOT: repoRoot,
    },
  });
  return parseSetupCheckProbePayload(result.stdout);
}

function resolveMergePromotionGate(params: {
  stageGates: Awaited<ReturnType<typeof readProjectStageGateArtifact>>;
}): {
  readiness: ProjectStageGateReadinessId | null;
  latestDecision: ProjectStageGateDecisionRecord | null;
} {
  const mergeGate = params.stageGates.gates.find((gate) => gate.gateId === "merge-promotion");
  return {
    readiness: mergeGate?.readiness ?? null,
    latestDecision: mergeGate?.latestDecision ?? null,
  };
}

function emptyPromotionGateArtifact(params: {
  repoRoot: string;
  artifactPath: string;
  branchName: string | null;
  commitSha: string | null;
  baseBranch: string | null;
  rollbackTargetBranch: string | null;
  rollbackTargetCommitSha: string | null;
  stageGateArtifactExists: boolean;
  mergePromotionGateReadiness: ProjectStageGateReadinessId | null;
  mergePromotionLatestDecision: ProjectStageGateDecisionRecord | null;
}): ProjectPromotionGateArtifact {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    branchName: params.branchName,
    commitSha: params.commitSha,
    baseBranch: params.baseBranch,
    rollbackTargetBranch: params.rollbackTargetBranch,
    rollbackTargetCommitSha: params.rollbackTargetCommitSha,
    setupCheckScriptPath: resolveSetupCheckScriptPath(params.repoRoot),
    setupCheckAvailable: false,
    setupCheckOk: null,
    setupCheckStrict: null,
    operatorRoot: null,
    lowRiskProofReady: null,
    fallbackProofReady: null,
    promotionReady: null,
    gatewayReachable: null,
    routeProbeReady: null,
    routeProbeSkipped: null,
    builtStartupProofRequested: null,
    builtStartupProofReady: null,
    nextAction: null,
    summaryPass: null,
    summaryWarn: null,
    summaryFail: null,
    stageGateArtifactExists: params.stageGateArtifactExists,
    mergePromotionGateReadiness: params.mergePromotionGateReadiness,
    mergePromotionLatestDecision: params.mergePromotionLatestDecision,
    ready: false,
    blockerCount: 0,
    blockers: [],
    suggestionCount: 0,
    suggestions: [],
  };
}

export async function deriveProjectPromotionGateArtifact(
  repoRootInput: string,
): Promise<ProjectPromotionGateArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectPromotionGateArtifactPath(repoRoot);
  const branchName = resolveCurrentBranch(repoRoot);
  const commitSha = resolveHeadCommitSha(repoRoot);
  const baseBranch = resolveBaseBranch(repoRoot);
  const rollbackTargetCommitSha = resolveBranchCommitSha(repoRoot, baseBranch);
  const stageGates = await readProjectStageGateArtifact(repoRoot);
  const mergeGate = resolveMergePromotionGate({ stageGates });
  const setupCheck = runSetupCheckProbe(repoRoot);
  const artifact = emptyPromotionGateArtifact({
    repoRoot,
    artifactPath,
    branchName,
    commitSha,
    baseBranch,
    rollbackTargetBranch: baseBranch,
    rollbackTargetCommitSha,
    stageGateArtifactExists: stageGates.exists,
    mergePromotionGateReadiness: mergeGate.readiness,
    mergePromotionLatestDecision: mergeGate.latestDecision,
  });
  const blockers: string[] = [];
  const suggestions: string[] = [];

  if (!setupCheck) {
    blockers.push(
      "Setup-check probe is unavailable. Run scripts/openclawcode-setup-check.sh --strict --json on the operator host.",
    );
  } else {
    artifact.setupCheckAvailable = true;
    artifact.setupCheckOk = setupCheck.ok;
    artifact.setupCheckStrict = setupCheck.strict;
    artifact.operatorRoot = setupCheck.operatorRoot;
    artifact.lowRiskProofReady = setupCheck.readiness.lowRiskProofReady;
    artifact.fallbackProofReady = setupCheck.readiness.fallbackProofReady;
    artifact.promotionReady = setupCheck.readiness.promotionReady;
    artifact.gatewayReachable = setupCheck.readiness.gatewayReachable;
    artifact.routeProbeReady = setupCheck.readiness.routeProbeReady;
    artifact.routeProbeSkipped = setupCheck.readiness.routeProbeSkipped;
    artifact.builtStartupProofRequested = setupCheck.readiness.builtStartupProofRequested;
    artifact.builtStartupProofReady = setupCheck.readiness.builtStartupProofReady;
    artifact.nextAction = setupCheck.readiness.nextAction;
    artifact.summaryPass = setupCheck.summary.pass;
    artifact.summaryWarn = setupCheck.summary.warn;
    artifact.summaryFail = setupCheck.summary.fail;

    if (!setupCheck.strict) {
      blockers.push("Setup-check strict mode is not passing yet.");
    }
    if (!setupCheck.readiness.lowRiskProofReady) {
      blockers.push("Low-risk proof readiness is still blocked.");
    }
    if (!setupCheck.readiness.promotionReady) {
      blockers.push(
        `Promotion readiness is blocked by setup-check (nextAction=${setupCheck.readiness.nextAction}).`,
      );
    }
    if (!setupCheck.readiness.gatewayReachable) {
      blockers.push("The operator gateway is not reachable.");
    }
    if (setupCheck.summary.warn > 0) {
      suggestions.push(`Setup-check still reports ${setupCheck.summary.warn} warning(s).`);
    }
  }

  if (artifact.mergePromotionGateReadiness === "blocked") {
    blockers.push("The merge-promotion stage gate is explicitly blocked.");
  } else if (artifact.mergePromotionGateReadiness === "needs-human-decision") {
    blockers.push("The merge-promotion stage gate still requires a human decision.");
  }

  if (!artifact.rollbackTargetBranch || !artifact.rollbackTargetCommitSha) {
    blockers.push("A rollback baseline could not be resolved from git state.");
  } else if (artifact.branchName === artifact.rollbackTargetBranch) {
    suggestions.push(
      `The current branch already matches the rollback baseline (${artifact.rollbackTargetBranch}).`,
    );
  } else {
    suggestions.push(
      `Rollback can return the operator to ${artifact.rollbackTargetBranch}@${artifact.rollbackTargetCommitSha}.`,
    );
  }

  artifact.blockers = blockers;
  artifact.blockerCount = blockers.length;
  artifact.suggestions = suggestions;
  artifact.suggestionCount = suggestions.length;
  artifact.ready = blockers.length === 0;
  return artifact;
}

export async function writeProjectPromotionGateArtifact(
  repoRootInput: string,
): Promise<ProjectPromotionGateArtifact> {
  const artifact = await deriveProjectPromotionGateArtifact(repoRootInput);
  artifact.exists = true;
  artifact.schemaVersion = PROJECT_PROMOTION_GATE_SCHEMA_VERSION;
  artifact.generatedAt = new Date().toISOString();

  await mkdir(path.dirname(artifact.artifactPath), { recursive: true });
  await writeFile(artifact.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectPromotionGateArtifact(
  repoRootInput: string,
): Promise<ProjectPromotionGateArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectPromotionGateArtifactPath(repoRoot);
  const current = await deriveProjectPromotionGateArtifact(repoRoot);
  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectPromotionGateArtifact>;
    return {
      ...current,
      ...parsed,
      repoRoot,
      artifactPath,
      exists: true,
    };
  } catch {
    return current;
  }
}

function emptyRollbackSuggestionArtifact(params: {
  repoRoot: string;
  artifactPath: string;
  branchName: string | null;
  commitSha: string | null;
  baseBranch: string | null;
  targetBranch: string | null;
  targetCommitSha: string | null;
  reason: string;
  promotionArtifactPath: string;
  promotionArtifactExists: boolean;
  promotionReady: boolean | null;
  mergePromotionGateReadiness: ProjectStageGateReadinessId | null;
  recommended: boolean;
}): ProjectRollbackSuggestionArtifact {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    branchName: params.branchName,
    commitSha: params.commitSha,
    baseBranch: params.baseBranch,
    targetBranch: params.targetBranch,
    targetCommitSha: params.targetCommitSha,
    targetRef:
      params.targetBranch && params.targetCommitSha
        ? `${params.targetBranch}@${params.targetCommitSha}`
        : null,
    recommended: params.recommended,
    reason: params.reason,
    promotionArtifactPath: params.promotionArtifactPath,
    promotionArtifactExists: params.promotionArtifactExists,
    promotionReady: params.promotionReady,
    mergePromotionGateReadiness: params.mergePromotionGateReadiness,
    blockerCount: 0,
    blockers: [],
    suggestionCount: 0,
    suggestions: [],
  };
}

export async function deriveProjectRollbackSuggestionArtifact(
  repoRootInput: string,
): Promise<ProjectRollbackSuggestionArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const promotion = await readProjectPromotionGateArtifact(repoRoot);
  const artifactPath = resolveProjectRollbackSuggestionArtifactPath(repoRoot);

  let reason =
    "Return to the operator baseline branch before promoting again if the current branch regresses.";
  if (promotion.promotionReady === false) {
    reason =
      "Promotion readiness is blocked, so the safest rollback target is the current operator baseline branch.";
  } else if (
    promotion.mergePromotionGateReadiness === "blocked" ||
    promotion.mergePromotionGateReadiness === "needs-human-decision"
  ) {
    reason =
      "A human merge or promotion decision is still pending, so rollback should keep the operator on the baseline branch.";
  }

  const artifact = emptyRollbackSuggestionArtifact({
    repoRoot,
    artifactPath,
    branchName: promotion.branchName,
    commitSha: promotion.commitSha,
    baseBranch: promotion.baseBranch,
    targetBranch: promotion.rollbackTargetBranch,
    targetCommitSha: promotion.rollbackTargetCommitSha,
    reason,
    promotionArtifactPath: promotion.artifactPath,
    promotionArtifactExists: promotion.exists,
    promotionReady: promotion.promotionReady,
    mergePromotionGateReadiness: promotion.mergePromotionGateReadiness,
    recommended:
      promotion.rollbackTargetBranch != null &&
      promotion.rollbackTargetCommitSha != null &&
      (promotion.branchName !== promotion.rollbackTargetBranch ||
        promotion.commitSha !== promotion.rollbackTargetCommitSha),
  });

  if (!artifact.targetBranch || !artifact.targetCommitSha) {
    artifact.blockers.push("No rollback target branch or commit could be resolved.");
  }
  if (
    artifact.branchName === artifact.targetBranch &&
    artifact.commitSha === artifact.targetCommitSha
  ) {
    artifact.suggestions.push("The repository is already at the suggested rollback target.");
  } else if (artifact.targetRef) {
    artifact.suggestions.push(`Use ${artifact.targetRef} as the first rollback candidate.`);
  }
  artifact.blockerCount = artifact.blockers.length;
  artifact.suggestionCount = artifact.suggestions.length;
  return artifact;
}

export async function writeProjectRollbackSuggestionArtifact(
  repoRootInput: string,
): Promise<ProjectRollbackSuggestionArtifact> {
  const artifact = await deriveProjectRollbackSuggestionArtifact(repoRootInput);
  artifact.exists = true;
  artifact.schemaVersion = PROJECT_ROLLBACK_SUGGESTION_SCHEMA_VERSION;
  artifact.generatedAt = new Date().toISOString();
  await mkdir(path.dirname(artifact.artifactPath), { recursive: true });
  await writeFile(artifact.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectRollbackSuggestionArtifact(
  repoRootInput: string,
): Promise<ProjectRollbackSuggestionArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectRollbackSuggestionArtifactPath(repoRoot);
  const current = await deriveProjectRollbackSuggestionArtifact(repoRoot);
  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectRollbackSuggestionArtifact>;
    return {
      ...current,
      ...parsed,
      repoRoot,
      artifactPath,
      exists: true,
    };
  } catch {
    return current;
  }
}

function emptyPromotionReceiptArtifact(params: {
  repoRoot: string;
  artifactPath: string;
  sourceBranch: string | null;
  sourceCommitSha: string | null;
  promotedBranch: string | null;
  promotedCommitSha: string | null;
  promotionArtifactPath: string;
  promotionArtifactExists: boolean;
  promotionReady: boolean | null;
  mergePromotionGateReadiness: ProjectStageGateReadinessId | null;
  setupCheckOk: boolean | null;
  lowRiskProofReady: boolean | null;
  fallbackProofReady: boolean | null;
  rollbackSuggestionArtifactPath: string;
  rollbackSuggestionArtifactExists: boolean;
  rollbackTargetBranch: string | null;
  rollbackTargetCommitSha: string | null;
}): ProjectPromotionReceiptArtifact {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    recordedAt: null,
    actor: null,
    note: null,
    sourceBranch: params.sourceBranch,
    sourceCommitSha: params.sourceCommitSha,
    promotedBranch: params.promotedBranch,
    promotedCommitSha: params.promotedCommitSha,
    promotedRef:
      params.promotedBranch && params.promotedCommitSha
        ? `${params.promotedBranch}@${params.promotedCommitSha}`
        : null,
    promotionArtifactPath: params.promotionArtifactPath,
    promotionArtifactExists: params.promotionArtifactExists,
    promotionReady: params.promotionReady,
    mergePromotionGateReadiness: params.mergePromotionGateReadiness,
    setupCheckOk: params.setupCheckOk,
    lowRiskProofReady: params.lowRiskProofReady,
    fallbackProofReady: params.fallbackProofReady,
    rollbackSuggestionArtifactPath: params.rollbackSuggestionArtifactPath,
    rollbackSuggestionArtifactExists: params.rollbackSuggestionArtifactExists,
    rollbackTargetBranch: params.rollbackTargetBranch,
    rollbackTargetCommitSha: params.rollbackTargetCommitSha,
    rollbackTargetRef:
      params.rollbackTargetBranch && params.rollbackTargetCommitSha
        ? `${params.rollbackTargetBranch}@${params.rollbackTargetCommitSha}`
        : null,
    blockerCount: 0,
    blockers: [],
    suggestionCount: 0,
    suggestions: [],
  };
}

export async function deriveProjectPromotionReceiptArtifact(params: {
  repoRootInput: string;
  actor?: string;
  note?: string;
  promotedBranch?: string;
  promotedCommitSha?: string;
  recordedAt?: string;
}): Promise<ProjectPromotionReceiptArtifact> {
  const repoRoot = path.resolve(params.repoRootInput);
  const promotion = await readProjectPromotionGateArtifact(repoRoot);
  const rollback = await readProjectRollbackSuggestionArtifact(repoRoot);
  const artifactPath = resolveProjectPromotionReceiptArtifactPath(repoRoot);
  const promotedBranch = params.promotedBranch ?? promotion.baseBranch;
  const promotedCommitSha =
    params.promotedCommitSha ?? resolveBranchCommitSha(repoRoot, promotedBranch);
  const artifact = emptyPromotionReceiptArtifact({
    repoRoot,
    artifactPath,
    sourceBranch: promotion.branchName,
    sourceCommitSha: promotion.commitSha,
    promotedBranch,
    promotedCommitSha,
    promotionArtifactPath: promotion.artifactPath,
    promotionArtifactExists: promotion.exists,
    promotionReady: promotion.ready,
    mergePromotionGateReadiness: promotion.mergePromotionGateReadiness,
    setupCheckOk: promotion.setupCheckOk,
    lowRiskProofReady: promotion.lowRiskProofReady,
    fallbackProofReady: promotion.fallbackProofReady,
    rollbackSuggestionArtifactPath: rollback.artifactPath,
    rollbackSuggestionArtifactExists: rollback.exists,
    rollbackTargetBranch: rollback.targetBranch,
    rollbackTargetCommitSha: rollback.targetCommitSha,
  });
  artifact.recordedAt = params.recordedAt ?? new Date().toISOString();
  artifact.actor = params.actor ?? null;
  artifact.note = params.note ?? null;

  if (!promotion.exists) {
    artifact.blockers.push("Promotion gate artifact has not been generated yet.");
  }
  if (!promotion.ready) {
    artifact.blockers.push("Promotion gate is not ready yet.");
  }
  if (!artifact.promotedBranch || !artifact.promotedCommitSha) {
    artifact.blockers.push("The promoted branch or commit could not be resolved.");
  }
  if (
    artifact.promotedBranch &&
    artifact.sourceBranch &&
    artifact.promotedBranch === artifact.sourceBranch
  ) {
    artifact.suggestions.push(
      "The promoted branch still matches the source branch; verify that the long-lived baseline was actually updated.",
    );
  }
  if (artifact.rollbackTargetRef) {
    artifact.suggestions.push(
      `Rollback can return the operator to ${artifact.rollbackTargetRef} if this promotion regresses.`,
    );
  }
  artifact.blockerCount = artifact.blockers.length;
  artifact.suggestionCount = artifact.suggestions.length;
  return artifact;
}

export async function writeProjectPromotionReceiptArtifact(params: {
  repoRootInput: string;
  actor?: string;
  note?: string;
  promotedBranch?: string;
  promotedCommitSha?: string;
  recordedAt?: string;
}): Promise<ProjectPromotionReceiptArtifact> {
  const artifact = await deriveProjectPromotionReceiptArtifact(params);
  artifact.exists = true;
  artifact.schemaVersion = PROJECT_PROMOTION_RECEIPT_SCHEMA_VERSION;
  await mkdir(path.dirname(artifact.artifactPath), { recursive: true });
  await writeFile(artifact.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectPromotionReceiptArtifact(
  repoRootInput: string,
): Promise<ProjectPromotionReceiptArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectPromotionReceiptArtifactPath(repoRoot);
  const current = await deriveProjectPromotionReceiptArtifact({ repoRootInput: repoRoot });
  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectPromotionReceiptArtifact>;
    return {
      ...current,
      ...parsed,
      repoRoot,
      artifactPath,
      exists: true,
    };
  } catch {
    return current;
  }
}

function emptyRollbackReceiptArtifact(params: {
  repoRoot: string;
  artifactPath: string;
  sourceBranch: string | null;
  sourceCommitSha: string | null;
  restoredBranch: string | null;
  restoredCommitSha: string | null;
  rollbackSuggestionArtifactPath: string;
  rollbackSuggestionArtifactExists: boolean;
  recommended: boolean | null;
  reason: string | null;
  promotionArtifactPath: string;
  promotionArtifactExists: boolean;
  promotionReady: boolean | null;
  mergePromotionGateReadiness: ProjectStageGateReadinessId | null;
}): ProjectRollbackReceiptArtifact {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    recordedAt: null,
    actor: null,
    note: null,
    sourceBranch: params.sourceBranch,
    sourceCommitSha: params.sourceCommitSha,
    restoredBranch: params.restoredBranch,
    restoredCommitSha: params.restoredCommitSha,
    restoredRef:
      params.restoredBranch && params.restoredCommitSha
        ? `${params.restoredBranch}@${params.restoredCommitSha}`
        : null,
    rollbackSuggestionArtifactPath: params.rollbackSuggestionArtifactPath,
    rollbackSuggestionArtifactExists: params.rollbackSuggestionArtifactExists,
    recommended: params.recommended,
    reason: params.reason,
    promotionArtifactPath: params.promotionArtifactPath,
    promotionArtifactExists: params.promotionArtifactExists,
    promotionReady: params.promotionReady,
    mergePromotionGateReadiness: params.mergePromotionGateReadiness,
    blockerCount: 0,
    blockers: [],
    suggestionCount: 0,
    suggestions: [],
  };
}

export async function deriveProjectRollbackReceiptArtifact(params: {
  repoRootInput: string;
  actor?: string;
  note?: string;
  restoredBranch?: string;
  restoredCommitSha?: string;
  recordedAt?: string;
}): Promise<ProjectRollbackReceiptArtifact> {
  const repoRoot = path.resolve(params.repoRootInput);
  const rollback = await readProjectRollbackSuggestionArtifact(repoRoot);
  const promotion = await readProjectPromotionGateArtifact(repoRoot);
  const artifactPath = resolveProjectRollbackReceiptArtifactPath(repoRoot);
  const restoredBranch = params.restoredBranch ?? rollback.targetBranch;
  const restoredCommitSha =
    params.restoredCommitSha ?? resolveBranchCommitSha(repoRoot, restoredBranch);
  const artifact = emptyRollbackReceiptArtifact({
    repoRoot,
    artifactPath,
    sourceBranch: promotion.branchName,
    sourceCommitSha: promotion.commitSha,
    restoredBranch,
    restoredCommitSha,
    rollbackSuggestionArtifactPath: rollback.artifactPath,
    rollbackSuggestionArtifactExists: rollback.exists,
    recommended: rollback.recommended,
    reason: rollback.reason,
    promotionArtifactPath: promotion.artifactPath,
    promotionArtifactExists: promotion.exists,
    promotionReady: promotion.ready,
    mergePromotionGateReadiness: promotion.mergePromotionGateReadiness,
  });
  artifact.recordedAt = params.recordedAt ?? new Date().toISOString();
  artifact.actor = params.actor ?? null;
  artifact.note = params.note ?? null;

  if (!rollback.exists) {
    artifact.blockers.push("Rollback suggestion artifact has not been generated yet.");
  }
  if (!artifact.restoredBranch || !artifact.restoredCommitSha) {
    artifact.blockers.push("The restored branch or commit could not be resolved.");
  }
  if (artifact.reason) {
    artifact.suggestions.push(artifact.reason);
  }
  if (
    artifact.restoredBranch &&
    artifact.sourceBranch &&
    artifact.restoredBranch === artifact.sourceBranch
  ) {
    artifact.suggestions.push(
      "The restored branch still matches the source branch; verify that rollback moved the operator back to a safe baseline.",
    );
  }
  artifact.blockerCount = artifact.blockers.length;
  artifact.suggestionCount = artifact.suggestions.length;
  return artifact;
}

export async function writeProjectRollbackReceiptArtifact(params: {
  repoRootInput: string;
  actor?: string;
  note?: string;
  restoredBranch?: string;
  restoredCommitSha?: string;
  recordedAt?: string;
}): Promise<ProjectRollbackReceiptArtifact> {
  const artifact = await deriveProjectRollbackReceiptArtifact(params);
  artifact.exists = true;
  artifact.schemaVersion = PROJECT_ROLLBACK_RECEIPT_SCHEMA_VERSION;
  await mkdir(path.dirname(artifact.artifactPath), { recursive: true });
  await writeFile(artifact.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export async function readProjectRollbackReceiptArtifact(
  repoRootInput: string,
): Promise<ProjectRollbackReceiptArtifact> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectRollbackReceiptArtifactPath(repoRoot);
  const current = await deriveProjectRollbackReceiptArtifact({ repoRootInput: repoRoot });
  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectRollbackReceiptArtifact>;
    return {
      ...current,
      ...parsed,
      repoRoot,
      artifactPath,
      exists: true,
    };
  } catch {
    return current;
  }
}
