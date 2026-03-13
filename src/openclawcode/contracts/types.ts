export type WorkflowStage =
  | "intake"
  | "planning"
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
}

export interface BuildResult {
  branchName: string;
  summary: string;
  changedFiles: string[];
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
  rerunContext?: WorkflowRerunContext;
  history: string[];
}
