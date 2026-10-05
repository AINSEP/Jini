// PARITY: shared async lock retains lifecycle contention, stale-owner and ownership contracts.
import assert from "node:assert/strict";
import { isContendedLockError, withFileLock } from "../test-support.js";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { forceRemove } from "../fixtures/force-remove.js";
import { DEFAULT_LOCK_STALE_AFTER_MS, FileLockLostError, FileLockTimeoutError, type FileLockHolder } from "@jini-ai/platform/fs/file-lock";

/**
 * @file U1-U14 — `platform/fs/file-lock`'s own contract, exercised against a REAL filesystem
 * (`mkdtemp`), never mocked: every guarantee here (atomic create, the two stale rules, the
 * hostname guard, ownership-checked release) is exactly the kind of thing a mock of `fs` could
 * assert away by accident. See `activation-cross-process-writes.integration.test.ts` for the
 * cross-process proof that USES this module; this file is the module's own unit contract.
 */

async function freshRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "host-file-lock-"));
}

function lockPathIn(root: string): string {
  return path.join(root, "activations.json.lock");
}

async function readHolder(lockPath: string): Promise<FileLockHolder> {
  return JSON.parse(await readFile(lockPath, "utf8")) as FileLockHolder;
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

test("U1: while run() is active the lock file holds this process's identity, and run's value is returned; the lock is gone afterwards", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    const value = await withFileLock({ lockPath: lockPath, run: async () => {
      const holder = await readHolder(lockPath);
      assert.equal(holder.pid, process.pid);
      assert.equal(holder.hostname, os.hostname());
      assert.match(holder.token, /^[0-9a-f-]{36}$/);
      assert.ok(!Number.isNaN(Date.parse(holder.acquiredAt)));
      return "ok";
    } }, { timeoutMs: 15_000, staleMs: 10_000 });
    assert.equal(value, "ok");
    await assert.rejects(readFile(lockPath), { code: "ENOENT" });
  } finally {
    await forceRemove(root);
  }
});

test("U2: when run() rejects, the same error propagates and the lock is still released", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await assert.rejects(
      withFileLock({ lockPath: lockPath, run: async () => {
        throw new Error("boom");
      } }, { timeoutMs: 15_000, staleMs: 10_000 }),
      { message: "boom" },
    );
    await assert.rejects(readFile(lockPath), { code: "ENOENT" });
  } finally {
    await forceRemove(root);
  }
});

test("U3: a fresh lock with our hostname and an injected dead liveness check is acquired without waiting, and onStaleLockRemoved fires once", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    const holder = { pid: 999999, hostname: os.hostname(), token: "planted", acquiredAt: new Date().toISOString() };
    await plantLock(lockPath, holder);

    const removed: (FileLockHolder | undefined)[] = [];
    const start = Date.now();
    await withFileLock({ lockPath: lockPath, run: async () => undefined }, { timeoutMs: 15_000, staleMs: 10_000, process: { pid: process.pid, isAlive: () => false }, onStaleLockRemoved: ({ holder }) => removed.push(holder) });
    assert.ok(Date.now() - start < DEFAULT_LOCK_STALE_AFTER_MS, "must not wait out the age threshold when liveness already says stale");
    assert.equal(removed.length, 1);
    assert.equal(removed[0]?.token, "planted");
  } finally {
    await forceRemove(root);
  }
});

test("U4: a real dead pid with the DEFAULT liveness check is acquired quickly, without waiting for the age threshold", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await plantLock(lockPath, { pid: deadPid(), hostname: os.hostname(), token: "planted", acquiredAt: new Date().toISOString() });

    const start = Date.now();
    await withFileLock({ lockPath: lockPath, run: async () => undefined }, { timeoutMs: 15_000, staleMs: 10_000 });
    assert.ok(Date.now() - start < DEFAULT_LOCK_STALE_AFTER_MS);
  } finally {
    await forceRemove(root);
  }
});

test("U5: a live holder (our own pid, fresh) times out; run() is never called and the lock bytes are unchanged", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    const planted = { pid: process.pid, hostname: os.hostname(), token: "live-holder", acquiredAt: new Date().toISOString() };
    await plantLock(lockPath, planted);

    let ran = false;
    await assert.rejects(
      withFileLock({ lockPath: lockPath, run: async () => {
          ran = true;
        } }, { timeoutMs: 250, staleMs: 10_000 }),
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

test("U6: a live holder whose mtime is 60s old is acquired via the age rule, and onStaleLockRemoved fires", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await plantLock(lockPath, { pid: process.pid, hostname: os.hostname(), token: "old", acquiredAt: new Date().toISOString() }, 60_000);

    const removed: (FileLockHolder | undefined)[] = [];
    await withFileLock({ lockPath: lockPath, run: async () => undefined }, { timeoutMs: 15_000, staleMs: 10_000, onStaleLockRemoved: ({ holder }) => removed.push(holder) });
    assert.equal(removed.length, 1);
    assert.equal(removed[0]?.token, "old");
  } finally {
    await forceRemove(root);
  }
});

test("U7: a foreign hostname with a dead-liveness override still times out on a fresh lock — the liveness spy is never consulted", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await plantLock(lockPath, { pid: 4242, hostname: "some-other-host", token: "foreign", acquiredAt: new Date().toISOString() });

    let calls = 0;
    await assert.rejects(
      withFileLock({ lockPath: lockPath, run: async () => undefined }, { timeoutMs: 250, staleMs: 10_000, hostname: () => "this-host", process: { pid: process.pid, isAlive: () => {
          calls += 1;
          return false;
        } } }),
      FileLockTimeoutError,
    );
    assert.equal(calls, 0, "a pid recorded on a different host must never reach our own liveness probe");
  } finally {
    await forceRemove(root);
  }
});

