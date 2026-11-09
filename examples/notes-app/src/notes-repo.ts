/**
 * @file GAP: a SQL `EntryRepoPort` + `EntryListPort` written in the app.
 *
 * `@jini-ai/cms/entries` exports `createEntry`/`updateEntry`/`publishEntry`/`listEntries` and the
 * ports they need, but only `InMemoryEntryRepo` implements them. With no SQL entries repo and no
 * table bootstrap to reuse, the app stores each `EntryRecord` as JSON in the table it declared
 * through the data-module seam (db.ts). Revisions are not kept (no revisions table): the entry
 * services call `appendRevision`, and this repo drops it.
 */
import { entryVersionConflictError, type EntryListPort, type EntryRecord, type EntryRepoPort } from '@jini-ai/cms/entries';
import { NOTES_TABLE, type AppKernel } from './db.ts';

function parse({ row }: { row: { record_json: string } | undefined }, _optional: Record<string, never> = {}): EntryRecord | null {
  return row ? (JSON.parse(row.record_json) as EntryRecord) : null;
}

export function createSqlEntryRepo({ kernel }: { kernel: AppKernel }, _optional: Record<string, never> = {}): EntryRepoPort & EntryListPort {
  const findById: EntryRepoPort['findById'] = async ({ workspaceId, id }) => parse({ row: await kernel.run((db) =>
    db.selectFrom(NOTES_TABLE).select('record_json').where('id', '=', id).where('workspace_id', '=', workspaceId).executeTakeFirst()) });

  return {
    findById,
    async findBySlug({ workspaceId, type, slug }) {
      return parse({ row: await kernel.run((db) => db.selectFrom(NOTES_TABLE).select('record_json')
        .where('workspace_id', '=', workspaceId).where('type', '=', type).where('slug', '=', slug).executeTakeFirst()) });
    },
    async save(row, options = {}) {
      if (options.expectedVersion !== undefined) {
        const stored = await kernel.run((db) => db.selectFrom(NOTES_TABLE).select(['record_json', 'workspace_id']).where('id', '=', row.id).executeTakeFirst());
        const found = stored && (options.expectedVersion === null || stored.workspace_id === row.workspaceId) ? (parse({ row: stored })?.version ?? null) : null;
        if (found !== options.expectedVersion) throw entryVersionConflictError({ id: row.id, expectedVersion: options.expectedVersion, found });
      }
      const values = {
        id: row.id, workspace_id: row.workspaceId, type: row.type, slug: row.slug,
        status: row.status, updated_at: row.updatedAt, record_json: JSON.stringify(row),
      };
      await kernel.run((db) => db.insertInto(NOTES_TABLE).values(values)
        .onConflict((oc) => oc.column('id').doUpdateSet({ ...values })).execute());
    },
    async appendRevision() {
      // GAP: no public revisions table; history is dropped.
    },
    transaction({ fn }) {
      return kernel.transaction(fn);
    },
    async listByWorkspace({ workspaceId }, optional = {}) {
      const rows = await kernel.run((db) => {
        let query = db.selectFrom(NOTES_TABLE).select('record_json').where('workspace_id', '=', workspaceId);
        if (optional.type) query = query.where('type', '=', optional.type);
        if (optional.status) query = query.where('status', '=', optional.status);
        query = query.orderBy('updated_at', optional.orderDirection ?? 'desc');
        if (optional.limit !== undefined) query = query.limit(optional.limit);
        return query.execute();
      });
      return rows.map((row) => parse({ row })).filter((entry): entry is EntryRecord => entry !== null);
    },
  };
}
