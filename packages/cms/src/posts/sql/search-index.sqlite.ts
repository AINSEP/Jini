import { sql } from "kysely";

import type { PostSearchQuery } from "../search.js";
import { queryRows } from "./kernel-statements.js";
import { type PostSearchDialect, type PostSearchKernel, type PostSearchRow, type SearchProjectionTables, toPostSearchHit } from "./search-index.contract.js";

/**
 * @file The durable FTS5 + BM25 adapter behind `PostSearchPort` — the host's posts equivalent of
 * `@jini-ai/sqlite-chat`'s `tool_catalog` helpers, and deliberately NOT a reuse of them.
 *
 * Why not reuse. `ensureToolCatalogTables`/`reseedToolCatalog`/`searchToolCatalog` are a genuinely
 * good fit for what they index and a genuinely bad one for this. Their table is keyed by tool id
 * with a `description` and a `source`; their sync model is `DELETE FROM` + reinsert every row +
 * `'rebuild'` the whole index, on the sound argument (their own module doc's) that the source of
 * truth is a `ToolRegistry` reassembled from static code on every boot, so a wholesale snapshot can
 * only ever lag, never diverge. Posts have no such moment. They are mutable user data edited one row
 * at a time by humans and agents all day, so a wholesale rebuild would be both the wrong cost model
 * (O(corpus) per edit) and the wrong correctness model (nothing to trigger it). Contorting those
 * three functions into per-row maintenance would leave a shared API whose two callers want opposite
 * things. What IS reused is the approach: external-content FTS5, `bm25()` with per-column weights
 * passed at query time, alphanumeric-only tokenization of the user's query, and the score inversion
 * so higher means better.
 *
 * Sync model, and what makes it hard to get wrong:
 *  - The searchable TEXT of a post (`title`/`slug`/plain text of `body_json`) changes in exactly one
 *    place — `SqlPostRepo.save()`, the sole writer of those columns (verified across the repo:
 *    the only other statement that touches `posts` is `seedContentDb`'s first-run demo insert, which
 *    `backfillPostSearchIndex` covers). `save()` calls the projection's `upsert` in the same
 *    transaction, so the projection cannot be left stale by a normal write.
 *  - Everything ELSE a search must respect — workspace, `kind`, `status`, and the soft-delete
 *    marker — is NOT indexed and is filtered from the live `posts` row at query time. That is the
 *    load-bearing decision in this file: publishing, unpublishing, trashing, and restoring a post
 *    all change what search may return WITHOUT changing a single indexed character, so making them
 *    query-time filters means those four operations need no index write at all and therefore cannot
 *    forget one. `deletePost` -> `softDelete()` writes only `deleted_at`/`updated_at`/`version`, and
 *    `postDeleteReverter` restores through `save()`; neither needs to know this index exists.
 *  - `post_search_document` -> `post_search_fts` is kept in sync by the three triggers the 0022
 *    migration installs, so a writer of the projection table cannot forget the index either.
 *
 * Dialect-specific SQL lives here ON PURPOSE (storage-adapter plan F1): `MATCH`, `bm25()`,
 * `snippet()` and a virtual table joined on its own `rowid` exist only in SQLite, so the query is a
 * `sql` template run through `kernel.run` — the kernel, never the raw better-sqlite3 handle. The
 * Postgres twin is `search-index.postgres.ts`; `search-index.ts` picks between them.
 */

/**
 * BM25 column weights, in `post_search_fts`'s declared column order (title, slug, body_text).
 *
 * Weighted, not uniform, because the product question is "where's the page ABOUT x" — a title match
 * is a claim that the document is about the term, while one body occurrence is a claim that the term
 * was mentioned. The slug sits between them: it is usually title-derived, it is human-chosen, and it
 * is literally the thing a navigation answer has to produce. The absolute numbers are a ratio, not a
 * calibration — BM25 already normalizes for field length, so these only need to encode
 * title > slug >> body, which they do at 8:4:1. Passed at query time (SQLite allows it), so retuning
 * them is a one-line change with no reindex, exactly as `searchToolCatalog` does with its own 6:1.
 */
