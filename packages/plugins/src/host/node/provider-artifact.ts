/** Provider artifacts outside a site reuse the ordered loader and the provider resource host. */
import { createPluginContributionRegistry } from '../contributions.js';
import { createPluginProviderHost, type PluginProviderContract } from '../provider-host.js';
import type { PluginProviderResource } from '../provider-contributions.js';
import type { HookPoints } from '../ports.js';
import { loadPlugin, type LoadPluginRequired } from './loader.js';

/**
 * Load one already-discovered provider artifact and initialize its selected contract.
 * Required `load` supplies the existing SDK, digest, import and tier-admission ports; no site,
 * activation store or ambient provider state is required. Integrity still precedes import.
 * @returns The validated port and an idempotent shutdown that releases its provider host.
 * @throws On invalid discovery, failed load or initialization, after releasing owned resources.
 * @complexity O(artifact bytes) for existing integrity checks, plus plugin-defined setup work.
 */
export async function loadProviderPluginArtifact<H extends HookPoints>(required: {
  load: Omit<LoadPluginRequired<H>, 'providerContributions'>;
  contracts: readonly PluginProviderContract[];
  contract: string; id: string; input: Readonly<Record<string, unknown>>;
}, optional: {
  factoryOptions?: Readonly<Record<string, unknown>>;
} = {}): Promise<PluginProviderResource> {
  if (required.load.record.status !== 'valid') throw new Error('provider artifact discovery failed');
  const contributions = createPluginContributionRegistry({});
  const host = createPluginProviderHost({ contributions, contracts: required.contracts });
  try {
    const loaded = await loadPlugin({ ...required.load, providerContributions: { registry: contributions, isSelected: () => true } });
    if (!loaded.loaded) throw new Error(`provider artifact load failed: ${loaded.reason}`);
    const resource = await host.initialize({ contract: required.contract, id: required.id, input: required.input }, {
      ...(optional.factoryOptions === undefined ? {} : { factoryOptions: optional.factoryOptions }),
    });
    if (!resource) throw new Error('provider artifact did not supply the selected provider');
    return { port: resource.port, dispose: () => host.dispose({}) };
  } catch (error) {
    await host.dispose({});
    throw error;
  }
}
