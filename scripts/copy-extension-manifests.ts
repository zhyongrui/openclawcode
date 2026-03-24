#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const verbose = process.env.OPENCLAW_BUILD_VERBOSE === "1";

const srcExtensions = path.join(projectRoot, "extensions");
const distExtensions = path.join(projectRoot, "dist", "extensions");
const MANIFEST_FILENAME = "openclaw.plugin.json";

function copyExtensionManifests(): void {
  if (!fs.existsSync(srcExtensions)) {
    console.warn("[copy-extension-manifests] Source directory not found:", srcExtensions);
    return;
  }

  if (!fs.existsSync(distExtensions)) {
    fs.mkdirSync(distExtensions, { recursive: true });
  }

  let copiedCount = 0;
  for (const entry of fs.readdirSync(srcExtensions, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const srcDir = path.join(srcExtensions, entry.name);
    const srcManifest = path.join(srcDir, MANIFEST_FILENAME);
    if (!fs.existsSync(srcManifest)) {
      continue;
    }

    const distDir = path.join(distExtensions, entry.name);
    fs.mkdirSync(distDir, { recursive: true });
    fs.copyFileSync(srcManifest, path.join(distDir, MANIFEST_FILENAME));
    copiedCount += 1;

    if (verbose) {
      console.log(`[copy-extension-manifests] Copied ${entry.name}/${MANIFEST_FILENAME}`);
    }
  }

  console.log(`[copy-extension-manifests] Copied ${copiedCount} extension manifest files.`);
}

copyExtensionManifests();
