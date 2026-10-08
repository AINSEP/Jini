import { TrashAwareInMemoryEntryRepo } from "./trash-aware-entry.fixture.js";
import type { RemoveWidgetFn } from "../../ports.js";

/**
 * @file Test support: the widget Trash over an in-memory entries store, the way the hermetic
 * composition (`app.ts`) wires it — `remove` sets the entry's `deletedAt` and bumps its version, so
 * every entries read afterwards treats the widget as missing. `restore` is the Trash screen's
 * restore. Widget tests use this instead of a stub so they see the same "trashed = gone" reads the
 * real composition gives.
 */
export interface MemoryWidgetTrash {
  entryRepo: TrashAwareInMemoryEntryRepo;
  remove: RemoveWidgetFn;
  restore(required: { workspaceId: string; id: string }): Promise<void>;
  /** Every `remove` call, in order. */
  calls: Array<Parameters<RemoveWidgetFn>[0]>;
}

export function memoryWidgetTrash(entryRepo: TrashAwareInMemoryEntryRepo = new TrashAwareInMemoryEntryRepo()): MemoryWidgetTrash {
  const calls: MemoryWidgetTrash["calls"] = [];
  const remove: RemoveWidgetFn = async (required) => {
    calls.push(required);
    const record = await entryRepo.findAnyById({ workspaceId: required.workspaceId, id: required.id });
    if (!record || record.deletedAt !== null) return { ok: false, reason: "not-found" };
    if (required.expectedVersion !== null && record.version !== required.expectedVersion) {
      return { ok: false, reason: "version-changed" };
    }
    await entryRepo.saveAny({ ...record, deletedAt: required.at, version: record.version + 1 });
    return { ok: true, version: record.version + 1 };
  };
  const restore: MemoryWidgetTrash["restore"] = async (required) => {
    const record = await entryRepo.findAnyById(required);
    if (!record) throw new Error(`no entry '${required.id}' to restore`);
    await entryRepo.saveAny({ ...record, deletedAt: null, version: record.version + 1 });
  };
  return { entryRepo, remove, restore, calls };
}
