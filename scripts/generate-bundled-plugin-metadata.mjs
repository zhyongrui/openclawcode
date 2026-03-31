#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { collectBundledPluginSources } from "./lib/bundled-plugin-source-utils.mjs";
import { formatGeneratedModule } from "./lib/format-generated-module.mjs";
import { writeGeneratedOutput } from "./lib/generated-output-utils.mjs";

const GENERATED_BY = "scripts/generate-bundled-plugin-metadata.mjs";
const DEFAULT_OUTPUT_PATH = "src/plugins/bundled-plugin-metadata.generated.ts";
const PUBLIC_SURFACE_SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs", ".cts", ".cjs"]);
const CHANNEL_CONFIG_MODULE_CANDIDATES = [
  path.join("src", "config-schema.ts"),
  path.join("src", "config-schema.js"),
  path.join("src", "config-schema.mts"),
  path.join("src", "config-schema.mjs"),
];
const jiti = createJiti(import.meta.url, { tryNative: false });
const { buildChannelConfigSchema } = jiti(path.resolve("src/channels/plugins/config-schema.ts"));

function rewriteBuiltPath(entry) {
  const normalized = entry.replace(/^\.\//u, "");
  return normalized.replace(/\.[^.]+$/u, ".js");
}

function normalizePathPair(entry) {
  if (typeof entry !== "string" || !entry.trim()) {
    return undefined;
  }
  const normalized = entry.trim();
  return {
    source: normalized,
    built: rewriteBuiltPath(normalized),
  };
}

function isTopLevelPublicSurfaceArtifact(fileName) {
  const ext = path.extname(fileName);
  if (!PUBLIC_SURFACE_SOURCE_EXTENSIONS.has(ext)) {
    return false;
  }
  if (fileName.startsWith("test-")) {
    return false;
  }
  if (
    fileName.includes(".test-") ||
    fileName.endsWith(".test.ts") ||
    fileName.endsWith(".test.js") ||
    fileName.endsWith(".spec.ts") ||
    fileName.endsWith(".spec.js") ||
    fileName.endsWith(".runtime.test.ts") ||
    fileName.endsWith(".runtime.test.js")
  ) {
    return false;
  }
  return true;
}

function resolvePackageChannelMeta(packageManifest, channelId) {
  const channel = packageManifest?.channel;
  if (!channel || channel.id !== channelId) {
    return undefined;
  }
  return {
    ...(typeof channel.label === "string" && channel.label.trim()
      ? { label: channel.label.trim() }
      : {}),
    ...(typeof channel.blurb === "string" && channel.blurb.trim()
      ? { description: channel.blurb.trim() }
      : {}),
    ...(Array.isArray(channel.preferOver) && channel.preferOver.length > 0
      ? { preferOver: [...channel.preferOver] }
      : {}),
  };
}

function collectPublicSurfaceArtifacts(pluginDir, primaryEntries) {
  const artifacts = fs
    .readdirSync(pluginDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isTopLevelPublicSurfaceArtifact)
    .map(rewriteBuiltPath)
    .filter((entry) => !primaryEntries.has(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .sort((left, right) => left.localeCompare(right));
  return artifacts.length > 0 ? artifacts : undefined;
}

function collectRuntimeSidecarArtifacts(publicSurfaceArtifacts) {
  const sidecars = (publicSurfaceArtifacts ?? []).filter(
    (artifact) =>
      artifact === "runtime-api.js" ||
      artifact.endsWith(".runtime.js") ||
      artifact.endsWith("-runtime.js"),
  );
  return sidecars.length > 0 ? sidecars : undefined;
}

function loadSyntheticChannelConfigs(pluginDir, manifest) {
  const fallback = () => {
    const channelIds = Array.isArray(manifest?.channels)
      ? manifest.channels.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
      : [];
    if (channelIds.length === 0 || !manifest.configSchema) {
      return undefined;
    }
    return Object.fromEntries(
      channelIds.map((channelId) => [
        channelId,
        {
          schema: manifest.configSchema,
        },
      ]),
    );
  };
  const modulePath = CHANNEL_CONFIG_MODULE_CANDIDATES.map((candidate) => path.join(pluginDir, candidate)).find(
    (candidate) => fs.existsSync(candidate),
  );
  if (!modulePath) {
    return fallback();
  }
  try {
    const mod = jiti(modulePath);
    const rawSchema = pickChannelSchemaExport(mod, manifest);
    const resolved = resolveChannelConfigExport(rawSchema);
    if (!resolved?.schema) {
      return fallback();
    }
    const channelIds = Array.isArray(manifest?.channels)
      ? manifest.channels.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
      : [];
    if (channelIds.length === 0) {
      return fallback();
    }
    return Object.fromEntries(
      channelIds.map((channelId) => [
        channelId,
        {
          schema: resolved.schema,
          ...(resolved.uiHints && Object.keys(resolved.uiHints).length > 0
            ? { uiHints: resolved.uiHints }
            : {}),
        },
      ]),
    );
  } catch {
    return fallback();
  }
}

function resolveChannelConfigExport(raw) {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  if ("schema" in raw && raw.schema && typeof raw.schema === "object") {
    return raw;
  }
  if (typeof raw.safeParse === "function") {
    const built = buildChannelConfigSchema(raw);
    return {
      schema: built.schema,
      ...(built.uiHints ? { uiHints: built.uiHints } : {}),
    };
  }
  return undefined;
}

function toPascalCase(value) {
  return String(value ?? "")
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function pickChannelSchemaExport(mod, manifest) {
  const entries = Object.entries(mod ?? {});
  const exportMap = new Map(entries);
  const ids = Array.isArray(manifest?.channels) && manifest.channels.length > 0
    ? manifest.channels
    : [manifest?.id].filter(Boolean);
  const preferredNames = ids.flatMap((id) => {
    const base = toPascalCase(id);
    return [`${base}ChannelConfigSchema`, `${base}ConfigSchema`];
  });
  for (const name of preferredNames) {
    if (exportMap.has(name)) {
      return exportMap.get(name);
    }
  }
  return entries.find(
    ([key, value]) =>
      /(?:Channel)?ConfigSchema$/u.test(key) &&
      value &&
      typeof value === "object" &&
      ("schema" in value || typeof value.safeParse === "function"),
  )?.[1] ?? entries.find(
    ([, value]) =>
      value &&
      typeof value === "object" &&
      ("schema" in value || typeof value.safeParse === "function"),
  )?.[1];
}

function mergeChannelConfigs(pluginDir, manifest, packageManifest) {
  const synthetic = loadSyntheticChannelConfigs(pluginDir, manifest);
  if (!synthetic) {
    return manifest;
  }
  const merged = {
    ...(manifest.channelConfigs ?? {}),
  };
  for (const [channelId, syntheticConfig] of Object.entries(synthetic)) {
    const existing = merged[channelId];
    const packageMeta = resolvePackageChannelMeta(packageManifest, channelId);
    merged[channelId] = existing
      ? {
        ...(packageMeta ?? {}),
        ...existing,
        schema: syntheticConfig.schema,
        ...(syntheticConfig.uiHints || existing.uiHints
          ? {
                uiHints: {
                  ...(syntheticConfig.uiHints ?? {}),
                  ...(existing.uiHints ?? {}),
                },
              }
            : {}),
        }
      : {
          ...syntheticConfig,
          ...(packageMeta ?? {}),
        };
  }
  return {
    ...manifest,
    channelConfigs: merged,
  };
}

export async function collectBundledPluginMetadata(params = {}) {
  const repoRoot = path.resolve(params.repoRoot ?? process.cwd());
  const sources = collectBundledPluginSources({ repoRoot, requirePackageJson: false });
  return sources
    .map((source) => {
      const packageManifest = source.packageJson?.openclaw;
      const primarySourceEntry =
        normalizePathPair(
          Array.isArray(packageManifest?.extensions)
            ? packageManifest.extensions.find((entry) => typeof entry === "string" && entry.trim())
            : undefined,
        ) ?? normalizePathPair("./index.ts");
      if (!primarySourceEntry) {
        return null;
      }
      const setupSource = normalizePathPair(packageManifest?.setupEntry);
      const primaryEntries = new Set([
        primarySourceEntry.built,
        ...(setupSource ? [setupSource.built] : []),
      ]);
      const publicSurfaceArtifacts = collectPublicSurfaceArtifacts(source.pluginDir, primaryEntries);
      const runtimeSidecarArtifacts = collectRuntimeSidecarArtifacts(publicSurfaceArtifacts);
      return {
        dirName: source.dirName,
        idHint: source.manifest.id,
        source: primarySourceEntry,
        ...(setupSource ? { setupSource } : {}),
        ...(publicSurfaceArtifacts ? { publicSurfaceArtifacts } : {}),
        ...(runtimeSidecarArtifacts ? { runtimeSidecarArtifacts } : {}),
        ...(source.packageJson?.name ? { packageName: source.packageJson.name } : {}),
        ...(source.packageJson?.version ? { packageVersion: source.packageJson.version } : {}),
        ...(source.packageJson?.description
          ? { packageDescription: source.packageJson.description }
          : {}),
        ...(packageManifest ? { packageManifest } : {}),
        manifest: mergeChannelConfigs(source.pluginDir, source.manifest, packageManifest),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.dirName.localeCompare(right.dirName));
}

export async function writeBundledPluginMetadataModule(params = {}) {
  const repoRoot = path.resolve(params.repoRoot ?? process.cwd());
  const outputPath = params.outputPath ?? DEFAULT_OUTPUT_PATH;
  const entries = await collectBundledPluginMetadata({ repoRoot });
  const raw = `// Auto-generated by ${GENERATED_BY}. Do not edit directly.

export const GENERATED_BUNDLED_PLUGIN_METADATA = ${JSON.stringify(entries, null, 2)} as const;
`;
  let next = raw;
  try {
    next = formatGeneratedModule(raw, {
      repoRoot,
      outputPath,
      errorLabel: "bundled plugin metadata",
    });
  } catch {
    next = raw;
  }
  return writeGeneratedOutput({
    repoRoot,
    outputPath,
    next,
    check: params.check,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const check = process.argv.includes("--check");
  const result = await writeBundledPluginMetadataModule({ check });
  if (!result.changed) {
    process.exitCode = 0;
  } else if (check) {
    console.error(
      `[bundled-plugin-metadata] stale generated output at ${path.relative(process.cwd(), result.outputPath)}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `[bundled-plugin-metadata] wrote ${path.relative(process.cwd(), result.outputPath)}`,
    );
  }
}
