import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginSdkSubpaths = fs
  .readdirSync(path.join(repoRoot, "src", "plugin-sdk"))
  .filter((name) => name.endsWith(".ts"))
  .filter((name) => !name.endsWith(".test.ts"))
  .filter((name) => name !== "index.ts")
  .map((name) => name.replace(/\.ts$/, ""));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "openclaw/extension-api",
        replacement: path.join(repoRoot, "src", "extensionAPI.ts"),
      },
      ...pluginSdkSubpaths.map((subpath) => ({
        find: `openclaw/plugin-sdk/${subpath}`,
        replacement: path.join(repoRoot, "src", "plugin-sdk", `${subpath}.ts`),
      })),
      {
        find: "openclaw/plugin-sdk",
        replacement: path.join(repoRoot, "src", "plugin-sdk", "index.ts"),
      },
    ],
  },
  test: {
    include: ["src/openclawcode/testing/**/*.test.ts"],
    environment: "node",
    pool: "threads",
    testTimeout: 30000,
  },
});
