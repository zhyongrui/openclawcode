import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectBundledPluginMetadata,
  writeBundledPluginMetadataModule,
} from "../../scripts/generate-bundled-plugin-metadata.mjs";
import {
  BUNDLED_PLUGIN_METADATA,
  resolveBundledPluginGeneratedLocation,
  resolveBundledPluginGeneratedPath,
} from "./bundled-plugin-metadata.js";
import {
  createGeneratedPluginTempRoot,
  installGeneratedPluginTempRootCleanup,
  pluginTestRepoRoot as repoRoot,
  writeJson,
} from "./generated-plugin-test-helpers.js";

const BUNDLED_PLUGIN_METADATA_TEST_TIMEOUT_MS = 300_000;

installGeneratedPluginTempRootCleanup();

function expectTestOnlyArtifactsExcluded(artifacts: readonly string[]) {
  artifacts.forEach((artifact) => {
    expect(artifact).not.toMatch(/^test-/);
    expect(artifact).not.toContain(".test-");
    expect(artifact).not.toMatch(/\.test\.js$/);
  });
}

function expectGeneratedPathResolution(rootDir: string, expectedPath: string) {
  expect(
    resolveBundledPluginGeneratedPath(
      rootDir,
      {
        source: "./index.ts",
        built: "index.js",
      },
    ),
  ).toBe(expectedPath);
}

function expectPluginScopedGeneratedPathResolution(
  rootDir: string,
  expectedPath: string,
) {
  expect(
    resolveBundledPluginGeneratedPath(
      rootDir,
      {
        source: "./index.ts",
        built: "index.js",
      },
    ),
  ).toBe(expectedPath);
}

function expectArtifactPresence(
  artifacts: readonly string[] | undefined,
  params: { contains?: readonly string[]; excludes?: readonly string[] },
) {
  if (params.contains) {
    for (const artifact of params.contains) {
      expect(artifacts).toContain(artifact);
    }
  }
  if (params.excludes) {
    for (const artifact of params.excludes) {
      expect(artifacts).not.toContain(artifact);
    }
  }
}

async function writeGeneratedMetadataModule(params: {
  repoRoot: string;
  outputPath?: string;
  check?: boolean;
}) {
  return writeBundledPluginMetadataModule({
    repoRoot: params.repoRoot,
    outputPath: params.outputPath ?? "src/plugins/bundled-plugin-metadata.generated.ts",
    ...(params.check ? { check: true } : {}),
  });
}

async function expectGeneratedMetadataModuleState(params: {
  repoRoot: string;
  check?: boolean;
  expected: { changed?: boolean; wrote?: boolean };
}) {
  const result = await writeGeneratedMetadataModule({
    repoRoot: params.repoRoot,
    ...(params.check ? { check: true } : {}),
  });
  expect(result).toEqual(expect.objectContaining(params.expected));
  return result;
}

