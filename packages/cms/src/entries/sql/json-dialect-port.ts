import type { Expression, RawBuilder } from "kysely";

/**
 * The two JSON expressions whose SQL differs per dialect, supplied by the host from the SAME kernel it passes to the
 * repository: the adapter never reads the dialect itself and never imports a dialect package. `path` is a JSON path of
 * keys inside `column`; arguments are named (`required`) because the host's dialect helpers are positional.
 */
export interface EntryJsonDialectPort {
  /** `column`'s JSON value at `path` equals the scalar `value` (a number never matches its string form). */
  scalarEquals(required: { column: Expression<unknown>; path: readonly string[]; value: string | number | boolean }): RawBuilder<boolean>;
  /** A sort key for the value at `path`: typed, NULL when missing. */
  sortKey(required: { column: Expression<unknown>; path: readonly string[] }): RawBuilder<unknown>;
}
