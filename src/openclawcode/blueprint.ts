import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import { readProjectBlueprintDiscussionArtifact } from "./blueprint-discussion.js";

export const PROJECT_BLUEPRINT_FILENAME = "PROJECT-BLUEPRINT.md";
export const PROJECT_BLUEPRINT_SCHEMA_VERSION = 1;
export const PROJECT_BLUEPRINT_ROLE_IDS = [
  "planner",
  "coder",
  "reviewer",
  "verifier",
  "docWriter",
] as const;
export const PROJECT_BLUEPRINT_STATUSES = [
  "draft",
  "clarified",
  "agreed",
  "active",
  "superseded",
] as const;
export const PROJECT_BLUEPRINT_REQUIRED_SECTIONS = [
  "Goal",
  "Success Criteria",
  "Scope",
  "Non-Goals",
  "Constraints",
  "Risks",
  "Assumptions",
  "Human Gates",
  "Provider Strategy",
  "Workstreams",
  "Open Questions",
] as const;
export const PROJECT_BLUEPRINT_SECTION_IDS = [
  "goal",
  "success-criteria",
  "scope",
  "non-goals",
  "constraints",
  "risks",
  "assumptions",
  "human-gates",
  "provider-strategy",
  "workstreams",
  "open-questions",
] as const;

const PROJECT_BLUEPRINT_SECTION_ALIASES = {
  goal: "Goal",
  "success-criteria": "Success Criteria",
  successcriteria: "Success Criteria",
  scope: "Scope",
  "non-goals": "Non-Goals",
  nongoals: "Non-Goals",
  constraints: "Constraints",
  risks: "Risks",
  assumptions: "Assumptions",
  "human-gates": "Human Gates",
  humangates: "Human Gates",
  "provider-strategy": "Provider Strategy",
  providerstrategy: "Provider Strategy",
  workstreams: "Workstreams",
  "open-questions": "Open Questions",
  openquestions: "Open Questions",
} as const satisfies Record<string, (typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number]>;

export type ProjectBlueprintStatus = (typeof PROJECT_BLUEPRINT_STATUSES)[number];
export type ProjectBlueprintRoleId = (typeof PROJECT_BLUEPRINT_ROLE_IDS)[number];
export type ProjectBlueprintSectionName = (typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number];

export interface ProjectBlueprintRoleAssignments {
  planner: string | null;
  coder: string | null;
  reviewer: string | null;
  verifier: string | null;
  docWriter: string | null;
}

export interface ProjectBlueprintSummary {
  repoRoot: string;
  blueprintPath: string;
  exists: boolean;
  schemaVersion: number | null;
  status: ProjectBlueprintStatus | null;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  agreedAt: string | null;
  statusChangedAt: string | null;
  revisionId: string | null;
  contentSha256: string | null;
  goalSummary: string | null;
  sectionCount: number;
  sections: string[];
  frontmatterKeys: string[];
  requiredSectionsPresent: boolean;
  missingRequiredSections: string[];
  hasAgreementCheckpoint: boolean;
  defaultedSectionCount: number;
  defaultedSections: string[];
  workstreamCandidateCount: number;
  openQuestionCount: number;
  humanGateCount: number;
  providerRoleAssignments: ProjectBlueprintRoleAssignments;
  validationErrorCount: number;
  validationErrors: string[];
  validationWarningCount: number;
  validationWarnings: string[];
  clarificationHistoryCount: number;
  lastClarificationAt: string | null;
}

export interface ProjectBlueprintClarificationReport extends ProjectBlueprintSummary {
  priorityQuestion: string | null;
  questions: string[];
  suggestions: string[];
  questionCount: number;
  suggestionCount: number;
}

export interface ProjectBlueprintDocument extends ProjectBlueprintSummary {
  content: string | null;
  sectionBodies: Partial<Record<string, string>>;
}

interface ProjectBlueprintFrontmatter {
  schemaVersion: number;
  title: string;
  status: ProjectBlueprintStatus;
  createdAt: string;
  updatedAt: string;
  statusChangedAt?: string;
  agreedAt?: string;
}

const PROJECT_BLUEPRINT_PLACEHOLDER_SNIPPETS: Partial<
  Record<(typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number], string[]>
> = {
  Goal: ["Describe the agreed project goal here before autonomous work begins."],
  "Success Criteria": [
    "Define the first externally visible success criterion for this project.",
    "Define the first proof that another operator can repeat.",
  ],
  Scope: ["In scope:", "Out of scope:"],
  "Non-Goals": ["Record what this project should not attempt in the current delivery window."],
  Constraints: ["Technical:", "Product:", "Operational:"],
  Risks: ["Record the main delivery, safety, or provider risks."],
  Assumptions: ["Record any assumption that still needs confirmation."],
  "Human Gates": [
    "Goal agreement: required",
    "Work item creation: operator may intervene",
    "Merge or promotion: operator may intervene",
  ],
  "Provider Strategy": ["Planner:", "Coder:", "Reviewer:", "Verifier:", "Doc-writer:"],
  Workstreams: ["Break the blueprint into execution work items after agreement."],
  "Open Questions": ["Record anything that still needs clarification."],
};

