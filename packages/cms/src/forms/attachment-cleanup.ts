import type { EventBusPort } from '../core/index.js';
import type { FormOutboxPort } from './ports.js';
import { FormDeliveryError } from './delivery/errors.js';

export const FORM_ATTACHMENT_CLEANUP_EVENT = 'form.attachment.cleanup';
type Payload = { workspaceId: string; sha256: string; storageKeys?: readonly string[] };
type KeyLock = (required: { workspaceId: string; storageKey: string; criticalSection: () => Promise<void> }) => Promise<void>;
type KeyOwnership = (required: { workspaceId: string; sha256: string; storageKey: string }) => Promise<boolean>;
/** Use the host-provided media grace and existing outbox as the durable GC work queue; jobs retain the hash, workspace and exact rendition keys, never file bytes.
 * @returns Once cleanup is queued; callers bind this inside the submission purge transaction.
 * @complexity One small job write per purged file, no bytes read or deleted before commit. */
export async function scheduleFormAttachmentCleanup(
  { outbox, workspaceId, mediaId, sha256, now, graceMs, storageKeys }: { outbox: FormOutboxPort; workspaceId: string; mediaId: string; sha256: string; now: number; graceMs: number; storageKeys?: readonly string[] },
  _optional = {},
): Promise<void> {
  await outbox.enqueue({ id: `forms:file:cleanup:${workspaceId}:${mediaId}`, name: FORM_ATTACHMENT_CLEANUP_EVENT, workspaceId,
    aggregateId: mediaId, occurredAt: new Date(now + graceMs).toISOString(), payload: { workspaceId, sha256, ...(storageKeys === undefined ? {} : { storageKeys: [...new Set(storageKeys)] }) } });
}

/** After grace, recheck ownership under the host's shared hash lock, then remove bytes and metadata. The
 * outbox is the durable deletion journal: a crash or storage failure leaves its job retryable.
 * Shared/live blobs stay until their last owner schedules its own purge. No provider code here.
 * @returns Subscriber teardown. Storage failures throw a redacted retryable error.
 * @complexity One blob lookup per legacy job; captured keys add one lookup and one ownership probe/lock per key. No periodic poll. */
export function registerFormAttachmentCleanup(
  { bus, findBlob, hasOwners, hasStorageKeyOwners, deleteBytes, removeBlob, withHashLock, withStorageKeyLock }: {
    bus: EventBusPort;
    withHashLock: (required: { key: string; criticalSection: () => Promise<void> }) => Promise<void>;
    findBlob: (required: Payload) => Promise<{ storageKey: string; status: string } | null>;
    hasOwners: (required: Payload) => Promise<boolean>;
    /** Required for captured keys; unavailable proof leaves the durable job retryable. */
    hasStorageKeyOwners?: KeyOwnership;
    withStorageKeyLock?: KeyLock;
    deleteBytes: (required: { storageKey: string }) => Promise<void>;
    removeBlob: (required: Payload) => Promise<void>;
  },
  _optional = {},
): Promise<() => Promise<void>> {
  return bus.subscribe<Payload>({ eventName: FORM_ATTACHMENT_CLEANUP_EVENT, handler: async ({ payload }) => {
    try {
      // Renditions can have another hash than their source. Never nest output/source locks:
      // two opposite source/output pairs could otherwise wait on each other forever.
      if (payload.storageKeys?.length) {
        const original = await findBlob(payload);
        await deleteCapturedKeys({ payload, originalKey: original?.storageKey, hasStorageKeyOwners, withStorageKeyLock, deleteBytes });
      }
      await withHashLock({ key: payload.sha256, criticalSection: async () => {
        const blob = await findBlob(payload);
        if (!blob || blob.status !== 'tombstoned' || await hasOwners(payload)) return;
        if (hasStorageKeyOwners && await hasStorageKeyOwners({ ...payload, storageKey: blob.storageKey })) return;
        await deleteBytes({ storageKey: blob.storageKey });
        await removeBlob(payload);
      } });
    } catch { throw new FormDeliveryError({ code: 'delivery-failed', retryable: true }); }
  } });
}

/** Captured rendition keys outlive the original row. Recheck each exact key before idempotent
 * storage removal; a partial failure leaves this same outbox job available for retry.
 * @complexity O(keys) ownership probes/deletes, bounded by this asset's saved rendition rows. */
async function deleteCapturedKeys({ payload, originalKey, hasStorageKeyOwners, withStorageKeyLock, deleteBytes }: {
  payload: Payload; originalKey: string | undefined; hasStorageKeyOwners: KeyOwnership | undefined; withStorageKeyLock: KeyLock | undefined;
  deleteBytes: (required: { storageKey: string }) => Promise<void>;
}): Promise<void> {
  for (const storageKey of new Set(payload.storageKeys ?? [])) {
    if (storageKey === originalKey) continue;
    if (!hasStorageKeyOwners || !withStorageKeyLock) throw new FormDeliveryError({ code: 'delivery-failed', retryable: true });
    await withStorageKeyLock({ workspaceId: payload.workspaceId, storageKey, criticalSection: async () => {
      if (await hasStorageKeyOwners({ ...payload, storageKey })) return;
      await deleteBytes({ storageKey });
    } });
  }
}
