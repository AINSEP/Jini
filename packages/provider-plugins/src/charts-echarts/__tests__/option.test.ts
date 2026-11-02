import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '@jini-ai/ui/charts';
import { buildEChartsOption, CHART_SERIES_COLORS, chartTitle } from '../option.js';

type Series = Record<string, unknown> & { type: string; name: string; data: unknown[] };
type Axis = Record<string, unknown> & { axisLabel: { formatter?: (value: number) => string } };
type Option = Record<string, unknown> & {
  series: Series[]; xAxis?: Axis; yAxis?: Axis; grid?: unknown;
  tooltip: { trigger: string; axisPointer?: { type: string }; valueFormatter?: (value: unknown) => string };
};
const option = (spec: ChartSpec): Option => buildEChartsOption({ spec }) as unknown as Option;

const sales: ChartSpec = {
  kind: 'bar', categoryKey: 'month', series: [{ key: 'revenue', label: 'Revenue', color: '#123456' }, { key: 'cost' }],
  data: [{ month: 'Jan', revenue: 100, cost: 60 }, { month: 'Feb', revenue: 150, cost: null }, { revenue: 90, cost: 40 }],
};
const shares: ChartSpec = { kind: 'pie', categoryKey: 'status', series: [{ key: 'count', label: 'Posts' }], data: [{ status: 'Draft', count: 2 }, { count: 5 }] };

