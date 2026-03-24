import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_BLUEPRINT_ROLE_IDS,
  readProjectBlueprintDocument,
  type ProjectBlueprintRoleId,
  type ProjectBlueprintRoleAssignments,
} from "./blueprint.js";
import type { WorkflowStage } from "./contracts/index.js";

export const PROJECT_ROLE_ROUTING_SCHEMA_VERSION = 1;
export const PROJECT_ROLE_ADAPTER_IDS = [
  "codex",
  "claude-code",
  "openclaw-default",
  "custom",
] as const;

export type ProjectRoleAdapterId = (typeof PROJECT_ROLE_ADAPTER_IDS)[number];

export interface ProjectRoleRoute {
  roleId: ProjectBlueprintRoleId;
  rawAssignment: string | null;
  adapterId: ProjectRoleAdapterId;
  source: "blueprint" | "env-role-default" | "openclaw-default";
  configured: boolean;
  fallbackChain: string[];
  runtimeCapable: boolean;
  rerouteCapable: boolean;
  resolvedBackend: string;
  resolvedAgentId: string | null;
  appliedSource: "blueprint" | "env-role-default" | "openclaw-default";
  stages: WorkflowStage[];
}

export interface ProjectStageRoute {
  stageId: WorkflowStage;
  roleId: ProjectBlueprintRoleId;
  adapterId: ProjectRoleAdapterId;
  resolvedAgentId: string | null;
  source: ProjectRoleRoute["source"];
  fallbackChain: string[];
}

export interface ProjectRoleRoutingPlan {
  repoRoot: string;
  artifactPath: string;
  exists: boolean;
  schemaVersion: number | null;
  generatedAt: string | null;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  fallbackChain: string[];
  fallbackConfigured: boolean;
  mixedMode: boolean;
  routeCount: number;
  stageRouteCount: number;
  unresolvedRoleCount: number;
  blockers: string[];
  suggestionCount: number;
  suggestions: string[];
  routes: ProjectRoleRoute[];
  stageRoutes: ProjectStageRoute[];
}

function resolveProjectRoleRoutingArtifactPath(repoRootInput: string): string {
  return path.join(path.resolve(repoRootInput), ".openclawcode", "role-routing.json");
}

function normalizeRoleAdapter(raw: string | null): ProjectRoleAdapterId {
  const normalized = raw?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return "openclaw-default";
  }
  if (normalized === "codex" || normalized === "openai-codex" || normalized === "openai codex") {
    return "codex";
  }
  if (normalized === "claude-code" || normalized === "claude code" || normalized === "claude") {
    return "claude-code";
  }
  return "custom";
}

function resolveRoleEnvVar(roleId: ProjectBlueprintRoleId): string {
  switch (roleId) {
    case "planner":
      return "OPENCLAWCODE_ROLE_PLANNER";
    case "coder":
      return "OPENCLAWCODE_ROLE_CODER";
    case "reviewer":
      return "OPENCLAWCODE_ROLE_REVIEWER";
    case "verifier":
      return "OPENCLAWCODE_ROLE_VERIFIER";
    case "docWriter":
      return "OPENCLAWCODE_ROLE_DOC_WRITER";
  }
}

function resolveRoleAgentEnvVar(roleId: ProjectBlueprintRoleId): string | null {
  switch (roleId) {
    case "coder":
      return "OPENCLAWCODE_ROLE_CODER_AGENT_ID";
    case "verifier":
      return "OPENCLAWCODE_ROLE_VERIFIER_AGENT_ID";
    default:
      return null;
  }
}

function resolveAdapterAgentEnvVar(adapterId: ProjectRoleAdapterId): string | null {
  switch (adapterId) {
    case "codex":
      return "OPENCLAWCODE_ADAPTER_CODEX_AGENT_ID";
    case "claude-code":
      return "OPENCLAWCODE_ADAPTER_CLAUDE_CODE_AGENT_ID";
    case "openclaw-default":
      return "OPENCLAWCODE_ADAPTER_OPENCLAW_DEFAULT_AGENT_ID";
    case "custom":
      return "OPENCLAWCODE_ADAPTER_CUSTOM_AGENT_ID";
    default:
      return null;
  }
}

function resolveRoleLabel(roleId: ProjectBlueprintRoleId): string {
  switch (roleId) {
    case "planner":
      return "planner";
    case "coder":
      return "coder";
    case "reviewer":
      return "reviewer";
    case "verifier":
      return "verifier";
    case "docWriter":
      return "doc-writer";
  }
}

function resolveFallbackChain(): string[] {
  return parseFallbackChain(process.env.OPENCLAWCODE_MODEL_FALLBACKS);
}

