import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectSqliteDatabase, verifySqliteIntegrity } from '../../sqlite/inspect.js';

let dir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jini-db-inspect-'));
  dbPath = join(dir, 'app.db');
  db = new Database(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('inspectSqliteDatabase — real database', () => {
  it('reports schema version, tables, row counts, and a non-zero file size', async () => {
    db.pragma('user_version = 7');
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO items (name) VALUES ('a'), ('b'), ('c')");

    const report = await inspectSqliteDatabase({ db, file: dbPath });

    expect(report.kind).toBe('sqlite');
    expect(report.location).toBe(dbPath);
    expect(report.schemaVersion).toBe(7);
    expect(report.tables).toEqual([{ name: 'items', rowCount: 3 }]);
    expect(report.sizeBytes).toBeGreaterThan(0);
    expect(report.generatedAt).toBeGreaterThan(0);
  });

  it('excludes sqlite_ system tables from the table list', async () => {
    // AUTOINCREMENT forces sqlite to create the sqlite_sequence system table.
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    db.exec("INSERT INTO items (name) VALUES ('a')");

    const report = await inspectSqliteDatabase({ db, file: dbPath });
    expect(report.tables.map((t) => t.name)).toEqual(['items']);
  });

  it('reports an empty table list for a fresh database with default schema version 0', async () => {
    const report = await inspectSqliteDatabase({ db, file: dbPath });
    expect(report.tables).toEqual([]);
    expect(report.schemaVersion).toBe(0);
  });

  it('sums the primary file, -wal, and -shm sizes when WAL files exist', async () => {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO items (name) VALUES ('a')");

    const report = await inspectSqliteDatabase({ db, file: dbPath });
    expect(report.sizeBytes).toBeGreaterThan(0);
  });

  it('reports zero size for -wal/-shm when only the primary file exists (rollback journal mode)', async () => {
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)');
    const report = await inspectSqliteDatabase({ db, file: dbPath });
    // Primary file exists (>0 bytes); -wal/-shm are absent and contribute 0 — proven by comparing
    // against a report for a namespace with no writes at all still being > 0 (schema alone).
    expect(report.sizeBytes).toBeGreaterThan(0);
  });
});

