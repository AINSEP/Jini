import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { PurgeReport, TrashPort } from "../../../trash/index.js";
import {
  MAX_TRASH_SELECTION, readSelection, requireTrashEntry, trashActorId,
  type TrashBodyInput, type TrashEntryGateFn, type TrashKindGateFn, type TrashRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: the entry gate, the per-kind gate and the one purge call. */
export interface TrashPurgeRouteDeps {
  workspaceId: string;
  authorizeEntry: TrashEntryGateFn;
  mayActOn: TrashKindGateFn;
  trash: Pick<TrashPort, "purgeSelected">;
}

/** The success envelope: how many rows went, and one outcome per requested id. */
export interface AdminTrashPurgeEnvelope { purged: number; results: PurgeReport["results"] }

/**
 * Reads the selection, or `null` when the body is not a usable one.
 *
 * Duplicate ids are left as the caller sent them rather than de-duplicated: `purgeSelected` reports
 * one result per requested id, and a response with fewer results than the request had ids is harder
 * for the screen to reconcile than a repeated `already-gone`.
 *
 * @complexity O(n) in the selection's length.
 */
function readIds({ body }: { body: unknown }, _optional: Record<string, never> = {}): string[] | null {
  const raw = readSelection({ body, field: "ids" });
  if (!raw) return null;
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) return null;
    ids.push(entry);
  }
  return ids;
}

/**
 * POST permanently destroy the selected items — the only path that hard-deletes an entity on a
 * human's say-so, and so the one HTTP caller of `TrashPort.purgeSelected`.
 *
 * Two things make this route different from restore, and both come from it being irreversible:
 *
 *  1. **Items are named by trash row id**, because that is what the screen's checkboxes hold and
 *     what `purgeSelected` takes. Which means the route cannot know each row's kind from the
 *     request — a body that carried `entityType` alongside the id would let a caller name `comment`
 *     for a post's row and destroy a post holding only the comment permission. So the per-kind check
 *     is not made here at all: it is handed to `purgeSelected` as `authorizeItem` and runs against
 *     the row the service itself resolved, in the same call that then purges it.
 *  2. The entry gate is only an entry gate: it gets you to the Trash surface; destroying a row
 *     still needs that row's own kind's permission, per row.
 *
 * Denied rows come back as `"forbidden"` beside the rows that did purge, exactly as
 * `adapter-unavailable` and `version-changed` do — a selection an operator ticked by hand must not
 * be aborted wholesale because one row was not theirs to destroy. The entry gate runs before the
 * selection is read, as the hand-written route did, so a denied principal never learns the body
 * was malformed.
 */
export const trashPurgeRoute = defineJsonRoute<TrashBodyInput, AdminTrashPurgeEnvelope, TrashPurgeRouteDeps, TrashRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/trash/purge",
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context }) => {
    const principalId = trashActorId({ context });
    await requireTrashEntry({ authorizeEntry: deps.authorizeEntry, principalId });
    const ids = readIds({ body: input.body });
    if (!ids) rejectRoute({ status: 400, error: `expected { ids: [string] } with 1..${MAX_TRASH_SELECTION} entries`, code: "INVALID_INPUT" });
    const report = await deps.trash.purgeSelected({
      workspaceId: deps.workspaceId,
      ids,
      actor: { principalId },
      // Resolved rows only — see this route's doc for why the kind never comes off the request.
      authorizeItem: async ({ item }) => (await deps.mayActOn({ principalId, entityType: item.entityType, entityId: item.entityId })).allowed,
    });
    return ok({ value: { purged: report.purged, results: report.results } });
  },
});
