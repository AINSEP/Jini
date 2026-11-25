/**
 * @file `TrashAdapter` for posts and pages. Marker: `posts.deleted_at`.
 *
 * Column-only, by contract — `posts.body_json` is never read here, so a post whose body JSON is
 * unparseable is still trashable and restorable.
 */
import type { TrashAdapter, TrashMarkerResult, TrashPurgeOutcome } from "../../index.js";
import { compareAndDelete, flipMarker, lazyKernel } from "./marker-sql.js";
import type { MarkerStore } from "./marker-sql.js";
import { loose } from "../../sql/index.js";

export const POST_ENTITY_TYPE = "post";

const POSTS_TABLE = "posts";
const POST_REVISIONS_TABLE = "post_revisions";
/** Ordinary projection table behind the FTS5 index; its triggers keep `post_search_fts` in step. */
const POST_SEARCH_DOCUMENT_TABLE = "post_search_document";

/**
 * Builds the post adapter over the shared `content.db` connection.
 *
 * @param store the content kernel (or, while call sites still hold one, the `content.db` handle);
 *        every statement joins whatever transaction the caller opened.
 * @complexity O(1) to build.
 */
export function createPostTrashAdapter<DB>({ store, tableExists }: {
  store: MarkerStore<DB>;
  tableExists: (required: { kernel: MarkerStore<DB>; table: string }, optional?: Record<string, never>) => Promise<boolean>;
}, _optional: Record<string, never> = {}): TrashAdapter {
  const kernel = lazyKernel({ store });
  // The search projection exists only where the database has a full-text index built on it (SQLite's
  // FTS5); asked once, on the first purge.
  let hasSearchDocument: Promise<boolean> | undefined;
  return {
    entityType: POST_ENTITY_TYPE,

    async hide(required): Promise<TrashMarkerResult> {
      return flipMarker({
        kernel: kernel(),
        table: POSTS_TABLE,
        set: { deleted_at: required.at, updated_at: required.at },
        from: { column: "deleted_at", op: "is", value: null },
        workspaceId: required.workspaceId,
        entityId: required.entityId,
        expectedVersion: required.expectedVersion,
      });
    },

    async unhide(required): Promise<TrashMarkerResult> {
      return flipMarker({
        kernel: kernel(),
        table: POSTS_TABLE,
        set: { deleted_at: null, updated_at: required.at },
        from: { column: "deleted_at", op: "is not", value: null },
        workspaceId: required.workspaceId,
        entityId: required.entityId,
        expectedVersion: required.expectedVersion,
      });
    },

    /**
     * The revision ledger and the search projection go WITH the row.
     *
     * Deliberate, and the opposite of the comments plugin's `moderation_log` rule: `post_revisions`
     * holds a full copy of every version of the post, so retaining it after a purge would make
     * "removed after 60 days" false and would grow the file forever with rows pointing at nothing.
     * The `moderation_log` is an audit of MODERATOR ACTIONS, not of content, which is why that one
     * is kept and this one is not.
     *
     * @complexity O(r) for r revisions of the one post.
     */
    async purge(required): Promise<TrashPurgeOutcome> {
      return compareAndDelete({
        kernel: kernel(),
        table: POSTS_TABLE,
        workspaceId: required.workspaceId,
        entityId: required.entityId,
        expectedVersion: required.expectedVersion,
        cascade: async ({ workspaceId, entityId }) => {
          await kernel().run((db) =>
            loose(db).deleteFrom(POST_REVISIONS_TABLE).where("workspace_id", "=", workspaceId).where("post_id", "=", entityId).execute()
          );
          hasSearchDocument ??= tableExists({ kernel: kernel(), table: POST_SEARCH_DOCUMENT_TABLE }).catch((error: unknown) => {
            hasSearchDocument = undefined; // a failed probe is not an answer; ask again next time
            throw error;
          });
          if (await hasSearchDocument) {
            await kernel().run((db) => loose(db).deleteFrom(POST_SEARCH_DOCUMENT_TABLE).where("post_id", "=", entityId).execute());
          }
        },
      });
    },
  };
}
