/**
 * @file Test double for `RedirectsWriteDeps.remove`.
 *
 * The real binding (`features/trash`) flips `redirects.status` with column SQL AND writes the Trash
 * index row in one transaction. A test running against `InMemoryRedirectRepo` has no `content.db`,
 * so it binds `remove` to the same record-store adapter the hermetic composition root uses — same
 * marker, same version bump, same idempotency, just without the index half.
 *
 * Tests that care about the index half use the real service (`features/trash/__tests__/`) against
 * real SQLite. Keeping the two apart stops a second, drifting Trash implementation appearing here.
 */
import { REDIRECT_ENTITY_TYPE, removeEntityWithoutBlocker } from "./support/trash.fixture.js";
import { createRecordStoreTrashAdapter } from "../../trash/index.js";

import type { RedirectsWriteDeps, RemoveRedirectFn } from "../redirects.js";
import type { RedirectRecord } from "../types.js";

interface MinimalRedirectStore {
  findById(required: { workspaceId: string; id: string }): Promise<RedirectRecord | null>;
  insertRedirect(record: RedirectRecord): void | Promise<void>;
}

/**
 * Binds `remove` to the record-store adapter over `repo`.
 *
 * @param repo the same repo the test hands `tombstoneRedirect`.
 * @complexity O(1) per call.
 */
export function removeVia(repo: MinimalRedirectStore): RemoveRedirectFn {
  const adapter = createRecordStoreTrashAdapter<RedirectRecord>({
    entityType: REDIRECT_ENTITY_TYPE,
    store: {
      findById: (required) => repo.findById(required),
      save: async ({ record }) => {
        await repo.insertRedirect(record);
      }
    },
    isHidden: ({ record }) => record.status === "disabled",
    hidden: ({ record, at }) => ({
      ...record,
      status: "disabled",
      updatedAt: at
    }),
    shown: ({ record, at }) => ({
      ...record,
      status: "active",
      updatedAt: at
    })
  });
  // Redirects register no Trash blocker, so the adapter can never answer "blocked"; narrow it away
  // with the same `removeEntityWithoutBlocker` the composition roots use for the real binding.
  return removeEntityWithoutBlocker({
    remove: (required: Parameters<RemoveRedirectFn>[0]) => adapter.hide({
      workspaceId: required.workspaceId,
      entityId: required.id,
      at: required.at,
      expectedVersion: required.expectedVersion,
    }),
  });
}

/**
 * Binds `restore` to the same record-store adapter {@link removeVia} uses — the un-hide half, for a
 * test that needs a real `RedirectsWriteDeps.restore` (S7, web-high fix plan 2026-09-24). Mirrors
 * `removeVia`'s own scope note: same marker flip, no Trash index row.
 *
 * @complexity O(1) per call.
 */
export function restoreVia(repo: MinimalRedirectStore): RedirectsWriteDeps["restore"] {
  const adapter = createRecordStoreTrashAdapter<RedirectRecord>({
    entityType: REDIRECT_ENTITY_TYPE,
    store: {
      findById: (required) => repo.findById(required),
      save: async ({ record }) => {
        await repo.insertRedirect(record);
      }
    },
    isHidden: ({ record }) => record.status === "disabled",
    hidden: ({ record, at }) => ({
      ...record,
      status: "disabled",
      updatedAt: at
    }),
    shown: ({ record, at }) => ({
      ...record,
      status: "active",
      updatedAt: at
    })
  });
  return async (required) => {
    const result = await adapter.unhide({
      workspaceId: required.workspaceId,
      entityId: required.id,
      at: required.at,
      expectedVersion: null,
    });
    if (!result.ok) return result.reason === "not-found" ? "not-found" : "version-changed";
    return "restored";
  };
}

/**
 * A `RedirectsWriteDeps.isInTrash` that never reports a rule as trashed (S7). For write-deps
 * fixtures in this domain's other test files that need a real value to satisfy the type but never
 * tombstone a rule and then update it in the same test — so `updateRedirect`'s Trash branch is never
 * reached either way. A test that DOES exercise the Trash-guard behavior builds a real
 * `createTrashService` + `InMemoryTrashRepo` instead (`redirects.test.ts`'s own S7 block), which is
 * the only thing that actually indexes a Trash row; `status === "disabled"` (what this file's
 * `removeVia`/`restoreVia` flip) is NOT the same signal — see `RedirectsWriteDeps.isInTrash`'s doc.
 */
export const isNeverInTrash: RedirectsWriteDeps["isInTrash"] = async () => false;
