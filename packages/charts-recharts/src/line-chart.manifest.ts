import { z } from 'zod';
import type { InteractiveComponentManifest } from '@jini-ai/ui/interactive-ui/manifests';

export const rechartsLineChartPropsSchema = z
  .object({
    data: z.array(z.record(z.unknown())).min(1),
    categoryKey: z.string(),
    valueKey: z.string(),
    color: z.string().optional(),
  })
  .passthrough();

export const rechartsLineChartManifest: InteractiveComponentManifest = {
  id: 'plugin.recharts.line-chart',
  provider: 'plugin.recharts',
  capabilities: ['chart', 'line-chart', 'graph'],
  propsSchema: rechartsLineChartPropsSchema,
  description: 'recharts LineChart (real npm dependency): one categorical axis, one numeric value per point.',
};
