import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { openMemorySqliteKernel } from '../kernel/sqlite/index.js';
import type { KyselyKernel } from '../kernel/port.js';
import {
  countOwnerStoreRows, listOwnerDestinations, listOwnerEntryRows, ownerStoreMigration, type LegacyOwnerDatabase,
} from '../owner-store/index.js';
import { openSqlite } from './helpers.js';

async function store() {
  const kernel = openMemorySqliteKernel<LegacyOwnerDatabase>({ open: openSqlite });
  await ownerStoreMigration.up(kernel as unknown as KyselyKernel<unknown>, { note() {} });
  return kernel;
}
const insertEntry = (kernel: KyselyKernel<LegacyOwnerDatabase>, { workspace, id, label, binding = null }: { workspace: string; id: string; label: string; binding?: string | null }) =>
  kernel.execute(sql`INSERT INTO secrets_vault (workspace_id, id, kind, owner_key, binding, label, is_default, revision, meta, created_at, updated_at)
    VALUES (${workspace}, ${id}, 'vendor', 'plugin', ${binding}, ${label}, 0, 1, '{}', 'created', 'updated')`);
const insertGrant = (kernel: KyselyKernel<LegacyOwnerDatabase>, entry: string, consumer: string) =>
  kernel.execute(sql`INSERT INTO owner_grants (entry_id, consumer_id, created_at) VALUES (${entry}, ${consumer}, 'now')`);

describe('legacy owner-store row queries', () => {
  it('counts every entry and grant, whatever their workspace', async () => {
    const kernel = await store();
    try {
      expect(await countOwnerStoreRows({ kernel })).toEqual({ entries: 0, grants: 0 });
      await insertEntry(kernel, { workspace: 'owner', id: 'a', label: 'A' });
      await insertEntry(kernel, { workspace: 'ws-other', id: 'b', label: 'B' });
      await insertGrant(kernel, 'a', '/sites/one');
      expect(await countOwnerStoreRows({ kernel })).toEqual({ entries: 2, grants: 1 });
    } finally { await kernel.close(); }
  });

  it('lists only the named workspace, in id order, with camelCase fields', async () => {
    const kernel = await store();
    try {
      await insertEntry(kernel, { workspace: 'owner', id: 'b', label: 'B', binding: 'conn' });
      await insertEntry(kernel, { workspace: 'owner', id: 'a', label: 'A' });
      await insertEntry(kernel, { workspace: 'ws-other', id: 'c', label: 'C' });
      expect(await listOwnerEntryRows({ kernel, workspaceId: 'owner' })).toEqual([
        { id: 'a', kind: 'vendor', ownerKey: 'plugin', binding: null },
        { id: 'b', kind: 'vendor', ownerKey: 'plugin', binding: 'conn' },
      ]);
      expect(await listOwnerEntryRows({ kernel, workspaceId: 'nobody' })).toEqual([]);
    } finally { await kernel.close(); }
  });

  it('lists grants by entry then consumer', async () => {
    const kernel = await store();
    try {
      await insertEntry(kernel, { workspace: 'owner', id: 'a', label: 'A' });
      await insertEntry(kernel, { workspace: 'owner', id: 'b', label: 'B' });
      await insertGrant(kernel, 'b', '/sites/one');
      await insertGrant(kernel, 'a', '/sites/two');
      await insertGrant(kernel, 'a', '/sites/one');
      expect(await listOwnerDestinations({ kernel, table: 'owner_grants' })).toEqual([
        { entryId: 'a', consumerId: '/sites/one' }, { entryId: 'a', consumerId: '/sites/two' }, { entryId: 'b', consumerId: '/sites/one' },
      ]);
    } finally { await kernel.close(); }
  });

  it('a 0000 store has no owner_revocations table, so its cleanups are empty; past 0001 they are listed', async () => {
    const kernel = await store();
    try {
      expect(await listOwnerDestinations({ kernel, table: 'owner_revocations' })).toEqual([]);
      await kernel.execute(sql`CREATE TABLE owner_revocations (entry_id TEXT NOT NULL, consumer_id TEXT NOT NULL, workspace_id TEXT NOT NULL, attempts INTEGER NOT NULL, updated_at TEXT NOT NULL)`);
      await kernel.execute(sql`INSERT INTO owner_revocations VALUES ('a', '/sites/old', 'ws-old', 1, 'now')`);
      expect(await listOwnerDestinations({ kernel, table: 'owner_revocations' })).toEqual([{ entryId: 'a', consumerId: '/sites/old' }]);
    } finally { await kernel.close(); }
  });
});
