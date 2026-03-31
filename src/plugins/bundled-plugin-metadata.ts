import fs from "node:fs";
import path from "node:path";
import { GENERATED_BUNDLED_PLUGIN_METADATA } from "./bundled-plugin-metadata.generated.js";
import { createJiti } from "jiti";
import { buildChannelConfigSchema } from "../channels/plugins/config-schema.js";
import type {
  PluginManifest,
  OpenClawPackageManifest,
  PluginManifestChannelConfig,
} from "./manifest.js";
import type { PluginConfigUiHint } from "./types.js";

type GeneratedBundledPluginPathPair = {
  source: string;
  built: string;
};

export type GeneratedBundledPluginResolvedPath = {
  path: string;
  rootDir: string;
};

export type GeneratedBundledPluginMetadata = {
  dirName: string;
  idHint: string;
  source: GeneratedBundledPluginPathPair;
  setupSource?: GeneratedBundledPluginPathPair;
  publicSurfaceArtifacts?: readonly string[];
  runtimeSidecarArtifacts?: readonly string[];
  packageName?: string;
  packageVersion?: string;
  packageDescription?: string;
  packageManifest?: OpenClawPackageManifest;
  manifest: PluginManifest;
};

export type BundledPluginMetadata = GeneratedBundledPluginMetadata;

const DEFAULT_ROOT_DIR = path.resolve(import.meta.dirname, "../..");
const PUBLIC_SURFACE_SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs", ".cts", ".cjs"]);
const CHANNEL_CONFIG_MODULE_CANDIDATES = [
  path.join("src", "config-schema.ts"),
  path.join("src", "config-schema.js"),
  path.join("src", "config-schema.mts"),
  path.join("src", "config-schema.mjs"),
] as const;

type PackageJsonShape = {
  name?: string;
  version?: string;
  description?: string;
  openclaw?: OpenClawPackageManifest;
};

type ListBundledPluginMetadataOptions = {
  rootDir?: string;
  includeChannelConfigs?: boolean;
  includeSyntheticChannelConfigs?: boolean;
};

const metadataCache = new Map<string, readonly GeneratedBundledPluginMetadata[]>();
const jiti = createJiti(import.meta.url, { tryNative: false });

type ChannelConfigExport =
  | {
      schema: Record<string, unknown>;
      uiHints?: Record<string, PluginConfigUiHint>;
    }
  | undefined;

