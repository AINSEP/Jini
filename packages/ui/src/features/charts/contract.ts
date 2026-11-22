/** Chart spec validation. The provider ABI lives in `@jini-ai/core/contracts/charts`. */
import { z } from 'zod/v3';
import type { ChartSpec, ChartValue } from '@jini-ai/core/contracts/charts';

const chartValueSchema: z.ZodType<ChartValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(chartValueSchema), z.record(chartValueSchema),
]));
const formatSchema = z.object({ locale: z.string().optional(), notation: z.enum(['standard', 'compact']).optional() }).strict();
const axisSchema = z.object({ label: z.string().optional(), format: formatSchema.optional() }).strict();

/** Serializable, provider-neutral specification; kind admission belongs to each provider. */
export const chartSpecSchema = z.object({
  kind: z.string().min(1),
  data: z.array(z.record(chartValueSchema)),
  categoryKey: z.string().optional(),
  series: z.array(z.object({ key: z.string(), label: z.string().optional(), color: z.string().optional() }).strict()),
  title: z.string().optional(),
  description: z.string().optional(),
  axes: z.object({ x: axisSchema.optional(), y: axisSchema.optional() }).strict().optional(),
  format: formatSchema.optional(),
  provider: z.string().min(1).optional(),
}).strict();
