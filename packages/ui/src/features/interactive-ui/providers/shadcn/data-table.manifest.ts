import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

/**
 * Same required wire shape as `native.data-table` (see that manifest), plus optional local
 * sorting/paging settings — shared capabilities, so
 * `resolveByCapability('data-table')` returns both, proving the fallback-chain mechanic across
 * two real providers. `.passthrough()` for the same reason as that manifest: an A2UI-embedded
 * instance may carry an `action` prop this schema doesn't itself validate.
 */
export const shadcnDataTablePropsSchema = z
  .object({
    columns: z.array(z.object({ key: z.string(), label: z.string() }).strict()).min(1),
    rows: z.array(z.record(z.unknown())),
    sortable: z.boolean().optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  })
  .passthrough();

export const shadcnDataTableManifest: InteractiveComponentManifest = {
  id: 'shadcn.data-table',
  provider: 'shadcn',
  capabilities: ['data-table', 'table', 'tabular-data', 'spreadsheet', 'list-of-records'],
  propsSchema: shadcnDataTablePropsSchema,
  description: 'Preferred styled table for tabular data, spreadsheets and lists of records: columns + rows, optional row click. Rounded border, sticky muted headers, row hover, numeric alignment and empty state. Client-side column sorting (sortable defaults to true); optional pageSize (1–100) enables paging. Load @jini-ai/ui/interactive-ui.css in the renderer host.',
};
