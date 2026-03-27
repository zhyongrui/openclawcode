import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBundledPluginsDir } from "./bundled-dir.js";

const tempDirs: string[] = [];
const originalBundledDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
const originalWatchMode = process.env.OPENCLAW_WATCH_MODE;
const originalVitest = process.env.VITEST;
const originalArgv1 = process.argv[1];

function makeRepoRoot(prefix: string): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(repoRoot);
  return repoRoot;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalBundledDir === undefined) {
    delete process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
  } else {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = originalBundledDir;
  }
  if (originalWatchMode === undefined) {
    delete process.env.OPENCLAW_WATCH_MODE;
  } else {
    process.env.OPENCLAW_WATCH_MODE = originalWatchMode;
  }
  if (originalVitest === undefined) {
    delete process.env.VITEST;
  } else {
    process.env.VITEST = originalVitest;
  }
  process.argv[1] = originalArgv1;
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveBundledPluginsDir", () => {
  it("returns OPENCLAW_BUNDLED_PLUGINS_DIR override when set", () => {
    const overrideDir = makeRepoRoot("openclaw-bundled-plugins-override-");
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = ` ${overrideDir} `;
    expect(resolveBundledPluginsDir()).toBe(overrideDir);
  });

  it("prefers packageRoot/extensions over dist/extensions in a built layout", () => {
    const root = makeRepoRoot("openclaw-bundled-plugins-built-");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));

    const bundledRoot = path.join(root, "extensions");
    const distBundledRoot = path.join(root, "dist", "extensions");
    fs.mkdirSync(path.join(bundledRoot, "memory-core"), { recursive: true });
    fs.mkdirSync(path.join(distBundledRoot, "openclawcode"), { recursive: true });
    fs.writeFileSync(
      path.join(bundledRoot, "memory-core", "openclaw.plugin.json"),
      '{"id":"memory-core"}\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(distBundledRoot, "openclawcode", "openclaw.plugin.json"),
      '{"id":"openclawcode"}\n',
      "utf8",
    );

    const resolved = resolveBundledPluginsDir(process.env, {
      argv1: path.join(root, "dist", "index.js"),
      moduleUrl: pathToFileURL(path.join(root, "dist", "plugins", "bundled-dir.js")).href,
      cwd: path.join(root, "dist"),
      execPath: path.join(root, "bin", "node"),
    });

    expect(resolved).toBe(bundledRoot);
  });

  it("prefers the staged runtime bundled plugin tree from the package root", () => {
    const repoRoot = makeRepoRoot("openclaw-bundled-dir-runtime-");
    fs.mkdirSync(path.join(repoRoot, "dist-runtime", "extensions"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist", "extensions"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    expect(
      fs.realpathSync(
        resolveBundledPluginsDir(process.env, {
          cwd: repoRoot,
          moduleUrl: pathToFileURL(path.join(repoRoot, "dist", "plugins", "bundled-dir.js")).href,
        }) ?? "",
      ),
    ).toBe(fs.realpathSync(path.join(repoRoot, "dist-runtime", "extensions")));
  });

  it("prefers source extensions from the package root in watch mode", () => {
    const repoRoot = makeRepoRoot("openclaw-bundled-dir-watch-");
    fs.mkdirSync(path.join(repoRoot, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist-runtime", "extensions"), { recursive: true });

    fs.mkdirSync(path.join(repoRoot, "dist", "extensions"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    process.env.OPENCLAW_WATCH_MODE = "1";

    expect(
      fs.realpathSync(
        resolveBundledPluginsDir(process.env, {
          cwd: repoRoot,
          moduleUrl: pathToFileURL(path.join(repoRoot, "dist", "plugins", "bundled-dir.js")).href,
        }) ?? "",
      ),
    ).toBe(fs.realpathSync(path.join(repoRoot, "extensions")));
  });

  it("falls back to built dist/extensions in installed package roots", () => {
    const repoRoot = makeRepoRoot("openclaw-bundled-dir-dist-");
    fs.mkdirSync(path.join(repoRoot, "dist", "extensions"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    expect(
      fs.realpathSync(
        resolveBundledPluginsDir(process.env, {
          cwd: repoRoot,
          moduleUrl: pathToFileURL(path.join(repoRoot, "dist", "plugins", "bundled-dir.js")).href,
        }) ?? "",
      ),
    ).toBe(
      fs.realpathSync(path.join(repoRoot, "dist", "extensions")),
    );
  });

  it("prefers source extensions under vitest to avoid stale staged plugins", () => {
    const repoRoot = makeRepoRoot("openclaw-bundled-dir-vitest-");
    fs.mkdirSync(path.join(repoRoot, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist-runtime", "extensions"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist", "extensions"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    process.env.VITEST = "true";
    process.argv[1] = "/usr/bin/env";

    expect(
      fs.realpathSync(
        resolveBundledPluginsDir(process.env, {
          cwd: repoRoot,
          moduleUrl: pathToFileURL(path.join(repoRoot, "dist", "plugins", "bundled-dir.js")).href,
        }) ?? "",
      ),
    ).toBe(
      fs.realpathSync(path.join(repoRoot, "extensions")),
    );
  });

  it("prefers source extensions in a git checkout even without vitest env", () => {
    const repoRoot = makeRepoRoot("openclaw-bundled-dir-git-");
    fs.mkdirSync(path.join(repoRoot, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist-runtime", "extensions"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist", "extensions"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, ".git"), "gitdir: /tmp/fake.git\n", "utf8");
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    delete process.env.VITEST;
    process.argv[1] = "/usr/bin/env";

    expect(
      fs.realpathSync(
        resolveBundledPluginsDir(process.env, {
          cwd: repoRoot,
          moduleUrl: pathToFileURL(path.join(repoRoot, "dist", "plugins", "bundled-dir.js")).href,
        }) ?? "",
      ),
    ).toBe(
      fs.realpathSync(path.join(repoRoot, "extensions")),
    );
  });

  it("prefers the running CLI package root over an unrelated cwd checkout", () => {
    const installedRoot = makeRepoRoot("openclaw-bundled-dir-installed-");
    fs.mkdirSync(path.join(installedRoot, "dist", "extensions"), { recursive: true });
    fs.writeFileSync(
      path.join(installedRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    const cwdRepoRoot = makeRepoRoot("openclaw-bundled-dir-cwd-");
    fs.mkdirSync(path.join(cwdRepoRoot, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(cwdRepoRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwdRepoRoot, ".git"), "gitdir: /tmp/fake.git\n", "utf8");
    fs.writeFileSync(
      path.join(cwdRepoRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    vi.spyOn(process, "cwd").mockReturnValue(cwdRepoRoot);
    process.argv[1] = path.join(installedRoot, "openclaw.mjs");

    expect(fs.realpathSync(resolveBundledPluginsDir() ?? "")).toBe(
      fs.realpathSync(path.join(installedRoot, "dist", "extensions")),
    );
  });

  it("falls back to the running installed package when the override path is stale", () => {
    const installedRoot = makeRepoRoot("openclaw-bundled-dir-override-");
    fs.mkdirSync(path.join(installedRoot, "dist", "extensions"), { recursive: true });
    fs.writeFileSync(
      path.join(installedRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    process.argv[1] = path.join(installedRoot, "openclaw.mjs");
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = path.join(installedRoot, "missing-extensions");

    expect(fs.realpathSync(resolveBundledPluginsDir() ?? "")).toBe(
      fs.realpathSync(path.join(installedRoot, "dist", "extensions")),
    );
  });
});
