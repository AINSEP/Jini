import type { UUID } from "@jini-ai/core/primitives";
import { toPostSearchDocument, type PostSearchHit, type PostSearchPort, type PostSearchQuery } from "../search.js";
import type { PostSearchDialect, PostSearchKernel, SearchProjectionTables } from "./search-index.contract.js";
import { pgPostSearch } from "./search-index.postgres.js";
import { sqlitePostSearch } from "./search-index.sqlite.js";

/**
 * @file Post search over the storage kernel: ONE port, one implementation per dialect, picked by
 * `kernel.dialect` in {@link postSearchFor} (storage-adapter plan slice F1).
 *
 * Full-text search is the one place post storage is spelled per dialect, by design: SQLite's FTS5
 * (`search-index.sqlite.ts`) has no Postgres twin and Postgres's `tsvector` (`search-index.postgres.ts`)
 * has no SQLite one. Both run through `kernel.run`/`kernel.query` with `sql` fragments, never a raw
 * driver handle, and both keep the same projection table (`post_search_document`, keyed by post id),
 * the same query-time visibility filters against the live `posts` row, and the same OR-of-terms
 * semantics. Their agreement is gated by the eval set in `__tests__/search.eval.ts`.
 */

/**
 * The columns of `posts` and `setting_values_global` this module reads or writes, as table views on
 * the schema-erased kernel. The host owns both tables; only what is named here is touched.
 */
type SearchSourceTables = SearchProjectionTables & {
  posts: { id: string; title: string; slug: string; body_json: unknown; body_format: string | null; body_html: string | null };
  setting_values_global: {
    setting_id: string; value_json: unknown; state: string; def_version: number; seq: number;
    updated_by: string; updated_at: string; origin_plugin_id: string | null;
  };
};

/** The post search for `kernel`'s dialect. */
export function postSearchFor(kernel: PostSearchKernel, _optional: Record<string, never> = {}): PostSearchDialect {
  return kernel.dialect === "sqlite" ? sqlitePostSearch : pgPostSearch;
}

/**
 * The production `PostSearchPort` on any content database. Constructed by the composition root
 * against the same kernel the post repo writes through, so a saved post is findable on the next
 * call — no reindex step, no eventual-consistency window.
 */
export class PostSearchIndex implements PostSearchPort {
  protected readonly kernel: PostSearchKernel;
  private readonly ready: Promise<unknown> | undefined;

  /**
   * @param required.kernel - The content kernel supplied by composition.
   * @param optional.ready - Settles when the boot backfill is done; every search waits for it.
   */
  constructor(required: { kernel: PostSearchKernel }, optional: { ready?: Promise<unknown> } = {}) {
    this.kernel = required.kernel;
    this.ready = optional.ready;
  }

  async search(required: PostSearchQuery): Promise<PostSearchHit[]> {
    await this.ready;
    return postSearchFor(this.kernel).search(this.kernel, required);
  }
}

/**
 * The FTS5 `PostSearchPort` on a site's SQLite `content.db`: {@link PostSearchIndex} kept as a
 * named class so SQLite call sites can retain their explicit adapter name over a composed kernel.
 */
export class SqlitePostSearchIndex extends PostSearchIndex {}

/**
 * The composition root's post search on `kernel`, whichever dialect: FTS5 on SQLite, the
 * `tsvector` index on Postgres/PGlite ({@link postSearchFor} picks per call).
 *
 * @param optional.ready - Settles when the boot backfill is done; every search waits for it.
 */
export function postSearchIndexFor(kernel: PostSearchKernel, optional: { ready?: Promise<unknown> } = {}): PostSearchPort {
  return new PostSearchIndex({ kernel }, optional);
}

/** Posts indexed per backfill transaction: one PGlite transaction blocks every other client. */
export const BACKFILL_BATCH_SIZE = 50;

