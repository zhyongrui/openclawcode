import type { BuildResult, ExecutionSpec, IssueRef, VerificationReport, WorkflowRun } from "../contracts/index.js";

export interface Planner {
  plan(issue: IssueRef): Promise<ExecutionSpec>;
}

export interface Builder {
  build(run: WorkflowRun): Promise<BuildResult>;
}

export interface Verifier {
  verify(run: WorkflowRun): Promise<VerificationReport>;
}
