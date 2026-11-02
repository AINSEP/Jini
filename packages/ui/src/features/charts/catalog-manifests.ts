/** The one headless owner of chart catalog entries. The browser registry attaches components to
 * these exact entries; a server catalog serves them as they are. React-free and DOM-free.
 */
import { z } from 'zod';
import type { InteractiveComponentManifest } from '../interactive-ui/types.js';
import { chartSpecSchema, type ChartKind } from './contract.js';
import { chartCapability, chartProvidersByKind, createChartProviderRegistry, type ChartProviderRegistry } from './registry.js';
import { chartSpecPropsSchema, chartWireManifests } from './wire.js';

/** What a catalog needs to know about an admitted provider: no code, no URLs. */
export interface ChartCatalogProvider {
  readonly id: string;
  readonly kinds: readonly ChartKind[];
}

/** Stable id for the generic multi-series entry. It exists with zero providers (it renders as a table). */
export const CHART_SPEC_COMPONENT_ID = 'chart.spec';
/** Provider id the catalog reports when no admitted provider draws a kind. */
export const CHART_TABLE_PROVIDER = 'core.table';
const LEGACY_KINDS: readonly ChartKind[] = ['bar', 'line', 'pie'];

/** Catalog selection only needs ids and kinds; provider code always loads in the browser. */
function catalogProviderRegistry(
  { providers }: { providers: readonly ChartCatalogProvider[] }, _options: Record<string, never> = {},
): ChartProviderRegistry {
  return createChartProviderRegistry({ providers: providers.map(({ id, kinds }) => ({
    id, kinds, enabled: true, load: () => Promise.reject(new Error('Chart catalogs list providers; they never load them.')),
  })) });
}

type WireManifest = (typeof chartWireManifests)[number];

/** Legacy kinds keep their wire schema (shared by reference); other kinds take `{ spec }` of that kind. */
function kindPropsSchema(
  { kind }: { kind: ChartKind }, { wire }: { wire?: WireManifest | undefined } = {},
): z.ZodTypeAny {
  return wire?.propsSchema ?? z.object({ spec: chartSpecSchema.extend({ kind: z.literal(kind) }) }).passthrough();
}

function providerDescription(
  { kind, provider }: { kind: ChartKind; provider: string }, { wire }: { wire?: WireManifest | undefined } = {},
): string {
  const props = wire ? `Same props as ${wire.id} (one series)` : `Props: { spec } with spec.kind "${kind}"`;
  return `${kind} chart drawn by ${provider}. ${props}. For several series use ${CHART_SPEC_COMPONENT_ID}.`;
}

function specDescription({ kinds }: { kinds: readonly ChartKind[] }, _options: Record<string, never> = {}): string {
  const drawn = kinds.length > 0
    ? `Kinds the enabled chart providers draw: ${kinds.join(', ')}. Other kinds show the data as a table.`
    : 'No chart provider is enabled, so the data shows as a table.';
  return 'Any chart from one neutral spec, with one or more series: { spec: { kind, data: rows, categoryKey, '
    + 'series: [{ key, label? }] } }. Every row carries the category and a number (or null) for every series key. '
    + `Set spec.provider to prefer one provider. ${drawn}`;
}

/** The provider the generic entry reports: the site default when admitted, else the first admitted one. */
function specProvider(
  { providers }: { providers: readonly ChartCatalogProvider[] },
  { siteProvider }: { siteProvider?: string | undefined } = {},
): string {
  return (providers.find(({ id }) => id === siteProvider) ?? providers[0])?.id ?? CHART_TABLE_PROVIDER;
}

/**
 * Build every chart entry for the current admitted providers:
 * - one `<provider>.<kind>-chart` entry per provider and kind it draws, in selection order;
 * - the legacy wire entries (unchanged ids, schemas and descriptions), reporting the selected provider;
 * - `chart.spec`, present even with no provider.
 * @complexity O(k * p) for k kinds and p providers.
 * @example chartCatalogManifests({ providers: [{ id: 'plugin.charts', kinds: ['bar'] }] }, { siteProvider: 'plugin.charts' })
 */
export function chartCatalogManifests(
  { providers }: { providers: readonly ChartCatalogProvider[] },
  { siteProvider }: { siteProvider?: string | undefined } = {},
): readonly InteractiveComponentManifest[] {
  const registry = catalogProviderRegistry({ providers });
  const admitted = registry.list();
  const kinds = [...new Set([...LEGACY_KINDS, ...admitted.flatMap(({ kinds }) => kinds)])];
  const manifests: InteractiveComponentManifest[] = [];
  for (const kind of kinds) {
    const capability = chartCapability({ kind });
    const wire = chartWireManifests.find((manifest) => manifest.capabilities.includes(capability));
    const propsSchema = kindPropsSchema({ kind }, { wire });
    const selected = chartProvidersByKind({ registry, kind }, { siteProvider });
    // A provider literally named like a legacy prefix would mint the wire id twice; the wire entry wins.
    for (const { id } of selected.filter((provider) => `${provider.id}.${capability}` !== wire?.id)) manifests.push({
      id: `${id}.${capability}`, provider: id, capabilities: ['chart', capability, 'graph'], propsSchema,
      description: providerDescription({ kind, provider: id }, { wire }),
    });
    if (wire) manifests.push({ ...wire, provider: selected[0]?.id ?? CHART_TABLE_PROVIDER });
  }
  manifests.push({
    id: CHART_SPEC_COMPONENT_ID, provider: specProvider({ providers: admitted }, { siteProvider }),
    capabilities: ['chart', 'chart-spec'], propsSchema: chartSpecPropsSchema,
    description: specDescription({ kinds: [...new Set(admitted.flatMap(({ kinds }) => kinds))] }),
  });
  return manifests;
}
