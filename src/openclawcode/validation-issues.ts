export type ValidationIssueTemplateId =
  | "command-json-boolean"
  | "command-json-number"
  | "command-json-string"
  | "command-json-string-timestamp"
  | "command-json-string-url"
  | "command-json-string-enum"
  | "operator-doc-note"
  | "webhook-precheck-high-risk";

export type ValidationIssueClass = "command-layer" | "operator-docs" | "high-risk-validation";

export interface ValidationIssueTemplateSummary {
  id: ValidationIssueTemplateId;
  issueClass: ValidationIssueClass;
  description: string;
}

export interface ValidationIssueDraft {
  template: ValidationIssueTemplateId;
  issueClass: ValidationIssueClass;
  title: string;
  body: string;
}

export interface ValidationIssueDraftInput {
  template: ValidationIssueTemplateId;
  fieldName?: string;
  sourcePath?: string;
  docPath?: string;
  summary?: string;
}

export interface ValidationIssueCandidate {
  title: string;
  body?: string;
}

export interface ClassifiedValidationIssue {
  template: ValidationIssueTemplateId;
  issueClass: ValidationIssueClass;
}

export interface ParsedValidationIssue extends ClassifiedValidationIssue {
  fieldName?: string;
}

export interface ValidationIssueImplementationContext {
  commandJsonSource?: string;
  commandJsonTests?: string;
  runJsonContractDoc?: string;
}

export interface ValidationIssueImplementationAssessment {
  state: "implemented" | "pending" | "manual-review";
  summary: string;
  autoClosable: boolean;
  fieldName?: string;
}

export interface ValidationPoolMinimumTarget {
  issueClass: ValidationIssueClass;
  minimumOpenIssues: number;
  rationale: string;
}

export interface ValidationPoolBalancedSeedRequest extends ValidationIssueDraftInput {
  issueClass: ValidationIssueClass;
}

export interface ValidationPoolDeficit extends ValidationPoolMinimumTarget {
  currentOpenIssues: number;
  missingIssues: number;
  defaultSeedRequests: ValidationPoolBalancedSeedRequest[];
}

const VALIDATION_ISSUE_TEMPLATES: readonly ValidationIssueTemplateSummary[] = [
  {
    id: "command-json-boolean",
    issueClass: "command-layer",
    description:
      "Seed a low-risk JSON boolean field issue derived from a nested boolean or array signal.",
  },
  {
    id: "command-json-number",
    issueClass: "command-layer",
    description: "Seed a low-risk JSON number-or-null field issue derived from nested metadata.",
  },
  {
    id: "command-json-string",
    issueClass: "command-layer",
    description: "Seed a low-risk JSON string-or-null field issue derived from nested metadata.",
  },
  {
    id: "command-json-string-timestamp",
    issueClass: "command-layer",
    description:
      "Seed a low-risk JSON timestamp-string-or-null field issue derived from nested metadata.",
  },
  {
    id: "command-json-string-url",
    issueClass: "command-layer",
    description:
      "Seed a low-risk JSON URL-string-or-null field issue derived from nested metadata.",
  },
  {
    id: "command-json-string-enum",
    issueClass: "command-layer",
    description:
      "Seed a low-risk JSON enum-string-or-null field issue derived from nested metadata.",
  },
  {
    id: "operator-doc-note",
    issueClass: "operator-docs",
    description: "Seed a low-risk docs or operator note issue for one specific file.",
  },
  {
    id: "webhook-precheck-high-risk",
    issueClass: "high-risk-validation",
    description: "Seed a high-risk webhook precheck validation issue for escalation routing.",
  },
] as const;

const VALIDATION_ISSUE_MARKER_PREFIX = "<!-- openclawcode-validation";

const VALIDATION_POOL_MINIMUM_TARGETS: readonly ValidationPoolMinimumTarget[] = [
  {
    issueClass: "command-layer",
    minimumOpenIssues: 0,
    rationale:
      "The seed-ready command-layer queue is currently exhausted, so zero open command-layer issues is an intentional steady state until a new candidate is identified.",
  },
  {
    issueClass: "operator-docs",
    minimumOpenIssues: 1,
    rationale:
      "Keep one low-risk docs/operator note in the pool so the operator can continuously validate docs-only flows without waiting for a new manual seed.",
  },
  {
    issueClass: "high-risk-validation",
    minimumOpenIssues: 1,
    rationale:
      "Keep one precheck-escalation validation issue available so high-risk routing remains easy to prove after changes.",
  },
] as const;

