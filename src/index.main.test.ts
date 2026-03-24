import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isMainModuleMock = vi.hoisted(() => vi.fn(() => true));
const runCliMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("./infra/is-main.js", () => ({
  isMainModule: isMainModuleMock,
}));

vi.mock("./cli/run-main.js", () => ({
  runCli: runCliMock,
}));

describe("index main entry", () => {
  let originalArgv: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalArgv = [...process.argv];
    process.argv = ["node", "dist/index.js", "gateway", "run"];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("delegates main execution to runCli", async () => {
    isMainModuleMock.mockReturnValueOnce(true);

    await import("./index.js");

    await vi.waitFor(() => {
      expect(runCliMock).toHaveBeenCalledWith(process.argv);
    });
  });

  it("skips runCli when imported as a library module", async () => {
    isMainModuleMock.mockReturnValueOnce(false);

    await import("./index.js");

    expect(runCliMock).not.toHaveBeenCalled();
  });
});
