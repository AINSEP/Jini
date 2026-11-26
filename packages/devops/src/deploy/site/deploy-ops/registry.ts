import { orFallback, orFallbackSync } from '@jini-ai/core/errors/idioms';
import type { readFileSync } from "node:fs";
import path from "node:path";
import { asDeployOpsModule, parseDeployOpsFile as parseDeployOpsDescriptors } from "@jini-ai/devops/deploy";
import type { DeployOpsDescriptor, DeployOpsRegistry, LoadedDeployOps } from "@jini-ai/devops/deploy";

/** Installed modules use the same activation, bundled digest and disk containment gates as deploy targets. */
export const DEPLOY_OPS_FILENAME = "jini-deploy-ops.json";

const opsContribution = {
  filename: DEPLOY_OPS_FILENAME, contribution: "deploy ops",
  parse: ({ raw }: { raw: string }) => parseDeployOpsDescriptors({ raw }), modulePath: ({ descriptor }: { descriptor: DeployOpsDescriptor }) => descriptor.module,
  validate: ({ exported }: { exported: unknown }) => asDeployOpsModule({ exported }),
  refusal: ({ descriptor, reason }: { descriptor: DeployOpsDescriptor; reason: string }) => `deploy ops platform '${descriptor.id}' was not loaded: ${reason}`,
};

/**
 * Import contained modules; isolate unreadable manifests, invalid exports and missing modules as refusals.
 * @param plugin - Trusted source directory. The caller owns activation/digest gates; this seam is for tests.
 * @returns Loaded modules and refusal messages; never throws for a malformed package.
 * @complexity Time and space: O(platforms), bounded to 32 entries.
 * @example await loadDeployOpsRegistryFromSource({ pluginId: "my-host", packageRoot: bundledRoot });
 */
export async function loadDeployOpsRegistryFromSource(required: {
  plugin: { pluginId: string; packageRoot: string };
  loadPluginContributionsFromSource(input: { plugin: { pluginId: string; packageRoot: string }; definition: typeof opsContribution; onReadError(input: { plugin: { pluginId: string } }): string[]; importRefusalReason: string; importErrorReason: string }): Promise<{ items: readonly LoadedDeployOps[]; refusals: readonly string[] }>;
}, _optional: Record<string, never> = {}): Promise<DeployOpsRegistry> {
  const load = await required.loadPluginContributionsFromSource({ plugin: required.plugin, definition: opsContribution,
    onReadError: ({ plugin }) => [`deploy ops from '${plugin.pluginId}' were not loaded: ${DEPLOY_OPS_FILENAME} could not be read`],
    importRefusalReason: "module could not be imported", importErrorReason: "module could not be read or imported" });
  return buildRegistry({ loaded: load.items, inputRefusals: load.refusals });
}

/** All bundled ops sources; category parsing and duplicate refusal stay with this registry.
 * @complexity O(p + platforms), one contained import per contribution. */
export async function loadBundledDeployOpsRegistry(required: { readonly sourceRoot: string;
  bundledContributionSources(input: { sourceRoot: string; filename: string }): readonly { pluginId: string; packageRoot: string }[];
  loadPluginContributionsFromSource: Parameters<typeof loadDeployOpsRegistryFromSource>[0]['loadPluginContributionsFromSource'];
}, _optional: Record<string, never> = {}): Promise<DeployOpsRegistry> {
  const items: LoadedDeployOps[] = [];
  const refusals: string[] = [];
  for (const plugin of required.bundledContributionSources({ sourceRoot: required.sourceRoot, filename: DEPLOY_OPS_FILENAME })) {
    const registry = await loadDeployOpsRegistryFromSource({ plugin, loadPluginContributionsFromSource: required.loadPluginContributionsFromSource });
    items.push(...registry.list());
    refusals.push(...registry.refusals);
  }
  return buildRegistry({ loaded: items, inputRefusals: refusals });
}

/** Data-only enum discovery for hermetic tool catalogs, never authorization or module loading.
 * Ambiguous ids are omitted, as in the executable registry. @complexity O(p + platforms). */
export function readBundledDeployOpsDescriptors(required: { readonly sourceRoot: string;
  bundledContributionSources(input: { sourceRoot: string; filename: string }): readonly { pluginId: string; packageRoot: string }[];
  readFileSync: typeof readFileSync;
}, _optional: Record<string, never> = {}): readonly DeployOpsDescriptor[] {
  const descriptors = required.bundledContributionSources({ sourceRoot: required.sourceRoot, filename: DEPLOY_OPS_FILENAME }).flatMap(plugin => {
    return orFallbackSync({ work: () => {
      const parsed = parseDeployOpsDescriptors({ raw: required.readFileSync(path.join(plugin.packageRoot, DEPLOY_OPS_FILENAME), "utf8") });
      return parsed.ok ? parsed.descriptors : [];
    }, fallback: [], step: 'Read bundled deployment operations' });
  });
  const counts = new Map<string, number>();
  for (const descriptor of descriptors) counts.set(descriptor.id, (counts.get(descriptor.id) ?? 0) + 1);
  return descriptors.filter(descriptor => counts.get(descriptor.id) === 1);
}

