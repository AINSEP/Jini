// @vitest-environment node
/** The headless catalog owner: per-provider entries, unchanged legacy wire entries, and `chart.spec`. */
import { describe, expect, it } from 'vitest';
import {
  CHART_SPEC_COMPONENT_ID, chartCatalogManifests, chartSpecPropsSchema, chartWireManifests,
  rechartsBarChartManifest, rechartsLineChartManifest, rechartsPieChartManifest, type ChartCatalogProvider,
} from '../index.js';

const LEGACY_IDS = ['recharts.bar-chart', 'recharts.line-chart', 'recharts.pie-chart'];
const ids = (providers: readonly ChartCatalogProvider[], siteProvider?: string) => chartCatalogManifests({ providers }, { siteProvider }).map(({ id }) => id);
const byId = (providers: readonly ChartCatalogProvider[], siteProvider?: string) =>
  new Map(chartCatalogManifests({ providers }, { siteProvider }).map((manifest) => [manifest.id, manifest]));

describe('chartCatalogManifests per provider set', () => {
  it('with zero providers lists the legacy entries on the table and chart.spec', () => {
    expect(ids([])).toEqual([...LEGACY_IDS, 'chart.spec']);
    const manifests = byId([]);
    for (const id of LEGACY_IDS) expect(manifests.get(id)?.provider).toBe('core.table');
    const spec = manifests.get(CHART_SPEC_COMPONENT_ID)!;
    expect(spec.provider).toBe('core.table');
    expect(spec.capabilities).toEqual(['chart', 'chart-spec']);
    expect(spec.propsSchema).toBe(chartSpecPropsSchema);
    expect(spec.description).toContain('table');
  });

  it('keeps every legacy id, schema, capability list and description unchanged; only the provider moves', () => {
    const manifests = byId([{ id: 'plugin.draw', kinds: ['bar', 'line', 'pie'] }]);
    for (const wire of [rechartsBarChartManifest, rechartsLineChartManifest, rechartsPieChartManifest]) {
      expect(manifests.get(wire.id)).toEqual({ ...wire, provider: 'plugin.draw' });
      expect(manifests.get(wire.id)!.propsSchema).toBe(wire.propsSchema);
    }
    // The exported wire manifests themselves stay pinned to the table (no mutation through the builder).
    expect(chartWireManifests.map(({ provider }) => provider)).toEqual(['core.table', 'core.table', 'core.table']);
    expect(rechartsBarChartManifest.description).toBe('Bar chart: one categorical axis and one numeric value per bar. Uses an enabled chart provider or a styled data table.');
  });

  it('adds one described entry per provider and kind, sharing the legacy schema by reference', () => {
    expect(ids([{ id: 'plugin.draw', kinds: ['bar', 'line', 'pie'] }])).toEqual([
      'plugin.draw.bar-chart', 'recharts.bar-chart', 'plugin.draw.line-chart', 'recharts.line-chart',
      'plugin.draw.pie-chart', 'recharts.pie-chart', 'chart.spec',
    ]);
    const entry = byId([{ id: 'plugin.draw', kinds: ['bar'] }]).get('plugin.draw.bar-chart')!;
    expect(entry).toMatchObject({ provider: 'plugin.draw', capabilities: ['chart', 'bar-chart', 'graph'] });
    expect(entry.propsSchema).toBe(rechartsBarChartManifest.propsSchema);
    expect(entry.description).toContain('plugin.draw');
    expect(entry.description).toContain('chart.spec');
  });

  it('puts the site default first for every kind it draws, and on chart.spec', () => {
    const providers = [{ id: 'plugin.pie', kinds: ['pie'] }, { id: 'plugin.site', kinds: ['bar', 'line', 'pie'] }];
    const pinned = byId(providers, 'plugin.site');
    expect(pinned.get('recharts.pie-chart')?.provider).toBe('plugin.site');
    expect(pinned.get('chart.spec')?.provider).toBe('plugin.site');
    expect(ids(providers, 'plugin.site').filter((id) => id.endsWith('.pie-chart'))).toEqual(['plugin.site.pie-chart', 'plugin.pie.pie-chart', 'recharts.pie-chart']);
    const unpinned = byId(providers);
    expect(unpinned.get('recharts.pie-chart')?.provider).toBe('plugin.pie');
    expect(unpinned.get('chart.spec')?.provider).toBe('plugin.pie');
  });

  it('ignores a site default that is not admitted', () => {
    const manifests = byId([{ id: 'plugin.draw', kinds: ['bar'] }], 'plugin.disabled');
    expect(manifests.get('recharts.bar-chart')?.provider).toBe('plugin.draw');
    expect(manifests.get('recharts.line-chart')?.provider).toBe('core.table');
    expect(manifests.get('chart.spec')?.provider).toBe('plugin.draw');
  });

  it('gives provider-only kinds a spec schema for that kind, and lists drawn kinds on chart.spec', () => {
    const manifests = byId([{ id: 'plugin.extra', kinds: ['line', 'calendar'] }]);
    const calendar = manifests.get('plugin.extra.calendar-chart')!;
    expect(calendar.capabilities).toEqual(['chart', 'calendar-chart', 'graph']);
    const spec = { data: [{ day: '2026-11-01', visits: 3 }], categoryKey: 'day', series: [{ key: 'visits' }] };
    expect(calendar.propsSchema.safeParse({ spec: { ...spec, kind: 'calendar' } }).success).toBe(true);
    expect(calendar.propsSchema.safeParse({ spec: { ...spec, kind: 'bar' } }).success).toBe(false);
    expect(manifests.get('chart.spec')?.description).toContain('line, calendar');
  });

  it('never lists one id twice, even when a provider id equals a legacy prefix', () => {
    const list = ids([{ id: 'recharts', kinds: ['bar'] }, { id: 'recharts', kinds: ['bar', 'line'] }]);
    expect(new Set(list).size).toBe(list.length);
    expect(byId([{ id: 'recharts', kinds: ['bar'] }]).get('recharts.bar-chart')).toEqual({ ...rechartsBarChartManifest, provider: 'recharts' });
  });
});

