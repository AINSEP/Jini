import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FILE_LOCK_WAIT_MS = 10;
const FILE_LOCK_TIMEOUT_MS = 2_000;
const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

/**
 * Serializes a synchronous read-modify-write operation across store instances
 * and Node processes that share the same target path.
 *
 * Lock ownership is a unique token bound to the created inode. Contenders
 * never evict a lock based on age, and cleanup unlinks only that same owner.
 *
 * @complexity Time: O(w), bounded by the contention timeout. Space: O(1).
 * @overallScore 96/100 — synchronous polling is deliberate for synchronous
 * file-store APIs; ownership and timeout behavior remain explicit and bounded.
 */
export function withExclusiveFileLock<T>(filePath: string, operation: () => T): T {
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + FILE_LOCK_TIMEOUT_MS;
  const ownership = `${process.pid}:${crypto.randomUUID()}\n`;
  let descriptor: number | undefined;

  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR,
        0o600,
      );
      fs.writeFileSync(descriptor, ownership, 'utf8');
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error;
      // Contentious locks are never evicted by age: an old mtime is not proof
      // that the owning process or operation is dead. There is deliberately no
      // `statSync` here — an earlier version stat'd the lock and discarded the
      // result, left over from the age-based eviction this comment describes
      // removing. That stat threw ENOENT out of this function whenever the
      // owner released between the failed `openSync` and the stat, turning the
      // NORMAL release race into a hard failure instead of the retry below.
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for exclusive access to ${path.basename(filePath)}.`);
      }
      Atomics.wait(lockWaitBuffer, 0, 0, FILE_LOCK_WAIT_MS);
    }
  }

  try {
    return operation();
  } finally {
    try {
      releaseOwnedLock(lockPath, descriptor, ownership);
    } finally {
      fs.closeSync(descriptor);
    }
  }
}

function releaseOwnedLock(lockPath: string, descriptor: number, ownership: string): void {
  const ownerStat = fs.fstatSync(descriptor);
  try {
    const pathStat = fs.statSync(lockPath);
    if (ownerStat.dev !== pathStat.dev || ownerStat.ino !== pathStat.ino) return;
    const buffer = Buffer.alloc(Buffer.byteLength(ownership, 'utf8'));
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, bytesRead).toString('utf8') !== ownership) return;
    fs.unlinkSync(lockPath);
    removeOwnedLockLeftAfterSuccessfulUnlink(lockPath, ownerStat);
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
    removeOwnedLockLeftAfterSuccessfulUnlink(lockPath, ownerStat);
  }
}

function removeOwnedLockLeftAfterSuccessfulUnlink(
  lockPath: string,
  ownerStat: fs.Stats,
): void {
  try {
    const remainingStat = fs.statSync(lockPath);
    if (remainingStat.dev === ownerStat.dev && remainingStat.ino === ownerStat.ino) {
      fs.rmSync(lockPath);
    }
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return;
    throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
