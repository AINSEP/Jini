/**
 * @file The workspace-scoped single-row lookup, written once.
 *
 * Every repository adapter tends to hand-roll the same four lines —
 * `db.select().from(table).where(and(...)).all()`, then `rows[0] ? mapper(rows[0]) : null`. This
 * is that shape. Adapters still build their own `eq()` conditions and their own row mapper;
 * what they stop re-writing is the lookup-and-map boilerplate around them.
 */
import { and, type SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * Runs a single-row lookup under the given conditions and maps the result, or returns `null` if
 * nothing matched. `conditions` is typically `[eq(table.workspaceId, id), eq(table.slug, slug)]`.
 *
 * `TSchema` is generic rather than pinned so a handle typed against any host's schema is
 * accepted — Drizzle's database type is invariant in its schema parameter, so a widened
 * `Record<string, unknown>` here would reject every real caller.
 */
export function findOneBy<
  TSchema extends Record<string, unknown>,
  TTable extends SQLiteTable,
  TRecord,
>(
  db: BetterSQLite3Database<TSchema>,
  table: TTable,
  conditions: SQL[],
  mapper: (row: TTable['$inferSelect']) => TRecord,
): TRecord | null {
  const rows = db
    .select()
    .from(table as SQLiteTable)
    .where(and(...conditions))
    .limit(1)
    .all() as Array<TTable['$inferSelect']>;
  return rows[0] ? mapper(rows[0]) : null;
}
