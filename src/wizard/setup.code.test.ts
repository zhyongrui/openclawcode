import * as fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWizardPrompter as buildWizardPrompter } from "../../test/helpers/wizard-prompter.js";
import {
  buildOnboardingRepoNameSuggestions,
  createOnboardingRepositoryViaGh,
  inspectOnboardingGitHubCliDeviceLogin,
  onboardingOpenClawCodeDeps,
  parseOnboardingRepositoryCreationInput,
  runOnboardingOpenClawCodeBootstrap,
  runOnboardingOpenClawCode,
  startOnboardingGitHubCliDeviceLogin,
  type ResolvedOnboardingGitHubToken,
} from "./setup.code.js";

describe("runOnboardingOpenClawCode", () => {
  beforeEach(() => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(() => null);
    onboardingOpenClawCodeDeps.fetchAuthenticatedViewer = vi.fn(
      async () => ({ login: "zhyongrui", name: "Zhongrui Ye", email: "zyr@example.com" }),
    );
    onboardingOpenClawCodeDeps.fetchRepositorySummary = vi.fn(async () => undefined);
    onboardingOpenClawCodeDeps.createRepository = vi.fn(
      async (_token, request) =>
        ({
          owner: request.owner ?? "zhyongrui",
          repo: request.name,
          private: request.private !== false,
          url: `https://github.com/${request.owner ?? "zhyongrui"}/${request.name}`,
        }) as never,
    );
    onboardingOpenClawCodeDeps.bootstrapRepository = vi.fn(async (_opts, runtime) => {
      runtime.log(
        JSON.stringify({
          repo: {
            owner: "zhyongrui",
            repo: "iGallery",
            repoRoot: "/home/zyr/pros/iGallery",
            checkoutAction: "cloned",
          },
          blueprint: {
            blueprintPath: "/home/zyr/pros/iGallery/PROJECT-BLUEPRINT.md",
          },
          config: {
            blueprintFirstBootstrap: true,
          },
          handoff: {
            cliRunCommand:
              "openclaw code run --issue <issue-number> --owner zhyongrui --repo iGallery",
          },
          nextAction: "start-or-restart-live-gateway",
        }),
      );
    });
    onboardingOpenClawCodeDeps.mkdir = vi.fn(
      async (target, options) => await fsPromises.mkdir(target, options),
    );
    onboardingOpenClawCodeDeps.openTextFile = vi.fn(
      async (target, flags) => await fsPromises.open(target, flags),
    );
    onboardingOpenClawCodeDeps.readTextFile = vi.fn(
      async (target) => await fsPromises.readFile(target, "utf8"),
    );
    onboardingOpenClawCodeDeps.sleep = vi.fn(async () => {});
    onboardingOpenClawCodeDeps.isGitHubCliProcessRunning = vi.fn(() => true);
    onboardingOpenClawCodeDeps.spawnGitHubCliCommand = vi.fn(() => {
      throw new Error("spawnGitHubCliCommand not stubbed");
    }) as never;
    onboardingOpenClawCodeDeps.runGitHubCliCommand = vi.fn(() => {
      throw new Error("runGitHubCliCommand not stubbed");
    }) as never;
  });

  it("shows chat-first auth guidance when GitHub auth is missing", async () => {
    const note = vi.fn(async () => {});
    const prompter = buildWizardPrompter({
      note,
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    const noteCalls = note.mock.calls as unknown as Array<[string, string?]>;
    expect(noteCalls.some((call) => call[1] === "OpenClaw Code")).toBe(true);
    expect(noteCalls.at(-1)?.[0]).toContain("/occode-setup");
    expect(noteCalls.at(-1)?.[0]).toContain("/occ-setup");
    expect(noteCalls.at(-1)?.[0]).toContain("gh auth login");
    expect(noteCalls.at(-1)?.[0]).toContain("OpenClaw will launch GitHub device auth for you");
  });

  it("creates and bootstraps a new repo with a placeholder empty-repo test command", async () => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
      () =>
        ({
          token: "gho_test",
          source: "GH_TOKEN",
        }) satisfies ResolvedOnboardingGitHubToken,
    );
    const note = vi.fn(async () => {});
    const progressStop = vi.fn();
    const progressUpdate = vi.fn();
    const prompter = buildWizardPrompter({
      note,
      select: vi.fn(async (params: { message: string }) => {
        if (params.message === "GitHub account for OpenClaw Code") {
          return "use-existing";
        }
        if (params.message === "OpenClaw Code repo setup") {
          return "new";
        }
        return "later";
      }) as never,
      text: vi.fn(async (params: { message: string }) => {
        if (params.message === "New GitHub repository name") {
          return "iGallery";
        }
        return "";
      }),
      confirm: vi.fn(async (params: { message: string }) => {
        if (params.message === "Create and bootstrap zhyongrui/iGallery now?") {
          return true;
        }
        return false;
      }),
      progress: vi.fn(() => ({ update: progressUpdate, stop: progressStop })),
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    const noteCalls = note.mock.calls as unknown as Array<[string, string?]>;
    const accountNote = noteCalls.find((call) => call[1] === "GitHub account");
    expect(accountNote?.[0]).toContain("GitHub username: zhyongrui");
    expect(accountNote?.[0]).toContain("Name: Zhongrui Ye");
    expect(accountNote?.[0]).toContain("Email: zyr@example.com");
    expect(accountNote?.[0]).toContain("Auth source: GH_TOKEN env var");
    const executionNote = noteCalls.find((call) => call[1] === "OpenClaw Code execution");
    expect(executionNote?.[0]).toContain("Target repo: zhyongrui/iGallery");
    expect(executionNote?.[0]).toContain("Effect: create the repo on GitHub, then run bootstrap locally.");
    expect(onboardingOpenClawCodeDeps.createRepository).toHaveBeenCalledWith("gho_test", {
      owner: "zhyongrui",
      name: "iGallery",
      private: true,
    });
    expect(onboardingOpenClawCodeDeps.bootstrapRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "zhyongrui/iGallery",
        mode: "auto",
        json: true,
      }),
      expect.any(Object),
    );
    const readyNote = noteCalls.find((call) => call[1] === "OpenClaw Code repo ready");
    expect(readyNote?.[0]).toContain("Created repo: zhyongrui/iGallery");
    expect(readyNote?.[0]).toContain("PROJECT-BLUEPRINT.md");
    expect(readyNote?.[0]).toContain("blueprint-first startup mode");
    expect(progressUpdate).toHaveBeenCalled();
    expect(progressStop).toHaveBeenCalled();
  });

  it("bootstraps an existing repo from a bare repo name under the authenticated owner", async () => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
      () =>
        ({
          token: "gho_test",
          source: "gh-auth-token",
        }) satisfies ResolvedOnboardingGitHubToken,
    );
    onboardingOpenClawCodeDeps.fetchRepositorySummary = vi.fn(async (_token, repoRef) => ({
      owner: repoRef.owner,
      repo: repoRef.repo,
      private: true,
      url: `https://github.com/${repoRef.owner}/${repoRef.repo}`,
    }));
    const note = vi.fn(async () => {});
    const prompter = buildWizardPrompter({
      note,
      select: vi.fn(async (params: { message: string }) => {
        if (params.message === "GitHub account for OpenClaw Code") {
          return "use-existing";
        }
        if (params.message === "OpenClaw Code repo setup") {
          return "existing";
        }
        return "later";
      }) as never,
      text: vi.fn(async () => "iGallery"),
      confirm: vi.fn(async (params: { message: string }) => {
        if (params.message === "Bootstrap zhyongrui/iGallery now?") {
          return true;
        }
        return false;
      }),
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    expect(onboardingOpenClawCodeDeps.fetchRepositorySummary).toHaveBeenCalledWith("gho_test", {
      owner: "zhyongrui",
      repo: "iGallery",
    });
    expect(onboardingOpenClawCodeDeps.bootstrapRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "zhyongrui/iGallery",
        mode: "auto",
        json: true,
      }),
      expect.any(Object),
    );
  });

  it("stops before repo creation when the new-repo execution confirmation is declined", async () => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
      () =>
        ({
          token: "gho_test",
          source: "GH_TOKEN",
        }) satisfies ResolvedOnboardingGitHubToken,
    );
    const note = vi.fn(async () => {});
    const prompter = buildWizardPrompter({
      note,
      select: vi.fn(async (params: { message: string }) => {
        if (params.message === "GitHub account for OpenClaw Code") {
          return "use-existing";
        }
        if (params.message === "OpenClaw Code repo setup") {
          return "new";
        }
        return "later";
      }) as never,
      text: vi.fn(async () => "iGallery"),
      confirm: vi.fn(async () => false),
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    expect(onboardingOpenClawCodeDeps.createRepository).not.toHaveBeenCalled();
    expect(onboardingOpenClawCodeDeps.bootstrapRepository).not.toHaveBeenCalled();
    const noteCalls = note.mock.calls as unknown as Array<[string, string?]>;
    const finalOpenClawCodeNote = noteCalls.filter((call) => call[1] === "OpenClaw Code").at(-1);
    expect(finalOpenClawCodeNote?.[0]).toContain("Skipped creating zhyongrui/iGallery.");
    expect(finalOpenClawCodeNote?.[0]).toContain("/occode-setup");
  });

  it("stops before bootstrapping an existing repo when execution confirmation is declined", async () => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
      () =>
        ({
          token: "gho_test",
          source: "gh-auth-token",
        }) satisfies ResolvedOnboardingGitHubToken,
    );
    const note = vi.fn(async () => {});
    const prompter = buildWizardPrompter({
      note,
      select: vi.fn(async (params: { message: string }) => {
        if (params.message === "GitHub account for OpenClaw Code") {
          return "use-existing";
        }
        if (params.message === "OpenClaw Code repo setup") {
          return "existing";
        }
        return "later";
      }) as never,
      text: vi.fn(async () => "iGallery"),
      confirm: vi.fn(async () => false),
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    expect(onboardingOpenClawCodeDeps.bootstrapRepository).not.toHaveBeenCalled();
    const noteCalls = note.mock.calls as unknown as Array<[string, string?]>;
    const finalOpenClawCodeNote = noteCalls.filter((call) => call[1] === "OpenClaw Code").at(-1);
    expect(finalOpenClawCodeNote?.[0]).toContain("Skipped bootstrapping zhyongrui/iGallery.");
    expect(finalOpenClawCodeNote?.[0]).toContain("openclaw code bootstrap --repo owner/repo --json");
  });

  it("shows explicit chat and cli handoff when repo setup is skipped", async () => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
      () =>
        ({
          token: "gho_test",
          source: "gh-auth-token",
        }) satisfies ResolvedOnboardingGitHubToken,
    );
    const note = vi.fn(async () => {});
    const prompter = buildWizardPrompter({
      note,
      select: vi.fn(async (params: { message: string }) => {
        if (params.message === "GitHub account for OpenClaw Code") {
          return "use-existing";
        }
        if (params.message === "OpenClaw Code repo setup") {
          return "skip";
        }
        return "later";
      }) as never,
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    const noteCalls = note.mock.calls as unknown as Array<[string, string?]>;
    const finalOpenClawCodeNote = noteCalls.filter((call) => call[1] === "OpenClaw Code").at(-1);
    expect(finalOpenClawCodeNote?.[0]).toContain("You can come back to OpenClaw Code later from either surface:");
    expect(finalOpenClawCodeNote?.[0]).toContain("/occode-setup");
    expect(finalOpenClawCodeNote?.[0]).toContain("/occ-setup");
    expect(finalOpenClawCodeNote?.[0]).toContain("/occode-setup existing owner/repo");
    expect(finalOpenClawCodeNote?.[0]).toContain("/occ-setup existing owner/repo");
    expect(finalOpenClawCodeNote?.[0]).toContain(
      "openclaw code bootstrap --repo owner/repo --json",
    );
  });

  it("can sign out and re-run gh auth login before repo setup", async () => {
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi
      .fn<() => ResolvedOnboardingGitHubToken | null>()
      .mockReturnValueOnce({
        token: "gho_old",
        source: "gh-auth-token",
      })
      .mockReturnValueOnce({
        token: "gho_new",
        source: "gh-auth-token",
      });
    onboardingOpenClawCodeDeps.fetchAuthenticatedViewer = vi
      .fn()
      .mockResolvedValueOnce({
        login: "wrong-account",
        name: "Wrong User",
        email: "wrong@example.com",
      })
      .mockResolvedValueOnce({
        login: "right-account",
        name: "Right User",
        email: "right@example.com",
      });
    onboardingOpenClawCodeDeps.runGitHubCliCommand = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
        stderr: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
        stderr: "",
      }) as never;
    const note = vi.fn(async () => {});
    const prompter = buildWizardPrompter({
      note,
      select: vi
        .fn(async (params: { message: string }) => {
          if (params.message === "GitHub account for OpenClaw Code") {
            const accountPromptCount = (
              prompter.select as unknown as ReturnType<typeof vi.fn>
            ).mock.calls.filter((call) => call[0]?.message === "GitHub account for OpenClaw Code")
              .length;
            return accountPromptCount === 1 ? "switch-account" : "use-existing";
          }
          if (params.message === "OpenClaw Code repo setup") {
            return "skip";
          }
          return "later";
        }) as never,
      confirm: vi.fn(async () => true),
    });

    await runOnboardingOpenClawCode({
      prompter,
    });

    expect(onboardingOpenClawCodeDeps.runGitHubCliCommand).toHaveBeenNthCalledWith(
      1,
      ["auth", "logout", "--hostname", "github.com", "--user", "wrong-account"],
      expect.objectContaining({
        stdio: "inherit",
      }),
    );
    expect(onboardingOpenClawCodeDeps.runGitHubCliCommand).toHaveBeenNthCalledWith(
      2,
      ["auth", "login", "--hostname", "github.com", "--web"],
      expect.objectContaining({
        stdio: "inherit",
      }),
    );
    const noteCalls = note.mock.calls as unknown as Array<[string, string?]>;
    const finalOpenClawCodeNote = noteCalls.filter((call) => call[1] === "OpenClaw Code").at(-1);
    expect(finalOpenClawCodeNote?.[0]).toContain("GitHub username: right-account");
    expect(finalOpenClawCodeNote?.[0]).toContain("/occode-setup");
    expect(finalOpenClawCodeNote?.[0]).toContain(
      "openclaw code bootstrap --repo owner/repo --json",
    );
  });

  it("starts gh auth login, captures the device code, and primes the browser prompt", async () => {
    const stateDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "openclawcode-gh-auth-"));
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    const unref = vi.fn();
    onboardingOpenClawCodeDeps.spawnGitHubCliCommand = vi.fn((_args, options) => {
      const stdoutFd = options.stdio?.[1];
      if (typeof stdoutFd !== "number") {
        throw new Error("stdout fd missing");
      }
      fs.writeFileSync(
        stdoutFd,
        [
          "First copy your one-time code: ABCD-EFGH",
          "Press Enter to open https://github.com/login/device in your browser...",
        ].join("\n"),
        "utf8",
      );
      return {
        pid: 321,
        stdin: {
          write: stdinWrite,
          end: stdinEnd,
        },
        unref,
      } as never;
    }) as never;

    try {
      const started = await startOnboardingGitHubCliDeviceLogin({
        stateDir,
      });

      expect(started).toMatchObject({
        pid: 321,
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device",
      });
      expect(onboardingOpenClawCodeDeps.spawnGitHubCliCommand).toHaveBeenCalledWith(
        expect.arrayContaining(["auth", "login", "--web"]),
        expect.objectContaining({
          detached: true,
        }),
      );
      expect(stdinWrite).toHaveBeenCalledWith("\n");
      expect(stdinEnd).toHaveBeenCalled();
      expect(unref).toHaveBeenCalled();
    } finally {
      await fsPromises.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("reports pending and authorized GitHub device login states", async () => {
    const rootDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "openclawcode-gh-auth-state-"),
    );
    const logPath = path.join(rootDir, "gh-auth.log");
    await fsPromises.writeFile(
      logPath,
      [
        "First copy your one-time code: WXYZ-1234",
        "Press Enter to open https://github.com/login/device in your browser...",
      ].join("\n"),
      "utf8",
    );
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(() => null);
    onboardingOpenClawCodeDeps.isGitHubCliProcessRunning = vi.fn(() => true);

    try {
      expect(
        await inspectOnboardingGitHubCliDeviceLogin({
          pid: 999,
          logPath,
          startedAt: "2026-03-19T02:10:00.000Z",
        }),
      ).toMatchObject({
        state: "pending",
        userCode: "WXYZ-1234",
        verificationUri: "https://github.com/login/device",
      });

      onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
        () =>
          ({
            token: "gho_test",
            source: "gh-auth-token",
          }) satisfies ResolvedOnboardingGitHubToken,
      );

      expect(
        await inspectOnboardingGitHubCliDeviceLogin({
          pid: 999,
          logPath,
          startedAt: "2026-03-19T02:10:00.000Z",
        }),
      ).toMatchObject({
        state: "authorized",
        source: "gh-auth-token",
        userCode: "WXYZ-1234",
      });
    } finally {
      await fsPromises.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("parses new-repo input with either repo-name or owner/repo", () => {
    expect(parseOnboardingRepositoryCreationInput("iGallery", "zhyongrui")).toEqual({
      owner: "zhyongrui",
      repo: "iGallery",
    });
    expect(parseOnboardingRepositoryCreationInput("acme/iGallery", "zhyongrui")).toEqual({
      owner: "acme",
      repo: "iGallery",
    });
  });

  it("builds deterministic repo-name suggestions from project text", () => {
    expect(buildOnboardingRepoNameSuggestions("Shared image gallery for family albums")).toEqual([
      "shared-image-gallery-family",
      "shared-image-gallery-family-app",
      "shared-image-gallery-family-web",
      "shared-image-gallery-family-service",
      "shared-image-gallery-family-workspace",
    ]);
  });

  it("creates a repo through gh and refreshes the GitHub summary", async () => {
    onboardingOpenClawCodeDeps.runGitHubCliCommand = vi.fn(
      () =>
        ({
          status: 0,
          stdout: "https://github.com/zhyongrui/iGallery",
          stderr: "",
        }) as never,
    );
    onboardingOpenClawCodeDeps.resolveGitHubToken = vi.fn(
      () =>
        ({
          token: "gho_test",
          source: "gh-auth-token",
        }) satisfies ResolvedOnboardingGitHubToken,
    );
    onboardingOpenClawCodeDeps.fetchRepositorySummary = vi.fn(async (_token, repoRef) => ({
      owner: repoRef.owner,
      repo: repoRef.repo,
      private: true,
      url: `https://github.com/${repoRef.owner}/${repoRef.repo}`,
    }));

    await expect(
      createOnboardingRepositoryViaGh({
        owner: "zhyongrui",
        repo: "iGallery",
      }),
    ).resolves.toMatchObject({
      owner: "zhyongrui",
      repo: "iGallery",
      url: "https://github.com/zhyongrui/iGallery",
    });

    expect(onboardingOpenClawCodeDeps.runGitHubCliCommand).toHaveBeenCalledWith(
      ["repo", "create", "zhyongrui/iGallery", "--private", "--clone=false"],
      expect.objectContaining({
        encoding: "utf8",
      }),
    );
  });

  it("surfaces gh repo create failures", async () => {
    onboardingOpenClawCodeDeps.runGitHubCliCommand = vi.fn(
      () =>
        ({
          status: 1,
          stdout: "",
          stderr: "name already exists",
        }) as never,
    );

    await expect(
      createOnboardingRepositoryViaGh({
        owner: "zhyongrui",
        repo: "iGallery",
      }),
    ).rejects.toThrow("name already exists");
  });

  it("captures bootstrap JSON for chat-native setup flows", async () => {
    onboardingOpenClawCodeDeps.bootstrapRepository = vi.fn(async (_opts, runtime) => {
      runtime.log(
        JSON.stringify({
          repo: {
            owner: "zhyongrui",
            repo: "iGallery",
            repoKey: "zhyongrui/iGallery",
            repoRoot: "/home/zyr/pros/iGallery",
            checkoutAction: "cloned",
          },
          blueprint: {
            blueprintPath: "/home/zyr/pros/iGallery/PROJECT-BLUEPRINT.md",
            status: "clarified",
            revisionId: "rev-2",
          },
          handoff: {
            blueprintCommand: "/occode-blueprint zhyongrui/iGallery",
            cliRunCommand:
              "openclaw code run --issue <issue-number> --owner zhyongrui --repo iGallery",
          },
          nextAction: "clarify-project-blueprint",
        }),
      );
    });

    await expect(
      runOnboardingOpenClawCodeBootstrap({
        repo: "zhyongrui/iGallery",
      }),
    ).resolves.toMatchObject({
      repo: {
        repoKey: "zhyongrui/iGallery",
      },
      blueprint: {
        status: "clarified",
      },
      handoff: {
        blueprintCommand: "/occode-blueprint zhyongrui/iGallery",
      },
      nextAction: "clarify-project-blueprint",
    });
  });
});
