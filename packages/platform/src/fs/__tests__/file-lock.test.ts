import fs from "node:fs";
import * as asyncFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { isLockStale, withFileLockSync, withFileLock, FileLockTimeoutError } from "../file-lock.js";
const roots: string[] = [];
function target(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "inode-lock-")); roots.push(root); return path.join(root, "file.lock"); }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
// REGRESSION: fails if the inode equality term is removed from isLockStale.
test("dead or aged locks are stealable only on the same inode and device", () => {
  const base = { nowMs: 1000, mtimeMs: 0, staleMs: 100, ownerAlive: true, observedInode: 1, currentInode: 1, observedDevice: 3, currentDevice: 3 };
  expect(isLockStale({ ...base })).toBe(true);
  expect(isLockStale({ ...base, currentInode: 2 })).toBe(false);
  expect(isLockStale({ ...base, currentDevice: 4 })).toBe(false);
  expect(isLockStale({ ...base, mtimeMs: 1000, ownerAlive: false })).toBe(true);
  expect(isLockStale({ ...base, mtimeMs: 1000 })).toBe(false);
  expect(isLockStale({ ...base, staleMs: Infinity })).toBe(false);
});
// REGRESSION: fails if the final inode check before sync stale removal is removed.
test("sync contender leaves a freshly replaced stale lock untouched", () => {
  const lockPath = target(); fs.writeFileSync(lockPath, `${process.pid}:old`);
  const old = new Date(Date.now() - 60000); fs.utimesSync(lockPath, old, old);
  const realStat = fs.statSync.bind(fs);
  vi.spyOn(fs, "statSync").mockImplementationOnce(() => {
    // This is the last pre-unlink stat: hold the old inode open to prevent inode reuse.
    const held = fs.openSync(lockPath, "r");
    try { fs.rmSync(lockPath); fs.writeFileSync(lockPath, `${process.pid}:replacement`); return realStat(lockPath); }
    finally { fs.closeSync(held); }
  });
  expect(() => withFileLockSync({ lockPath, run: () => { throw new Error("must not run"); } }, { timeoutMs: 0, staleMs: 100 })).toThrow(FileLockTimeoutError);
  expect(fs.readFileSync(lockPath, "utf8")).toBe(`${process.pid}:replacement`);
});
// PARITY: sync and async entries parse legacy pid:token holders consistently.
test("both entries reclaim a dead legacy owner and leave no owned lock", async () => {
  const lockPath = target(); const options = { process: { pid: process.pid, isAlive: () => false }, timeoutMs: 100, staleMs: 30000 };
  fs.writeFileSync(lockPath, "4242:dead");
  expect(withFileLockSync({ lockPath, run: () => "sync" }, options)).toBe("sync");
  fs.writeFileSync(lockPath, "4242:dead");
  expect(await withFileLock({ lockPath, run: () => "async" }, options)).toBe("async");
  expect(fs.existsSync(lockPath)).toBe(false);
});
// REGRESSION: fails if a partial ownership-write failure leaves the created lock behind.
test("sync partial holder-write failure removes its owned lock", () => {
  const lockPath = target();
  vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { throw new Error("write failed"); });
  expect(() => withFileLockSync({ lockPath, run: () => undefined })).toThrow("write failed");
  expect(fs.existsSync(lockPath)).toBe(false);
});

// REGRESSION: fails if async stale removal skips the pathname stat after descriptor inspection.
test("async contender leaves a replacement made during its final descriptor inspection untouched", async () => {
  const lockPath = target(); fs.writeFileSync(lockPath, `${process.pid}:old`);
  const old = new Date(Date.now() - 60000); fs.utimesSync(lockPath, old, old);
  let reads = 0;
  const filesystem = { ...asyncFs, open: async (target: Parameters<typeof asyncFs.open>[0], flags: Parameters<typeof asyncFs.open>[1], mode?: Parameters<typeof asyncFs.open>[2]) => {
    const handle = await asyncFs.open(target, flags, mode);
    if (flags === "r" && ++reads === 3) {
      // The returned handle keeps the old inode alive while the pathname belongs to a new owner.
      fs.rmSync(lockPath); fs.writeFileSync(lockPath, `${process.pid}:replacement`);
    }
    return handle;
  } };
  await expect(withFileLock({ lockPath, run: () => { throw new Error("must not run"); } }, { filesystem, timeoutMs: 0, staleMs: 100 })).rejects.toThrow(FileLockTimeoutError);
  expect(fs.readFileSync(lockPath, "utf8")).toBe(`${process.pid}:replacement`);
});

// REGRESSION: fails if the wait budget is read from clock.nowMs instead of the monotonicMs option,
// or if stale age stops using clock.nowMs. A live, fresh holder is never stale, so only the
// monotonic reading can end the wait; the wall clock never moves.
test("monotonicMs times the wait while clock.nowMs alone ages the holder", async () => {
  const wallMs = Date.now();
  const options = (reads: { n: number }) => ({
    timeoutMs: 15_000, staleMs: 10_000, pollMs: 1,
    clock: { nowMs: () => wallMs },
    monotonicMs: () => (reads.n++ === 0 ? 500 : 15_500),
  });
  const lockPath = target(); fs.writeFileSync(lockPath, `${process.pid}:live`);
  await expect(withFileLock({ lockPath, run: () => { throw new Error("must not run"); } }, options({ n: 0 })))
    .rejects.toMatchObject({ name: "FileLockTimeoutError", waitedMs: 15_000 });
  expect(() => withFileLockSync({ lockPath, run: () => { throw new Error("must not run"); } }, { ...options({ n: 0 }), sleep: () => {} }))
    .toThrow(expect.objectContaining({ name: "FileLockTimeoutError", waitedMs: 15_000 }));
  expect(fs.readFileSync(lockPath, "utf8")).toBe(`${process.pid}:live`);
  // The same holder, aged past staleMs by the wall clock alone, is reclaimed even though no
  // monotonic time passes.
  const reclaimed = await withFileLock({ lockPath, run: () => "ran" }, { ...options({ n: 0 }), clock: { nowMs: () => wallMs + 60_000 }, monotonicMs: () => 0 });
  expect(reclaimed).toBe("ran");
});
