import { readFileSync } from "node:fs";
import path from "node:path";

import { asDeployConfigGeneratorModule, parseDeployConfigsFile, type DeployConfigGeneratorDescriptor, type DeployConfigGeneratorRegistry, type LoadedDeployConfigGenerator } from "../config-descriptors.js";
import type { DeployConfigGeneratorModule } from "../config-contracts.js";

/**
 * @file Loads the deploy-config generators behind a host CLI's `deploy config --target <id>` from an
 * Agent Plugin, so core names no hosting vendor. A plugin opts in by shipping the host-named manifest
 * (`ports.filename`, injected) at its root: `{ schemaVersion: 1, generators: [{ id, label, module }] }`,
 * in the order the CLI lists them. Each `module` is a plain-JS `.mjs` file inside the plugin whose
 * default export is a `DeployConfigGeneratorModule`.
 *
 * Only the SOURCE loader exists today: its one caller, the CLI, runs at the repo root and reads the
 * product's own bundled plugin sources, the same trust basis as the hermetic composition root. Module
 * imports still go through the shared containment gate (agent-plugins' `trusted-plugin-files.ts`,
 * reached through the injected `defineExecutableContribution`/`loadFromSource`). A workspace-installed
 * variant (activation + bundled-digest gates) is added when an admin route needs one.
 *
 * Failure isolation: a bad manifest drops the plugin's generators, a bad module only itself; every
 * drop is reported in `refusals`, never thrown. Cross-package duplicate ids are refused for all
 * claimants, never silently overwritten.
 */

/** Structural slice of agent-plugins' `TrustedPluginPackage`. */
export interface DeployConfigPluginSource { readonly pluginId: string; readonly packageRoot: string }

type ParseResult = ReturnType<typeof parseDeployConfigsFile>;

/** The executable contribution spec handed to the injected `defineExecutableContribution`. */
export interface DeployConfigContributionSpec {
  readonly filename: string;
  readonly contribution: string;
  readonly parse: (input: { readonly raw: string }) => ParseResult;
  readonly modulePath: (input: { readonly descriptor: DeployConfigGeneratorDescriptor }) => string;
  readonly validate: (input: { readonly exported: unknown }) => DeployConfigGeneratorModule | string;
  readonly refusal: (input: { readonly plugin: { readonly pluginId: string }; readonly descriptor: DeployConfigGeneratorDescriptor; readonly reason: string }) => string;
}

/** The data-only contribution definition handed to the injected `loadContributions`. */
export interface DeployWorkflowContributionDefinition {
  readonly filename: string;
  readonly contribution: string;
  readonly kind: "data";
  readonly parse: (input: { readonly raw: string }) => ParseResult;
  readonly load: (input: { readonly descriptor: DeployConfigGeneratorDescriptor }) => DeployConfigGeneratorDescriptor;
  readonly onReadError: () => readonly string[];
}

/** The installed-plugin loader a host binds (agent-plugins' active, trusted lifecycle). */
export type LoadDeployWorkflowContributions = (
  input: { readonly workspaceId: string; readonly definition: DeployWorkflowContributionDefinition },
  optional: { readonly requireActive: boolean; readonly orderByPluginId: boolean },
) => Promise<{ readonly items: readonly DeployConfigGeneratorDescriptor[]; readonly refusals: readonly string[] }>;

/** Host collaborators (K3/K5): the product-named manifest file and the agent-plugins contribution seam. */
export interface DeployConfigRegistryPorts<Plugin extends DeployConfigPluginSource, Definition> {
  /** The product-named manifest file a plugin ships at its root (host-owned). */
  readonly filename: string;
  /** The host's bundled plugin sources declaring `filename`, in plugin-id order. */
  readonly contributionSources: (required: { readonly sourceRoot: string; readonly filename: string }) => readonly Plugin[];
  readonly defineExecutableContribution: (
    spec: DeployConfigContributionSpec,
    optional: { readonly onReadError: (input: { readonly error: unknown }) => readonly string[] | undefined },
  ) => Definition;
  readonly loadFromSource: (input: { readonly plugin: Plugin; readonly definition: Definition }) => Promise<{ readonly items: readonly LoadedDeployConfigGenerator[]; readonly refusals: readonly string[] }>;
  /** Where installed-loader refusal lines go (the host's logger). */
  readonly warn: (line: string) => void;
}

