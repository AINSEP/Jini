import './dom-setup.js';
import { describe, expect, it } from 'vitest';
import { chartCatalogManifests, createChartProviderRegistry, type ChartSpec } from '@jini-ai/ui/charts';
import { mountChart } from '@jini-ai/ui/charts/browser';
import { mount, supportsEChartsSpec, ECHARTS_PROVIDER_ID, ECHARTS_KINDS } from '../client/provider.js';

function registry() {
  return createChartProviderRegistry({ providers: [{ id: ECHARTS_PROVIDER_ID, kinds: ECHARTS_KINDS, enabled: true, supports: supportsEChartsSpec, load: async () => ({ mount }) }] });
}
const stacked: ChartSpec = {
  kind: 'stacked-bar', categoryKey: 'month', series: [{ key: 'revenue' }, { key: 'cost' }],
  data: [{ month: 'Jan', revenue: 100, cost: 60 }, { month: 'Feb', revenue: 150, cost: 70 }],
};

describe('ECharts artifact through the neutral UI chart host', () => {
  it('draws a multi-series spec pinned to plugin.echarts and hides the data table once drawn', async () => {
    const element = document.createElement('div'); document.body.append(element);
    const chart = mountChart({ element, spec: { ...stacked, provider: ECHARTS_PROVIDER_ID }, registry: registry() });
    await chart.ready;
    expect(element.querySelector('figure')?.dataset.chartProvider).toBe('plugin.echarts');
    expect(element.querySelector('svg')).not.toBeNull();
    expect(element.querySelector<HTMLElement>('[data-chart-fallback]')!.hidden).toBe(true);
    // An update to another kind stays on the same provider and its replaced series.
    await chart.update({ spec: { kind: 'donut', categoryKey: 'month', series: [{ key: 'revenue' }], data: stacked.data } });
    expect(element.querySelector('figure')?.dataset.chartProvider).toBe('plugin.echarts');
    expect(element.querySelector<HTMLElement>('[data-chart-fallback]')!.hidden).toBe(true);
    chart.destroy({});
    expect(element.children).toHaveLength(0);
  });

  it('leaves a spec it refuses to the core data table, with every row visible', async () => {
    const element = document.createElement('div'); document.body.append(element);
    const negativePie: ChartSpec = { kind: 'pie', categoryKey: 'status', series: [{ key: 'count' }], data: [{ status: 'Draft', count: -2 }, { status: 'Published', count: 5 }] };
    const chart = mountChart({ element, spec: negativePie, registry: registry() });
    await chart.ready;
    expect(element.querySelector('figure')).toBeNull();
    const fallback = element.querySelector<HTMLElement>('[data-chart-fallback]')!;
    expect(fallback.hidden).toBe(false);
    expect(fallback.querySelectorAll('tbody tr')).toHaveLength(2);
    chart.destroy({});
  });

  it.each(['pie', 'donut'])('renders multi-series %s and falls back to all table cells when category coverage no longer matches', async (kind) => {
    const element = document.createElement('div'); document.body.append(element);
    const spec: ChartSpec = { ...stacked, kind, provider: ECHARTS_PROVIDER_ID };
    const chart = mountChart({ element, spec, registry: registry() });
    await chart.ready;
    expect(element.querySelector('svg')).not.toBeNull();
    expect(element.querySelector<HTMLElement>('[data-chart-fallback]')!.hidden).toBe(true);
    const data: ChartSpec['data'] = [{ month: 'Jan', revenue: 100 }, { month: 'Feb', cost: 70 }];
    await chart.update({ spec: { ...spec, data } });
    expect(element.querySelector('figure')).toBeNull();
    const fallback = element.querySelector<HTMLElement>('[data-chart-fallback]')!;
    expect(fallback.hidden).toBe(false);
    expect(Array.from(fallback.querySelectorAll('tbody tr'), (row) => Array.from(row.querySelectorAll('td'), (cell) => cell.textContent))).toEqual([
      ['Jan', '100', ''], ['Feb', '', '70'],
    ]);
    chart.destroy({});
  });

  it('is listed in the chart catalog for each of its kinds', () => {
    const manifests = chartCatalogManifests({ providers: [{ id: ECHARTS_PROVIDER_ID, kinds: ECHARTS_KINDS }] });
    const ids = manifests.map(({ id }) => id);
    for (const kind of ECHARTS_KINDS) expect(ids).toContain(`${ECHARTS_PROVIDER_ID}.${kind}-chart`);
    expect(ids).toContain('chart.spec');
  });
});
