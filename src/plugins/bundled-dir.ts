import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOpenClawPackageRootSync } from "../infra/openclaw-root.js";
import { resolveUserPath } from "../utils.js";

export type BundledPluginsResolveOptions = {
  argv1?: string;
  moduleUrl?: string;
  cwd?: string;
  execPath?: string;
};

function isSourceCheckoutRoot(packageRoot: string): boolean {
  return (
    fs.existsSync(path.join(packageRoot, ".git")) &&
    fs.existsSync(path.join(packageRoot, "src")) &&
    fs.existsSync(path.join(packageRoot, "extensions"))
  );
}

function resolveBundledDirFromPackageRoot(
  packageRoot: string,
  preferSourceCheckout: boolean,
): string | undefined {
  const sourceExtensionsDir = path.join(packageRoot, "extensions");
  const builtExtensionsDir = path.join(packageRoot, "dist", "extensions");
  if (
    (preferSourceCheckout || isSourceCheckoutRoot(packageRoot)) &&
    fs.existsSync(sourceExtensionsDir)
  ) {
    return sourceExtensionsDir;
  }
  // Local source checkouts stage a runtime-complete bundled plugin tree under
  // dist-runtime/. Prefer that over source extensions only when the paired
  // dist/ tree exists; otherwise wrappers can drift ahead of the last build.
  const runtimeExtensionsDir = path.join(packageRoot, "dist-runtime", "extensions");
  if (fs.existsSync(runtimeExtensionsDir) && fs.existsSync(builtExtensionsDir)) {
    return runtimeExtensionsDir;
  }
  if (fs.existsSync(builtExtensionsDir)) {
    return builtExtensionsDir;
  }
  return undefined;
}

export function resolveBundledPluginsDir(
  env: NodeJS.ProcessEnv = process.env,
  opts: BundledPluginsResolveOptions = {},
): string | undefined {
  const override = env.OPENCLAW_BUNDLED_PLUGINS_DIR?.trim();
  if (override) {
    const resolvedOverride = resolveUserPath(override, env);
    if (fs.existsSync(resolvedOverride)) {
      return resolvedOverride;
    }
    // Installed CLIs can inherit stale bundled-dir overrides from older shells
    // or debug sessions. Prefer the package that owns argv[1] over a broken
    // override so bundled providers keep working in packaged installs.
    try {
      const argvPackageRoot = resolveOpenClawPackageRootSync({
        argv1: opts.argv1 ?? process.argv[1],
      });
      if (argvPackageRoot && !isSourceCheckoutRoot(argvPackageRoot)) {
        const argvFallback = resolveBundledDirFromPackageRoot(argvPackageRoot, false);
        if (argvFallback) {
          return argvFallback;
        }
      }
    } catch {
      // ignore
    }
    return resolvedOverride;
  }

  const preferSourceCheckout = Boolean(env.VITEST) || env.OPENCLAW_WATCH_MODE === "1";

  try {
    const explicitPackageRoot =
      opts.argv1 || opts.cwd || opts.moduleUrl
        ? resolveOpenClawPackageRootSync({
            argv1: opts.argv1 ?? process.argv[1],
            cwd: opts.cwd ?? process.cwd(),
            moduleUrl: opts.moduleUrl ?? import.meta.url,
          })
        : undefined;
    const packageRoots = [
      explicitPackageRoot,
      resolveOpenClawPackageRootSync({ argv1: opts.argv1 ?? process.argv[1] }),
      resolveOpenClawPackageRootSync({ cwd: opts.cwd ?? process.cwd() }),
      resolveOpenClawPackageRootSync({ moduleUrl: opts.moduleUrl ?? import.meta.url }),
    ].filter(
      (entry, index, all): entry is string => Boolean(entry) && all.indexOf(entry) === index,
    );
    for (const packageRoot of packageRoots) {
      const bundledDir = resolveBundledDirFromPackageRoot(packageRoot, preferSourceCheckout);
      if (bundledDir) {
        return bundledDir;
      }
    }
  } catch {
    // ignore
  }

  // bun --compile: ship a sibling `extensions/` next to the executable.
  try {
    const execDir = path.dirname(opts.execPath ?? process.execPath);
    const siblingBuilt = path.join(execDir, "dist", "extensions");
    if (fs.existsSync(siblingBuilt)) {
      return siblingBuilt;
    }
    const sibling = path.join(execDir, "extensions");
    if (fs.existsSync(sibling)) {
      return sibling;
    }
  } catch {
    // ignore
  }

  // npm/dev: resolve `<packageRoot>/extensions` first so a partial `dist/extensions`
  // directory does not shadow the full bundled tree at the package root.
  try {
    const moduleUrl = opts.moduleUrl ?? import.meta.url;
    const argv1 = opts.argv1 ?? process.argv[1];
    const cwd = opts.cwd ?? process.cwd();
    const packageRoot = resolveOpenClawPackageRootSync({
      argv1,
      moduleUrl,
      cwd,
    });
    if (packageRoot) {
      const candidate = path.join(packageRoot, "extensions");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    let cursor = path.dirname(fileURLToPath(moduleUrl));
    for (let i = 0; i < 6; i += 1) {
      const candidate = path.join(cursor, "extensions");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {
    // ignore
  }

  return undefined;
}
