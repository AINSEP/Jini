/** The `/testing` entry opens real drivers; each helper must hand back a kernel that runs real SQL. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { openPgliteTestKernel } from '../kernel/pglite/testing.js';
import { openPgliteSocketTestKernel, openPostgresTestKernel } from '../kernel/postgres/testing.js';
import { openFileSqliteTestKernel, openMemorySqliteTestKernel } from '../kernel/sqlite/testing.js';
import { startPgliteTestOwner } from '../pglite/testing.js';

interface Db { notes: { id: number; body: string } }
const DDL = ['CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)'];

describe('openMemorySqliteTestKernel', () => {
  it('runs the ddl once, enforces foreign keys, and exposes the raw connection', async () => {
    const { kernel, connection, close } = openMemorySqliteTestKernel<Db>({}, { ddl: DDL });
    try {
      await kernel.run((db) => db.insertInto('notes').values({ id: 1, body: 'a' }).execute());
      expect(connection.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(await kernel.run((db) => db.selectFrom('notes').select('body').execute())).toEqual([{ body: 'a' }]);
    } finally { await close(); }
  });
});

describe('openFileSqliteTestKernel', () => {
  it('opens a second independent connection to the same file that sees committed rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-testing-file-'));
    const path = join(dir, 'a.sqlite');
    const first = openFileSqliteTestKernel<Db>({ path }, { ddl: DDL });
    const second = openFileSqliteTestKernel<Db>({ path });
    try {
      await first.kernel.run((db) => db.insertInto('notes').values({ id: 1, body: 'shared' }).execute());
      expect(await second.kernel.run((db) => db.selectFrom('notes').select('body').execute())).toEqual([{ body: 'shared' }]);
      expect(second.connection).not.toBe(first.connection);
    } finally { await first.close(); await second.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('openPgliteTestKernel', () => {
  it('runs ddl on an in-memory PostgreSQL and can view the same database through a schema', async () => {
    const { kernel, inSchema, close } = await openPgliteTestKernel<Db>({}, { ddl: ['CREATE SCHEMA owned', 'CREATE TABLE owned.notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)'] });
    try {
      await inSchema({ schema: 'owned' }).run((db) => db.insertInto('notes').values({ id: 1, body: 'pg' }).execute());
      expect(await kernel.run((db) => sql<{ body: string }>`SELECT body FROM owned.notes`.execute(db))).toMatchObject({ rows: [{ body: 'pg' }] });
    } finally { await close(); }
  });

  it('closes the embedded database and rethrows when the ddl is invalid', async () => {
    await expect(openPgliteTestKernel<Db>({}, { ddl: ['NOT SQL'] })).rejects.toThrow(/syntax/i);
  });
});

describe('startPgliteTestOwner + openPgliteSocketTestKernel', () => {
  it('serves PGlite over its owner socket to a node-postgres client', async () => {
    const owner = await startPgliteTestOwner();
    const { kernel, close } = await openPgliteSocketTestKernel<Db>({ socketPath: owner.socketPath }, { ddl: DDL });
    try {
      await kernel.run((db) => db.insertInto('notes').values({ id: 1, body: 'sock' }).execute());
      expect(await kernel.run((db) => db.selectFrom('notes').select('body').execute())).toEqual([{ body: 'sock' }]);
    } finally { await close(); await owner.close(); }
  });
});

describe('openPostgresTestKernel', () => {
  it('refuses a database that is not a disposable test database', async () => {
    await expect(openPostgresTestKernel<Db>({ url: 'postgres://u@localhost/production' })).rejects.toThrow(/disposable/);
  });
});
