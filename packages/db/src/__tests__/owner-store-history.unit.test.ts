import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { openMemorySqliteKernel } from '../kernel/sqlite/index.js';
import { ownedTransactionOf } from '../kernel/owned-transaction.js';
import type { StorageKernel } from '../kernel/port.js';
import { executeDdl } from '../migrate/ddl.js';
import { runMigrations, sourceChecksum } from '../migrate/index.js';
import { OWNER_STORE_LEDGER, ownerStoreDdl, ownerStoreMigration, ownerStoreMigrations } from '../owner-store/index.js';
import { openSqlite } from './helpers.js';

describe('legacy owner schema history', () => {
  it('pins the published DDL and applies it through its independent ledger', async () => {
    expect(sourceChecksum(ownerStoreDdl)).toBe(ownerStoreMigration.checksum);
    expect(OWNER_STORE_LEDGER).toBe('owner_migrations');
    expect(ownerStoreMigrations).toEqual([ownerStoreMigration]);
    const kernel = openMemorySqliteKernel<unknown>({ open: openSqlite });
    try {
      const first = await runMigrations(kernel, ownerStoreMigrations, { ledgerTable: OWNER_STORE_LEDGER });
      expect(first.applied).toEqual(['0000_owner_store']);
      expect(await kernel.query(sql`SELECT id, checksum FROM owner_migrations`)).toEqual([
        { id: '0000_owner_store', checksum: 'ea2c33cf1835f6b1db0f52a4de3419aaf8c1a2e2edeece1e2b3240c517592446' },
      ]);
      expect(await kernel.query(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)).toEqual([
        { name: 'owner_grants' }, { name: 'owner_migrations' }, { name: 'secrets_vault' },
      ]);
      expect((await runMigrations(kernel, ownerStoreMigrations, { ledgerTable: OWNER_STORE_LEDGER })).alreadyApplied)
        .toEqual(['0000_owner_store']);
    } finally { await kernel.close(); }
  });

  it('enforces one default and label per owner, and cascades grants on deletion', async () => {
    const kernel = openMemorySqliteKernel<unknown>({ open: openSqlite });
    try {
      await ownerStoreMigration.up(kernel, { note() {} });
      const insert = (id: string, label: string, isDefault: number) => kernel.execute(sql`
        INSERT INTO secrets_vault
          (workspace_id, id, kind, owner_key, label, is_default, revision, meta, created_at, updated_at)
        VALUES ('workspace', ${id}, 'api_key', 'owner', ${label}, ${isDefault}, 1, '{}', 'created', 'updated')`);
      await insert('first', 'primary', 1);
      await expect(insert('second', 'another', 1)).rejects.toThrow(/UNIQUE constraint failed/);
      await expect(insert('third', 'primary', 0)).rejects.toThrow(/UNIQUE constraint failed/);
      await insert('fourth', 'secondary', 0);
      await kernel.execute(sql`INSERT INTO owner_grants VALUES ('first', 'consumer', 'created')`);
      expect(await kernel.query(sql`SELECT entry_id, consumer_id FROM owner_grants`)).toEqual([
        { entry_id: 'first', consumer_id: 'consumer' },
      ]);
      await kernel.execute(sql`DELETE FROM secrets_vault WHERE id = 'first'`);
      expect(await kernel.query(sql`SELECT * FROM owner_grants`)).toEqual([]);
      expect(await kernel.query(sql`SELECT id FROM secrets_vault`)).toEqual([{ id: 'fourth' }]);
    } finally { await kernel.close(); }
  });

  it('executes DDL statements in order and ignores empty statements', async () => {
    const kernel = openMemorySqliteKernel<unknown>({ open: openSqlite });
    try {
      await executeDdl({ kernel, ddl: '; \n; CREATE TABLE example (value TEXT); ; INSERT INTO example VALUES (\'saved\'); ;' });
      expect(await kernel.query(sql`SELECT value FROM example`)).toEqual([{ value: 'saved' }]);
      await executeDdl({ kernel, ddl: ' ; \n ; ' });
      expect(await kernel.query(sql`SELECT value FROM example`)).toEqual([{ value: 'saved' }]);
    } finally { await kernel.close(); }
  });

  it('stops at failed DDL so its enclosing transaction can roll back', async () => {
    const kernel = openMemorySqliteKernel<unknown>({ open: openSqlite });
    try {
      await expect(kernel.transaction(() => executeDdl({ kernel, ddl:
        'CREATE TABLE partial (id TEXT); INSERT INTO missing_table VALUES (1); CREATE TABLE later (id TEXT);',
      }))).rejects.toThrow(/missing_table/);
      expect(await kernel.query(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).toEqual([]);
    } finally { await kernel.close(); }
  });

  it('rejects foreign kernels before entering an owned transaction', () => {
    expect(() => ownedTransactionOf({ kernel: {} as StorageKernel<unknown> }))
      .toThrow('an owned transaction requires a kernel built by buildKernel');
  });
});
