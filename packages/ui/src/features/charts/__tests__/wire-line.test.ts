import { describe, expect, it } from 'vitest';
import { rechartsLineChartManifest, rechartsLineChartPropsSchema } from '../wire.js';

describe('rechartsLineChartManifest', () => {
  it('is registered with core table fallback with chart/line-chart/graph capabilities', () => {
    expect(rechartsLineChartManifest.id).toBe('recharts.line-chart');
    expect(rechartsLineChartManifest.provider).toBe('core.table');
    expect(rechartsLineChartManifest.capabilities).toEqual(['chart', 'line-chart', 'graph']);
  });

  it('accepts a well-formed data/categoryKey/valueKey payload', () => {
    const result = rechartsLineChartPropsSchema.safeParse({
      data: [{ day: 'Mon', users: 12 }],
      categoryKey: 'day',
      valueKey: 'users',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty data array', () => {
    expect(rechartsLineChartPropsSchema.safeParse({ data: [], categoryKey: 'day', valueKey: 'users' }).success).toBe(false);
  });
});
