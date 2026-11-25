/**
 * @module compaction
 *
 * Reclaiming SQLite free pages without a serving-time `VACUUM`, in two separate operations:
 *
 * 1. `convertToIncrementalVacuum` — once per file, on a STOPPED database. Never a migration: the
 *    migration runner wraps each step in a transaction and `VACUUM` cannot run inside one. Order:
 *    running lease → SQLite exclusive admission (proves no other connection, before any byte changes)
 *    → lease again → disk budget → `copying` marker → verified, durably published recovery copy →
 *    `copied` → lease again → `rewriting` → rewrite → check → `converted(dev:ino)`.
 * 2. `incrementalVacuumStep` — the bounded daily step on the host's own coordinated handle; it runs
 *    only for a file whose marker says it was converted AND whose `auto_vacuum` reads 2.
 *
 * The host owns the marker store, the clocks and every filesystem call (ports from
 * `@jini-ai/core/contracts/storage`); this module ships no Node filesystem default. The `./sqlite` entry
 * stays connection-only (no Kysely), so the rewrite check mirrors `kernel/sqlite/ops.ts`'s
 * `compactAndVerify` order instead of building a kernel to call it.
 */
import path from 'node:path';
import type {
  SqliteCompactionFs, SqliteCompactionMarker, SqliteCompactionMarkerStore, SqliteConversionOutcome, SqliteDb,
  SqliteFileSizes, SqliteVacuumStepOutcome,
} from '@jini-ai/core/contracts/storage';
import type { StoppedSqliteOpener } from './stopped.js';
import { copyIsWhole, copySqliteFile, verifyCopy, verifyRewrite, type Admitted } from './compaction-steps.js';

const MiB = 1024 * 1024;
const AUTO_VACUUM_INCREMENTAL = 2;

export const COMPACTION_MESSAGES = {
  running: 'This website is running; compaction needs it stopped.',
  busy: "This website's database is busy; compaction will try again later.",
  needsAttention: "This website's database did not pass its check after compaction. The copy made before compaction was kept; nothing was deleted.",
  notConverted: "This website's database has not been prepared for compaction yet.",
  nothingToReclaim: "This website's database has little free space to reclaim.",
} as const;

const IN_TRANSACTION = 'Compaction must run on its own connection, outside any migration or transaction.';

/** `pre-compact-<db name>-<ms>.db` beside the database: apart from `pre-migrations-*` rotation and per DB. */
export function compactionRecoveryCopyPath({ filePath, now }: { filePath: string; now: number }, _optional: Record<string, never> = {}): string {
  const name = path.basename(filePath, path.extname(filePath));
  return path.join(path.dirname(filePath), `pre-compact-${name}-${now}.db`);
}

type ConvertRequired = {
  filePath: string; open: StoppedSqliteOpener; marker: SqliteCompactionMarkerStore;
  holdsRunningLease: () => boolean; fs: SqliteCompactionFs; now: () => number;
};
type ConvertOptional = { recoveryCopyPath?: string; reserveBytes?: number };
type Job = ConvertRequired & { db: Admitted; prior: SqliteCompactionMarker | undefined; recoveryCopyPath: string; reserveBytes: number };

const deferredRunning = (): SqliteConversionOutcome => ({ status: 'deferred', reason: 'running', message: COMPACTION_MESSAGES.running });

/**
 * One-time conversion of a stopped database file to `auto_vacuum = INCREMENTAL`.
 * Every refusal before the rewrite leaves the file byte-for-byte unchanged. A failed check after the
 * rewrite is recorded as `needs-attention` and is never retried automatically.
 * @param required.holdsRunningLease the host's running-lease probe (the same lease `serve` takes); asked at
 *   entry, after admission and before the rewrite, so a lease lost mid-run stops before any rewrite.
 * @param required.fs the host's filesystem port, including the folder SQLite builds its temp database in.
 * @param _optional.reserveBytes headroom per filesystem on top of the copy, journal and temp budgets (64 MiB).
 * @throws on a handle already inside a transaction; a recovery copy path that is the database or an
 *   existing file; marker-store and fs errors.
 * @complexity O(database bytes): one copy, one rewrite, two integrity checks.
 */
export async function convertToIncrementalVacuum(required: ConvertRequired, _optional: ConvertOptional = {}): Promise<SqliteConversionOutcome> {
  const { reserveBytes = 64 * MiB } = _optional;
  if (!required.holdsRunningLease()) return deferredRunning();
  const prior = await required.marker.read();
  if (prior?.state === 'needs-attention') return { status: 'deferred', reason: 'needs-attention', message: COMPACTION_MESSAGES.needsAttention, recoveryCopyPath: prior.recoveryCopyPath };
  const recoveryCopyPath = await pickRecoveryCopy({ filePath: required.filePath, prior, requested: _optional.recoveryCopyPath, io: required.fs, now: required.now });
  const db = admit({ filePath: required.filePath, open: required.open });
  if (db === undefined) return { status: 'deferred', reason: 'busy', message: COMPACTION_MESSAGES.busy };
  try {
    if (!required.holdsRunningLease()) return deferredRunning();
    return await convertAdmitted({ ...required, db, prior, recoveryCopyPath, reserveBytes });
  } finally { db.close(); }
}

