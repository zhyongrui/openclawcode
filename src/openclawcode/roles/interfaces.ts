import type {
  BuildResult,
  ExecutionSpec,
  IssueRef,
  VerificationReport,
  WorkflowRun,
  WorkflowRuntimeRoleSelection,
} from "../contracts/index.js";

export interface Planner {
  plan(issue: IssueRef): Promise<ExecutionSpec>;
}

export interface Builder {
  build(run: WorkflowRun): Promise<BuildResult>;
  previewRuntimeRouting?(run: WorkflowRun): WorkflowRuntimeRoleSelection | undefined;
}

export interface Verifier {
  verify(run: WorkflowRun): Promise<VerificationReport>;
  previewRuntimeRouting?(run: WorkflowRun): WorkflowRuntimeRoleSelection | undefined;
}
