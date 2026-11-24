import type { ToolAccessChange } from '@jini-ai/core/contracts/site/daemon';
import type { PluginProviderFacesPort } from './service-ports.js';

/** Host effect used after saving a decision that lowers tool access. */
export type NotifyToolAccessChanged = (input?: { readonly lowered?: ToolAccessChange }) => Promise<void>;

/** A provider's OFF switch also turns its assistant faces off. Use the existing owner lookup once
 * on that explicit decision, never on the answer path. Failures keep the saved OFF decision visible.
 * `LoweringError` is the host's own "OFF saved but stop not confirmed" error class: the host's
 * routes recognise it by identity, so the host injects it rather than this module minting one.
 * @complexity O(linked faces) discovery from the existing provider owner, plus bounded Stop/cleanup. */
export async function lowerPluginToolAccess({ pluginId, providerFaces, notifyRosterChanged, LoweringError }: {
  pluginId: string; notifyRosterChanged: NotifyToolAccessChanged; providerFaces?: Pick<PluginProviderFacesPort, 'affectedPluginIds'>;
  LoweringError: new () => Error;
}, _optional = {}): Promise<void> {
  try {
    const pluginIds = await providerFaces?.affectedPluginIds?.({ pluginId }) ?? [pluginId];
    await notifyRosterChanged({ lowered: { pluginIds } });
  } catch { throw new LoweringError(); }
}
