/**
 * Guards the `./db/sqlite` public surface — the driver counterpart to the `db/core` barrel test.
 *
 * The exact-export assertion is load-bearing beyond catching typos: it is what would fail if
 * someone re-introduced an ORM-typed export here. This package's surface is deliberately limited
 * to structural shapes and `better-sqlite3` interfaces, because those cross a package boundary
 * cleanly and ORM class types (with private/protected members) provably do not. See `open.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as sqlite from '../index.js';

describe('@jini-ai/infra/db/sqlite barrel', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jini-infra-barrel-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exports exactly the runtime surface it promises, and no ORM-typed helper', () => {
    expect(Object.keys(sqlite).sort()).toEqual(['DEFAULT_PRAGMAS', 'SqliteDbOpsAdapter', 'openSqliteConnection']);
  });

  it('re-exports a working connection opener', () => {
    const conn = sqlite.openSqliteConnection({ filePath: ':memory:' });
    expect(conn.open).toBe(true);
    expect(sqlite.DEFAULT_PRAGMAS).toContain('journal_mode = WAL');
  });

  it('applies the default pragmas, with WAL as the one that actually changes behaviour', () => {
    const conn = sqlite.openSqliteConnection({ filePath: join(dir, 'x.db') });
    expect(conn.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(conn.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('lets a caller REPLACE the defaults rather than extend them', () => {
    const conn = sqlite.openSqliteConnection({ filePath: join(dir, 'y.db'), pragmas: ['cache_size = -4000'] });
    expect(conn.pragma('cache_size', { simple: true })).toBe(-4000);
    // journal_mode is the only usable probe: better-sqlite3 already sets foreign_keys=1 and
    // busy_timeout=5000 itself, so both read the "expected" value whether or not our list ran.
    expect(conn.pragma('journal_mode', { simple: true })).toBe('delete');
  });

  it('runs the recovery hook against the path BEFORE opening its own connection', () => {
    const calls: string[] = [];
    const filePath = join(dir, 'z.db');
    sqlite.openSqliteConnection({ filePath, recover: (p) => calls.push(p) });
    expect(calls).toEqual([filePath]);
  });

  it('opens cleanly with no hook supplied', () => {
    expect(() => sqlite.openSqliteConnection({ filePath: ':memory:' })).not.toThrow();
  });
});
