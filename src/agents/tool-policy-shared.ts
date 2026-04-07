import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import {
  CORE_TOOL_GROUPS,
  resolveCoreToolProfilePolicy,
  resolveCoreToolPresetPolicy,
  type ToolProfileId,
  type ToolPresetId,
} from "./tool-catalog.js";

type ToolProfilePolicy = {
  allow?: string[];
  deny?: string[];
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: "exec",
  "apply-patch": "apply_patch",
};

export const TOOL_GROUPS: Record<string, string[]> = { ...CORE_TOOL_GROUPS };

export function normalizeToolName(name: string) {
  const normalized = normalizeLowercaseStringOrEmpty(name);
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

export function normalizeToolList(list?: string[]) {
  if (!list) {
    return [];
  }
  return list.map(normalizeToolName).filter(Boolean);
}

export function normalizeToolPresetName(name: string) {
  return name.trim().toLowerCase();
}

export function normalizeToolPresetList(list?: string[]) {
  if (!list) {
    return [];
  }
  return Array.from(
    new Set(
      list
        .map((value) => normalizeToolPresetName(value))
        .filter((value) => value.length > 0),
    ),
  );
}

export function expandToolGroups(list?: string[]) {
  const normalized = normalizeToolList(list);
  const expanded: string[] = [];
  for (const value of normalized) {
    const group = TOOL_GROUPS[value];
    if (group) {
      expanded.push(...group);
      continue;
    }
    expanded.push(value);
  }
  return Array.from(new Set(expanded));
}

export function resolveToolProfilePolicy(profile?: string): ToolProfilePolicy | undefined {
  return resolveCoreToolProfilePolicy(profile);
}

export function resolveToolPresetPolicy(preset?: string): ToolProfilePolicy | undefined {
  return resolveCoreToolPresetPolicy(preset);
}

export function resolveToolPresetAlsoAllow(presets?: string[]): {
  presets: string[];
  alsoAllow?: string[];
} {
  const activePresets: string[] = [];
  const alsoAllow: string[] = [];

  for (const preset of normalizeToolPresetList(presets)) {
    const policy = resolveToolPresetPolicy(preset);
    if (!policy) {
      continue;
    }
    activePresets.push(preset);
    if (Array.isArray(policy.allow)) {
      alsoAllow.push(...policy.allow);
    }
  }

  return {
    presets: activePresets,
    alsoAllow: alsoAllow.length > 0 ? Array.from(new Set(alsoAllow)) : undefined,
  };
}

export type { ToolProfileId, ToolPresetId };
