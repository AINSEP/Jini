import { protectFormAttachments, FormAttachmentOwnerMismatchError } from '@jini-ai/cms/forms';
import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import type { Kysely } from 'kysely';

type Site = { kernel: Pick<StorageKernel<Kysely<Record<string, {
  id: string; workspace_id: string; data_json: string; source_metadata_json: string | null;
  source_sha256: string; sha256: string; document_owned: boolean;
}>>>, 'run' | 'transaction'>; workspaceId: string; tables: { submissions: string; media: string; assetBlobs: string } };

/** Verify legacy attachment privacy during owner startup. New uploads already stamp private
 * metadata. The owner composition calls this; clients and idle wakes do not repeat the scan.
 * Missing assets are already purged. Preserve source metadata and warn for mismatched ownership.
 * @complexity Once per site: pages of 100 JSON rows, one indexed read/up to two writes per file;
 * later owner boots check only the fixed attempted-pass marker (warnings do not prove ownership). No visitor request scans submissions. */
export async function protectExistingFormFiles(
  { kernel, workspaceId, tables, readMarker, markComplete, warn, warnIncomplete }: Site & {
    readMarker(): Promise<void>; markComplete(): Promise<void>;
    warn(input: { submissionId: string; code: string }): void; warnIncomplete(error: unknown): void;
  },
  _optional = {},
): Promise<void> {
  try { await readMarker(); return; } catch { /* A first owner boot has no completion marker. */ }
  try {
    let retryProtection = false;
    await protectFormAttachments({
      workspaceId,
      readPage: input => readPage({ kernel, workspaceId, tables, ...input }),
      protect: reference => protectReference({ kernel, tables, ...reference }),
      warn: ({ submissionId, code }) => {
        if (code === 'attachment-protection-failed') retryProtection = true;
        warn({ submissionId, code });
      },
    });
    if (!retryProtection) await markComplete();
  } catch (error) {
    warnIncomplete(error);
  }
}

/** Include Trash so a later restore cannot expose a legacy file. One 100-row keyset page. */
async function readPage({ kernel, workspaceId, tables, after, limit }: Site & { after?: string; limit: number }) {
  return kernel.run(async db => {
    let query = db.selectFrom(tables.submissions).select(['id', 'data_json']).where('workspace_id', '=', workspaceId);
    if (after !== undefined) query = query.where('id', '>', after);
    const rows = await query.orderBy('id').limit(limit).execute();
    return rows.map(row => ({ id: row.id, dataJson: row.data_json }));
  });
}

/** Preserve established privacy and stamp shared-blob ownership; unproven files stay unchanged.
 * @complexity One indexed media read and at most one scoped write per attachment. */
async function protectReference({ kernel, workspaceId, tables, mediaId }: Site & { submissionId: string; mediaId: string }): Promise<void> {
  await kernel.transaction(async () => kernel.run(async db => {
    const row = await db.selectFrom(tables.media).select(['id', 'source_metadata_json', 'source_sha256'])
      .where('workspace_id', '=', workspaceId).where('id', '=', mediaId).executeTakeFirst();
    if (!row) return;
    const metadata = JSON.parse(row.source_metadata_json ?? '{}');
    // A name prefix is visitor-influenced display data, never proof of completed upload ownership.
    if (metadata.private !== true) throw new FormAttachmentOwnerMismatchError();
    await db.updateTable(tables.assetBlobs).set({ document_owned: true }).where('workspace_id', '=', workspaceId).where('sha256', '=', row.source_sha256).where('document_owned', '=', false).execute();
  }));
}
