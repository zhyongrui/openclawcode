import type { ExecutionSpec, IssueRef } from "../contracts/index.js";
import type { Planner } from "./interfaces.js";

function toSentenceCase(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return "No issue summary provided.";
  }
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

export class HeuristicPlanner implements Planner {
  async plan(issue: IssueRef): Promise<ExecutionSpec> {
    const body = issue.body?.trim() ?? "";
    const bodyLines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      summary: `Implement GitHub issue #${issue.number}: ${issue.title}`,
      scope: [
        toSentenceCase(issue.title),
        ...(bodyLines.slice(0, 3).map((line) => toSentenceCase(line)) || [])
      ],
      outOfScope: ["Unrelated refactors", "Unrequested behavior changes"],
      acceptanceCriteria: [
        {
          id: "issue-alignment",
          text: "The implementation addresses the GitHub issue directly and stays within scope.",
          required: true
        },
        {
          id: "tests-green",
          text: "Repository checks selected for the run complete successfully.",
          required: true
        }
      ],
      testPlan: ["Run the requested test commands after implementation."],
      risks: body ? ["Issue details may still be ambiguous and require careful reading."] : ["Issue body is empty; infer cautiously."],
      assumptions: ["The local repository checkout matches the target GitHub repository."],
      openQuestions: [],
      riskLevel: "medium"
    };
  }
}
