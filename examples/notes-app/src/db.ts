/**
 * @file Opens the app's SQLite file and makes sure every table it needs exists, using only public
 * `@jini-ai/db` and `@jini-ai/cms` exports (no hand-written DDL).
 *
 * - Forms: `createFormsTables` from `@jini-ai/cms/forms/sql`.
 * - Notes: GAP. `@jini-ai/cms/entries` ships the entry services but only an in-memory repo and no
 *   table bootstrap. The least-bad public route to a durable table is `declareDataModule` from
 *   `@jini-ai/db/data-modules` (the plugin data-module seam): the app declares itself as a Tier-2
 *   "plugin" `notes_app` and gets a `p_notes_app__entries` table from a declarative column list.
 *   That seam is meant for plugins (it snapshots the file and records provenance), not for a host's
 *   own content tables.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { openSqliteConnection } from '@jini-ai/db/sqlite';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { declareDataModule } from '@jini-ai/db/data-modules';
import { createFormsTables } from '@jini-ai/cms/forms/sql';

export const FORMS_TABLES = { definitions: 'form_definitions', submissions: 'form_submissions' } as const;
export const NOTES_TABLE = 'p_notes_app__entries';

/** Row shape of the declared notes table (the data-module seam gives no typed table, see notes-repo.ts). */
export interface NotesTables {
  [NOTES_TABLE]: {
    id: string;
    workspace_id: string;
    type: string;
    slug: string;
    status: string;
    updated_at: string;
    record_json: string;
  };
}

export async function openAppDatabase({ filePath }: { filePath: string }, _optional: Record<string, never> = {}) {
  mkdirSync(dirname(filePath), { recursive: true });
  const connection = openSqliteConnection({ filePath, open: ({ filePath: path }) => new Database(path) });
  const kernel = sqliteKernel<NotesTables>(connection);
  await kernel.ready;

  await createFormsTables({ kernel, tables: FORMS_TABLES });

  const declared = await declareDataModule({
    db: kernel,
    dbPath: filePath,
    decl: {
      pluginId: 'notes_app',
      pluginTier: 'tier-2',
      provenance: { sourceUrl: 'local:examples/notes-app', publisher: 'notes-app' },
      tables: [{
        name: 'entries',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'workspace_id', type: 'TEXT', notNull: true },
          { name: 'type', type: 'TEXT', notNull: true },
          { name: 'slug', type: 'TEXT', notNull: true },
          { name: 'status', type: 'TEXT', notNull: true },
          { name: 'updated_at', type: 'TEXT', notNull: true },
          // GAP: the whole EntryRecord as JSON; entries has no row mapping of its own to reuse.
          { name: 'record_json', type: 'TEXT', notNull: true },
        ],
        indexes: [{ name: 'entries_slug', columns: ['workspace_id', 'type', 'slug'], unique: true }],
        portability: { kind: 'private' },
      }],
    },
  });
  if (!declared.ok) throw new Error(`notes table bootstrap failed: ${JSON.stringify(declared.error)}`);

  return { kernel, close: () => connection.close() };
}

export type AppKernel = Awaited<ReturnType<typeof openAppDatabase>>['kernel'];
