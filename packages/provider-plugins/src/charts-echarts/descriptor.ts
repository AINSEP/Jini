/** Headless kinds and admission for the ECharts browser provider (multi-series, axis labels and number formats). */
import type { ChartSpec, ChartValue } from '@jini-ai/ui/charts';

export const ECHARTS_PROVIDER_ID = 'plugin.echarts';
export const ECHARTS_KINDS = ['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'stacked-bar'] as const;
export type EChartsKind = typeof ECHARTS_KINDS[number];
type ChartFormat = NonNullable<ChartSpec['format']>;

export function isEChartsKind(input: { kind: string }, _options: Record<string, never> = {}): input is { kind: EChartsKind } {
  return ECHARTS_KINDS.some((candidate) => candidate === input.kind);
}

/** Part-to-whole kinds draw concentric series of slices; every other kind draws series on x/y axes. */
export function isPartToWhole({ kind }: { kind: string }, _options: Record<string, never> = {}): boolean {
  return kind === 'pie' || kind === 'donut';
}

export const isFiniteNumber = (value: ChartValue | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

/** Intl throws a RangeError for a malformed locale tag; refuse it here rather than fail at render time. */
function formatSupported(format: ChartFormat | undefined): boolean {
  if (format?.locale === undefined) return true;
  try { new Intl.NumberFormat(format.locale); return true; } catch { return false; }
}

function formatsSupported(spec: ChartSpec): boolean {
  return [spec.format, spec.axes?.x?.format, spec.axes?.y?.format].every(formatSupported);
}

/** Every ring needs non-negative numbers and a positive total: an all-zero ring has no shares to draw.
 * ChartSpec shares category rows across series. A missing/null share means mismatched category coverage;
 * refuse it so the core table preserves the data instead of inventing zero shares or dropping categories.
 * @complexity O(rows × series) time, O(rows) transient space; no I/O or mutation.
 */
function partToWholeSupported({ spec }: { spec: ChartSpec }, _options: Record<string, never> = {}): boolean {
  return spec.series.every(({ key }) => {
    const values = spec.data.map((row) => row[key]);
    return values.every((value) => isFiniteNumber(value) && value >= 0) && values.some((value) => value !== 0);
  });
}

/** Axis series may leave gaps (null), but every value is a finite number or null and at least one is drawn.
 * Scatter reads `categoryKey` as the numeric x of every point. */
function axisSupported(spec: ChartSpec): boolean {
  const keys = spec.series.map(({ key }) => key);
  const values = spec.data.flatMap((row) => keys.map((key) => row[key] ?? null));
  if (!values.every((value) => value === null || isFiniteNumber(value)) || !values.some((value) => value !== null)) return false;
  return spec.kind !== 'scatter' || spec.data.every((row) => isFiniteNumber(row[spec.categoryKey!]));
}

/** Do not claim specifications this artifact would render incompletely; the host then tries the next
 * provider and finally the core data table. Pie and donut ignore `axes` (they have none to label).
 * @complexity O(rows × series) time, O(rows × series) transient space.
 */
export function supportsEChartsSpec({ spec }: { spec: ChartSpec }, _options: Record<string, never> = {}): boolean {
  if (!isEChartsKind({ kind: spec.kind }) || !spec.categoryKey || spec.series.length === 0 || spec.data.length === 0) return false;
  if (!formatsSupported(spec)) return false;
  return isPartToWhole({ kind: spec.kind }) ? partToWholeSupported({ spec }) : axisSupported(spec);
}
