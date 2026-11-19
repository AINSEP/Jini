import type { AttachmentRecord, AttachmentStore, StoredAttachment } from './attachment-types.js';
import { reserveAttachmentRecords, verifyClaimedAttachments } from './attachment-integrity.js';
import { stagedPathsByAttachment } from './attachment-staging.js';
import { AttachmentRejectedError } from './attachment-rejections.js';


/** An attachment no run has claimed, or one claimed by `runId` (never by an absent run id). */
function isUnclaimedOrClaimedBy(claimedRunId: string | undefined, runId: string | undefined): boolean {
  return claimedRunId === undefined || (runId !== undefined && claimedRunId === runId);
}

export function createAttachmentClaimMethod({ records, maxAttachments, stagedPathsByRecord }: { records: Map<string, AttachmentRecord>; maxAttachments: number; stagedPathsByRecord: WeakMap<AttachmentRecord, Set<string>> }): AttachmentStore["claim"] {
  return {
    async claim({ attachments, runId }: { readonly attachments: readonly StoredAttachment[]; readonly runId: string }, _optional: Record<string, never> = {}) {
      if (attachments.length === 0) return { attachments: [] };
      // Phase 1 (`reserveAttachmentRecords`) reserves synchronously; Phase 2
      // (`verifyClaimedAttachments`) re-validates what is now held exclusively. Any Phase 2 failure
      // releases the whole reservation here, so a rejected claim still leaves nothing half-claimed
      // and the caller can retry with a corrected set. Only reservations made by *this* call are
      // released, so a concurrent winner's claim is never revoked by a loser's rollback.
      const claimed = reserveAttachmentRecords({ attachments, records, runId, maxAttachments });
      try {
        const batchDirectory = await verifyClaimedAttachments({ claimed });
        return {
          attachments: claimed.map((record) => {
            const attachment = { path: record.filePath, name: record.name, kind: record.kind, size: record.size };
            const aliases = new Set<string>();
            stagedPathsByAttachment.set(attachment, aliases);
            stagedPathsByRecord.set(record, aliases);
            return attachment;
          }),
          batchDirectory,
        };
      } catch (error) {
        for (const record of claimed) delete record.claimedRunId;
        throw error;
      }
    },
  }.claim;
}

export function createAttachmentResolveForRunMethod({ findRecord }: { findRecord: ({ ref }: { readonly ref: string }) => AttachmentRecord | undefined }): AttachmentStore["resolveForRun"] {
  return {
    async resolveForRun({ ref, runId }: { readonly ref: string; readonly runId: string }, _optional: Record<string, never> = {}) {
      // Synchronous check-then-reserve, same reasoning as `reserveAttachmentRecords`: nothing may
      // `await` between reading `claimedRunId` and writing it, or a concurrent call could observe
      // the same unclaimed record and both believe they reserved it.
      const record = findRecord({ ref });
      if (!record) return undefined;
      if (record.claimedRunId !== undefined && record.claimedRunId !== runId) {
        throw new AttachmentRejectedError({ reason: 'attachment-unknown-or-claimed', message: 'Attachment is unknown or already claimed' });
      }
      const reservedNow = record.claimedRunId === undefined;
      if (reservedNow) record.claimedRunId = runId;
      try {
        await verifyClaimedAttachments({ claimed: [record] });
      } catch (error) {
        // Mirrors `claim()`'s own rollback: a lookup that fails integrity must not leave a phantom
        // reservation behind for a record that turned out to be unsafe to hand back.
        if (reservedNow) delete record.claimedRunId;
        throw error;
      }
      return { path: record.filePath, name: record.name, kind: record.kind, size: record.size };
    },
  }.resolveForRun;
}

export function createAttachmentListPendingForOwnerMethod({ records }: { records: Map<string, AttachmentRecord> }): AttachmentStore["listPendingForOwner"] {
  return {
    async listPendingForOwner({ ownerId }: { readonly ownerId: string }, { runId }: { readonly runId?: string } = {}) {
      return [...records.values()]
        // `record.ownerId !== undefined` first, short-circuiting before the comparison: this is
        // what makes an ownerless record excluded rather than accidentally matched by a falsy-ish
        // `ownerId` argument — see this method's own doc on why that must never be a wildcard.
        .filter((record) => record.ownerId !== undefined && record.ownerId === ownerId
          && isUnclaimedOrClaimedBy(record.claimedRunId, runId))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((record) => ({ ref: record.id, name: record.name, kind: record.kind, size: record.size, createdAt: record.createdAt }));
    },
  }.listPendingForOwner;
}
