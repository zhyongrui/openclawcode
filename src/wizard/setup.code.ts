import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawCodeBootstrapOpts } from "../commands/openclawcode.js";
import type {
  CreateRepositoryRequest,
  GitHubAuthenticatedViewer,
  GitHubRepositorySummary,
  RepoRef,
} from "../openclawcode/github/client.js";
import { GitHubRestClient } from "../openclawcode/github/client.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";

export type OnboardingGitHubAuthState =
  | { available: true; source: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token" }
  | { available: false };

export type ResolvedOnboardingGitHubToken = {
  token: string;
  source: "GH_TOKEN" | "GITHUB_TOKEN" | "gh-auth-token";
};

export type OnboardingGitHubCliDeviceLoginSession = {
  pid?: number;
  logPath: string;
  userCode?: string;
  verificationUri?: string;
  startedAt: string;
  completedAt?: string;
  failureReason?: string;
};

export type OnboardingGitHubCliDeviceLoginStartResult = Required<
  Pick<OnboardingGitHubCliDeviceLoginSession, "pid" | "logPath" | "userCode" | "verificationUri">
> &
  Pick<OnboardingGitHubCliDeviceLoginSession, "startedAt">;

export type OnboardingGitHubCliDeviceLoginStatus =
  | {
      state: "pending";
      running: boolean;
      userCode: string;
      verificationUri: string;
      startedAt: string;
      logTail?: string;
    }
  | {
      state: "authorized";
      running: boolean;
      source: ResolvedOnboardingGitHubToken["source"];
      userCode?: string;
      verificationUri?: string;
      startedAt: string;
      completedAt: string;
    }
  | {
      state: "failed";
      running: boolean;
      reason: string;
      userCode?: string;
      verificationUri?: string;
      startedAt: string;
      completedAt?: string;
      logTail?: string;
    };

export type OnboardingProjectMode = "existing-repo" | "new-project";

export type OnboardingBootstrapSummary = {
  repo?: {
    owner?: string;
    repo?: string;
    repoKey?: string;
    repoRoot?: string;
    checkoutAction?: string;
  };
  blueprint?: {
    blueprintPath?: string;
    status?: string;
    revisionId?: string;
  };
  config?: {
    blueprintFirstBootstrap?: boolean;
  };
  pluginActivation?: {
    ready?: boolean;
    pluginsEnabled?: boolean;
    allowlisted?: boolean;
    entryEnabled?: boolean;
  };
  proofReadiness?: {
    cliProofReady?: boolean;
    chatProofReady?: boolean;
    chatSetupRoutingReady?: boolean;
    webhookReady?: boolean;
    webhookUrlReady?: boolean;
    needsChatBind?: boolean;
    needsPublicWebhookUrl?: boolean;
    recommendedProofMode?: "cli-only" | "chatops";
  };
  handoff?: {
    recommendedProofMode?: "cli-only" | "chatops";
    reason?: string;
    cliRunCommand?: string | null;
    blueprintCommand?: string | null;
    blueprintClarifyCommand?: string | null;
    blueprintAgreeCommand?: string | null;
    blueprintDecomposeCommand?: string | null;
    gatesCommand?: string | null;
    gatewayRestartCommand?: string | null;
    pluginActivationRepairCommand?: string | null;
    chatSetupCommand?: string | null;
    chatSetupStatusCommand?: string | null;
    chatBindCommand?: string | null;
    chatStartCommand?: string | null;
    webhookRetryCommand?: string | null;
  };
  nextAction?: string;
};

type OpenClawCodeOnboardingChoice = "new" | "existing" | "skip";

const DEFAULT_GITHUB_DEVICE_VERIFICATION_URI = "https://github.com/login/device";
const GITHUB_DEVICE_CODE_PATTERN = /one-time code:\s*([A-Z0-9-]+)/i;
const GITHUB_DEVICE_URI_PATTERN = /(https:\/\/github\.com\/login\/device)/i;

function extractGitHubCliDeviceLoginDetails(output: string): {
  userCode?: string;
  verificationUri?: string;
} {
  const userCode = output.match(GITHUB_DEVICE_CODE_PATTERN)?.[1]?.trim();
  const verificationUri =
    output.match(GITHUB_DEVICE_URI_PATTERN)?.[1]?.trim() ??
    (userCode ? DEFAULT_GITHUB_DEVICE_VERIFICATION_URI : undefined);
  return {
    userCode,
    verificationUri,
  };
}

function tailMultilineText(value: string, maxLines = 6): string | undefined {
  const lines = value
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) {
    return undefined;
  }
  return lines.slice(-maxLines).join("\n");
}

