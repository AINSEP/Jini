/**
 * @module compaction
 *
 * Reclaiming SQLite free pages without a serving-time `VACUUM`, in two separate operations:
 *
 * 1. `convertToIncrementalVacuum` — once per file, on a STOPPED database. Never a migration: the
 *    migration runner wraps each step in a transaction and `VACUUM` cannot run inside one. Order:
 *    running lease → SQLite exclusive admission (proves no other connection, before any byte changes)
 *    → disk budget → verified, durably published recovery copy → rewrite → check → marker.
 * 2. `incrementalVacuumStep` — the bounded daily step on the host's own coordinated handle; it runs
 *    only for a file whose marker says it was converted AND whose `auto_vacuum` reads 2.
 *
 * The host owns the marker store and every filesystem call (ports from `@jini-ai/core/contracts/storage`).
 * The `./sqlite` entry stays connection-only (no Kysely), so the rewrite check below mirrors
 * `kernel/sqlite/ops.ts`'s `compactAndVerify` order instead of building a kernel to call it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  SqliteCompactionFs, SqliteCompactionMarker, SqliteCompactionMarkerStore, SqliteConversionOutcome, SqliteDb,
  SqliteFileSizes, SqliteVacuumStepOutcome,
} from '@jini-ai/core/contracts/storage';
import type { StoppedSqliteOpener } from './stopped.js';
import { copySqliteFile, verifyCopy, verifyRewrite, type Admitted } from './compaction-steps.js';

const MB = 1024 * 1024;
const AUTO_VACUUM_INCREMENTAL = 2;

export const COMPACTION_MESSAGES = {
  running: 'This website is running; compaction needs it stopped.',
  busy: "This website's database is busy; compaction will try again later.",
  needsAttention: "This website's database did not pass its check after compaction. The copy made before compaction was kept; nothing was deleted.",
  notConverted: "This website's database has not been prepared for compaction yet.",
  nothingToReclaim: "This website's database has little free space to reclaim.",
} as const;

/** Node's filesystem behind the compaction port. `freeBytes` counts blocks available to this user. */
export const nodeCompactionFs: SqliteCompactionFs = {
  size: async (file) => fs.stat(file).then((s) => s.size, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }),
  exists: async (file) => fs.lstat(file).then(() => true, () => false),
  freeBytes: async (directory) => fs.statfs(directory).then((s) => s.bavail * s.bsize),
  deviceOf: async (directory) => String((await fs.stat(directory)).dev),
  identity: async (file) => { const s = await fs.stat(file); return `${s.dev}:${s.ino}`; },
  publish: async (from, to) => {
    await fs.rename(from, to);
    // Flush the folder so the rename itself survives a power cut before the rewrite starts.
    const folder = await fs.open(path.dirname(to), 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  },
  removeOwn: async (file) => fs.rm(file, { force: true }),
};

/** `pre-compact-<db name>-<ms>.db` beside the database: apart from `pre-migrations-*` rotation and per DB. */
export function compactionRecoveryCopyPath({ filePath, now }: { filePath: string; now: number }, _optional: Record<string, never> = {}): string {
  const name = path.basename(filePath, path.extname(filePath));
  return path.join(path.dirname(filePath), `pre-compact-${name}-${now}.db`);
}

type ConvertRequired = { filePath: string; open: StoppedSqliteOpener; marker: SqliteCompactionMarkerStore; holdsRunningLease: () => boolean };
type ConvertOptional = { recoveryCopyPath?: string; reserveBytes?: number; fs?: SqliteCompactionFs; now?: () => number };

/**
 * One-time conversion of a stopped database file to `auto_vacuum = INCREMENTAL`.
 * Every refusal before the rewrite leaves the file byte-for-byte unchanged. A failed check after the
 * rewrite is recorded as `needs-attention` and is never retried automatically.
 * @param required.holdsRunningLease the host's running-lease probe (the same lease `serve` takes).
 * @param _optional.reserveBytes headroom on top of the copy and rewrite budgets (default 64 MB).
 * @throws a recovery copy path that is the database or an existing file; marker-store and fs errors.
 * @complexity O(database bytes): one copy, one rewrite, two integrity checks.
 */
export async function convertToIncrementalVacuum(required: ConvertRequired, _optional: ConvertOptional = {}): Promise<SqliteConversionOutcome> {
  const { fs: io = nodeCompactionFs, now = () => Date.now(), reserveBytes = 64 * MB } = _optional;
  if (!required.holdsRunningLease()) return { status: 'deferred', reason: 'running', message: COMPACTION_MESSAGES.running };
  const prior = await required.marker.read();
  if (prior?.state === 'needs-attention') return { status: 'deferred', reason: 'needs-attention', message: COMPACTION_MESSAGES.needsAttention, recoveryCopyPath: prior.recoveryCopyPath };
  const recoveryCopyPath = await pickRecoveryCopy({ filePath: required.filePath, prior, requested: _optional.recoveryCopyPath, io, now });
  const db = admit({ filePath: required.filePath, open: required.open });
  if (db === undefined) return { status: 'deferred', reason: 'busy', message: COMPACTION_MESSAGES.busy };
  try {
    return await convertAdmitted({ db, required, recoveryCopyPath, prior }, { io, now, reserveBytes });
  } finally { db.close(); }
}