function parseFallbackChain(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveRoleFallbackEnvVar(roleId: ProjectBlueprintRoleId): string {
  switch (roleId) {
    case "planner":
      return "OPENCLAWCODE_ROLE_PLANNER_FALLBACKS";
    case "coder":
      return "OPENCLAWCODE_ROLE_CODER_FALLBACKS";
    case "reviewer":
      return "OPENCLAWCODE_ROLE_REVIEWER_FALLBACKS";
    case "verifier":
      return "OPENCLAWCODE_ROLE_VERIFIER_FALLBACKS";
    case "docWriter":
      return "OPENCLAWCODE_ROLE_DOC_WRITER_FALLBACKS";
  }
}

function mergeFallbackChains(primary: string[], secondary: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...primary, ...secondary]) {
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    merged.push(entry);
  }
  return merged;
}

function resolveRoleFallbackChain(
  roleId: ProjectBlueprintRoleId,
  globalFallbackChain: string[],
): string[] {
  return mergeFallbackChains(
    parseFallbackChain(process.env[resolveRoleFallbackEnvVar(roleId)]),
    globalFallbackChain,
  );
}

function resolveRoleStages(roleId: ProjectBlueprintRoleId): WorkflowStage[] {
  switch (roleId) {
    case "planner":
      return ["planning"];
    case "coder":
      return ["building"];
    case "reviewer":
      return ["draft-pr-opened", "changes-requested", "ready-for-human-review"];
    case "verifier":
      return ["verifying"];
    case "docWriter":
      return ["completed-without-changes", "merged"];
  }
}

function buildStageRoutes(routes: ProjectRoleRoute[]): ProjectStageRoute[] {
  return routes
    .flatMap((route) =>
      route.stages.map((stageId) => ({
        stageId,
        roleId: route.roleId,
        adapterId: route.adapterId,
        resolvedAgentId: route.resolvedAgentId,
        source: route.source,
        fallbackChain: route.fallbackChain,
      })),
    )
    .toSorted(
      (left, right) =>
        left.stageId.localeCompare(right.stageId) || left.roleId.localeCompare(right.roleId),
    );
}

function resolveFallbackConfigured(params: {
  globalFallbackChain: string[];
  routes: ProjectRoleRoute[];
}): boolean {
  if (params.globalFallbackChain.length > 0) {
    return true;
  }
  return params.routes.some((route) => route.fallbackChain.length > 0);
}

function resolveStageMixedMode(stageRoutes: ProjectStageRoute[]): boolean {
  return (
    new Set(
      stageRoutes
        .map((route) => route.adapterId)
        .filter((adapterId) => adapterId !== "openclaw-default"),
    ).size > 1
  );
}

function resolveFallbackSummarySuggestion(routes: ProjectRoleRoute[]): string {
  const rolesWithRoleSpecificFallbacks = routes
    .filter(
      (route) =>
        parseFallbackChain(process.env[resolveRoleFallbackEnvVar(route.roleId)]).length > 0,
    )
    .map((route) => resolveRoleLabel(route.roleId));
  if (rolesWithRoleSpecificFallbacks.length > 0) {
    return `Role-specific fallback chains are configured for ${rolesWithRoleSpecificFallbacks.join(", ")}. Recheck those providers in a live proof.`;
  }
  return "Consider setting role-specific fallback chains when coder and verifier should fail over differently.";
}

function resolveRouteAssignment(params: {
  roleId: ProjectBlueprintRoleId;
  blueprintAssignments: ProjectBlueprintRoleAssignments;
}): { rawAssignment: string | null; source: ProjectRoleRoute["source"] } {
  const fromBlueprint = params.blueprintAssignments[params.roleId];
  if (fromBlueprint && fromBlueprint.trim().length > 0) {
    return {
      rawAssignment: fromBlueprint.trim(),
      source: "blueprint",
    };
  }

  const roleEnvValue = process.env[resolveRoleEnvVar(params.roleId)]?.trim();
  if (roleEnvValue) {
    return {
      rawAssignment: roleEnvValue,
      source: "env-role-default",
    };
  }

  const defaultValue = process.env.OPENCLAWCODE_ROLE_DEFAULT?.trim() ?? null;
  return {
    rawAssignment: defaultValue && defaultValue.length > 0 ? defaultValue : null,
    source: defaultValue ? "env-role-default" : "openclaw-default",
  };
}

function emptyProjectRoleRoutingPlan(params: {
  repoRoot: string;
  artifactPath: string;
  blueprintExists: boolean;
  blueprintPath: string;
  blueprintRevisionId: string | null;
  fallbackChain: string[];
}): ProjectRoleRoutingPlan {
  return {
    repoRoot: params.repoRoot,
    artifactPath: params.artifactPath,
    exists: false,
    schemaVersion: null,
    generatedAt: null,
    blueprintExists: params.blueprintExists,
    blueprintPath: params.blueprintPath,
    blueprintRevisionId: params.blueprintRevisionId,
    fallbackChain: params.fallbackChain,
    fallbackConfigured: params.fallbackChain.length > 0,
    mixedMode: false,
    routeCount: 0,
    stageRouteCount: 0,
    unresolvedRoleCount: 0,
    blockers: [],
    suggestionCount: 0,
    suggestions: [],
    routes: [],
    stageRoutes: [],
  };
}