describe("bundled plugin metadata", () => {
  it(
    "matches the checked-in generated metadata module",
    { timeout: BUNDLED_PLUGIN_METADATA_TEST_TIMEOUT_MS },
    async () => {
      const collected = await collectBundledPluginMetadata({ repoRoot });
      expect(BUNDLED_PLUGIN_METADATA.length).toBeGreaterThan(0);
      expect(collected.map((entry) => entry.dirName)).toEqual(
        BUNDLED_PLUGIN_METADATA.map((entry) => entry.dirName),
      );
      expect(collected.find((entry) => entry.dirName === "discord")?.setupSource).toEqual(
        BUNDLED_PLUGIN_METADATA.find((entry) => entry.dirName === "discord")?.setupSource,
      );
    },
  );

  it("captures setup-entry metadata for bundled channel plugins", () => {
    const discord = BUNDLED_PLUGIN_METADATA.find((entry) => entry.dirName === "discord");
    expect(discord?.source).toEqual({ source: "./index.ts", built: "index.js" });
    expect(discord?.setupSource).toEqual({ source: "./setup-entry.ts", built: "setup-entry.js" });
    expectArtifactPresence(discord?.publicSurfaceArtifacts, {
      contains: ["api.js", "runtime-api.js", "session-key-api.js"],
      excludes: ["test-api.js"],
    });
    expectArtifactPresence(discord?.runtimeSidecarArtifacts, {
      contains: ["runtime-api.js"],
    });
    expect(discord?.manifest.id).toBe("discord");
    expect(discord?.manifest.channelConfigs?.discord).toEqual(
      expect.objectContaining({
        schema: expect.objectContaining({ type: "object" }),
      }),
    );
  });

  it("excludes test-only public surface artifacts", () => {
    BUNDLED_PLUGIN_METADATA.forEach((entry) =>
      expectTestOnlyArtifactsExcluded(entry.publicSurfaceArtifacts ?? []),
    );
  });

  it("prefers built generated paths when present and falls back to source paths", () => {
    const tempRoot = createGeneratedPluginTempRoot("openclaw-bundled-plugin-metadata-");
    const pluginRoot = path.join(tempRoot, "extensions", "plugin");
    const distPluginRoot = path.join(tempRoot, "dist", "extensions", "plugin");

    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "index.ts"), "export {};\n", "utf8");
    expectGeneratedPathResolution(pluginRoot, path.join(pluginRoot, "index.ts"));

    fs.mkdirSync(distPluginRoot, { recursive: true });
    fs.writeFileSync(path.join(distPluginRoot, "index.js"), "export {};\n", "utf8");
    expectGeneratedPathResolution(pluginRoot, path.join(distPluginRoot, "index.js"));
  });

  it("resolves plugin-local generated entry paths when the plugin dir is provided", () => {
    const tempRoot = createGeneratedPluginTempRoot("openclaw-bundled-plugin-metadata-local-");
    const pluginRoot = path.join(tempRoot, "extensions", "alpha");
    const distPluginRoot = path.join(tempRoot, "dist", "extensions", "alpha");

    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "index.ts"), "export {};\n", "utf8");
    expectPluginScopedGeneratedPathResolution(pluginRoot, path.join(pluginRoot, "index.ts"));

    fs.mkdirSync(distPluginRoot, { recursive: true });
    fs.writeFileSync(path.join(distPluginRoot, "index.js"), "export {};\n", "utf8");
    expectPluginScopedGeneratedPathResolution(pluginRoot, path.join(distPluginRoot, "index.js"));
  });

  it("prefers sibling dist outputs for source extension roots", () => {
    const tempRoot = createGeneratedPluginTempRoot("openclaw-bundled-plugin-metadata-");
    const sourceRoot = path.join(tempRoot, "extensions", "feishu");
    const distRoot = path.join(tempRoot, "dist", "extensions", "feishu");

    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "index.ts"), "export {};\n", "utf8");
    fs.mkdirSync(distRoot, { recursive: true });
    fs.writeFileSync(path.join(distRoot, "index.js"), "export {};\n", "utf8");

    expect(
      resolveBundledPluginGeneratedPath(sourceRoot, {
        source: "./index.ts",
        built: "index.js",
      }),
    ).toBe(path.join(distRoot, "index.js"));
    expect(
      resolveBundledPluginGeneratedLocation(sourceRoot, {
        source: "./index.ts",
        built: "index.js",
      }),
    ).toEqual({
      path: path.join(distRoot, "index.js"),
      rootDir: distRoot,
    });
  });

  it("supports check mode for stale generated artifacts", async () => {
    const tempRoot = createGeneratedPluginTempRoot("openclaw-bundled-plugin-generated-");

    writeJson(path.join(tempRoot, "extensions", "alpha", "package.json"), {
      name: "@openclaw/alpha",
      version: "0.0.1",
      openclaw: {
        extensions: ["./index.ts"],
      },
    });
    writeJson(path.join(tempRoot, "extensions", "alpha", "openclaw.plugin.json"), {
      id: "alpha",
      configSchema: { type: "object" },
    });

    await expectGeneratedMetadataModuleState({
      repoRoot: tempRoot,
      expected: { wrote: true },
    });

    await expectGeneratedMetadataModuleState({
      repoRoot: tempRoot,
      check: true,
      expected: { changed: false, wrote: false },
    });

    fs.writeFileSync(
      path.join(tempRoot, "src/plugins/bundled-plugin-metadata.generated.ts"),
      "// stale\n",
      "utf8",
    );

    await expectGeneratedMetadataModuleState({
      repoRoot: tempRoot,
      check: true,
      expected: { changed: true, wrote: false },
    });
  });

  it("merges generated channel schema metadata with manifest-owned channel config fields", async () => {
    const tempRoot = createGeneratedPluginTempRoot("openclaw-bundled-plugin-channel-configs-");

    writeJson(path.join(tempRoot, "extensions", "alpha", "package.json"), {
      name: "@openclaw/alpha",
      version: "0.0.1",
      openclaw: {
        extensions: ["./index.ts"],
        channel: {
          id: "alpha",
          label: "Alpha Root Label",
          blurb: "Alpha Root Description",
          preferOver: ["alpha-legacy"],
        },
      },
    });
    writeJson(path.join(tempRoot, "extensions", "alpha", "openclaw.plugin.json"), {
      id: "alpha",
      channels: ["alpha"],
      configSchema: { type: "object" },
      channelConfigs: {
        alpha: {
          schema: { type: "object", properties: { stale: { type: "boolean" } } },
          label: "Manifest Label",
          uiHints: {
            "channels.alpha.explicitOnly": {
              help: "manifest hint",
            },
          },
        },
      },
    });
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "index.ts"),
      "export {};\n",
      "utf8",
    );
    fs.mkdirSync(path.join(tempRoot, "extensions", "alpha", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "src", "config-schema.js"),
      [
        "export const AlphaChannelConfigSchema = {",
        "  schema: {",
        "    type: 'object',",
        "    properties: { generated: { type: 'string' } },",
        "  },",
        "  uiHints: {",
        "    'channels.alpha.generatedOnly': { help: 'generated hint' },",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const entries = await collectBundledPluginMetadata({ repoRoot: tempRoot });
    const channelConfigs = entries[0]?.manifest.channelConfigs as
      | Record<string, unknown>
      | undefined;
    expect(channelConfigs?.alpha).toEqual({
      schema: {
        type: "object",
        properties: {
          generated: { type: "string" },
        },
      },
      label: "Manifest Label",
      description: "Alpha Root Description",
      preferOver: ["alpha-legacy"],
      uiHints: {
        "channels.alpha.generatedOnly": { help: "generated hint" },
        "channels.alpha.explicitOnly": { help: "manifest hint" },
      },
    });
  });

  it("captures top-level public surface artifacts without duplicating the primary entrypoints", async () => {
    const tempRoot = createGeneratedPluginTempRoot("openclaw-bundled-plugin-public-artifacts-");

    writeJson(path.join(tempRoot, "extensions", "alpha", "package.json"), {
      name: "@openclaw/alpha",
      version: "0.0.1",
      openclaw: {
        extensions: ["./index.ts"],
        setupEntry: "./setup-entry.ts",
      },
    });
    writeJson(path.join(tempRoot, "extensions", "alpha", "openclaw.plugin.json"), {
      id: "alpha",
      configSchema: { type: "object" },
    });
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "index.ts"),
      "export {};\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "setup-entry.ts"),
      "export {};\n",
      "utf8",
    );
    fs.writeFileSync(path.join(tempRoot, "extensions", "alpha", "api.ts"), "export {};\n", "utf8");
    fs.writeFileSync(
      path.join(tempRoot, "extensions", "alpha", "runtime-api.ts"),
      "export {};\n",
      "utf8",
    );

    const entries = await collectBundledPluginMetadata({ repoRoot: tempRoot });
    const firstEntry = entries[0] as
      | {
          publicSurfaceArtifacts?: string[];
          runtimeSidecarArtifacts?: string[];
        }
      | undefined;
    expect(firstEntry?.publicSurfaceArtifacts).toEqual(["api.js", "runtime-api.js"]);
    expect(firstEntry?.runtimeSidecarArtifacts).toEqual(["runtime-api.js"]);
  });
});