async function convertAdmitted(
  { db, required, recoveryCopyPath, prior }: { db: Admitted; required: ConvertRequired; recoveryCopyPath: string; prior: SqliteCompactionMarker | undefined },
  { io, now, reserveBytes }: { io: SqliteCompactionFs; now: () => number; reserveBytes: number },
): Promise<SqliteConversionOutcome> {
  const { filePath, marker } = required;
  if (db.pragma('auto_vacuum', { simple: true }) === AUTO_VACUUM_INCREMENTAL && prior?.state === 'converted' && prior.identity === await io.identity(filePath)) {
    return { status: 'already-converted', message: 'This website\'s database is already prepared for compaction.' };
  }
  const before = await measure({ db, filePath, io });
  const shortfall = await diskShortfall({ filePath, recoveryCopyPath, bytes: before.mainBytes + before.walBytes, reserveBytes, io });
  if (shortfall !== undefined) return { status: 'deferred', reason: 'low-disk', message: shortfall };
  if (!(await io.exists(recoveryCopyPath))) {
    await copySqliteFile({ db, targetPath: recoveryCopyPath, io, open: required.open });
    await marker.write({ state: 'copied', recoveryCopyPath, at: now() });
  } else {
    verifyCopy({ copyPath: recoveryCopyPath, open: required.open });
  }
  await marker.write({ state: 'rewriting', recoveryCopyPath, at: now() });
  const failure = verifyRewrite({ db, alreadyConverted: db.pragma('auto_vacuum', { simple: true }) === AUTO_VACUUM_INCREMENTAL });
  if (failure !== undefined) {
    await marker.write({ state: 'needs-attention', recoveryCopyPath, at: now(), reason: failure });
    return { status: 'deferred', reason: 'needs-attention', message: COMPACTION_MESSAGES.needsAttention, recoveryCopyPath };
  }
  await marker.write({ state: 'converted', recoveryCopyPath, at: now(), identity: await io.identity(filePath) });
  return { status: 'converted', recoveryCopyPath, before, after: await measure({ db, filePath, io }), message: 'This website\'s database is now prepared for compaction.' };
}

/** Reuse the copy an interrupted attempt already published; otherwise a new, unused path. */
async function pickRecoveryCopy(
  { filePath, prior, requested, io, now }: { filePath: string; prior: SqliteCompactionMarker | undefined; requested: string | undefined; io: SqliteCompactionFs; now: () => number },
): Promise<string> {
  if (prior !== undefined && prior.state !== 'converted' && await io.exists(prior.recoveryCopyPath)) return prior.recoveryCopyPath;
  const chosen = requested ?? compactionRecoveryCopyPath({ filePath, now: now() });
  if (path.resolve(chosen) === path.resolve(filePath) || await io.exists(chosen)) {
    throw new Error('The recovery copy must be a new file next to the database, not the database itself or an existing file.');
  }
  return chosen;
}

/**
 * SQLite's exclusive lock is the admission proof: in WAL mode every open connection (an idle one, a
 * reader pinning the WAL, a writer) holds a shared lock, so `BEGIN EXCLUSIVE` under EXCLUSIVE locking
 * mode fails at once with SQLITE_BUSY. Once taken, the lock is held until close, fencing out every
 * other connection for the whole copy + rewrite. Nothing has been written when this refuses.
 */
function admit({ filePath, open }: { filePath: string; open: StoppedSqliteOpener }): Admitted | undefined {
  const db = open(filePath, { fileMustExist: true, timeout: 0 });
  try {
    db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; ROLLBACK;');
    return db;
  } catch (error) {
    db.close();
    if (isBusy(error)) return undefined;
    throw error;
  }
}

function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'));
}

async function diskShortfall(
  { filePath, recoveryCopyPath, bytes, reserveBytes, io }: { filePath: string; recoveryCopyPath: string; bytes: number; reserveBytes: number; io: SqliteCompactionFs },
): Promise<string | undefined> {
  const dbDir = path.dirname(filePath);
  const copyDir = path.dirname(recoveryCopyPath);
  // The copy and the rewrite workspace (WAL growth, temp file) each need one full size.
  const sameFs = await io.deviceOf(dbDir) === await io.deviceOf(copyDir);
  const checks = sameFs ? [{ dir: dbDir, need: 2 * bytes + reserveBytes }] : [{ dir: dbDir, need: bytes + reserveBytes }, { dir: copyDir, need: bytes + reserveBytes }];
  for (const { dir, need } of checks) {
    const free = await io.freeBytes(dir);
    if (free < need) {
      return `There is not enough free disk space to compact this website's database (needs ${Math.ceil(need / MB)} MB, ${Math.floor(free / MB)} MB free). Nothing was changed.`;
    }
  }
  return undefined;
}