/**
 * Load only active, bundled-digest-trusted installed deployment packages; never fall back to source.
 * @param ctx - Workspace whose installed packages and activation records are checked fresh.
 * @returns Loaded modules and refusals, including filesystem faults; no expected failure escapes.
 * @param required - Contribution loader from this boot's lifecycle; no site-dependent module default.
 * @complexity Time: O(bundled sources + installed packages + platforms). Space: O(packages + platforms + refusals).
 * @example await loadDeployOpsRegistry({ workspaceId }, { loadContributions: lifecycle.loadPluginContributions });
 */
export async function loadDeployOpsRegistry(required: {
  workspaceId: string; sourceRoot: string;
  bundledContributionSources: Parameters<typeof loadBundledDeployOpsRegistry>[0]['bundledContributionSources'];
  readTrustedPluginFile(input: { plugin: { pluginId: string; packageRoot: string }; filename: string }): Promise<string>;
  loadContributions(input: { workspaceId: string; definition: typeof opsContribution; onReadError(input: { plugin: { pluginId: string } }): string[]; importRefusalReason: string; importErrorReason: string }, options: {
    packageRefusal(input: { plugin: { pluginId: string; packageRoot: string } }): string | undefined;
    onInactive(input: { plugin: { pluginId: string; packageRoot: string }; definition: typeof opsContribution; onReadError(input: { plugin: { pluginId: string } }): string[]; importRefusalReason: string; importErrorReason: string }): Promise<void>;
  }): Promise<{ items: readonly LoadedDeployOps[]; refusals: readonly string[] }>;
  warn(error: unknown): void;
}, _optional = {}): Promise<DeployOpsRegistry> {
  try {
    // Only packages that ship this category in this build own it. The shared source selector
    // excludes retired packages: an old package retained until its successors are usable must
    // not contribute duplicate ids (duplicates are dropped). Installed activation and digest
    // checks still run in the lifecycle loader; this source list never authorizes an import.
    const owners = new Set(required.bundledContributionSources({
      sourceRoot: required.sourceRoot, filename: DEPLOY_OPS_FILENAME,
    }).map(plugin => plugin.pluginId));
    const switchedOff = new Map<string, string>();
    const load = await required.loadContributions({ workspaceId: required.workspaceId, definition: opsContribution,
      onReadError: ({ plugin }) => [`deploy ops from '${plugin.pluginId}' were not loaded: ${DEPLOY_OPS_FILENAME} could not be read`],
      importRefusalReason: "module could not be imported", importErrorReason: "module could not be read or imported" }, {
      packageRefusal: ({ plugin }) => owners.has(plugin.pluginId) ? undefined : `deploy ops from '${plugin.pluginId}' were not loaded: only bundled plugins shipping ${DEPLOY_OPS_FILENAME} may contribute`,
      // A switched-off plugin's manifest is read as data (no module imported) so a refusal can name it.
      onInactive: async ({ plugin }) => {
        // An unreadable manifest only loses the name; it must not refuse every active platform.
        const parsed = parseDeployOpsDescriptors({ raw: await orFallback({ work: () => required.readTrustedPluginFile({ plugin, filename: DEPLOY_OPS_FILENAME }), fallback: "", step: 'Read inactive deployment operations' }) });
        for (const descriptor of parsed.ok ? parsed.descriptors : []) if (!switchedOff.has(descriptor.id)) switchedOff.set(descriptor.id, plugin.pluginId);
      },
    });
    return buildRegistry({ loaded: load.items, inputRefusals: load.refusals }, { switchedOff });
  } catch (error) {
    required.warn(error);
    return buildRegistry({ loaded: [], inputRefusals: ["deploy ops were not loaded: installed plugin packages could not be read"] });
  }
}

/** Index uniquely claimed ids. Ambiguous ids are refused for all claimants. O(platforms). */
function buildRegistry({ loaded, inputRefusals }: { loaded: readonly LoadedDeployOps[]; inputRefusals: readonly string[] }, { switchedOff }: { switchedOff?: ReadonlyMap<string, string> } = {}): DeployOpsRegistry {
  const map = new Map<string, LoadedDeployOps>(); const duplicates = new Set<string>(); const refusals = [...inputRefusals];
  for (const platform of loaded) { if (map.has(platform.descriptor.id)) duplicates.add(platform.descriptor.id); else map.set(platform.descriptor.id, platform); }
  for (const id of duplicates) { map.delete(id); refusals.push(`deploy ops platform '${id}' was not loaded: declared more than once`); }
  return { get: id => map.get(id), list: () => [...map.values()], refusals, ...(switchedOff ? { switchedOff } : {}) };
}
