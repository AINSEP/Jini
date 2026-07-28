/**
 * @module db/tool-catalog/tool-catalog
 *
 * A durable, searchable snapshot of a `ToolRegistry`'s public descriptors (id/description/
 * inputSchema — never the handler or policy) — v0 of `ai-control-plane.md` §29 /
 * `PROP-tool-catalog-discovery-2026-07-26.md`, scoped down for a first real end-to-end proof
 * rather than the full design: no versioning, no principal narrowing, no provider indirection.
 * Every row's id is still resolved against a live `ToolRegistry`/`ToolExecutor` at call time —
 * this table only makes that id *discoverable* before the caller already knows it.
 *
 * Deliberately NOT wired into `schema/migrate.ts` — `migrate.ts`'s own header explains why
 * (`capability_definitions`/`capability_executions` were added there 2026-07-24 and removed
 * 2026-07-25 for having zero consumers in every daemon's database). `ensureToolCatalogTables`
 * is called only by a host that actually seeds and queries this table, mirroring
 * `@injini/registry`'s `ensureRegistryTables` precedent — the same discipline, applied this time
 * without reviving the earlier mistake of a table nothing reads.
 *
 * Ranking is **FTS5 + `bm25()`**, not `LIKE` — verified against this repo's own `better-sqlite3`
 * build (FTS5 is compiled in). `PROP` §5.3 sequences `LIKE` first and treats FTS5 as a later
 * swap once row counts justify it; at v0's actual row count (tens of tools) that swap costs
 * nothing extra to do now, so there is no hand-rolled scorer to throw away later. `tool_catalog`
 * is FTS5's external-content table (`content='tool_catalog', content_rowid='rowid'`) — the
 * canonical row lives once, in a plain table any other query/dump tool can read; the FTS index is
 * rebuilt wholesale on every reseed rather than kept in sync via triggers, since `reseedToolCatalog`
 * already replaces the entire table in one transaction. Column weights (id 6x description, matching
 * the asymmetry `examples/nlweb-demo`'s keyword-scoring spike measured) are passed to `bm25()` at
 * query time, not baked into the index.
 */
import type { SqliteDb } from '../core/types.js';

export interface ToolCatalogEntry {
  readonly id: string;
  readonly description: string;
  /** JSON-Schema-shaped, `unknown` for the same reason `@injini/core`'s `ToolDescriptor.inputSchema` is — this table never parses or validates it. */
  readonly inputSchema?: unknown;
  /** `first-party | plugin | unverified` — carried into what a model sees, per `PROP` §7.1. Every entry seeded from an in-tree `ToolRegistry` today is `first-party`. */
  readonly source: string;
}

export interface ToolCatalogSearchHit {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly score: number;
}

/** Idempotent. Safe to call repeatedly (`IF NOT EXISTS`), matching `migrate()`'s own convention. */
export function ensureToolCatalogTables(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_catalog (
      id                TEXT NOT NULL PRIMARY KEY,
      description       TEXT NOT NULL,
      input_schema_json TEXT CHECK (input_schema_json IS NULL OR json_valid(input_schema_json)),
      source            TEXT NOT NULL DEFAULT 'first-party',
      updated_at        INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS tool_catalog_fts USING fts5(
      id,
      description,
      content='tool_catalog',
      content_rowid='rowid'
    );
  `);
}

/**
 * Replaces the entire catalog with `entries` in one transaction — this table is a *snapshot* of
 * whatever `ToolRegistry` a host assembled at boot, not an independently-edited store (§7.2's
 * "the agent may never write the catalog" holds trivially at v0: nothing here accepts writes
 * from a run at all). A tool no longer registered — the id simply is not in `entries` — is gone
 * from the snapshot on the next reseed, which is the correct behavior for an append-only
 * `ToolRegistry`: this table can only ever lag it, never diverge from it.
 *
 * Rebuilds the FTS5 index wholesale afterward (`INSERT INTO tool_catalog_fts(tool_catalog_fts)
 * VALUES('rebuild')`) rather than via triggers — correct and sufficient because every reseed
 * already replaces 100% of the rows in the same transaction.
 */
export function reseedToolCatalog(db: SqliteDb, entries: readonly ToolCatalogEntry[], now = Date.now()): void {
  const replace = db.transaction((rows: readonly ToolCatalogEntry[]) => {
    db.prepare('DELETE FROM tool_catalog').run();
    const insert = db.prepare(`
      INSERT INTO tool_catalog (id, description, input_schema_json, source, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const entry of rows) {
      insert.run(
        entry.id,
        entry.description,
        entry.inputSchema === undefined ? null : JSON.stringify(entry.inputSchema),
        entry.source,
        now,
      );
    }
    db.exec(`INSERT INTO tool_catalog_fts(tool_catalog_fts) VALUES('rebuild')`);
  });
  replace(entries);
}

export function getToolCatalogEntry(db: SqliteDb, id: string): ToolCatalogEntry | null {
  const row = db.prepare('SELECT id, description, input_schema_json, source FROM tool_catalog WHERE id = ?').get(id) as
    | { id: string; description: string; input_schema_json: string | null; source: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    description: row.description,
    source: row.source,
    ...(row.input_schema_json === null ? {} : { inputSchema: JSON.parse(row.input_schema_json) as unknown }),
  };
}

/** Alphanumeric tokens only — deliberate: an FTS5 MATCH string built from these can never contain FTS5 query-syntax operators (`"`, `*`, `NOT`, `NEAR`, column filters), so a query string is never treated as anything but plain terms. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * `PROP` §6.1's `search_tools`: candidates only, no schemas — loading schemas at search time is
 * what blows the context budget. Never returns an empty-query "everything" page (§6.1's staged
 * discovery loses its point if the first call already dumps the whole catalog).
 *
 * Terms are OR'd (`term1 OR term2 OR ...`), not FTS5's implicit AND, so a multi-word query still
 * surfaces a tool matching only one significant word — the same behavior a hand-rolled
 * any-term-scores scorer would give, but ranked by real BM25 instead of a hand-tuned weight sum.
 */
export function searchToolCatalog(db: SqliteDb, query: string, limit = 10): readonly ToolCatalogSearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const matchExpr = terms.join(' OR ');
  const rows = db
    .prepare(
      `SELECT tc.id, tc.description, tc.source, bm25(tool_catalog_fts, 6.0, 1.0) AS rank
       FROM tool_catalog_fts
       JOIN tool_catalog tc ON tc.rowid = tool_catalog_fts.rowid
       WHERE tool_catalog_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(matchExpr, limit) as Array<{ id: string; description: string; source: string; rank: number }>;

  // bm25() returns a cost (smaller/more-negative = better match); invert to a positive score so
  // callers see "higher is better", matching every other ranked-result convention in this repo.
  return rows.map((row) => ({ id: row.id, description: row.description, source: row.source, score: -row.rank }));
}
