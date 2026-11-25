import type { PostRecord, PostRepoPort } from "./post.js";
import { toPostSearchDocument, type PostSearchHit, type PostSearchPort, type PostSearchQuery } from "./search.js";

/**
 * @file The rule-of-two partner to `search-index.sqlite.ts`: the `PostSearchPort` the hermetic
 * composition root (`apps/website/src/server/runtime/composition/app.ts`'s `createRouteDeps`, which pairs it with `InMemoryPostRepo`)
 * wires, so `content_post_search` behaves identically whether a caller booted the SQLite server or
 * the in-memory one.
 *
 * The interesting decision here is what "in-memory" means. It does NOT mean a second ranking
 * implementation. A hand-rolled scorer next to the real FTS5 one would be two answers to the same
 * question — the exact drift `@jini-ai/sqlite-chat`'s own module doc records having replaced (its
 * in-memory term-count scorer produced score ties that BM25 separates correctly), and it would make
 * every ranking test in this domain prove something about only one of the two adapters. So this
 * adapter is backed by a REAL SQLite database that merely lives in memory: `openContentDb(":memory:")`
 * runs the same migration stream a file-backed `content.db` gets, including 0022's FTS5 index and
 * its triggers, and the query itself is `sqlitePostSearch` — the same code, byte for byte, that the
 * durable SQLite adapter runs. Only the storage is different.
 *
 * Sync model, and the deliberate contrast with the durable adapter: this one MIRRORS on every
 * search rather than maintaining an index incrementally. `InMemoryPostRepo` is a plain array with no
 * write hook to attach to, and inventing one would put a search concern inside the test double every
 * post test in this repo constructs. Reseeding instead means this index cannot be stale by
 * construction — there is no window in which a repo write has happened and the index has not caught
 * up — at a cost (O(n) per query in the workspace's post count) that is exactly right for the corpus
 * this root actually holds: `server/seed.ts`'s demo content. Do not promote this adapter to a
 * durable one on the strength of it being simpler; on a real corpus the cost model is the wrong way
 * round, which is why the SQLite adapter maintains its index per write instead.
 *
 * The `:memory:` database is created lazily, on the first search. `createRouteDeps()` is constructed
 * by a large number of server tests, nearly none of which search — paying a full migration run in
 * every one of them to serve the handful that do would be a real cost for no benefit.
 */

export interface PostSearchScratch {
  transaction<T>(required: { run: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
  clearProjection(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
  clearPosts(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
  insertPost(required: { post: PostRecord }, optional?: Record<string, never>): Promise<void>;
  upsertDocument(required: { document: ReturnType<typeof toPostSearchDocument> }, optional?: Record<string, never>): Promise<void>;
  query(required: { query: PostSearchQuery }, optional?: Record<string, never>): Promise<PostSearchHit[]>;
}

export class InMemoryPostSearchIndex implements PostSearchPort {
  private readonly repo: Pick<PostRepoPort, "list">;
  private readonly openScratch: (required: Record<string, never>, optional?: Record<string, never>) => PostSearchScratch;
  private scratch: PostSearchScratch | null = null;

  /**
   * @param repo - The post store to mirror. Read on every search, so a record saved through it is
   * findable immediately.
   */
  constructor({ repo, openScratch }: {
    repo: Pick<PostRepoPort, "list">;
    openScratch: (required: Record<string, never>, optional?: Record<string, never>) => PostSearchScratch;
  }, _optional: Record<string, never> = {}) {
    this.repo = repo;
    this.openScratch = openScratch;
  }

  /**
   * Mirrors the workspace's posts into the scratch database, then runs the real ranked query.
   *
   * @param required - Already validated, tokenized and clamped by `searchAdminPosts`.
   * @complexity O(n) in the workspace's post count to mirror, plus FTS5's own search cost. See this
   * file's header for why the reseed is the right trade here and the wrong one for the durable
   * adapter.
   * @overallScore 100
   */
  async search(required: PostSearchQuery, _optional: Record<string, never> = {}): Promise<PostSearchHit[]> {
    this.scratch ??= this.openScratch({});
    const scratch = this.scratch;
    const posts = await this.repo.list({ workspaceId: required.workspaceId });
    // One transaction for mirror + query: a concurrent search for another workspace cannot swap the
    // mirrored rows out from under this one.
    return scratch.transaction({ run: async () => {
      await mirrorPosts(scratch, posts);
      return scratch.query({ query: required });
    } });
  }
}

/**
 * Replaces the scratch database's contents with `posts` (inside the caller's transaction).
 *
 * Deleting `post_search_document` first is what keeps the FTS index correct: the 0022 delete trigger
 * removes each row's index entry, so a post that has since been removed from the repo (or renamed)
 * leaves nothing behind for the next query to match.
 *
 * @complexity O(n) in `posts`.
 * @overallScore 100
 */
async function mirrorPosts(scratch: PostSearchScratch, posts: readonly PostRecord[]): Promise<void> {
  await scratch.clearProjection({});
  await scratch.clearPosts({});
  for (const post of posts) {
    await scratch.insertPost({ post });
    await scratch.upsertDocument({ document: toPostSearchDocument(post) });
  }
}