export async function deriveProjectRoleRoutingPlan(
  repoRootInput: string,
): Promise<ProjectRoleRoutingPlan> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectRoleRoutingArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const fallbackChain = resolveFallbackChain();

  if (!blueprint.exists) {
    return emptyProjectRoleRoutingPlan({
      repoRoot,
      artifactPath,
      blueprintExists: false,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: null,
      fallbackChain,
    });
  }

  const routes = PROJECT_BLUEPRINT_ROLE_IDS.map((roleId) => {
    const assignment = resolveRouteAssignment({
      roleId,
      blueprintAssignments: blueprint.providerRoleAssignments,
    });
    const adapterId = normalizeRoleAdapter(assignment.rawAssignment);
    const roleFallbackChain = resolveRoleFallbackChain(roleId, fallbackChain);
    const roleAgentEnvVar = resolveRoleAgentEnvVar(roleId);
    const adapterAgentEnvVar = resolveAdapterAgentEnvVar(adapterId);
    const resolvedAgentId =
      process.env[roleAgentEnvVar ?? ""]?.trim() ||
      process.env[adapterAgentEnvVar ?? ""]?.trim() ||
      null;
    return {
      roleId,
      rawAssignment: assignment.rawAssignment,
      adapterId,
      source: assignment.source,
      configured: assignment.rawAssignment != null && assignment.rawAssignment.length > 0,
      fallbackChain: roleFallbackChain,
      runtimeCapable: roleId === "coder" || roleId === "verifier",
      rerouteCapable: roleId === "coder" || roleId === "verifier",
      resolvedBackend: assignment.rawAssignment?.trim() || adapterId,
      resolvedAgentId,
      appliedSource: assignment.source,
      stages: resolveRoleStages(roleId),
    };
  });
  const stageRoutes = buildStageRoutes(routes);

  const unresolvedRoles = routes.filter((route) => !route.configured);
  const adapterSet = new Set(
    routes
      .filter((route) => route.configured)
      .map((route) => route.adapterId)
      .filter((adapter) => adapter !== "openclaw-default"),
  );
  const blockers =
    unresolvedRoles.length > 0
      ? [
          `Assign providers for the unresolved roles: ${unresolvedRoles
            .map((route) => resolveRoleLabel(route.roleId))
            .join(", ")}.`,
        ]
      : [];
  const suggestions = [
    resolveFallbackConfigured({
      globalFallbackChain: fallbackChain,
      routes,
    })
      ? resolveFallbackSummarySuggestion(routes)
      : "Consider setting `OPENCLAWCODE_MODEL_FALLBACKS` once a second model is available for proofs.",
    resolveStageMixedMode(stageRoutes)
      ? "Mixed-mode routing is active; verify each role/provider pairing in a real proof."
      : "If you want planner/coder separation, assign at least one role to Codex and another to Claude Code.",
  ];

  return {
    repoRoot,
    artifactPath,
    exists: false,
    schemaVersion: PROJECT_ROLE_ROUTING_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    blueprintExists: true,
    blueprintPath: blueprint.blueprintPath,
    blueprintRevisionId: blueprint.revisionId,
    fallbackChain,
    fallbackConfigured: resolveFallbackConfigured({
      globalFallbackChain: fallbackChain,
      routes,
    }),
    mixedMode: adapterSet.size > 1,
    routeCount: routes.length,
    stageRouteCount: stageRoutes.length,
    unresolvedRoleCount: unresolvedRoles.length,
    blockers,
    suggestionCount: suggestions.length,
    suggestions,
    routes,
    stageRoutes,
  };
}

export async function writeProjectRoleRoutingPlan(
  repoRootInput: string,
): Promise<ProjectRoleRoutingPlan> {
  const plan = await deriveProjectRoleRoutingPlan(repoRootInput);
  await mkdir(path.dirname(plan.artifactPath), { recursive: true });
  const persisted = {
    ...plan,
    exists: true,
  };
  await writeFile(plan.artifactPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export async function readProjectRoleRoutingPlan(
  repoRootInput: string,
): Promise<ProjectRoleRoutingPlan> {
  const repoRoot = path.resolve(repoRootInput);
  const artifactPath = resolveProjectRoleRoutingArtifactPath(repoRoot);
  const blueprint = await readProjectBlueprintDocument(repoRoot);
  const fallbackChain = resolveFallbackChain();

  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as ProjectRoleRoutingPlan;
    return {
      ...parsed,
      repoRoot,
      artifactPath,
      blueprintExists: blueprint.exists,
      blueprintPath: blueprint.blueprintPath,
      blueprintRevisionId: blueprint.revisionId,
      fallbackChain,
      fallbackConfigured: fallbackChain.length > 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyProjectRoleRoutingPlan({
        repoRoot,
        artifactPath,
        blueprintExists: blueprint.exists,
        blueprintPath: blueprint.blueprintPath,
        blueprintRevisionId: blueprint.revisionId,
        fallbackChain,
      });
    }
    throw error;
  }
}