/** The registry functions bound to one host's ports. */
export interface DeployConfigGeneratorSource<Plugin extends DeployConfigPluginSource> {
  loadDeployConfigGeneratorsFromSource(plugin: Plugin, _optional?: Record<string, never>): Promise<DeployConfigGeneratorRegistry>;
  readDeployConfigTargetIdsFromSource(plugin: Plugin): readonly string[];
  loadBundledDeployConfigGenerators(required: { readonly sourceRoot: string }, _optional?: Record<string, never>): Promise<DeployConfigGeneratorRegistry>;
  readBundledDeployConfigTargetIds(required: { readonly sourceRoot: string }, _optional?: Record<string, never>): readonly string[];
  readBundledDeployConfigDescriptors(required: { readonly sourceRoot: string }, _optional?: object): readonly DeployConfigGeneratorDescriptor[];
  readBundledDeployConfigCandidatePaths(required: { readonly sourceRoot: string }, _optional?: object): readonly string[];
  readBundledDeployWorkflowFile(required: { readonly sourceRoot: string }, _optional?: object): string | undefined;
  readBundledDeployWorkflowFiles(required: { readonly sourceRoot: string }, _optional?: object): readonly string[];
  loadDeployWorkflowFiles(required: { readonly workspaceId: string; readonly loadContributions: LoadDeployWorkflowContributions }, _optional?: object): Promise<readonly string[]>;
}

/** @complexity O(g). */
function buildRegistry(loaded: readonly LoadedDeployConfigGenerator[], refusals: readonly string[]): DeployConfigGeneratorRegistry {
  const byId = new Map<string, LoadedDeployConfigGenerator>();
  const duplicates = new Set<string>();
  for (const generator of loaded) {
    if (byId.has(generator.descriptor.id)) duplicates.add(generator.descriptor.id);
    else byId.set(generator.descriptor.id, generator);
  }
  for (const id of duplicates) byId.delete(id);
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    refusals: [...refusals, ...[...duplicates].map(id => `deploy config '${id}' was not loaded: declared more than once`)],
  };
}

function workflowFilesOf({ descriptors }: { descriptors: readonly DeployConfigGeneratorDescriptor[] }, _options = {}): readonly string[] {
  return [...new Set(descriptors.flatMap(entry => entry.workflowFile === undefined ? [] : [entry.workflowFile]))];
}

/**
 * The generator ids a plugin's SOURCE directory declares, in declared order, read synchronously from
 * its manifest without importing any module. For text built before any async work can run (the CLI's
 * `--target` help). A missing or invalid manifest yields `[]`; the refusal itself is reported when the
 * command actually loads the generators.
 *
 * @complexity O(g) in the declared generator count.
 */
export function readDeployConfigTargetIdsFromSource({ plugin, filename }: { readonly plugin: DeployConfigPluginSource; readonly filename: string }, _optional = {}): readonly string[] {
  let raw: string;
  try {
    raw = readFileSync(path.join(plugin.packageRoot, filename), "utf8");
  } catch {
    return [];
  }
  const parsed = parseDeployConfigsFile({ raw });
  return parsed.ok ? parsed.descriptors.map((descriptor) => descriptor.id) : [];
}

/** Synchronous hints from shipped sources, using the generator parser and duplicate-id policy.
 * @param required Product-owned bundled source root, manifest name and source lister.
 * @returns Unambiguous descriptors, without importing modules. */
export function readBundledDeployConfigDescriptors<Plugin extends DeployConfigPluginSource>(
  required: { readonly sourceRoot: string } & Pick<DeployConfigRegistryPorts<Plugin, unknown>, "filename" | "contributionSources">,
  _optional = {},
): readonly DeployConfigGeneratorDescriptor[] {
  const { sourceRoot, filename } = required;
  // Composition roots call this eagerly; a missing bundled root yields no hints rather than a boot failure.
  let sources: readonly Plugin[];
  try { sources = required.contributionSources({ sourceRoot, filename }); } catch { return []; }
  const descriptors = sources.flatMap(plugin => {
    try {
      const parsed = parseDeployConfigsFile({ raw: readFileSync(path.join(plugin.packageRoot, filename), "utf8") });
      return parsed.ok ? parsed.descriptors : [];
    } catch { return []; }
  });
  const counts = new Map<string, number>();
  for (const entry of descriptors) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  return descriptors.filter(entry => counts.get(entry.id) === 1);
}

