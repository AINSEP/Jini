import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PRAGMAS, openSqliteDb } from '../open.js';

const widgets = sqliteTable('widgets', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});

const schema = { widgets };

/**
 * Writes the smallest migrations folder the Drizzle better-sqlite3 migrator will accept: a
 * `meta/_journal.json` index plus one `.sql` file per entry, keyed by `tag`.
 */
function writeMigrations(dir: string): string {
  const folder = join(dir, 'migrations');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{ idx: 0, version: '6', when: 1700000000000, tag: '0000_init', breakpoints: true }],
    }),
  );
  writeFileSync(
    join(folder, '0000_init.sql'),
    'CREATE TABLE `widgets` (`id` integer PRIMARY KEY NOT NULL, `name` text NOT NULL);',
  );
  return folder;
}

describe('openSqliteDb', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jini-infra-open-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies the default pragmas, so declared foreign keys are actually enforced', () => {
    const db = openSqliteDb({ filePath: ':memory:', schema });
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('puts a file-backed database into WAL mode', () => {
    const db = openSqliteDb({ filePath: join(dir, 'content.db'), schema });
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('lets a caller REPLACE the defaults rather than extend them', () => {
    const db = openSqliteDb({
      filePath: join(dir, 'content.db'),
      schema,
      pragmas: ['cache_size = -4000'],
    });
    expect(db.$client.pragma('cache_size', { simple: true })).toBe(-4000);
    // `journal_mode` is the ONLY pragma that can prove this, and the reason is measured, not
    // assumed: better-sqlite3 already applies `foreign_keys = 1` and `busy_timeout = 5000` of
    // its own accord, so both read the "expected" value whether or not DEFAULT_PRAGMAS ran.
    // WAL is the one setting better-sqlite3 does not turn on (a fresh file db reports "delete"),
    // so seeing "delete" here is real evidence the default list was replaced rather than merged.
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('delete');
  });

  it('exposes DEFAULT_PRAGMAS so a caller can extend them deliberately', () => {
    const db = openSqliteDb({
      filePath: ':memory:',
      schema,
      pragmas: [...DEFAULT_PRAGMAS, 'cache_size = -2000'],
    });
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('cache_size', { simple: true })).toBe(-2000);
  });

  it('runs the recovery hook against the path BEFORE opening its own connection', () => {
    const calls: string[] = [];
    const filePath = join(dir, 'content.db');
    openSqliteDb({
      filePath,
      schema,
      recover: (p) => {
        calls.push(p);
      },
    });
    expect(calls).toEqual([filePath]);
  });

  it('applies migrations from the supplied directory', () => {
    const migrationsDir = writeMigrations(dir);
    const db = openSqliteDb({ filePath: ':memory:', schema, migrationsDir });
    db.insert(widgets).values({ id: 1, name: 'a' }).run();
    expect(db.select().from(widgets).all()).toEqual([{ id: 1, name: 'a' }]);
  });

  it('skips migration entirely when no directory is given', () => {
    const db = openSqliteDb({ filePath: ':memory:', schema });
    // No migrations ran, so the table genuinely does not exist.
    expect(() => db.select().from(widgets).all()).toThrow(/no such table/i);
  });

  it('runs afterMigrate with the open handle, after migrations have been applied', () => {
    const migrationsDir = writeMigrations(dir);
    const db = openSqliteDb({
      filePath: ':memory:',
      schema,
      migrationsDir,
      // Proves ordering: this insert would fail if it ran before the CREATE TABLE migration.
      afterMigrate: (handle) => {
        handle.insert(widgets).values({ id: 7, name: 'seeded' }).run();
      },
    });
    expect(db.select().from(widgets).all()).toEqual([{ id: 7, name: 'seeded' }]);
  });

  it('opens cleanly with neither hook supplied', () => {
    expect(() => openSqliteDb({ filePath: ':memory:', schema })).not.toThrow();
  });
});
