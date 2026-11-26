/**
 * @file `TrashAdapter` for redirects. Marker: `redirects.status = 'disabled'`.
 *
 * NOTE for anyone reading the design doc alongside this: §6 of
 * `2026-09-20-trash-delete-architecture.md` guesses the literal `'tombstoned'`. It is wrong, and
 * the doc says the implementer must check. `RedirectStatus` is `"active" | "disabled"` and
 * `tombstoneRedirect` writes `"disabled"` (Jini `packages/cms/src/redirects/redirects.ts`). The tombstone is
 * additionally recorded as a `redirect_revisions.tombstoned = 1` row, which is what the backfill
 * uses to tell a deleted redirect from one an operator merely switched off.
 */
import type { TrashAdapter, TrashMarkerResult, TrashPurgeOutcome } from "@jini-ai/cms/trash";
import { compareAndDelete, flipMarker, lazyKernel } from "@jini-ai/cms/trash/site/adapters/marker-sql";
import type { MarkerStore } from "./marker-sql.js";
import { loose } from "@jini-ai/cms/trash/sql";

export const REDIRECT_ENTITY_TYPE = "redirect";

const REDIRECT_HIDDEN_STATUS = "disabled";
const REDIRECT_LIVE_STATUS = "active";

/** @complexity O(1) to build. */
export function createRedirectTrashAdapter({ store, tables }: { store: MarkerStore; tables: { redirects: string; revisions: string; hits: string } }, _optional = {}): TrashAdapter {
  const REDIRECTS_TABLE = tables.redirects;
  const REDIRECT_REVISIONS_TABLE = tables.revisions;
  const REDIRECT_HITS_TABLE = tables.hits;
  const kernel = lazyKernel({ store });
  return {
    entityType: REDIRECT_ENTITY_TYPE,

    async hide(required): Promise<TrashMarkerResult> {
      return flipMarker({
        kernel: kernel(),
        table: REDIRECTS_TABLE,
        set: { status: REDIRECT_HIDDEN_STATUS, updated_at: required.at },
        from: { column: "status", op: "<>", value: REDIRECT_HIDDEN_STATUS },
        workspaceId: required.workspaceId,
        entityId: required.entityId,
        expectedVersion: required.expectedVersion,
      });
    },

    async unhide(required): Promise<TrashMarkerResult> {
      return flipMarker({
        kernel: kernel(),
        table: REDIRECTS_TABLE,
        set: { status: REDIRECT_LIVE_STATUS, updated_at: required.at },
        from: { column: "status", op: "<>", value: REDIRECT_LIVE_STATUS },
        workspaceId: required.workspaceId,
        entityId: required.entityId,
        expectedVersion: required.expectedVersion,
      });
    },

    /** @complexity O(r) for r revisions of the one redirect. */
    async purge(required): Promise<TrashPurgeOutcome> {
      return compareAndDelete({
        kernel: kernel(),
        table: REDIRECTS_TABLE,
        workspaceId: required.workspaceId,
        entityId: required.entityId,
        expectedVersion: required.expectedVersion,
        cascade: async ({ workspaceId, entityId }) => {
          for (const table of [REDIRECT_REVISIONS_TABLE, REDIRECT_HITS_TABLE]) {
            await kernel().run((db) =>
              loose(db).deleteFrom(table).where("workspace_id", "=", workspaceId).where("redirect_id", "=", entityId).execute()
            );
          }
        },
      });
    },
  };
}