/**
 * Why BOTH a verified copy and exclusive admission: admission proves no other connection (a server, a
 * reader pinning the WAL, a writer) can see or change the file while it is rewritten, so the copy and the
 * rewrite describe the same bytes; the verified, published copy is the way back if the rewrite itself is
 * damaged by a crash or a bug. Admission without a copy leaves no way back; a copy without admission can
 * miss a concurrent writer's commit, so restoring it would silently lose data.
 */
async function convertAdmitted(job: Job): Promise<SqliteConversionOutcome> {
  if (await isAlreadyConverted(job)) return { status: 'already-converted', message: "This website's database is already prepared for compaction." };
  const before = await measure({ db: job.db, filePath: job.filePath, io: job.fs });
  const shortfall = await budget({ ...job, bytes: before.mainBytes + before.walBytes });
  if (shortfall !== undefined) return { status: 'deferred', reason: 'low-disk', message: shortfall };
  await copy(job);
  if (!job.holdsRunningLease()) return deferredRunning();
  const failure = await rewrite(job);
  if (failure !== undefined) return { status: 'deferred', reason: 'needs-attention', message: COMPACTION_MESSAGES.needsAttention, recoveryCopyPath: job.recoveryCopyPath };
  return mark(job, before);
}

async function isAlreadyConverted({ db, prior, filePath, fs }: Job): Promise<boolean> {
  if (db.pragma('auto_vacuum', { simple: true }) !== AUTO_VACUUM_INCREMENTAL || prior?.state !== 'converted') return false;
  return prior.identity === await fs.identity(filePath);
}

