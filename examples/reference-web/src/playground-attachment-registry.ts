import {
  chmod,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  rmdir,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';

import type { PlaygroundAttachment } from './playground-request.js';

const BATCH_ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/u;

interface AttachmentRecord {
  id: string;
  filePath: string;
  name: string;
  kind: PlaygroundAttachment['kind'];
  size: number;
  batchId: string;
  batchDirectory: string;
  dev: number;
  ino: number;
  createdAt: number;
  claimedRunId?: string;
}

export interface PlaygroundAttachmentClaim {
  attachments: PlaygroundAttachment[];
  batchDirectory?: string;
}

export interface PlaygroundAttachmentRegistry {
  createBatchDirectory: (batchId: string) => Promise<string>;
  register: (input: {
    batchId: string;
    path: string;
    name: string;
    kind: PlaygroundAttachment['kind'];
    size: number;
  }) => Promise<PlaygroundAttachment>;
  claim: (
    attachments: readonly PlaygroundAttachment[],
    runId: string,
  ) => Promise<PlaygroundAttachmentClaim>;
  deleteUnclaimed: (batchId: string, paths: readonly string[]) => Promise<void>;
  cleanupRun: (runId: string) => Promise<void>;
  pruneExpired: (now?: number) => Promise<void>;
  dispose: () => Promise<void>;
}

function isContainedPath(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !fromRoot.startsWith(sep);
}

/**
 * Owns the daemon-created upload capability registry. A run may claim each
 * canonical regular file once; renderer-provided names, kinds, and sizes are
 * replaced with the registry's trusted metadata.
 */
export async function createPlaygroundAttachmentRegistry({
  uploadDirectory,
  maxAttachments = 10,
  maxBatchBytes = 50 * 1024 * 1024,
  maxStoredAttachments = 100,
  maxStoredBytes = 200 * 1024 * 1024,
  retentionMs = 60 * 60 * 1_000,
}: {
  uploadDirectory: string;
  maxAttachments?: number;
  maxBatchBytes?: number;
  maxStoredAttachments?: number;
  maxStoredBytes?: number;
  retentionMs?: number;
}): Promise<PlaygroundAttachmentRegistry> {
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  await chmod(uploadDirectory, 0o700);
  const canonicalUploadDirectory = await realpath(uploadDirectory);
  // Registry capabilities are daemon-lifetime only. Files left by an
  // interrupted prior daemon cannot be authenticated, so remove them.
  for (const entry of await readdir(canonicalUploadDirectory)) {
    await rm(resolve(canonicalUploadDirectory, entry), { recursive: true, force: true });
  }

  const records = new Map<string, AttachmentRecord>();

  const resolveBatchDirectory = (batchId: string): string => {
    if (!BATCH_ID_PATTERN.test(batchId)) throw new Error('Invalid attachment batch');
    const directory = resolve(canonicalUploadDirectory, batchId);
    if (!isContainedPath(canonicalUploadDirectory, directory)) {
      throw new Error('Invalid attachment batch');
    }
    return directory;
  };

  const removeEmptyBatch = async (batchDirectory: string): Promise<void> => {
    try {
      await rmdir(batchDirectory);
    } catch {
      // Another unclaimed file still occupies the batch.
    }
  };

  const deleteRecord = async (record: AttachmentRecord): Promise<void> => {
    records.delete(record.id);
    await rm(record.filePath, { force: true });
    await removeEmptyBatch(record.batchDirectory);
  };

  return {
    async createBatchDirectory(batchId) {
      const directory = resolveBatchDirectory(batchId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      return directory;
    },

    async register(input) {
      const batchDirectory = resolveBatchDirectory(input.batchId);
      const filePath = resolve(input.path);
      if (dirname(filePath) !== batchDirectory || !isContainedPath(batchDirectory, filePath)) {
        throw new Error('Attachment path is outside its batch');
      }
      try {
        const info = await lstat(filePath);
        if (!info.isFile() || info.isSymbolicLink()) {
          throw new Error('Attachment is not a regular file');
        }
        const canonical = await realpath(filePath);
        if (canonical !== filePath) throw new Error('Attachment path is not canonical');

        // Recheck immediately before insertion. There are no awaits between
        // this quota decision and records.set(), so concurrent requests cannot
        // both reserve the same final slot or bytes.
        const batchRecords = [...records.values()]
          .filter((record) => record.batchId === input.batchId);
        if (batchRecords.length >= maxAttachments) {
          throw new Error(`Attachment batches are limited to ${maxAttachments} files`);
        }
        if (
          batchRecords.reduce((total, record) => total + record.size, 0) + info.size
          > maxBatchBytes
        ) {
          throw new Error('Attachment batch is too large');
        }
        if (records.size >= maxStoredAttachments) {
          throw new Error('Playground attachment storage is full');
        }
        if (
          [...records.values()].reduce((total, record) => total + record.size, 0) + info.size
          > maxStoredBytes
        ) {
          throw new Error('Playground attachment storage is full');
        }
        const id = `attachment:${randomUUID()}`;
        const record: AttachmentRecord = {
          id,
          filePath,
          name: input.name,
          kind: input.kind,
          size: info.size,
          batchId: input.batchId,
          batchDirectory,
          dev: info.dev,
          ino: info.ino,
          createdAt: Date.now(),
        };
        records.set(id, record);
        return {
          path: id,
          name: record.name,
          kind: record.kind,
          size: record.size,
        };
      } catch (error) {
        await rm(filePath, { force: true });
        await removeEmptyBatch(batchDirectory);
        throw error;
      }
    },

    async claim(attachments, runId) {
      if (attachments.length === 0) return { attachments: [] };
      if (attachments.length > maxAttachments) throw new Error('Too many attachments');
      const requestedPaths = new Set(attachments.map((attachment) => attachment.path));
      if (requestedPaths.size !== attachments.length) throw new Error('Duplicate attachment');
      const claimed: AttachmentRecord[] = [];
      for (const requested of attachments) {
        const record = records.get(requested.path);
        if (!record || record.claimedRunId !== undefined) {
          throw new Error('Attachment is unknown or already claimed');
        }
        const info = await lstat(record.filePath);
        const canonical = await realpath(record.filePath);
        if (
          !info.isFile()
          || info.isSymbolicLink()
          || canonical !== record.filePath
          || info.dev !== record.dev
          || info.ino !== record.ino
          || info.size !== record.size
        ) {
          throw new Error('Attachment changed after upload');
        }
        if (claimed[0] && claimed[0].batchId !== record.batchId) {
          throw new Error('Attachments must belong to one batch');
        }
        claimed.push(record);
      }
      for (const record of claimed) record.claimedRunId = runId;
      return {
        attachments: claimed.map((record) => ({
          path: record.filePath,
          name: record.name,
          kind: record.kind,
          size: record.size,
        })),
        ...(claimed[0] === undefined
          ? {}
          : { batchDirectory: claimed[0].batchDirectory }),
      };
    },

    async deleteUnclaimed(batchId, paths) {
      const batchDirectory = resolveBatchDirectory(batchId);
      for (const attachmentId of new Set(paths)) {
        const record = records.get(attachmentId);
        if (
          record
          && record.batchId === batchId
          && record.claimedRunId === undefined
        ) {
          await deleteRecord(record);
        }
      }
      await removeEmptyBatch(batchDirectory);
    },

    async cleanupRun(runId) {
      for (const record of [...records.values()]) {
        if (record.claimedRunId === runId) await deleteRecord(record);
      }
    },

    async pruneExpired(now = Date.now()) {
      for (const record of [...records.values()]) {
        if (
          record.claimedRunId === undefined
          && now - record.createdAt >= retentionMs
        ) {
          await deleteRecord(record);
        }
      }
    },

    async dispose() {
      for (const record of [...records.values()]) await deleteRecord(record);
    },
  };
}

/** Infers image capability from bytes rather than renderer-controlled MIME. */
export function detectPlaygroundAttachmentKind(
  body: Uint8Array,
): PlaygroundAttachment['kind'] {
  const isPng =
    body.length >= 8
    && body[0] === 0x89
    && body[1] === 0x50
    && body[2] === 0x4e
    && body[3] === 0x47;
  const isJpeg = body.length >= 3
    && body[0] === 0xff
    && body[1] === 0xd8
    && body[2] === 0xff;
  const signature = new TextDecoder().decode(body.slice(0, 6));
  const isGif = signature === 'GIF87a' || signature === 'GIF89a';
  const isWebp = body.length >= 12
    && new TextDecoder().decode(body.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(body.slice(8, 12)) === 'WEBP';
  return isPng || isJpeg || isGif || isWebp ? 'image' : 'file';
}
