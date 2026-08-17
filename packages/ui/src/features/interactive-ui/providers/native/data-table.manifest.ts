import { z } from 'zod';
import type { InteractiveComponentManifest } from '../../types.js';

/**
 * Zero-React reference provider: no external component library wired in yet (`ui/package.json`
 * has no shadcn/radix dependency — adding one is a separate decision, not implied by this
 * scaffold). Proves the manifest/implementation split with something real and testable rather
 * than a stub. A `shadcn`/`21st`/`magic` sibling folder under `providers/` replaces this as the
 * default resolution once those adapters exist; `native` stays as the dependency-free fallback.
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
  capabilities: ['data-table', 'table', 'tabular-data'],
  propsSchema: nativeDataTablePropsSchema,
  description: 'Plain HTML table: columns + rows, optional row click. No external UI library.',
};
