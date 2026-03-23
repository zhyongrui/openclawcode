import path from "node:path";
import type { BuildPolicySignals, IssueRef } from "./contracts/index.js";

export const OPENCLAWCODE_POLICY_CONTRACT_VERSION = 1;

export const SUITABILITY_LOW_RISK_LABEL_ALLOWLIST = [
  "cli",
  "json",
  "command-layer",
  "docs",
  "operator-docs",
  "validation",
] as const;

export const SUITABILITY_HIGH_RISK_LABEL_DENYLIST = [
  "auth",
  "authentication",
  "billing",
  "database",
  "infra",
  "migration",
  "permissions",
  "rbac",
  "secret",
  "secrets",
  "security",
] as const;

export const SUITABILITY_LOW_RISK_KEYWORD_ALLOWLIST = [
  "openclaw code run",
  "--json",
  "cli",
  "command-layer",
  "docs-only",
  "operator doc",
  "validation issue",
] as const;

export const SUITABILITY_HIGH_RISK_KEYWORD_DENYLIST = [
  "auth",
  "authentication",
  "authorization",
  "oauth",
  "login",
  "secret",
  "credential",
  "password",
  "api key",
  "private key",
  "security",
  "vulnerability",
  "encryption",
  "decrypt",
  "migration",
  "schema",
  "database",
  "backfill",
  "billing",
  "payment",
  "invoice",
  "subscription",
  "permission",
  "access control",
  "rbac",
  "infra",
  "terraform",
  "kubernetes",
  "iam",
] as const;

export const BUILD_GUARDRAIL_BROAD_FAN_OUT_FILE_THRESHOLD = 8;
export const BUILD_GUARDRAIL_BROAD_FAN_OUT_DIRECTORY_THRESHOLD = 4;
export const BUILD_GUARDRAIL_LARGE_DIFF_LINE_THRESHOLD = 300;
export const BUILD_GUARDRAIL_LARGE_DIFF_FILE_THRESHOLD = 12;

export const BUILD_GENERATED_FILE_HINTS = [
  "dist/",
  "build/",
  "coverage/",
  "generated/",
  "__snapshots__/",
] as const;

export const PROVIDER_FAILURE_AUTO_PAUSE_CLASSES = ["provider-internal-error"] as const;

export const PROVIDER_FAILURE_NON_PAUSE_CLASSES = [
  "timeout",
  "rate-limit",
  "overload",
  "validation-failure",
] as const;

export interface SuitabilityPolicySignals {
  allowlisted: boolean;
  denylisted: boolean;
  matchedLowRiskLabels: string[];
  matchedLowRiskKeywords: string[];
  matchedHighRiskLabels: string[];
  matchedHighRiskKeywords: string[];
}

export interface OpenClawCodePolicySnapshot {
  contractVersion: 1;
  suitability: {
    lowRiskLabels: string[];
    highRiskLabels: string[];
    lowRiskKeywords: string[];
    highRiskKeywords: string[];
  };
  buildGuardrails: {
    broadFanOutFileThreshold: number;
    broadFanOutDirectoryThreshold: number;
    largeDiffLineThreshold: number;
    largeDiffFileThreshold: number;
    generatedFileHints: string[];
  };
  providerFailureHandling: {
    autoPauseClasses: string[];
    nonPauseClasses: string[];
  };
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function collectMatches(text: string, patterns: readonly string[]): string[] {
  return patterns.filter((pattern) => text.includes(pattern)).map((pattern) => pattern);
}

function normalizeLabels(labels: string[] | undefined): string[] {
  return (labels ?? []).map(normalizeValue).filter(Boolean);
}

export function collectSuitabilityPolicySignals(
  issue: Pick<IssueRef, "title" | "body" | "labels">,
): SuitabilityPolicySignals {
  const labels = normalizeLabels(issue.labels);
  const text = [issue.title, issue.body ?? "", ...labels].join("\n").toLowerCase();
  const matchedLowRiskLabels = labels.filter((label) =>
    SUITABILITY_LOW_RISK_LABEL_ALLOWLIST.includes(
      label as (typeof SUITABILITY_LOW_RISK_LABEL_ALLOWLIST)[number],
    ),
  );
  const matchedHighRiskLabels = labels.filter((label) =>
    SUITABILITY_HIGH_RISK_LABEL_DENYLIST.includes(
      label as (typeof SUITABILITY_HIGH_RISK_LABEL_DENYLIST)[number],
    ),
  );
  const matchedLowRiskKeywords = collectMatches(text, SUITABILITY_LOW_RISK_KEYWORD_ALLOWLIST);
  const matchedHighRiskKeywords = collectMatches(text, SUITABILITY_HIGH_RISK_KEYWORD_DENYLIST);
  return {
    allowlisted: matchedLowRiskLabels.length > 0 || matchedLowRiskKeywords.length > 0,
    denylisted: matchedHighRiskLabels.length > 0 || matchedHighRiskKeywords.length > 0,
    matchedLowRiskLabels,
    matchedLowRiskKeywords,
    matchedHighRiskLabels,
    matchedHighRiskKeywords,
  };
}

export function isLikelyGeneratedFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (
    BUILD_GENERATED_FILE_HINTS.some(
      (hint) => normalized.startsWith(hint) || normalized.includes(`/${hint}`),
    )
  ) {
    return true;
  }
  const base = path.basename(normalized);
  return (
    base.includes(".generated.") ||
    base.endsWith(".gen.ts") ||
    base.endsWith(".gen.js") ||
    base.endsWith(".g.ts") ||
    base.endsWith(".g.js")
  );
}

