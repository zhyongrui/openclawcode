export type WorkflowStage =
  | "intake"
  | "planning"
  | "building"
  | "draft-pr-opened"
  | "verifying"
  | "changes-requested"
  | "ready-for-human-review"
  | "merged"
  | "escalated"
  | "failed";

export type RiskLevel = "low" | "medium" | "high";
export type VerificationDecision = "approve-for-human-review" | "request-changes" | "escalate";

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

export interface BuildResult {
  branchName: string;
  summary: string;
  changedFiles: string[];
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
  url?: string;
  openedAt?: string;
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

export interface WorkflowRun {
  id: string;
  stage: WorkflowStage;
  issue: IssueRef;
  createdAt: string;
  updatedAt: string;
  attempts: WorkflowAttemptSummary;
  stageRecords: WorkflowStageRecord[];
  executionSpec?: ExecutionSpec;
  buildResult?: BuildResult;
  draftPullRequest?: PullRequestDraft;
  verificationReport?: VerificationReport;
  history: string[];
}