describe('ChartSpec to ECharts option', () => {
  it('draws every series on a category axis for bar, keeping gaps and the series label and color', () => {
    const result = option(sales);
    expect(result.xAxis).toMatchObject({ type: 'category', data: ['Jan', 'Feb', ''], boundaryGap: true });
    expect(result.series.map(({ type, name, data }) => ({ type, name, data }))).toEqual([
      { type: 'bar', name: 'Revenue', data: [100, 150, 90] },
      { type: 'bar', name: 'cost', data: [60, null, 40] },
    ]);
    expect(result.series[0]!.itemStyle).toEqual({ color: '#123456' });
    expect(result.series[1]!.itemStyle).toBeUndefined();
    expect(result.series.every((series) => series.stack === undefined)).toBe(true);
    expect(result.tooltip).toMatchObject({ trigger: 'axis', axisPointer: { type: 'shadow' } });
  });

  it('stacks every stacked-bar series on one stack', () => {
    expect(option({ ...sales, kind: 'stacked-bar' }).series.map(({ type, stack }) => ({ type, stack }))).toEqual([
      { type: 'bar', stack: 'total' }, { type: 'bar', stack: 'total' },
    ]);
  });

  it('draws line without and area with a filled area, both on the category ticks', () => {
    const line = option({ ...sales, kind: 'line' });
    const area = option({ ...sales, kind: 'area' });
    expect(line.series.map(({ type, areaStyle }) => ({ type, areaStyle }))).toEqual([{ type: 'line', areaStyle: undefined }, { type: 'line', areaStyle: undefined }]);
    expect(area.series.every(({ type, areaStyle }) => type === 'line' && areaStyle !== undefined)).toBe(true);
    expect(line.xAxis!.boundaryGap).toBe(false);
    expect(area.xAxis!.boundaryGap).toBe(false);
    expect(line.tooltip.axisPointer).toBeUndefined();
  });

  it('draws a pie as one full ring and a donut with a hole, slices named by category ("" when missing)', () => {
    const pie = option(shares);
    const donut = option({ ...shares, kind: 'donut' });
    expect(pie.xAxis).toBeUndefined();
    expect(pie.grid).toBeUndefined();
    expect(pie.series).toHaveLength(1);
    expect(pie.series[0]).toMatchObject({ type: 'pie', name: 'Posts', radius: '75%', data: [{ name: 'Draft', value: 2 }, { name: '', value: 5 }] });
    expect(donut.series[0]!.radius).toEqual(['50%', '75%']);
    expect(pie.tooltip.trigger).toBe('item');
  });

  it('draws a two-series pie as equally wide concentric rings with the original slice styling', () => {
    const result = option({ ...sales, kind: 'pie', data: [{ month: 'Jan', revenue: 100, cost: 60 }, { month: 'Feb', revenue: 150, cost: 70 }] });
    expect(result.series.map(({ type, name, radius, data }) => ({ type, name, radius, data }))).toEqual([
      { type: 'pie', name: 'Revenue', radius: ['0%', '37.5%'], data: [{ name: 'Jan', value: 100 }, { name: 'Feb', value: 150 }] },
      { type: 'pie', name: 'cost', radius: ['37.5%', '75%'], data: [{ name: 'Jan', value: 60 }, { name: 'Feb', value: 70 }] },
    ]);
    expect(result.series.map(({ itemStyle }) => itemStyle)).toEqual([
      { borderColor: 'var(--jini-chart-surface, var(--jini-bg, #ffffff))', borderWidth: 2 },
      { borderColor: 'var(--jini-chart-surface, var(--jini-bg, #ffffff))', borderWidth: 2 },
    ]);
    expect(result.tooltip.trigger).toBe('item');
  });

  it('splits a three-series donut evenly without filling its hole, and preserves number formatting', () => {
    const result = option({ kind: 'donut', categoryKey: 'status', series: [{ key: 'a' }, { key: 'b', label: 'Second' }, { key: 'c' }],
      data: [{ status: 'Draft', a: 1000, b: 2000, c: 3000 }], format: { locale: 'de-DE' } });
    expect(result.series).toHaveLength(3);
    const radii = result.series.map(({ radius }) => (radius as string[]).map(parseFloat));
    expect(radii[0]![0]).toBe(50);
    expect(radii[2]![1]).toBe(75);
    for (const [inner, outer] of radii) expect(outer! - inner!).toBeCloseTo(25 / 3);
    expect(radii[0]![1]).toBe(radii[1]![0]);
    expect(radii[1]![1]).toBe(radii[2]![0]);
    expect(result.series.map(({ name, data }) => ({ name, data }))).toEqual([
      { name: 'a', data: [{ name: 'Draft', value: 1000 }] },
      { name: 'Second', data: [{ name: 'Draft', value: 2000 }] },
      { name: 'c', data: [{ name: 'Draft', value: 3000 }] },
    ]);
    expect(result.tooltip.valueFormatter!(1234.5)).toBe('1.234,5');
  });

  it.each(['pie', 'donut'])('pins the complete single-series %s option, including serialized field order', (kind) => {
    expect(JSON.stringify(option({ ...shares, kind }))).toBe(JSON.stringify({
      animation: false,
      color: [
        'var(--jini-chart-1, var(--jini-chart-default-1))', 'var(--jini-chart-2, var(--jini-chart-default-2))',
        'var(--jini-chart-3, var(--jini-chart-default-3))', 'var(--jini-chart-4, var(--jini-chart-default-4))',
        'var(--jini-chart-5, var(--jini-chart-default-5))', 'var(--jini-chart-6, var(--jini-chart-default-6))',
      ],
      aria: { enabled: true }, title: { show: false, text: 'Posts by status' },
      textStyle: { color: 'var(--jini-chart-text, var(--jini-text, #171717))' },
      legend: { type: 'scroll', bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: 'var(--jini-chart-text, var(--jini-text, #171717))' } },
      tooltip: {
        confine: true, className: 'jini-chart-tooltip', backgroundColor: 'var(--jini-chart-surface, var(--jini-bg, #ffffff))',
        borderColor: 'var(--jini-chart-grid, var(--jini-border, #e5e5e5))', textStyle: { color: 'var(--jini-chart-text, var(--jini-text, #171717))' }, trigger: 'item',
      },
      series: [{
        type: 'pie', name: 'Posts', radius: kind === 'donut' ? ['50%', '75%'] : '75%', center: ['50%', '45%'],
        label: { show: false }, labelLine: { show: false }, emphasis: { disabled: true },
        itemStyle: { borderColor: 'var(--jini-chart-surface, var(--jini-bg, #ffffff))', borderWidth: 2 },
        data: [{ name: 'Draft', value: 2 }, { name: '', value: 5 }],
      }],
    }));
  });

  it('reads scatter categoryKey as numeric x and each series as a y, dropping points with a gap', () => {
    const result = option({ kind: 'scatter', categoryKey: 'height', series: [{ key: 'weight' }, { key: 'age' }],
      data: [{ height: 170, weight: 65, age: 30 }, { height: 182.5, weight: null, age: 41 }] });
    expect(result.xAxis).toMatchObject({ type: 'value' });
    expect(result.series.map(({ type, data }) => ({ type, data }))).toEqual([
      { type: 'scatter', data: [[170, 65]] },
      { type: 'scatter', data: [[170, 30], [182.5, 41]] },
    ]);
    expect(result.tooltip.trigger).toBe('item');
  });

  it('gives whole-number data whole ticks and leaves fractional data to the defaults', () => {
    expect(option(sales).yAxis!.minInterval).toBe(1);
    expect(option({ ...sales, data: [{ month: 'Jan', revenue: 0.5, cost: 1 }] }).yAxis!.minInterval).toBeUndefined();
  });

  it('names the axes and formats axis labels and tooltip values with the spec formats (axis format wins)', () => {
    const result = option({ ...sales, axes: { x: { label: 'Month' }, y: { label: 'Revenue', format: { locale: 'en-US', notation: 'compact' } } }, format: { locale: 'de-DE' } });
    expect(result.xAxis).toMatchObject({ name: 'Month', nameLocation: 'middle' });
    expect(result.yAxis).toMatchObject({ name: 'Revenue', nameLocation: 'middle' });
    expect(result.yAxis!.axisLabel.formatter!(1500)).toBe('1.5K');
    expect(result.tooltip.valueFormatter!(1500)).toBe('1.5K');
    expect(result.tooltip.valueFormatter!(null)).toBe('–');
    expect(option({ ...sales, format: { locale: 'de-DE' } }).yAxis!.axisLabel.formatter!(1234.5)).toBe('1.234,5');
    expect(option(sales).yAxis!.axisLabel.formatter).toBeUndefined();
    expect(option(sales).tooltip.valueFormatter).toBeUndefined();
  });

  it('formats a scatter tooltip point as x then y with their own formats', () => {
    const result = option({ kind: 'scatter', categoryKey: 'x', series: [{ key: 'y' }], data: [{ x: 1, y: 2 }],
      axes: { x: { format: { locale: 'en-US', notation: 'compact' } } }, format: { locale: 'de-DE' } });
    expect(result.tooltip.valueFormatter!([2500, 1234.5])).toBe('2.5K, 1.234,5');
  });

  it('paints with the host chart tokens, labels the chart for assistive tech and never animates', () => {
    const result = option(sales);
    expect(result.color).toEqual([...CHART_SERIES_COLORS]);
    expect(CHART_SERIES_COLORS[0]).toBe('var(--jini-chart-1, var(--jini-chart-default-1))');
    expect(result.aria).toEqual({ enabled: true });
    expect(result.animation).toBe(false);
    expect(result.title).toEqual({ show: false, text: 'Revenue, cost by month' });
    expect(option({ ...sales, title: 'Sales' }).title).toEqual({ show: false, text: 'Sales' });
    // ECharts cannot derive an emphasis color from var(); hover emphasis would erase the fill.
    for (const spec of [sales, shares]) expect(option(spec).series.every((series) => (series.emphasis as { disabled?: boolean }).disabled === true)).toBe(true);
  });

  it('titles a chart from its series and category when the spec has no title', () => {
    expect(chartTitle({ spec: shares })).toBe('Posts by status');
  });
});
