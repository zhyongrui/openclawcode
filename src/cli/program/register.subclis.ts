import type { Command } from "commander";
import { resolveCliArgvInvocation } from "../argv-invocation.js";
import {
  shouldEagerRegisterSubcommands,
  shouldRegisterPrimarySubcommandOnly,
} from "../command-registration-policy.js";
import {
  buildCommandGroupEntries,
  defineImportedProgramCommandGroupSpecs,
  type CommandGroupDescriptorSpec,
} from "./command-group-descriptors.js";
import {
  registerCommandGroupByName,
  registerCommandGroups,
  type CommandGroupEntry,
} from "./register-command-groups.js";
import {
  registerSubCliByName as registerSubCliByNameCore,
  registerSubCliCommands as registerSubCliCommandsCore,
} from "./register.subclis-core.js";
import {
  getSubCliCommandsWithSubcommands,
  getSubCliEntries as getSubCliEntryDescriptors,
  type SubCliDescriptor,
} from "./subcli-descriptors.js";

export { getSubCliCommandsWithSubcommands };

type SubCliRegistrar = (program: Command) => Promise<void> | void;

const pendingRegistrations = new WeakMap<Command, Promise<void>[]>();

function trackPendingRegistration(program: Command, work: Promise<void> | void) {
  const promise = Promise.resolve(work);
  const pending = pendingRegistrations.get(program) ?? [];
  pending.push(promise);
  pendingRegistrations.set(program, pending);
}

export async function awaitPendingSubCliRegistrations(program: Command): Promise<void> {
  const pending = pendingRegistrations.get(program);
  if (!pending || pending.length === 0) {
    return;
  }
  pendingRegistrations.delete(program);
  await Promise.all(pending);
}

export const loadValidatedConfigForPluginRegistration = async () => {
  const mod = await import("../../plugins/cli.js");
  return mod.loadValidatedConfigForPluginRegistration();
};

// Note for humans and agents:
// If you update the list of commands, also check whether they have subcommands
// and set the flag accordingly.
const entrySpecs: readonly CommandGroupDescriptorSpec<SubCliRegistrar>[] = [
  ...defineImportedProgramCommandGroupSpecs([
    {
      commandNames: ["completion"],
      loadModule: () => import("../completion-cli.js"),
      exportName: "registerCompletionCli",
    },
  ]),
];

function resolveSubCliCommandGroups(): CommandGroupEntry[] {
  return buildCommandGroupEntries(getSubCliEntryDescriptors(), entrySpecs, (register) => register);
}

export function getSubCliEntries(): ReadonlyArray<SubCliDescriptor> {
  return getSubCliEntryDescriptors();
}

export async function registerSubCliByName(program: Command, name: string): Promise<boolean> {
  if (await registerSubCliByNameCore(program, name)) {
    return true;
  }
  return registerCommandGroupByName(program, resolveSubCliCommandGroups(), name);
}

export function registerSubCliCommands(program: Command, argv: string[] = process.argv) {
  registerSubCliCommandsCore(program, argv);
  if (shouldEagerRegisterSubcommands(argv)) {
    for (const entry of resolveSubCliCommandGroups()) {
      trackPendingRegistration(program, entry.register(program));
    }
    return;
  }
  const { primary } = resolveCliArgvInvocation(argv);
  registerCommandGroups(program, resolveSubCliCommandGroups(), {
    eager: shouldEagerRegisterSubcommands(),
    primary,
    registerPrimaryOnly: Boolean(primary && shouldRegisterPrimarySubcommandOnly(argv)),
  });
}
