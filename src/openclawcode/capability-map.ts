export const OPENCLAWCODE_CAPABILITY_MAP_CONTRACT_VERSION = 1;

export interface OpenClawCodeCapabilityMapCommand {
  id: string;
  surface: "chat" | "cli";
  command: string;
  summary: string;
  capabilities: string[];
}

export interface OpenClawCodeCapabilityMapArtifact {
  id: string;
  path: string;
  summary: string;
  producers: string[];
  consumers: string[];
}

export interface OpenClawCodeCapabilityMapRuntimeRole {
  roleId: "planner" | "coder" | "reviewer" | "verifier" | "doc-writer";
  summary: string;
  routingArtifact: string;
  relatedCommands: string[];
  steeringStages: string[];
}

export interface OpenClawCodeCapabilityMapSnapshot {
  contractVersion: 1;
  chatCommands: OpenClawCodeCapabilityMapCommand[];
  cliCommands: OpenClawCodeCapabilityMapCommand[];
  workflowArtifacts: OpenClawCodeCapabilityMapArtifact[];
  runtimeRoles: OpenClawCodeCapabilityMapRuntimeRole[];
}

const CHAT_COMMANDS: OpenClawCodeCapabilityMapCommand[] = [
  {
    id: "chat.intake",
    surface: "chat",
    command: "/occode-intake",
    summary: "Draft or create scoped issue intake from chat.",
    capabilities: ["intake.issue-draft", "intake.chat-request", "policy.precheck"],
  },
  {
    id: "chat.start",
    surface: "chat",
    command: "/occode-start",
    summary: "Queue or start a tracked issue run from chat.",
    capabilities: ["queue.enqueue", "run.start", "policy.override-shortcut"],
  },
  {
    id: "chat.status",
    surface: "chat",
    command: "/occode-status",
    summary: "Inspect the latest tracked issue status, quality gate, and routing state.",
    capabilities: ["issue.status.inspect", "run.failure-diagnostics", "run.quality-gate"],
  },
  {
    id: "chat.inbox",
    surface: "chat",
    command: "/occode-inbox",
    summary: "Inspect repo-level pending work, queue state, and recent learnings.",
    capabilities: ["queue.summary", "repo.quality-gates", "repo.incident-learning"],
  },
  {
    id: "chat.rerun",
    surface: "chat",
    command: "/occode-rerun",
    summary: "Queue a rerun with persisted review context and optional runtime reroute.",
    capabilities: ["run.rerun", "run.review-context", "runtime.reroute"],
  },
  {
    id: "chat.policy",
    surface: "chat",
    command: "/occode-policy",
    summary: "Inspect suitability and auto-merge policy context.",
    capabilities: ["policy.inspect", "policy.override-paths"],
  },
  {
    id: "chat.blueprint",
    surface: "chat",
    command: "/occode-blueprint",
    summary: "Inspect or continue the fixed project blueprint workflow.",
    capabilities: ["blueprint.inspect", "blueprint.discussion"],
  },
  {
    id: "chat.gates",
    surface: "chat",
    command: "/occode-gates",
    summary: "Inspect stage-gate readiness and human decision points.",
    capabilities: ["stage-gates.inspect", "stage-gates.decide"],
  },
  {
    id: "chat.runtime-steering",
    surface: "chat",
    command: "/occode-runtime-steering",
    summary: "Inspect persisted per-stage runtime steering.",
    capabilities: ["runtime-steering.inspect"],
  },
  {
    id: "chat.runtime-steering-set",
    surface: "chat",
    command: "/occode-runtime-steering-set",
    summary: "Persist per-stage runtime steering overrides from chat.",
    capabilities: ["runtime-steering.mutate"],
  },
];

