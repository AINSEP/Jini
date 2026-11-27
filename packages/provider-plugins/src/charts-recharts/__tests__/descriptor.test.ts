import { expect, it } from 'vitest';
import type { ChartSpec } from '@jini-ai/core/contracts/charts';
import { supportsRechartsSpec } from '../descriptor.js';

const data: ChartSpec['data'] = [{ week: 'one', total: 2 }, { week: 'two', total: -3 }, { week: 'three', total: 0 }];
const base: ChartSpec = { kind: 'bar', categoryKey: 'week', series: [{ key: 'total' }], data };

it('admits signed cartesian numbers but not missing or nonfinite series values', () => {
  expect(supportsRechartsSpec({ spec: base })).toBe(true);
  expect(supportsRechartsSpec({ spec: { ...base, data: [] } })).toBe(false);
  const invalidRows: ChartSpec['data'] = [{ week: 'two' }, { week: 'two', total: '3' }, { week: 'two', total: Infinity }];
  for (const middle of invalidRows) {
    expect(supportsRechartsSpec({ spec: { ...base, data: [data[0]!, middle, data[2]!] } })).toBe(false);
  }
});

it('declines axis labels and number formats the single-series artifact would discard', () => {
  expect(supportsRechartsSpec({ spec: base })).toBe(true);
  expect(supportsRechartsSpec({ spec: { ...base, axes: { y: { label: 'Orders' } } } })).toBe(false);
  expect(supportsRechartsSpec({ spec: { ...base, format: { locale: 'en-US' } } })).toBe(false);
});
