import { relative, resolve } from "node:path";
import { loadPluginManifestRegistry } from "../../manifest-registry.js";

const REPO_ROOT = process.cwd();

const bundledPluginRoots = new Map(
  loadPluginManifestRegistry({ cache: true, config: {} })
    .plugins.filter((plugin) => plugin.origin === "bundled")
    .map((plugin) => [plugin.id, resolve(REPO_ROOT, "extensions", plugin.id)] as const),
);

export function getBundledPluginRoots(): ReadonlyMap<string, string> {
  return bundledPluginRoots;
}

export function resolveBundledPluginFile(params: {
  pluginId: string;
  relativePath: string;
}): string {
  const pluginRootDir = bundledPluginRoots.get(params.pluginId);
  if (!pluginRootDir) {
    throw new Error(`missing bundled plugin root for ${params.pluginId}`);
  }
  return resolve(pluginRootDir, params.relativePath);
}

export function bundledPluginFile(params: {
  rootDir: string;
  pluginId: string;
  relativePath: string;
}): string {
  return relative(resolve(params.rootDir, ".."), resolveBundledPluginFile(params)).replaceAll(
    "\\",
    "/",
  );
}