const VALIDATION_POOL_BALANCED_SEED_REQUESTS: readonly ValidationPoolBalancedSeedRequest[] = [
  {
    issueClass: "operator-docs",
    template: "operator-doc-note",
    docPath: "docs/openclawcode/validation-pool-contract.md",
    summary: "validation-pool maintenance cadence and minimum-pool expectations",
  },
  {
    issueClass: "high-risk-validation",
    template: "webhook-precheck-high-risk",
    summary: "credential or secret exposure requests",
  },
] as const;

function requireTrimmedOption(optionName: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${optionName} is required for this template`);
  }
  return trimmed;
}

function formatValidationIssueBody(draft: ValidationIssueDraft): string {
  return [
    `${VALIDATION_ISSUE_MARKER_PREFIX} template=${draft.template} class=${draft.issueClass} -->`,
    "",
    draft.body,
  ].join("\n");
}

function isValidationIssueTemplateId(value: string): value is ValidationIssueTemplateId {
  return VALIDATION_ISSUE_TEMPLATES.some((entry) => entry.id === value);
}

function isValidationIssueClass(value: string): value is ValidationIssueClass {
  return VALIDATION_ISSUE_TEMPLATES.some((entry) => entry.issueClass === value);
}

function parseValidationIssueMarker(
  body: string | undefined,
): ClassifiedValidationIssue | undefined {
  const match = body
    ?.trimStart()
    .match(/^<!-- openclawcode-validation template=([a-z0-9-]+) class=([a-z-]+) -->/);
  if (!match) {
    return undefined;
  }
  const [, template, issueClass] = match;
  if (!isValidationIssueTemplateId(template) || !isValidationIssueClass(issueClass)) {
    return undefined;
  }
  return {
    template,
    issueClass,
  };
}

function buildCommandJsonBooleanDraft(input: ValidationIssueDraftInput): ValidationIssueDraft {
  const fieldName = requireTrimmedOption("--field-name", input.fieldName);
  const sourcePath = requireTrimmedOption("--source-path", input.sourcePath);
  return {
    template: "command-json-boolean",
    issueClass: "command-layer",
    title: `[Feature]: Expose ${fieldName} in openclaw code run --json output`,
    body: formatValidationIssueBody({
      template: "command-json-boolean",
      issueClass: "command-layer",
      title: `[Feature]: Expose ${fieldName} in openclaw code run --json output`,
      body: [
        "Summary",
        `Add one stable top-level boolean field to \`openclaw code run --json\` named \`${fieldName}\`.`,
        "",
        "Problem to solve",
        `Downstream tooling currently has to inspect \`${sourcePath}\` directly just to decide whether the workflow run includes this signal. That is awkward for simple JSON consumers.`,
        "",
        "Proposed solution",
        `Update \`src/commands/openclawcode.ts\` so the JSON output includes \`${fieldName}: boolean\`.`,
        `- \`true\` when \`${sourcePath}\` resolves to \`true\` or contains at least one entry`,
        "- `false` otherwise",
        "",
        "Add or adjust unit tests in `src/commands/openclawcode.test.ts` to cover both cases.",
        "",
        "Impact",
        "Affected users/systems/channels",
        "Tools and scripts that read `openclaw code run --json`.",
        "",
        "Severity",
        "Low.",
        "",
        "Frequency",
        "Whenever downstream tooling needs a stable boolean instead of reimplementing nested truthiness or array-length checks.",
        "",
        "Consequence",
        "Without the derived boolean, simple consumers keep reimplementing the same nested truthiness or array-length check logic.",
      ].join("\n"),
    }),
  };
}

function buildCommandJsonNumberDraft(input: ValidationIssueDraftInput): ValidationIssueDraft {
  const fieldName = requireTrimmedOption("--field-name", input.fieldName);
  const sourcePath = requireTrimmedOption("--source-path", input.sourcePath);
  return {
    template: "command-json-number",
    issueClass: "command-layer",
    title: `[Feature]: Expose ${fieldName} in openclaw code run --json output`,
    body: formatValidationIssueBody({
      template: "command-json-number",
      issueClass: "command-layer",
      title: `[Feature]: Expose ${fieldName} in openclaw code run --json output`,
      body: [
        "Summary",
        `Add one stable top-level numeric field to \`openclaw code run --json\` named \`${fieldName}\`.`,
        "",
        "Problem to solve",
        `Downstream tooling currently has to inspect \`${sourcePath}\` directly just to read this nested numeric value. That is awkward for simple JSON consumers.`,
        "",
        "Proposed solution",
        `Update \`src/commands/openclawcode.ts\` so the JSON output includes \`${fieldName}: number | null\`.`,
        `- set it to the nested \`${sourcePath}\` value when present`,
        "- otherwise emit `null`",
        "",
        "Add or adjust unit tests in `src/commands/openclawcode.test.ts` to cover both cases.",
        "",
        "Impact",
        "Affected users/systems/channels",
        "Tools and scripts that read `openclaw code run --json`.",
        "",
        "Severity",
        "Low.",
        "",
        "Frequency",
        "Whenever downstream tooling wants this numeric value without unpacking nested workflow metadata.",
        "",
        "Consequence",
        "Without the derived field, simple consumers keep reimplementing the same nested null-check logic.",
      ].join("\n"),
    }),
  };
}

