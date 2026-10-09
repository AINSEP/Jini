import { CHART_SERIES_COLORS } from './chart-tokens.js';

export interface ChartSeries {
  readonly label: string;
  readonly color: string;
  readonly value?: number;
}

/** Provider-local configuration shared by marks, tooltip swatches and the legend. */
export type ChartConfig = Readonly<Record<string, ChartSeries>>;

interface SeriesInput {
  readonly key: string;
  readonly label: string;
  readonly value?: number;
}

/**
 * Assign the existing CSS palette to named series without mutating agent data.
 * @param input Series in display order, with stable keys independent of display labels.
 * @param options Optional legacy color override, applied to every series.
 * @returns A config keyed by series identity, including duplicate display labels.
 * @complexity O(n) time and space for n series; no I/O.
 */
export function createChartConfig(
  { series }: { readonly series: readonly SeriesInput[] },
  { color }: { readonly color?: string | undefined } = {},
): ChartConfig {
  return Object.fromEntries(series.map((entry, index) => [entry.key, {
    label: entry.label,
    color: color ?? CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]!,
    ...(entry.value === undefined ? {} : { value: entry.value }),
  }]));
}

/**
 * Format chart numbers with Intl; preserve categorical strings without numeric coercion.
 * @param input The value supplied by an axis, tooltip, legend or donut total.
 * @param options Compact notation for ticks/totals, standard notation for exact values.
 * @returns Display text, or an empty string for a missing value.
 * @complexity O(k) time and space for k characters in the formatted value; no I/O.
 */
export function formatChartValue(
  { value }: { readonly value: unknown },
  { notation = 'standard' }: { readonly notation?: 'standard' | 'compact' } = {},
): string {
  if (value == null) return '';
  if (typeof value !== 'number') return String(value);
  return new Intl.NumberFormat('en-US', { notation, maximumFractionDigits: notation === 'compact' ? 1 : 20 }).format(value);
}

/** Recharts callback convention is positional; all formatting delegates to the shared owner. */
export const chartTickFormatter = (value: unknown): string => formatChartValue({ value }, { notation: 'compact' });
