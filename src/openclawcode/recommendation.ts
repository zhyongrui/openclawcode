export const OPENCLAWCODE_RECOMMENDATION_CONTRACT_VERSION = 1;
export const OPENCLAWCODE_SPEC_DRAFT_CONTRACT_VERSION = 1;

export const OPENCLAWCODE_RECOMMENDATION_INPUT_KINDS = [
  "goal",
  "problem",
  "partial-solution",
  "execution-ready",
] as const;

export const OPENCLAWCODE_RECOMMENDATION_WORK_TYPES = [
  "feature",
  "bugfix",
  "refactor",
  "research",
] as const;

export const OPENCLAWCODE_RECOMMENDATION_NEXT_STEP_IDS = [
  "ask-user",
  "draft-spec",
  "start-build",
] as const;

export const OPENCLAWCODE_RECOMMENDATION_MODES = ["discover", "spec", "build"] as const;
export const OPENCLAWCODE_RECOMMENDATION_IMPLEMENTATION_SHAPES = [
  "patch",
  "refactor",
  "new-slice",
  "spec-first",
  "research",
] as const;

export type OpenClawCodeRecommendationInputKind =
  (typeof OPENCLAWCODE_RECOMMENDATION_INPUT_KINDS)[number];
export type OpenClawCodeRecommendationWorkType =
  (typeof OPENCLAWCODE_RECOMMENDATION_WORK_TYPES)[number];
export type OpenClawCodeRecommendationNextStep =
  (typeof OPENCLAWCODE_RECOMMENDATION_NEXT_STEP_IDS)[number];
export type OpenClawCodeRecommendationMode =
  (typeof OPENCLAWCODE_RECOMMENDATION_MODES)[number];
export type OpenClawCodeRecommendationImplementationShape =
  (typeof OPENCLAWCODE_RECOMMENDATION_IMPLEMENTATION_SHAPES)[number];

export interface OpenClawCodeRecommendationAlternative {
  approach: string;
  when: string;
  tradeoff: string;
}

export interface OpenClawCodeRecommendationSignals {
  broadScope: boolean;
  publicSurface: boolean;
  riskySurface: boolean;
  missingSuccessCriteria: boolean;
  multiGoal: boolean;
}

export interface OpenClawCodeRecommendation {
  contractVersion: number;
  request: string;
  inputKind: OpenClawCodeRecommendationInputKind;
  workType: OpenClawCodeRecommendationWorkType;
  signals: OpenClawCodeRecommendationSignals;
  inferredGoal: string;
  recommendedApproach: string;
  rationale: string;
  alternatives: OpenClawCodeRecommendationAlternative[];
  openQuestions: string[];
  suggestedFirstSlice: string;
  nextStep: OpenClawCodeRecommendationNextStep;
  nextStepReason: string;
}

export interface OpenClawCodeSpecDraftQuestion {
  question: string;
  whyItMatters: string;
  blocking: boolean;
}

