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
  return spec.data.length > 0 && spec.data.every((row) => typeof row[key] === 'number' && Number.isFinite(row[key]));
}