const PROJECT_BLUEPRINT_PROVIDER_ROLE_HEADINGS: Record<string, ProjectBlueprintRoleId> = {
  Planner: "planner",
  Coder: "coder",
  Reviewer: "reviewer",
  Verifier: "verifier",
  "Doc-writer": "docWriter",
};

const PROJECT_BLUEPRINT_PROVIDER_ROLE_LABELS: Record<ProjectBlueprintRoleId, string> = {
  planner: "Planner",
  coder: "Coder",
  reviewer: "Reviewer",
  verifier: "Verifier",
  docWriter: "Doc-writer",
};

export interface CreateProjectBlueprintOptions {
  repoRoot: string;
  title?: string;
  goal?: string;
  force?: boolean;
  now?: string;
}

export interface UpdateProjectBlueprintStatusOptions {
  repoRoot: string;
  status: ProjectBlueprintStatus;
  now?: string;
}

export interface UpdateProjectBlueprintProviderRoleOptions {
  repoRoot: string;
  roleId: ProjectBlueprintRoleId;
  provider: string | null;
  now?: string;
}

export interface UpdateProjectBlueprintSectionOptions {
  repoRoot: string;
  sectionName: ProjectBlueprintSectionName;
  body: string;
  append?: boolean;
  createIfMissing?: boolean;
  title?: string;
  now?: string;
}

function isProjectBlueprintStatus(value: string): value is ProjectBlueprintStatus {
  return PROJECT_BLUEPRINT_STATUSES.includes(value as ProjectBlueprintStatus);
}

function normalizeProjectBlueprintRoleId(value: string): ProjectBlueprintRoleId | null {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "planner":
      return "planner";
    case "coder":
      return "coder";
    case "reviewer":
      return "reviewer";
    case "verifier":
      return "verifier";
    case "doc-writer":
    case "docwriter":
    case "doc_writer":
      return "docWriter";
    default:
      return null;
  }
}

function normalizeProjectBlueprintSectionName(value: string): ProjectBlueprintSectionName | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return Object.hasOwn(PROJECT_BLUEPRINT_SECTION_ALIASES, normalized)
    ? PROJECT_BLUEPRINT_SECTION_ALIASES[
        normalized as keyof typeof PROJECT_BLUEPRINT_SECTION_ALIASES
      ]
    : null;
}

function normalizeProjectBlueprintStatus(value: string | undefined): ProjectBlueprintStatus | null {
  if (!value || !isProjectBlueprintStatus(value)) {
    return null;
  }
  return value;
}

function extractMarkdownTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function extractSectionNames(content: string): string[] {
  return [...content.matchAll(/^##\s+(.+)$/gm)]
    .map((match) => match[1]?.trim())
    .filter((section): section is string => Boolean(section));
}

function normalizeMarkdownListItem(line: string): string | null {
  const trimmed = line.trim();
  const match =
    trimmed.match(/^[-*]\s+\[(?: |x|X)\]\s+(.+)$/) ??
    trimmed.match(/^[-*]\s+(.+)$/) ??
    trimmed.match(/^\d+\.\s+(.+)$/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractMarkdownListItems(content: string): string[] {
  return content
    .split("\n")
    .map((line) => normalizeMarkdownListItem(line))
    .filter((item): item is string => Boolean(item))
    .filter((item) => !/^none\b/i.test(item));
}

function extractGoalSummary(content: string): string | null {
  const sections = extractSectionBodies(content);
  const goalBody = sections.Goal;
  if (!goalBody) {
    return null;
  }
  const firstLine = goalBody
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? null;
}

function extractSectionBodies(content: string): Partial<Record<string, string>> {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const headings = [...normalized.matchAll(/^##\s+(.+)$/gm)];
  const sections: Partial<Record<string, string>> = {};

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const sectionName = heading[1]?.trim();
    const sectionStart = heading.index == null ? -1 : heading.index + heading[0].length;
    const nextHeadingIndex = headings[index + 1]?.index ?? normalized.length;
    if (!sectionName || sectionStart < 0) {
      continue;
    }
    sections[sectionName] = normalized.slice(sectionStart, nextHeadingIndex).trim();
  }

  return sections;
}

function joinNaturalLanguageList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function pushUniqueOrdered(
  target: Array<{ priority: number; text: string }>,
  seen: Set<string>,
  text: string,
  priority: number,
): void {
  if (seen.has(text)) {
    return;
  }
  seen.add(text);
  target.push({ priority, text });
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: null, body: normalized };
  }
  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { frontmatter: null, body: normalized };
  }
  return {
    frontmatter: normalized.slice(4, endIndex),
    body: normalized.slice(endIndex + 5),
  };
}

function renderFrontmatter(frontmatter: ProjectBlueprintFrontmatter): string {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n`;
}

function emptyProjectBlueprintRoleAssignments(): ProjectBlueprintRoleAssignments {
  return {
    planner: null,
    coder: null,
    reviewer: null,
    verifier: null,
    docWriter: null,
  };
}

function parseProjectBlueprintRoleAssignments(
  providerStrategyBody: string | undefined,
): ProjectBlueprintRoleAssignments {
  const assignments = emptyProjectBlueprintRoleAssignments();
  if (!providerStrategyBody) {
    return assignments;
  }

  for (const item of extractMarkdownListItems(providerStrategyBody)) {
    const match = item.match(/^([^:]+):\s*(.*)$/);
    if (!match?.[1]) {
      continue;
    }
    const roleId = PROJECT_BLUEPRINT_PROVIDER_ROLE_HEADINGS[match[1].trim()];
    if (!roleId) {
      continue;
    }
    const value = match[2]?.trim() || null;
    assignments[roleId] = value && value.length > 0 ? value : null;
  }

  return assignments;
}

function sectionContainsPhrase(
  sectionBodies: Partial<Record<string, string>>,
  sectionName: string,
  pattern: RegExp,
): boolean {
  const body = sectionBodies[sectionName];
  return typeof body === "string" ? pattern.test(body) : false;
}

function isLikelyHorizontalWorkstream(workstream: string): boolean {
  const normalized = workstream.toLowerCase();
  if (
    /\b(fix|bug|regression|broken|crash|error|refactor|cleanup|clean up|rename|extract|investigate|diagnose|triage|research|spike)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  const layerWords = [
    "frontend",
    "backend",
    "api",
    "database",
    "schema",
    "migration",
    "ui",
    "server",
    "client",
    "tests",
    "test",
    "docs",
    "documentation",
    "infra",
    "infrastructure",
  ];
  const outcomeWords = [
    "user",
    "operator",
    "customer",
    "chat",
    "cli",
    "command",
    "issue",
    "blueprint",
    "workflow",
    "setup",
    "status",
    "progress",
    "summary",
    "materialize",
    "autonomous",
    "notification",
    "webhook",
  ];

  return (
    layerWords.some((word) => normalized.includes(word)) &&
    !outcomeWords.some((word) => normalized.includes(word))
  );
}

function defaultedProjectBlueprintSections(
  sectionBodies: Partial<Record<string, string>>,
): (typeof PROJECT_BLUEPRINT_REQUIRED_SECTIONS)[number][] {
  return PROJECT_BLUEPRINT_REQUIRED_SECTIONS.filter((section) => {
    const body = sectionBodies[section];
    if (!body) {
      return false;
    }
    const placeholders = PROJECT_BLUEPRINT_PLACEHOLDER_SNIPPETS[section] ?? [];
    if (placeholders.length === 0) {
      return false;
    }

    const placeholderListItems = placeholders
      .map((placeholder) => normalizeMarkdownListItem(placeholder) ?? placeholder.trim())
      .filter((item): item is string => Boolean(item));
    const actualListItems = extractMarkdownListItems(body);
    if (actualListItems.length > 0 && placeholderListItems.length === placeholders.length) {
      return (
        actualListItems.length === placeholderListItems.length &&
        actualListItems.every((item, index) => item === placeholderListItems[index])
      );
    }

    return body.trim() === placeholders.join("\n").trim();
  });
}

function computeBlueprintContentSha(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256").update(normalized).digest("hex");
}

function renderProjectBlueprintBody(params: {
  title: string;
  goal: string;
  createdAt: string;
}): string {
  return [
    `# ${params.title}`,
    "",
    "## Goal",
    params.goal,
    "",
    "## Success Criteria",
    "- [ ] Define the first externally visible success criterion for this project.",
    "- [ ] Define the first proof that another operator can repeat.",
    "",
    "## Scope",
    "- In scope:",
    "- Out of scope:",
    "",
    "## Non-Goals",
    "- Record what this project should not attempt in the current delivery window.",
    "",
    "## Constraints",
    "- Technical:",
    "- Product:",
    "- Operational:",
    "",
    "## Risks",
    "- Record the main delivery, safety, or provider risks.",
    "",
    "## Assumptions",
    "- Record any assumption that still needs confirmation.",
    "",
    "## Human Gates",
    "- Goal agreement: required",
    "- Work item creation: operator may intervene",
    "- Merge or promotion: operator may intervene",
    "",
    "## Provider Strategy",
    "- Planner:",
    "- Coder:",
    "- Reviewer:",
    "- Verifier:",
    "- Doc-writer:",
    "",
    "## Workstreams",
    "- [ ] Break the blueprint into execution work items after agreement.",
    "",
    "## Open Questions",
    "- Record anything that still needs clarification.",
    "",
    "## Change Log",
    `- ${params.createdAt.slice(0, 10)}: blueprint scaffold created by \`openclaw code blueprint-init\`.`,
    "",
  ].join("\n");
}

function parseProjectBlueprintContent(params: {
  repoRoot: string;
  blueprintPath: string;
  content: string;
}): ProjectBlueprintSummary {
  const frontmatter = parseFrontmatterBlock(params.content);
  const sectionBodies = extractSectionBodies(params.content);
  const status = normalizeProjectBlueprintStatus(frontmatter.status);
  const sections = extractSectionNames(params.content);
  const missingRequiredSections = PROJECT_BLUEPRINT_REQUIRED_SECTIONS.filter(
    (section) => !sections.includes(section),
  );
  const defaultedSections = defaultedProjectBlueprintSections(sectionBodies);
  const schemaVersionRaw = frontmatter.schemaVersion
    ? Number.parseInt(frontmatter.schemaVersion, 10)
    : Number.NaN;
  const contentSha256 = computeBlueprintContentSha(params.content);
  const workstreamItems = defaultedSections.includes("Workstreams")
    ? []
    : extractMarkdownListItems(sectionBodies.Workstreams ?? "");
  const openQuestions = defaultedSections.includes("Open Questions")
    ? []
    : extractMarkdownListItems(sectionBodies["Open Questions"] ?? "");
  const humanGates = defaultedSections.includes("Human Gates")
    ? []
    : extractMarkdownListItems(sectionBodies["Human Gates"] ?? "");

  return {
    repoRoot: params.repoRoot,
    blueprintPath: params.blueprintPath,
    exists: true,
    schemaVersion: Number.isFinite(schemaVersionRaw) ? schemaVersionRaw : null,
    status,
    title: extractMarkdownTitle(params.content) ?? frontmatter.title ?? null,
    createdAt: frontmatter.createdAt ?? null,
    updatedAt: frontmatter.updatedAt ?? null,
    agreedAt: frontmatter.agreedAt ?? null,
    statusChangedAt: frontmatter.statusChangedAt ?? frontmatter.updatedAt ?? null,
    revisionId: contentSha256.slice(0, 12),
    contentSha256,
    goalSummary: extractGoalSummary(params.content),
    sectionCount: sections.length,
    sections,
    frontmatterKeys: Object.keys(frontmatter).toSorted(),
    requiredSectionsPresent: missingRequiredSections.length === 0,
    missingRequiredSections,
    hasAgreementCheckpoint:
      status === "agreed" ||
      status === "active" ||
      status === "superseded" ||
      Boolean(frontmatter.agreedAt),
    defaultedSectionCount: defaultedSections.length,
    defaultedSections,
    workstreamCandidateCount: workstreamItems.length,
    openQuestionCount: openQuestions.length,
    humanGateCount: humanGates.length,
    providerRoleAssignments: parseProjectBlueprintRoleAssignments(
      sectionBodies["Provider Strategy"],
    ),
    validationErrorCount: 0,
    validationErrors: [],
    validationWarningCount: 0,
    validationWarnings: [],
    clarificationHistoryCount: 0,
    lastClarificationAt: null,
  };
}

function normalizeComparableItem(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildProjectBlueprintValidation(params: {
  summary: ProjectBlueprintSummary;
  sectionBodies: Partial<Record<string, string>>;
}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const section of params.summary.missingRequiredSections) {
    errors.push(`Missing required section: ${section}.`);
  }
  for (const section of params.summary.defaultedSections) {
    errors.push(`Section still uses the default scaffold text: ${section}.`);
  }

  const scopeItems = extractMarkdownListItems(params.sectionBodies.Scope ?? "");
  const nonGoalItems = extractMarkdownListItems(params.sectionBodies["Non-Goals"] ?? "");
  const duplicateScopeItems = scopeItems.filter((item) =>
    nonGoalItems.some((other) => normalizeComparableItem(other) === normalizeComparableItem(item)),
  );
  for (const duplicate of duplicateScopeItems) {
    errors.push(`Scope and Non-Goals conflict on the same item: ${duplicate}.`);
  }

  const isAgreedOrActive = params.summary.status === "agreed" || params.summary.status === "active";
  if (isAgreedOrActive && params.summary.openQuestionCount > 0) {
    errors.push("Agreed or active blueprints must not keep unresolved Open Questions.");
  }
  if (isAgreedOrActive && params.summary.workstreamCandidateCount === 0) {
    errors.push("Agreed or active blueprints must include at least one workstream.");
  }

  const workstreams = extractMarkdownListItems(params.sectionBodies.Workstreams ?? "");
  const horizontalWorkstreams = workstreams.filter((item) => isLikelyHorizontalWorkstream(item));
  if (horizontalWorkstreams.length > 0) {
    warnings.push(
      `Horizontal-only workstreams detected: ${horizontalWorkstreams.join("; ")}. Rewrite them as thin vertical slices.`,
    );
  }

  return { errors, warnings };
}

async function enrichProjectBlueprintSummary(params: {
  summary: ProjectBlueprintSummary;
  sectionBodies: Partial<Record<string, string>>;
}): Promise<ProjectBlueprintSummary> {
  const validation = buildProjectBlueprintValidation({
    summary: params.summary,
    sectionBodies: params.sectionBodies,
  });
  const discussion = await readProjectBlueprintDiscussionArtifact(params.summary.repoRoot);
  return {
    ...params.summary,
    validationErrorCount: validation.errors.length,
    validationErrors: validation.errors,
    validationWarningCount: validation.warnings.length,
    validationWarnings: validation.warnings,
    clarificationHistoryCount: discussion.entryCount,
    lastClarificationAt: discussion.lastClarificationAt,
  };
}

export function resolveProjectBlueprintPath(repoRoot: string): string {
  return path.join(repoRoot, PROJECT_BLUEPRINT_FILENAME);
}

export function projectBlueprintStatusIds(): ProjectBlueprintStatus[] {
  return [...PROJECT_BLUEPRINT_STATUSES];
}

export function projectBlueprintRoleIds(): string[] {
  return ["planner", "coder", "reviewer", "verifier", "doc-writer"];
}

export function projectBlueprintSectionIds(): string[] {
  return [...PROJECT_BLUEPRINT_SECTION_IDS];
}

export function parseProjectBlueprintStatus(value: string): ProjectBlueprintStatus {
  if (!isProjectBlueprintStatus(value)) {
    throw new Error(`--status must be one of: ${PROJECT_BLUEPRINT_STATUSES.join(", ")}`);
  }
  return value;
}

export function parseProjectBlueprintRoleId(value: string): ProjectBlueprintRoleId {
  const roleId = normalizeProjectBlueprintRoleId(value);
  if (!roleId) {
    throw new Error(`--role must be one of: ${projectBlueprintRoleIds().join(", ")}`);
  }
  return roleId;
}

export function parseProjectBlueprintSectionName(value: string): ProjectBlueprintSectionName {
  const sectionName = normalizeProjectBlueprintSectionName(value);
  if (!sectionName) {
    throw new Error(`--section must be one of: ${projectBlueprintSectionIds().join(", ")}`);
  }
  return sectionName;
}

export async function readProjectBlueprint(repoRoot: string): Promise<ProjectBlueprintSummary> {
  const blueprintPath = resolveProjectBlueprintPath(repoRoot);
  try {
    const content = await readFile(blueprintPath, "utf8");
    return await enrichProjectBlueprintSummary({
      summary: parseProjectBlueprintContent({ repoRoot, blueprintPath, content }),
      sectionBodies: extractSectionBodies(content),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        repoRoot,
        blueprintPath,
        exists: false,
        schemaVersion: null,
        status: null,
        title: null,
        createdAt: null,
        updatedAt: null,
        agreedAt: null,
        statusChangedAt: null,
        revisionId: null,
        contentSha256: null,
        goalSummary: null,
        sectionCount: 0,
        sections: [],
        frontmatterKeys: [],
        requiredSectionsPresent: false,
        missingRequiredSections: [...PROJECT_BLUEPRINT_REQUIRED_SECTIONS],
        hasAgreementCheckpoint: false,
        defaultedSectionCount: 0,
        defaultedSections: [],
        workstreamCandidateCount: 0,
        openQuestionCount: 0,
        humanGateCount: 0,
        providerRoleAssignments: emptyProjectBlueprintRoleAssignments(),
        validationErrorCount: 0,
        validationErrors: [],
        validationWarningCount: 0,
        validationWarnings: [],
        clarificationHistoryCount: 0,
        lastClarificationAt: null,
      };
    }
    throw error;
  }
}

export async function createProjectBlueprint(
  options: CreateProjectBlueprintOptions,
): Promise<ProjectBlueprintSummary> {
  const repoRoot = path.resolve(options.repoRoot);
  const blueprintPath = resolveProjectBlueprintPath(repoRoot);
  const existing = await readProjectBlueprint(repoRoot);
  if (existing.exists && !options.force) {
    throw new Error(
      `Project blueprint already exists at ${blueprintPath}. Use --force to overwrite it.`,
    );
  }

  const now = options.now ?? new Date().toISOString();
  const title = options.title?.trim() || `${path.basename(repoRoot)} project blueprint`;
  const goal =
    options.goal?.trim() || "Describe the agreed project goal here before autonomous work begins.";
  const frontmatter: ProjectBlueprintFrontmatter = {
    schemaVersion: PROJECT_BLUEPRINT_SCHEMA_VERSION,
    title,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    statusChangedAt: now,
  };
  const content = `${renderFrontmatter(frontmatter)}\n${renderProjectBlueprintBody({
    title,
    goal,
    createdAt: now,
  })}`;
  await writeFile(blueprintPath, content, "utf8");
  return await readProjectBlueprint(repoRoot);
}

export async function updateProjectBlueprintStatus(
  options: UpdateProjectBlueprintStatusOptions,
): Promise<ProjectBlueprintSummary> {
  const repoRoot = path.resolve(options.repoRoot);
  const blueprintPath = resolveProjectBlueprintPath(repoRoot);
  let currentContent: string;
  try {
    currentContent = await readFile(blueprintPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Project blueprint does not exist at ${blueprintPath}. Run \`openclaw code blueprint-init\` first.`,
        { cause: error },
      );
    }
    throw error;
  }
  const current = parseProjectBlueprintContent({
    repoRoot,
    blueprintPath,
    content: currentContent,
  });
  const currentSectionBodies = extractSectionBodies(currentContent);
  const validation = buildProjectBlueprintValidation({
    summary: current,
    sectionBodies: currentSectionBodies,
  });
  if (options.status === "agreed" && validation.errors.length > 0) {
    throw new Error(
      `Cannot mark the blueprint as agreed until validation errors are resolved: ${validation.errors.join(" ")}`,
    );
  }
  const now = options.now ?? new Date().toISOString();
  const { body } = splitFrontmatter(currentContent);
  const frontmatter: ProjectBlueprintFrontmatter = {
    schemaVersion: current.schemaVersion ?? PROJECT_BLUEPRINT_SCHEMA_VERSION,
    title: current.title ?? `${path.basename(repoRoot)} project blueprint`,
    status: options.status,
    createdAt: current.createdAt ?? now,
    updatedAt: now,
    statusChangedAt: current.status === options.status ? (current.statusChangedAt ?? now) : now,
  };
  if (current.agreedAt) {
    frontmatter.agreedAt = current.agreedAt;
  }
  if (options.status === "agreed" && !frontmatter.agreedAt) {
    frontmatter.agreedAt = now;
  }

  await writeFile(blueprintPath, `${renderFrontmatter(frontmatter)}\n${body.trimStart()}`, "utf8");
  return await readProjectBlueprint(repoRoot);
}

