/** Record-store adapter: pure marker transforms; optional physical delete is verified by a read. */
import type { TrashAdapter, TrashMarkerResult, TrashPurgeOutcome } from "../ports.js";

export interface TrashRecordStore<T extends { version: number }> {
  findById(required: { workspaceId: string; id: string }): Promise<T | null>;
  save(required: { record: T }): Promise<void>;
}

export interface RecordStoreTrashAdapterDeps<T extends { version: number }> {
  entityType: string;
  store: TrashRecordStore<T>;

  hidden(required: { record: T; at: string }): T;

  shown(required: { record: T; at: string }): T;

  isHidden(required: { record: T }): boolean;

}

export function createRecordStoreTrashAdapter<T extends { version: number }>(
  deps: RecordStoreTrashAdapterDeps<T>,
  optional: { hardDelete?: (required: { workspaceId: string; id: string }) => Promise<void> } = {}
): TrashAdapter {
  async function flip(
    required: { workspaceId: string; entityId: string; at: string; expectedVersion: number | null },
    direction: "hide" | "unhide"
  ): Promise<TrashMarkerResult> {
    const existing = await deps.store.findById({ workspaceId: required.workspaceId, id: required.entityId });
    if (!existing) return { ok: false, reason: "not-found" };
    if (required.expectedVersion !== null && existing.version !== required.expectedVersion) {
      return { ok: false, reason: "version-changed" };
    }
    const alreadyThere = direction === "hide" ? deps.isHidden({ record: existing }) : !deps.isHidden({ record: existing });
    if (alreadyThere) return { ok: true, version: existing.version, noop: true };

    const moved = direction === "hide" ? deps.hidden({ record: existing, at: required.at }) : deps.shown({ record: existing, at: required.at });
    const next = { ...moved, version: existing.version + 1 };
    await deps.store.save({ record: next });
    return { ok: true, version: next.version };
  }

  return {
    entityType: deps.entityType,
    hide: (required) => flip(required, "hide"),
    unhide: (required) => flip(required, "unhide"),

    async purge(required): Promise<TrashPurgeOutcome> {
      const existing = await deps.store.findById({ workspaceId: required.workspaceId, id: required.entityId });
      if (!existing) return "already-gone";
      if (required.expectedVersion !== null && existing.version !== required.expectedVersion) return "version-changed";

      await optional.hardDelete?.({ workspaceId: required.workspaceId, id: required.entityId });
      const after = await deps.store.findById({ workspaceId: required.workspaceId, id: required.entityId });
      return after === null ? "purged" : "version-changed";
    },
  };
}
