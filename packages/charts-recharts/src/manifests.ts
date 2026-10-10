/**
 * Node/MCP-safe chart catalog: copied wire schemas and metadata, without React or Recharts.
 * Hosts can advertise these manifests alongside ui's retained fallback catalog.
 */
import type { InteractiveComponentManifest } from '@jini-ai/ui/interactive-ui/manifests';
import { rechartsBarChartManifest } from './bar-chart.manifest.js';
import { rechartsLineChartManifest } from './line-chart.manifest.js';
import { rechartsPieChartManifest } from './pie-chart.manifest.js';

export { rechartsBarChartManifest, rechartsBarChartPropsSchema } from './bar-chart.manifest.js';
export { rechartsLineChartManifest, rechartsLineChartPropsSchema } from './line-chart.manifest.js';
export { rechartsPieChartManifest, rechartsPieChartPropsSchema } from './pie-chart.manifest.js';

/** Every copied chart catalog entry, in the provider's registration order. */
export const CHART_MANIFESTS: readonly InteractiveComponentManifest[] = [
  rechartsBarChartManifest,
  rechartsLineChartManifest,
  rechartsPieChartManifest,
];

/**
 * Legacy tool wire IDs and their plugin counterparts. The copied provider owns this mapping;
 * hosts use it only while enabled, leaving ui's original entries available when disabled.
 * @example RECHARTS_WIRE_IDS.get('recharts.bar-chart') // 'plugin.recharts.bar-chart'
 */
export const RECHARTS_WIRE_IDS: ReadonlyMap<string, string> = new Map([
  ['recharts.bar-chart', rechartsBarChartManifest.id],
  ['recharts.line-chart', rechartsLineChartManifest.id],
  ['recharts.pie-chart', rechartsPieChartManifest.id],
]);
