/** Headless capabilities and admission for the initial, single-series Recharts implementation. */
import type { ChartSpec } from '@jini-ai/ui/charts';
export const RECHARTS_PROVIDER_ID = 'plugin.recharts';
export const RECHARTS_KINDS = ['bar', 'line', 'pie'] as const;

/** Do not claim specifications this artifact would render incompletely. Other providers may own
 * additional kinds, multiple series or richer axes/formats without changing the neutral contract.
 */
export function supportsRechartsSpec({ spec }: { spec: ChartSpec }, _options: Record<string, never> = {}): boolean {
  if (!RECHARTS_KINDS.some((kind) => kind === spec.kind) || spec.series.length !== 1 || !spec.categoryKey || spec.axes !== undefined || spec.format !== undefined) return false;
  const key = spec.series[0]!.key;
  const values = spec.data.map(row => row[key]);
  if (!values.length || !values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) return false;
  // A pie needs actual non-negative shares; the host table preserves data it cannot draw.
  return spec.kind !== 'pie' || (values.every(value => value >= 0) && values.some(value => value > 0));
}