function buildBootstrapRepairGuidanceLines(payload: OnboardingBootstrapSummary): string[] {
  if (
    payload.pluginActivation?.ready !== false &&
    payload.proofReadiness?.chatSetupRoutingReady !== false &&
    payload.nextAction !== "repair-plugin-activation"
  ) {
    return [];
  }

  return [
    payload.handoff?.pluginActivationRepairCommand
      ? `Repair: ${payload.handoff.pluginActivationRepairCommand}`
      : undefined,
    payload.handoff?.chatSetupStatusCommand
      ? `Chat retry: ${payload.handoff.chatSetupStatusCommand}`
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));
}

function isProcessRunning(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || !pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function waitForGitHubCliDeviceChallenge(
  logPath: string,
  timeoutMs = 5_000,
): Promise<{ userCode: string; verificationUri: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = await onboardingOpenClawCodeDeps.readTextFile(logPath).catch(() => "");
    const challenge = extractGitHubCliDeviceLoginDetails(output);
    if (challenge.userCode) {
      return {
        userCode: challenge.userCode,
        verificationUri: challenge.verificationUri ?? DEFAULT_GITHUB_DEVICE_VERIFICATION_URI,
      };
    }
    await onboardingOpenClawCodeDeps.sleep(150);
  }
  const output = await onboardingOpenClawCodeDeps.readTextFile(logPath).catch(() => "");
  throw new Error(
    [
      "gh auth login started but no GitHub device-flow code was captured.",
      tailMultilineText(output) ? `Last output:\n${tailMultilineText(output)}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function resolveOnboardingGitHubToken(): ResolvedOnboardingGitHubToken | null {
  const ghToken = process.env.GH_TOKEN?.trim();
  if (ghToken) {
    return { token: ghToken, source: "GH_TOKEN" };
  }

  const githubToken = process.env.GITHUB_TOKEN?.trim();
  if (githubToken) {
    return { token: githubToken, source: "GITHUB_TOKEN" };
  }

  const result = childProcess.spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    const token = result.stdout.trim();
    if (token) {
      return { token, source: "gh-auth-token" };
    }
  }

  return null;
}

export function resolveOnboardingGitHubAuthState(): OnboardingGitHubAuthState {
  const resolved = resolveOnboardingGitHubToken();
  if (!resolved) {
    return { available: false };
  }
  return {
    available: true,
    source: resolved.source,
  };
}

export async function startOnboardingGitHubCliDeviceLogin(params: {
  stateDir: string;
}): Promise<OnboardingGitHubCliDeviceLoginStartResult> {
  const logDir = path.join(params.stateDir, "plugins", "openclawcode", "setup");
  await onboardingOpenClawCodeDeps.mkdir(logDir, { recursive: true });
  const logPath = path.join(
    logDir,
    `gh-auth-login-${Date.now()}-${Math.random().toString(16).slice(2)}.log`,
  );
  const logFile = await onboardingOpenClawCodeDeps.openTextFile(logPath, "a");
  try {
    const child = onboardingOpenClawCodeDeps.spawnGitHubCliCommand(
      [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--web",
        "--skip-ssh-key",
      ],
      {
        detached: true,
        stdio: ["pipe", logFile.fd, logFile.fd],
      },
    );
    child.stdin?.write("\n");
    child.stdin?.end();
    child.unref?.();
    const pid = child.pid;
    if (!Number.isInteger(pid) || !pid) {
      throw new Error("gh auth login started without a valid process id.");
    }
    const challenge = await waitForGitHubCliDeviceChallenge(logPath);
    return {
      pid,
      logPath,
      userCode: challenge.userCode,
      verificationUri: challenge.verificationUri,
      startedAt: new Date().toISOString(),
    };
  } finally {
    await logFile.close();
  }
}

export async function inspectOnboardingGitHubCliDeviceLogin(
  session: OnboardingGitHubCliDeviceLoginSession,
): Promise<OnboardingGitHubCliDeviceLoginStatus> {
  const resolvedToken = onboardingOpenClawCodeDeps.resolveGitHubToken();
  const output = await onboardingOpenClawCodeDeps.readTextFile(session.logPath).catch(() => "");
  const details = extractGitHubCliDeviceLoginDetails(output);
  const userCode = details.userCode ?? session.userCode;
  const verificationUri =
    details.verificationUri ?? session.verificationUri ?? DEFAULT_GITHUB_DEVICE_VERIFICATION_URI;
  const running = onboardingOpenClawCodeDeps.isGitHubCliProcessRunning(session.pid);
  if (resolvedToken) {
    return {
      state: "authorized",
      running,
      source: resolvedToken.source,
      userCode,
      verificationUri,
      startedAt: session.startedAt,
      completedAt: session.completedAt ?? new Date().toISOString(),
    };
  }
  if (running && userCode) {
    return {
      state: "pending",
      running,
      userCode,
      verificationUri,
      startedAt: session.startedAt,
      logTail: tailMultilineText(output),
    };
  }
  return {
    state: "failed",
    running,
    reason:
      session.failureReason ??
      "GitHub device approval did not complete. Start a fresh session with /occode-setup.",
    userCode,
    verificationUri: userCode ? verificationUri : undefined,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    logTail: tailMultilineText(output),
  };
}

function validateNewRepositoryName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Repository name is required.";
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return "Use only letters, numbers, dots, underscores, or hyphens.";
  }
  if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    return "Repository name cannot start or end with a dot.";
  }
  return undefined;
}

function slugifyOnboardingRepoNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildOnboardingRepoNameSuggestions(projectText: string): string[] {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "app",
    "application",
    "build",
    "for",
    "in",
    "of",
    "platform",
    "project",
    "service",
    "system",
    "the",
    "to",
    "tool",
  ]);
  const rawWords = projectText
    .split(/[^A-Za-z0-9]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const words = rawWords.filter((entry) => !stopWords.has(entry));
  const seedWords = (words.length > 0 ? words : rawWords).slice(0, 4);
  const base = slugifyOnboardingRepoNamePart(seedWords.join("-")) || "new-project";
  const suggestions = [base];
  const suffixes = ["app", "web", "service", "workspace"];
  for (const suffix of suffixes) {
    if (!base.endsWith(`-${suffix}`) && base !== suffix) {
      suggestions.push(`${base}-${suffix}`);
    }
  }
  return [...new Set(suggestions)].slice(0, 5);
}

function parseExistingRepositoryInput(value: string, owner: string): RepoRef {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Repository is required.");
  }
  if (trimmed.includes("/")) {
    const [parsedOwner, parsedRepo, ...rest] = trimmed.split("/");
    if (rest.length > 0 || !parsedOwner?.trim() || !parsedRepo?.trim()) {
      throw new Error("Use owner/repo when entering a full repository reference.");
    }
    return {
      owner: parsedOwner.trim(),
      repo: parsedRepo.trim(),
    };
  }
  return {
    owner,
    repo: trimmed,
  };
}

export function parseOnboardingRepositoryCreationInput(value: string, owner: string): RepoRef {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Repository name is required.");
  }
  if (trimmed.includes("/")) {
    const [parsedOwner, parsedRepo, ...rest] = trimmed.split("/");
    if (rest.length > 0 || !parsedOwner?.trim() || !parsedRepo?.trim()) {
      throw new Error("Use owner/repo when entering a full repository reference.");
    }
    const validation = validateNewRepositoryName(parsedRepo);
    if (validation) {
      throw new Error(validation);
    }
    return {
      owner: parsedOwner.trim(),
      repo: parsedRepo.trim(),
    };
  }
  const validation = validateNewRepositoryName(trimmed);
  if (validation) {
    throw new Error(validation);
  }
  return {
    owner,
    repo: trimmed,
  };
}

async function fetchRepositorySummary(
  token: string,
  repoRef: RepoRef,
): Promise<GitHubRepositorySummary | undefined> {
  const response = await fetch(`https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub repo lookup failed: ${response.status} ${response.statusText} ${body}`);
  }
  const payload = (await response.json()) as {
    name?: string | null;
    private?: boolean | null;
    html_url?: string | null;
    description?: string | null;
    default_branch?: string | null;
    updated_at?: string | null;
    owner?: { login?: string | null } | null;
  };
  const owner = payload.owner?.login?.trim();
  const repo = payload.name?.trim();
  if (!owner || !repo) {
    throw new Error("GitHub repo lookup succeeded but owner/name were missing.");
  }
  return {
    owner,
    repo,
    description: payload.description ?? undefined,
    private: payload.private !== false,
    defaultBranch:
      typeof payload.default_branch === "string" ? payload.default_branch : undefined,
    url: payload.html_url?.trim() || `https://github.com/${owner}/${repo}`,
    updatedAt: typeof payload.updated_at === "string" ? payload.updated_at : undefined,
  };
}

export async function createOnboardingRepositoryViaGh(params: {
  owner: string;
  repo: string;
  visibility?: "private" | "public";
}): Promise<GitHubRepositorySummary> {
  const visibility = params.visibility ?? "private";
  const result = onboardingOpenClawCodeDeps.runGitHubCliCommand(
    [
      "repo",
      "create",
      `${params.owner}/${params.repo}`,
      visibility === "public" ? "--public" : "--private",
      "--clone=false",
    ],
    {
      encoding: "utf8",
    },
  );
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (result.status !== 0) {
    throw new Error(
      [
        `gh repo create failed for ${params.owner}/${params.repo}.`,
        stderr || stdout || "No error output was returned.",
      ].join("\n"),
    );
  }
  const token = onboardingOpenClawCodeDeps.resolveGitHubToken();
  if (token) {
    const fetched = await onboardingOpenClawCodeDeps.fetchRepositorySummary(token.token, {
      owner: params.owner,
      repo: params.repo,
    });
    if (fetched) {
      return fetched;
    }
  }
  return {
    owner: params.owner,
    repo: params.repo,
    private: visibility !== "public",
    url: `https://github.com/${params.owner}/${params.repo}`,
  };
}

export const onboardingOpenClawCodeDeps = {
  resolveGitHubToken: resolveOnboardingGitHubToken,
  fetchAuthenticatedViewer: async (token: string): Promise<GitHubAuthenticatedViewer> =>
    new GitHubRestClient(token).fetchAuthenticatedViewer(),
  fetchRepositorySummary,
  createRepository: async (
    token: string,
    request: CreateRepositoryRequest,
  ): Promise<GitHubRepositorySummary> => new GitHubRestClient(token).createRepository(request),
  bootstrapRepository: async (
    opts: OpenClawCodeBootstrapOpts,
    runtime: RuntimeEnv,
  ): Promise<void> => {
    const { openclawCodeBootstrapCommand } = await import("../commands/openclawcode.js");
    await openclawCodeBootstrapCommand(opts, runtime);
  },
  mkdir: async (target: string, options?: Parameters<typeof fs.mkdir>[1]) =>
    await fs.mkdir(target, options),
  openTextFile: async (target: string, flags: Parameters<typeof fs.open>[1]) =>
    await fs.open(target, flags),
  readTextFile: async (target: string) => await fs.readFile(target, "utf8"),
  spawnGitHubCliCommand: (
    args: string[],
    options: childProcess.SpawnOptions,
  ): childProcess.ChildProcess => childProcess.spawn("gh", args, options),
  runGitHubCliCommand: (
    args: string[],
    options: childProcess.SpawnSyncOptions,
  ): childProcess.SpawnSyncReturns<string> =>
    childProcess.spawnSync("gh", args, {
      encoding: "utf8",
      ...options,
    }),
  sleep: async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms)),
  isGitHubCliProcessRunning: isProcessRunning,
};

