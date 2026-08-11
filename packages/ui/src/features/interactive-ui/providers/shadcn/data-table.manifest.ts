import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

/**
 * Same wire shape as `native.data-table` (see that manifest) — same capabilities, so
 * `resolveByCapability('data-table')` returns both, proving the fallback-chain mechanic across
 * two real providers. `.passthrough()` for the same reason as that manifest: an A2UI-embedded
 * instance may carry an `action` prop this schema doesn't itself validate.
 */
export const shadcnDataTablePropsSchema = z
  .object({
    columns: z.array(z.object({ key: z.string(), label: z.string() }).strict()).min(1),
    rows: z.array(z.record(z.unknown())),
  })
  .passthrough();

export const shadcnDataTableManifest: InteractiveComponentManifest = {
  id: 'shadcn.data-table',
  provider: 'shadcn',
  capabilities: ['data-table', 'table', 'tabular-data'],
  propsSchema: shadcnDataTablePropsSchema,
  description: 'shadcn/ui table primitives (real CLI-pulled source), composed into columns + rows, optional row click.',
};
