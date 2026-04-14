import type { AnyAgentTool } from "./pi-tools.types.js";

export type RequiredParamGroup = {
  keys: readonly string[];
  allowEmpty?: boolean;
  label?: string;
  validator?: (record: Record<string, unknown>) => boolean;
};

const RETRY_GUIDANCE_SUFFIX = " Supply correct parameters before retrying.";

function parameterValidationError(message: string): Error {
  return new Error(`${message}.${RETRY_GUIDANCE_SUFFIX}`);
}

function describeReceivedParamValue(value: unknown, allowEmpty = false): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    if (allowEmpty || value.trim().length > 0) {
      return undefined;
    }
    return "<empty-string>";
  }
  if (Array.isArray(value)) {
    return "<array>";
  }
  return `<${typeof value}>`;
}

function formatReceivedParamHint(
  record: Record<string, unknown>,
  groups: readonly RequiredParamGroup[],
): string {
  const allowEmptyKeys = new Set(
    groups.filter((group) => group.allowEmpty).flatMap((group) => group.keys),
  );
  const received = Object.keys(record).flatMap((key) => {
    const detail = describeReceivedParamValue(record[key], allowEmptyKeys.has(key));
    if (record[key] === undefined || record[key] === null) {
      return [];
    }
    return [detail ? `${key}=${detail}` : key];
  });
  return received.length > 0 ? ` (received: ${received.join(", ")})` : "";
}

type EditReplacement = {
  oldText: string;
  newText: string;
};

const PATH_PARAM_ALIASES = ["file_path", "filePath", "filepath", "file"] as const;

function isValidEditReplacement(value: unknown): value is EditReplacement {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.oldText === "string" &&
    record.oldText.trim().length > 0 &&
    typeof record.newText === "string"
  );
}

function hasValidEditReplacements(record: Record<string, unknown>): boolean {
  const edits = record.edits;
  return (
    Array.isArray(edits) &&
    edits.length > 0 &&
    edits.every((entry) => isValidEditReplacement(entry))
  );
}

export const REQUIRED_PARAM_GROUPS = {
  read: [{ keys: ["path"], label: "path" }],
  write: [
    { keys: ["path"], label: "path" },
    { keys: ["content"], label: "content" },
  ],
  edit: [
    { keys: ["path"], label: "path" },
    { keys: ["edits"], label: "edits", validator: hasValidEditReplacements },
  ],
} as const;

function readFirstStringParam(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function normalizePathAliases(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (typeof record.path === "string" && record.path.trim().length > 0) {
    return undefined;
  }
  const aliasPath = readFirstStringParam(record, PATH_PARAM_ALIASES);
  if (!aliasPath) {
    return undefined;
  }
  return {
    ...record,
    path: aliasPath,
  };
}

function normalizeEditAliases(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  let normalized = normalizePathAliases(record);
  const working = normalized ?? record;
  if (hasValidEditReplacements(working)) {
    return normalized;
  }

  const oldText = readFirstStringParam(working, ["oldText", "old_string"]);
  const newTextCandidate = working.newText ?? working.new_string;
  if (!oldText || typeof newTextCandidate !== "string") {
    return normalized;
  }

  return {
    ...working,
    edits: [{ oldText, newText: newTextCandidate }],
  };
}

export function getToolParamsRecord(params: unknown): Record<string, unknown> | undefined {
  return params && typeof params === "object" ? (params as Record<string, unknown>) : undefined;
}

export function normalizeReadToolParams(params: unknown): unknown {
  const record = getToolParamsRecord(params);
  if (!record) {
    return params;
  }
  return normalizePathAliases(record) ?? params;
}

export function normalizeWriteToolParams(params: unknown): unknown {
  const record = getToolParamsRecord(params);
  if (!record) {
    return params;
  }
  return normalizePathAliases(record) ?? params;
}

export function normalizeEditToolParams(params: unknown): unknown {
  const record = getToolParamsRecord(params);
  if (!record) {
    return params;
  }
  return normalizeEditAliases(record) ?? params;
}

function normalizeToolParamsForValidation(
  params: unknown,
  groups: readonly RequiredParamGroup[] | undefined,
): unknown {
  if (groups === REQUIRED_PARAM_GROUPS.read) {
    return normalizeReadToolParams(params);
  }
  if (groups === REQUIRED_PARAM_GROUPS.write) {
    return normalizeWriteToolParams(params);
  }
  if (groups === REQUIRED_PARAM_GROUPS.edit) {
    return normalizeEditToolParams(params);
  }
  return params;
}

export function assertRequiredParams(
  record: Record<string, unknown> | undefined,
  groups: readonly RequiredParamGroup[],
  toolName: string,
): void {
  if (!record || typeof record !== "object") {
    throw parameterValidationError(`Missing parameters for ${toolName}`);
  }

  const missingLabels: string[] = [];
  for (const group of groups) {
    const satisfied =
      group.validator?.(record) ??
      group.keys.some((key) => {
        if (!(key in record)) {
          return false;
        }
        const value = record[key];
        if (typeof value !== "string") {
          return false;
        }
        if (group.allowEmpty) {
          return true;
        }
        return value.trim().length > 0;
      });

    if (!satisfied) {
      const label = group.label ?? group.keys.join(" or ");
      missingLabels.push(label);
    }
  }

  if (missingLabels.length > 0) {
    const joined = missingLabels.join(", ");
    const noun = missingLabels.length === 1 ? "parameter" : "parameters";
    const receivedHint = formatReceivedParamHint(record, groups);
    throw parameterValidationError(`Missing required ${noun}: ${joined}${receivedHint}`);
  }
}

export function wrapToolParamValidation(
  tool: AnyAgentTool,
  requiredParamGroups?: readonly RequiredParamGroup[],
): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalizedParams = normalizeToolParamsForValidation(params, requiredParamGroups);
      const record = getToolParamsRecord(normalizedParams);
      if (requiredParamGroups?.length) {
        assertRequiredParams(record, requiredParamGroups, tool.name);
      }
      return tool.execute(toolCallId, normalizedParams, signal, onUpdate);
    },
  };
}