async function runBootstrapWithCapturedJson(params: {
  repo: string;
  bootstrapOpts?: Partial<OpenClawCodeBootstrapOpts>;
}): Promise<OnboardingBootstrapSummary> {
  const logs: string[] = [];
  const captureRuntime: RuntimeEnv = {
    log: (...args) => {
      logs.push(args.map((arg) => String(arg)).join(" "));
    },
    error: (...args) => {
      logs.push(args.map((arg) => String(arg)).join(" "));
    },
    exit: (code) => {
      throw new Error(`Bootstrap exited with code ${code}.`);
    },
  };
  await onboardingOpenClawCodeDeps.bootstrapRepository(
    {
      repo: params.repo,
      mode: "auto",
      json: true,
      ...params.bootstrapOpts,
    },
    captureRuntime,
  );
  const raw = logs.join("\n").trim();
  if (!raw) {
    throw new Error("Bootstrap completed but returned no JSON summary.");
  }
  return JSON.parse(raw) as OnboardingBootstrapSummary;
}

export async function runOnboardingOpenClawCodeBootstrap(params: {
  repo: string;
  bootstrapOpts?: Partial<OpenClawCodeBootstrapOpts>;
}): Promise<OnboardingBootstrapSummary> {
  return await runBootstrapWithCapturedJson(params);
}

