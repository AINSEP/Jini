import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '@jini-ai/ui/charts';
import { ECHARTS_KINDS, ECHARTS_PROVIDER_ID, supportsEChartsSpec } from '../client/provider.js';

const sales: ChartSpec = {
  kind: 'bar', categoryKey: 'month', series: [{ key: 'revenue' }, { key: 'cost' }],
  data: [{ month: 'Jan', revenue: 100, cost: 60 }, { month: 'Feb', revenue: 150, cost: null }],
};
const shares: ChartSpec = { kind: 'pie', categoryKey: 'status', series: [{ key: 'count' }], data: [{ status: 'Draft', count: 2 }, { status: 'Published', count: 0 }] };
const points: ChartSpec = { kind: 'scatter', categoryKey: 'height', series: [{ key: 'weight' }], data: [{ height: 170, weight: 65 }, { height: 182.5, weight: null }] };

describe('ECharts provider admission', () => {
  it('declares the browser provider id and its seven kinds', () => {
    expect(ECHARTS_PROVIDER_ID).toBe('plugin.echarts');
    expect([...ECHARTS_KINDS]).toEqual(['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'stacked-bar']);
  });

  it.each(['bar', 'line', 'area', 'stacked-bar'])('accepts multi-series %s with gaps, axis labels and formats', (kind) => {
    expect(supportsEChartsSpec({ spec: { ...sales, kind, axes: { x: { label: 'Month' }, y: { label: 'USD', format: { notation: 'compact' } } }, format: { locale: 'de-DE' } } })).toBe(true);
  });

  it.each(['pie', 'donut'])('accepts a single-series %s of non-negative shares with a positive total', (kind) => {
    expect(supportsEChartsSpec({ spec: { ...shares, kind } })).toBe(true);
    // Pie and donut have no axes to label; axes do not make the spec unrenderable.
    expect(supportsEChartsSpec({ spec: { ...shares, kind, axes: { x: { label: 'ignored' } } } })).toBe(true);
  });

  it('accepts scatter points whose category is a numeric x', () => {
    expect(supportsEChartsSpec({ spec: points })).toBe(true);
  });

  it.each<[string, ChartSpec]>([
    ['an unknown kind', { ...sales, kind: 'sankey' }],
    ['a missing categoryKey', { kind: 'bar', series: [{ key: 'revenue' }], data: [{ revenue: 1 }] }],
    ['no series', { ...sales, series: [] }],
    ['no rows', { ...sales, data: [] }],
    ['a text value', { ...sales, data: [{ month: 'Jan', revenue: '100', cost: 1 }] }],
    ['a nested value', { ...sales, data: [{ month: 'Jan', revenue: [1], cost: 1 }] }],
    ['a non-finite value', { ...sales, data: [{ month: 'Jan', revenue: Number.POSITIVE_INFINITY, cost: 1 }] }],
    ['only gaps', { ...sales, data: [{ month: 'Jan', revenue: null, cost: null }, { month: 'Feb' }] }],
    ['a malformed locale', { ...sales, format: { locale: 'not a locale!' } }],
    ['a malformed axis locale', { ...sales, axes: { y: { format: { locale: '!!' } } } }],
    ['a two-series pie', { ...shares, series: [{ key: 'count' }, { key: 'other' }] }],
    ['a negative pie share', { ...shares, data: [{ status: 'Draft', count: -1 }, { status: 'Published', count: 3 }] }],
    ['a pie gap', { ...shares, data: [{ status: 'Draft', count: null }, { status: 'Published', count: 3 }] }],
    ['an all-zero pie', { ...shares, kind: 'donut', data: [{ status: 'Draft', count: 0 }] }],
    ['a scatter with a text x', { ...points, data: [{ height: 'tall', weight: 65 }] }],
    ['a scatter with a missing x', { ...points, data: [{ weight: 65 }] }],
  ])('refuses %s so the host falls back', (_name, spec) => {
    expect(supportsEChartsSpec({ spec })).toBe(false);
  });
});
