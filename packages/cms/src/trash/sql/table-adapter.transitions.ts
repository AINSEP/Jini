/**
 * @file The two marker transitions of the table adapter, `hide` and `unhide`. Both read the row FIRST, then classify
 * not-found / version-changed / already-in-state / real transition, in that order — a version mismatch always wins over
 * "it's already in the target state". Each runs in `kernel.transaction` holding the row's lock.
 */
import type { TrashMarkerResult } from "../ports.js";
import { checkBlocker } from "./table-adapter.cascade.js";
import { lockRow, VERSION_CHANGED, type TableTrashContext } from "./table-adapter.context.js";
import { hasVersionChanged, isMarkerValueLive, readMarkerRow, readVersion, writeMarker } from "./table-adapter.rows.js";

/** What `hide` and `unhide` both receive. */
export interface TransitionInput {
  workspaceId: string;
  entityId: string;
  at: string;
  expectedVersion: number | null;
}

/**
 * Move the entry's marker to hidden. Classification order: not-found -> version-changed -> already-in-state
 * (idempotent, no write) -> blocked (only when `entry.blocker` finds rows) -> real transition. `blocked` sits after the
 * idempotent check on purpose: re-hiding an already-trashed row must stay a true no-op even if a blocking
 * child has since appeared, since nothing is about to change.
 *
 * @complexity O(1): one read, at most one blocker count, at most one write, at most one re-read —
 *             all inside one transaction (a nested one joins the caller's).
 */
export async function hideRow({ ctx, input }: { ctx: TableTrashContext; input: TransitionInput }, _optional = {}): Promise<TrashMarkerResult> {
  const { entry } = ctx;
  return ctx.kernel().transaction(async () => {
    const { workspaceId, entityId, at, expectedVersion } = input;
    await lockRow({ ctx, workspaceId, entityId });
    const before = await readMarkerRow({ ctx, workspaceId, entityId });
    if (!before) return { ok: false, reason: "not-found" };
    if (hasVersionChanged({ entry, row: before, expectedVersion })) {
      return { ok: false, reason: VERSION_CHANGED };
    }
    if (!isMarkerValueLive({ marker: entry.marker, value: before.marker })) {
      // Already trashed -- idempotent success, no write (the same fallback as a compare-and-set flip).
      // `noop: true` tells `withFollowUps` nothing actually changed here.
      return { ok: true, version: entry.versionColumn ? (before.version ?? null) : null, noop: true };
    }
    const blocked = await checkBlocker({ ctx, entityId });
    if (blocked) return blocked;

    const written = await writeMarker({ ctx, workspaceId, entityId, markerValue: entry.marker.kind === "timestamp" ? at : entry.marker.trashed, at, before });
    if (!written) return { ok: false, reason: VERSION_CHANGED };

    const version = await readVersion({ ctx, workspaceId, entityId });
    // `priorMarker` is additive and only meaningful for a status marker's
    // real transition — a timestamp marker has no "previous value" to remember, and the
    // idempotent branch above never reaches here. Omitting the key (not setting it to
    // `undefined`) keeps a timestamp entry's result shape byte-identical to a plain
    // `{ ok: true, version }` (`ports.ts`'s `TrashMarkerResult` doc).
    if (entry.marker.kind === "status") {
      return { ok: true, version, priorMarker: before.marker as string };
    }
    return { ok: true, version };
  });
}

/**
 * Move the marker back. Mirror of {@link hideRow} — see its doc for the shared classification order. A
 * status marker restores to `priorMarker ?? restoreFallback`; a timestamp marker just clears the
 * column, since there is nothing to restore to.
 *
 * @complexity O(1), same shape as `hideRow`.
 */
export async function unhideRow({ ctx, input }: { ctx: TableTrashContext; input: TransitionInput }, optional: { priorMarker?: string | null } = {}): Promise<TrashMarkerResult> {
  const { entry } = ctx;
  return ctx.kernel().transaction(async () => {
    const { workspaceId, entityId, at, expectedVersion } = input;
    const { priorMarker } = optional;
    await lockRow({ ctx, workspaceId, entityId });
    const before = await readMarkerRow({ ctx, workspaceId, entityId });
    if (!before) return { ok: false, reason: "not-found" };
    if (hasVersionChanged({ entry, row: before, expectedVersion })) {
      return { ok: false, reason: VERSION_CHANGED };
    }
    if (isMarkerValueLive({ marker: entry.marker, value: before.marker })) {
      // Already live -- idempotent success, no write. `noop: true`, same as `hideRow`'s mirror
      // branch above.
      return { ok: true, version: entry.versionColumn ? (before.version ?? null) : null, noop: true };
    }

    const written = await writeMarker({
      ctx,
      workspaceId,
      entityId,
      markerValue: entry.marker.kind === "timestamp" ? null : (priorMarker ?? entry.marker.restoreFallback),
      at,
      before,
    });
    if (!written) return { ok: false, reason: VERSION_CHANGED };

    return { ok: true, version: await readVersion({ ctx, workspaceId, entityId }) };
  });
}
