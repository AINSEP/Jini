import type { ComponentType } from 'react';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '@jini-ai/ui/interactive-ui';
import { rechartsBarChartManifest, rechartsLineChartManifest, rechartsPieChartManifest } from './manifests.js';
import { BarChart } from './bar-chart.js';
import { LineChart } from './line-chart.js';
import { PieChart } from './pie-chart.js';

export { BarChart, type BarChartProps } from './bar-chart.js';
export { LineChart, type LineChartProps } from './line-chart.js';
export { PieChart, type PieChartProps, type PieDatum } from './pie-chart.js';
export * from './manifests.js';
export { ChartContainer, ChartTooltipContent, ChartLegendContent } from './chart.js';
export { createChartConfig, formatChartValue, chartTickFormatter, type ChartConfig, type ChartSeries } from './chart-config.js';
export * from './chart-tokens.js';

// Wire schemas validate the narrower chart props before rendering. Widening only the registry's
// React component type follows ui's own registration boundary; it does not bypass validation.
const entries: readonly InteractiveComponentEntry[] = [
  { ...rechartsBarChartManifest, Component: BarChart as unknown as ComponentType<Record<string, unknown>> },
  { ...rechartsLineChartManifest, Component: LineChart as unknown as ComponentType<Record<string, unknown>> },
  { ...rechartsPieChartManifest, Component: PieChart as unknown as ComponentType<Record<string, unknown>> },
];

/**
 * Register this prototype's charts without mutating the host registry or removing its fallbacks.
 * @param input The existing interactive-ui registry, owned by the host.
 * @param options Reserved for provider options; the prototype has no configurable rendering policy.
 * @returns A new registry preferring plugin.recharts for bar, line and pie chart capabilities.
 */
export function registerChartProvider(
  { registry }: { readonly registry: InteractiveUiRegistry },
  _options: Record<string, never> = {},
): InteractiveUiRegistry {
  let registered = registry;
  for (const entry of entries) registered = registered.register({ entry });
  // register() appends; registry order is its documented preference contract. Reorder the returned
  // snapshot through the same registry API so the built-in Recharts entries remain fallbacks.
  const ids = new Set(entries.map(({ id }) => id));
  return new InteractiveUiRegistry({ entries: [
    ...entries,
    ...registered.list().filter(({ id }) => !ids.has(id)),
  ] });
}
