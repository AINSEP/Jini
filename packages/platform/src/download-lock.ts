import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isProcessAlive } from "./process.js";
import { type DownloadLockFile, type NormalizedTarget, type AcquiredLock, ManagedDownloadError, MANAGED_DOWNLOAD_ERROR_CODES } from './download-types.js';
import { isPlainObject, errorCode, readJson } from './download-store.js';
const PID_REUSE_GRACE_MS = 1000;
const PROCESS_STARTED_AT_MS = Date.now() - process.uptime() * 1000;

function isDownloadLockFile(value: unknown): value is DownloadLockFile {
  if (!isPlainObject(value)) return false;
  const record = value as Partial<DownloadLockFile>;
  const validPid = typeof record.pid === "number" && Number.isInteger(record.pid) && record.pid > 0;
  const validStartedAt = record.processStartedAt == null || typeof record.processStartedAt === "string";
  return typeof record.createdAt === "string" && validPid && validStartedAt;
}

function parseTimeMs(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function lockBelongsToCurrentProcess(lock: DownloadLockFile): boolean {
  // Its only caller (`isLockProcessAlive`) already gates this call behind
  // `lock.pid === process.pid`, so that comparison can never be true here —
  // no redundant re-check.
  const ownerStartedAtMs = parseTimeMs(lock.processStartedAt);
  if (ownerStartedAtMs != null) return ownerStartedAtMs >= PROCESS_STARTED_AT_MS - PID_REUSE_GRACE_MS;

  // Older locks only carried a pid. If Windows reuses that pid for this
  // process, a lock that predates this process start is definitely stale.
  const lockCreatedAtMs = parseTimeMs(lock.createdAt);
  return lockCreatedAtMs == null || lockCreatedAtMs >= PROCESS_STARTED_AT_MS - PID_REUSE_GRACE_MS;
}

function isLockProcessAlive(lock: DownloadLockFile): boolean {
  if (!isProcessAlive(lock.pid)) return false;
  if (lock.pid === process.pid) return lockBelongsToCurrentProcess(lock);
  return true;
}

export async function acquireLock(target: NormalizedTarget): Promise<AcquiredLock> {
  await mkdir(dirname(target.lockPath), { recursive: true });
  // At most two create attempts: the second only after the first hit an
  // existing lock that `clearStaleLock` proved stale and removed; a second
  // EEXIST is real contention. (This was formerly a `for (;;)` loop whose
  // fall-through branch V8 instrumented but no path could take — see archived
  // provenance ledger's 2026-07-22 entry; the straight-line form has none.)
  if (await tryCreateLockFile(target)) return { path: target.lockPath };
  if (await clearStaleLock(target) && await tryCreateLockFile(target)) return { path: target.lockPath };
  throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.TARGET_LOCKED, `download target is locked: ${target.bucket}/${target.fileName}`);
}

/** Exclusively create the lock file; `false` when one already exists, any other failure is rethrown. */
async function tryCreateLockFile(target: NormalizedTarget): Promise<boolean> {
  try {
    await writeFile(
      target.lockPath,
      `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        processStartedAt: new Date(PROCESS_STARTED_AT_MS).toISOString(),
      } satisfies DownloadLockFile)}\n`,
      { flag: "wx" },
    );
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

async function clearStaleLock(target: NormalizedTarget): Promise<boolean> {
  const lock = await readJson<unknown>(target.lockPath);
  if (!isDownloadLockFile(lock) || isLockProcessAlive(lock)) return false;
  await rm(target.lockPath, { force: true }).catch(() => undefined);
  return true;
}

export async function releaseLock(lock: AcquiredLock | null): Promise<void> {
  if (lock == null) return;
  await rm(lock.path, { force: true }).catch(() => undefined);
}
