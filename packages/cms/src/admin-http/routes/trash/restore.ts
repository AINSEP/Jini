import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { RestoreOutcome, TrashPort } from "../../../trash/index.js";
import {
  MAX_TRASH_SELECTION, readSelection, requireTrashEntry, trashActorId,
  type TrashBodyInput, type TrashEntryGateFn, type TrashKindGateFn, type TrashRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: the two gates, the clock that stamps the restore and the restore call. */
export interface TrashRestoreRouteDeps {
  workspaceId: string;
  authorizeEntry: TrashEntryGateFn;
  mayActOn: TrashKindGateFn;
  clock: { nowIso(): string };
  trash: Pick<TrashPort, "restore">;
}

type SelectionItem = { entityType: string; entityId: string };
type RestoreResult = SelectionItem & { outcome: RestoreOutcome | "forbidden" };

/** The success envelope: how many rows came back, and one outcome per requested item. */
export interface AdminTrashRestoreEnvelope { restored: number; results: RestoreResult[] }

/** Validate one selection entry without normalizing the caller's identifiers. @complexity O(1). */
function readItem({ entry }: { entry: unknown }, _optional: Record<string, never> = {}): SelectionItem | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { entityType, entityId } = entry as { entityType?: unknown; entityId?: unknown };
  if (typeof entityType !== "string" || entityType.length === 0) return null;
  if (typeof entityId !== "string" || entityId.length === 0) return null;
  return { entityType, entityId };
}

/** Reads the selection, or `null` when the body is not a usable one. @complexity O(n) in the selection's length. */
function readItems({ body }: { body: unknown }, _optional: Record<string, never> = {}): SelectionItem[] | null {
  const raw = readSelection({ body, field: "items" });
  if (!raw) return null;
  const items: SelectionItem[] = [];
  for (const entry of raw) {
    const item = readItem({ entry });
    if (!item) return null;
    items.push(item);
  }
  return items;
}

/** Restore one item after its own per-kind check; a denied item is recorded, not thrown. @complexity O(1) plus the injected calls. */
async function restoreOne(
  { item, principalId, at, deps }: { item: SelectionItem; principalId: string; at: string; deps: TrashRestoreRouteDeps },
  _optional: Record<string, never> = {},
): Promise<RestoreResult> {
  const gate = await deps.mayActOn({ principalId, entityType: item.entityType, entityId: item.entityId });
  if (!gate.allowed) return { ...item, outcome: "forbidden" };
  const outcome = await deps.trash.restore(
    { workspaceId: deps.workspaceId, entityType: item.entityType, entityId: item.entityId, at },
    { actor: { principalId } },
  );
  return { ...item, outcome };
}

/**
 * POST restore the selected items.
 *
 * Per item, and per item only. One row whose plugin has been uninstalled, or one that someone else
 * restored a second ago, must not abort the rest of a selection the operator ticked by hand — each
 * gets its own permission check, its own transaction and its own recorded outcome, and the response
 * says which is which. A selection where every item failed is still a 200: the request was
 * understood and answered, and the per-item reasons are the answer.
 *
 * Items are addressed by `{ entityType, entityId }` rather than by the trash row's id, so this
 * endpoint maps 1:1 onto `TrashPort.restore` and needs no id lookup the port does not have. The
 * entry gate runs before the selection is read, as the hand-written route did.
 */
export const trashRestoreRoute = defineJsonRoute<TrashBodyInput, AdminTrashRestoreEnvelope, TrashRestoreRouteDeps, TrashRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/trash/restore",
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context }) => {
    const principalId = trashActorId({ context });
    await requireTrashEntry({ authorizeEntry: deps.authorizeEntry, principalId });
    const items = readItems({ body: input.body });
    if (!items) rejectRoute({ status: 400, error: `expected { items: [{ entityType, entityId }] } with 1..${MAX_TRASH_SELECTION} entries`, code: "INVALID_INPUT" });
    const at = deps.clock.nowIso();
    const results: RestoreResult[] = [];
    // Sequential on purpose: each item is its own transaction, in the order the operator ticked them.
    for (const item of items) results.push(await restoreOne({ item, principalId, at, deps }));
    return ok({ value: { restored: results.filter((r) => r.outcome === "restored").length, results } });
  },
});
