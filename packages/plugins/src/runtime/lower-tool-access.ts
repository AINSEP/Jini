import { ToolAccessLoweringError, type NotifyToolAccessChanged } from '@jini-ai/core/tool-access-change';

/** The provider-to-assistant-face lookup this lowering needs; the host's provider-faces port satisfies it structurally. */
export interface LowerToolAccessProviderFaces {
  /** A provider switch covers itself and its linked assistant faces. Used only by explicit OFF. */
  affectedPluginIds?(input: { pluginId: string }, options?: Record<string, never>): Promise<readonly string[]>;
}

/** A provider's OFF switch also turns its assistant faces off. Use the existing owner lookup once
 * on that explicit decision, never on the answer path. Failures keep the saved OFF decision visible.
 * @complexity O(linked faces) discovery from the existing provider owner, plus bounded Stop/cleanup. */
export async function lowerPluginToolAccess({ pluginId, providerFaces, notifyRosterChanged }: {
  pluginId: string; notifyRosterChanged: NotifyToolAccessChanged; providerFaces?: LowerToolAccessProviderFaces;
}, _optional = {}): Promise<void> {
  try {
    const pluginIds = await providerFaces?.affectedPluginIds?.({ pluginId }) ?? [pluginId];
    await notifyRosterChanged({ lowered: { pluginIds } });
  } catch { throw new ToolAccessLoweringError(); }
}
