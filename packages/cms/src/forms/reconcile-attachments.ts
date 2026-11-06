import { FORM_ATTACHMENT_CLEANUP_EVENT } from "./attachment-cleanup.js";

/** Exact identity supplied by trusted storage records, never inferred from a filename. */
export interface FormAttachmentCandidate { mediaId: string; sha256: string }
export type FormAttachmentInspection = 'proven-orphan' | 'missing-evidence' | 'owned' | 'unknown';
export interface FormAttachmentReconciliationPorts {
  workspaceId: string;
  readPage: (required: { workspaceId: string; after?: string; limit: number }) => Promise<FormAttachmentCandidate[]>;
  /** Match completed upload/terminal removal evidence and all live/restorable owners; errors deny. */
  inspect: (required: { workspaceId: string; candidate: FormAttachmentCandidate }) => Promise<FormAttachmentInspection>;
  /** Commit private ownership before cleanup; exact identity must still match. */
  protect: (required: { workspaceId: string; candidate: FormAttachmentCandidate }) => Promise<void>;
  /** Recheck evidence/owners transactionally and use the existing Trash/grace/outbox lifecycle. */
  cleanup: (required: { workspaceId: string; candidate: FormAttachmentCandidate }) => Promise<void>;
}
export interface FormAttachmentReconciliationResult {
  mediaId: string;
  outcome: 'kept' | 'eligible' | 'queued';
  reason: FormAttachmentInspection | 'inspection-failed' | 'protection-failed' | 'cleanup-failed';
}
/** Explicit maintenance only: inspect one keyset page, preserving uncertain files with a reason.
 * @param required Trusted identity/ownership reads and the existing private/cleanup adapters.
 * @param optional Preview by default; apply requires an explicit request. Resume with nextAfter.
 * @returns Per-candidate decisions and a cursor when another page may remain.
 * @throws If the host violates the 100-row increasing-key contract, before any mutation.
 * @complexity At most 100 sequential inspections/effects per invocation; no scheduler or polling.
 */
export async function reconcileFormAttachments(
  required: FormAttachmentReconciliationPorts,
  { after, apply = false }: { after?: string; apply?: boolean } = {},
): Promise<{ results: FormAttachmentReconciliationResult[]; nextAfter?: string }> {
  const rows = await required.readPage({ workspaceId: required.workspaceId, ...(after === undefined ? {} : { after }), limit: 100 });
  assertCandidatePage({ rows, after });
  const results: FormAttachmentReconciliationResult[] = [];
  for (const candidate of rows) results.push(await reconcileOne({ required, candidate, apply }));
  return { results, ...(rows.length === 100 ? { nextAfter: rows.at(-1)!.mediaId } : {}) };
}

/** Invalid keyset pages cannot cause duplicate deletion or a cursor that repeats indefinitely. */
function assertCandidatePage({ rows, after }: { rows: FormAttachmentCandidate[]; after: string | undefined }): void {
  if (rows.length > 100) throw new Error('Form attachment maintenance exceeded its 100-candidate batch; no files changed.');
  let previous = after;
  for (const row of rows) {
    if (!row.mediaId || !row.sha256 || (previous !== undefined && row.mediaId <= previous)) {
      throw new Error('Form attachment maintenance returned invalid or repeated identities; no files changed.');
    }
    previous = row.mediaId;
  }
}

/** Privacy commits separately: a failed cleanup leaves the proven file private for a later retry. */
async function reconcileOne({ required, candidate, apply }: { required: FormAttachmentReconciliationPorts; candidate: FormAttachmentCandidate; apply: boolean }): Promise<FormAttachmentReconciliationResult> {
  const input = { workspaceId: required.workspaceId, candidate };
  let reason: FormAttachmentInspection;
  try { reason = await required.inspect(input); }
  catch { return { mediaId: candidate.mediaId, outcome: 'kept', reason: 'inspection-failed' }; }
  if (reason !== 'proven-orphan') return { mediaId: candidate.mediaId, outcome: 'kept', reason };
  if (!apply) return { mediaId: candidate.mediaId, outcome: 'eligible', reason };
  try { await required.protect(input); }
  catch { return { mediaId: candidate.mediaId, outcome: 'kept', reason: 'protection-failed' }; }
  try { await required.cleanup(input); }
  catch { return { mediaId: candidate.mediaId, outcome: 'kept', reason: 'cleanup-failed' }; }
  return { mediaId: candidate.mediaId, outcome: 'queued', reason };
}

/** A canonical server-produced cleanup job is terminal removal evidence, not a filename guess.
 * @returns True only for the exact workspace/media/hash identity in the trusted outbox record.
 * @complexity O(1), fixed field checks; the host supplies the record from its own outbox.
 */
export function matchesFormAttachmentCleanupEvidence(
  { workspaceId, candidate, event }: { workspaceId: string; candidate: FormAttachmentCandidate; event: unknown },
  _optional = {},
): boolean {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const record = event as Record<string, unknown>;
  if (record.id !== `forms:file:cleanup:${workspaceId}:${candidate.mediaId}` || record.name !== FORM_ATTACHMENT_CLEANUP_EVENT) return false;
  if (record.workspaceId !== workspaceId || record.aggregateId !== candidate.mediaId) return false;
  return matchesCleanupPayload({ workspaceId, sha256: candidate.sha256, payload: record.payload });
}

function matchesCleanupPayload({ workspaceId, sha256, payload }: { workspaceId: string; sha256: string; payload: unknown }): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return record.workspaceId === workspaceId && record.sha256 === sha256;
}

/** Conservatively retain a candidate mentioned anywhere in decoded historical/configuration JSON.
 * False positives keep files; corrupt JSON throws so the caller reports unknown ownership.
 * @param required Stored JSON and canonical/retired identity keys from trusted records.
 * @returns Whether any nested string contains an identity, including references inside HTML URLs.
 * @throws SyntaxError on unreadable history; it must never become evidence of absence.
 * @complexity O(JSON bytes × keys); callers page retained rows and cap candidate batches at 100.
 */
export function retainedJsonReferencesAttachment(
  { json, keys }: { json: string; keys: readonly string[] },
  _optional = {},
): boolean {
  const pending: unknown[] = [JSON.parse(json)];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string' && keys.some(key => value.includes(key))) return true;
    if (value && typeof value === 'object') pending.push(...Object.values(value));
  }
  return false;
}
