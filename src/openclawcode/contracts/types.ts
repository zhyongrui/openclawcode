export type WorkflowStage =
  | "intake"
  | "planning"
  | "awaiting-plan-approval"
  | "building"
  | "draft-pr-opened"
  | "verifying"
  | "changes-requested"
  | "ready-for-human-review"
  | "completed-without-changes"
  | "merged"
  | "escalated"
  | "failed";

export type RiskLevel = "low" | "medium" | "high";
export type VerificationDecision = "approve-for-human-review" | "request-changes" | "escalate";
export type IssueImplementationScope = "command-layer" | "workflow-core" | "mixed";
export type SuitabilityDecision = "auto-run" | "needs-human-review" | "escalate";

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body?: string;
  labels?: string[];
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
  required: boolean;
}

export interface ExecutionSpec {
  summary: string;
  scope: string[];
  outOfScope: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  testPlan: string[];
  risks: string[];
  assumptions: string[];
  openQuestions: string[];
  riskLevel: RiskLevel;
}

export interface SuitabilityAssessment {
  decision: SuitabilityDecision;
  summary: string;
  reasons: string[];
  classification: IssueImplementationScope;
  riskLevel: RiskLevel;
  evaluatedAt: string;
  allowlisted?: boolean;
  denylisted?: boolean;
  matchedLowRiskLabels?: string[];
  matchedLowRiskKeywords?: string[];
  matchedHighRiskLabels?: string[];
  matchedHighRiskKeywords?: string[];
  originalDecision?: SuitabilityDecision;
  overrideApplied?: boolean;
  overrideActor?: string;
  overrideReason?: string;
}

export interface BuildPolicySignals {
  changedLineCount: number;
  changedDirectoryCount: number;
  broadFanOut: boolean;
  largeDiff: boolean;
  generatedFiles: string[];
}

export interface BuildResult {
  branchName: string;
  summary: string;
  changedFiles: string[];
  policySignals?: BuildPolicySignals;
  issueClassification?: IssueImplementationScope;
  scopeCheck?: {
    ok: boolean;
    blockedFiles: string[];
    summary: string;
  };
  testCommands: string[];
  testResults: string[];
  notes: string[];
}

export interface VerificationReport {
  decision: VerificationDecision;
  summary: string;
  findings: string[];
  missingCoverage: string[];
  followUps: string[];
}

export interface PullRequestDraft {
  title: string;
  body: string;
  branchName: string;
  baseBranch: string;
  number?: number;
  url?: string;
  openedAt?: string;
}

export interface WorkflowRerunContext {
  reason: string;
  requestedAt: string;
  priorRunId?: string;
  priorStage?: WorkflowStage;
  reviewDecision?: "approved" | "changes-requested";
  reviewSubmittedAt?: string;
  reviewSummary?: string;
  reviewUrl?: string;
  requestedCoderAgentId?: string;
  requestedVerifierAgentId?: string;
  manualTakeoverRequestedAt?: string;
  manualTakeoverActor?: string;
  manualTakeoverWorktreePath?: string;
  manualResumeNote?: string;
}

export interface WorkflowAttemptSummary {
  total: number;
  planning: number;
  building: number;
  verifying: number;
}

export interface WorkflowStageRecord {
  fromStage?: WorkflowStage;
  toStage: WorkflowStage;
  note: string;
  enteredAt: string;
}

export interface WorkflowWorkspace {
  repoRoot: string;
  baseBranch: string;
  branchName: string;
  worktreePath: string;
  preparedAt: string;
}

export interface WorkflowFailureDiagnostics {
  summary?: string;
  provider?: string;
  model?: string;
  systemPromptChars?: number;
  skillsPromptChars?: number;
  toolSchemaChars?: number;
  toolCount?: number;
  skillCount?: number;
  injectedWorkspaceFileCount?: number;
  bootstrapWarningShown?: boolean;
  lastCallUsageTotal?: number;
}

export interface WorkflowBlueprintContext {
  path: string;
  status: string | null;
  revisionId: string | null;
  agreed: boolean;
  defaultedSectionCount: number;
  workstreamCandidateCount: number;
  openQuestionCount: number;
  humanGateCount: number;
}

export interface WorkflowRoleRouteSnapshot {
  roleId: string;
  adapterId: string;
  source: string;
  configured: boolean;
  fallbackChain: string[];
  runtimeCapable: boolean;
  rerouteCapable: boolean;
  resolvedBackend: string;
  resolvedAgentId: string | null;
  appliedSource: string;
  stages: string[];
}

export interface WorkflowStageRouteSnapshot {
  stageId: string;
  roleId: string;
  adapterId: string;
  resolvedAgentId: string | null;
  source: string;
  fallbackChain: string[];
}