describe('chart.spec multi-series props', () => {
  const rows = [{ month: 'Sep', revenue: 4, cost: 2 }, { month: 'Oct', revenue: 9, cost: null }];
  const valid = { kind: 'bar', data: rows, categoryKey: 'month', series: [{ key: 'revenue', label: 'Revenue' }, { key: 'cost' }] };
  const issues = (spec: Record<string, unknown>) => {
    const result = chartSpecPropsSchema.safeParse({ spec });
    return result.success ? [] : result.error.issues.map(({ path, message }) => ({ path, message }));
  };

  it('accepts several series, null gaps, any kind and a provider preference', () => {
    expect(issues(valid)).toEqual([]);
    expect(issues({ ...valid, kind: 'heatmap', provider: 'plugin.extra' })).toEqual([]);
  });

  it('rejects empty series and empty data', () => {
    expect(issues({ ...valid, series: [] })).not.toEqual([]);
    expect(issues({ ...valid, data: [] })).not.toEqual([]);
  });

  it('rejects mismatched lengths: a row without one of the series', () => {
    expect(issues({ ...valid, data: [rows[0], { month: 'Oct', revenue: 9 }] })).toEqual([
      { path: ['spec', 'data', 1, 'cost'], message: 'Row 1 "cost" is missing; every row needs it.' },
    ]);
  });

  it('rejects non-numeric series values, reporting the first bad row only', () => {
    for (const bad of ['12', true, { amount: 1 }, [1]]) {
      expect(issues({ ...valid, data: [{ month: 'Sep', revenue: bad, cost: 1 }] })).toEqual([
        { path: ['spec', 'data', 0, 'revenue'], message: 'Row 0 "revenue" is not a number or null; every row needs it.' },
      ]);
    }
    const strings = Array.from({ length: 500 }, (_, index) => ({ month: String(index), revenue: 'n/a', cost: 1 }));
    expect(issues({ ...valid, data: strings })).toHaveLength(1);
  });

  it('rejects non-finite numbers through the contract', () => {
    expect(issues({ ...valid, data: [{ month: 'Sep', revenue: Number.POSITIVE_INFINITY, cost: 1 }] })).not.toEqual([]);
    expect(issues({ ...valid, data: [{ month: 'Sep', revenue: Number.NaN, cost: 1 }] })).not.toEqual([]);
  });

  it('rejects a missing or non-scalar category and duplicate series keys', () => {
    expect(issues({ ...valid, data: [{ revenue: 1, cost: 1 }] })).toEqual([
      { path: ['spec', 'data', 0, 'month'], message: 'Row 0 "month" is missing; every row needs it.' },
    ]);
    expect(issues({ ...valid, data: [{ month: null, revenue: 1, cost: 1 }] })[0]?.message).toBe('Row 0 "month" is not a string or number; every row needs it.');
    expect(issues({ ...valid, series: [{ key: 'revenue' }, { key: 'revenue' }] })).toEqual([
      { path: ['spec', 'series'], message: 'Series key "revenue" is listed twice.' },
    ]);
  });

  it('rejects fields outside the neutral contract', () => {
    expect(issues({ ...valid, stacked: true })).not.toEqual([]);
    expect(issues({ ...valid, series: [{ key: 'revenue', fill: '#000' }] })).not.toEqual([]);
    expect(issues({ ...valid, kind: '' })).not.toEqual([]);
  });
});
