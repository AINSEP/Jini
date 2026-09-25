import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

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
  id: 'recharts.bar-chart',
  provider: 'recharts',
  capabilities: ['chart', 'bar-chart', 'graph'],
  propsSchema: rechartsBarChartPropsSchema,
  description: 'recharts BarChart (real npm dependency): one categorical axis, one numeric value per bar.',
};
