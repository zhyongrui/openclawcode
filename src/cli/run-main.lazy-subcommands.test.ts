import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tryRouteCliMock = vi.hoisted(() => vi.fn(async () => false));
const loadDotEnvMock = vi.hoisted(() => vi.fn());
const normalizeEnvMock = vi.hoisted(() => vi.fn());
const ensurePathMock = vi.hoisted(() => vi.fn());
const assertRuntimeMock = vi.hoisted(() => vi.fn());
const closeAllMemorySearchManagersMock = vi.hoisted(() => vi.fn(async () => {}));
const parseCliProfileArgsMock = vi.hoisted(() => vi.fn((argv: string[]) => ({ ok: true, argv })));
const normalizeWindowsArgvMock = vi.hoisted(() => vi.fn((argv: string[]) => argv));
const buildProgramMock = vi.hoisted(() => vi.fn());
const getProgramContextMock = vi.hoisted(() => vi.fn(() => ({ programVersion: "test" })));
const registerCoreCliByNameMock = vi.hoisted(() => vi.fn(async () => false));
const awaitPendingSubCliRegistrationsMock = vi.hoisted(() =>
  vi.fn(async (_program: Command) => {}),
);
const registerSubCliByNameMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("./route.js", () => ({
  tryRouteCli: tryRouteCliMock,
}));

vi.mock("../infra/dotenv.js", () => ({
  loadDotEnv: loadDotEnvMock,
}));

vi.mock("../infra/env.js", () => ({
  normalizeEnv: normalizeEnvMock,
}));

vi.mock("../infra/path-env.js", () => ({
  ensureOpenClawCliOnPath: ensurePathMock,
}));

vi.mock("../infra/runtime-guard.js", () => ({
  assertSupportedRuntime: assertRuntimeMock,
}));

vi.mock("../memory/search-manager.js", () => ({
  closeAllMemorySearchManagers: closeAllMemorySearchManagersMock,
}));

vi.mock("./profile.js", () => ({
  applyCliProfileEnv: vi.fn(),
  parseCliProfileArgs: parseCliProfileArgsMock,
}));

vi.mock("./windows-argv.js", () => ({
  normalizeWindowsArgv: normalizeWindowsArgvMock,
}));

vi.mock("./program.js", () => ({
  buildProgram: buildProgramMock,
}));

vi.mock("./program/program-context.js", () => ({
  getProgramContext: getProgramContextMock,
}));

vi.mock("./program/command-registry.js", () => ({
  registerCoreCliByName: registerCoreCliByNameMock,
}));

vi.mock("./program/register.subclis.js", () => ({
  awaitPendingSubCliRegistrations: awaitPendingSubCliRegistrationsMock,
  loadValidatedConfigForPluginRegistration: vi.fn(async () => null),
  registerSubCliByName: registerSubCliByNameMock,
}));

const { runCli } = await import("./run-main.js");

describe("runCli with eager subcommand registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENCLAW_DISABLE_LAZY_SUBCOMMANDS;
  });

  it("does not re-register a subcli that eager registration already installed", async () => {
    process.env.OPENCLAW_DISABLE_LAZY_SUBCOMMANDS = "1";
    const program = new Command();
    const parseAsyncMock = vi.spyOn(program, "parseAsync").mockResolvedValue(program);
    buildProgramMock.mockReturnValue(program);
    awaitPendingSubCliRegistrationsMock.mockImplementationOnce(async (targetProgram: Command) => {
      targetProgram.command("gateway");
    });

    await runCli(["node", "openclaw", "gateway", "run"]);

    expect(awaitPendingSubCliRegistrationsMock).toHaveBeenCalledWith(program);
    expect(registerSubCliByNameMock).not.toHaveBeenCalled();
    expect(parseAsyncMock).toHaveBeenCalledWith(["node", "openclaw", "gateway", "run"]);
  });
});
