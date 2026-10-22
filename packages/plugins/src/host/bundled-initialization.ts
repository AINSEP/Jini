/** Site-plugin defaults use the existing activation lifecycle, not the agent-plugin seed store. */
import { setPluginEnabled, type SetPluginEnabledDeps } from './activation.js';

export interface BundledInitializationResult {
  readonly enabled: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { pluginId: string; error: unknown }[];
}

/** Enable approved bundled ids only when NO row exists. Disabled, enabled and quarantined rows
 * remain authoritative. Boot failures are reported individually; activation owns compensation.
 * Composition must serialize this boot initializer with workspace activation changes.
 * @example initializeBundledPlugins({ deps, input: { workspaceId, pluginIds: ['charts-recharts'] } })
 */
export async function initializeBundledPlugins(
  { deps, input }: { deps: SetPluginEnabledDeps; input: { workspaceId: string; pluginIds: readonly string[] } },
  _options: Record<string, never> = {},
): Promise<BundledInitializationResult> {
  const enabled: string[] = []; const skipped: string[] = []; const failed: { pluginId: string; error: unknown }[] = [];
  for (const pluginId of new Set(input.pluginIds)) {
    try {
      if (await deps.repo.getActivation({ workspaceId: input.workspaceId, pluginId })) { skipped.push(pluginId); continue; }
      const bundled = deps.discovery.find((record) => record.id === pluginId && record.source === 'built-in');
      if (!bundled) { skipped.push(pluginId); continue; }
      await setPluginEnabled({ deps, input: { workspaceId: input.workspaceId, pluginId, enabled: true } });
      enabled.push(pluginId);
    } catch (error) { failed.push({ pluginId, error }); }
  }
  return { enabled, skipped, failed };
}