function buildCommandJsonStringDraft(input: ValidationIssueDraftInput): ValidationIssueDraft {
  return buildCommandJsonStringVariantDraft(input, "command-json-string");
}

function buildCommandJsonStringVariantDraft(
  input: ValidationIssueDraftInput,
  template: Extract<
    ValidationIssueTemplateId,
    | "command-json-string"
    | "command-json-string-timestamp"
    | "command-json-string-url"
    | "command-json-string-enum"
  >,
): ValidationIssueDraft {
  const fieldName = requireTrimmedOption("--field-name", input.fieldName);
  const sourcePath = requireTrimmedOption("--source-path", input.sourcePath);
  const descriptionByTemplate: Record<
    typeof template,
    {
      summary: string;
      problem: string;
      frequency: string;
      consequence: string;
    }
  > = {
    "command-json-string": {
      summary: "Add one stable top-level string field",
      problem:
        "Downstream tooling currently has to inspect the nested source path directly just to read this string value.",
      frequency:
        "Whenever downstream tooling wants this string value without unpacking nested workflow metadata.",
      consequence:
        "Without the derived field, simple consumers keep reimplementing the same nested null-check logic.",
    },
    "command-json-string-timestamp": {
      summary: "Add one stable top-level timestamp-like string field",
      problem:
        "Downstream tooling currently has to inspect the nested source path directly just to read this timestamp-like string.",
      frequency:
        "Whenever downstream tooling wants a timestamp-like string without unpacking nested workflow metadata.",
      consequence:
        "Without the derived timestamp helper, simple consumers keep reimplementing the same nested timestamp extraction logic.",
    },
    "command-json-string-url": {
      summary: "Add one stable top-level URL string field",
      problem:
        "Downstream tooling currently has to inspect the nested source path directly just to read this URL string.",
      frequency:
        "Whenever downstream tooling wants a URL string without unpacking nested workflow metadata.",
      consequence:
        "Without the derived URL helper, simple consumers keep reimplementing the same nested URL extraction logic.",
    },
    "command-json-string-enum": {
      summary: "Add one stable top-level enum-like string field",
      problem:
        "Downstream tooling currently has to inspect the nested source path directly just to read this enum-like string.",
      frequency:
        "Whenever downstream tooling wants this enum-like string without unpacking nested workflow metadata.",
      consequence:
        "Without the derived enum helper, simple consumers keep reimplementing the same nested enum extraction logic.",
    },
  };
  const details = descriptionByTemplate[template];
  return {
    template,
    issueClass: "command-layer",
    title: `[Feature]: Expose ${fieldName} in openclaw code run --json output`,
    body: formatValidationIssueBody({
      template,
      issueClass: "command-layer",
      title: `[Feature]: Expose ${fieldName} in openclaw code run --json output`,
      body: [
        "Summary",
        `${details.summary} to \`openclaw code run --json\` named \`${fieldName}\`.`,
        "",
        "Problem to solve",
        `${details.problem} That is awkward for simple JSON consumers.`,
        "",
        "Proposed solution",
        `Update \`src/commands/openclawcode.ts\` so the JSON output includes \`${fieldName}: string | null\`.`,
        `- set it to the nested \`${sourcePath}\` value when present`,
        "- otherwise emit `null`",
        "",
        "Add or adjust unit tests in `src/commands/openclawcode.test.ts` to cover both cases.",
        "",
        "Impact",
        "Affected users/systems/channels",
        "Tools and scripts that read `openclaw code run --json`.",
        "",
        "Severity",
        "Low.",
        "",
        "Frequency",
        details.frequency,
        "",
        "Consequence",
        details.consequence,
      ].join("\n"),
    }),
  };
}

