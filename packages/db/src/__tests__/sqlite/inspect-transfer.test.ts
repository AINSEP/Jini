import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { inspectSqliteDatabase, verifySqliteIntegrity } from '../../sqlite/inspect.js';
import type { SqliteDb } from '../../sqlite/sync-types.js';

it('strict transfers count every schema-owned table, including quoted names, without changing diagnostics', async () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE "a""quoted" (id INTEGER); INSERT INTO "a""quoted" VALUES (1), (2); CREATE TABLE better_sqlite3_user (id INTEGER); INSERT INTO better_sqlite3_user VALUES (1);');
    const checked = verifySqliteIntegrity({ db }, { includeRowCounts: true });
    expect(checked).toMatchObject({ ok: true, mode: 'integrity_check', issues: [], rowCounts: [
      { name: 'a"quoted', rowCount: 2 }, { name: 'better_sqlite3_user', rowCount: 1 },
    ] });
    expect((await inspectSqliteDatabase({ db, file: ':memory:' })).tables).toEqual([]);
    expect(verifySqliteIntegrity({ db })).not.toHaveProperty('rowCounts');
  } finally { db.close(); }
});

// Inject the handle contract, rather than mocking the module or SQLite driver.
function failingCounts({ missingRow = false, emptyIntegrity = false } = {}): SqliteDb {
  return {
    pragma: (name: string) => name === 'integrity_check' ? (emptyIntegrity ? [] : [{ integrity_check: 'ok' }]) : [],
    prepare: (sql: string) => sql.includes('sqlite_master') ? { all: () => [{ name: 'items' }] } : {
      get: () => { if (missingRow) return undefined; throw new Error('malformed page'); },
    },
  } as unknown as SqliteDb;
}
it('strict counts refuse query errors instead of comparing two failures as zero rows', async () => {
  const db = failingCounts();
  expect(verifySqliteIntegrity({ db }, { includeRowCounts: true })).toMatchObject({ ok: false, rowCounts: undefined,
    issues: [{ kind: 'integrity', message: 'row count verification failed: malformed page' }] });
  expect((await inspectSqliteDatabase({ db, file: '/nonexistent/fixture.db' })).tables).toEqual([{ name: 'items', rowCount: 0 }]);
});
it('strict transfers require an explicit successful pragma and an actual count row', () => {
  expect(verifySqliteIntegrity({ db: failingCounts({ emptyIntegrity: true }) }, { includeRowCounts: true })).toMatchObject({ ok: false,
    issues: [{ kind: 'integrity', message: 'A stopped transfer requires exactly one successful integrity result.' }] });
  expect(verifySqliteIntegrity({ db: failingCounts({ missingRow: true }) }, { includeRowCounts: true })).toMatchObject({ ok: false,
    issues: [{ kind: 'integrity', message: 'row count verification failed: Could not count table items.' }] });
});