export function deriveBuildPolicySignals(params: {
  changedFiles: string[];
  changedLineCount: number;
}): BuildPolicySignals {
  const normalizedFiles = params.changedFiles.map((entry) => entry.replace(/\\/g, "/"));
  const directoryCount = new Set(
    normalizedFiles.map((entry) => {
      const dirname = path.posix.dirname(entry);
      return dirname === "." ? "" : dirname;
    }),
  ).size;
  const generatedFiles = normalizedFiles.filter((entry) => isLikelyGeneratedFile(entry));
  const broadFanOut =
    normalizedFiles.length >= BUILD_GUARDRAIL_BROAD_FAN_OUT_FILE_THRESHOLD ||
    directoryCount >= BUILD_GUARDRAIL_BROAD_FAN_OUT_DIRECTORY_THRESHOLD;
  const largeDiff =
    params.changedLineCount >= BUILD_GUARDRAIL_LARGE_DIFF_LINE_THRESHOLD ||
    normalizedFiles.length >= BUILD_GUARDRAIL_LARGE_DIFF_FILE_THRESHOLD;
  return {
    changedLineCount: params.changedLineCount,
    changedDirectoryCount: directoryCount,
    broadFanOut,
    largeDiff,
    generatedFiles,
  };
}

export function buildOpenClawCodePolicySnapshot(): OpenClawCodePolicySnapshot {
  return {
    contractVersion: OPENCLAWCODE_POLICY_CONTRACT_VERSION,
    suitability: {
      lowRiskLabels: [...SUITABILITY_LOW_RISK_LABEL_ALLOWLIST],
      highRiskLabels: [...SUITABILITY_HIGH_RISK_LABEL_DENYLIST],
      lowRiskKeywords: [...SUITABILITY_LOW_RISK_KEYWORD_ALLOWLIST],
      highRiskKeywords: [...SUITABILITY_HIGH_RISK_KEYWORD_DENYLIST],
    },
    buildGuardrails: {
      broadFanOutFileThreshold: BUILD_GUARDRAIL_BROAD_FAN_OUT_FILE_THRESHOLD,
      broadFanOutDirectoryThreshold: BUILD_GUARDRAIL_BROAD_FAN_OUT_DIRECTORY_THRESHOLD,
      largeDiffLineThreshold: BUILD_GUARDRAIL_LARGE_DIFF_LINE_THRESHOLD,
      largeDiffFileThreshold: BUILD_GUARDRAIL_LARGE_DIFF_FILE_THRESHOLD,
      generatedFileHints: [...BUILD_GENERATED_FILE_HINTS],
    },
    providerFailureHandling: {
      autoPauseClasses: [...PROVIDER_FAILURE_AUTO_PAUSE_CLASSES],
      nonPauseClasses: [...PROVIDER_FAILURE_NON_PAUSE_CLASSES],
    },
  };
}