function buildOperatorDocNoteDraft(input: ValidationIssueDraftInput): ValidationIssueDraft {
  const docPath = requireTrimmedOption("--doc-path", input.docPath);
  const summary = requireTrimmedOption("--summary", input.summary);
  return {
    template: "operator-doc-note",
    issueClass: "operator-docs",
    title: `[Docs]: Clarify ${summary}`,
    body: formatValidationIssueBody({
      template: "operator-doc-note",
      issueClass: "operator-docs",
      title: `[Docs]: Clarify ${summary}`,
      body: [
        "Summary",
        summary,
        "",
        "Problem to solve",
        `The current operator documentation at \`${docPath}\` does not explain this point clearly enough for repeated live validation or day-two operations.`,
        "",
        "Proposed solution",
        `Update \`${docPath}\` with a short, concrete operator note that clarifies the expected behavior and the intended workflow.`,
        "- keep the change docs-only",
        "- avoid broad rewrites outside the named document",
        "",
        "Acceptance criteria",
        `- \`${docPath}\` documents the behavior clearly enough that a future operator does not need to infer it from dev logs`,
        "- no workflow or runtime code changes are required",
        "",
        "Severity",
        "Low.",
      ].join("\n"),
    }),
  };
}

function buildWebhookPrecheckHighRiskDraft(input: ValidationIssueDraftInput): ValidationIssueDraft {
  const summary = input.summary?.trim() || "auth and secret issue";
  return {
    template: "webhook-precheck-high-risk",
    issueClass: "high-risk-validation",
    title: `[Validation]: Webhook intake should precheck-escalate ${summary}`,
    body: formatValidationIssueBody({
      template: "webhook-precheck-high-risk",
      issueClass: "high-risk-validation",
      title: `[Validation]: Webhook intake should precheck-escalate ${summary}`,
      body: [
        "Summary",
        `Validate that the GitHub webhook intake path precheck-escalates an issue before any approval or queue entry when the issue explicitly references ${summary}.`,
        "",
        "Expected behavior",
        "- plugin snapshot stage becomes escalated",
        "- delivery reason becomes precheck-escalated",
        "- no pending approval entry is created",
        "- no queued run is created",
        "",
        "Why this exists",
        "This is a repository-local validation issue for the webhook suitability precheck. It should not implement auth, secret handling, or permission changes.",
      ].join("\n"),
    }),
  };
}

export function listValidationIssueTemplates(): readonly ValidationIssueTemplateSummary[] {
  return VALIDATION_ISSUE_TEMPLATES;
}

export function listValidationPoolMinimumTargets(): readonly ValidationPoolMinimumTarget[] {
  return VALIDATION_POOL_MINIMUM_TARGETS;
}

export function listBalancedValidationPoolSeedRequests(): readonly ValidationPoolBalancedSeedRequest[] {
  return VALIDATION_POOL_BALANCED_SEED_REQUESTS;
}

export function resolveValidationPoolDeficits(
  openIssues: ReadonlyArray<Pick<ClassifiedValidationIssue, "issueClass">>,
): ValidationPoolDeficit[] {
  return VALIDATION_POOL_MINIMUM_TARGETS.map((target) => {
    const currentOpenIssues = openIssues.filter(
      (issue) => issue.issueClass === target.issueClass,
    ).length;
    const missingIssues = Math.max(0, target.minimumOpenIssues - currentOpenIssues);
    return {
      ...target,
      currentOpenIssues,
      missingIssues,
      defaultSeedRequests: VALIDATION_POOL_BALANCED_SEED_REQUESTS.filter(
        (request) => request.issueClass === target.issueClass,
      ),
    };
  });
}

export function classifyValidationIssue(
  candidate: ValidationIssueCandidate,
): ClassifiedValidationIssue | undefined {
  const fromMarker = parseValidationIssueMarker(candidate.body);
  if (fromMarker) {
    return fromMarker;
  }

  const body = candidate.body ?? "";
  if (
    candidate.title.startsWith("[Feature]: Expose ") &&
    candidate.title.endsWith(" in openclaw code run --json output")
  ) {
    if (body.includes(": boolean`.") || body.includes(": boolean`.\n")) {
      return {
        template: "command-json-boolean",
        issueClass: "command-layer",
      };
    }
    if (body.includes(": number | null`.") || body.includes(": number | null`.\n")) {
      return {
        template: "command-json-number",
        issueClass: "command-layer",
      };
    }
    if (body.includes(": string | null`.") || body.includes(": string | null`.\n")) {
      return {
        template: "command-json-string",
        issueClass: "command-layer",
      };
    }
  }

  if (
    candidate.title.startsWith("[Docs]: Clarify ") &&
    body.includes("keep the change docs-only") &&
    body.includes("avoid broad rewrites outside the named document")
  ) {
    return {
      template: "operator-doc-note",
      issueClass: "operator-docs",
    };
  }

  if (
    candidate.title.startsWith("[Validation]: Webhook intake should precheck-escalate ") &&
    body.includes("delivery reason becomes precheck-escalated") &&
    body.includes("no queued run is created")
  ) {
    return {
      template: "webhook-precheck-high-risk",
      issueClass: "high-risk-validation",
    };
  }

  return undefined;
}