const CLI_COMMANDS: OpenClawCodeCapabilityMapCommand[] = [
  {
    id: "cli.bootstrap",
    surface: "cli",
    command: "openclaw code bootstrap",
    summary: "Prepare repo-local operator config, blueprint artifacts, and setup handoff.",
    capabilities: ["bootstrap.chatops", "bootstrap.blueprint-first", "setup.handoff"],
  },
  {
    id: "cli.run",
    surface: "cli",
    command: "openclaw code run",
    summary: "Execute the issue workflow and emit stable run JSON when requested.",
    capabilities: ["run.execute", "run.json", "plan.approval", "plan.edit"],
  },
  {
    id: "cli.reroute-run",
    surface: "cli",
    command: "openclaw code reroute-run",
    summary: "Persist immediate or deferred coder/verifier runtime reroutes.",
    capabilities: ["runtime.reroute", "run.recovery"],
  },
  {
    id: "cli.operator-status",
    surface: "cli",
    command: "openclaw code operator-status-snapshot-show",
    summary: "Show the stable operator state snapshot behind chat-visible status.",
    capabilities: ["operator-status.json", "repo.incident-learning", "queue.summary"],
  },
  {
    id: "cli.policy",
    surface: "cli",
    command: "openclaw code policy-show",
    summary: "Show the stable machine-readable policy surface.",
    capabilities: ["policy.inspect", "policy.guardrails"],
  },
  {
    id: "cli.capability-map",
    surface: "cli",
    command: "openclaw code capability-map-show",
    summary: "Show the stable command/capability map for chat, CLI, artifacts, and roles.",
    capabilities: ["capability-map.inspect"],
  },
  {
    id: "cli.operator-program-init",
    surface: "cli",
    command: "openclaw code operator-program-init",
    summary: "Create the repo-local operator program artifact for execution policy.",
    capabilities: ["operator-program.init", "operator-program.policy"],
  },
  {
    id: "cli.operator-program-show",
    surface: "cli",
    command: "openclaw code operator-program-show",
    summary: "Inspect the repo-local operator program artifact.",
    capabilities: ["operator-program.inspect", "operator-program.policy"],
  },
  {
    id: "cli.blueprint-clarify",
    surface: "cli",
    command: "openclaw code blueprint-clarify",
    summary: "Derive deterministic clarification questions before work-item creation.",
    capabilities: ["blueprint.clarify"],
  },
  {
    id: "cli.blueprint-decompose",
    surface: "cli",
    command: "openclaw code blueprint-decompose",
    summary: "Persist repo-local work items derived from the project blueprint.",
    capabilities: ["blueprint.decompose", "work-items.persist"],
  },
  {
    id: "cli.discover-work-items",
    surface: "cli",
    command: "openclaw code discover-work-items",
    summary: "Persist discovery evidence from runtime, setup, and blueprint drift.",
    capabilities: ["discovery.persist", "work-items.discovery"],
  },
  {
    id: "cli.role-routing-show",
    surface: "cli",
    command: "openclaw code role-routing-show",
    summary: "Inspect planner/coder/reviewer/verifier/doc-writer routing state.",
    capabilities: ["role-routing.inspect", "runtime.roles"],
  },
  {
    id: "cli.runtime-steering-show",
    surface: "cli",
    command: "openclaw code runtime-steering-show",
    summary: "Inspect repo-local per-stage runtime steering overrides.",
    capabilities: ["runtime-steering.inspect"],
  },
  {
    id: "cli.runtime-steering-set",
    surface: "cli",
    command: "openclaw code runtime-steering-set",
    summary: "Persist repo-local per-stage runtime steering overrides.",
    capabilities: ["runtime-steering.mutate"],
  },
  {
    id: "cli.stage-gates-show",
    surface: "cli",
    command: "openclaw code stage-gates-show",
    summary: "Inspect persisted stage-gate readiness and latest decisions.",
    capabilities: ["stage-gates.inspect"],
  },
];

