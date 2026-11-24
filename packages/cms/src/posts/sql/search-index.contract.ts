import type { UUID } from "@jini-ai/core/primitives";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import type { Kysely } from "kysely";
import type { PostStatus } from "../../core/index.js";
import type { PostSearchDocument, PostSearchHit, PostSearchQuery } from "../search.js";

/** The host's content kernel with its schema erased: each query below supplies its own table view
 *  on this same kernel (`withTables`), so the host never has to share its generated schema types. */
export type PostSearchKernel = StorageKernel<Kysely<unknown>, unknown>;

/** The two names a host owns in its database and injects here, because both are persisted by the host's
 *  migrations or rows and this package must not pick them. */
export interface PostSearchHostConfig {
  /** The Postgres text-search configuration its migration created (`CREATE TEXT SEARCH CONFIGURATION`). */
  searchConfig: string;
  /**
   * Where a site records the projection version its `post_search_document` rows were written with: a
   * reserved row in `setting_values_global` (one per content database, i.e. per site), so the marker
   * needs no schema change on any dialect. No setting definition exists for this id, so the settings
   * UI and resolver never surface it; the row only says "rows already match version N".
   */
  projectionVersionSettingId: string;
}

/** Where a dialect keeps post search text. Written in the same transaction as the post. */
export interface PostSearchProjection {
  upsert(required: { kernel: PostSearchKernel; document: PostSearchDocument }, optional?: Record<string, never>): Promise<void>;
  remove(required: { kernel: PostSearchKernel; postId: string }, optional?: Record<string, never>): Promise<void>;
}

/** One dialect's post search: the repo's projection writes plus the ranked query. */
export interface PostSearchDialect extends PostSearchProjection {
  search(kernel: PostSearchKernel, query: PostSearchQuery): Promise<PostSearchHit[]>;
}

/** `post_search_document` as both dialects share it (the Postgres one adds a `search` tsvector). It
 *  is not in the generated `ContentDatabase` types: SQLite builds it in drizzle migration 0022,
 *  Postgres in migration step `0001_post_search`. */
export type SearchProjectionTables = {
  post_search_document: { post_id: string; title: string; slug: string; body_text: string };
};

/** One ranked row, before projection into a {@link PostSearchHit}. */
export interface PostSearchRow {
  id: string;
  kind: string;
  title: string;
  slug: string;
  status: string;
  updated_at: string;
  snippet: string;
  /** Higher is better (each dialect converts its own scale). */
  score: number;
}

export function toPostSearchHit(row: PostSearchRow): PostSearchHit {
  return {
    id: row.id as UUID,
    kind: row.kind as PostKind,
    title: row.title,
    slug: row.slug,
    status: row.status as PostStatus,
    updatedAt: row.updated_at,
    snippet: row.snippet,
    score: Number(row.score),
  };
}