function renderProjectBlueprintProviderStrategyBody(
  assignments: ProjectBlueprintRoleAssignments,
): string {
  return PROJECT_BLUEPRINT_ROLE_IDS.map((roleId) => {
    const label = PROJECT_BLUEPRINT_PROVIDER_ROLE_LABELS[roleId];
    const value = assignments[roleId];
    return `- ${label}:${value ? ` ${value}` : ""}`;
  }).join("\n");
}

function replaceProjectBlueprintSectionBody(params: {
  content: string;
  sectionName: string;
  sectionBody: string;
}): string {
  const normalized = params.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const headings = [...normalized.matchAll(/^##\s+(.+)$/gm)];
  const targetIndex = headings.findIndex((heading) => heading[1]?.trim() === params.sectionName);
  if (targetIndex < 0) {
    throw new Error(`Project blueprint is missing the required \`${params.sectionName}\` section.`);
  }
  const targetHeading = headings[targetIndex];
  const targetStart = targetHeading?.index;
  const headingText = targetHeading?.[0];
  if (targetStart == null || !headingText) {
    throw new Error(`Project blueprint is missing the required \`${params.sectionName}\` section.`);
  }
  const sectionStart = targetStart + headingText.length + 1;
  const sectionEnd = headings[targetIndex + 1]?.index ?? normalized.length;
  return `${normalized.slice(0, sectionStart)}${params.sectionBody.trimEnd()}\n\n${normalized.slice(sectionEnd).trimStart()}`;
}

function appendProjectBlueprintChangeLogEntry(params: { content: string; entry: string }): string {
  const normalized = params.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const existingSections = extractSectionNames(normalized);
  if (!existingSections.includes("Change Log")) {
    return `${normalized.trimEnd()}\n\n## Change Log\n- ${params.entry}\n`;
  }
  const currentBodies = extractSectionBodies(normalized);
  const currentBody = currentBodies["Change Log"]?.trim() ?? "";
  const nextBody = currentBody ? `${currentBody}\n- ${params.entry}` : `- ${params.entry}`;
  return replaceProjectBlueprintSectionBody({
    content: normalized,
    sectionName: "Change Log",
    sectionBody: nextBody,
  });
}

export async function updateProjectBlueprintProviderRole(
  options: UpdateProjectBlueprintProviderRoleOptions,
): Promise<ProjectBlueprintSummary> {
  const repoRoot = path.resolve(options.repoRoot);
  const blueprintPath = resolveProjectBlueprintPath(repoRoot);
  const currentContent = await readFile(blueprintPath, "utf8");
  const current = parseProjectBlueprintContent({
    repoRoot,
    blueprintPath,
    content: currentContent,
  });
  const now = options.now ?? new Date().toISOString();
  const assignments: ProjectBlueprintRoleAssignments = {
    ...current.providerRoleAssignments,
    [options.roleId]: options.provider?.trim() ? options.provider.trim() : null,
  };

  const updatedContent = replaceProjectBlueprintSectionBody({
    content: currentContent,
    sectionName: "Provider Strategy",
    sectionBody: renderProjectBlueprintProviderStrategyBody(assignments),
  });
  const { body } = splitFrontmatter(updatedContent);
  const frontmatter: ProjectBlueprintFrontmatter = {
    schemaVersion: current.schemaVersion ?? PROJECT_BLUEPRINT_SCHEMA_VERSION,
    title: current.title ?? `${path.basename(repoRoot)} project blueprint`,
    status: current.status ?? "draft",
    createdAt: current.createdAt ?? now,
    updatedAt: now,
    statusChangedAt: current.statusChangedAt ?? now,
  };
  if (current.agreedAt) {
    frontmatter.agreedAt = current.agreedAt;
  }

  await writeFile(blueprintPath, `${renderFrontmatter(frontmatter)}\n${body.trimStart()}`, "utf8");
  return await readProjectBlueprint(repoRoot);
}

export async function updateProjectBlueprintSection(
  options: UpdateProjectBlueprintSectionOptions,
): Promise<ProjectBlueprintDocument> {
  const repoRoot = path.resolve(options.repoRoot);
  const trimmedBody = options.body.trim();
  if (!trimmedBody) {
    throw new Error("--body must not be empty.");
  }

  let blueprint = await readProjectBlueprintDocument(repoRoot);
  if (!blueprint.exists) {
    if (!options.createIfMissing) {
      throw new Error(
        `Project blueprint does not exist at ${resolveProjectBlueprintPath(repoRoot)}. Run \`openclaw code blueprint-init\` first.`,
      );
    }
    await createProjectBlueprint({
      repoRoot,
      title: options.title,
      goal: options.sectionName === "Goal" ? trimmedBody : undefined,
    });
    blueprint = await readProjectBlueprintDocument(repoRoot);
  }

  if (!blueprint.content) {
    throw new Error("Project blueprint content could not be loaded.");
  }

  const now = options.now ?? new Date().toISOString();
  const currentBody = blueprint.sectionBodies[options.sectionName]?.trim() ?? "";
  const sectionBody =
    options.append && currentBody.length > 0 ? `${currentBody}\n${trimmedBody}` : trimmedBody;
  const updatedSectionContent = replaceProjectBlueprintSectionBody({
    content: blueprint.content,
    sectionName: options.sectionName,
    sectionBody,
  });
  const contentWithChangeLog = appendProjectBlueprintChangeLogEntry({
    content: updatedSectionContent,
    entry: `${now.slice(0, 10)}: updated \`${options.sectionName}\` via openclawcode blueprint workflow.`,
  });
  const current = parseProjectBlueprintContent({
    repoRoot,
    blueprintPath: blueprint.blueprintPath,
    content: contentWithChangeLog,
  });
  const { body } = splitFrontmatter(contentWithChangeLog);
  const frontmatter: ProjectBlueprintFrontmatter = {
    schemaVersion: current.schemaVersion ?? PROJECT_BLUEPRINT_SCHEMA_VERSION,
    title: current.title ?? `${path.basename(repoRoot)} project blueprint`,
    status: current.status ?? "draft",
    createdAt: current.createdAt ?? now,
    updatedAt: now,
    statusChangedAt: current.statusChangedAt ?? now,
  };
  if (current.agreedAt) {
    frontmatter.agreedAt = current.agreedAt;
  }

  await writeFile(
    current.blueprintPath,
    `${renderFrontmatter(frontmatter)}\n${body.trimStart()}`,
    "utf8",
  );
  return await readProjectBlueprintDocument(repoRoot);
}

export async function readProjectBlueprintDocument(
  repoRootInput: string,
): Promise<ProjectBlueprintDocument> {
  const repoRoot = path.resolve(repoRootInput);
  const summary = await readProjectBlueprint(repoRoot);
  if (!summary.exists) {
    return {
      ...summary,
      content: null,
      sectionBodies: {},
    };
  }

  const content = await readFile(summary.blueprintPath, "utf8");
  const sectionBodies = extractSectionBodies(content);
  const enriched = await enrichProjectBlueprintSummary({
    summary: parseProjectBlueprintContent({
      repoRoot,
      blueprintPath: summary.blueprintPath,
      content,
    }),
    sectionBodies,
  });
  return {
    ...enriched,
    content,
    sectionBodies,
  };
}

export async function inspectProjectBlueprintClarifications(
  repoRootInput: string,
): Promise<ProjectBlueprintClarificationReport> {
  const summary = await readProjectBlueprintDocument(repoRootInput);
  const questions: Array<{ priority: number; text: string }> = [];
  const questionSet = new Set<string>();
  const suggestions: Array<{ priority: number; text: string }> = [];
  const suggestionSet = new Set<string>();

  if (!summary.exists) {
    pushUniqueOrdered(
      questions,
      questionSet,
      "No project blueprint exists yet. Run `openclaw code blueprint-init` before trying to decompose work.",
      0,
    );
    const orderedQuestions = questions
      .toSorted(
        (left, right) => left.priority - right.priority || left.text.localeCompare(right.text),
      )
      .map((entry) => entry.text);
    const orderedSuggestions = suggestions
      .toSorted(
        (left, right) => left.priority - right.priority || left.text.localeCompare(right.text),
      )
      .map((entry) => entry.text);
    return {
      ...summary,
      priorityQuestion: orderedQuestions[0] ?? null,
      questions: orderedQuestions,
      suggestions: orderedSuggestions,
      questionCount: orderedQuestions.length,
      suggestionCount: orderedSuggestions.length,
    };
  }

  const openQuestions = extractMarkdownListItems(summary.sectionBodies["Open Questions"] ?? "");
  const workstreams = extractMarkdownListItems(summary.sectionBodies.Workstreams ?? "");
  const hasUserStory =
    sectionContainsPhrase(summary.sectionBodies, "Goal", /\bas a\b/i) ||
    sectionContainsPhrase(summary.sectionBodies, "Scope", /\bas a\b/i) ||
    sectionContainsPhrase(summary.sectionBodies, "Workstreams", /\bas a\b/i) ||
    workstreams.some((item) => /\b(user|operator|customer)\b/i.test(item));
  const hasProofOrTestSignal =
    sectionContainsPhrase(
      summary.sectionBodies,
      "Success Criteria",
      /\b(test|proof|verify|verified|demo|observable|repeat|reproduce|cli|chat)\b|`[^`]+`/i,
    ) || sectionContainsPhrase(summary.sectionBodies, "Constraints", /\btest|verify|proof\b/i);
  const hasBugFixWorkstream = workstreams.some((item) =>
    /\b(fix|bug|regression|broken|crash|error|failure)\b/i.test(item),
  );
  const hasRefactorWorkstream = workstreams.some((item) =>
    /\b(refactor|cleanup|clean up|rename|extract|restructure|reorganize|dedupe|simplify)\b/i.test(
      item,
    ),
  );
  const horizontalWorkstreams = workstreams.filter((item) => isLikelyHorizontalWorkstream(item));

  for (const section of summary.missingRequiredSections) {
    const priority =
      section === "Goal"
        ? 10
        : section === "Scope"
          ? 20
          : section === "Success Criteria"
            ? 30
            : section === "Workstreams"
              ? 40
              : 90;
    pushUniqueOrdered(
      questions,
      questionSet,
      `Fill the \`${section}\` section in PROJECT-BLUEPRINT.md before deriving work items.`,
      priority,
    );
  }

  for (const section of PROJECT_BLUEPRINT_REQUIRED_SECTIONS) {
    const body = summary.sectionBodies[section];
    if (!body) {
      continue;
    }
    if (!summary.defaultedSections.includes(section)) {
      continue;
    }
    switch (section) {
      case "Goal":
        pushUniqueOrdered(
          questions,
          questionSet,
          "Replace the default Goal placeholder with the actual project objective.",
          10,
        );
        break;
      case "Success Criteria":
        pushUniqueOrdered(
          questions,
          questionSet,
          "Replace the default Success Criteria bullets with concrete proof targets.",
          30,
        );
        break;
      case "Scope":
        pushUniqueOrdered(
          questions,
          questionSet,
          "List what is explicitly in scope and out of scope for this blueprint.",
          20,
        );
        break;
      case "Workstreams":
        pushUniqueOrdered(
          questions,
          questionSet,
          "Break the blueprint into initial workstreams before autonomous issue creation.",
          40,
        );
        break;
      case "Provider Strategy":
        pushUniqueOrdered(
          suggestions,
          suggestionSet,
          "Choose preferred providers or defaults for planner, coder, reviewer, verifier, and doc-writer roles.",
          110,
        );
        break;
      case "Human Gates":
        pushUniqueOrdered(
          suggestions,
          suggestionSet,
          "Decide which stages must pause for human approval versus continuing autonomously.",
          120,
        );
        break;
      default:
        pushUniqueOrdered(
          suggestions,
          suggestionSet,
          `Replace the default placeholder text in the \`${section}\` section.`,
          130,
        );
        break;
    }
  }

  if (summary.status === "draft") {
    pushUniqueOrdered(
      suggestions,
      suggestionSet,
      "Once the blueprint is clarified, record that checkpoint with `openclaw code blueprint-set-status --status clarified`.",
      200,
    );
  }
  if (!summary.hasAgreementCheckpoint) {
    pushUniqueOrdered(
      suggestions,
      suggestionSet,
      "When the team agrees on the target, record it with `openclaw code blueprint-set-status --status agreed`.",
      210,
    );
  }

  if (summary.openQuestionCount > 0) {
    pushUniqueOrdered(
      questions,
      questionSet,
      "Confirm the remaining `Open Questions` entries or replace them with `- None.` when settled.",
      45,
    );
  }

  const unresolvedProviderRoles = (
    Object.entries(summary.providerRoleAssignments) as Array<
      [ProjectBlueprintRoleId, string | null]
    >
  )
    .filter(([, assignment]) => !assignment || assignment.trim().length === 0)
    .map(([roleId]) => PROJECT_BLUEPRINT_PROVIDER_ROLE_LABELS[roleId]);
  if (unresolvedProviderRoles.length > 0) {
    pushUniqueOrdered(
      suggestions,
      suggestionSet,
      `Record explicit assignments for ${joinNaturalLanguageList(unresolvedProviderRoles)} under \`Provider Strategy\` when you want a fixed multi-agent plan.`,
      220,
    );
  }

  if (!hasUserStory) {
    pushUniqueOrdered(
      suggestions,
      suggestionSet,
      "Capture at least one user or operator story in `Scope` or `Workstreams` so the first slice has a concrete beneficiary.",
      300,
    );
  }

  if (!hasProofOrTestSignal) {
    pushUniqueOrdered(
      suggestions,
      suggestionSet,
      "Record the first proof in `Success Criteria` as a public behavior, CLI command, chat-visible demo, or repeatable verification step.",
      310,
    );
  }

  if (horizontalWorkstreams.length > 0) {
    pushUniqueOrdered(
      suggestions,
      suggestionSet,
      "Rewrite layer-only workstreams into thin vertical slices that can be demonstrated end-to-end.",
      320,
    );
  }

  if (hasBugFixWorkstream) {
    pushUniqueOrdered(
      suggestions,
      suggestionSet,
      "For bug-fix workstreams, record observed behavior, expected behavior, and reproduction clues before execution starts.",
      330,
    );
  }

  if (hasRefactorWorkstream) {
    pushUniqueOrdered(
      suggestions,
      suggestionSet,
      "For refactor workstreams, state the invariant behavior and the first safe checkpoint before code movement starts.",
      340,
    );
  }

  const orderedQuestions = questions
    .toSorted(
      (left, right) => left.priority - right.priority || left.text.localeCompare(right.text),
    )
    .map((entry) => entry.text);
  const orderedSuggestions = suggestions
    .toSorted(
      (left, right) => left.priority - right.priority || left.text.localeCompare(right.text),
    )
    .map((entry) => entry.text);

  return {
    ...summary,
    priorityQuestion: orderedQuestions[0] ?? openQuestions[0] ?? null,
    questions: orderedQuestions,
    suggestions: orderedSuggestions,
    questionCount: orderedQuestions.length,
    suggestionCount: orderedSuggestions.length,
  };
}
