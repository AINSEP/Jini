import { describe, expect, it } from 'vitest';
import { rechartsBarChartManifest, rechartsBarChartPropsSchema } from '../bar-chart.manifest.js';

describe('rechartsBarChartManifest', () => {
  it('is registered under the recharts provider with chart/bar-chart/graph capabilities', () => {
    expect(rechartsBarChartManifest.id).toBe('recharts.bar-chart');
    expect(rechartsBarChartManifest.provider).toBe('recharts');
    expect(rechartsBarChartManifest.capabilities).toEqual(['chart', 'bar-chart', 'graph']);
  });

  it('accepts a well-formed data/categoryKey/valueKey payload', () => {
    const result = rechartsBarChartPropsSchema.safeParse({
      data: [{ month: 'Jan', revenue: 100 }],
      categoryKey: 'month',
      valueKey: 'revenue',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty data array', () => {
    expect(rechartsBarChartPropsSchema.safeParse({ data: [], categoryKey: 'month', valueKey: 'revenue' }).success).toBe(false);
  });

  it('rejects a payload missing categoryKey', () => {
    expect(rechartsBarChartPropsSchema.safeParse({ data: [{ month: 'Jan' }], valueKey: 'revenue' }).success).toBe(false);
  });
});
