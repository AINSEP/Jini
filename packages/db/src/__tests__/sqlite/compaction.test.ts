/**
 * ST-7a: stopped-site conversion to incremental auto-vacuum, and the bounded daily step.
 * Real SQLite files in a temp folder; only disk space and the marker store are faked, because the
 * container cannot be made to run out of disk and the marker is the host's file.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqliteCompactionMarker, SqliteCompactionMarkerStore } from '@jini-ai/core/contracts/storage';
import { compactionRecoveryCopyPath, convertToIncrementalVacuum, incrementalVacuumStep, nodeCompactionFs } from '../../sqlite/compaction.js';
import type { StoppedSqliteOpener } from '../../sqlite/stopped.js';

let dir: string;
let file: string;
const extra: Database.Database[] = [];
const open: StoppedSqliteOpener = (f, o) => new Database(f, o);

function memoryMarker(_optional: { failOn?: SqliteCompactionMarker['state'] } = {}) {
  const written: SqliteCompactionMarker[] = [];
  let failOn = _optional.failOn;
  const store: SqliteCompactionMarkerStore & { written: typeof written; heal(): void } = {
    written,
    heal() { failOn = undefined; },
    async read() { return written.at(-1); },
    async write(marker) {
      if (marker.state === failOn) throw new Error(`simulated crash before recording ${marker.state}`);
      written.push(marker);
    },
  };
  return store;
}

function seed(): void {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
  const insert = db.prepare('INSERT INTO notes (body) VALUES (?)');
  db.transaction(() => { for (let i = 0; i < 400; i++) insert.run('x'.repeat(2000)); })();
  db.exec('DELETE FROM notes WHERE id % 2 = 0');
  db.close();
}

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const autoVacuum = (path: string) => { const db = new Database(path, { readonly: true }); try { return db.pragma('auto_vacuum', { simple: true }); } finally { db.close(); } };
const rows = (path: string) => { const db = new Database(path, { readonly: true }); try { return db.prepare('SELECT count(*) AS n FROM notes').get(); } finally { db.close(); } };
const keep = (db: Database.Database) => { extra.push(db); return db; };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jini-compaction-'));
  file = join(dir, 'content.db');
  seed();
});

afterEach(() => {
  for (const db of extra.splice(0)) if (db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('convertToIncrementalVacuum', () => {
  it('marker only after auto_vacuum reads 2', async () => {
    const marker = memoryMarker();
    const outcome = await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true }, { now: () => 1000 });
    expect(outcome.status).toBe('converted');
    expect(autoVacuum(file)).toBe(2);
    expect(rows(file)).toEqual({ n: 200 });
    expect(marker.written.map((m) => m.state)).toEqual(['copied', 'rewriting', 'converted']);
    const done = marker.written.at(-1) as Extract<SqliteCompactionMarker, { state: 'converted' }>;
    expect(done.identity).toBe(await nodeCompactionFs.identity(file));
    expect(done.recoveryCopyPath).toBe(join(dir, 'pre-compact-content-1000.db'));
    // The recovery copy is a whole, readable database with the same rows, and it is not the live file.
    expect(rows(done.recoveryCopyPath)).toEqual({ n: 200 });
    expect(existsSync(`${done.recoveryCopyPath}.partial`)).toBe(false);
  });

  it('a failed check after the rewrite records needs-attention and never converted', async () => {
    const marker = memoryMarker();
    // Same real connection; only its integrity_check answer is replaced, as a corrupt rewrite would answer.
    const lying: StoppedSqliteOpener = (f, o) => {
      const db = new Database(f, o);
      const pragma = db.pragma.bind(db);
      if (!o.readonly) db.pragma = ((source: string, options?: Database.PragmaOptions) => (source === 'integrity_check' ? [{ integrity_check: 'page 3 is never used' }] : pragma(source, options))) as typeof db.pragma;
      return db;
    };
    const outcome = await convertToIncrementalVacuum({ filePath: file, open: lying, marker, holdsRunningLease: () => true });
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'needs-attention' });
    expect(marker.written.map((m) => m.state)).toEqual(['copied', 'rewriting', 'needs-attention']);
    expect(existsSync(marker.written[0]!.recoveryCopyPath)).toBe(true);
    // Recorded as its own state: a later attempt refuses instead of rewriting again.
    const again = await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true });
    expect(again).toMatchObject({ status: 'deferred', reason: 'needs-attention' });
    expect(marker.written).toHaveLength(3);
  });

  it('pinned WAL reader → deferred, file intact', async () => {
    const reader = keep(new Database(file));
    const pinned = reader.prepare('SELECT * FROM notes').iterate();
    pinned.next();
    const before = digest(file);
    const marker = memoryMarker();
    const outcome = await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true });
    pinned.return?.();
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'busy' });
    expect(outcome.status === 'deferred' && outcome.message).toBe("This website's database is busy; compaction will try again later.");
    expect(digest(file)).toBe(before);
    expect(marker.written).toEqual([]);
    expect(readdirSync(dir).filter((name) => name.startsWith('pre-compact-'))).toEqual([]);
  });

  it('competing writer → busy deferral', async () => {
    const writer = keep(new Database(file));
    writer.exec('BEGIN IMMEDIATE; INSERT INTO notes (body) VALUES (\'late\');');
    const marker = memoryMarker();
    const outcome = await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true });
    writer.exec('COMMIT');
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'busy' });
    expect(autoVacuum(file)).toBe(0);
    expect(marker.written).toEqual([]);
  });

  it('low disk → deferred with plain message', async () => {
    const marker = memoryMarker();
    const fs = { ...nodeCompactionFs, freeBytes: async () => 10 * 1024 * 1024 };
    const before = digest(file);
    const outcome = await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true }, { fs });
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'low-disk' });
    expect(outcome.status === 'deferred' && outcome.message).toMatch(/^There is not enough free disk space to compact this website's database \(needs \d+ MB, \d+ MB free\)\. Nothing was changed\.$/);
    expect(digest(file)).toBe(before);
    expect(marker.written).toEqual([]);
  });

  it('budgets the copy and the rewrite on each filesystem they use', async () => {
    const main = await nodeCompactionFs.size(file);
    const wal = await nodeCompactionFs.size(`${file}-wal`);
    const reserve = 1024;
    const need = main + wal + reserve;
    // Same filesystem: one budget for both, so exactly 2 × size + reserve is the minimum.
    const same = { ...nodeCompactionFs, deviceOf: async () => 'one', freeBytes: async () => 2 * (main + wal) + reserve - 1 };
    expect(await convertToIncrementalVacuum({ filePath: file, open, marker: memoryMarker(), holdsRunningLease: () => true }, { fs: same, reserveBytes: reserve }))
      .toMatchObject({ reason: 'low-disk' });
    // Two filesystems: each only needs one size + reserve.
    const split = { ...nodeCompactionFs, deviceOf: async (d: string) => d, freeBytes: async () => need };
    const copyDir = mkdtempSync(join(tmpdir(), 'jini-compaction-copy-'));
    try {
      const outcome = await convertToIncrementalVacuum({ filePath: file, open, marker: memoryMarker(), holdsRunningLease: () => true },
        { fs: split, reserveBytes: reserve, recoveryCopyPath: join(copyDir, 'pre-compact-content-1.db') });
      expect(outcome.status).toBe('converted');
    } finally { rmSync(copyDir, { recursive: true, force: true }); }
  });

  it('refused while the running lease is not held, before the file is opened', async () => {
    let opened = false;
    const outcome = await convertToIncrementalVacuum({ filePath: file, open: (f, o) => { opened = true; return open(f, o); }, marker: memoryMarker(), holdsRunningLease: () => false });
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'running', message: 'This website is running; compaction needs it stopped.' });
    expect(opened).toBe(false);
  });

  it('interrupt after the copy, then restart completes with the same recovery copy', async () => {
    const marker = memoryMarker({ failOn: 'rewriting' });
    await expect(convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true }, { now: () => 5 })).rejects.toThrow(/simulated crash/);
    expect(autoVacuum(file)).toBe(0);
    expect(rows(file)).toEqual({ n: 200 });
    marker.heal();
    const outcome = await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true }, { now: () => 9 });
    expect(outcome).toMatchObject({ status: 'converted', recoveryCopyPath: join(dir, 'pre-compact-content-5.db') });
    expect(existsSync(join(dir, 'pre-compact-content-9.db'))).toBe(false);
  });

  it('interrupt after the rewrite, then restart verifies and records completion', async () => {
    const marker = memoryMarker({ failOn: 'converted' });
    await expect(convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true })).rejects.toThrow(/simulated crash/);
    expect(autoVacuum(file)).toBe(2);
    marker.heal();
    const outcome = await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true });
    expect(outcome.status).toBe('converted');
    expect(marker.written.at(-1)?.state).toBe('converted');
  });

  it('an already converted file for the same identity is left alone', async () => {
    const marker = memoryMarker();
    await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true });
    const before = digest(file);
    const outcome = await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true });
    expect(outcome.status).toBe('already-converted');
    expect(digest(file)).toBe(before);
  });

  it('names the recovery copy apart from pre-migration copies and from the other database', () => {
    expect(compactionRecoveryCopyPath({ filePath: join(dir, 'chat.db'), now: 7 })).toBe(join(dir, 'pre-compact-chat-7.db'));
  });

  it('refuses a recovery copy path that is the database itself or already exists', async () => {
    await expect(convertToIncrementalVacuum({ filePath: file, open, marker: memoryMarker(), holdsRunningLease: () => true }, { recoveryCopyPath: file }))
      .rejects.toThrow('The recovery copy must be a new file next to the database, not the database itself or an existing file.');
  });
});

describe('incrementalVacuumStep', () => {
  async function converted() {
    const marker = memoryMarker();
    await convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true });
    const db = keep(new Database(file));
    db.exec('DELETE FROM notes WHERE id > 50'); // whole pages free up (two rows fit a page)
    return { db, marker };
  }

  it('unconverted file is skipped', async () => {
    const db = keep(new Database(file));
    const outcome = await incrementalVacuumStep({ db, filePath: file, marker: memoryMarker() });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'not-converted' });
  });

  it('a file replaced after conversion does not inherit the marker', async () => {
    const { db, marker } = await converted();
    const outcome = await incrementalVacuumStep({ db, filePath: file, marker }, { fs: { ...nodeCompactionFs, identity: async () => 'restored-file' } });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'not-converted' });
  });

  it('report has main and WAL sizes and reclaims at most maxPages', async () => {
    const { db, marker } = await converted();
    const ticks = [100, 140];
    const outcome = await incrementalVacuumStep({ db, filePath: file, marker }, { maxPages: 5, minFreeBytes: 0, now: () => ticks.shift()! });
    expect(outcome.status).toBe('reclaimed');
    if (outcome.status !== 'reclaimed') return;
    expect(outcome.before.freePages - outcome.after.freePages).toBe(5);
    expect(outcome.before.mainBytes).toBeGreaterThan(0);
    expect(typeof outcome.after.walBytes).toBe('number');
    expect(outcome.elapsedMs).toBe(40);
    expect(outcome.message).toContain('a long-running reader can delay');
  });

  it('busy defers and restores the connection busy timeout', async () => {
    const { db, marker } = await converted();
    db.pragma('busy_timeout = 4321');
    const writer = keep(new Database(file));
    writer.exec('BEGIN IMMEDIATE');
    const outcome = await incrementalVacuumStep({ db, filePath: file, marker }, { minFreeBytes: 0, busyTimeoutMs: 1 });
    writer.exec('ROLLBACK');
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'busy', message: "This website's database is busy; compaction will try again later." });
    expect(db.pragma('busy_timeout', { simple: true })).toBe(4321);
  });

  it('nothing to reclaim below both thresholds', async () => {
    const { db, marker } = await converted();
    const outcome = await incrementalVacuumStep({ db, filePath: file, marker }, { minFreeBytes: 1e12, minFreeRatio: 1.1 });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'nothing-to-reclaim' });
  });

  it('refuses to run inside a transaction', async () => {
    const { db, marker } = await converted();
    db.exec('BEGIN');
    await expect(incrementalVacuumStep({ db, filePath: file, marker })).rejects.toThrow('incrementalVacuumStep must run outside a transaction.');
    db.exec('ROLLBACK');
  });
});
