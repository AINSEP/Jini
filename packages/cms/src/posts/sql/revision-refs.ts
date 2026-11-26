import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";

type ContentKernel = StorageKernel<Kysely<unknown>, unknown>;
type ContentTables = {
  posts: { workspace_id: string; id: string; status: string; version: number };
  post_revisions: { workspace_id: string; post_id: string; id: string; seq: number; recorded_at: string; restored_from: string | null; state_json: string };
  change_sets: { id: string; workspace_id: string; status: string };
  change_set_items: { id: string; change_set_id: string; entity_id: string; before_revision_id: string | null; after_revision_id: string | null; inverse_payload_json: string | null };
};

import type { RevisionRefProbe, RevisionThinningScope } from "./revision-thinning.js";

/**
 * @file The production reference probes revision thinning asks before deleting a `post_revisions`
 * row. Each reads through `kernel.run`, so when the engine calls it inside its apply (under
 * `postRevisionLockKey`, in the apply's transaction) it reads on that same transaction. A probe that
 * cannot read throws, and the engine keeps the revision: unknown is never "unreferenced".
 */

/** Change sets that can no longer be undone; every other status (including one this code does not
 *  know yet) still counts as pending, so its references keep their targets. */
const SETTLED_CHANGE_SETS: ReadonlySet<string> = new Set(["reverted", "discarded"]);

type Db = Parameters<Parameters<ContentKernel["run"]>[0]>[0];

/** This post's change-set items in this workspace (an item's entity id is only unique per site). */
function postItems(db: Db, scope: RevisionThinningScope) {
  return db.withTables<ContentTables>().selectFrom("change_set_items").innerJoin("change_sets", "change_sets.id", "change_set_items.change_set_id")
    .where("change_sets.workspace_id", "=", scope.workspaceId).where("change_set_items.entity_id", "=", scope.postId);
}

/** The `version` an inverse payload would restore to; `undefined` for unreadable JSON (fail closed). */
function inverseVersion(payload: unknown): number | null | undefined {
  try {
    const parsed = typeof payload === "string" ? JSON.parse(payload) as unknown : payload;
    const version = (parsed as { version?: unknown } | null)?.version;
    return typeof version === "number" ? version : null;
  } catch {
    return undefined;
  }
}

/**
 * The three probes for {@link import("./revision-thinning.js").bindRevisionThinning}:
 *  - `undoRefs`: a change-set item names the revision in `before_revision_id`/`after_revision_id`
 *    (any status: an audit trail that names a revision must keep resolving).
 *  - `restoreRefs`: a pending change set's inverse payload restores to the revision's `seq` (what
 *    `restorePostForward` looks up by `seq == prior.version`), an unreadable payload, or the live
 *    row's previous version — the state an in-flight rollback compensation reads back before its
 *    change set is persisted.
 *  - `publishedRefs`: the post is published (live, or scheduled via a future `publish_at`, which is
 *    stored as published) and its current version is this revision's `seq`.
 * @complexity undo O(1) indexed query; restore O(i) over this post's change-set items; published O(1).
 */
export function postRevisionRefProbes(required: { kernel: ContentKernel }, _optional: Record<string, never> = {}): {
  undoRefs: RevisionRefProbe; restoreRefs: RevisionRefProbe; publishedRefs: RevisionRefProbe;
} {
  const { kernel } = required;
  const livePost = (scope: RevisionThinningScope) => kernel.run((db) => db.withTables<ContentTables>().selectFrom("posts").select(["status", "version"])
    .where("workspace_id", "=", scope.workspaceId).where("id", "=", scope.postId).executeTakeFirst());
  return {
    undoRefs: async ({ scope, revision }) => {
      const hit = await kernel.run((db) => postItems(db, scope).select("change_set_items.id")
        .where((eb) => eb.or([eb("change_set_items.before_revision_id", "=", revision.id), eb("change_set_items.after_revision_id", "=", revision.id)]))
        .limit(1).executeTakeFirst());
      return hit !== undefined;
    },
    restoreRefs: async ({ scope, revision }) => {
      const live = await livePost(scope);
      if (live && live.version - 1 === revision.seq) return true;
      const items = await kernel.run((db) => postItems(db, scope)
        .select(["change_sets.status as status", "change_set_items.inverse_payload_json as payload"]).execute());
      return items.some(({ status, payload }) => {
        if (SETTLED_CHANGE_SETS.has(status) || payload == null) return false;
        const version = inverseVersion(payload);
        return version === undefined || version === revision.seq;
      });
    },
    publishedRefs: async ({ scope, revision }) => {
      const live = await livePost(scope);
      return live?.status === "published" && live.version === revision.seq;
    },
  };
}
