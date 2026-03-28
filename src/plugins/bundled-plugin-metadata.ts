import fs from "node:fs";
import path from "node:path";
import { GENERATED_BUNDLED_PLUGIN_METADATA } from "./bundled-plugin-metadata.generated.js";
import type { PluginManifest, OpenClawPackageManifest } from "./manifest.js";

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

export const BUNDLED_PLUGIN_METADATA =
  GENERATED_BUNDLED_PLUGIN_METADATA as unknown as readonly GeneratedBundledPluginMetadata[];

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
