/** Pure ChartSpec → ECharts option mapping. No DOM and no ECharts runtime, so every kind is unit-testable. */
import type { EChartsCoreOption } from 'echarts/core';
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import type { ChartSpec, ChartValue } from '@jini-ai/ui/charts';
import { isFiniteNumber, isPartToWhole } from './descriptor.js';

/**
 * Colors are the same `--jini-chart-*` CSS variables the Recharts provider paints with, never resolved
 * values: the host theme stays the single owner of color, and a theme or dark-mode switch repaints
 * without a new option. Series fall back to the default palette in `client/styles.css`.
 *
 * Why hover emphasis is off on every series: ECharts derives emphasis colors by parsing the series color,
 * and it cannot parse `var(...)`, so a hovered bar or slice would lose its fill. The tooltip (and the
 * axis shadow on bars) is the hover feedback instead.
 */
export const CHART_SERIES_COLORS = [
  'var(--jini-chart-1, var(--jini-chart-default-1))',
  'var(--jini-chart-2, var(--jini-chart-default-2))',
  'var(--jini-chart-3, var(--jini-chart-default-3))',
  'var(--jini-chart-4, var(--jini-chart-default-4))',
  'var(--jini-chart-5, var(--jini-chart-default-5))',
  'var(--jini-chart-6, var(--jini-chart-default-6))',
] as const;
const TEXT_COLOR = 'var(--jini-chart-text, var(--jini-text, #171717))';
const AXIS_COLOR = 'var(--jini-chart-axis, var(--jini-muted, #737373))';
const GRID_COLOR = 'var(--jini-chart-grid, var(--jini-border, #e5e5e5))';
const SURFACE_COLOR = 'var(--jini-chart-surface, var(--jini-bg, #ffffff))';
const CURSOR_COLOR = 'var(--jini-chart-cursor, var(--jini-accent-soft, rgba(0, 0, 0, 0.06)))';

/** Axis names and labels stay inside the chart frame, including at dock width. */
const GRID = { left: 8, right: 16, top: 16, bottom: 40, outerBoundsMode: 'same', outerBoundsContain: 'all' } as const;
/** One scrolling legend row under the chart: many pie slices never wrap over the plot. */
const LEGEND = { type: 'scroll', bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: TEXT_COLOR } } as const;
const TOOLTIP = { confine: true, className: 'jini-chart-tooltip', backgroundColor: SURFACE_COLOR, borderColor: GRID_COLOR, textStyle: { color: TEXT_COLOR } } as const;
const NO_EMPHASIS = { disabled: true } as const;

type ChartFormat = NonNullable<ChartSpec['format']>;
type NumberFormatter = (value: number) => string;

/** The accessible name: the spec's title, else what the chart plots against what. */
export function chartTitle({ spec }: { spec: ChartSpec }, _options: Record<string, never> = {}): string {
  return spec.title ?? `${spec.series.map((series) => series.label ?? series.key).join(', ')} by ${spec.categoryKey}`;
}

