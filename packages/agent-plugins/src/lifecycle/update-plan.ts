import * as semver from 'semver';
import type { InstalledAgentPlugin } from './types.js';

type Revision = Pick<InstalledAgentPlugin, 'pluginId' | 'archiveDigest' | 'version'> & { readonly enabled?: boolean };
export interface AgentPluginUpdatePlan {
  readonly action: 'none' | 'update' | 'downgrade-refused' | 'id-mismatch';
  readonly enabled: boolean;
  readonly warnings: readonly string[];
}

/** Manifest semver orders releases; digest identifies bytes. Unknown or equal versions require
 * an explicit replacement; automatic rollback bypasses planning. @complexity O(v) version length.
 */
export function planAgentPluginUpdate(
  { installed, candidate }: { readonly installed: Revision; readonly candidate: Revision },
  _optional: Record<string, never> = {},
): AgentPluginUpdatePlan {
  const enabled = installed.enabled === true;
  if (installed.pluginId !== candidate.pluginId) return { action: 'id-mismatch', enabled, warnings: [] };
  if (installed.archiveDigest === candidate.archiveDigest) return { action: 'none', enabled, warnings: [] };
  // `semver.valid` returns null for an absent version as well as a malformed one.
  const from = semver.valid(installed.version);
  const to = semver.valid(candidate.version);
  if (!from || !to) {
    return { action: 'update', enabled, warnings: ['Unknown release version; explicit replacement required.'] };
  }
  const order = semver.compare(to, from);
  if (order < 0) return { action: 'downgrade-refused', enabled, warnings: [] };
  return { action: 'update', enabled, warnings: order === 0 ? ['Same version with different bytes; explicit replacement required.'] : [] };
}
