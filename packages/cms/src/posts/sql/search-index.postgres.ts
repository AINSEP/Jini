import { sql } from "kysely";

import type { PostSearchDocument, PostSearchQuery } from "../search.js";
import { executeStatement, queryRows } from "./kernel-statements.js";
import { type PostSearchDialect, type PostSearchKernel, type PostSearchRow, toPostSearchHit } from "./search-index.contract.js";

/**
 * @file Post search on Postgres and PGlite: a `tsvector` column with a GIN index, ranked with
 * `ts_rank` — the twin of `search-index.sqlite.ts`'s FTS5 + BM25 (storage-adapter plan F1).
 *
 * Dialect-specific SQL lives here ON PURPOSE: `tsvector`, `to_tsquery`, `ts_rank`, `ts_headline` and
 * a text-search configuration exist only in Postgres. Everything runs through the kernel.
 *
 * Matching the SQLite index, not just "returning rows" (gated by `__tests__/search.eval.ts`):
 *  - Stemming. FTS5 is declared `tokenize='porter unicode61'` (migration 0022), so it stems. The
 *    `'simple'` config does not (a query for "recipes" misses "recipe"), and `'english'` drops
 *    stop-words (FTS5 finds "the"; `'english'` returns nothing). So this uses {@link SEARCH_CONFIG}:
 *    `'simple'` with its word tokens mapped to a Snowball English stemmer built WITHOUT a stop-word
 *    list.
 *  - Accents and punctuation. `unicode61` folds diacritics and splits on every non-alphanumeric
 *    character. Postgres does neither by default (and `unaccent` is an extension), so the indexed
 *    text and query terms are folded in JS ({@link foldForIndex}). `toSearchTerms` preserves
 *    Unicode letters, so the query needs the same folding as the stored vector.
 *  - OR of terms, no prefix matching (FTS5 gets bare terms too), title > slug > body weighting
 *    (8:4:1, as BM25's column weights).
 *
 * Schema: `post_search_document` with a stored `search` tsvector, written by the repo's `save()`
 * in its own transaction. Built by migration step `0001_post_search`
 * (`platform/db/migrations/0001_post_search.ts`), with the `tovu_search` configuration.
 */

/** The text-search configuration the index and the queries share. */
const SEARCH_CONFIG = "tovu_search";

/** `ts_rank` weights, in its `{D, C, B, A}` order: body (D) 1/8, slug (B) 1/2, title (A) 1 — the
 *  same 8:4:1 ratio as the SQLite adapter's BM25 column weights. */
const RANK_WEIGHTS = "{0.125,0,0.5,1}";

/** `ts_rank` normalization 1: divide by 1 + log(document length), BM25's length normalization in
 *  spirit, so one mention in a long body does not outrank a short, focused post. */
const RANK_NORMALIZATION = 1;

/** `ts_headline` options: plain text (no highlight markers) and about the SQLite snippet's 20 tokens. */
const HEADLINE_OPTIONS = 'StartSel="", StopSel="", MaxWords=20, MinWords=10';

/**
 * Folds text the way FTS5's `unicode61` tokenizer sees it: diacritics removed, every run of
 * non-letter/non-digit characters a single space. Applied symmetrically to indexed text and queries.
 */
export function foldForIndex({ text }: { text: string }, _optional: Record<string, never> = {}): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function searchVector(document: PostSearchDocument) {
  const part = ({ text, weight }: { text: string; weight: "A" | "B" | "D" }, _optional: Record<string, never> = {}) =>
    sql`setweight(to_tsvector(${sql.lit(SEARCH_CONFIG)}::regconfig, ${foldForIndex({ text })}), ${sql.lit(weight)})`;
  return sql`${part({ text: document.title, weight: "A" })} || ${part({ text: document.slug, weight: "B" })} || ${part({ text: document.bodyText, weight: "D" })}`;
}

export const pgPostSearch: PostSearchDialect = {
  async upsert({ kernel, document }, _optional = {}) {
    await executeStatement(
      kernel,
      sql`INSERT INTO post_search_document (post_id, title, slug, body_text, search)
          VALUES (${document.postId}, ${document.title}, ${document.slug}, ${document.bodyText}, ${searchVector(document)})
          ON CONFLICT (post_id) DO UPDATE SET title = excluded.title, slug = excluded.slug,
            body_text = excluded.body_text, search = excluded.search`
    );
  },

  async remove({ kernel, postId }, _optional = {}) {
    await executeStatement(kernel, sql`DELETE FROM post_search_document WHERE post_id = ${postId}`);
  },

  /**
   * @complexity A GIN lookup per term, a primary-key join per candidate, `ts_rank` per candidate;
   * `ts_headline` runs only on the `LIMIT`ed page (the outer select).
   */
  async search(kernel: PostSearchKernel, query: PostSearchQuery) {
    // Fold with the same function used on writes. Compatibility decomposition can introduce
    // separators (e.g. a fraction), so split again before inserting the sole operator, ` | `.
    // This works on Postgres and PGlite without loading unaccent or changing text collations.
    const terms = query.terms.flatMap((term) => foldForIndex({ text: term }).split(" ")).filter(Boolean);
    if (terms.length === 0) return [];
    const tsquery = sql`to_tsquery(${sql.lit(SEARCH_CONFIG)}::regconfig, ${terms.join(" | ")})`;
    const filters = [sql`d.search @@ q.query`, sql`p.workspace_id = ${query.workspaceId}`, sql`p.deleted_at IS NULL`, sql`p.kind IN ('post', 'page')`];
    if (query.kind !== undefined) filters.push(sql`p.kind = ${query.kind}`);
    if (query.status !== undefined) filters.push(sql`p.status = ${query.status}`);

    const rows = await queryRows(
      kernel,
      sql<PostSearchRow>`SELECT hit.id, hit.kind, hit.title, hit.slug, hit.status, hit.updated_at, hit.score,
              ts_headline(${sql.lit(SEARCH_CONFIG)}::regconfig, hit.body_text, hit.query, ${HEADLINE_OPTIONS}) AS snippet
       FROM (
         SELECT p.id, p.kind, p.title, p.slug, p.status, p.updated_at, d.body_text, q.query,
                ts_rank(${RANK_WEIGHTS}::float4[], d.search, q.query, ${sql.lit(RANK_NORMALIZATION)}) AS score
         FROM post_search_document d
         JOIN posts p ON p.id = d.post_id
         CROSS JOIN ${tsquery} AS q(query)
         WHERE ${sql.join(filters, sql` AND `)}
         ORDER BY score DESC
         LIMIT ${query.limit}
       ) hit
       ORDER BY hit.score DESC`
    );
    return rows.map(toPostSearchHit);
  },
};
