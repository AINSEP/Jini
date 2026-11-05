import type { EventBusPort } from '../core/index.js';
import type { FormOutboxPort } from './ports.js';
import { FormDeliveryError } from './delivery/errors.js';

export const FORM_ATTACHMENT_CLEANUP_EVENT = 'form.attachment.cleanup';
type Payload = { workspaceId: string; sha256: string };
/** Use the host-provided media grace and existing outbox as the durable GC work queue; jobs contain only a hash and workspace.
 * @returns Once cleanup is queued; callers bind this inside the submission purge transaction.
 * @complexity One small job write per purged file, no bytes read or deleted before commit. */
export async function scheduleFormAttachmentCleanup(
  { outbox, workspaceId, mediaId, sha256, now, graceMs }: { outbox: FormOutboxPort; workspaceId: string; mediaId: string; sha256: string; now: number; graceMs: number },
  _optional = {},
): Promise<void> {
  await outbox.enqueue({ id: `forms:file:cleanup:${workspaceId}:${mediaId}`, name: FORM_ATTACHMENT_CLEANUP_EVENT, workspaceId,
    aggregateId: mediaId, occurredAt: new Date(now + graceMs).toISOString(), payload: { workspaceId, sha256 } });
}

/** After grace, recheck ownership under the host's shared hash lock, then remove bytes and metadata. The
 * outbox is the durable deletion journal: a crash or storage failure leaves its job retryable.
 * Shared/live blobs stay until their last owner schedules its own purge. No provider code here.
 * @returns Subscriber teardown. Storage failures throw a redacted retryable error.
 * @complexity One blob lookup and one host ownership probe per job; no periodic collection poll. */
export function registerFormAttachmentCleanup(
  { bus, findBlob, hasOwners, deleteBytes, removeBlob, withHashLock }: {
    bus: EventBusPort;
    withHashLock: (required: { key: string; criticalSection: () => Promise<void> }) => Promise<void>;
    findBlob: (required: Payload) => Promise<{ storageKey: string; status: string } | null>;
    hasOwners: (required: Payload) => Promise<boolean>;
    deleteBytes: (required: { storageKey: string }) => Promise<void>;
    removeBlob: (required: Payload) => Promise<void>;
  },
  _optional = {},
): Promise<() => Promise<void>> {
  return bus.subscribe<Payload>({ eventName: FORM_ATTACHMENT_CLEANUP_EVENT, handler: async ({ payload }) => {
    try {
      await withHashLock({ key: payload.sha256, criticalSection: async () => {
        const blob = await findBlob(payload);
        if (!blob || blob.status !== 'tombstoned' || await hasOwners(payload)) return;
        await deleteBytes({ storageKey: blob.storageKey });
        await removeBlob(payload);
      } });
    } catch { throw new FormDeliveryError({ code: 'delivery-failed', retryable: true }); }
  } });
}
