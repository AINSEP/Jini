/**
 * ST-7a: stopped-site conversion to incremental auto-vacuum, and the bounded daily step.
 * Real SQLite files in a temp folder. The filesystem port is the test's own Node binding (the module
 * ships none); only disk space and the marker store are faked, because the container cannot be made to
 * run out of disk and the marker is the host's file.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqliteCompactionFs, SqliteCompactionMarker, SqliteCompactionMarkerStore } from '@jini-ai/core/contracts/storage';
import { compactionRecoveryCopyPath, convertToIncrementalVacuum, incrementalVacuumStep } from '../compaction.js';
import type { StoppedSqliteOpener } from '../stopped.js';

let dir: string;
let file: string;
const extra: Database.Database[] = [];
const cleanup: string[] = [];
const open: StoppedSqliteOpener = (f, o) => new Database(f, o);

const nodeFs: SqliteCompactionFs = {
  size: async (f) => fsp.stat(f).then((s) => s.size, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return 0; throw error; }),
  exists: async (f) => fsp.lstat(f).then(() => true, () => false),
  freeBytes: async (d) => fsp.statfs(d).then((s) => s.bavail * s.bsize),
  deviceOf: async (d) => String((await fsp.stat(d)).dev),
  identity: async (f) => { const s = await fsp.stat(f); return `${s.dev}:${s.ino}`; },
  publish: async (from, to) => {
    await fsp.rename(from, to);
    const folder = await fsp.open(dirname(to), 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  },
  removeOwn: async (f) => fsp.rm(f, { force: true }),
  tempDirectory: () => tmpdir(),
};

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
const copies = () => readdirSync(dir).filter((name) => name.startsWith('pre-compact-'));
const tempDir = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d; };
const lease = (_optional: { failAtCall?: number } = {}) => {
  let calls = 0;
  const probe = () => { calls += 1; return _optional.failAtCall === undefined || calls < _optional.failAtCall; };
  return Object.assign(probe, { calls: () => calls });
};
const convert = (marker: SqliteCompactionMarkerStore, extraRequired: Partial<Parameters<typeof convertToIncrementalVacuum>[0]> = {}, optional: Parameters<typeof convertToIncrementalVacuum>[1] = {}) =>
  convertToIncrementalVacuum({ filePath: file, open, marker, holdsRunningLease: () => true, fs: nodeFs, now: () => 1000, ...extraRequired }, optional);

beforeEach(() => {
  dir = tempDir('jini-compaction-');
  file = join(dir, 'content.db');
  seed();
});

afterEach(() => {
  for (const db of extra.splice(0)) if (db.open) db.close();
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('convertToIncrementalVacuum', () => {
  it('marker only after auto_vacuum reads 2', async () => {
    const marker = memoryMarker();
    const outcome = await convert(marker);
    expect(outcome.status).toBe('converted');
    expect(autoVacuum(file)).toBe(2);
    expect(rows(file)).toEqual({ n: 200 });
    expect(marker.written.map((m) => m.state)).toEqual(['copying', 'copied', 'rewriting', 'converted']);
    const done = marker.written.at(-1) as Extract<SqliteCompactionMarker, { state: 'converted' }>;
    expect(done.identity).toBe(await nodeFs.identity(file));
    expect(done.recoveryCopyPath).toBe(join(dir, 'pre-compact-content-1000.db'));
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
    const outcome = await convert(marker, { open: lying });
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'needs-attention' });
    expect(marker.written.map((m) => m.state)).toEqual(['copying', 'copied', 'rewriting', 'needs-attention']);
    expect(existsSync(marker.written[0]!.recoveryCopyPath)).toBe(true);
    const again = await convert(marker);
    expect(again).toMatchObject({ status: 'deferred', reason: 'needs-attention' });
    expect(marker.written).toHaveLength(4);
  });

  it('conversion refuses a handle inside a transaction', async () => {
    // A migration runner's handle is mid-transaction; VACUUM must never run there (owner rule b).
    const shared = keep(new Database(file));
    shared.exec('BEGIN');
    const before = digest(file);
    const marker = memoryMarker();
    await expect(convert(marker, { open: () => shared })).rejects.toThrow('Compaction must run on its own connection, outside any migration or transaction.');
    expect(shared.inTransaction).toBe(true);
    shared.exec('ROLLBACK');
    expect(digest(file)).toBe(before);
    expect(marker.written).toEqual([]);
    expect(copies()).toEqual([]);
  });

  it('pinned WAL reader → deferred, file intact', async () => {
    const reader = keep(new Database(file));
    const pinned = reader.prepare('SELECT * FROM notes').iterate();
    pinned.next();
    const before = digest(file);
    const marker = memoryMarker();
    const outcome = await convert(marker);
    pinned.return?.();
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'busy', message: "This website's database is busy; compaction will try again later." });
    expect(digest(file)).toBe(before);
    expect(marker.written).toEqual([]);
    expect(copies()).toEqual([]);
  });

  it('competing writer → busy deferral', async () => {
    const writer = keep(new Database(file));
    writer.exec('BEGIN IMMEDIATE; INSERT INTO notes (body) VALUES (\'late\');');
    const marker = memoryMarker();
    const outcome = await convert(marker);
    writer.exec('COMMIT');
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'busy' });
    expect(autoVacuum(file)).toBe(0);
    expect(marker.written).toEqual([]);
  });

  it('low disk → deferred with plain message', async () => {
    const marker = memoryMarker();
    const before = digest(file);
    const outcome = await convert(marker, { fs: { ...nodeFs, freeBytes: async () => 10 * 1024 * 1024 } });
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'low-disk' });
    expect(outcome.status === 'deferred' && outcome.message).toMatch(/^There is not enough free disk space to compact this website's database \(needs \d+ MB, \d+ MB free\)\. Nothing was changed\.$/);
    expect(digest(file)).toBe(before);
    expect(marker.written).toEqual([]);
  });

  it('temp folder on a full disk → deferred low-disk, file intact', async () => {
    const temp = tempDir('jini-compaction-temp-');
    const fs = { ...nodeFs, tempDirectory: () => temp, deviceOf: async (d: string) => d, freeBytes: async (d: string) => (d === temp ? 1024 : 1e12) };
    const before = digest(file);
    const marker = memoryMarker();
    const outcome = await convert(marker, { fs });
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'low-disk' });
    expect(digest(file)).toBe(before);
    expect(marker.written).toEqual([]);
    expect(copies()).toEqual([]);
  });

  it('budgets journal, temp space and the new copy per distinct filesystem', async () => {
    const bytes = await nodeFs.size(file) + await nodeFs.size(`${file}-wal`);
    const reserve = 1024;
    // One filesystem holds the copy, the rollback journal and SQLite's temp database: 3 × size + reserve.
    const same = { ...nodeFs, deviceOf: async () => 'one', freeBytes: async () => 3 * bytes + reserve - 1 };
    expect(await convert(memoryMarker(), { fs: same }, { reserveBytes: reserve })).toMatchObject({ reason: 'low-disk' });
    // Copy, database and temp each on their own filesystem: each only needs one size + reserve.
    const copyDir = tempDir('jini-compaction-copy-');
    const split = { ...nodeFs, tempDirectory: () => tempDir('jini-compaction-tmp-'), deviceOf: async (d: string) => d, freeBytes: async () => bytes + reserve };
    const outcome = await convert(memoryMarker(), { fs: split }, { reserveBytes: reserve, recoveryCopyPath: join(copyDir, 'pre-compact-content-1.db') });
    expect(outcome.status).toBe('converted');
  });

  it('refused while the running lease is not held, before the file is opened', async () => {
    let opened = false;
    const outcome = await convert(memoryMarker(), { open: (f, o) => { opened = true; return open(f, o); }, holdsRunningLease: () => false });
    expect(outcome).toMatchObject({ status: 'deferred', reason: 'running', message: 'This website is running; compaction needs it stopped.' });
    expect(opened).toBe(false);
  });

  it('checks the running lease at entry, after admission and before rewriting', async () => {
    const held = lease();
    expect((await convert(memoryMarker(), { holdsRunningLease: held })).status).toBe('converted');
    expect(held.calls()).toBe(3);
    const lostAfterAdmission = memoryMarker();
    const before = digest(file);
    expect(await convert(lostAfterAdmission, { holdsRunningLease: lease({ failAtCall: 2 }), now: () => 2000 })).toMatchObject({ status: 'deferred', reason: 'running' });
    expect(lostAfterAdmission.written).toEqual([]);
    expect(digest(file)).toBe(before);
    expect(copies()).toEqual(['pre-compact-content-1000.db']);
  });

  it('lease lost before rewriting → deferred, copy kept, file not rewritten', async () => {
    const marker = memoryMarker();
    expect(await convert(marker, { holdsRunningLease: lease({ failAtCall: 3 }) })).toMatchObject({ status: 'deferred', reason: 'running' });
    expect(autoVacuum(file)).toBe(0);
    expect(marker.written.map((m) => m.state)).toEqual(['copying', 'copied']);
    expect(copies()).toEqual(['pre-compact-content-1000.db']);
  });

  it('interrupt then restart completes', async () => {
    const marker = memoryMarker({ failOn: 'rewriting' });
    await expect(convert(marker, { now: () => 5 })).rejects.toThrow(/simulated crash/);
    expect(autoVacuum(file)).toBe(0);
    expect(rows(file)).toEqual({ n: 200 });
    marker.heal();
    const outcome = await convert(marker, { now: () => 9 });
    expect(outcome).toMatchObject({ status: 'converted', recoveryCopyPath: join(dir, 'pre-compact-content-5.db') });
    expect(copies()).toEqual(['pre-compact-content-5.db']);
  });

  it('crash after publish before marker reuses the copy', async () => {
    const marker = memoryMarker({ failOn: 'copied' });
    await expect(convert(marker, { now: () => 5 })).rejects.toThrow(/simulated crash/);
    expect(marker.written.map((m) => m.state)).toEqual(['copying']);
    expect(copies()).toEqual(['pre-compact-content-5.db']);
    marker.heal();
    const outcome = await convert(marker, { now: () => 9 });
    expect(outcome).toMatchObject({ status: 'converted', recoveryCopyPath: join(dir, 'pre-compact-content-5.db') });
    expect(copies()).toEqual(['pre-compact-content-5.db']);
  });

  it('an unverifiable copy left under copying is redone at the same path', async () => {
    const marker = memoryMarker({ failOn: 'copied' });
    await expect(convert(marker, { now: () => 5 })).rejects.toThrow(/simulated crash/);
    await fsp.writeFile(join(dir, 'pre-compact-content-5.db'), 'not a database');
    marker.heal();
    expect(await convert(marker, { now: () => 9 })).toMatchObject({ status: 'converted', recoveryCopyPath: join(dir, 'pre-compact-content-5.db') });
    expect(rows(join(dir, 'pre-compact-content-5.db'))).toEqual({ n: 200 });
  });

  it('interrupt after the rewrite, then restart verifies and records completion', async () => {
    const marker = memoryMarker({ failOn: 'converted' });
    await expect(convert(marker)).rejects.toThrow(/simulated crash/);
    expect(autoVacuum(file)).toBe(2);
    marker.heal();
    expect((await convert(marker)).status).toBe('converted');
    expect(marker.written.at(-1)?.state).toBe('converted');
  });

  it('an already converted file for the same identity is left alone', async () => {
    const marker = memoryMarker();
    await convert(marker);
    const before = digest(file);
    expect((await convert(marker, { now: () => 2000 })).status).toBe('already-converted');
    expect(digest(file)).toBe(before);
  });

  it('a replaced file is converted again rather than reported already converted', async () => {
    const marker = memoryMarker();
    await convert(marker);
    expect((await convert(marker, { fs: { ...nodeFs, identity: async () => 'restored-file' }, now: () => 2000 })).status).toBe('converted');
  });

  it('names the recovery copy apart from pre-migration copies and from the other database', () => {
    expect(compactionRecoveryCopyPath({ filePath: join(dir, 'chat.db'), now: 7 })).toBe(join(dir, 'pre-compact-chat-7.db'));
  });

  it('refuses a recovery copy path that is the database itself or already exists', async () => {
    await expect(convert(memoryMarker(), {}, { recoveryCopyPath: file }))
      .rejects.toThrow('The recovery copy must be a new file next to the database, not the database itself or an existing file.');
  });
});

describe('incrementalVacuumStep', () => {
  async function converted() {
    const marker = memoryMarker();
    await convert(marker);
    const db = keep(new Database(file));
    db.exec('DELETE FROM notes WHERE id > 50'); // whole pages free up (two rows fit a page)
    return { db, marker };
  }
  const step = (db: Database.Database, marker: SqliteCompactionMarkerStore, extraRequired: Partial<Parameters<typeof incrementalVacuumStep>[0]> = {}, optional: Parameters<typeof incrementalVacuumStep>[1] = {}) =>
    incrementalVacuumStep({ db, filePath: file, marker, fs: nodeFs, mono: () => 0, ...extraRequired }, optional);

  it('unconverted file is skipped', async () => {
    expect(await step(keep(new Database(file)), memoryMarker())).toMatchObject({ status: 'skipped', reason: 'not-converted' });
  });

  it('replaced file does not inherit the marker', async () => {
    const { db, marker } = await converted();
    expect(await step(db, marker, { fs: { ...nodeFs, identity: async () => 'restored-file' } })).toMatchObject({ status: 'skipped', reason: 'not-converted' });
  });

  it('report has main and WAL sizes and reclaims at most maxPages', async () => {
    const { db, marker } = await converted();
    const ticks = [100, 140];
    const outcome = await step(db, marker, { mono: () => ticks.shift()! }, { maxPages: 5, minFreeBytes: 0 });
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
    const outcome = await step(db, marker, {}, { minFreeBytes: 0, busyTimeoutMs: 1 });
    writer.exec('ROLLBACK');
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'busy', message: "This website's database is busy; compaction will try again later." });
    expect(db.pragma('busy_timeout', { simple: true })).toBe(4321);
  });

  it('nothing to reclaim below both thresholds', async () => {
    const { db, marker } = await converted();
    expect(await step(db, marker, {}, { minFreeBytes: 1e12, minFreeRatio: 1.1 })).toMatchObject({ status: 'skipped', reason: 'nothing-to-reclaim' });
  });

  it('step inside an open transaction throws', async () => {
    const { db, marker } = await converted();
    db.exec('BEGIN');
    await expect(step(db, marker)).rejects.toThrow('incrementalVacuumStep must run outside a transaction.');
    expect(db.inTransaction).toBe(true);
    db.exec('ROLLBACK');
  });
});
