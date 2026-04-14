import path from "node:path";
import {
  listBundledPluginMetadata,
  resolveBundledPluginGeneratedPath,
  resolveBundledPluginWorkspaceSourcePath,
  type BundledPluginMetadata,
} from "./bundled-plugin-metadata.js";

export type BundledChannelPluginMetadata = BundledPluginMetadata;

export function listBundledChannelPluginMetadata(params?: {
  rootDir?: string;
  includeChannelConfigs?: boolean;
  includeSyntheticChannelConfigs?: boolean;
}): readonly BundledChannelPluginMetadata[] {
  return listBundledPluginMetadata(params);
}

export function resolveBundledChannelGeneratedPath(
  rootDir: string,
  entry: BundledPluginMetadata["source"] | BundledPluginMetadata["setupSource"],
  pluginDirName?: string,
): string | null {
  const effectiveRootDir = pluginDirName
    ? path.join(path.resolve(rootDir), "extensions", pluginDirName)
    : rootDir;
  return resolveBundledPluginGeneratedPath(effectiveRootDir, entry);
}

export function resolveBundledChannelWorkspacePath(params: {
  rootDir: string;
  pluginId: string;
}): string | null {
  return resolveBundledPluginWorkspaceSourcePath(params);
}