/** A category is drawn as text; a missing one is an empty label, never "undefined". */
function categoryLabel(value: ChartValue | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function numberFormatter(format: ChartFormat | undefined): NumberFormatter | undefined {
  if (!format) return undefined;
  const formatter = new Intl.NumberFormat(format.locale, format.notation ? { notation: format.notation } : {});
  return (value) => formatter.format(value);
}

/** Whole counts get whole ticks (the Recharts fix of host commit 6ca90820a); `minInterval` is ECharts' own knob. */
function wholeNumbers(values: readonly (ChartValue | undefined)[]): boolean {
  return values.every((value) => value === null || value === undefined || (typeof value === 'number' && Number.isInteger(value)));
}

/** Tooltip values use the axis formats; a scatter point's value is `[x, y]`, a gap is an en dash. */
function tooltipValueFormatter({ x, y }: { x?: NumberFormatter | undefined; y?: NumberFormatter | undefined }): { valueFormatter?: (value: unknown) => string } {
  if (!x && !y) return {};
  const one = (value: unknown, format: NumberFormatter | undefined): string => {
    if (typeof value !== 'number') return '–';
    return format ? format(value) : String(value);
  };
  return { valueFormatter: (value) => Array.isArray(value) ? value.map((item, index) => one(item, index === 0 ? x : y)).join(', ') : one(value, y) };
}

function axisName({ name }: { name: string | undefined }): Record<string, unknown> {
  return name ? { name, nameLocation: 'middle', nameTextStyle: { color: AXIS_COLOR } } : {};
}

function valueAxis({ name, format, integers }: { name: string | undefined; format: NumberFormatter | undefined; integers: boolean }): Record<string, unknown> {
  return {
    type: 'value', ...axisName({ name }), ...(integers ? { minInterval: 1 } : {}),
    axisLabel: { color: AXIS_COLOR, ...(format ? { formatter: format } : {}) },
    splitLine: { lineStyle: { color: GRID_COLOR } },
  };
}

/** Bars sit inside their band; line and area points sit on the category ticks. */
function categoryAxis({ spec }: { spec: ChartSpec }): Record<string, unknown> {
  return {
    type: 'category', ...axisName({ name: spec.axes?.x?.label }),
    data: spec.data.map((row) => categoryLabel(row[spec.categoryKey!])),
    boundaryGap: spec.kind !== 'line' && spec.kind !== 'area',
    axisTick: { show: false }, axisLine: { lineStyle: { color: GRID_COLOR } },
    axisLabel: { color: AXIS_COLOR, hideOverlap: true },
  };
}

/** One series on the axes. Missing or non-numeric cells are gaps (supports() admitted only numbers or null). */
function axisSeries({ spec, index }: { spec: ChartSpec; index: number }): BarSeriesOption | LineSeriesOption | ScatterSeriesOption {
  const series = spec.series[index]!;
  const shared = { name: series.label ?? series.key, emphasis: NO_EMPHASIS, ...(series.color !== undefined ? { itemStyle: { color: series.color } } : {}) };
  if (spec.kind === 'scatter') {
    const points = spec.data.flatMap((row): [number, number][] => {
      const x = row[spec.categoryKey!]; const y = row[series.key];
      return isFiniteNumber(x) && isFiniteNumber(y) ? [[x, y]] : [];
    });
    return { ...shared, type: 'scatter', symbolSize: 10, data: points };
  }
  const values = spec.data.map((row) => { const value = row[series.key]; return isFiniteNumber(value) ? value : null; });
  if (spec.kind === 'line' || spec.kind === 'area') {
    return { ...shared, type: 'line', symbol: 'circle', symbolSize: 6, data: values, ...(spec.kind === 'area' ? { areaStyle: { opacity: 0.2 } } : {}) };
  }
  return { ...shared, type: 'bar', barMaxWidth: 48, data: values, ...(spec.kind === 'stacked-bar' ? { stack: 'total' } : {}) };
}

function axisFormats(spec: ChartSpec): { x: NumberFormatter | undefined; y: NumberFormatter | undefined } {
  const y = numberFormatter(spec.axes?.y?.format ?? spec.format);
  return { x: spec.kind === 'scatter' ? numberFormatter(spec.axes?.x?.format ?? spec.format) : undefined, y };
}

/** Bar, stacked bar, line, area and scatter: shared grid, axes and an axis (or point) tooltip. */
function axisOption(spec: ChartSpec): EChartsCoreOption {
  const { x, y } = axisFormats(spec);
  const scatter = spec.kind === 'scatter';
  const bars = spec.kind === 'bar' || spec.kind === 'stacked-bar';
  const xAxis = scatter
    ? valueAxis({ name: spec.axes?.x?.label, format: x, integers: wholeNumbers(spec.data.map((row) => row[spec.categoryKey!])) })
    : categoryAxis({ spec });
  const values = spec.data.flatMap((row) => spec.series.map(({ key }) => row[key]));
  return {
    grid: GRID, xAxis, yAxis: valueAxis({ name: spec.axes?.y?.label, format: y, integers: wholeNumbers(values) }),
    tooltip: { ...TOOLTIP, trigger: scatter ? 'item' : 'axis', ...(bars ? { axisPointer: { type: 'shadow', shadowStyle: { color: CURSOR_COLOR } } } : {}), ...tooltipValueFormatter({ x, y }) },
    series: spec.series.map((_series, index) => axisSeries({ spec, index })),
  };
}

/** Split the existing radial range evenly without overlap, retaining the donut's hole.
 * The one-series radius keeps its original shape as well as its values for option compatibility.
 * @complexity O(1) time and space; pure mapping of an admitted series index.
 */
function partToWholeRadius({ spec, index }: { spec: ChartSpec; index: number }, _options: Record<string, never> = {}): string | [string, string] {
  if (spec.series.length === 1) return spec.kind === 'donut' ? ['50%', '75%'] : '75%';
  const inner = spec.kind === 'donut' ? 50 : 0;
  const width = (75 - inner) / spec.series.length;
  return [`${inner + index * width}%`, `${inner + (index + 1) * width}%`];
}

/** One ring uses the same category order and slice palette as the single-series chart. Series labels
 * name the ring; categories name its slices. Surface-colored borders keep adjacent slices distinct.
 * @complexity O(rows) time and space; no I/O or mutation.
 */
function partToWholeSeries({ spec, index }: { spec: ChartSpec; index: number }, _options: Record<string, never> = {}): PieSeriesOption {
  const series = spec.series[index]!;
  const data = spec.data.map((row) => { const value = row[series.key]; return { name: categoryLabel(row[spec.categoryKey!]), value: isFiniteNumber(value) ? value : 0 }; });
  return {
    type: 'pie', name: series.label ?? series.key, radius: partToWholeRadius({ spec, index }), center: ['50%', '45%'],
    label: { show: false }, labelLine: { show: false }, emphasis: NO_EMPHASIS, itemStyle: { borderColor: SURFACE_COLOR, borderWidth: 2 }, data,
  };
}

/** Pie and donut rings have no outside labels, which truncate at dock width. ECharts' native legend
 * deduplicates category names across rings, and its item tooltip escapes and shows series + category +
 * formatted value; keep those owners rather than building another legend or HTML formatter.
 * @complexity O(rows × series) time and space; no I/O or mutation.
 */
function partToWholeOption({ spec }: { spec: ChartSpec }, _options: Record<string, never> = {}): EChartsCoreOption {
  return {
    tooltip: { ...TOOLTIP, trigger: 'item', ...tooltipValueFormatter({ y: numberFormatter(spec.format) }) },
    series: spec.series.map((_series, index) => partToWholeSeries({ spec, index })),
  };
}

/**
 * Map a provider-admitted spec (see `supportsEChartsSpec`) to one complete option. The mount replaces
 * series and axes on every update, so the option never relies on a previous one.
 * Animation is off, as in the Recharts provider: a chart redrawn by each agent turn should not replay.
 * @complexity O(rows × series) time and space.
 * @example chart.setOption(buildEChartsOption({ spec }), { replaceMerge: ['series', 'xAxis', 'yAxis', 'grid'] })
 */
export function buildEChartsOption({ spec }: { spec: ChartSpec }, _options: Record<string, never> = {}): EChartsCoreOption {
  return {
    animation: false,
    color: [...CHART_SERIES_COLORS],
    // ECharts' aria component labels the chart root with a generated description of the data; the
    // hidden title gives that description its subject.
    aria: { enabled: true },
    title: { show: false, text: chartTitle({ spec }) },
    textStyle: { color: TEXT_COLOR },
    legend: LEGEND,
    ...(isPartToWhole({ kind: spec.kind }) ? partToWholeOption({ spec }) : axisOption(spec)),
  };
}
