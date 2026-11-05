import type { TrashFollowUpHooks } from '../trash/follow-ups.js';
import { decodeSubmissionJson } from './submission-json.js';

/** Safe classification for forged legacy references, distinct from a storage failure to retry. */
export class FormAttachmentOwnerMismatchError extends Error {
  constructor() { super('FORMS_ATTACHMENT_OWNER_MISMATCH'); this.name = 'FormAttachmentOwnerMismatchError'; }
}
type ProtectionWarning = { submissionId: string; code: 'invalid-submission' | 'attachment-owner-mismatch' | 'attachment-protection-failed' };

type Attachment = { workspaceId: string; submissionId: string; mediaId: string };
/** Hosts may prepare one transaction snapshot per purge without sharing mutable state across purges. */
export type FormAttachmentRemoval =
  | { remove: (required: Attachment) => Promise<void>; prepareRemoval?: never }
  | { remove?: never; prepareRemoval: () => Promise<(required: Attachment) => Promise<void>> };
/** Keyset-paged pre-delete capture plus transactional cleanup, shared by submission and parent-form
 * purges. Hooks perform no external blob deletion: the media owner tombstones for journaled GC.
 * @param required Host scoped reads (including Trash) and transactional media removal.
 * @returns Hooks to compose with the existing Trash adapter and delivery-snapshot scrubbing.
 * @throws Storage/decoding errors propagate before the purge commits.
 * @complexity O(submissions * fields); 100 JSON rows per read and one retained reference per distinct file. */
export function createFormAttachmentPurgeHooks(
  { readSubmissions, remove, prepareRemoval }: {
    readSubmissions: (required: { workspaceId: string; entityId: string; after?: string; limit: number }) => Promise<{ id: string; dataJson: string }[]>;
  } & FormAttachmentRemoval,
  _optional = {},
): TrashFollowUpHooks {
  return {
    beforePurge: async ({ workspaceId, entityId }) => {
      const found = new Map<string, Attachment>();
      let after: string | undefined;
      for (;;) {
        const rows = await readSubmissions({ workspaceId, entityId, ...(after === undefined ? {} : { after }), limit: 100 });
        if (rows.length === 0) return [...found.values()];
        for (const reference of attachments({ rows, workspaceId })) found.set(reference.mediaId, reference);
        after = rows.at(-1)!.id;
      }
    },
    afterPurge: async ({ priorState }) => {
      const references = priorState as Attachment[];
      if (references.length === 0) return;
      const removeOne = prepareRemoval ? await prepareRemoval() : remove!;
      for (const attachment of references) await removeOne(attachment);
    },
  };
}

/** Repeated answer references remove an asset only once. O(total fields), no side effects. */
function attachments({ rows, workspaceId }: { rows: { id: string; dataJson: string }[]; workspaceId: string }): Attachment[] {
  const found = new Map<string, Attachment>();
  for (const row of rows) {
    for (const value of Object.values(decodeSubmissionJson({ json: row.dataJson }).data)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      if (typeof value.mediaId === 'string') found.set(value.mediaId, { workspaceId, submissionId: row.id, mediaId: value.mediaId });
    }
  }
  return [...found.values()];
}

/** Protect pre-fix attachment references at boot, including Trash, before public routes open.
 * @param required Keyset-paged host reads and an idempotent private-asset stamp.
 * @returns Successful reference count; corrupt rows and failed stamps warn and never refuse boot.
 * @complexity O(submissions * fields); 100 JSON rows in memory, no polling or hot-path reads. */
export async function protectFormAttachments(
  { workspaceId, readPage, protect, warn }: {
    workspaceId: string;
    readPage: (required: { after?: string; limit: number }) => Promise<{ id: string; dataJson: string }[]>;
    protect: (required: Attachment) => Promise<void>;
    warn?: (required: ProtectionWarning) => void;
  },
  _optional = {},
): Promise<number> {
  let after: string | undefined;
  let count = 0;
  for (;;) {
    const rows = await readPage({ ...(after === undefined ? {} : { after }), limit: 100 });
    if (rows.length === 0) return count;
    for (const row of rows) {
      count += await protectSubmissionAttachments({ workspaceId, row, protect, warn });
    }
    after = rows.at(-1)!.id;
  }
}

/** One corrupt row or unsafe reference cannot prevent later submissions from being protected.
 * Warnings contain identifiers and fixed codes only; submitted values and exception text stay private.
 * @complexity O(fields) for this submission, one stamp per distinct media reference. */
async function protectSubmissionAttachments({ workspaceId, row, protect, warn }: {
  workspaceId: string; row: { id: string; dataJson: string };
  protect: (required: Attachment) => Promise<void>;
  warn: ((required: ProtectionWarning) => void) | undefined;
}): Promise<number> {
  let references: Attachment[];
  try { references = attachments({ rows: [row], workspaceId }); }
  catch { warn?.({ submissionId: row.id, code: 'invalid-submission' }); return 0; }
  let count = 0;
  for (const reference of references) {
    try { await protect(reference); count++; }
    catch (error) { warn?.({ submissionId: row.id, code: error instanceof FormAttachmentOwnerMismatchError ? 'attachment-owner-mismatch' : 'attachment-protection-failed' }); }
  }
  return count;
}