async function handleNewRepositorySetup(params: {
  token: ResolvedOnboardingGitHubToken;
  viewer: GitHubAuthenticatedViewer;
  prompter: WizardPrompter;
}): Promise<void> {
  const { token, viewer, prompter } = params;
  await prompter.note(
    [
      `Authenticated GitHub owner: ${viewer.login}`,
      "New repositories created from onboarding default to private visibility.",
    ].join("\n"),
    "OpenClaw Code",
  );

  while (true) {
    const repoName = await prompter.text({
      message: "New GitHub repository name",
      placeholder: "my-project",
      validate: validateNewRepositoryName,
    });
    const repoRef: RepoRef = {
      owner: viewer.login,
      repo: repoName.trim(),
    };

    const progress = prompter.progress("OpenClaw Code");
    let doneMessage = "OpenClaw Code step finished.";
    try {
      progress.update(`Checking ${repoRef.owner}/${repoRef.repo}…`);
      const existing = await onboardingOpenClawCodeDeps.fetchRepositorySummary(token.token, repoRef);
      if (existing) {
        await prompter.note(
          `${repoRef.owner}/${repoRef.repo} already exists. Enter a different repository name.`,
          "OpenClaw Code",
        );
        continue;
      }

      progress.update(`Creating ${repoRef.owner}/${repoRef.repo}…`);
      const created = await onboardingOpenClawCodeDeps.createRepository(token.token, {
        owner: repoRef.owner,
        name: repoRef.repo,
        private: true,
      });

      progress.update(`Bootstrapping ${created.owner}/${created.repo}…`);
      const payload = await runBootstrapWithCapturedJson({
        repo: `${created.owner}/${created.repo}`,
      });

      await prompter.note(
        [
          `Created repo: ${created.owner}/${created.repo}`,
          payload.repo?.repoRoot ? `Local path: ${payload.repo.repoRoot}` : undefined,
          payload.repo?.checkoutAction ? `Checkout: ${payload.repo.checkoutAction}` : undefined,
          payload.blueprint?.blueprintPath
            ? `Blueprint: ${payload.blueprint.blueprintPath}`
            : undefined,
          payload.pluginActivation
            ? `Plugin activation: ${payload.pluginActivation.ready ? "ready" : "blocked"}`
            : undefined,
          typeof payload.proofReadiness?.chatSetupRoutingReady === "boolean"
            ? `Chat routing: ${payload.proofReadiness.chatSetupRoutingReady ? "ready" : "blocked"}`
            : undefined,
          payload.config?.blueprintFirstBootstrap
            ? "Bootstrap detected an empty repo and entered blueprint-first startup mode."
            : undefined,
          ...buildBootstrapRepairGuidanceLines(payload),
          payload.handoff?.cliRunCommand ? `Next: ${payload.handoff.cliRunCommand}` : undefined,
          payload.nextAction ? `Status: ${payload.nextAction}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
        "OpenClaw Code repo ready",
      );
      doneMessage = "OpenClaw Code repo is ready.";
      return;
    } finally {
      progress.stop(doneMessage);
    }
  }
}

async function handleExistingRepositorySetup(params: {
  token: ResolvedOnboardingGitHubToken;
  viewer: GitHubAuthenticatedViewer;
  prompter: WizardPrompter;
}): Promise<void> {
  const { token, viewer, prompter } = params;
  while (true) {
    const repoInput = await prompter.text({
      message: "Existing GitHub repo (owner/repo or repo)",
      placeholder: `${viewer.login}/my-repo`,
      validate: (value) => {
        try {
          parseExistingRepositoryInput(value, viewer.login);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
    const repoRef = parseExistingRepositoryInput(repoInput, viewer.login);

    const progress = prompter.progress("OpenClaw Code");
    let doneMessage = "OpenClaw Code step finished.";
    try {
      progress.update(`Checking ${repoRef.owner}/${repoRef.repo}…`);
      const existing = await onboardingOpenClawCodeDeps.fetchRepositorySummary(token.token, repoRef);
      if (!existing) {
        await prompter.note(
          `${repoRef.owner}/${repoRef.repo} was not found or is not accessible with the current GitHub login.`,
          "OpenClaw Code",
        );
        continue;
      }

      progress.update(`Bootstrapping ${repoRef.owner}/${repoRef.repo}…`);
      const payload = await runBootstrapWithCapturedJson({
        repo: `${repoRef.owner}/${repoRef.repo}`,
      });

      await prompter.note(
        [
          `Repo: ${repoRef.owner}/${repoRef.repo}`,
          payload.repo?.repoRoot ? `Local path: ${payload.repo.repoRoot}` : undefined,
          payload.repo?.checkoutAction ? `Checkout: ${payload.repo.checkoutAction}` : undefined,
          payload.blueprint?.blueprintPath
            ? `Blueprint: ${payload.blueprint.blueprintPath}`
            : undefined,
          payload.pluginActivation
            ? `Plugin activation: ${payload.pluginActivation.ready ? "ready" : "blocked"}`
            : undefined,
          typeof payload.proofReadiness?.chatSetupRoutingReady === "boolean"
            ? `Chat routing: ${payload.proofReadiness.chatSetupRoutingReady ? "ready" : "blocked"}`
            : undefined,
          ...buildBootstrapRepairGuidanceLines(payload),
          payload.handoff?.cliRunCommand ? `Next: ${payload.handoff.cliRunCommand}` : undefined,
          payload.nextAction ? `Status: ${payload.nextAction}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
        "OpenClaw Code repo ready",
      );
      doneMessage = "OpenClaw Code repo is ready.";
      return;
    } finally {
      progress.stop(doneMessage);
    }
  }
}

export async function runOnboardingOpenClawCode(params: {
  prompter: WizardPrompter;
}): Promise<void> {
  const { prompter } = params;
  const resolvedToken = onboardingOpenClawCodeDeps.resolveGitHubToken();
  if (!resolvedToken) {
    await prompter.note(
      [
        "This build includes OpenClaw Code, but GitHub auth is not configured yet.",
        "If you already configured an OpenClaw chat surface and a concrete OpenClaw Code chat target, OpenClaw can now start setup there proactively.",
        "If that automatic kickoff does not arrive yet, ask OpenClaw there to start setup with:",
        `  ${formatCliCommand("/occode-setup")}`,
        "OpenClaw will launch GitHub device auth for you and continue setup in chat.",
        `CLI fallback: ${formatCliCommand("gh auth login")}`,
        "Then rerun onboarding or use OpenClaw Code later with:",
        `  ${formatCliCommand('openclaw code bootstrap --repo owner/repo --json')}`,
        "Docs: https://docs.openclaw.ai/cli/code",
      ].join("\n"),
      "OpenClaw Code",
    );
    return;
  }

  const viewer = await onboardingOpenClawCodeDeps.fetchAuthenticatedViewer(resolvedToken.token);
  const choice = await prompter.select<OpenClawCodeOnboardingChoice>({
    message: "OpenClaw Code repo setup",
    options: [
      { value: "new", label: "New repo" },
      { value: "existing", label: "Existing repo" },
      { value: "skip", label: "Skip for now" },
    ],
    initialValue: "skip",
  });

  if (choice === "skip") {
    await prompter.note(
      [
        `GitHub auth: ready via ${resolvedToken.source}.`,
        `Later: ${formatCliCommand("openclaw code bootstrap --repo owner/repo --json")}`,
        "Docs: https://docs.openclaw.ai/cli/code",
      ].join("\n"),
      "OpenClaw Code",
    );
    return;
  }

  if (choice === "new") {
    await handleNewRepositorySetup({
      token: resolvedToken,
      viewer,
      prompter,
    });
    return;
  }

  await handleExistingRepositorySetup({
    token: resolvedToken,
    viewer,
    prompter,
  });
}
