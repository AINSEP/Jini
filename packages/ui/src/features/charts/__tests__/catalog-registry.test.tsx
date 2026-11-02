/** The browser registry is the headless catalog plus components: same ids, schemas and providers. */
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { z } from 'zod';
import { createChartInteractiveRegistry } from '../react.js';
import { chartCatalogManifests, createChartProviderRegistry, type ChartProviderEntry, type ChartSpec } from '../index.js';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '../../interactive-ui/registry.js';

function recorder(id: string, kinds: string[], mounted: { provider: string; spec: ChartSpec }[], enabled = true): ChartProviderEntry {
  return { id, kinds, enabled, load: async () => ({ mount: ({ spec, element }) => {
    mounted.push({ provider: id, spec }); element.textContent = `drawn by ${id}`;
    return { update() {}, destroy() {} };
  } }) };
}
const empty = new InteractiveUiRegistry({ entries: [] });
const multiSeries = {
  kind: 'bar', categoryKey: 'month', series: [{ key: 'revenue' }, { key: 'cost' }],
  data: [{ month: 'Sep', revenue: 4, cost: 2 }, { month: 'Oct', revenue: 9, cost: 3 }],
};

describe('createChartInteractiveRegistry attaches components to the catalog manifests', () => {
  it('lists exactly the catalog ids, schemas and providers, skipping disabled providers', () => {
    const mounted: { provider: string; spec: ChartSpec }[] = [];
    const providers = createChartProviderRegistry({ providers: [
      recorder('plugin.off', ['bar'], mounted, false), recorder('plugin.pie', ['pie'], mounted), recorder('plugin.site', ['bar', 'line', 'pie', 'calendar'], mounted),
    ] });
    const registry = createChartInteractiveRegistry({ registry: empty, providers }, { siteProvider: 'plugin.site' });
    const catalog = chartCatalogManifests({ providers: [{ id: 'plugin.pie', kinds: ['pie'] }, { id: 'plugin.site', kinds: ['bar', 'line', 'pie', 'calendar'] }] }, { siteProvider: 'plugin.site' });
    expect(registry.list().map(({ id, provider, capabilities }) => ({ id, provider, capabilities })))
      .toEqual(catalog.map(({ id, provider, capabilities }) => ({ id, provider, capabilities })));
    for (const entry of registry.list()) expect(typeof entry.Component).toBe('function');
    expect(registry.resolveById({ id: 'plugin.off.bar-chart' })).toBeNull();
    expect(registry.resolveById({ id: 'recharts.bar-chart' })!.propsSchema).toBe(registry.resolveById({ id: 'plugin.site.bar-chart' })!.propsSchema);
  });

  it('keeps non-chart entries and replaces earlier chart entries, chart.spec included', () => {
    const table = { id: 'native.data-table', provider: 'native', capabilities: ['data-table'], propsSchema: z.object({}), Component: () => null } satisfies InteractiveComponentEntry;
    const first = createChartInteractiveRegistry({ registry: new InteractiveUiRegistry({ entries: [table] }), providers: createChartProviderRegistry({ providers: [recorder('plugin.a', ['bar'], [])] }) });
    const next = createChartInteractiveRegistry({ registry: first, providers: createChartProviderRegistry({ providers: [] }) });
    expect(next.list().map(({ id }) => id)).toEqual(['recharts.bar-chart', 'recharts.line-chart', 'recharts.pie-chart', 'chart.spec', 'native.data-table']);
    expect(next.resolveById({ id: 'chart.spec' })?.provider).toBe('core.table');
  });

  it('renders chart.spec as the data table, every series a column, when no provider is enabled', async () => {
    const registry = createChartInteractiveRegistry({ registry: empty, providers: createChartProviderRegistry({ providers: [recorder('plugin.off', ['bar'], [], false)] }) });
    const { Component } = registry.resolveById({ id: 'chart.spec' })!;
    const view = render(<Component spec={multiSeries} />);
    await waitFor(() => expect(view.container.querySelector('table')).not.toBeNull());
    expect([...view.container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['month', 'Revenue', 'Cost']);
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('draws chart.spec with the provider the spec prefers, passing every series through', async () => {
    const mounted: { provider: string; spec: ChartSpec }[] = [];
    const providers = createChartProviderRegistry({ providers: [recorder('plugin.first', ['bar'], mounted), recorder('plugin.second', ['bar'], mounted)] });
    const { Component } = createChartInteractiveRegistry({ registry: empty, providers }).resolveById({ id: 'chart.spec' })!;
    const view = render(<Component spec={{ ...multiSeries, provider: 'plugin.second' }} />);
    await waitFor(() => expect(mounted).toHaveLength(1));
    expect(mounted[0]!.provider).toBe('plugin.second');
    expect(mounted[0]!.spec.series).toEqual([{ key: 'revenue', label: 'Revenue' }, { key: 'cost', label: 'Cost' }]);
    await waitFor(() => expect(view.container.textContent).toContain('drawn by plugin.second'));
  });

  it('draws a provider entry with its own provider while the other enabled provider is the site default', async () => {
    const mounted: { provider: string; spec: ChartSpec }[] = [];
    const providers = createChartProviderRegistry({ providers: [recorder('plugin.default', ['bar', 'calendar'], mounted), recorder('plugin.other', ['bar', 'calendar'], mounted)] });
    const registry = createChartInteractiveRegistry({ registry: empty, providers }, { siteProvider: 'plugin.default' });
    const bar = registry.resolveById({ id: 'plugin.other.bar-chart' })!;
    const calendar = registry.resolveById({ id: 'plugin.other.calendar-chart' })!;
    const legacy = registry.resolveById({ id: 'recharts.bar-chart' })!;
    const barProps = { data: [{ month: 'Sep', revenue: 4 }], categoryKey: 'month', valueKey: 'revenue' };
    render(<bar.Component {...barProps} />);
    render(<calendar.Component spec={{ ...multiSeries, kind: 'calendar' }} />);
    render(<legacy.Component {...barProps} />);
    await waitFor(() => expect(mounted).toHaveLength(3));
    expect(mounted.map(({ provider, spec }) => [spec.kind, provider]).sort()).toEqual([['bar', 'plugin.default'], ['bar', 'plugin.other'], ['calendar', 'plugin.other']]);
  });

  it('falls back to the table when no provider draws the spec kind', async () => {
    const mounted: { provider: string; spec: ChartSpec }[] = [];
    const providers = createChartProviderRegistry({ providers: [recorder('plugin.bars', ['bar'], mounted)] });
    const { Component } = createChartInteractiveRegistry({ registry: empty, providers }).resolveById({ id: 'chart.spec' })!;
    const view = render(<Component spec={{ ...multiSeries, kind: 'radar' }} />);
    await waitFor(() => expect(view.container.querySelector('table')).not.toBeNull());
    expect(mounted).toEqual([]);
  });
});
