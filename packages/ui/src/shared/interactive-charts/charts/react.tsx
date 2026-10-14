/** The only React adapter for the vanilla chart lifecycle; providers own any internal roots. */
import { useEffect, useRef, type ComponentType, type ReactElement } from 'react';
import { z } from 'zod';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '../registry.js';
import { chartSpecSchema, DEFAULT_CHART_THEME, type ChartKind, type ChartSpec, type ChartTheme } from './contract.js';
import { mountChart, type MountedChart, type MountChartOptions } from './browser.js';
import { chartCapability, chartProvidersByKind, type ChartProviderRegistry } from './registry.js';
import { chartWireManifests, legacyChartSpec } from './wire.js';

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
    if (!element.current) return;
    const mounted = mountChart({ element: element.current, spec, registry }, {
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

/** Known wire kinds use the established shapes. Other providers register spec-based entries without
 * adding fields or kinds to the core grammar. This closure is built once per host snapshot.
 */
function chartComponent(kind: ChartKind, providers: ChartProviderRegistry, options: { siteProvider?: string | undefined; theme?: ChartTheme }): ComponentType<Record<string, unknown>> {
  return function RegisteredChart(props: Record<string, unknown>): ReactElement {
    const legacyKind = kind === 'bar' ? 'bar' : kind === 'line' ? 'line' : kind === 'pie' ? 'pie' : undefined;
    const spec = legacyKind ? legacyChartSpec({ kind: legacyKind, props }) : chartSpecSchema.parse(props.spec);
    return <ChartHost spec={spec} registry={providers} {...options} />;
  };
}

/** Create a snapshot for validation AND rendering. Resolve each legacy alias through its specific
 * capability, then copy its wire id onto that same entry (same schema and Component).
 * @example createChartInteractiveRegistry({ registry: base, providers }, { siteProvider: 'plugin.recharts' })
 */
export function createChartInteractiveRegistry(
  { registry, providers }: { registry: InteractiveUiRegistry; providers: ChartProviderRegistry },
  options: { siteProvider?: string | undefined; theme?: ChartTheme } = {},
): InteractiveUiRegistry {
  const kinds = [...new Set(['bar', 'line', 'pie', ...providers.list().flatMap(({ kinds }) => kinds)])];
  const entries: InteractiveComponentEntry[] = [];
  for (const kind of kinds) {
    const capability = chartCapability({ kind });
    const wire = chartWireManifests.find((manifest) => manifest.capabilities.includes(capability));
    const Component = chartComponent(kind, providers, options);
    const propsSchema = wire?.propsSchema ?? z.object({ spec: chartSpecSchema.extend({ kind: z.literal(kind) }) }).passthrough();
    const selected = chartProvidersByKind({ registry: providers, kind }, options);
    for (const provider of selected) entries.push({
      id: `${provider.id}.${capability}`, provider: provider.id, capabilities: ['chart', capability, 'graph'], propsSchema, Component,
    });
    if (wire) entries.push({ ...wire, id: `core.table.${capability}`, Component });
  }
  const existing = registry.list().filter(({ capabilities }) => !capabilities.includes('chart'));
  let snapshot = new InteractiveUiRegistry({ entries: [...entries, ...existing] });
  for (const wire of chartWireManifests) {
    const capability = wire.capabilities.find((capability) => capability.endsWith('-chart'))!;
    const selected = snapshot.resolveByCapability({ capability })[0]!;
    snapshot = snapshot.register({ entry: { ...selected, id: wire.id } });
  }
  return snapshot;
}
