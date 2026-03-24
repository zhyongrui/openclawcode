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

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
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
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveBundledPluginsDir", () => {
  it("returns OPENCLAW_BUNDLED_PLUGINS_DIR override when set", () => {
    const overrideDir = makeTempDir("openclaw-bundled-plugins-override-");
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = ` ${overrideDir} `;
    expect(resolveBundledPluginsDir()).toBe(overrideDir);
  });

  it("prefers packageRoot/extensions over dist/extensions in a built layout", () => {
    const root = makeTempDir("openclaw-bundled-plugins-built-");
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
    const repoRoot = makeTempDir("openclaw-bundled-dir-runtime-");
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
    const repoRoot = makeTempDir("openclaw-bundled-dir-watch-");
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
    const repoRoot = makeTempDir("openclaw-bundled-dir-dist-");
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
    const repoRoot = makeTempDir("openclaw-bundled-dir-vitest-");
    fs.mkdirSync(path.join(repoRoot, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist-runtime", "extensions"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist", "extensions"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      `${JSON.stringify({ name: "openclaw" }, null, 2)}\n`,
      "utf8",
    );

    process.env.VITEST = "true";

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
    const repoRoot = makeTempDir("openclaw-bundled-dir-git-");
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
});
