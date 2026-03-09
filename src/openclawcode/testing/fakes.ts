import type { BuildResult, ExecutionSpec, IssueRef, VerificationReport, WorkflowRun } from "../contracts/index.js";
import type { Builder, Planner, Verifier } from "../roles/index.js";

export class FakePlanner implements Planner {
  async plan(issue: IssueRef): Promise<ExecutionSpec> {
    return {
      summary: `Implement issue #${issue.number}: ${issue.title}`,
      scope: ["Parse issue", "Create execution spec", "Prepare implementation handoff"],
      outOfScope: ["Runtime provider integration"],
      acceptanceCriteria: [
        {
          id: "ac-1",
          text: "Workflow run contains a populated execution spec",
          required: true
        }
      ],
      testPlan: ["Run type checks", "Exercise orchestrator flow"],
      risks: ["Spec may need human clarification for ambiguous issues"],
      assumptions: ["Repository context is available locally"],
      openQuestions: [],
      riskLevel: "medium"
    };
  }
}

export class FakeBuilder implements Builder {
  async build(run: WorkflowRun): Promise<BuildResult> {
    return {
      branchName: `issue/${run.issue.number}`,
      summary: `Prepared workflow changes for issue #${run.issue.number}.`,
      changedFiles: ["src/openclawcode/orchestrator/run.ts"],
      testCommands: ["pnpm check", "pnpm test:fast"],
      testResults: ["Workflow skeleton validated"],
      notes: ["This is a fake builder used for orchestration tests"]
    };
  }
}

export class FakeVerifier implements Verifier {
  constructor(private readonly approved: boolean = true) {}

  async verify(run: WorkflowRun): Promise<VerificationReport> {
    return {
      decision: this.approved ? "approve-for-human-review" : "request-changes",
      summary: this.approved
        ? `Issue #${run.issue.number} is ready for human review.`
        : `Issue #${run.issue.number} needs another build iteration.`,
      findings: this.approved ? [] : ["Verification requested additional refinement"],
      missingCoverage: [],
      followUps: this.approved ? [] : ["Re-run builder after addressing findings"]
    };
  }
}