test("U8: a 0-byte lock with a fresh mtime times out; a 0-byte lock with an old mtime is acquired", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    await writeFile(lockPath, "", "utf8");
    await assert.rejects(withFileLock({ lockPath: lockPath, run: async () => undefined }, { timeoutMs: 250, staleMs: 10_000 }), FileLockTimeoutError);

    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    await withFileLock({ lockPath: lockPath, run: async () => undefined }, { timeoutMs: 15_000, staleMs: 10_000 });
  } finally {
    await forceRemove(root);
  }
});

test("U9: pid 0, -1, 1.5, a string, and 2**60 never reach the liveness probe, and each times out", async () => {
  const root = await freshRoot();
  const badPids: unknown[] = [0, -1, 1.5, "123", 2 ** 60];
  try {
    for (const pid of badPids) {
      const lockPath = lockPathIn(root);
      await plantLock(lockPath, { pid, hostname: os.hostname(), token: "bad-pid", acquiredAt: new Date().toISOString() });

      let calls = 0;
      await assert.rejects(
        withFileLock({ lockPath: lockPath, run: async () => undefined }, { timeoutMs: 100, staleMs: 10_000, process: { pid: process.pid, isAlive: () => (calls += 1) === -1 } }),
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

test("U10: run() overwriting the lock with a foreign holder makes assertHeld() reject, and release does not touch the foreign lock", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    let assertHeldError: unknown;
    await withFileLock({ lockPath: lockPath, run: async (lock) => {
      const foreign = { pid: 555, hostname: os.hostname(), token: "not-ours", acquiredAt: new Date().toISOString() };
      await writeFile(lockPath, JSON.stringify(foreign), "utf8");
      try {
        await lock.assertHeld({});
      } catch (error) {
        assertHeldError = error;
      }
    } }, { timeoutMs: 15_000, staleMs: 10_000 });
    assert.ok(assertHeldError instanceof FileLockLostError);
    assert.equal((await readHolder(lockPath)).token, "not-ours", "release must never unlink a lock it does not own");
  } finally {
    await forceRemove(root);
  }
});

test("U11: a missing parent directory rejects with code ENOENT quickly, not as a FileLockTimeoutError", async () => {
  const root = await freshRoot();
  try {
    const lockPath = path.join(root, "missing-subdir", "activations.json.lock");
    const start = Date.now();
    await assert.rejects(withFileLock({ lockPath: lockPath, run: async () => undefined }, { timeoutMs: 500, staleMs: 10_000 }), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });
    assert.ok(Date.now() - start < 500);
  } finally {
    await forceRemove(root);
  }
});

test("U12: isContendedLockError truth table", () => {
  assert.equal(isContendedLockError({ code: "EEXIST", platform: "darwin" }), true);
  assert.equal(isContendedLockError({ code: "EEXIST", platform: "linux" }), true);
  assert.equal(isContendedLockError({ code: "EEXIST", platform: "win32" }), true);
  assert.equal(isContendedLockError({ code: "EPERM", platform: "win32" }), true);
  assert.equal(isContendedLockError({ code: "EPERM", platform: "darwin" }), false);
  assert.equal(isContendedLockError({ code: "ENOENT", platform: "darwin" }), false);
  assert.equal(isContendedLockError({ code: undefined, platform: "darwin" }), false);
});

test("U13: a second withFileLock call stays outside while the first holds the lock, and enters only after release", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    const events: string[] = [];
    // A barrier, not a sleep: the first critical section stays open until the second acquirer has
    // demonstrably polled a contended lock three times (or, if exclusion is broken, until the second
    // run() itself starts). A timer-based hold could close before the second call ever contends.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const firstEntered = new Promise<void>((resolve) => { entered = resolve; });
    let polls = 0;
    const first = withFileLock({ lockPath: lockPath, run: async () => {
      events.push("first-in");
      entered();
      await held;
      events.push("first-out");
    } }, { timeoutMs: 15_000, staleMs: 10_000 });
    await firstEntered;
    const second = withFileLock({ lockPath: lockPath, run: async () => {
      events.push("second-in");
      release();
    } }, { timeoutMs: 15_000, staleMs: 10_000, pollMs: 1, sleep: async ({ durationMs }) => {
      polls += 1;
      if (polls === 3) release();
      await new Promise((resolve) => setTimeout(resolve, durationMs));
    } });
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first-in", "first-out", "second-in"]);
    assert.ok(polls >= 3, `the second call must have waited on the held lock (polled ${polls} times)`);
  } finally {
    await forceRemove(root);
  }
});

test("U14: a lock that is re-taken the instant each stale break removes it still times out, instead of spinning past timeoutMs", async () => {
  const root = await freshRoot();
  try {
    const lockPath = lockPathIn(root);
    // A crash-looping peer: every time our waiter breaks its stale lock, it has already taken a new
    // one whose holder is dead too. `removeLockIfUnchanged` therefore keeps finding a NEW lock, so
    // the acquisition loop keeps taking its stale-break path — the one branch that never consulted
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
      withFileLock({ lockPath: lockPath, run: async () => {
          ran = true;
        } }, { timeoutMs: 300, staleMs: 10_000, process: { pid: process.pid, isAlive: () => false }, onStaleLockRemoved: retakeLock }),
      FileLockTimeoutError,
    );
    assert.equal(ran, false, "the lock was never actually free, so run() must not have been entered");
    assert.ok(Date.now() - start < 2500, `timeoutMs must bound the stale-break path too (waited ${Date.now() - start}ms for a 300ms timeout, ${breaks} breaks)`);
  } finally {
    await forceRemove(root);
  }
});
