/** The existing wire schemas remain core-owned, even when no chart plugin is enabled. */
import { z } from 'zod';
import type { InteractiveComponentManifest } from '../interactive-ui/types.js';
import { chartSpecSchema, type ChartSpec } from './contract.js';

/** Same passthrough/record reasoning as native data-table: A2UI action bindings and extra row data
 * belong to the wire protocol, not a renderer. Retain their established shapes during extraction. */
export const rechartsBarChartPropsSchema = z.object({
  data: z.array(z.record(z.unknown())).min(1), categoryKey: z.string(), valueKey: z.string(),
  /** The legend/tooltip name for `valueKey` ("Sign-ups"); omitted, the key is humanized. */
  valueLabel: z.string().min(1).optional().describe('Human name for valueKey shown in the legend and tooltip, e.g. "Sign-ups". Defaults to the humanized key.'), color: z.string().optional(),
}).passthrough();
export const rechartsLineChartPropsSchema = rechartsBarChartPropsSchema;
export const rechartsPieChartPropsSchema = z.object({
  data: z.array(z.object({ name: z.string(), value: z.number() }).passthrough()).min(1), color: z.string().optional(),
}).passthrough();

export const rechartsBarChartManifest: InteractiveComponentManifest = {
  id: 'recharts.bar-chart', provider: 'core.table', capabilities: ['chart', 'bar-chart', 'graph'],
  propsSchema: rechartsBarChartPropsSchema, description: 'Bar chart: one categorical axis and one numeric value per bar. Uses an enabled chart provider or a styled data table.',
};
export const rechartsLineChartManifest: InteractiveComponentManifest = {
  id: 'recharts.line-chart', provider: 'core.table', capabilities: ['chart', 'line-chart', 'graph'],
  propsSchema: rechartsLineChartPropsSchema, description: 'Line chart: one categorical axis and one numeric value per point. Uses an enabled chart provider or a styled data table.',
};
export const rechartsPieChartManifest: InteractiveComponentManifest = {
  id: 'recharts.pie-chart', provider: 'core.table', capabilities: ['chart', 'pie-chart', 'graph'],
  propsSchema: rechartsPieChartPropsSchema, description: 'Pie chart: named, weighted slices. Uses an enabled chart provider or a styled data table.',
};
export const chartWireManifests = [rechartsBarChartManifest, rechartsLineChartManifest, rechartsPieChartManifest] as const;

/** Convert validated legacy props to the neutral contract; optional provider overrides stay data.
 * @example legacyChartSpec({ kind: 'pie', props: { data: [{ name: 'A', value: 2 }] } })
 * @throws ZodError for an invalid wire shape or nonserializable row data.
 */
export function legacyChartSpec(
  { kind, props }: { kind: 'bar' | 'line' | 'pie'; props: Record<string, unknown> },
  _options: Record<string, never> = {},
): ChartSpec {
  const parsed = (kind === 'pie' ? rechartsPieChartPropsSchema : rechartsBarChartPropsSchema).parse(props);
  return chartSpecSchema.parse({
    kind, data: parsed.data, categoryKey: kind === 'pie' ? 'name' : parsed.categoryKey,
    series: [{
      key: kind === 'pie' ? 'value' : parsed.valueKey,
      ...('valueLabel' in parsed && typeof parsed.valueLabel === 'string' ? { label: parsed.valueLabel } : {}),
      ...(parsed.color !== undefined ? { color: parsed.color } : {}),
    }],
    ...(typeof parsed.provider === 'string' ? { provider: parsed.provider } : {}),
  });
}

/** `signups` -> `Signups`, `sign_ups`/`signUps` -> `Sign ups`. Display only; the key still addresses the data. */
function humanizeSeriesKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/**
 * Give every series a label, so a provider's legend and tooltip never show a raw data key
 * (owner, 2026-10-30: a sign-ups chart's legend read "signups"). A label the caller passed wins.
 */
export function withSeriesLabels({ spec }: { spec: ChartSpec }, _options: Record<string, never> = {}): ChartSpec {
  return { ...spec, series: spec.series.map((series) => ({ ...series, label: series.label ?? humanizeSeriesKey(series.key) })) };
}
