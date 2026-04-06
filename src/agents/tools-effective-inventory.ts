import type { OpenClawConfig } from "../config/config.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { resolveAgentDir, resolveAgentWorkspaceDir, resolveSessionAgentId } from "./agent-scope.js";
import { getChannelAgentToolMeta } from "./channel-tools.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import { createOpenClawCodingTools } from "./pi-tools.js";
import { resolveEffectiveToolPolicy } from "./pi-tools.policy.js";
import { summarizeToolDescriptionText } from "./tool-description-summary.js";
import { resolveToolDisplay } from "./tool-display.js";
import type { AnyAgentTool } from "./tools/common.js";

export type EffectiveToolSource = "core" | "plugin" | "channel";

export type EffectiveToolInventoryEntry = {
  id: string;
  label: string;
  description: string;
  rawDescription: string;
  source: EffectiveToolSource;
  pluginId?: string;
  channelId?: string;
};

export type EffectiveToolInventoryGroup = {
  id: EffectiveToolSource;
  label: string;
  source: EffectiveToolSource;
  tools: EffectiveToolInventoryEntry[];
};

export type EffectiveToolInventoryResult = {
  agentId: string;
  profile: string;
  groups: EffectiveToolInventoryGroup[];
  assembly: EffectiveToolAssembly;
};

export type EffectiveToolAssemblyCounts = {
  total: number;
  core: number;
  plugin: number;
  channel: number;
};

export type EffectiveToolAssemblyContext = {
  messageProvider?: string;
  modelProvider?: string;
  modelId?: string;
  replyToMode?: "off" | "first" | "all";
  senderIsOwner: boolean;
};

export type EffectiveToolAssemblyFlags = {
  allowGatewaySubagentBinding: boolean;
  requireExplicitMessageTarget: boolean;
  disableMessageTool: boolean;
};

export type EffectiveToolAvailabilityNote = {
  id: string;
  severity: "info" | "warn";
  message: string;
};

export type EffectiveToolAssembly = {
  counts: EffectiveToolAssemblyCounts;
  context: EffectiveToolAssemblyContext;
  flags: EffectiveToolAssemblyFlags;
  notes: EffectiveToolAvailabilityNote[];
};

export type EffectiveToolSurfaceResult = EffectiveToolInventoryResult & {
  workspaceDir: string;
  agentDir: string;
  tools: AnyAgentTool[];
};

export type EffectiveToolInventoryCompareValue = string | boolean | null;

export type EffectiveToolInventoryAssemblyChange = {
  field: string;
  from: EffectiveToolInventoryCompareValue;
  to: EffectiveToolInventoryCompareValue;
};

export type EffectiveToolInventoryNoteChanges = {
  added: EffectiveToolAvailabilityNote[];
  removed: EffectiveToolAvailabilityNote[];
};

export type EffectiveToolInventoryDiffResult = {
  sharedCount: number;
  added: EffectiveToolInventoryEntry[];
  removed: EffectiveToolInventoryEntry[];
  addedCounts: EffectiveToolAssemblyCounts;
  removedCounts: EffectiveToolAssemblyCounts;
  profileChanged: boolean;
  contextChanges: EffectiveToolInventoryAssemblyChange[];
  flagChanges: EffectiveToolInventoryAssemblyChange[];
  noteChanges: EffectiveToolInventoryNoteChanges;
};

export type ResolveEffectiveToolInventoryParams = {
  cfg: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  agentDir?: string;
  messageProvider?: string;
  senderIsOwner?: boolean;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  accountId?: string | null;
  modelProvider?: string;
  modelId?: string;
  currentChannelId?: string;
  currentThreadTs?: string;
  currentMessageId?: string | number;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  replyToMode?: "off" | "first" | "all";
  modelHasVision?: boolean;
  requireExplicitMessageTarget?: boolean;
  disableMessageTool?: boolean;
  allowGatewaySubagentBinding?: boolean;
};

function resolveEffectiveToolLabel(tool: AnyAgentTool): string {
  const rawLabel = typeof tool.label === "string" ? tool.label.trim() : "";
  if (rawLabel && rawLabel.toLowerCase() !== tool.name.toLowerCase()) {
    return rawLabel;
  }
  return resolveToolDisplay({ name: tool.name }).title;
}

function resolveRawToolDescription(tool: AnyAgentTool): string {
  return typeof tool.description === "string" ? tool.description.trim() : "";
}

function summarizeToolDescription(tool: AnyAgentTool): string {
  return summarizeToolDescriptionText({
    rawDescription: resolveRawToolDescription(tool),
    displaySummary: tool.displaySummary,
  });
}

