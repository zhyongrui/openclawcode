const OPENCLAWCODE_TEXT_ALIASES: Record<string, string[]> = {
  "occode-intake": ["提需求"],
  "occode-start": ["开始", "开始开发"],
  "occode-start-override": ["强制开始"],
  "occode-rerun": ["重跑", "重新开发"],
  "occode-skip": ["跳过"],
  "occode-status": ["状态", "任务状态"],
  "occode-blueprint": ["蓝图"],
  "occode-routing": ["路由", "角色路由"],
  "occode-route-set": ["角色设置", "路由设置"],
  "occode-runtime-steering": ["运行时引导"],
  "occode-runtime-steering-set": ["设置运行时引导"],
  "occode-gates": ["阶段门", "关卡"],
  "occode-next": ["下一项", "下一步工作"],
  "occode-materialize": ["物化", "生成任务"],
  "occode-progress": ["进度", "项目进度"],
  "occode-autopilot": ["自动开发", "自动驾驶"],
  "occode-gate-decide": ["阶段门决策"],
  "occode-sync": ["同步"],
};

function parseLeadingSlashCommand(command: string): { name: string; args: string } | null {
  const trimmed = command.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const body = trimmed.slice(1);
  const firstSeparator = body.search(/[\s:]/u);
  const name = firstSeparator === -1 ? body : body.slice(0, firstSeparator);
  let remainder = firstSeparator === -1 ? "" : body.slice(firstSeparator).trimStart();
  if (remainder.startsWith(":")) {
    remainder = remainder.slice(1).trimStart();
  }
  if (!name) {
    return null;
  }

  return {
    name,
    args: remainder.trim(),
  };
}

export function getOpenClawCodeTextAliases(commandName: string): string[] {
  return OPENCLAWCODE_TEXT_ALIASES[commandName] ?? [];
}

export function resolveOpenClawCodeCanonicalCommandName(commandName: string): string | null {
  const normalized = commandName.trim().replace(/^\//, "").toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("occode-")) {
    return normalized;
  }
  if (normalized.startsWith("occ-")) {
    return `occode-${normalized.slice("occ-".length)}`;
  }

  for (const [canonicalName, aliases] of Object.entries(OPENCLAWCODE_TEXT_ALIASES)) {
    if (aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return canonicalName;
    }
  }

  return null;
}

export function buildLocalizedOpenClawCodeCommand(command: string): string | null {
  const parsed = parseLeadingSlashCommand(command);
  if (!parsed) {
    return null;
  }

  const canonicalName = resolveOpenClawCodeCanonicalCommandName(parsed.name);
  if (!canonicalName) {
    return null;
  }

  const primaryAlias = getOpenClawCodeTextAliases(canonicalName)[0];
  if (!primaryAlias) {
    return null;
  }

  return parsed.args ? `/${primaryAlias}: ${parsed.args}` : `/${primaryAlias}`;
}

export function formatOpenClawCodeCommandWithAliases(command: string | null): string | null {
  if (!command) {
    return null;
  }

  const parsed = parseLeadingSlashCommand(command);
  if (!parsed) {
    return command;
  }

  const canonicalName = resolveOpenClawCodeCanonicalCommandName(parsed.name);
  if (!canonicalName) {
    return command;
  }

  const aliases: string[] = [];
  if (canonicalName.startsWith("occode-")) {
    const shortAlias = `/occ-${canonicalName.slice("occode-".length)}${parsed.args ? ` ${parsed.args}` : ""}`;
    aliases.push(shortAlias);
  }
  const localized = buildLocalizedOpenClawCodeCommand(command);
  if (localized) {
    aliases.push(localized);
  }
  return aliases.length > 0 ? `${command} (alias ${aliases.join(" | ")})` : command;
}
