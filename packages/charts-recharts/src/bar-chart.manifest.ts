import { z } from 'zod';
import type { InteractiveComponentManifest } from '@jini-ai/ui/interactive-ui/manifests';

/** Same `.passthrough()`/`z.record` reasoning as `data-table.manifest.ts` — rows are arbitrary agent data. */
export const rechartsBarChartPropsSchema = z
  .object({
    data: z.array(z.record(z.unknown())).min(1),
    categoryKey: z.string(),
    valueKey: z.string(),
    color: z.string().optional(),
  })
  .passthrough();

export const rechartsBarChartManifest: InteractiveComponentManifest = {
  id: 'plugin.recharts.bar-chart',
  provider: 'plugin.recharts',
  capabilities: ['chart', 'bar-chart', 'graph'],
  propsSchema: rechartsBarChartPropsSchema,
  description: 'recharts BarChart (real npm dependency): one categorical axis, one numeric value per bar.',
};