function resolveEffectiveToolSource(tool: AnyAgentTool): {
  source: EffectiveToolSource;
  pluginId?: string;
  channelId?: string;
} {
  const pluginMeta = getPluginToolMeta(tool);
  if (pluginMeta) {
    return { source: "plugin", pluginId: pluginMeta.pluginId };
  }
  const channelMeta = getChannelAgentToolMeta(tool as never);
  if (channelMeta) {
    return { source: "channel", channelId: channelMeta.channelId };
  }
  return { source: "core" };
}

function groupLabel(source: EffectiveToolSource): string {
  switch (source) {
    case "plugin":
      return "Connected tools";
    case "channel":
      return "Channel tools";
    default:
      return "Built-in tools";
  }
}

function disambiguateLabels(entries: EffectiveToolInventoryEntry[]): EffectiveToolInventoryEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
  }
  return entries.map((entry) => {
    if ((counts.get(entry.label) ?? 0) < 2) {
      return entry;
    }
    const suffix = entry.pluginId ?? entry.channelId ?? entry.id;
    return { ...entry, label: `${entry.label} (${suffix})` };
  });
}

function buildEffectiveToolInventoryGroups(
  effectiveTools: AnyAgentTool[],
): EffectiveToolInventoryGroup[] {
  const entries = disambiguateLabels(
    effectiveTools
      .map((tool) => {
        const source = resolveEffectiveToolSource(tool);
        return {
          id: tool.name,
          label: resolveEffectiveToolLabel(tool),
          description: summarizeToolDescription(tool),
          rawDescription: resolveRawToolDescription(tool) || summarizeToolDescription(tool),
          ...source,
        } satisfies EffectiveToolInventoryEntry;
      })
      .toSorted((a, b) => a.label.localeCompare(b.label)),
  );
  const groupsBySource = new Map<EffectiveToolSource, EffectiveToolInventoryEntry[]>();
  for (const entry of entries) {
    const tools = groupsBySource.get(entry.source) ?? [];
    tools.push(entry);
    groupsBySource.set(entry.source, tools);
  }

  return (["core", "plugin", "channel"] as const)
    .map((source) => {
      const tools = groupsBySource.get(source);
      if (!tools || tools.length === 0) {
        return null;
      }
      return {
        id: source,
        label: groupLabel(source),
        source,
        tools,
      } satisfies EffectiveToolInventoryGroup;
    })
    .filter((group): group is EffectiveToolInventoryGroup => group !== null);
}

function compareToolInventoryEntryLabel(
  a: EffectiveToolInventoryEntry,
  b: EffectiveToolInventoryEntry,
): number {
  return (
    a.label.localeCompare(b.label) ||
    a.id.localeCompare(b.id) ||
    (a.pluginId ?? "").localeCompare(b.pluginId ?? "") ||
    (a.channelId ?? "").localeCompare(b.channelId ?? "")
  );
}

function effectiveToolEntryKey(entry: EffectiveToolInventoryEntry): string {
  return [entry.source, entry.id, entry.pluginId ?? "", entry.channelId ?? ""].join(":");
}

function flattenEffectiveToolEntries(result: EffectiveToolInventoryResult): EffectiveToolInventoryEntry[] {
  return result.groups.flatMap((group) => group.tools);
}

function toToolAssemblyCounts(entries: EffectiveToolInventoryEntry[]): EffectiveToolAssemblyCounts {
  const counts: EffectiveToolAssemblyCounts = {
    total: entries.length,
    core: 0,
    plugin: 0,
    channel: 0,
  };
  for (const entry of entries) {
    counts[entry.source] += 1;
  }
  return counts;
}