function parseCommandJsonFieldName(title: string): string | undefined {
  const match = title.match(
    /^\[Feature\]: Expose ([A-Za-z0-9_]+) in openclaw code run --json output$/,
  );
  return match?.[1];
}

export function parseValidationIssue(
  candidate: ValidationIssueCandidate,
): ParsedValidationIssue | undefined {
  const classified = classifyValidationIssue(candidate);
  if (!classified) {
    return undefined;
  }

  if (
    classified.template === "command-json-boolean" ||
    classified.template === "command-json-number" ||
    classified.template === "command-json-string" ||
    classified.template === "command-json-string-timestamp" ||
    classified.template === "command-json-string-url" ||
    classified.template === "command-json-string-enum"
  ) {
    return {
      ...classified,
      fieldName: parseCommandJsonFieldName(candidate.title),
    };
  }

  return classified;
}

export function assessValidationIssueImplementation(
  issue: ParsedValidationIssue,
  context: ValidationIssueImplementationContext,
): ValidationIssueImplementationAssessment {
  if (
    issue.template !== "command-json-boolean" &&
    issue.template !== "command-json-number" &&
    issue.template !== "command-json-string" &&
    issue.template !== "command-json-string-timestamp" &&
    issue.template !== "command-json-string-url" &&
    issue.template !== "command-json-string-enum"
  ) {
    return {
      state: "manual-review",
      summary:
        "Automatic local implementation detection is only supported for command-layer JSON validation issues.",
      autoClosable: false,
    };
  }

  if (!issue.fieldName) {
    return {
      state: "manual-review",
      summary: "Could not determine the requested JSON field name from the issue title.",
      autoClosable: false,
    };
  }

  const contextPresent =
    context.commandJsonSource != null ||
    context.commandJsonTests != null ||
    context.runJsonContractDoc != null;
  if (!contextPresent) {
    return {
      state: "manual-review",
      summary: "Local repo sources were unavailable for automatic implementation detection.",
      autoClosable: false,
      fieldName: issue.fieldName,
    };
  }

  const commandFieldPresent = context.commandJsonSource?.includes(`${issue.fieldName}:`) ?? false;
  const commandTestPresent =
    context.commandJsonTests?.includes(`payload.${issue.fieldName}`) ?? false;
  const contractDocPresent =
    context.runJsonContractDoc?.includes(`- \`${issue.fieldName}\``) ?? false;

  if (commandFieldPresent && commandTestPresent && contractDocPresent) {
    return {
      state: "implemented",
      summary:
        "Field is already present in command output, covered by tests, and documented in the JSON contract.",
      autoClosable: true,
      fieldName: issue.fieldName,
    };
  }

  const missing: string[] = [];
  if (!commandFieldPresent) {
    missing.push("command output");
  }
  if (!commandTestPresent) {
    missing.push("command tests");
  }
  if (!contractDocPresent) {
    missing.push("JSON contract docs");
  }

  return {
    state: "pending",
    summary: `Still missing from ${missing.join(", ")}.`,
    autoClosable: false,
    fieldName: issue.fieldName,
  };
}

export function buildValidationIssueDraft(input: ValidationIssueDraftInput): ValidationIssueDraft {
  switch (input.template) {
    case "command-json-boolean":
      return buildCommandJsonBooleanDraft(input);
    case "command-json-number":
      return buildCommandJsonNumberDraft(input);
    case "command-json-string":
      return buildCommandJsonStringDraft(input);
    case "command-json-string-timestamp":
      return buildCommandJsonStringVariantDraft(input, "command-json-string-timestamp");
    case "command-json-string-url":
      return buildCommandJsonStringVariantDraft(input, "command-json-string-url");
    case "command-json-string-enum":
      return buildCommandJsonStringVariantDraft(input, "command-json-string-enum");
    case "operator-doc-note":
      return buildOperatorDocNoteDraft(input);
    case "webhook-precheck-high-risk":
      return buildWebhookPrecheckHighRiskDraft(input);
    default: {
      const unreachable: never = input.template;
      void unreachable;
      throw new Error("Unsupported validation issue template.");
    }
  }
}
