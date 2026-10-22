import { describe, expect, it } from 'vitest';
import { rechartsPieChartManifest, rechartsPieChartPropsSchema } from '../wire.js';

describe('rechartsPieChartManifest', () => {
  it('is registered with core table fallback with chart/pie-chart/graph capabilities', () => {
    expect(rechartsPieChartManifest.id).toBe('recharts.pie-chart');
    expect(rechartsPieChartManifest.provider).toBe('core.table');
    expect(rechartsPieChartManifest.capabilities).toEqual(['chart', 'pie-chart', 'graph']);
  });

  it('accepts a well-formed name/value data payload', () => {
    const result = rechartsPieChartPropsSchema.safeParse({ data: [{ name: 'A', value: 10 }] });
    expect(result.success).toBe(true);
  });

  it('rejects an empty data array', () => {
    expect(rechartsPieChartPropsSchema.safeParse({ data: [] }).success).toBe(false);
  });

  it('rejects a datum missing value', () => {
    expect(rechartsPieChartPropsSchema.safeParse({ data: [{ name: 'A' }] }).success).toBe(false);
  });
});
