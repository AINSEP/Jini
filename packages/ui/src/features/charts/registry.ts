/** Capability ordering belongs to InteractiveUiRegistry, including framework-neutral entries. */
import { z } from 'zod';
import { InteractiveUiRegistry } from '../interactive-ui/registry.js';
import type { InteractiveComponentManifest } from '../interactive-ui/types.js';
import type { ChartKind, ChartProviderEntry, ChartSpec } from './contract.js';

export type RegisteredChartProvider = ChartProviderEntry & InteractiveComponentManifest;
export type ChartProviderRegistry = InteractiveUiRegistry<RegisteredChartProvider>;

/** Each kind has a distinct capability, so a pie-only provider can never satisfy a bar request. */
export function chartCapability({ kind }: { kind: ChartKind }, _options: Record<string, never> = {}): string {
  return `${kind}-chart`;
}

/** Register providers in host-supplied preference order, reusing immutable replacement by id.
 * @example createChartProviderRegistry({ providers: admittedProviders })
 */
export function createChartProviderRegistry(
  { providers }: { providers: readonly ChartProviderEntry[] }, _options: Record<string, never> = {},
): ChartProviderRegistry {
  let registry = new InteractiveUiRegistry<RegisteredChartProvider>({ entries: [] });
  for (const provider of providers) {
    registry = registry.register({ entry: {
      ...provider, provider: provider.id, kinds: Object.freeze([...provider.kinds]),
      capabilities: provider.kinds.map((kind) => chartCapability({ kind })), propsSchema: z.object({}),
    } });
  }
  return registry;
}

/** Apply the two explicit pins to the registry's capability order. Both catalog snapshots and
 * runtime rendering use this owner; catalog construction never probes supports with invented data.
 */
export function chartProvidersByKind(
  { registry, kind }: { registry: ChartProviderRegistry; kind: ChartKind },
  { provider, siteProvider }: { provider?: string | undefined; siteProvider?: string | undefined } = {},
): readonly RegisteredChartProvider[] {
  const candidates = registry.resolveByCapability({ capability: chartCapability({ kind }) }).filter((entry) => entry.enabled);
  const pinned = [provider, siteProvider].flatMap((id) => candidates.filter((entry) => entry.id === id));
  return [...new Set([...pinned, ...candidates])];
}

/** Skip unsupported specs after ordering. The browser supplies the final core table when this
 * chain exhausts; provider capability declarations can include any non-empty kind.
 */
export function selectChartProviders(
  { registry, spec }: { registry: ChartProviderRegistry; spec: ChartSpec },
  { siteProvider }: { siteProvider?: string | undefined } = {},
): readonly RegisteredChartProvider[] {
  return chartProvidersByKind({ registry, kind: spec.kind }, { provider: spec.provider, siteProvider })
    .filter((entry) => entry.supports?.({ spec }) ?? true);
}
