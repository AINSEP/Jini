import * as semver from 'semver';
import type { InstalledAgentPlugin } from './types.js';
import type { AgentPluginActivations, AgentPluginOrigin } from './activation.js';
import { isValidAgentPluginHostRange } from './compatibility-metadata.js';
export { readAgentPluginCompatibilityMetadata, isValidAgentPluginHostRange, INVALID_AGENT_PLUGIN_HOST_RANGE } from './compatibility-metadata.js';

/** Host extension contract, independent of product releases and the upstream manifest schema.
 * `hostRange` is checked against this, never against an app version. */
export const AGENT_PLUGIN_CONTRACT_VERSION = '1.0.0';

/** Named refusal shared by HTTP and tool adapters. */
export class AgentPluginHostIncompatibleError extends Error {
  readonly code = 'PLUGIN_HOST_INCOMPATIBLE';
  constructor(required: { pluginId: string }, _optional: Record<string, never> = {}) {
    super(`Plugin '${required.pluginId}' is not compatible with this host's Agent Plugin contract.`);
    this.name = 'AgentPluginHostIncompatibleError';
  }
}

export interface AgentPluginCompatibility {
  readonly hostOk: boolean;
  readonly missingRequires: readonly string[];
}

/** Same rule as activation.ts `isAgentPluginActive`: an absent activation record means active. */
function isActive({ activations, pluginId }: { readonly activations: AgentPluginActivations; readonly pluginId: string }): boolean {
  return !Object.hasOwn(activations.plugins, pluginId) || activations.plugins[pluginId]!.enabled;
}

/** Active plugins other than `excludeId`, so a plugin never satisfies its own requirements. */
function activeOthers({ installed, activations, excludeId }: {
  readonly installed: readonly InstalledAgentPlugin[]; readonly activations: AgentPluginActivations; readonly excludeId: string;
}): InstalledAgentPlugin[] {
  return installed.filter(other => other.pluginId !== excludeId && isActive({ activations, pluginId: other.pluginId }));
}

function providedBy({ plugins }: { readonly plugins: readonly InstalledAgentPlugin[] }): string[] {
  return plugins.flatMap(plugin => plugin.provides ?? []);
}

/** Projects live metadata, excluding disabled providers and the plugin itself.
 * @returns Origin, host compatibility, and advisory requirements. @complexity O(p + r).
 */
export function describeAgentPluginCompatibility(
  { plugin, installed, activations }: {
    plugin: InstalledAgentPlugin; installed: readonly InstalledAgentPlugin[]; activations: AgentPluginActivations;
  },
  { hostVersion = AGENT_PLUGIN_CONTRACT_VERSION }: { hostVersion?: string } = {},
): AgentPluginCompatibility & { readonly origin: AgentPluginOrigin } {
  const activeProvides = providedBy({ plugins: activeOthers({ installed, activations, excludeId: plugin.pluginId }) });
  const origin = Object.hasOwn(activations.plugins, plugin.pluginId) ? activations.plugins[plugin.pluginId]!.origin : 'operator-installed';
  return { origin, ...checkAgentPluginCompatibility({ manifest: plugin, hostVersion, activeProvides }) };
}

/** Requirements of `dependent` that only the removed capabilities satisfied. */
function lostRequirements({ dependent, providers, removed }: {
  readonly dependent: InstalledAgentPlugin; readonly providers: readonly InstalledAgentPlugin[]; readonly removed: ReadonlySet<string>;
}): string[] {
  const available = new Set(providedBy({ plugins: providers.filter(provider => provider.pluginId !== dependent.pluginId) }));
  return [...new Set(dependent.requires ?? [])].filter(id => removed.has(id) && !available.has(id));
}

/** Names active dependents that would lose a capability after disabling or updating a provider.
 * Other enabled providers can satisfy the same requirement. Advisory only. @complexity O(p * (p + r)).
 */
export function agentPluginDependentWarnings(
  { plugin, installed, activations, nextProvides }: {
    plugin: InstalledAgentPlugin; installed: readonly InstalledAgentPlugin[];
    activations: AgentPluginActivations; nextProvides: readonly string[];
  }, _optional: Record<string, never> = {},
): string[] {
  const removed = new Set((plugin.provides ?? []).filter(id => !nextProvides.includes(id)));
  const others = activeOthers({ installed, activations, excludeId: plugin.pluginId });
  return others.flatMap(dependent => lostRequirements({ dependent, providers: others, removed })
    .map(id => `${dependent.pluginId} needs ${id}`));
}

/** Checks the declared host contract and advisory capabilities; never throws for a bad range.
 * Callers supply capabilities from other enabled plugins only (no self-satisfaction).
 * Uses `semver.satisfies` with default options, the same check site plugins apply to `sdkRange`.
 * @returns Compatibility plus unmet advisory requirements. @complexity O(r + p).
 */
export function checkAgentPluginCompatibility(
  { manifest, hostVersion, activeProvides }: {
    readonly manifest: { readonly hostRange?: string | undefined; readonly requires?: readonly string[] | undefined };
    readonly hostVersion: string;
    readonly activeProvides: readonly string[];
  },
  _optional: Record<string, never> = {},
): AgentPluginCompatibility {
  const available = new Set(activeProvides);
  const range = manifest.hostRange;
  const hostOk = range === undefined || (isValidAgentPluginHostRange({ range }) && semver.satisfies(hostVersion, range));
  return { hostOk, missingRequires: [...new Set(manifest.requires ?? [])].filter(id => !available.has(id)) };
}