/**
 * Indexes every post that has no projection yet, and returns how many it wrote.
 *
 * This is the answer to "existing posts must be searchable without an edit" — both for a database
 * that predates the index and for the demo content `seedContentDb` inserts straight into `posts`
 * without going near the repo. Anti-join rather than a rebuild: on a warm database it costs one
 * indexed `NOT EXISTS` scan and writes nothing, which is what makes it safe to run on every boot.
 *
 * NOT a repair pass. It fills gaps; it does not re-extract text for posts already indexed, because
 * the only thing that could make an existing projection wrong is a change to the projection code
 * itself (`toPostSearchDocument` and the extractors behind it). That case is
 * {@link reindexStalePostSearchIndex}'s job, keyed on {@link POST_SEARCH_PROJECTION_VERSION}; the
 * boot runs both through {@link preparePostSearchIndex}.
 *
 * Runs in small transactions of {@link BACKFILL_BATCH_SIZE} posts, each re-reading what is still
 * missing: a long single transaction would hold PGlite's one connection (every other client, the
 * agent daemon included, waits). A crash midway leaves whole batches indexed and the rest for the
 * next boot, which is what the anti-join already handles.
 *
 * @param required.kernel - The content kernel supplied by composition.
 * @param optional.batchSize - Posts per transaction (tests).
 * @returns The number of posts newly indexed.
 * @complexity O(m) in the number of UNINDEXED posts, plus one O(n) anti-join over `posts` per batch.
 * @overallScore 100
 */
export async function backfillPostSearchIndex({ kernel }: { kernel: PostSearchKernel }, optional: { batchSize?: number } = {}): Promise<number> {
  const search = postSearchFor(kernel);
  const batchSize = optional.batchSize ?? BACKFILL_BATCH_SIZE;
  let indexed = 0;
  for (;;) {
    const written = await kernel.transaction(async () => {
      const missing = await kernel.run((db) =>
        db
          .withTables<SearchSourceTables>()
          .selectFrom("posts as p")
          .select(["p.id", "p.title", "p.slug", "p.body_json", "p.body_format", "p.body_html"])
          .where(({ not, exists, selectFrom }) =>
            not(exists(selectFrom("post_search_document as d").select("d.post_id").whereRef("d.post_id", "=", "p.id")))
          )
          .orderBy("p.id")
          .limit(batchSize)
          .execute()
      );
      for (const row of missing) await search.upsert({ kernel, document: projectPostRow(row) });
      return missing.length;
    });
    indexed += written;
    if (written < batchSize) return indexed;
  }
}

/**
 * The version of the projection {@link toPostSearchDocument} writes. BUMP IT whenever a change to
 * that function (or the extractors behind it) would make an already-stored `post_search_document`
 * row disagree with what a fresh save would write — the next boot of every site then re-projects
 * its posts once, with nobody resaving anything.
 *
 * History: 1 — `body_json` text only. 2 — HTML-format posts project `body_html`'s visible text
 * (f7ca1e766; before it, every HTML page was indexed by title and slug alone).
 */
export const POST_SEARCH_PROJECTION_VERSION = 2;

/**
 * Where a site records the projection version its `post_search_document` rows were written with: a
 * reserved row in `setting_values_global` (one per content database, i.e. per site), so the marker
 * needs no schema change on any dialect. No setting definition exists for this id, so the settings
 * UI and resolver never surface it; the row only says "rows already match version N".
 */
export const POST_SEARCH_PROJECTION_VERSION_SETTING_ID = "tovu.internal.post_search.projection_version";

/**
 * Re-projects EVERY post once when the site's stored projection version is older than
 * {@link POST_SEARCH_PROJECTION_VERSION}, then records the new version; returns how many posts it
 * re-projected (0 when the marker is current, which is every boot after the first).
 *
 * Why a version marker rather than a per-boot comparison: re-extracting every body on every boot to
 * spot the stale ones would cost O(corpus) forever; the marker makes a warm boot one keyed read.
 * Why not a migration step: a migration runs inside boot's critical path in one go, and the
 * projection code lives in this feature, not in `platform/db`.
 *
 * Same batching as {@link backfillPostSearchIndex}: keyset pages of `batchSize` posts, each in its own
 * transaction, so PGlite's single connection is released between pages. Idempotent: a crash midway
 * leaves the marker old and the next boot simply starts over (re-projecting a post is a no-op in
 * effect). On Postgres each page locks its `posts` rows (`FOR UPDATE`) so a concurrent `save()` can
 * neither be overwritten by a projection of the row it just replaced nor interleave with one.
 *
 * @param required.kernel - The content kernel supplied by composition.
 * @param optional.batchSize - Posts per transaction (tests).
 * @returns The number of posts re-projected.
 * @complexity O(1) when current; otherwise O(n) in all posts, once per version bump.
 * @overallScore 100
 */