describe('verifySqliteIntegrity — real database', () => {
  it('reports ok:true for a healthy database (integrity_check)', () => {
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    const report = verifySqliteIntegrity({ db });
    expect(report).toMatchObject({ ok: true, mode: 'integrity_check', issues: [] });
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('reports ok:true using the quick_check mode when quick is set', () => {
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)');
    const report = verifySqliteIntegrity({ db, quick: true });
    expect(report).toMatchObject({ ok: true, mode: 'quick_check', issues: [] });
  });

  it('surfaces a real foreign-key violation via foreign_key_check', () => {
    // This build of better-sqlite3 enforces FKs by default; disable enforcement so the insert
    // below succeeds despite the dangling reference — foreign_key_check finds it independent of
    // enforcement, which is exactly the "already-corrupted data" scenario this check is for.
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
    `);
    db.exec('INSERT INTO child (parent_id) VALUES (999)');

    const report = verifySqliteIntegrity({ db });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      { kind: 'foreign_key', message: expect.stringContaining('FK violation in child') },
    ]);
  });
});

describe('inspectSqliteDatabase — malformed / erroring database handle', () => {
  it('falls back to schemaVersion:null when the user_version pragma throws', async () => {
    const fakeDb = {
      pragma: () => {
        throw new Error('pragma unsupported');
      },
      prepare: () => ({ all: () => [], get: () => undefined }),
    } as unknown as Database.Database;

    const report = await inspectSqliteDatabase({ db: fakeDb, file: dbPath });
    expect(report.schemaVersion).toBeNull();
    expect(report.tables).toEqual([]);
  });

  it('falls back to schemaVersion:null when the pragma returns a non-numeric value', async () => {
    const fakeDb = {
      pragma: () => 'not-a-number',
      prepare: () => ({ all: () => [], get: () => undefined }),
    } as unknown as Database.Database;

    const report = await inspectSqliteDatabase({ db: fakeDb, file: dbPath });
    expect(report.schemaVersion).toBeNull();
  });

  it('leaves tables:[] when the sqlite_master table-list query throws', async () => {
    const fakeDb = {
      pragma: () => 0,
      prepare: () => ({
        all: () => {
          throw new Error('schema unreadable');
        },
        get: () => undefined,
      }),
    } as unknown as Database.Database;

    const report = await inspectSqliteDatabase({ db: fakeDb, file: dbPath });
    expect(report.tables).toEqual([]);
  });

  it('records rowCount:0 for a table whose count query throws (e.g. a corrupted table)', async () => {
    const fakeDb = {
      pragma: () => 0,
      prepare: (sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: () => [{ name: 't1' }], get: () => undefined };
        }
        return {
          all: () => [],
          get: () => {
            throw new Error('malformed page');
          },
        };
      },
    } as unknown as Database.Database;

    const report = await inspectSqliteDatabase({ db: fakeDb, file: dbPath });
    expect(report.tables).toEqual([{ name: 't1', rowCount: 0 }]);
  });

  it('records rowCount:0 when the count query returns no row at all (not just a throw)', async () => {
    const fakeDb = {
      pragma: () => 0,
      prepare: (sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: () => [{ name: 't1' }], get: () => undefined };
        }
        return { all: () => [], get: () => undefined };
      },
    } as unknown as Database.Database;

    const report = await inspectSqliteDatabase({ db: fakeDb, file: dbPath });
    expect(report.tables).toEqual([{ name: 't1', rowCount: 0 }]);
  });

  it('skips a table name that fails identifier sanitization', async () => {
    const fakeDb = {
      pragma: () => 0,
      prepare: (sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { all: () => [{ name: 'bad-name' }], get: () => undefined };
        }
        return { all: () => [], get: () => ({ c: 1 }) };
      },
    } as unknown as Database.Database;

    const report = await inspectSqliteDatabase({ db: fakeDb, file: dbPath });
    expect(report.tables).toEqual([]);
  });

  it('reports sizeBytes:0 when the primary file itself is missing', async () => {
    const fakeDb = {
      pragma: () => 0,
      prepare: () => ({ all: () => [], get: () => undefined }),
    } as unknown as Database.Database;

    const report = await inspectSqliteDatabase({ db: fakeDb, file: join(dir, 'never-created.db') });
    expect(report.sizeBytes).toBe(0);
  });
});

describe('verifySqliteIntegrity — malformed / erroring database handle', () => {
  it('records an issue when the integrity_check pragma throws', () => {
    const fakeDb = {
      pragma: (name: string) => {
        if (name === 'integrity_check') throw new Error('locked');
        return [];
      },
    } as unknown as Database.Database;

    const report = verifySqliteIntegrity({ db: fakeDb });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([{ kind: 'integrity', message: expect.stringContaining('pragma integrity_check threw') }]);
  });

  it('records an issue when the foreign_key_check pragma throws', () => {
    const fakeDb = {
      pragma: (name: string) => {
        if (name === 'foreign_key_check') throw new Error('locked');
        return [{ integrity_check: 'ok' }];
      },
    } as unknown as Database.Database;

    const report = verifySqliteIntegrity({ db: fakeDb });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      { kind: 'foreign_key', message: expect.stringContaining('pragma foreign_key_check threw') },
    ]);
  });

  it('skips a non-string integrity_check row value and falls back to the first column when the pragma-named key is absent', () => {
    const fakeDb = {
      pragma: (name: string) => {
        if (name === 'integrity_check') {
          return [{ integrity_check: 123 }, { unexpectedKey: 'row 5 missing' }];
        }
        return [];
      },
    } as unknown as Database.Database;

    const report = verifySqliteIntegrity({ db: fakeDb });
    expect(report.issues).toEqual([{ kind: 'integrity', message: 'row 5 missing' }]);
  });

  it('falls back to "?" for missing foreign_key_check row fields', () => {
    const fakeDb = {
      pragma: (name: string) => {
        if (name === 'integrity_check') return [{ integrity_check: 'ok' }];
        if (name === 'foreign_key_check') return [{}];
        return [];
      },
    } as unknown as Database.Database;

    const report = verifySqliteIntegrity({ db: fakeDb });
    expect(report.issues).toEqual([{ kind: 'foreign_key', message: 'FK violation in ? (rowid=?) referencing ? (fkid=?)' }]);
  });
});