function compareInventoryPrimitiveValue(a: EffectiveToolInventoryCompareValue, b: EffectiveToolInventoryCompareValue) {
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function collectAssemblyChanges(
  params: Record<string, EffectiveToolInventoryCompareValue>,
  target: Record<string, EffectiveToolInventoryCompareValue>,
): EffectiveToolInventoryAssemblyChange[] {
  const fields = Array.from(new Set([...Object.keys(params), ...Object.keys(target)])).toSorted();
  return fields
    .flatMap((field) => {
      const from = params[field] ?? null;
      const to = target[field] ?? null;
      if (from === to) {
        return [];
      }
      return [{ field, from, to }];
    })
    .toSorted(
      (a, b) =>
        a.field.localeCompare(b.field) ||
        compareInventoryPrimitiveValue(a.from, b.from) ||
        compareInventoryPrimitiveValue(a.to, b.to),
    );
}

function compareToolAvailabilityNote(
  a: EffectiveToolAvailabilityNote,
  b: EffectiveToolAvailabilityNote,
): number {
  return a.id.localeCompare(b.id) || a.message.localeCompare(b.message);
}

function buildEffectiveToolAssembly(params: {
  profile: string;
  groups: EffectiveToolInventoryGroup[];
  messageProvider?: string;
  modelProvider?: string;
  modelId?: string;
  replyToMode?: "off" | "first" | "all";
  senderIsOwner?: boolean;
  requireExplicitMessageTarget?: boolean;
  disableMessageTool?: boolean;
  allowGatewaySubagentBinding?: boolean;
}): EffectiveToolAssembly {
  const counts: EffectiveToolAssemblyCounts = {
    total: 0,
    core: 0,
    plugin: 0,
    channel: 0,
  };
  for (const group of params.groups) {
    counts[group.source] += group.tools.length;
    counts.total += group.tools.length;
  }
  const notes: EffectiveToolAvailabilityNote[] = [];
  if (params.profile !== "full") {
    notes.push({
      id: "profile-gated",
      severity: "info",
      message: `Tool profile "${params.profile}" may hide capabilities that are available in fuller profiles.`,
    });
  }
  if (params.senderIsOwner !== true) {
    notes.push({
      id: "owner-only-hidden",
      severity: "info",
      message: "Owner-only tools are hidden because the current caller is not an owner.",
    });
  }
  if (params.requireExplicitMessageTarget === true) {
    notes.push({
      id: "message-target-required",
      severity: "info",
      message: "Message-send tools require an explicit target in this runtime; implicit last-route sends are disabled.",
    });
  }
  if (params.disableMessageTool === true) {
    notes.push({
      id: "message-tool-disabled",
      severity: "warn",
      message: "The message tool is disabled for this runtime, so direct outbound sends are unavailable.",
    });
  }
  if (params.allowGatewaySubagentBinding === false) {
    notes.push({
      id: "gateway-subagent-binding-disabled",
      severity: "info",
      message: "Gateway subagent binding is disabled for this runtime, so subagent handoff helpers are restricted.",
    });
  }

  return {
    counts,
    context: {
      ...(params.messageProvider?.trim() ? { messageProvider: params.messageProvider.trim() } : {}),
      ...(params.modelProvider?.trim() ? { modelProvider: params.modelProvider.trim() } : {}),
      ...(params.modelId?.trim() ? { modelId: params.modelId.trim() } : {}),
      ...(params.replyToMode ? { replyToMode: params.replyToMode } : {}),
      senderIsOwner: params.senderIsOwner === true,
    },
    flags: {
      allowGatewaySubagentBinding: params.allowGatewaySubagentBinding !== false,
      requireExplicitMessageTarget: params.requireExplicitMessageTarget === true,
      disableMessageTool: params.disableMessageTool === true,
    },
    notes,
  };
}

function resolveEffectiveModelCompat(params: {
  cfg: OpenClawConfig;
  agentDir: string;
  modelProvider?: string;
  modelId?: string;
}) {
  const provider = params.modelProvider?.trim();
  const modelId = params.modelId?.trim();
  if (!provider || !modelId) {
    return undefined;
  }
  try {
    return resolveModel(provider, modelId, params.agentDir, params.cfg).model?.compat;
  } catch {
    return undefined;
  }
}

export function resolveEffectiveToolSurface(
  params: ResolveEffectiveToolInventoryParams,
): EffectiveToolSurfaceResult {
  const agentId =
    params.agentId?.trim() ||
    resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg });
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
  const agentDir = params.agentDir ?? resolveAgentDir(params.cfg, agentId);
  const modelCompat = resolveEffectiveModelCompat({
    cfg: params.cfg,
    agentDir,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
  });

  const effectiveTools = createOpenClawCodingTools({
    agentId,
    sessionKey: params.sessionKey,
    workspaceDir,
    agentDir,
    config: params.cfg,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    modelCompat,
    messageProvider: params.messageProvider,
    senderIsOwner: params.senderIsOwner,
    senderId: params.senderId,
    senderName: params.senderName ?? undefined,
    senderUsername: params.senderUsername ?? undefined,
    senderE164: params.senderE164 ?? undefined,
    agentAccountId: params.accountId ?? undefined,
    currentChannelId: params.currentChannelId,
    currentThreadTs: params.currentThreadTs,
    currentMessageId: params.currentMessageId,
    groupId: params.groupId ?? undefined,
    groupChannel: params.groupChannel ?? undefined,
    groupSpace: params.groupSpace ?? undefined,
    replyToMode: params.replyToMode,
    allowGatewaySubagentBinding: params.allowGatewaySubagentBinding !== false,
    modelHasVision: params.modelHasVision,
    requireExplicitMessageTarget: params.requireExplicitMessageTarget,
    disableMessageTool: params.disableMessageTool,
  });
  const effectivePolicy = resolveEffectiveToolPolicy({
    config: params.cfg,
    agentId,
    sessionKey: params.sessionKey,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
  });
  const profile = effectivePolicy.providerProfile ?? effectivePolicy.profile ?? "full";
  const groups = buildEffectiveToolInventoryGroups(effectiveTools);
  const assembly = buildEffectiveToolAssembly({
    profile,
    groups,
    messageProvider: params.messageProvider,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    replyToMode: params.replyToMode,
    senderIsOwner: params.senderIsOwner,
    requireExplicitMessageTarget: params.requireExplicitMessageTarget,
    disableMessageTool: params.disableMessageTool,
    allowGatewaySubagentBinding: params.allowGatewaySubagentBinding,
  });

  return { agentId, workspaceDir, agentDir, tools: effectiveTools, profile, groups, assembly };
}