export interface WorkflowRoleRoutingSnapshot {
  artifactExists: boolean;
  blueprintRevisionId: string | null;
  mixedMode: boolean;
  fallbackConfigured: boolean;
  unresolvedRoleCount: number;
  routes: WorkflowRoleRouteSnapshot[];
  stageRoutes: WorkflowStageRouteSnapshot[];
}

export interface WorkflowRuntimeRoleSelection {
  roleId: string;
  adapterId: string | null;
  assignmentSource: string | null;
  configured: boolean;
  appliedAgentId: string | null;
  agentSource:
    | "rerun-request"
    | "cli-override"
    | "role-env"
    | "adapter-env"
    | "runner-default"
    | "stage-steering";
}

export interface WorkflowRuntimeRoutingSnapshot {
  selections: WorkflowRuntimeRoleSelection[];
}

export type WorkflowHandoffKind =
  | "stage-gate-decision"
  | "plan-edit"
  | "rerun-request"
  | "runtime-steering"
  | "runtime-reroute"
  | "manual-takeover"
  | "manual-resume"
  | "suitability-override";

export interface WorkflowHandoffEntry {
  kind: WorkflowHandoffKind;
  recordedAt: string;
  summary: string;
  actor?: string;
  gateId?: string;
  decision?: string;
  note?: string;
  priorRunId?: string;
  priorStage?: WorkflowStage;
  reviewDecision?: "approved" | "changes-requested";
  reviewSubmittedAt?: string;
  requestedCoderAgentId?: string;
  requestedVerifierAgentId?: string;
  worktreePath?: string;
}

export interface WorkflowHandoffSnapshot {
  entries: WorkflowHandoffEntry[];
}

export interface WorkflowStageGateDecisionSnapshot {
  decision: string;
  note: string | null;
  actor: string | null;
  recordedAt: string;
}

export interface WorkflowStageGateRecordSnapshot {
  gateId: string;
  readiness: string;
  decisionRequired: boolean;
  blockerCount: number;
  suggestionCount: number;
  latestDecision: WorkflowStageGateDecisionSnapshot | null;
}

export interface WorkflowStageGateSnapshot {
  artifactExists: boolean;
  blueprintRevisionId: string | null;
  gateCount: number;
  blockedGateCount: number;
  needsHumanDecisionCount: number;
  gates: WorkflowStageGateRecordSnapshot[];
}

export type WorkflowPlanReviewStatus = "not-required" | "awaiting-approval" | "approved";
export type WorkflowQualityGateStatus = "pass" | "warn" | "fail" | "pending";

export interface WorkflowPlanReviewSnapshot {
  required: boolean;
  status: WorkflowPlanReviewStatus;
  planDigest: string | null;
  requestedAt: string | null;
  suppliedDigest: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvalSource: string | null;
  approvalNote: string | null;
}

export interface WorkflowPlanEditRecord {
  appliedAt: string;
  source: string | null;
  actor: string | null;
  note: string | null;
  editedFields: string[];
}

export interface WorkflowQualityGateSummary {
  status: WorkflowQualityGateStatus;
  summary: string;
  blockingReasons: string[];
  warningReasons: string[];
  scopeCheckPassed: boolean | null;
  verificationDecision: VerificationDecision | null;
  findingCount: number;
  missingCoverageCount: number;
  followUpCount: number;
  generatedFileCount: number;
  largeDiff: boolean;
  broadFanOut: boolean;
  testCommandCount: number;
  testResultCount: number;
  failureSummary: string | null;
}

export interface WorkflowRun {
  id: string;
  stage: WorkflowStage;
  issue: IssueRef;
  createdAt: string;
  updatedAt: string;
  attempts: WorkflowAttemptSummary;
  stageRecords: WorkflowStageRecord[];
  executionSpec?: ExecutionSpec;
  suitability?: SuitabilityAssessment;
  workspace?: WorkflowWorkspace;
  buildResult?: BuildResult;
  draftPullRequest?: PullRequestDraft;
  verificationReport?: VerificationReport;
  failureDiagnostics?: WorkflowFailureDiagnostics;
  blueprintContext?: WorkflowBlueprintContext;
  roleRouting?: WorkflowRoleRoutingSnapshot;
  runtimeRouting?: WorkflowRuntimeRoutingSnapshot;
  stageGates?: WorkflowStageGateSnapshot;
  planReview?: WorkflowPlanReviewSnapshot;
  planEdits?: WorkflowPlanEditRecord[];
  handoffs?: WorkflowHandoffSnapshot;
  rerunContext?: WorkflowRerunContext;
  history: string[];
}
