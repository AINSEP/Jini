import { satisfies, validRange } from 'semver';
import type { AgentPluginManifest } from './manifest.js';
import type { InstalledAgentPlugin } from './types.js';
import type { AgentPluginActivations } from './activation.js';

/** Host extension contract, independent of product releases and the upstream manifest schema. */
export const AGENT_PLUGIN_CONTRACT_VERSION = '1.0.0';

/** Named refusal shared by HTTP and tool adapters. */
export class AgentPluginHostIncompatibleError extends Error {
  readonly code = 'PLUGIN_HOST_INCOMPATIBLE';
  constructor(required: { pluginId: string }, _optional: Record<string, never> = {}) {
    super(`Plugin '${required.pluginId}' is not compatible with this host's Agent Plugin contract.`);
    this.name = 'AgentPluginHostIncompatibleError';
  }
}

/** Projects live metadata, excluding disabled providers and the plugin itself.
 * @returns Origin, host compatibility, and advisory requirements. @complexity O(p + r).
 */
export function describeAgentPluginCompatibility(
  { plugin, installed, activations }: {
    plugin: InstalledAgentPlugin; installed: readonly InstalledAgentPlugin[]; activations: AgentPluginActivations;
  },
  { hostVersion = AGENT_PLUGIN_CONTRACT_VERSION }: { hostVersion?: string } = {},
) {
  const activeProvides = installed.filter(other => other.pluginId !== plugin.pluginId && activations.plugins[other.pluginId]?.enabled !== false)
    .flatMap(other => other.provides ?? []);
  return { origin: activations.plugins[plugin.pluginId]?.origin ?? 'operator-installed',
    ...checkAgentPluginCompatibility({ manifest: plugin, hostVersion, activeProvides }) };
}

/** Names active dependents that would lose a capability after disabling or updating a provider.
 * Other enabled providers can satisfy the same requirement. @complexity O(p * (p + r)).
 */
export function agentPluginDependentWarnings(
  { plugin, installed, activations, nextProvides }: {
    plugin: InstalledAgentPlugin; installed: readonly InstalledAgentPlugin[];
    activations: AgentPluginActivations; nextProvides: readonly string[];
  }, _optional: Record<string, never> = {},
): string[] {
  const removed = new Set((plugin.provides ?? []).filter(id => !nextProvides.includes(id)));
  return installed.filter(other => other.pluginId !== plugin.pluginId && activations.plugins[other.pluginId]?.enabled !== false)
    .flatMap(other => {
      const available = new Set(installed.filter(provider => provider.pluginId !== plugin.pluginId && provider.pluginId !== other.pluginId && activations.plugins[provider.pluginId]?.enabled !== false)
        .flatMap(provider => provider.provides ?? []));
      return (other.requires ?? []).filter(id => removed.has(id) && !available.has(id)).map(id => `${other.pluginId} needs ${id}`);
    });
}

export interface AgentPluginCompatibility {
  readonly hostOk: boolean;
  readonly missingRequires: readonly string[];
}

/** Checks the declared host contract and advisory capabilities; never throws for a bad range.
 * Callers supply capabilities from other enabled plugins only (no self-satisfaction).
 * @returns Compatibility plus unmet advisory requirements. @complexity O(r + p).
 */
export function checkAgentPluginCompatibility(
  { manifest, hostVersion, activeProvides }: {
    readonly manifest: Pick<AgentPluginManifest, 'hostRange' | 'requires'>;
    readonly hostVersion: string;
    readonly activeProvides: readonly string[];
  },
  _optional: Record<string, never> = {},
): AgentPluginCompatibility {
  const available = new Set(activeProvides);
  const hostOk = manifest.hostRange === undefined ||
    (manifest.hostRange.trim().length > 0 && validRange(manifest.hostRange) !== null && satisfies(hostVersion, manifest.hostRange));
  return { hostOk, missingRequires: [...new Set(manifest.requires ?? [])].filter(id => !available.has(id)) };
}

/** Reads metadata in the host-selected namespace. A present malformed range stays incompatible.
 * @returns Normalized advisory metadata and parse warnings. @complexity O(r).
 */
export function readAgentPluginCompatibilityMetadata(
  { extension }: { readonly extension: Readonly<Record<string, unknown>> },
  _optional: Record<string, never> = {},
): { requires?: readonly string[]; hostRange?: string; warnings: string[] } {
  const warnings: string[] = [];
  let requires: readonly string[] | undefined;
  if (extension.requires !== undefined) {
    if (Array.isArray(extension.requires) && extension.requires.every(id => typeof id === 'string' && id.trim().length > 0)) {
      requires = [...new Set<string>(extension.requires)];
    } else warnings.push('requires must be an array of non-empty capability ids');
  }
  let hostRange: string | undefined;
  if (extension.hostRange !== undefined) {
    // An empty string is a valid semver wildcard, so use an explicitly invalid sentinel.
    hostRange = typeof extension.hostRange === 'string' ? extension.hostRange : '<invalid>';
    if (!hostRange.trim() || validRange(hostRange) === null) {
      warnings.push('hostRange is invalid; enabling this plugin is refused');
      hostRange = '<invalid>';
    }
  }
  return { ...(requires === undefined ? {} : { requires }), ...(hostRange === undefined ? {} : { hostRange }), warnings };
}