export function resolveEffectiveToolInventory(
  params: ResolveEffectiveToolInventoryParams,
): EffectiveToolInventoryResult {
  const surface = resolveEffectiveToolSurface(params);
  return {
    agentId: surface.agentId,
    profile: surface.profile,
    groups: surface.groups,
    assembly: surface.assembly,
  };
}

export function resolveEffectiveToolInventoryDiff(params: {
  base: EffectiveToolInventoryResult;
  target: EffectiveToolInventoryResult;
}): EffectiveToolInventoryDiffResult {
  const baseEntries = flattenEffectiveToolEntries(params.base);
  const targetEntries = flattenEffectiveToolEntries(params.target);
  const baseByKey = new Map(baseEntries.map((entry) => [effectiveToolEntryKey(entry), entry]));
  const targetByKey = new Map(targetEntries.map((entry) => [effectiveToolEntryKey(entry), entry]));
  const sharedKeys = Array.from(baseByKey.keys()).filter((key) => targetByKey.has(key));
  const added = targetEntries
    .filter((entry) => !baseByKey.has(effectiveToolEntryKey(entry)))
    .toSorted(compareToolInventoryEntryLabel);
  const removed = baseEntries
    .filter((entry) => !targetByKey.has(effectiveToolEntryKey(entry)))
    .toSorted(compareToolInventoryEntryLabel);
  const baseNotes = params.base.assembly.notes;
  const targetNotes = params.target.assembly.notes;
  const baseNoteKeys = new Set(baseNotes.map((note) => `${note.id}:${note.message}`));
  const targetNoteKeys = new Set(targetNotes.map((note) => `${note.id}:${note.message}`));
  return {
    sharedCount: sharedKeys.length,
    added,
    removed,
    addedCounts: toToolAssemblyCounts(added),
    removedCounts: toToolAssemblyCounts(removed),
    profileChanged: params.base.profile !== params.target.profile,
    contextChanges: collectAssemblyChanges(
      {
        messageProvider: params.base.assembly.context.messageProvider ?? null,
        modelProvider: params.base.assembly.context.modelProvider ?? null,
        modelId: params.base.assembly.context.modelId ?? null,
        replyToMode: params.base.assembly.context.replyToMode ?? null,
        senderIsOwner: params.base.assembly.context.senderIsOwner,
      },
      {
        messageProvider: params.target.assembly.context.messageProvider ?? null,
        modelProvider: params.target.assembly.context.modelProvider ?? null,
        modelId: params.target.assembly.context.modelId ?? null,
        replyToMode: params.target.assembly.context.replyToMode ?? null,
        senderIsOwner: params.target.assembly.context.senderIsOwner,
      },
    ),
    flagChanges: collectAssemblyChanges(
      {
        allowGatewaySubagentBinding: params.base.assembly.flags.allowGatewaySubagentBinding,
        requireExplicitMessageTarget: params.base.assembly.flags.requireExplicitMessageTarget,
        disableMessageTool: params.base.assembly.flags.disableMessageTool,
      },
      {
        allowGatewaySubagentBinding: params.target.assembly.flags.allowGatewaySubagentBinding,
        requireExplicitMessageTarget: params.target.assembly.flags.requireExplicitMessageTarget,
        disableMessageTool: params.target.assembly.flags.disableMessageTool,
      },
    ),
    noteChanges: {
      added: targetNotes
        .filter((note) => !baseNoteKeys.has(`${note.id}:${note.message}`))
        .toSorted(compareToolAvailabilityNote),
      removed: baseNotes
        .filter((note) => !targetNoteKeys.has(`${note.id}:${note.message}`))
        .toSorted(compareToolAvailabilityNote),
    },
  };
}