async function measure({ db, filePath, io }: { db: Pick<SqliteDb, 'pragma'>; filePath: string; io: SqliteCompactionFs }): Promise<SqliteFileSizes> {
  return {
    mainBytes: await io.size(filePath),
    walBytes: await io.size(`${filePath}-wal`),
    freePages: Number(db.pragma('freelist_count', { simple: true })),
    pageSize: Number(db.pragma('page_size', { simple: true })),
  };
}

type StepRequired = { db: SqliteDb; filePath: string; marker: SqliteCompactionMarkerStore };
type StepOptional = { maxPages?: number; minFreeRatio?: number; minFreeBytes?: number; busyTimeoutMs?: number; fs?: SqliteCompactionFs; now?: () => number };

/**
 * One bounded `incremental_vacuum(maxPages)` on the host's coordinated handle. Runs only for a file
 * converted under its current identity; skips when free space is below BOTH thresholds; a busy or
 * locked database defers to the next pass. The handle's own busy timeout is restored afterwards.
 * @throws when called inside a transaction (incremental_vacuum would join it).
 * @complexity O(maxPages) page moves; two metadata reads before and after.
 */
export async function incrementalVacuumStep(required: StepRequired, _optional: StepOptional = {}): Promise<SqliteVacuumStepOutcome> {
  const options = stepOptions(_optional);
  const { db, filePath } = required;
  if (db.inTransaction) throw new Error('incrementalVacuumStep must run outside a transaction.');
  if (!(await isConverted({ ...required, io: options.io }))) {
    return { status: 'skipped', reason: 'not-converted', message: COMPACTION_MESSAGES.notConverted };
  }
  const before = await measure({ db, filePath, io: options.io });
  if (!worthReclaiming({ db, before, ...options })) {
    return { status: 'skipped', reason: 'nothing-to-reclaim', message: COMPACTION_MESSAGES.nothingToReclaim, before };
  }
  const started = options.now();
  if (!runBounded({ db, maxPages: options.maxPages, busyTimeoutMs: options.busyTimeoutMs })) {
    return { status: 'skipped', reason: 'busy', message: COMPACTION_MESSAGES.busy, before };
  }
  const after = await measure({ db, filePath, io: options.io });
  return {
    status: 'reclaimed', before, after, elapsedMs: options.now() - started,
    message: `Reclaimed ${before.freePages - after.freePages} free pages. The file shrinks on disk at the next checkpoint; a long-running reader can delay that.`,
  };
}

function stepOptions({ maxPages = 2048, minFreeRatio = 0.2, minFreeBytes = 8 * MB, busyTimeoutMs = 250, fs: io = nodeCompactionFs, now = () => Date.now() }: StepOptional) {
  return { maxPages, minFreeRatio, minFreeBytes, busyTimeoutMs, io, now };
}

/** Both proofs: the marker names this exact file, and SQLite itself reports incremental mode. */
async function isConverted({ db, filePath, marker, io }: StepRequired & { io: SqliteCompactionFs }): Promise<boolean> {
  const recorded = await marker.read();
  if (recorded?.state !== 'converted' || recorded.identity !== await io.identity(filePath)) return false;
  return db.pragma('auto_vacuum', { simple: true }) === AUTO_VACUUM_INCREMENTAL;
}

function worthReclaiming({ db, before, minFreeBytes, minFreeRatio }: { db: SqliteDb; before: SqliteFileSizes; minFreeBytes: number; minFreeRatio: number }): boolean {
  if (before.freePages === 0) return false;
  const pageCount = Number(db.pragma('page_count', { simple: true }));
  return before.freePages * before.pageSize >= minFreeBytes || before.freePages / pageCount >= minFreeRatio;
}

/** @returns false when SQLite reported busy/locked; the handle's own busy timeout is always restored. */
function runBounded({ db, maxPages, busyTimeoutMs }: { db: SqliteDb; maxPages: number; busyTimeoutMs: number }): boolean {
  const previousTimeout = db.pragma('busy_timeout', { simple: true });
  db.pragma(`busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`);
  try {
    db.pragma(`incremental_vacuum(${Math.max(1, Math.floor(maxPages))})`);
    return true;
  } catch (error) {
    if (!isBusy(error)) throw error;
    return false;
  } finally {
    db.pragma(`busy_timeout = ${Number(previousTimeout)}`);
  }
}