/** Ordered deploy suggestions; app.json remains the core's neutral convention. */
function candidatePathsOf({ descriptors }: { descriptors: readonly DeployConfigGeneratorDescriptor[] }, _options = {}): readonly string[] {
  const entries = descriptors.flatMap(entry => entry.candidatePaths ?? []);
  entries.push({ path: "app.json", order: 4 });
  entries.sort((a, b) => a.order - b.order);
  return [...new Set(entries.map(entry => entry.path))];
}

/** Installed workflow hints use the same active, trusted lifecycle as deploy ops, without imports. */
export async function loadDeployWorkflowFiles(
  required: { readonly workspaceId: string; readonly loadContributions: LoadDeployWorkflowContributions; readonly filename: string; readonly warn: (line: string) => void },
  _options = {},
): Promise<readonly string[]> {
  const definition: DeployWorkflowContributionDefinition = {
    filename: required.filename, contribution: 'deploy workflow declarations', kind: 'data',
    parse: ({ raw }) => parseDeployConfigsFile({ raw }), load: ({ descriptor }) => descriptor,
    onReadError: () => [],
  };
  const result = await required.loadContributions({ workspaceId: required.workspaceId, definition }, { requireActive: true, orderByPluginId: true });
  for (const refusal of result.refusals) required.warn(refusal);
  return workflowFilesOf({ descriptors: result.items });
}

/**
 * Binds the registry functions to one host's ports (composition happens once, in the host).
 *
 * @complexity O(1) to bind; each returned function documents its own cost (O(g) generators, one
 *   contained import each for the loaders).
 */
export function createDeployConfigGeneratorSource<Plugin extends DeployConfigPluginSource, Definition>(
  ports: DeployConfigRegistryPorts<Plugin, Definition>,
  _optional = {},
): DeployConfigGeneratorSource<Plugin> {
  const { filename } = ports;
  const definition = ports.defineExecutableContribution({
    filename, contribution: "deploy configs",
    parse: ({ raw }) => parseDeployConfigsFile({ raw }), modulePath: ({ descriptor }) => descriptor.module,
    validate: ({ exported }) => asDeployConfigGeneratorModule({ exported }),
    refusal: ({ plugin, descriptor, reason }) => `deploy config '${descriptor.id}' from '${plugin.pluginId}' was not loaded: ${reason}`,
  }, { onReadError: ({ error }) => (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : undefined });
  const fromSource = async (plugin: Plugin): Promise<DeployConfigGeneratorRegistry> => {
    const load = await ports.loadFromSource({ plugin, definition });
    return buildRegistry(load.items, load.refusals);
  };
  const descriptorsOf = (required: { readonly sourceRoot: string }) => readBundledDeployConfigDescriptors({ ...required, filename, contributionSources: ports.contributionSources });
  return {
    loadDeployConfigGeneratorsFromSource: (plugin) => fromSource(plugin),
    readDeployConfigTargetIdsFromSource: (plugin) => readDeployConfigTargetIdsFromSource({ plugin, filename }),
    loadBundledDeployConfigGenerators: async (required) => {
      const items: LoadedDeployConfigGenerator[] = [];
      const refusals: string[] = [];
      for (const plugin of ports.contributionSources({ ...required, filename })) {
        const registry = await fromSource(plugin);
        items.push(...registry.list());
        refusals.push(...registry.refusals);
      }
      return buildRegistry(items, refusals);
    },
    readBundledDeployConfigTargetIds: (required) => descriptorsOf(required).map(descriptor => descriptor.id),
    readBundledDeployConfigDescriptors: (required) => descriptorsOf(required),
    readBundledDeployConfigCandidatePaths: (required) => candidatePathsOf({ descriptors: descriptorsOf(required) }),
    readBundledDeployWorkflowFile: (required) => {
      // Host supplies the single declared workflow to an ops adapter; ambiguity never guesses.
      const files = workflowFilesOf({ descriptors: descriptorsOf(required) });
      return files.length === 1 ? files[0] : undefined;
    },
    readBundledDeployWorkflowFiles: (required) => workflowFilesOf({ descriptors: descriptorsOf(required) }),
    loadDeployWorkflowFiles: (required) => loadDeployWorkflowFiles({ ...required, filename, warn: ports.warn }),
  };
}
