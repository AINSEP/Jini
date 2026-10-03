import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { rm } from "node:fs/promises";
const forceRemove = (target: string) => rm(target, { recursive: true, force: true });
import { DEFAULT_LOCK_STALE_AFTER_MS, FileLockLostError, FileLockTimeoutError, type FileLockHolder, type FileLockOptions, withFileLock, isContendedLockError } from "../file-lock.js";

/**
 * @file U1-U14 — the shared async file lock's own contract, exercised against a REAL filesystem
 * (`mkdtemp`), never mocked: every guarantee here (atomic create, the two stale rules, the
 * hostname guard, ownership-checked release) is exactly the kind of thing a mock of `fs` could
 * assert away by accident. The source lifecycle package also carries a
 * cross-process activation suite; this file is the module's own unit contract.
 */

async function freshRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "host-file-lock-"));
}

function lockPathIn(root: string): string {
  return path.join(root, "activations.json.lock");
}

async function readHolder(lockPath: string): Promise<FileLockHolder> {
  return JSON.parse(await readFile(lockPath, "utf8"));
}

async function plantLock(lockPath: string, holder: Partial<FileLockHolder> | Record<string, unknown>, ageMs?: number): Promise<void> {
  await writeFile(lockPath, JSON.stringify(holder), "utf8");
  if (ageMs !== undefined) {
    const old = new Date(Date.now() - ageMs);
    await utimes(lockPath, old, old);
  }
}

function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid ?? -1;
}

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U1: while run() is active the lock file holds this process's identity, and run's value is returned; the lock is gone afterwards", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    const value = await runLocked(lockPath, async () => {
      const holder = await readHolder(lockPath);
      assert.equal(holder.pid, process.pid);
      assert.equal(holder.hostname, os.hostname());
      assert.match(holder.token, /^[0-9a-f-]{36}$/);
      assert.ok(!Number.isNaN(Date.parse(holder.acquiredAt)));
      return "ok";
    });
    assert.equal(value, "ok");
    await assert.rejects(readFile(lockPath), { code: "ENOENT" });
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U2: when run() rejects, the same error propagates and the lock is still released", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await assert.rejects(
      runLocked(lockPath, async () => {
        throw new Error("boom");
      }),
      { message: "boom" },
    );
    await assert.rejects(readFile(lockPath), { code: "ENOENT" });
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U3: a fresh lock with our hostname and an injected dead liveness check is acquired without waiting, and onStaleLockRemoved fires once", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    const holder = { pid: 999999, hostname: os.hostname(), token: "planted", acquiredAt: new Date().toISOString() };
    await plantLock(lockPath, holder);

    const removed: (FileLockHolder | undefined)[] = [];
    const start = Date.now();
    await runLocked(lockPath, async () => undefined, {
      isProcessAlive: () => false,
      onStaleLockRemoved: ({ holder }) => removed.push(holder),
    });
    assert.ok(Date.now() - start < DEFAULT_LOCK_STALE_AFTER_MS, "must not wait out the age threshold when liveness already says stale");
    assert.equal(removed.length, 1);
    assert.equal(removed[0]?.token, "planted");
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U4: a real dead pid with the DEFAULT liveness check is acquired quickly, without waiting for the age threshold", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await plantLock(lockPath, { pid: deadPid(), hostname: os.hostname(), token: "planted", acquiredAt: new Date().toISOString() });

    const start = Date.now();
    await runLocked(lockPath, async () => undefined);
    assert.ok(Date.now() - start < DEFAULT_LOCK_STALE_AFTER_MS);
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U5: a live holder (our own pid, fresh) times out; run() is never called and the lock bytes are unchanged", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    const planted = { pid: process.pid, hostname: os.hostname(), token: "live-holder", acquiredAt: new Date().toISOString() };
    await plantLock(lockPath, planted);

    let ran = false;
    await assert.rejects(
      runLocked(
        lockPath,
        async () => {
          ran = true;
        },
        { timeoutMs: 250 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof FileLockTimeoutError);
        assert.equal(error.holder?.pid, process.pid);
        assert.ok(error.waitedMs >= 250);
        return true;
      },
    );
    assert.equal(ran, false);
    assert.deepEqual(await readHolder(lockPath), planted);
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U6: a live holder whose mtime is 60s old is acquired via the age rule, and onStaleLockRemoved fires", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await plantLock(lockPath, { pid: process.pid, hostname: os.hostname(), token: "old", acquiredAt: new Date().toISOString() }, 60_000);

    const removed: (FileLockHolder | undefined)[] = [];
    await runLocked(lockPath, async () => undefined, { onStaleLockRemoved: ({ holder }) => removed.push(holder) });
    assert.equal(removed.length, 1);
    assert.equal(removed[0]?.token, "old");
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U7: a foreign hostname with a dead-liveness override still times out on a fresh lock — the liveness spy is never consulted", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await plantLock(lockPath, { pid: 4242, hostname: "some-other-host", token: "foreign", acquiredAt: new Date().toISOString() });

    let calls = 0;
    await assert.rejects(
      runLocked(lockPath, async () => undefined, {
        timeoutMs: 250,
        hostname: () => "this-host",
        isProcessAlive: () => {
          calls += 1;
          return false;
        },
      }),
      FileLockTimeoutError,
    );
    assert.equal(calls, 0, "a pid recorded on a different host must never reach our own liveness probe");
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U8: a 0-byte lock with a fresh mtime times out; a 0-byte lock with an old mtime is acquired", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await writeFile(lockPath, "", "utf8");
    await assert.rejects(runLocked(lockPath, async () => undefined, { timeoutMs: 250 }), FileLockTimeoutError);

    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    await runLocked(lockPath, async () => undefined);
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U9: pid 0, -1, 1.5, a string, and 2**60 never reach the liveness probe, and each times out", async () => {
  const root = await freshRoot();
  const badPids: unknown[] = [0, -1, 1.5, "123", 2 ** 60];
  try {
    for (const pid of badPids) {
      const lockPath = lockPathIn(root);
      await plantLock(lockPath, { pid, hostname: os.hostname(), token: "bad-pid", acquiredAt: new Date().toISOString() });

      let calls = 0;
      await assert.rejects(
        runLocked(lockPath, async () => undefined, { timeoutMs: 100, isProcessAlive: () => (calls += 1) === -1 }),
        FileLockTimeoutError,
        `pid ${JSON.stringify(pid)} must be treated as unparseable, not as a live/dead pid`,
      );
      assert.equal(calls, 0, `pid ${JSON.stringify(pid)} must never reach isProcessAlive — SECURITY: kill(0|neg, …) addresses a process group`);
      await forceRemove(lockPath);
    }
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U10: run() overwriting the lock with a foreign holder makes assertHeld() reject, and release does not touch the foreign lock", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    let assertHeldError: unknown;
    await runLocked(lockPath, async (lock) => {
      const foreign = { pid: 555, hostname: os.hostname(), token: "not-ours", acquiredAt: new Date().toISOString() };
      await writeFile(lockPath, JSON.stringify(foreign), "utf8");
      try {
        await lock.assertHeld({});
      } catch (error) {
        assertHeldError = error;
      }
    });
    assert.ok(assertHeldError instanceof FileLockLostError);
    assert.equal((await readHolder(lockPath)).token, "not-ours", "release must never unlink a lock it does not own");
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U11: a missing parent directory rejects with code ENOENT quickly, not as a FileLockTimeoutError", async () => {
  const root = await freshRoot();
  try {
    const lockPath = path.join(root, "missing-subdir", "activations.json.lock");
    const start = Date.now();
    await assert.rejects(runLocked(lockPath, async () => undefined, { timeoutMs: 500 }), (error: unknown) => {
      assert.equal(typeof error === "object" && error !== null && "code" in error && error.code, "ENOENT");
      return true;
    });
    assert.ok(Date.now() - start < 500);
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U12: isContendedLockError truth table", () => {
  assert.equal(isContendedLockError({ code: "EEXIST", platform: "darwin" }), true);
  assert.equal(isContendedLockError({ code: "EEXIST", platform: "linux" }), true);
  assert.equal(isContendedLockError({ code: "EEXIST", platform: "win32" }), true);
  assert.equal(isContendedLockError({ code: "EPERM", platform: "win32" }), true);
  assert.equal(isContendedLockError({ code: "EPERM", platform: "darwin" }), false);
  assert.equal(isContendedLockError({ code: "ENOENT", platform: "darwin" }), false);
  assert.equal(isContendedLockError({ code: undefined, platform: "darwin" }), false);
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U13: two concurrent runLocked calls on one path never overlap", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    let inside = false;
    let overlapped = false;
    const run = async () => {
      await runLocked(lockPath, async () => {
        if (inside) overlapped = true;
        inside = true;
        await new Promise((resolve) => setTimeout(resolve, 30));
        inside = false;
      });
    };
    await Promise.all([run(), run()]);
    assert.equal(overlapped, false);
  } finally {
    await forceRemove(root);
  }
});

