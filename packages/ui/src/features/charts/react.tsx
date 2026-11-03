/** The only React adapter for the vanilla chart lifecycle; providers own any internal roots. */
import { useEffect, useRef, type ComponentType, type ReactElement } from 'react';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '../interactive-ui/registry.js';
import type { InteractiveComponentManifest } from '../interactive-ui/types.js';
import { chartSpecSchema, DEFAULT_CHART_THEME, type ChartSpec, type ChartTheme } from './contract.js';
import { mountChart, type MountedChart, type MountChartOptions } from './browser.js';
import { CHART_SPEC_COMPONENT_ID, chartCatalogManifests } from './catalog-manifests.js';
import { chartCapability, type ChartProviderRegistry } from './registry.js';
import { chartSpecPropsSchema, chartWireManifests, legacyChartSpec, withSeriesLabels } from './wire.js';

export interface ChartHostProps {
  readonly spec: ChartSpec;
  readonly registry: ChartProviderRegistry;
  readonly theme?: ChartTheme;
  readonly siteProvider?: string | undefined;
  readonly onProviderError?: MountChartOptions['onProviderError'];
}

/** React owns only the container; mountChart owns its descendants and lifecycle. */
export function ChartHost({ spec, registry, theme = DEFAULT_CHART_THEME, siteProvider, onProviderError }: ChartHostProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<MountedChart | undefined>(undefined);
  const previous = useRef({ spec, theme });
  useEffect(() => {
    // The container `<div>` below is rendered unconditionally, so React has always attached the ref
    // by the time this effect runs; the old `if (!element.current) return` could never fire.
    const mounted = mountChart({ element: element.current!, spec, registry }, {
      theme, siteProvider, ...(onProviderError ? { onProviderError } : {}),
    });
    instance.current = mounted; previous.current = { spec, theme };
    return () => { mounted.destroy({}); instance.current = undefined; };
    // Registry snapshots and site defaults define a lifecycle. Data/theme changes use update below.
  }, [registry, siteProvider, onProviderError]);
  useEffect(() => {
    if (previous.current.spec === spec && previous.current.theme === theme) return;
    previous.current = { spec, theme }; void instance.current?.update({ spec, theme });
  }, [spec, theme]);
  return <div ref={element} className="jini-chart-host" />;
}

/** Wire kinds that predate spec-based entries and keep their established prop shapes. */
const LEGACY_CHART_KINDS = ['bar', 'line', 'pie'] as const;
type LegacyChartKind = (typeof LEGACY_CHART_KINDS)[number];
type ChartHostOptions = { siteProvider?: string | undefined; theme?: ChartTheme };

/** Known wire kinds use the established shapes. Every other entry, `chart.spec` included, takes
 * `{ spec }`, so providers add kinds without adding fields or kinds to the core grammar.
 * A `<provider>.<kind>-chart` entry passes its `provider`, so it draws with the provider it
 * advertises rather than the site default; wire aliases and `chart.spec` keep generic selection.
 */
function chartComponent(
  { legacyKind, providers, provider }: { legacyKind: LegacyChartKind | undefined; providers: ChartProviderRegistry; provider: string | undefined },
  options: ChartHostOptions,
): ComponentType<Record<string, unknown>> {
  return function RegisteredChart(props: Record<string, unknown>): ReactElement {
    // chart.spec has stricter row/series rules; provider-only kinds retain their own contract.
    const parsed = legacyKind ? legacyChartSpec({ kind: legacyKind, props })
      : provider ? chartSpecSchema.parse(props.spec) : chartSpecPropsSchema.parse(props).spec;
    const spec = withSeriesLabels({ spec: provider ? { ...parsed, provider } : parsed });
    return <ChartHost spec={spec} registry={providers} {...options} />;
  };
}

/** The provider a provider-specific entry draws with; undefined for wire aliases and `chart.spec`. */
function explicitProviderOf({ manifest }: { manifest: InteractiveComponentManifest }, _options: Record<string, never> = {}): string | undefined {
  const generic = manifest.id === CHART_SPEC_COMPONENT_ID || chartWireManifests.some(({ id }) => id === manifest.id);
  return generic ? undefined : manifest.provider;
}

/** The legacy kind an entry draws, read from its specific `<kind>-chart` capability. */
function legacyKindOf({ manifest }: { manifest: InteractiveComponentManifest }, _options: Record<string, never> = {}): LegacyChartKind | undefined {
  const capability = manifest.capabilities.find((candidate) => candidate.endsWith('-chart'));
  return LEGACY_CHART_KINDS.find((kind) => chartCapability({ kind }) === capability);
}

/** Create a snapshot for validation AND rendering. The entries are exactly the headless catalog
 * manifests (same ids, schemas and providers), each with a component; components are shared per
 * (legacy kind, explicit provider), so a provider entry never draws with another provider.
 * This closure is built once per host snapshot.
 * @example createChartInteractiveRegistry({ registry: base, providers }, { siteProvider: 'plugin.recharts' })
 */
export function createChartInteractiveRegistry(
  { registry, providers }: { registry: InteractiveUiRegistry; providers: ChartProviderRegistry },
  options: ChartHostOptions = {},
): InteractiveUiRegistry {
  const admitted = providers.list().filter(({ enabled }) => enabled).map(({ id, kinds }) => ({ id, kinds }));
  const manifests = chartCatalogManifests({ providers: admitted }, { siteProvider: options.siteProvider });
  const components = new Map<string, ComponentType<Record<string, unknown>>>();
  const componentFor = (manifest: InteractiveComponentManifest): ComponentType<Record<string, unknown>> => {
    const legacyKind = legacyKindOf({ manifest });
    const provider = explicitProviderOf({ manifest });
    const key = JSON.stringify([legacyKind ?? null, provider ?? null]);
    const component = components.get(key) ?? chartComponent({ legacyKind, providers, provider }, options);
    components.set(key, component);
    return component;
  };
  const entries: InteractiveComponentEntry[] = manifests.map((manifest) => ({ ...manifest, Component: componentFor(manifest) }));
  const existing = registry.list().filter(({ capabilities }) => !capabilities.includes('chart'));
  return new InteractiveUiRegistry({ entries: [...entries, ...existing] });
}