export interface OpenClawCodeSpecDraft {
  contractVersion: number;
  request: string;
  sourceKind: OpenClawCodeRecommendationInputKind;
  workType: OpenClawCodeRecommendationWorkType;
  recommendedMode: OpenClawCodeRecommendationMode;
  implementationShape: OpenClawCodeRecommendationImplementationShape;
  inferredGoal: string;
  recommendedApproach: {
    summary: string;
    rationale: string;
  };
  alternatives: OpenClawCodeRecommendationAlternative[];
  openQuestions: OpenClawCodeSpecDraftQuestion[];
  executionSpec: {
    summary: string;
    scope: string[];
    outOfScope: string[];
    acceptanceCriteria: Array<{ id: string; text: string; required: boolean }>;
    testPlan: string[];
    risks: string[];
    assumptions: string[];
    openQuestions: string[];
    riskLevel: "low" | "medium" | "high";
  };
  nextStep: OpenClawCodeRecommendationNextStep;
  nextStepReason: string;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function classifyRecommendationWorkType(input: string): OpenClawCodeRecommendationWorkType {
  if (/\b(fix|bug|regression|broken|crash|error|failure)\b/i.test(input)) {
    return "bugfix";
  }
  if (
    /\b(refactor|cleanup|clean up|rename|extract|restructure|reorganize|dedupe|simplify)\b/i.test(
      input,
    )
  ) {
    return "refactor";
  }
  if (/\b(investigate|diagnose|triage|research|spike|explore)\b/i.test(input)) {
    return "research";
  }
  return "feature";
}

export function classifyOpenClawCodeRecommendationInputKind(
  input: string,
): OpenClawCodeRecommendationInputKind {
  const normalized = normalizeWhitespace(input);
  if (!normalized) {
    return "goal";
  }

  if (
    /\b(issue\s*#\d+|implement\b|add\b|ship\b|wire\b|expose\b|support\b|document\b)\b/i.test(
      normalized,
    ) &&
    (/\b(issue\s*#\d+|--[a-z0-9-]+|`[^`]+`|src\/|docs\/|\.ts\b|\.md\b|json\b|cli\b|command\b)\b/i.test(
      normalized,
    ) ||
      /\bfor\b.+\bin\b/i.test(normalized))
  ) {
    return "execution-ready";
  }

  if (
    /^(maybe|perhaps|what if|consider)\b/i.test(normalized) ||
    /\b(we should|we could|maybe we need|maybe add|recommendation engine|planner before issue creation|follow-up questions)\b/i.test(
      normalized,
    )
  ) {
    return "partial-solution";
  }

  if (
    /\b(does not|doesn't|cannot|can't|stalls|stall|blocked|failing|fails|problem|issue|missing)\b/i.test(
      normalized,
    ) ||
    /\bbut it does not\b/i.test(normalized)
  ) {
    return "problem";
  }

  return "goal";
}

function detectSignals(input: string): OpenClawCodeRecommendationSignals {
  const normalized = normalizeWhitespace(input);
  const broadScope =
    normalized.split(" ").length >= 14 ||
    /\b(across|multiple|several|system|workflow|pipeline|architecture|operator|platform|overall|setup flow|onboarding|experience|end-to-end)\b/i.test(
      normalized,
    );
  const publicSurface =
    /--[a-z0-9-]+/i.test(normalized) ||
    /`[^`]+`/.test(normalized) ||
    /\b(api|sdk|plugin|protocol|schema|contract|json|cli|command|flag|manifest|readme|docs?)\b/i.test(
      normalized,
    );
  const riskySurface =
    /\b(auth|oauth|token|credential|secret|security|permission|billing|payment|migration|delete|drop|destroy|webhook|production|deploy)\b/i.test(
      normalized,
    );
  const missingSuccessCriteria =
    !/\b(test|proof|verify|verification|acceptance|success|done when|pass(es)?|should)\b/i.test(
      normalized,
    ) && /\b(make|more|better|smarter|proactive|improve|help|support|feel)\b/i.test(normalized);
  const multiGoal =
    /\b(and|also|plus)\b/i.test(normalized) &&
    (normalized.match(
      /\b(add|fix|refactor|document|support|improve|implement|investigate|clarify|recommend)\b/gi,
    )?.length ?? 0) >= 2;

  return {
    broadScope,
    publicSurface,
    riskySurface,
    missingSuccessCriteria,
    multiGoal,
  };
}

function inferGoal(params: {
  inputKind: OpenClawCodeRecommendationInputKind;
  workType: OpenClawCodeRecommendationWorkType;
  signals: OpenClawCodeRecommendationSignals;
}): string {
  const { inputKind, workType, signals } = params;
  if (inputKind === "problem") {
    return "Remove the current friction and turn the request into a concrete next engineering step.";
  }
  if (inputKind === "partial-solution") {
    return "Validate the proposed direction, narrow it, and keep only the part that should become the first shipped slice.";
  }
  if (inputKind === "execution-ready") {
    if (signals.publicSurface || signals.broadScope) {
      return "Land the requested change without destabilizing public or cross-cutting surfaces.";
    }
    if (workType === "bugfix") {
      return "Fix the named behavior with focused proof and a minimal patch.";
    }
    return "Ship the requested implementation slice directly with focused verification.";
  }
  if (signals.broadScope) {
    return "Translate the high-level product goal into a small, concrete workflow improvement.";
  }
  return "Turn the user goal into a clear implementation direction and the smallest credible first slice.";
}

function buildRecommendedApproach(params: {
  inputKind: OpenClawCodeRecommendationInputKind;
  workType: OpenClawCodeRecommendationWorkType;
  signals: OpenClawCodeRecommendationSignals;
}): { approach: string; rationale: string } {
  const { inputKind, workType, signals } = params;
  if (signals.riskySurface) {
    return {
      approach: "Clarify the rollout and safety constraints first, then land the smallest safe slice.",
      rationale:
        "The request touches a risky surface where auth, security, migration, or production constraints can change the right design.",
    };
  }
  if (workType === "research") {
    return {
      approach: "Run a short investigation that must end with a recommendation and one executable follow-up slice.",
      rationale:
        "Research work is only useful here if it resolves ambiguity and hands the executor a concrete next move.",
    };
  }
  if (inputKind === "execution-ready") {
    if (signals.publicSurface || signals.broadScope) {
      return {
        approach: "Write down the contract or seam change first, then implement one compatible slice.",
        rationale:
          "The request is specific enough to act on, but it touches a public or cross-cutting surface where an unscoped patch is likely to spread.",
      };
    }
    return {
      approach: "Implement the smallest safe patch in the existing surface and prove it with focused tests.",
      rationale:
        "The request is already concrete and narrow enough that direct execution is cheaper than adding extra planning layers.",
    };
  }
  if (inputKind === "partial-solution") {
    return {
      approach: "Keep the proposed direction, but narrow it to one shippable slice with a clear output contract.",
      rationale:
        "The user already hinted at the shape of the solution, so the main job is cutting scope rather than inventing a new direction.",
    };
  }
  if (signals.broadScope || signals.publicSurface) {
    return {
      approach: "Add a thin discovery-and-recommendation layer ahead of the existing execution loop.",
      rationale:
        "The request is outcome-oriented and still broad, so a small front-end decision layer is safer than changing the executor directly.",
    };
  }
  return {
    approach: "Translate the request into a short spec, then implement one visible first slice.",
    rationale:
      "There is still some ambiguity, but not enough to justify a large discovery phase or a full architecture pass.",
  };
}

function buildAlternatives(params: {
  inputKind: OpenClawCodeRecommendationInputKind;
  workType: OpenClawCodeRecommendationWorkType;
  signals: OpenClawCodeRecommendationSignals;
}): OpenClawCodeRecommendationAlternative[] {
  const { inputKind, workType, signals } = params;
  if (signals.riskySurface) {
    return [
      {
        approach: "Patch the local behavior only.",
        when: "Choose this when the surface is internal and the risk is operational rather than contractual.",
        tradeoff: "Faster now, but easier to miss rollout and compliance constraints.",
      },
      {
        approach: "Design a broader migration or compatibility layer.",
        when: "Choose this when existing users or external systems already depend on the current behavior.",
        tradeoff: "Safer for compatibility, but slower and more expensive upfront.",
      },
    ];
  }
  if (workType === "research") {
    return [
      {
        approach: "Do a quick local probe only.",
        when: "Choose this when you only need enough evidence to unblock the next implementation slice.",
        tradeoff: "Fast, but likely to miss deeper system interactions.",
      },
      {
        approach: "Write a fuller design memo first.",
        when: "Choose this when multiple teams or surfaces will reuse the research output.",
        tradeoff: "Clearer long-term record, but slower to produce the first result.",
      },
    ];
  }
  if (inputKind === "execution-ready" && !signals.publicSurface && !signals.broadScope) {
    return [
      {
        approach: "Extract a shared seam instead of patching in place.",
        when: "Choose this when the same behavior is about to spread across multiple commands or providers.",
        tradeoff: "Slightly slower now, but avoids duplicating the same logic in follow-up patches.",
      },
    ];
  }
  if (signals.broadScope || inputKind === "goal" || inputKind === "problem") {
    return [
      {
        approach: "Run a prompt-only experiment first.",
        when: "Choose this when you want to validate behavior quickly without committing to a new command or contract yet.",
        tradeoff: "Very fast to try, but the behavior stays inconsistent and harder to reuse.",
      },
      {
        approach: "Build a fuller planner or intake system immediately.",
        when: "Choose this when multiple repos, providers, or operator paths need the same decision contract right away.",
        tradeoff: "More durable, but too heavy for a first slice if the interaction model is still moving.",
      },
    ];
  }
  return [
    {
      approach: "Draft a broader shared seam before changing behavior.",
      when: "Choose this when the request is likely to become a default pattern elsewhere in the product.",
      tradeoff: "Cleaner long-term structure, but more upfront scope.",
    },
  ];
}

function buildOpenQuestions(params: {
  inputKind: OpenClawCodeRecommendationInputKind;
  signals: OpenClawCodeRecommendationSignals;
}): string[] {
  const questions: string[] = [];
  if (params.signals.missingSuccessCriteria) {
    questions.push("What exact user-visible behavior should the first slice change?");
  }
  if (params.signals.multiGoal) {
    questions.push("Which outcome matters first if this request needs to be split into separate slices?");
  }
  if (params.signals.riskySurface) {
    questions.push("What rollout, compatibility, or safety constraints must stay true during this change?");
  }
  if (
    params.inputKind !== "execution-ready" &&
    !params.signals.riskySurface &&
    !params.signals.multiGoal
  ) {
    questions.push("Should the first slice stop at recommendation, or should it immediately hand off to execution?");
  }
  return questions.slice(0, 3);
}

function buildSuggestedFirstSlice(params: {
  inputKind: OpenClawCodeRecommendationInputKind;
  workType: OpenClawCodeRecommendationWorkType;
  signals: OpenClawCodeRecommendationSignals;
}): string {
  const { inputKind, workType, signals } = params;
  if (workType === "research") {
    return "Define the investigation exit criteria, collect only the evidence needed to decide, and end with one recommended implementation slice.";
  }
  if (signals.riskySurface) {
    return "Write down the safety constraints, pick the smallest non-destructive change, and add proof that protects the risky path.";
  }
  if (inputKind === "execution-ready" && !signals.publicSurface && !signals.broadScope) {
    return "Change the existing code path, add the smallest focused proof, and keep the diff limited to the named surface.";
  }
  if (inputKind === "execution-ready") {
    return "Document the contract delta first, then implement one compatible path and prove that the old behavior still holds where required.";
  }
  if (inputKind === "partial-solution") {
    return "Turn the proposed direction into a short spec with input shape, output contract, and one shippable command or API slice.";
  }
  return 'Add `openclaw code recommend "<request>"` so the system classifies the request, recommends one path, lists open questions, and names the next step.';
}

function resolveRecommendedMode(
  nextStep: OpenClawCodeRecommendationNextStep,
): OpenClawCodeRecommendationMode {
  switch (nextStep) {
    case "start-build":
      return "build";
    case "draft-spec":
      return "spec";
    default:
      return "discover";
  }
}

function resolveImplementationShape(params: {
  inputKind: OpenClawCodeRecommendationInputKind;
  workType: OpenClawCodeRecommendationWorkType;
  signals: OpenClawCodeRecommendationSignals;
}): OpenClawCodeRecommendationImplementationShape {
  const { inputKind, workType, signals } = params;
  if (workType === "research") {
    return "research";
  }
  if (
    signals.riskySurface ||
    signals.broadScope ||
    signals.publicSurface ||
    signals.multiGoal ||
    signals.missingSuccessCriteria
  ) {
    return "spec-first";
  }
  if (workType === "refactor") {
    return "refactor";
  }
  if (workType === "bugfix" || inputKind === "execution-ready") {
    return "patch";
  }
  return "new-slice";
}

function buildSpecDraftQuestions(params: {
  recommendation: OpenClawCodeRecommendation;
}): OpenClawCodeSpecDraftQuestion[] {
  const { recommendation } = params;
  const questions: OpenClawCodeSpecDraftQuestion[] = [];
  const baseBlocking = recommendation.nextStep === "ask-user";
  if (recommendation.signals.missingSuccessCriteria) {
    questions.push({
      question: "What exact user-visible behavior should the first slice change?",
      whyItMatters:
        "The first slice cannot produce credible acceptance criteria until the target behavior is explicit.",
      blocking: true,
    });
  }
  if (recommendation.signals.multiGoal) {
    questions.push({
      question: "Which outcome matters first if this request needs to be split into separate slices?",
      whyItMatters:
        "This decides whether the work should stay in one patch or be decomposed before implementation.",
      blocking: true,
    });
  }
  if (recommendation.signals.riskySurface) {
    questions.push({
      question: "What rollout, compatibility, or safety constraints must stay true during this change?",
      whyItMatters:
        "Risky surfaces need explicit guardrails before the spec can safely hand off to implementation.",
      blocking: true,
    });
  }
  if (
    questions.length === 0 &&
    recommendation.openQuestions.length > 0 &&
    recommendation.openQuestions[0]
  ) {
    questions.push({
      question: recommendation.openQuestions[0],
      whyItMatters:
        "This decides whether the next slice should stop at recommendation or continue into scoped execution work.",
      blocking: baseBlocking,
    });
  }
  return questions.slice(0, 3);
}

function buildSpecDraftScope(params: {
  recommendation: OpenClawCodeRecommendation;
}): string[] {
  const { recommendation } = params;
  const scope = [
    recommendation.inferredGoal,
    recommendation.suggestedFirstSlice,
    `Follow the default implementation path: ${recommendation.recommendedApproach}`,
  ];
  if (recommendation.signals.publicSurface) {
    scope.push("Keep touched public contracts or operator-facing surfaces compatible and explicit.");
  }
  return scope;
}

function buildSpecDraftOutOfScope(params: {
  recommendation: OpenClawCodeRecommendation;
}): string[] {
  const { recommendation } = params;
  const outOfScope = ["Unrelated refactors or adjacent workflow changes not required for the first slice."];
  if (recommendation.signals.broadScope || recommendation.inputKind !== "execution-ready") {
    outOfScope.push("A full architecture rewrite or complete end-to-end rollout in the same first slice.");
  }
  if (recommendation.alternatives.length > 1) {
    outOfScope.push("Implementing every alternative path instead of choosing and proving one default path.");
  }
  return outOfScope;
}

function buildSpecDraftAcceptanceCriteria(params: {
  recommendation: OpenClawCodeRecommendation;
}): Array<{ id: string; text: string; required: boolean }> {
  const { recommendation } = params;
  const criteria = [
    {
      id: "goal-alignment",
      text: `The delivered slice clearly advances this request: ${recommendation.request}.`,
      required: true,
    },
    {
      id: "approach-alignment",
      text: `The implementation follows the recommended path: ${recommendation.recommendedApproach}.`,
      required: true,
    },
    {
      id: "proof",
      text: "Focused proof covers the changed behavior or contract and guards the touched surface.",
      required: true,
    },
  ];
  if (recommendation.alternatives.length > 0) {
    criteria.push({
      id: "alternative-boundary",
      text: "The chosen default path stays explicit, and alternative switching conditions remain understandable to operators.",
      required: false,
    });
  }
  return criteria;
}

function buildSpecDraftTestPlan(params: {
  recommendation: OpenClawCodeRecommendation;
}): string[] {
  const { recommendation } = params;
  const plan = [
    recommendation.nextStep === "start-build"
      ? "Run focused tests for the touched implementation surface before and after the patch."
      : "Add focused unit or contract coverage for the recommendation-driven behavior or touched public surface.",
  ];
  if (recommendation.signals.publicSurface) {
    plan.push("Add one compatibility-oriented assertion for the operator-facing or public contract change.");
  }
  if (recommendation.workType === "research") {
    plan.push("Capture the evidence that justifies the recommendation and keep the output small enough to unblock the next implementation slice.");
  }
  return plan;
}

function buildSpecDraftRisks(params: {
  recommendation: OpenClawCodeRecommendation;
}): string[] {
  const { recommendation } = params;
  const risks: string[] = [];
  if (recommendation.signals.riskySurface) {
    risks.push("The request touches a risky surface where rollout or safety mistakes can create production or security regressions.");
  }
  if (recommendation.signals.publicSurface) {
    risks.push("Operator-facing or public surface changes can create compatibility drift if the contract change is underspecified.");
  }
  if (recommendation.signals.broadScope || recommendation.signals.multiGoal) {
    risks.push("The first slice can sprawl unless scope stays narrow and one default path is chosen explicitly.");
  }
  if (recommendation.workType === "research") {
    risks.push("Investigation can drift into open-ended analysis unless it ends with one executable recommendation.");
  }
  return risks.length > 0 ? risks : ["The first slice may grow beyond the intended seam unless the diff stays narrow and evidence-backed."];
}

function buildSpecDraftAssumptions(params: {
  recommendation: OpenClawCodeRecommendation;
}): string[] {
  const { recommendation } = params;
  const assumptions = [
    "The repo already contains enough local context to choose a first implementation seam once this draft is accepted.",
    "The first slice may stay intentionally narrow and does not need to solve every adjacent follow-up in the same change.",
  ];
  if (recommendation.inputKind !== "execution-ready") {
    assumptions.push("The operator wants recommendation-first guidance before the existing execution loop takes over.");
  }
  return assumptions;
}

function resolveSpecDraftRiskLevel(params: {
  recommendation: OpenClawCodeRecommendation;
}): "low" | "medium" | "high" {
  const { recommendation } = params;
  if (recommendation.signals.riskySurface) {
    return "high";
  }
  if (
    recommendation.signals.publicSurface ||
    recommendation.signals.broadScope ||
    recommendation.signals.multiGoal ||
    recommendation.workType === "research"
  ) {
    return "medium";
  }
  return "low";
}

function resolveNextStep(params: {
  inputKind: OpenClawCodeRecommendationInputKind;
  workType: OpenClawCodeRecommendationWorkType;
  signals: OpenClawCodeRecommendationSignals;
}): { nextStep: OpenClawCodeRecommendationNextStep; reason: string } {
  const { inputKind, workType, signals } = params;
  if (signals.riskySurface || signals.multiGoal || signals.missingSuccessCriteria) {
    return {
      nextStep: "ask-user",
      reason:
        "One or more unanswered constraints would materially change the safest implementation path.",
    };
  }
  if (
    inputKind === "execution-ready" &&
    workType !== "research" &&
    !signals.publicSurface &&
    !signals.broadScope
  ) {
    return {
      nextStep: "start-build",
      reason: "The request is already specific and local enough to implement directly.",
    };
  }
  return {
    nextStep: "draft-spec",
    reason:
      "The request is close to actionable, but one compact spec or contract draft will reduce rework before coding starts.",
  };
}

export function buildOpenClawCodeRecommendation(request: string): OpenClawCodeRecommendation {
  const normalizedRequest = normalizeWhitespace(request);
  if (!normalizedRequest) {
    throw new Error("Recommendation input cannot be empty.");
  }

  const inputKind = classifyOpenClawCodeRecommendationInputKind(normalizedRequest);
  const workType = classifyRecommendationWorkType(normalizedRequest);
  const signals = detectSignals(normalizedRequest);
  const recommendation = buildRecommendedApproach({
    inputKind,
    workType,
    signals,
  });
  const nextStep = resolveNextStep({
    inputKind,
    workType,
    signals,
  });

  return {
    contractVersion: OPENCLAWCODE_RECOMMENDATION_CONTRACT_VERSION,
    request: normalizedRequest,
    inputKind,
    workType,
    signals,
    inferredGoal: inferGoal({
      inputKind,
      workType,
      signals,
    }),
    recommendedApproach: recommendation.approach,
    rationale: recommendation.rationale,
    alternatives: buildAlternatives({
      inputKind,
      workType,
      signals,
    }),
    openQuestions: buildOpenQuestions({
      inputKind,
      signals,
    }),
    suggestedFirstSlice: buildSuggestedFirstSlice({
      inputKind,
      workType,
      signals,
    }),
    nextStep: nextStep.nextStep,
    nextStepReason: nextStep.reason,
  };
}

export function buildOpenClawCodeSpecDraft(request: string): OpenClawCodeSpecDraft {
  const recommendation = buildOpenClawCodeRecommendation(request);
  const questions = buildSpecDraftQuestions({ recommendation });
  return {
    contractVersion: OPENCLAWCODE_SPEC_DRAFT_CONTRACT_VERSION,
    request: recommendation.request,
    sourceKind: recommendation.inputKind,
    workType: recommendation.workType,
    recommendedMode: resolveRecommendedMode(recommendation.nextStep),
    implementationShape: resolveImplementationShape({
      inputKind: recommendation.inputKind,
      workType: recommendation.workType,
      signals: recommendation.signals,
    }),
    inferredGoal: recommendation.inferredGoal,
    recommendedApproach: {
      summary: recommendation.recommendedApproach,
      rationale: recommendation.rationale,
    },
    alternatives: recommendation.alternatives,
    openQuestions: questions,
    executionSpec: {
      summary: recommendation.recommendedApproach,
      scope: buildSpecDraftScope({ recommendation }),
      outOfScope: buildSpecDraftOutOfScope({ recommendation }),
      acceptanceCriteria: buildSpecDraftAcceptanceCriteria({ recommendation }),
      testPlan: buildSpecDraftTestPlan({ recommendation }),
      risks: buildSpecDraftRisks({ recommendation }),
      assumptions: buildSpecDraftAssumptions({ recommendation }),
      openQuestions: questions.map((entry) => entry.question),
      riskLevel: resolveSpecDraftRiskLevel({ recommendation }),
    },
    nextStep: recommendation.nextStep,
    nextStepReason: recommendation.nextStepReason,
  };
}
