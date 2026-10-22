import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

/**
 * Zero-React manifest for the dependency-free HTML fallback. shadcn now owns preferred table
 * resolution; native stays available without external component primitives. Both providers
 * share the table presentation stylesheet, so fallback does not mean raw browser markup.
 */
/**
 * `.passthrough()`, not `.strict()` — an A2UI-embedded instance of this component may carry an
 * `action` prop (A2UI's own `ActionSchema`) alongside `columns`/`rows`, and `applyComponentsList`
 * stores zod's *parsed output* as `component.props`, so a `.strict()` schema would hard-reject
 * the whole component the moment an agent included one, not merely drop it. This manifest stays
 * protocol-agnostic on purpose (no `@jini-ai/agentic` import to validate `action`'s own shape) —
 * `.passthrough()` lets any extra key ride along unvalidated rather than importing A2UI's schema
 * just to police a field this file has no other reason to know about.
 */
export const nativeDataTablePropsSchema = z
  .object({
    columns: z.array(z.object({ key: z.string(), label: z.string() }).strict()).min(1),
    rows: z.array(z.record(z.unknown())),
  })
  .passthrough();

export const nativeDataTableManifest: InteractiveComponentManifest = {
  id: 'native.data-table',
  provider: 'native',
  capabilities: ['data-table', 'table', 'tabular-data', 'spreadsheet', 'list-of-records'],
  propsSchema: nativeDataTablePropsSchema,
  description: 'Styled HTML table fallback for tabular data, spreadsheets and lists of records: columns + rows, optional row click. Borders, row separators, padded cells, muted left-aligned headers, hover and horizontal scroll. No sorting or paging; prefer shadcn.data-table for the full table experience. Load @jini-ai/ui/interactive-ui.css in the renderer host.',
};