const BM25_WEIGHTS = { title: 8.0, slug: 4.0, bodyText: 1.0 } as const;

/** `snippet()`'s ellipsis for a truncated excerpt, and the token budget for one. 20 tokens is
 * roughly a line of prose — enough to disambiguate two similar hits, short enough that a full page
 * of results is still a fraction of what one `content_post_get` would cost. */
const SNIPPET_ELLIPSIS = "…";
const SNIPPET_TOKEN_BUDGET = 20;

/**
 * Column index of `body_text` in `post_search_fts`, passed to `snippet()`.
 *
 * Pinned to the body rather than FTS5's `-1` ("pick the best-matching column"), because with `-1` a
 * title match returns a snippet that is just the title again — a field the hit already carries
 * verbatim. Anchoring on the body means the snippet always adds information. When the match is not
 * in the body, FTS5 returns that column's opening tokens, which is still a useful preview.
 */
const SNIPPET_COLUMN_BODY_TEXT = 2;

/**
 * FTS5 + BM25 over `post_search_document` (migration 0022 builds the table, the `post_search_fts`
 * index and the three triggers that keep them in step). Terms are OR'd rather than FTS5's implicit
 * AND, matching `searchToolCatalog`'s identical choice: a two-word query should still surface a
 * strong single-word match, and BM25 already demotes the weaker hit.
 */
export const sqlitePostSearch: PostSearchDialect = {
  // Migration 0022 owns the table, the index and the triggers.
  async upsert({ kernel, document }, _optional = {}) {
    await kernel.run((db) =>
      db
        .withTables<SearchProjectionTables>()
        .insertInto("post_search_document")
        .values({ post_id: document.postId, title: document.title, slug: document.slug, body_text: document.bodyText })
        .onConflict((oc) =>
          oc.column("post_id").doUpdateSet((eb) => ({
            title: eb.ref("excluded.title"),
            slug: eb.ref("excluded.slug"),
            body_text: eb.ref("excluded.body_text"),
          }))
        )
        .execute()
    );
  },

  async remove({ kernel, postId }, _optional = {}) {
    await kernel.run((db) =>
      db.withTables<SearchProjectionTables>().deleteFrom("post_search_document").where("post_id", "=", postId).execute()
    );
  },

  /**
   * @complexity FTS5's own posting-list cost per term, plus a primary-key join per candidate row;
   * the `LIMIT` is applied after the visibility filters, so a workspace's trashed/other-kind rows
   * cannot crowd real hits out of the page.
   */
  async search(kernel: PostSearchKernel, query: PostSearchQuery) {
    const filters = [
      sql`post_search_fts MATCH ${query.terms.join(" OR ")}`,
      sql`p.workspace_id = ${query.workspaceId}`,
      sql`p.deleted_at IS NULL`,
      sql`p.kind IN ('post', 'page')`,
    ];
    if (query.kind !== undefined) filters.push(sql`p.kind = ${query.kind}`);
    if (query.status !== undefined) filters.push(sql`p.status = ${query.status}`);

    // `bm25()` returns a cost where more-negative is better; negated so higher is better, as on
    // every ranked surface in this codebase.
    const rows = await queryRows(
      kernel,
      sql<PostSearchRow>`SELECT p.id AS id, p.kind AS kind, p.title AS title, p.slug AS slug, p.status AS status,
              p.updated_at AS updated_at,
              snippet(post_search_fts, ${sql.lit(SNIPPET_COLUMN_BODY_TEXT)}, '', '', ${SNIPPET_ELLIPSIS}, ${sql.lit(SNIPPET_TOKEN_BUDGET)}) AS snippet,
              -bm25(post_search_fts, ${sql.lit(BM25_WEIGHTS.title)}, ${sql.lit(BM25_WEIGHTS.slug)}, ${sql.lit(BM25_WEIGHTS.bodyText)}) AS score
       FROM post_search_fts
       JOIN post_search_document d ON d.rowid = post_search_fts.rowid
       JOIN posts p ON p.id = d.post_id
       WHERE ${sql.join(filters, sql` AND `)}
       ORDER BY score DESC
       LIMIT ${query.limit}`
    );
    return rows.map(toPostSearchHit);
  },
};

