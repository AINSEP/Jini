/**
 * @file Sort state for `@jini-ai/admin/react`'s `DataTable`. Plain data — no React, no DOM — so a
 * panel can hold and pass this shape (e.g. as component state) without pulling in the React layer
 * just for a type. `DataTable.tsx` imports and re-exports these for its own consumers; this file is
 * the single source of truth.
 */

export type DataTableSortDirection = 'asc' | 'desc';

/** Controlled sort state: the active column's `key` plus its direction. See `sort`/`onSortChange`
 *  on `DataTableProps` in `DataTable.tsx` — `DataTable` never holds this itself. */
export interface DataTableSortState {
  column: string;
  direction: DataTableSortDirection;
}
