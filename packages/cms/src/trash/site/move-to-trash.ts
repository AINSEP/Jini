/**
 * @file `moveToTrash` — the ONE generic delete `POST /trash/items` (and, later, every per-domain
 * Delete button except Posts) calls into, for any kind registered in `TRASHABLE`. Design of record:
 * `ADS-memory/.local-artifacts/handoffs/2026-09-21-t8f-trash-more-plan.md` §3.
 *
 * This is deliberately a thin read-then-write, not a second place that decides what "trashed" means:
 * the marker flip and the `trashed_items` insert still happen inside `TrashPort.trash`
 * (`@jini-ai/cms/trash`), one transaction, exactly as every bespoke `remove*` path already works. What
 * this file adds is the part a bespoke `remove*` binding does not need — resolving WHICH kind, WHICH
 * permission and WHICH row, generically, from `TRASHABLE` alone, so a new registry entry needs no new
 * route and no new binding.
 *
 * Every outcome is a typed result, never a thrown error — same convention as `TrashMarkerResult`/
 * `RestoreOutcome`/`TrashPurgeOutcome` elsewhere in this feature, so the route (`routes/trash/
 * items.ts`) maps outcomes to status codes without a try/catch around a business decision.
 */
import type { TrashEntityType, TrashPort, TrashMarkerResult, TrashEntry, TrashRegistry } from "../index.js";
import type { TrashActor, MoveToTrashOutcome, TrashKindMover } from "@jini-ai/core/contracts/site/cms-trash";
import type { EntitySnapshotRow } from "../sql/index.js";

/** Whether the actor holds `permission` for this one entity. @complexity O(1): one authorize call. */
async function isAllowed(
  required: { workspaceId: string; entityType: TrashEntityType; entityId: string; actor: TrashActor },
  deps: { authorize: MoveToTrashDeps["authorize"]; permission: string }
): Promise<boolean> {
  const decision = await deps.authorize({
    principalId: required.actor.principalId,
    permission: deps.permission,
    workspaceId: required.workspaceId,
    entityType: required.entityType,
    entityId: required.entityId,
  });
  return decision.allowed;
}

/**
 * Moves one entity of a `TRASHABLE` kind into the Trash.
 *
 * Flow (plan §3): resolve the kind → authorize the kind's own permission → read its live display and
 * version through {@link notTrashed} (a row that is missing OR already trashed reads as `not-found`
 * here — the caller cannot re-trash what is already gone from its own point of view) → call
 * `TrashPort.trash`, which performs the marker flip and the index insert as one transaction.
 *
 * `deps.clock` is not part of the plan's own literal deps list (`{ registry, trash, db, authorize }`)
 * but is required to produce `at` for `TrashPort.trash`: every other caller of `trash.trash` in this
 * codebase (the bespoke `remove*` bindings, this route's siblings) is handed a clock rather than a
 * fixed timestamp, and `moveToTrash`'s own required object has no `at` field per the plan's §0
 * signature list. Flagged as a deviation, not a silent addition.
 *
 * A kind in `deps.movers` (see {@link TrashKindMover}) moves itself, ahead of any registry entry; one
 * in neither is `unknown-type`.
 *
 * @complexity O(1): one authorize call, one indexed read, one `TrashPort.trash` call (itself O(1)).
 */
export interface MoveToTrashRequired {
    workspaceId: string;
    entityType: TrashEntityType;
    entityId: string;
    actor: TrashActor;
    /**
     * The version the caller last showed the human — e.g. a confirmation dialog's own snapshot read,
     * taken before the human answered. When the entry has a version column and the row's version at
     * write time differs from this, the row changed while the confirmation was open, and the call is
     * refused as `version-changed` rather than trashing whatever is there now. `undefined` (the
     * caller never read a version, or the kind has none) skips the check.
     */
    expectedVersion?: number | null;
  }

export interface MoveToTrashDeps {
    registry: TrashRegistry;
    trash: TrashPort;
    readLiveSnapshot(required: { entry: TrashEntry; workspaceId: string; entityId: string }, optional?: Record<string, never>): Promise<EntitySnapshotRow | null>;
    authorize: (required: { principalId: string; permission: string; workspaceId: string; entityType: TrashEntityType; entityId: string }) => Promise<{ allowed: boolean }>;
    clock: { nowIso(): string };
    movers?: ReadonlyMap<TrashEntityType, TrashKindMover>;
  }

export async function moveToTrash(
  required: MoveToTrashRequired,
  deps: MoveToTrashDeps,
): Promise<MoveToTrashOutcome> {
  // A mover wins over a registry entry: the hermetic composition registers its memory-backed forms
  // for the Trash's permission gate, but `deps.db` has no row of theirs to read below.
  const mover = deps.movers?.get(required.entityType);
  if (mover) {
    if (!(await isAllowed(required, { authorize: deps.authorize, permission: mover.permission }))) {
      return { ok: false, reason: "forbidden", permission: mover.permission };
    }
    return mover.move({ workspaceId: required.workspaceId, entityId: required.entityId, actor: required.actor });
  }
  const entry = deps.registry.get(required.entityType);
  if (!entry) return { ok: false, reason: "unknown-type" };

  if (!(await isAllowed(required, { authorize: deps.authorize, permission: entry.permission }))) {
    return { ok: false, reason: "forbidden", permission: entry.permission };
  }

  // A shared table's other kinds (a collection row in `entries`) read as not-found here too.
  const row = await deps.readLiveSnapshot(
    { entry, workspaceId: required.workspaceId, entityId: required.entityId }
  );
  if (!row) return { ok: false, reason: "not-found" };

  return trashLiveSnapshot({ input: required, entry, row }, deps);
}

/** Confirm and remove the live snapshot through the existing atomic Trash port. */
async function trashLiveSnapshot(
  required: { input: Parameters<typeof moveToTrash>[0]; entry: TrashEntry; row: EntitySnapshotRow },
  deps: Pick<Parameters<typeof moveToTrash>[1], "trash" | "clock">,
): Promise<MoveToTrashOutcome> {
  const { input, entry, row } = required;
  // The confirmation-dialog race: the human was shown `input.expectedVersion` before answering,
  // and the row now reads differently — same "changed while the confirmation was open" outcome the
  // race against `deps.trash.trash` itself already distinguishes below, caught one read earlier.
  if (entry.versionColumn && input.expectedVersion !== undefined && (row.version ?? null) !== input.expectedVersion) {
    return { ok: false, reason: "version-changed" };
  }

  const marker = await deps.trash.trash({
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    actor: input.actor,
    display: { title: row.title, subtitle: row.subtitle ?? null },
    at: deps.clock.nowIso(),
    expectedVersion: entry.versionColumn ? (row.version ?? null) : null,
  });
  return markerOutcome({ marker });
}

/** Keep adapter-only success metadata out of the generic removal result. */
function markerOutcome(required: { marker: TrashMarkerResult }, _options: Record<string, never> = {}): MoveToTrashOutcome {
  const { marker } = required;
  if (marker.ok) return { ok: true, version: marker.version };
  // A race between the read above and `trash.trash` itself (someone else trashed or edited the row,
  // or a blocking child appeared, in between) — same reasons `TrashMarkerResult`'s failure branch
  // already distinguishes; `blocked` carries its `code`/`count` straight through.
  if (marker.reason === "not-found") return { ok: false, reason: "not-found" };
  if (marker.reason === "blocked") return { ok: false, reason: "blocked", code: marker.code, count: marker.count };
  return { ok: false, reason: "version-changed" };
}
