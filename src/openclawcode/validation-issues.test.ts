import { describe, expect, it } from "vitest";
import {
  assessValidationIssueImplementation,
  buildValidationIssueDraft,
  classifyValidationIssue,
  listValidationIssueTemplates,
  parseValidationIssue,
} from "./validation-issues.js";

describe("validation issue templates", () => {
  it("builds command-json-boolean drafts for scalar boolean paths too", () => {
    const draft = buildValidationIssueDraft({
      template: "command-json-boolean",
      fieldName: "failureDiagnosticBootstrapWarningShown",
      sourcePath: "failureDiagnostics.bootstrapWarningShown",
    });

    expect(draft).toMatchObject({
      template: "command-json-boolean",
      issueClass: "command-layer",
      title:
        "[Feature]: Expose failureDiagnosticBootstrapWarningShown in openclaw code run --json output",
    });
    expect(draft.body).toContain(
      "`failureDiagnostics.bootstrapWarningShown` resolves to `true` or contains at least one entry",
    );
    expect(draft.body).toContain("nested truthiness or array-length checks");
  });

  it("builds command-json-number drafts from the required field metadata", () => {
    const draft = buildValidationIssueDraft({
      template: "command-json-number",
      fieldName: "publishedPullRequestNumber",
      sourcePath: "draftPullRequest.number",
    });

    expect(draft).toMatchObject({
      template: "command-json-number",
      issueClass: "command-layer",
      title: "[Feature]: Expose publishedPullRequestNumber in openclaw code run --json output",
    });
    expect(
      draft.body.startsWith(
        "<!-- openclawcode-validation template=command-json-number class=command-layer -->",
      ),
    ).toBe(true);
    expect(draft.body).toContain("`publishedPullRequestNumber: number | null`");
    expect(draft.body).toContain("`draftPullRequest.number`");
  });

  it("builds command-json-string drafts from the required field metadata", () => {
    const draft = buildValidationIssueDraft({
      template: "command-json-string",
      fieldName: "failureDiagnosticProvider",
      sourcePath: "failureDiagnostics.provider",
    });

    expect(draft).toMatchObject({
      template: "command-json-string",
      issueClass: "command-layer",
      title: "[Feature]: Expose failureDiagnosticProvider in openclaw code run --json output",
    });
    expect(
      draft.body.startsWith(
        "<!-- openclawcode-validation template=command-json-string class=command-layer -->",
      ),
    ).toBe(true);
    expect(draft.body).toContain("`failureDiagnosticProvider: string | null`");
    expect(draft.body).toContain("`failureDiagnostics.provider`");
  });

  it("builds high-risk webhook precheck drafts with the default summary", () => {
    const draft = buildValidationIssueDraft({
      template: "webhook-precheck-high-risk",
    });

    expect(draft.title).toBe(
      "[Validation]: Webhook intake should precheck-escalate auth and secret issue",
    );
    expect(draft.body).toContain("precheck-escalates");
    expect(draft.body).toContain("no pending approval entry is created");
  });

  it("requires the template-specific command-json options", () => {
    expect(() =>
      buildValidationIssueDraft({
        template: "command-json-boolean",
        fieldName: "verificationHasSignals",
      }),
    ).toThrow("--source-path is required for this template");
  });

  it("classifies marked validation issues without relying on title heuristics", () => {
    const draft = buildValidationIssueDraft({
      template: "operator-doc-note",
      docPath: "docs/openclawcode/operator-setup.md",
      summary: "the preferred path for replenishing the validation issue pool",
    });

    expect(
      classifyValidationIssue({
        title: draft.title,
        body: draft.body,
      }),
    ).toEqual({
      template: "operator-doc-note",
      issueClass: "operator-docs",
    });
  });

  it("falls back to legacy body heuristics for pre-marker issues", () => {
    expect(
      classifyValidationIssue({
        title:
          "[Feature]: Expose verificationHasMissingCoverage in openclaw code run --json output",
        body: [
          "Summary",
          "Add one stable top-level boolean field to `openclaw code run --json` named `verificationHasMissingCoverage`.",
          "",
          "Proposed solution",
          "Update `src/commands/openclawcode.ts` so the JSON output includes `verificationHasMissingCoverage: boolean`.",
        ].join("\n"),
      }),
    ).toEqual({
      template: "command-json-boolean",
      issueClass: "command-layer",
    });
  });

  it("parses the requested field name from command-json validation issues", () => {
    expect(
      parseValidationIssue({
        title: "[Feature]: Expose riskCount in openclaw code run --json output",
        body: [
          "Summary",
          "Add one stable top-level numeric field to `openclaw code run --json` named `riskCount`.",
          "",
          "Proposed solution",
          "Update `src/commands/openclawcode.ts` so the JSON output includes `riskCount: number | null`.",
        ].join("\n"),
      }),
    ).toEqual({
      template: "command-json-number",
      issueClass: "command-layer",
      fieldName: "riskCount",
    });
  });

  it("parses command-json-string issues too", () => {
    expect(
      parseValidationIssue({
        title: "[Feature]: Expose failureDiagnosticProvider in openclaw code run --json output",
        body: [
          "Summary",
          "Add one stable top-level string field to `openclaw code run --json` named `failureDiagnosticProvider`.",
          "",
          "Proposed solution",
          "Update `src/commands/openclawcode.ts` so the JSON output includes `failureDiagnosticProvider: string | null`.",
        ].join("\n"),
      }),
    ).toEqual({
      template: "command-json-string",
      issueClass: "command-layer",
      fieldName: "failureDiagnosticProvider",
    });
  });

  it("marks command-json issues implemented when code, tests, and docs all carry the field", () => {
    const issue = parseValidationIssue({
      title: "[Feature]: Expose riskCount in openclaw code run --json output",
      body: [
        "Summary",
        "Add one stable top-level numeric field to `openclaw code run --json` named `riskCount`.",
        "",
        "Proposed solution",
        "Update `src/commands/openclawcode.ts` so the JSON output includes `riskCount: number | null`.",
      ].join("\n"),
    });

    expect(issue).toBeDefined();
    expect(
      assessValidationIssueImplementation(issue!, {
        commandJsonSource: "riskCount: run.executionSpec?.risks.length ?? null,",
        commandJsonTests: "expect(payload.riskCount).toBe(2);",
        runJsonContractDoc: "- `riskCount`",
      }),
    ).toEqual({
      state: "implemented",
      summary:
        "Field is already present in command output, covered by tests, and documented in the JSON contract.",
      autoClosable: true,
      fieldName: "riskCount",
    });
  });

  it("marks command-json issues pending when one or more implementation surfaces are missing", () => {
    const issue = parseValidationIssue({
      title: "[Feature]: Expose riskCount in openclaw code run --json output",
      body: [
        "Summary",
        "Add one stable top-level numeric field to `openclaw code run --json` named `riskCount`.",
        "",
        "Proposed solution",
        "Update `src/commands/openclawcode.ts` so the JSON output includes `riskCount: number | null`.",
      ].join("\n"),
    });

    expect(issue).toBeDefined();
    expect(
      assessValidationIssueImplementation(issue!, {
        commandJsonSource: "",
        commandJsonTests: "expect(payload.riskCount).toBe(2);",
        runJsonContractDoc: "",
      }),
    ).toEqual({
      state: "pending",
      summary: "Still missing from command output, JSON contract docs.",
      autoClosable: false,
      fieldName: "riskCount",
    });
  });

  it("falls back to manual review for non-command validation issues", () => {
    const issue = parseValidationIssue({
      title: "[Docs]: Clarify copied-root teardown expectations after fresh-operator validation",
      body: [
        "Summary",
        "copied-root teardown expectations after fresh-operator validation",
        "",
        "- keep the change docs-only",
        "- avoid broad rewrites outside the named document",
      ].join("\n"),
    });

    expect(issue).toBeDefined();
    expect(
      assessValidationIssueImplementation(issue!, {
        commandJsonSource: "",
        commandJsonTests: "",
        runJsonContractDoc: "",
      }),
    ).toEqual({
      state: "manual-review",
      summary:
        "Automatic local implementation detection is only supported for command-layer JSON validation issues.",
      autoClosable: false,
    });
  });

  it("lists the supported validation templates in a stable order", () => {
    expect(listValidationIssueTemplates()).toEqual([
      {
        id: "command-json-boolean",
        issueClass: "command-layer",
        description:
          "Seed a low-risk JSON boolean field issue derived from a nested boolean or array signal.",
      },
      {
        id: "command-json-number",
        issueClass: "command-layer",
        description:
          "Seed a low-risk JSON number-or-null field issue derived from nested metadata.",
      },
      {
        id: "command-json-string",
        issueClass: "command-layer",
        description:
          "Seed a low-risk JSON string-or-null field issue derived from nested metadata.",
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
    ]);
  });
});
