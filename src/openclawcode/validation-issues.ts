export type ValidationIssueTemplateId =
  | "command-json-boolean"
  | "command-json-number"
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

const VALIDATION_ISSUE_TEMPLATES: readonly ValidationIssueTemplateSummary[] = [
  {
    id: "command-json-boolean",
    issueClass: "command-layer",
    description: "Seed a low-risk JSON boolean field issue derived from a nested array path.",
  },
  {
    id: "command-json-number",
    issueClass: "command-layer",
    description: "Seed a low-risk JSON number-or-null field issue derived from nested metadata.",
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
        `- \`true\` when \`${sourcePath}\` contains at least one entry`,
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
        "Whenever downstream tooling needs a stable boolean instead of a nested array inspection.",
        "",
        "Consequence",
        "Without the derived boolean, simple consumers keep reimplementing the same array-length check logic.",
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

export function buildValidationIssueDraft(input: ValidationIssueDraftInput): ValidationIssueDraft {
  switch (input.template) {
    case "command-json-boolean":
      return buildCommandJsonBooleanDraft(input);
    case "command-json-number":
      return buildCommandJsonNumberDraft(input);
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