const WORKFLOW_ARTIFACTS: OpenClawCodeCapabilityMapArtifact[] = [
  {
    id: "artifact.project-blueprint",
    path: "PROJECT-BLUEPRINT.md",
    summary: "Canonical fixed project blueprint document.",
    producers: ["openclaw code blueprint-init", "chat blueprint workflow"],
    consumers: ["openclaw code blueprint-clarify", "openclaw code blueprint-decompose"],
  },
  {
    id: "artifact.operator-program",
    path: ".openclawcode/operator-program.json",
    summary: "Repo-local execution policy artifact for mutable scope, validation budget, and advancement rules.",
    producers: ["openclaw code operator-program-init"],
    consumers: ["openclaw code operator-program-show", "future execution-policy surfaces"],
  },
  {
    id: "artifact.work-items",
    path: ".openclawcode/work-items.json",
    summary: "Planned work items projected from the agreed blueprint.",
    producers: ["openclaw code blueprint-decompose"],
    consumers: ["openclaw code next-work-show", "chat issue materialization"],
  },
  {
    id: "artifact.discovery-work-items",
    path: ".openclawcode/discovery-work-items.json",
    summary: "Discovered work items derived from runtime incidents and drift.",
    producers: ["openclaw code discover-work-items"],
    consumers: ["openclaw code next-work-show", "project progress surfaces"],
  },
  {
    id: "artifact.role-routing",
    path: ".openclawcode/role-routing.json",
    summary: "Provider-neutral runtime routing plan for planner/coder/reviewer/verifier/doc-writer.",
    producers: ["openclaw code role-routing-refresh"],
    consumers: ["openclaw code run", "openclaw code role-routing-show"],
  },
  {
    id: "artifact.runtime-steering",
    path: ".openclawcode/runtime-steering.json",
    summary: "Repo-local per-stage runtime steering overrides.",
    producers: ["openclaw code runtime-steering-set", "/occode-runtime-steering-set"],
    consumers: ["openclaw code run", "/occode-runtime-steering"],
  },
  {
    id: "artifact.stage-gates",
    path: ".openclawcode/stage-gates.json",
    summary: "Persisted stage-gate readiness and human decisions.",
    producers: ["openclaw code stage-gates-refresh", "openclaw code stage-gates-decide"],
    consumers: ["/occode-gates", "openclaw code run"],
  },
  {
    id: "artifact.run-json",
    path: "openclaw code run --json",
    summary: "Stable workflow run contract for automation and post-run review.",
    producers: ["openclaw code run"],
    consumers: ["external automation", "operator debugging", "chat status mirroring"],
  },
  {
    id: "artifact.operator-status",
    path: "openclaw code operator-status-snapshot-show --json",
    summary: "Stable operator queue and snapshot contract behind chat-visible status.",
    producers: ["openclaw chatops state"],
    consumers: ["/occode-status", "/occode-inbox", "external automation"],
  },
];

const RUNTIME_ROLES: OpenClawCodeCapabilityMapRuntimeRole[] = [
  {
    roleId: "planner",
    summary: "Builds the execution spec before code changes begin.",
    routingArtifact: ".openclawcode/role-routing.json",
    relatedCommands: ["openclaw code role-routing-show", "openclaw code run"],
    steeringStages: ["planning"],
  },
  {
    roleId: "coder",
    summary: "Implements repo changes in the isolated issue worktree.",
    routingArtifact: ".openclawcode/role-routing.json",
    relatedCommands: ["openclaw code run", "openclaw code reroute-run"],
    steeringStages: ["building"],
  },
  {
    roleId: "reviewer",
    summary: "Supports review-oriented reasoning in mixed-role routing plans.",
    routingArtifact: ".openclawcode/role-routing.json",
    relatedCommands: ["openclaw code role-routing-show"],
    steeringStages: ["verification"],
  },
  {
    roleId: "verifier",
    summary: "Runs the verification pass and produces the quality gate outcome.",
    routingArtifact: ".openclawcode/role-routing.json",
    relatedCommands: ["openclaw code run", "openclaw code reroute-run"],
    steeringStages: ["verification"],
  },
  {
    roleId: "doc-writer",
    summary: "Owns documentation-oriented outputs in role-routing plans.",
    routingArtifact: ".openclawcode/role-routing.json",
    relatedCommands: ["openclaw code role-routing-show"],
    steeringStages: ["planning", "verification"],
  },
];

export function buildOpenClawCodeCapabilityMapSnapshot(): OpenClawCodeCapabilityMapSnapshot {
  return {
    contractVersion: OPENCLAWCODE_CAPABILITY_MAP_CONTRACT_VERSION,
    chatCommands: CHAT_COMMANDS,
    cliCommands: CLI_COMMANDS,
    workflowArtifacts: WORKFLOW_ARTIFACTS,
    runtimeRoles: RUNTIME_ROLES,
  };
}