function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function rewriteBuiltPath(entry: string): string {
  const normalized = entry.replace(/^\.\//u, "");
  return normalized.replace(/\.[^.]+$/u, ".js");
}

function normalizePathPair(entry: string | undefined): GeneratedBundledPluginPathPair | undefined {
  if (typeof entry !== "string" || !entry.trim()) {
    return undefined;
  }
  const normalized = entry.trim();
  return {
    source: normalized,
    built: rewriteBuiltPath(normalized),
  };
}

function isTopLevelPublicSurfaceArtifact(fileName: string): boolean {
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

function resolvePackageChannelMeta(
  packageManifest: OpenClawPackageManifest | undefined,
  channelId: string,
): { label?: string; description?: string; preferOver?: string[] } | undefined {
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

function collectPublicSurfaceArtifacts(
  pluginDir: string,
  primaryEntries: Set<string>,
): readonly string[] | undefined {
  const artifacts = fs
    .readdirSync(pluginDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isTopLevelPublicSurfaceArtifact)
    .map(rewriteBuiltPath)
    .filter((entry) => !primaryEntries.has(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .toSorted((left, right) => left.localeCompare(right));
  return artifacts.length > 0 ? artifacts : undefined;
}

function collectRuntimeSidecarArtifacts(
  publicSurfaceArtifacts: readonly string[] | undefined,
): readonly string[] | undefined {
  const sidecars = (publicSurfaceArtifacts ?? []).filter(
    (artifact) =>
      artifact === "runtime-api.js" ||
      artifact.endsWith(".runtime.js") ||
      artifact.endsWith("-runtime.js"),
  );
  return sidecars.length > 0 ? sidecars : undefined;
}

function loadSyntheticChannelConfigs(
  pluginDir: string,
  manifest: PluginManifest,
): Record<string, PluginManifestChannelConfig> | undefined {
  const fallback = () => {
    const channelIds = Array.isArray(manifest?.channels)
      ? manifest.channels.filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
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
  const modulePath = CHANNEL_CONFIG_MODULE_CANDIDATES.map((candidate) =>
    path.join(pluginDir, candidate),
  ).find((candidate) => fs.existsSync(candidate));
  if (!modulePath) {
    return fallback();
  }
  try {
    const mod = jiti(modulePath) as Record<string, unknown>;
    const rawSchema = pickChannelSchemaExport(mod, manifest);
    const resolved = resolveChannelConfigExport(rawSchema);
    if (!resolved?.schema) {
      return fallback();
    }
    const channelIds = Array.isArray(manifest.channels)
      ? manifest.channels.filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
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

function resolveChannelConfigExport(raw: unknown): ChannelConfigExport {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  if ("schema" in (raw as Record<string, unknown>)) {
    const schema = (raw as { schema?: unknown }).schema;
    if (schema && typeof schema === "object") {
      return raw as {
        schema: Record<string, unknown>;
        uiHints?: Record<string, PluginConfigUiHint>;
      };
    }
  }
  if (typeof (raw as { safeParse?: unknown }).safeParse === "function") {
    const built = buildChannelConfigSchema(raw as never);
    return {
      schema: built.schema,
      ...(built.uiHints ? { uiHints: built.uiHints } : {}),
    };
  }
  return undefined;
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function pickChannelSchemaExport(
  mod: Record<string, unknown>,
  manifest: PluginManifest,
): unknown {
  const entries = Object.entries(mod);
  const exportMap = new Map(entries);
  const ids =
    Array.isArray(manifest.channels) && manifest.channels.length > 0
      ? manifest.channels
      : [manifest.id];
  const preferredNames = ids.flatMap((id) => {
    const base = toPascalCase(id);
    return [`${base}ChannelConfigSchema`, `${base}ConfigSchema`];
  });
  for (const name of preferredNames) {
    if (exportMap.has(name)) {
      return exportMap.get(name);
    }
  }
  return (
    entries.find(
      ([key, value]) =>
        /(?:Channel)?ConfigSchema$/u.test(key) &&
        value &&
        typeof value === "object" &&
        ("schema" in (value as Record<string, unknown>) ||
          typeof (value as { safeParse?: unknown }).safeParse === "function"),
    )?.[1] ??
    entries.find(
      ([, value]) =>
        value &&
        typeof value === "object" &&
        ("schema" in (value as Record<string, unknown>) ||
          typeof (value as { safeParse?: unknown }).safeParse === "function"),
    )?.[1]
  );
}

function mergeChannelConfigs(params: {
  manifest: PluginManifest;
  pluginDir: string;
  packageManifest?: OpenClawPackageManifest;
  includeSyntheticChannelConfigs: boolean;
}): PluginManifest {
  if (!params.includeSyntheticChannelConfigs) {
    return params.manifest;
  }
  const synthetic = loadSyntheticChannelConfigs(params.pluginDir, params.manifest);
  if (!synthetic) {
    return params.manifest;
  }
  const merged = {
    ...(params.manifest.channelConfigs ?? {}),
  };
  for (const [channelId, syntheticConfig] of Object.entries(synthetic)) {
    const existing = merged[channelId];
    const packageMeta = resolvePackageChannelMeta(params.packageManifest, channelId);
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
    ...params.manifest,
    channelConfigs: merged,
  };
}

function buildMetadataEntry(params: {
  dirName: string;
  pluginDir: string;
  includeChannelConfigs: boolean;
  includeSyntheticChannelConfigs: boolean;
}): GeneratedBundledPluginMetadata | null {
  const manifest = readJsonIfExists<PluginManifest>(path.join(params.pluginDir, "openclaw.plugin.json"));
  if (!manifest?.id) {
    return null;
  }
  const packageJson = readJsonIfExists<PackageJsonShape>(path.join(params.pluginDir, "package.json"));
  const packageManifest = packageJson?.openclaw;
  const primarySourceEntry =
    normalizePathPair(packageManifest?.extensions?.find((entry) => typeof entry === "string" && !!entry.trim())) ??
    normalizePathPair("./index.ts");
  if (!primarySourceEntry) {
    return null;
  }
  const setupSource = normalizePathPair(packageManifest?.setupEntry);
  const primaryEntries = new Set<string>([
    primarySourceEntry.built,
    ...(setupSource ? [setupSource.built] : []),
  ]);
  const publicSurfaceArtifacts = collectPublicSurfaceArtifacts(params.pluginDir, primaryEntries);
  const runtimeSidecarArtifacts = collectRuntimeSidecarArtifacts(publicSurfaceArtifacts);

  const effectiveManifest = params.includeChannelConfigs
    ? mergeChannelConfigs({
        manifest,
        pluginDir: params.pluginDir,
        packageManifest,
        includeSyntheticChannelConfigs: params.includeSyntheticChannelConfigs,
      })
    : manifest;

  return {
    dirName: params.dirName,
    idHint: manifest.id,
    source: primarySourceEntry,
    ...(setupSource ? { setupSource } : {}),
    ...(publicSurfaceArtifacts ? { publicSurfaceArtifacts } : {}),
    ...(runtimeSidecarArtifacts ? { runtimeSidecarArtifacts } : {}),
    ...(packageJson?.name ? { packageName: packageJson.name } : {}),
    ...(packageJson?.version ? { packageVersion: packageJson.version } : {}),
    ...(packageJson?.description ? { packageDescription: packageJson.description } : {}),
    ...(packageManifest ? { packageManifest } : {}),
    manifest: effectiveManifest,
  };
}

function buildCacheKey(options: Required<ListBundledPluginMetadataOptions>): string {
  return JSON.stringify(options);
}

export function listBundledPluginMetadata(
  options: ListBundledPluginMetadataOptions = {},
): readonly GeneratedBundledPluginMetadata[] {
  const normalized: Required<ListBundledPluginMetadataOptions> = {
    rootDir: path.resolve(options.rootDir ?? DEFAULT_ROOT_DIR),
    includeChannelConfigs: options.includeChannelConfigs ?? true,
    includeSyntheticChannelConfigs: options.includeSyntheticChannelConfigs ?? true,
  };
  const cacheKey = buildCacheKey(normalized);
  const cached = metadataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (
    normalized.rootDir === DEFAULT_ROOT_DIR &&
    normalized.includeChannelConfigs === true
  ) {
    metadataCache.set(cacheKey, BUNDLED_PLUGIN_METADATA);
    return BUNDLED_PLUGIN_METADATA;
  }

  const extensionsDir = path.join(normalized.rootDir, "extensions");
  if (!fs.existsSync(extensionsDir)) {
    metadataCache.set(cacheKey, []);
    return [];
  }

  const entries = fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      buildMetadataEntry({
        dirName: entry.name,
        pluginDir: path.join(extensionsDir, entry.name),
        includeChannelConfigs: normalized.includeChannelConfigs,
        includeSyntheticChannelConfigs: normalized.includeSyntheticChannelConfigs,
      }),
    )
    .filter((entry): entry is GeneratedBundledPluginMetadata => entry !== null)
    .toSorted((left, right) => left.dirName.localeCompare(right.dirName));

  metadataCache.set(cacheKey, entries);
  return entries;
}

export const BUNDLED_PLUGIN_METADATA =
  GENERATED_BUNDLED_PLUGIN_METADATA as unknown as readonly GeneratedBundledPluginMetadata[];

export function findBundledPluginMetadataById(
  pluginId: string,
  options: ListBundledPluginMetadataOptions = {},
): BundledPluginMetadata | undefined {
  const normalized = pluginId.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return listBundledPluginMetadata(options).find((entry) => entry.manifest.id.toLowerCase() === normalized);
}

function resolveBundledPluginDistSiblingPath(
  rootDir: string,
  builtPath: string | undefined,
): GeneratedBundledPluginResolvedPath | null {
  if (!builtPath) {
    return null;
  }
  const pluginRoot = path.resolve(rootDir);
  const extensionsDir = path.dirname(pluginRoot);
  if (path.basename(extensionsDir) !== "extensions") {
    return null;
  }
  const containerRoot = path.dirname(extensionsDir);
  const packageRoot =
    path.basename(containerRoot) === "dist-runtime" ? path.dirname(containerRoot) : containerRoot;
  const siblingRootDir = path.join(packageRoot, "dist", "extensions", path.basename(pluginRoot));
  const candidate = path.join(siblingRootDir, builtPath);
  return fs.existsSync(candidate) ? { path: candidate, rootDir: siblingRootDir } : null;
}

function resolveGeneratedPath(baseDir: string, target: string | undefined): string | null {
  if (!target) {
    return null;
  }
  return path.isAbsolute(target) ? target : path.resolve(baseDir, target);
}

export function resolveBundledPluginGeneratedLocation(
  rootDir: string,
  entry: GeneratedBundledPluginPathPair | undefined,
): GeneratedBundledPluginResolvedPath | null {
  if (!entry) {
    return null;
  }
  const candidates = [
    entry.built
      ? {
          path: resolveGeneratedPath(rootDir, entry.built),
          rootDir: path.resolve(rootDir),
        }
      : null,
    resolveBundledPluginDistSiblingPath(rootDir, entry.built),
    entry.source
      ? {
          path: resolveGeneratedPath(rootDir, entry.source),
          rootDir: path.resolve(rootDir),
        }
      : null,
  ].filter(
    (candidate): candidate is GeneratedBundledPluginResolvedPath =>
      candidate !== null &&
      typeof candidate.path === "string" &&
      candidate.path.length > 0 &&
      typeof candidate.rootDir === "string" &&
      candidate.rootDir.length > 0,
  );
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      return candidate;
    }
  }
  return null;
}

export function resolveBundledPluginGeneratedPath(
  rootDir: string,
  entry: GeneratedBundledPluginPathPair | undefined,
): string | null {
  return resolveBundledPluginGeneratedLocation(rootDir, entry)?.path ?? null;
}

export function resolveBundledPluginPublicSurfacePath(params: {
  rootDir?: string;
  bundledPluginsDir?: string;
  dirName: string;
  artifactBasename: string;
}): string | null {
  const rootDir = path.resolve(params.rootDir ?? DEFAULT_ROOT_DIR);
  const distCandidate = path.join(rootDir, "dist", "extensions", params.dirName, params.artifactBasename);
  if (fs.existsSync(distCandidate)) {
    return distCandidate;
  }
  const sourceBaseName = params.artifactBasename.replace(/\.js$/u, "");
  const sourceRoots = [
    params.bundledPluginsDir ? path.resolve(params.bundledPluginsDir) : null,
    path.join(rootDir, "extensions"),
  ].filter((entry): entry is string => Boolean(entry));
  for (const sourceRoot of sourceRoots) {
    for (const ext of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
      const candidate = path.join(sourceRoot, params.dirName, `${sourceBaseName}${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

export function resolveBundledPluginWorkspaceSourcePath(params: {
  rootDir?: string;
  pluginId: string;
}): string | null {
  const metadata = findBundledPluginMetadataById(params.pluginId, {
    rootDir: params.rootDir,
  });
  if (!metadata) {
    return null;
  }
  const rootDir = path.resolve(params.rootDir ?? DEFAULT_ROOT_DIR);
  return path.join(rootDir, "extensions", metadata.dirName);
}
