export type { InteractiveComponentManifest } from './types.js';
export { InteractiveUiRegistry, type InteractiveComponentEntry } from './registry.js';

export { nativeDataTableManifest, nativeDataTablePropsSchema, DataTable as NativeDataTable } from './providers/native/index.js';
export { shadcnDataTableManifest, shadcnDataTablePropsSchema, DataTable as ShadcnDataTable } from './providers/shadcn/index.js';

import type { ComponentType } from 'react';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from './registry.js';
import { nativeDataTableManifest, DataTable as NativeDataTable } from './providers/native/index.js';
import { shadcnDataTableManifest, DataTable as ShadcnDataTable } from './providers/shadcn/index.js';

/**
 * Every provider currently registered, shadcn preferred over the dependency-free native fallback
 * for `data-table`/`table` — the same order `manifests.ts`'s `ALL_MANIFESTS` declares, so a
 * search result's rank and this registry's fallback order never disagree. A future provider
 * that only *some* consumers want (e.g. one with a heavier runtime dependency) should be added
 * with `.register()` by that consumer instead of appearing here unconditionally.
 *
 * Each `Component` is cast to `ComponentType<Record<string, unknown>>` — same reasoning as
 * `a2ui/catalog.ts`'s `ComponentSpec.propsSchema` doc: a concrete component's actual prop type is
 * narrower than a bare record (required `columns`/`rows`), and TypeScript is correctly
 * contravariant about that mismatch. The registry's own `propsSchema` (validated before a host
 * ever spreads wire props into one of these) is what actually guarantees the shape at the
 * boundary that matters — this cast doesn't weaken that, it only widens a type this file cannot
 * make TypeScript accept structurally.
 */
export const DEFAULT_INTERACTIVE_UI_REGISTRY = new InteractiveUiRegistry([
  { ...shadcnDataTableManifest, Component: ShadcnDataTable as unknown as ComponentType<Record<string, unknown>> },
  { ...nativeDataTableManifest, Component: NativeDataTable as unknown as ComponentType<Record<string, unknown>> },
] satisfies InteractiveComponentEntry[]);
