import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectSqliteDatabase, verifySqliteIntegrity } from '../inspect.js';

const opened: Database.Database[] = [];
function database(_input: Record<string, never>, _options = {}): Database.Database {
  const db = new Database(':memory:');
  opened.push(db);
  db.exec('CREATE TABLE items (id INTEGER); INSERT INTO items VALUES (1), (2)');
  return db;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of opened.splice(0)) db.close();
});

function overrideCount({ db, sql }: { db: Database.Database; sql: string }, _options = {}): void {
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation(query => prepare(query.startsWith('SELECT count(*)') ? sql : query));
}
function overridePragmas({ db, integrity = [{ integrity_check: 'ok' }], foreign = [] }: {
  db: Database.Database; integrity?: unknown; foreign?: unknown;
}, _options = {}): void {
  vi.spyOn(db, 'pragma').mockImplementation(name => {
    const value = name === 'foreign_key_check' ? foreign : integrity;
    if (value instanceof Error) throw value;
    return value;
  });
}

describe('table count compatibility pins', () => {
  it('keeps strict quoted and better_sqlite3 names while diagnostics filters them and sqlite_ internals', async () => {
    const db = database({});
    db.exec('CREATE TABLE "a""quoted" (id INTEGER); INSERT INTO "a""quoted" VALUES (1); CREATE TABLE better_sqlite3_user (id INTEGER); CREATE TABLE auto (id INTEGER PRIMARY KEY AUTOINCREMENT)');
    expect(verifySqliteIntegrity({ db }, { includeRowCounts: true }).rowCounts).toEqual([
      { name: 'a"quoted', rowCount: 1 }, { name: 'auto', rowCount: 0 },
      { name: 'better_sqlite3_user', rowCount: 0 }, { name: 'items', rowCount: 2 },
    ]);
    expect((await inspectSqliteDatabase({ db, file: ':memory:' })).tables).toEqual([
      { name: 'auto', rowCount: 0 }, { name: 'items', rowCount: 2 },
    ]);
  });
  it.each(['SELECT -1 AS c', 'SELECT 1.5 AS c', 'SELECT 9007199254740992 AS c', 'SELECT NULL AS c', 'SELECT 0 AS c WHERE 0'])(
    'rejects invalid strict counts from %s while diagnostics retains its old result', async sql => {
      const db = database({});
      overrideCount({ db, sql });
      const expected = db.prepare(sql).get() as { c: number | null } | undefined;
      expect(verifySqliteIntegrity({ db }, { includeRowCounts: true })).toMatchObject({
        ok: false, rowCounts: undefined,
        issues: [{ kind: 'integrity', message: 'row count verification failed: Could not count table items.' }],
      });
      expect((await inspectSqliteDatabase({ db, file: ':memory:' })).tables).toEqual([{ name: 'items', rowCount: expected?.c ?? 0 }]);
    },
  );
  it.each(['schema', 'count'])('propagates %s errors in strict verification and degrades diagnostics', async phase => {
    const db = database({});
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (sql.includes(phase === 'schema' ? 'sqlite_master' : 'count(*)')) throw new Error('unreadable page');
      return prepare(sql);
    });
    expect(verifySqliteIntegrity({ db }, { includeRowCounts: true })).toMatchObject({
      ok: false, issues: [{ kind: 'integrity', message: 'row count verification failed: unreadable page' }],
    });
    expect((await inspectSqliteDatabase({ db, file: ':memory:' })).tables).toEqual(phase === 'schema' ? [] : [{ name: 'items', rowCount: 0 }]);
  });
});

describe('integrity interpretation pins', () => {
  it.each([false, true])('normalizes named and first-column messages in quick=%s mode', quick => {
    const db = database({});
    const key = quick ? 'quick_check' : 'integrity_check';
    overridePragmas({ db, integrity: [{ [key]: 'OK' }, { other: 'bad page' }, { [key]: 7 }, { [key]: null, first: 'ignored' }] });
    const report = verifySqliteIntegrity({ db, quick });
    expect(report).toMatchObject({ ok: false, mode: key, issues: [{ kind: 'integrity', message: 'bad page' }] });
    expect(report).not.toHaveProperty('rowCounts');
  });
  it.each([
    { integrity: [], messages: [] },
    { integrity: [{ integrity_check: 'bad' }], messages: [{ kind: 'integrity', message: 'bad' }] },
    { integrity: [{ integrity_check: 'ok' }, { integrity_check: 'ok' }], messages: [] },
    { integrity: [{}], messages: [] },
  ])(
    'requires exactly one explicit successful integrity row: %j', ({ integrity, messages }) => {
      const db = database({});
      overridePragmas({ db, integrity });
      const report = verifySqliteIntegrity({ db }, { includeRowCounts: true });
      expect(report.ok).toBe(false);
      expect(report.rowCounts).toBeUndefined();
      expect(report.issues[0]).toEqual({ kind: 'integrity', message: 'A stopped transfer requires exactly one successful integrity result.' });
      expect(report.issues.slice(1)).toEqual(messages);
    },
  );
  it('accepts a successful first-column fallback and checks counts in quick mode', () => {
    const db = database({});
    overridePragmas({ db, integrity: [{ alternate: 'Ok' }] });
    expect(verifySqliteIntegrity({ db, quick: true }, { includeRowCounts: true })).toMatchObject({
      ok: true, mode: 'quick_check', issues: [], rowCounts: [{ name: 'items', rowCount: 2 }],
    });
  });
  it('reports both pragma exceptions in order and skips counts when integrity fails', () => {
    const db = database({});
    overridePragmas({ db, integrity: new Error('integrity unavailable'), foreign: new Error('fk unavailable') });
    const prepare = vi.spyOn(db, 'prepare');
    expect(verifySqliteIntegrity({ db }, { includeRowCounts: true })).toMatchObject({ ok: false, rowCounts: undefined, issues: [
      { kind: 'integrity', message: 'pragma integrity_check threw: integrity unavailable' },
      { kind: 'foreign_key', message: 'pragma foreign_key_check threw: fk unavailable' },
    ] });
    expect(prepare).not.toHaveBeenCalled();
  });
  it('reports complete and missing foreign-key fields, preserving zero values and suppressing counts', () => {
    const db = database({});
    overridePragmas({ db, foreign: [{ table: 'child', parent: 'parent', rowid: 0, fkid: 0 }, {}] });
    expect(verifySqliteIntegrity({ db }, { includeRowCounts: true })).toMatchObject({ ok: false, rowCounts: undefined, issues: [
      { kind: 'foreign_key', message: 'FK violation in child (rowid=0) referencing parent (fkid=0)' },
      { kind: 'foreign_key', message: 'FK violation in ? (rowid=?) referencing ? (fkid=?)' },
    ] });
  });
});
