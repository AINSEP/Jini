import { rmdir, rm } from 'node:fs/promises';
import type { AttachmentRecord, AttachmentStore } from './attachment-types.js';
import type { createAttachmentPersistence } from './attachment-sidecars.js';
import type { createBatchDirectoryResolver } from './attachment-registration.js';


export const removeEmptyBatch = async (batchDirectory: string): Promise<void> => {
  try {
    await rmdir(batchDirectory);
  } catch {
    // Non-empty (another unclaimed upload still occupies it) or already gone. Both are fine:
    // this is opportunistic tidying, never the thing that makes a delete correct.
  }
};

export function createAttachmentRecordDeleter(records: Map<string, AttachmentRecord>, forgetRecord: ReturnType<typeof createAttachmentPersistence>["forgetRecord"]) {
  const deleteRecord = async (record: AttachmentRecord): Promise<void> => {
    records.delete(record.id);
    await forgetRecord(record);
    await rm(record.filePath, { force: true });
    await removeEmptyBatch(record.batchDirectory);
  };

  return deleteRecord;
}

export function createAttachmentDeleteUnclaimedMethod({ resolveBatchDirectory, records, deleteRecord }: { resolveBatchDirectory: ReturnType<typeof createBatchDirectoryResolver>; records: Map<string, AttachmentRecord>; deleteRecord: ReturnType<typeof createAttachmentRecordDeleter> }): AttachmentStore["deleteUnclaimed"] {
  return {
    async deleteUnclaimed({ batchId, paths }: { readonly batchId: string; readonly paths: readonly string[] }, _optional: Record<string, never> = {}) {
      const batchDirectory = resolveBatchDirectory(batchId);
      for (const attachmentId of new Set(paths)) {
        const record = records.get(attachmentId);
        if (record && record.batchId === batchId && record.claimedRunId === undefined) {
          await deleteRecord(record);
        }
      }
      await removeEmptyBatch(batchDirectory);
    },
  }.deleteUnclaimed;
}

export function createAttachmentCleanupRunMethod({ records, deleteRecord }: { records: Map<string, AttachmentRecord>; deleteRecord: ReturnType<typeof createAttachmentRecordDeleter> }): AttachmentStore["cleanupRun"] {
  return {
    async cleanupRun({ runId }: { readonly runId: string }, _optional: Record<string, never> = {}) {
      for (const record of [...records.values()]) {
        if (record.claimedRunId === runId) await deleteRecord(record);
      }
    },
  }.cleanupRun;
}

export function createAttachmentPruneExpiredMethod({ records, deleteRecord, retentionMs }: { records: Map<string, AttachmentRecord>; deleteRecord: ReturnType<typeof createAttachmentRecordDeleter>; retentionMs: number }): AttachmentStore["pruneExpired"] {
  return {
    async pruneExpired(_required: Record<string, never>, { now = Date.now() }: { readonly now?: number | undefined } = {}) {
      for (const record of [...records.values()]) {
        if (record.claimedRunId === undefined && now - record.createdAt >= retentionMs) {
          await deleteRecord(record);
        }
      }
    },
  }.pruneExpired;
}

export function createAttachmentDisposeMethod({ records, deleteRecord }: { records: Map<string, AttachmentRecord>; deleteRecord: ReturnType<typeof createAttachmentRecordDeleter> }): AttachmentStore["dispose"] {
  return {
    async dispose() {
      for (const record of [...records.values()]) await deleteRecord(record);
    },
  }.dispose;
}
