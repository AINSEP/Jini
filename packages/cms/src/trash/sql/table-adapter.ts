/**
 * @file `createTableTrashAdapter` — the ONE `TrashAdapter` implementation for every registry entry, written once as ONE
 * Kysely body over the storage kernel instead of once per domain — the same statements on SQLite, PGlite and Postgres.
 * Both timestamp and status markers implement the same transition contract.
 *
 * It reproduces a bespoke compare-and-set flip / compare-and-delete pair's exact contract, generically:
 *  - `hide`/`unhide` read the row FIRST, then classify not-found / version-changed / already-in-state
 *    / real transition, in that order. Each runs in `kernel.transaction` holding `kernel.lockKey` for the row. The lock
 *    only orders Trash against Trash — a domain writer never takes it, so on Postgres (READ COMMITTED) it can commit
 *    between the read and the write. The write therefore repeats the read's marker and version in its own `WHERE`, and 0
 *    affected rows is `version-changed`.
 *  - `purge` never deletes a LIVE row or its `purgeFirst` children, even at a matching version — checked before either
 *    delete runs.
 *  - `purge` resolves each `TrashCascadeSpec` generically (direct parent-id match, or the two-hop `via` join), and, for a
 *    cascade that also declares `entityType`, reads the child ids BEFORE deleting them so their `trashed_items` rows can
 *    be cleaned up in the same transaction. `hide` gains one guard clause ahead of the real transition for
 *    `TrashEntry.blocker`. Neither addition is type-specific: both read entirely off the entry the caller registered.
 *
 * The steps live in `table-adapter.{context,rows,cascade,transitions,purge}.ts`; this file binds them to one entry.
 */
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";

import type { TrashAdapter } from "../ports.js";
import type { TrashEntry } from "../registry-types.js";
import type { TrashTables } from "./repo.js";
import type { TableTrashContext, TableTrashKernel } from "./table-adapter.context.js";
import { purgeRow } from "./table-adapter.purge.js";
import { hideRow, unhideRow } from "./table-adapter.transitions.js";

/** Everything the host must bind; a missing binding is a compile error. */
export interface TableTrashRequired<DB = unknown> {
  entry: TrashEntry;
  /** Read on first use, not at construction: a composition root may hand in a lazy proxy whose database should not open
   *  until a Trash call actually needs it. Never destructured here. */
  readonly kernel: StorageKernel<Kysely<DB>, unknown>;
  tables: TrashTables;
}

/**
 * Builds one `TrashAdapter` for a single {@link TrashEntry}.
 *
 * @complexity O(1) to construct; each method is O(1) plus whatever index its `where` matches, plus
 *             O(k) for `purge`'s k `purgeFirst` cascades (each still a single indexed statement).
 */
export function createTableTrashAdapter<DB>(required: TableTrashRequired<DB>, _optional: Record<string, never> = {}): TrashAdapter {
  let resolved: TableTrashKernel | undefined;
  const ctx: TableTrashContext = {
    entry: required.entry,
    // The one place the host's schema type is erased: every query below names its table at runtime from the registry
    // entry, so no static table type could describe it. Read here, on first use, never at construction.
    kernel: () => (resolved ??= required.kernel as unknown as TableTrashKernel),
    tables: required.tables,
  };
  return {
    entityType: required.entry.entityType,
    hide: (input) => hideRow({ ctx, input }),
    unhide: (input, optional = {}) => unhideRow({ ctx, input }, optional),
    purge: (input) => purgeRow({ ctx, input }),
  };
}
