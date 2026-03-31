import { describe, expect, it } from "vitest";
import {
  BUNDLED_RUNTIME_SIDECAR_BASENAMES,
  GUARDED_EXTENSION_PUBLIC_SURFACE_BASENAMES,
} from "./public-artifacts.js";

describe("public artifact guards", () => {
  it("deduplicates guarded basenames contributed by bundled runtime sidecars", () => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const basename of GUARDED_EXTENSION_PUBLIC_SURFACE_BASENAMES) {
      if (seen.has(basename)) {
        duplicates.add(basename);
        continue;
      }
      seen.add(basename);
    }

    expect(duplicates).toEqual(new Set());
    expect(BUNDLED_RUNTIME_SIDECAR_BASENAMES).toContain("action-runtime.runtime.js");
    expect(GUARDED_EXTENSION_PUBLIC_SURFACE_BASENAMES).toContain("action-runtime.runtime.js");
  });
});