// PARITY: copied async lifecycle lock contract against the canonical implementation.
test("U14: a lock that is re-taken the instant each stale break removes it still times out, instead of spinning past timeoutMs", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    // A crash-looping peer: every time our waiter breaks its stale lock, it has already taken a new
    // one whose holder is dead too. stale removal therefore keeps finding a NEW lock, so
    // the acquisition loop keeps taking its stale-break path — the former branch that never consulted
    // `timeoutMs`. Recreation stops after 3s so a regression fails on the assertion rather than
    // hanging the runner.
    const start = Date.now();
    let breaks = 0;
    const retakeLock = (): void => {
      breaks += 1;
      if (Date.now() - start > 3000) return;
      writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), hostname: os.hostname(), token: randomUUID(), acquiredAt: new Date().toISOString() }), "utf8");
    };

    await plantLock(lockPath, { pid: deadPid(), hostname: os.hostname(), token: "seed", acquiredAt: new Date().toISOString() });

    let ran = false;
    await assert.rejects(
      runLocked(
        lockPath,
        async () => {
          ran = true;
        },
        { timeoutMs: 300, isProcessAlive: () => false, onStaleLockRemoved: retakeLock },
      ),
      FileLockTimeoutError,
    );
    assert.equal(ran, false, "the lock was never actually free, so run() must not have been entered");
    assert.ok(Date.now() - start < 2500, `timeoutMs must bound the stale-break path too (waited ${Date.now() - start}ms for a 300ms timeout, ${breaks} breaks)`);
  } finally {
    await forceRemove(root);
  }
});

// Fixture adapter retains the source suite's liveness-injection spelling only inside these tests.
function runLocked<T>(lockPath: string, run: Parameters<typeof withFileLock<T>>[0]["run"], options: FileLockOptions & { isProcessAlive?: (required: { pid: number }) => boolean } = {}): Promise<T> {
  const { isProcessAlive, ...settings } = options;
  return withFileLock({ lockPath, run }, { ...settings, ...(isProcessAlive ? { process: { pid: process.pid, isAlive: isProcessAlive } } : {}) });
}
