import { describe, expect, it } from "vitest";
import {
  buildOpenClawCodeRecommendation,
  buildOpenClawCodeSpecDraft,
  classifyOpenClawCodeRecommendationInputKind,
} from "./recommendation.js";

describe("classifyOpenClawCodeRecommendationInputKind", () => {
  it("recognizes goal-oriented requests", () => {
    expect(
      classifyOpenClawCodeRecommendationInputKind("Make the setup flow feel more proactive"),
    ).toBe("goal");
  });

  it("recognizes problem statements", () => {
    expect(
      classifyOpenClawCodeRecommendationInputKind(
        "Users give vague requests and the bot stalls before implementation starts",
      ),
    ).toBe("problem");
  });

  it("recognizes partial solutions", () => {
    expect(
      classifyOpenClawCodeRecommendationInputKind(
        "Maybe we need a recommendation engine before issue creation",
      ),
    ).toBe("partial-solution");
  });

  it("recognizes execution-ready requests", () => {
    expect(
      classifyOpenClawCodeRecommendationInputKind(
        "Add `foo` to openclaw code run --json in src/commands/openclawcode.ts",
      ),
    ).toBe("execution-ready");
  });
});

describe("buildOpenClawCodeRecommendation", () => {
  it("recommends a discovery layer for broad goal requests", () => {
    const recommendation = buildOpenClawCodeRecommendation(
      "Make the setup flow more proactive so it guides vague user requests",
    );

    expect(recommendation.inputKind).toBe("goal");
    expect(recommendation.workType).toBe("feature");
    expect(recommendation.recommendedApproach).toContain("discovery-and-recommendation layer");
    expect(recommendation.nextStep).toBe("ask-user");
    expect(recommendation.openQuestions[0]).toContain("user-visible behavior");
  });

  it("drafts a spec first for public execution requests", () => {
    const recommendation = buildOpenClawCodeRecommendation(
      "Add `foo` to openclaw code run --json in src/commands/openclawcode.ts",
    );

    expect(recommendation.inputKind).toBe("execution-ready");
    expect(recommendation.signals.publicSurface).toBe(true);
    expect(recommendation.nextStep).toBe("draft-spec");
    expect(recommendation.recommendedApproach).toContain("contract or seam change");
  });

  it("asks for constraints on risky surfaces", () => {
    const recommendation = buildOpenClawCodeRecommendation(
      "Add OAuth token rotation to the webhook bootstrap flow",
    );

    expect(recommendation.signals.riskySurface).toBe(true);
    expect(recommendation.nextStep).toBe("ask-user");
    expect(recommendation.openQuestions).toContain(
      "What rollout, compatibility, or safety constraints must stay true during this change?",
    );
  });

  it("treats research requests as investigation-first", () => {
    const recommendation = buildOpenClawCodeRecommendation(
      "Investigate why operators cannot tell what to build next",
    );

    expect(recommendation.workType).toBe("research");
    expect(recommendation.recommendedApproach).toContain("short investigation");
    expect(recommendation.suggestedFirstSlice).toContain("investigation exit criteria");
  });
});

describe("buildOpenClawCodeSpecDraft", () => {
  it("builds a spec-oriented draft for public execution requests", () => {
    const draft = buildOpenClawCodeSpecDraft(
      "Add `foo` to openclaw code run --json in src/commands/openclawcode.ts",
    );

    expect(draft.sourceKind).toBe("execution-ready");
    expect(draft.recommendedMode).toBe("spec");
    expect(draft.implementationShape).toBe("spec-first");
    expect(draft.executionSpec.summary).toContain("contract or seam change");
    expect(draft.executionSpec.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
    expect(draft.executionSpec.testPlan[0]).toContain("focused");
  });

  it("keeps narrow execution-ready changes in build mode", () => {
    const draft = buildOpenClawCodeSpecDraft(
      "Implement issue #123 for the retry parser in src/openclawcode/recommendation.ts",
    );

    expect(draft.recommendedMode).toBe("build");
    expect(draft.implementationShape).toBe("patch");
    expect(draft.nextStep).toBe("start-build");
    expect(draft.executionSpec.riskLevel).toBe("low");
  });

  it("surfaces blocking clarification questions for risky requests", () => {
    const draft = buildOpenClawCodeSpecDraft(
      "Add OAuth token rotation to the webhook bootstrap flow",
    );

    expect(draft.recommendedMode).toBe("discover");
    expect(draft.openQuestions.some((entry) => entry.blocking)).toBe(true);
    expect(draft.executionSpec.openQuestions).toContain(
      "What rollout, compatibility, or safety constraints must stay true during this change?",
    );
    expect(draft.executionSpec.riskLevel).toBe("high");
  });
});