/** Reuse the copy an interrupted attempt named (a `copying` path even if not yet written); otherwise a new, unused path. */
async function pickRecoveryCopy(
  { filePath, prior, requested, io, now }: { filePath: string; prior: SqliteCompactionMarker | undefined; requested: string | undefined; io: SqliteCompactionFs; now: () => number },
): Promise<string> {
  if (prior?.state === 'copying') return prior.recoveryCopyPath;
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
 * A handle already inside a transaction is a shared one (a migration's): it is refused untouched and NOT
 * closed, because closing it would roll back its owner's transaction.
 */
function admit({ filePath, open }: { filePath: string; open: StoppedSqliteOpener }): Admitted | undefined {
  const db = open(filePath, { fileMustExist: true, timeout: 0 });
  if (db.inTransaction) throw new Error(IN_TRANSACTION);
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

/**
 * Peak space per distinct filesystem: the new copy (only when none is reusable), the DELETE-mode rollback
 * journal beside the database (up to 1×), and SQLite's temp database for `VACUUM` (1×, in the host's temp
 * folder). Each filesystem touched also keeps `reserveBytes` free.
 */
async function budget(
  { filePath, recoveryCopyPath, bytes, reserveBytes, fs: io }: Job & { bytes: number },
): Promise<string | undefined> {
  const needs = new Map<string, { dir: string; need: number }>();
  const add = async (dir: string, amount: number) => {
    const device = await io.deviceOf(dir);
    const entry = needs.get(device) ?? { dir, need: reserveBytes };
    needs.set(device, { dir: entry.dir, need: entry.need + amount });
  };
  await add(path.dirname(filePath), bytes);
  await add(path.dirname(recoveryCopyPath), (await io.exists(recoveryCopyPath)) ? 0 : bytes);
  await add(io.tempDirectory(), bytes);
  for (const { dir, need } of needs.values()) {
    const free = await io.freeBytes(dir);
    if (free < need) {
      return `There is not enough free disk space to compact this website's database (needs ${Math.ceil(need / MiB)} MB, ${Math.floor(free / MiB)} MB free). Nothing was changed.`;
    }
  }
  return undefined;
}

/**
 * Write-ahead `copying` marker, then `VACUUM INTO` → check → publish, then `copied`. A copy already
 * published under `copied`/`rewriting` must still verify (else throw: nothing is rewritten). One left under
 * `copying` (crash after publish, before `copied`) is reused when whole, otherwise redone at the same path.
 */
async function copy({ db, prior, recoveryCopyPath, marker, fs: io, open, now }: Job): Promise<void> {
  const named = prior?.recoveryCopyPath === recoveryCopyPath && await io.exists(recoveryCopyPath);
  if (named && prior?.state !== 'copying') { verifyCopy({ copyPath: recoveryCopyPath, open }); return; }
  if (named && copyIsWhole({ copyPath: recoveryCopyPath, open })) {
    await marker.write({ state: 'copied', recoveryCopyPath, at: now() });
    return;
  }
  if (named) await io.removeOwn(recoveryCopyPath);
  await marker.write({ state: 'copying', recoveryCopyPath, at: now() });
  await copySqliteFile({ db, targetPath: recoveryCopyPath, io, open });
  await marker.write({ state: 'copied', recoveryCopyPath, at: now() });
}

/** Records `rewriting`, rewrites and checks. A failed check records `needs-attention` (copy kept) and returns why. */
async function rewrite({ db, recoveryCopyPath, marker, now }: Job): Promise<string | undefined> {
  await marker.write({ state: 'rewriting', recoveryCopyPath, at: now() });
  const failure = verifyRewrite({ db, alreadyConverted: db.pragma('auto_vacuum', { simple: true }) === AUTO_VACUUM_INCREMENTAL });
  if (failure !== undefined) await marker.write({ state: 'needs-attention', recoveryCopyPath, at: now(), reason: failure });
  return failure;
}

/** Only after `verifyRewrite` passed (integrity ok, `auto_vacuum` reads 2): `converted`, scoped to this file's identity. */
async function mark({ db, filePath, recoveryCopyPath, marker, fs: io, now }: Job, before: SqliteFileSizes): Promise<SqliteConversionOutcome> {
  await marker.write({ state: 'converted', recoveryCopyPath, at: now(), identity: await io.identity(filePath) });
  return { status: 'converted', recoveryCopyPath, before, after: await measure({ db, filePath, io }), message: "This website's database is now prepared for compaction." };
}

async function measure({ db, filePath, io }: { db: Pick<SqliteDb, 'pragma'>; filePath: string; io: SqliteCompactionFs }): Promise<SqliteFileSizes> {
  return {
    mainBytes: await io.size(filePath),
    walBytes: await io.size(`${filePath}-wal`),
    freePages: Number(db.pragma('freelist_count', { simple: true })),
    pageSize: Number(db.pragma('page_size', { simple: true })),
  };
}

type StepRequired = { db: SqliteDb; filePath: string; marker: SqliteCompactionMarkerStore; fs: SqliteCompactionFs; mono: () => number };
type StepOptional = { maxPages?: number; minFreeRatio?: number; minFreeBytes?: number; busyTimeoutMs?: number };

/**
 * One bounded `incremental_vacuum(maxPages)` on the host's coordinated handle. Runs only for a file
 * converted under its current identity; skips when free space is below BOTH thresholds; a busy or
 * locked database defers to the next pass. The handle's own busy timeout is restored afterwards.
 * @param required.mono the host's monotonic clock, for `elapsedMs`.
 * @throws when called inside a transaction (incremental_vacuum would join it).
 * @complexity O(maxPages) page moves; two metadata reads before and after.
 */
export async function incrementalVacuumStep(required: StepRequired, _optional: StepOptional = {}): Promise<SqliteVacuumStepOutcome> {
  const { db, filePath, marker, fs: io, mono } = required;
  if (db.inTransaction) throw new Error('incrementalVacuumStep must run outside a transaction.');
  if (!(await isConvertedHere({ db, filePath, marker, io }))) {
    return { status: 'skipped', reason: 'not-converted', message: COMPACTION_MESSAGES.notConverted };
  }
  const before = await measure({ db, filePath, io });
  if (!worthReclaiming({ db, before, ..._optional })) {
    return { status: 'skipped', reason: 'nothing-to-reclaim', message: COMPACTION_MESSAGES.nothingToReclaim, before };
  }
  // The awaits above leave a gap in which a foreign `BEGIN` can open on the shared handle; the
  // vacuum would then join that transaction. Re-check with no await before the pragma.
  if (db.inTransaction) return { status: 'skipped', reason: 'busy', message: COMPACTION_MESSAGES.busy, before };
  const started = mono();
  if (!runBoundedVacuum({ db, ..._optional })) return { status: 'skipped', reason: 'busy', message: COMPACTION_MESSAGES.busy, before };
  const after = await measure({ db, filePath, io });
  return {
    status: 'reclaimed', before, after, elapsedMs: mono() - started,
    message: `Reclaimed ${before.freePages - after.freePages} free pages. The file shrinks on disk at the next checkpoint; a long-running reader can delay that.`,
  };
}

/** Converted under THIS file's identity (a restored or replaced file does not inherit it) and `auto_vacuum` reads 2. */
async function isConvertedHere(
  { db, filePath, marker, io }: { db: SqliteDb; filePath: string; marker: SqliteCompactionMarkerStore; io: SqliteCompactionFs },
): Promise<boolean> {
  const recorded = await marker.read();
  if (recorded?.state !== 'converted' || recorded.identity !== await io.identity(filePath)) return false;
  return db.pragma('auto_vacuum', { simple: true }) === AUTO_VACUUM_INCREMENTAL;
}

/** False when there are no free pages, or free space is below BOTH the byte and the ratio threshold. */
function worthReclaiming(
  { db, before, minFreeRatio = 0.2, minFreeBytes = 8 * MiB }: { db: SqliteDb; before: SqliteFileSizes; minFreeRatio?: number; minFreeBytes?: number },
): boolean {
  if (before.freePages === 0) return false;
  const pageCount = Number(db.pragma('page_count', { simple: true }));
  return before.freePages * before.pageSize >= minFreeBytes || before.freePages / pageCount >= minFreeRatio;
}

/** False when SQLite reported busy/locked. The handle's prior busy timeout is restored either way. */
function runBoundedVacuum({ db, maxPages = 2048, busyTimeoutMs = 250 }: { db: SqliteDb; maxPages?: number; busyTimeoutMs?: number }): boolean {
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
