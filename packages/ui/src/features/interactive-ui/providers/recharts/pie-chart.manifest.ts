import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

export const rechartsPieChartPropsSchema = z
  .object({
    data: z.array(z.object({ name: z.string(), value: z.number() }).passthrough()).min(1),
    color: z.string().optional(),
  })
  .passthrough();

export const rechartsPieChartManifest: InteractiveComponentManifest = {
  id: 'recharts.pie-chart',
  provider: 'recharts',
  capabilities: ['chart', 'pie-chart', 'graph'],
  propsSchema: rechartsPieChartPropsSchema,
  description: 'recharts PieChart (real npm dependency): a set of named, weighted slices.',
};