export async function reindexStalePostSearchIndex({ kernel }: { kernel: PostSearchKernel }, optional: { batchSize?: number } = {}): Promise<number> {
  if ((await readProjectionVersion(kernel)) >= POST_SEARCH_PROJECTION_VERSION) return 0;
  const search = postSearchFor(kernel);
  const batchSize = optional.batchSize ?? BACKFILL_BATCH_SIZE;
  let reindexed = 0;
  let after: string | null = null;
  for (;;) {
    const cursor: string | null = after;
    const ids: string[] = await kernel.transaction(async (): Promise<string[]> => {
      const rows = await kernel.run((db) =>
        db
          .withTables<SearchSourceTables>()
          .selectFrom("posts")
          .select(["id", "title", "slug", "body_json", "body_format", "body_html"])
          .$if(cursor !== null, (qb) => qb.where("id", ">", cursor as string))
          .orderBy("id")
          .limit(batchSize)
          .$if(kernel.dialect === "postgres", (qb) => qb.forUpdate())
          .execute()
      );
      for (const row of rows) await search.upsert({ kernel, document: projectPostRow(row) });
      return rows.map((row) => row.id);
    });
    reindexed += ids.length;
    if (ids.length < batchSize) break;
    after = ids.at(-1) ?? null;
  }
  await writeProjectionVersion(kernel);
  return reindexed;
}

/**
 * The boot step for post search: corrects rows a projection-code change left stale
 * ({@link reindexStalePostSearchIndex}), then fills posts that have no row at all
 * ({@link backfillPostSearchIndex}). Rebuild first, so the first boot after a version bump never
 * projects a missing post twice; the backfill then costs its usual single anti-join.
 *
 * @param required.kernel - The content kernel supplied by composition.
 * @param optional.batchSize - Posts per transaction (tests).
 * @returns How many posts each step wrote.
 * @overallScore 100
 */
export async function preparePostSearchIndex(
  required: { kernel: PostSearchKernel },
  optional: { batchSize?: number } = {}
): Promise<{ reindexed: number; backfilled: number }> {
  const reindexed = await reindexStalePostSearchIndex(required, optional);
  const backfilled = await backfillPostSearchIndex(required, optional);
  return { reindexed, backfilled };
}

/** The stored projection version, 1 when the site has never recorded one (every pre-marker site). */
async function readProjectionVersion(kernel: PostSearchKernel): Promise<number> {
  const row = await kernel.run((db) =>
    db
      .withTables<SearchSourceTables>()
      .selectFrom("setting_values_global")
      .select("value_json")
      .where("setting_id", "=", POST_SEARCH_PROJECTION_VERSION_SETTING_ID)
      .executeTakeFirst()
  );
  // SQLite returns the text; a jsonb column may come back already parsed. Anything unreadable
  // counts as "old": the worst a misread costs is one redundant rebuild.
  const raw: unknown = row?.value_json;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      value = null;
    }
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

async function writeProjectionVersion(kernel: PostSearchKernel): Promise<void> {
  const columns = {
    value_json: JSON.stringify(POST_SEARCH_PROJECTION_VERSION), state: "set", def_version: 0, seq: 0,
    updated_by: "system:post-search-reindex", updated_at: new Date().toISOString(), origin_plugin_id: null,
  };
  await kernel.run((db) =>
    db
      .withTables<SearchSourceTables>()
      .insertInto("setting_values_global")
      .values({ setting_id: POST_SEARCH_PROJECTION_VERSION_SETTING_ID, ...columns })
      .onConflict((oc) => oc.column("setting_id").doUpdateSet(columns))
      .execute()
  );
}

/** One `posts` row as the search projection reads it, from either the backfill or the rebuild. */
function projectPostRow(row: {
  id: string; title: string; slug: string; body_json: unknown; body_format: string | null; body_html: string | null;
}) {
  return toPostSearchDocument({
    id: row.id as UUID, title: row.title, slug: row.slug, bodyJson: parseBodyJson({ raw: row.body_json }),
    bodyFormat: row.body_format === "html" ? "html" : "doc", bodyHtml: row.body_html,
  });
}

/**
 * Tolerant `body_json` read for the backfill path (text on SQLite, already parsed on Postgres).
 *
 * The repo's `toRecord` parses the same column with a bare `JSON.parse`, and is right to: a read
 * that silently returns a post with no body would hide real corruption. This path is different —
 * it is a boot-time sweep over EVERY existing row, so one unparseable legacy body must not stop the
 * server from starting. The post still gets indexed by title and slug; only its body text is lost.
 */
function parseBodyJson({ raw }: { raw: unknown }, _optional: Record<string, never> = {}): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
