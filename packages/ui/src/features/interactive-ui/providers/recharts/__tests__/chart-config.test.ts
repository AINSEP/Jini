import { describe, expect, it } from 'vitest';
import { chartTickFormatter, createChartConfig, formatChartValue } from '../chart-config.js';

describe('chart config', () => {
  it('assigns CSS variable colors in series order while retaining duplicate labels and zero values', () => {
    const series = Object.freeze([
      Object.freeze({ key: 'slice-0', label: 'Repeated', value: 0 }),
      Object.freeze({ key: 'slice-1', label: 'Repeated', value: 25 }),
    ]);
    expect(createChartConfig({ series })).toEqual({
      'slice-0': { label: 'Repeated', value: 0, color: 'var(--jini-chart-1, var(--jini-chart-default-1))' },
      'slice-1': { label: 'Repeated', value: 25, color: 'var(--jini-chart-2, var(--jini-chart-default-2))' },
    });
    expect(series).toEqual([{ key: 'slice-0', label: 'Repeated', value: 0 }, { key: 'slice-1', label: 'Repeated', value: 25 }]);
  });

  it('preserves the legacy single-color override for every series', () => {
    expect(createChartConfig({ series: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] }, { color: 'var(--brand)' })).toEqual({
      a: { label: 'A', color: 'var(--brand)' },
      b: { label: 'B', color: 'var(--brand)' },
    });
  });

  it('repeats the six-slot palette for larger datasets', () => {
    const config = createChartConfig({ series: Array.from({ length: 7 }, (_, index) => ({ key: `series-${index}`, label: String(index) })) });
    expect(config['series-5']?.color).toBe('var(--jini-chart-6, var(--jini-chart-default-6))');
    expect(config['series-6']?.color).toBe('var(--jini-chart-1, var(--jini-chart-default-1))');
  });

  it('supports arbitrary agent keys without treating prototype properties as config entries', () => {
    const config = createChartConfig({ series: [{ key: '__proto__', label: 'Revenue' }] });
    expect(Object.hasOwn(config, '__proto__')).toBe(true);
    expect(config['__proto__']).toEqual({ label: 'Revenue', color: 'var(--jini-chart-1, var(--jini-chart-default-1))' });
    expect(Object.hasOwn(config, 'constructor')).toBe(false);
    expect(createChartConfig({ series: [] })).toEqual({});
  });
});

describe('chart value formatting', () => {
  it.each([
    [1234.567, '1,234.567'],
    [-1234.5, '-1,234.5'],
    [0, '0'],
    [0.00001, '0.00001'],
    ['001', '001'],
    [null, ''],
    [undefined, ''],
  ])('formats %s without losing precision or coercing categories', (value, expected) => {
    expect(formatChartValue({ value })).toBe(expected);
  });

  it('uses compact notation for axis ticks and donut totals', () => {
    expect(chartTickFormatter(1250)).toBe('1.3K');
    expect(chartTickFormatter(-2500000)).toBe('-2.5M');
    expect(formatChartValue({ value: 12000 }, { notation: 'compact' })).toBe('12K');
  });
});
