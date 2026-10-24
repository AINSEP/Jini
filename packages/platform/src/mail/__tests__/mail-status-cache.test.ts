import assert from "node:assert/strict";
import { test } from "vitest";
import { createTtlCache } from "../mail-status-cache.js";
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("cold readers share a load, expiry reloads, and rejection permits retry", async () => {
  let now = 0; const first = deferred<string>(); const second = deferred<string>(); const third = deferred<string>();
  const loads = [first, second, third]; let n = 0;
  const cache = createTtlCache({ load: () => loads[n++]!.promise, nowMs: () => now, ttlMs: 10 });
  const a = cache.get(), b = cache.get(); first.resolve("first");
  assert.deepEqual(await Promise.all([a, b]), ["first", "first"]);
  now = 9; assert.equal(await cache.get(), "first");
  now = 10; const failed = cache.get(); const shared = cache.get(); second.reject(new Error("offline"));
  await assert.rejects(failed, /offline/); await assert.rejects(shared, /offline/);
  const retry = cache.get(); third.resolve("recovered"); assert.equal(await retry, "recovered"); assert.equal(await cache.get(), "recovered"); assert.equal(n, 3);
});

test("invalidation detaches a cold load; an old completion cannot overwrite the new value", async () => {
  const old = deferred<string>(), fresh = deferred<string>(); let n = 0;
  const cache = createTtlCache({ load: () => ++n === 1 ? old.promise : fresh.promise, nowMs: () => 0, ttlMs: 10 });
  const before = cache.get(); cache.invalidate(); const after = cache.get();
  fresh.resolve("new"); assert.equal(await after, "new"); old.resolve("old"); assert.equal(await before, "old"); assert.equal(await cache.get(), "new");
});

test("old loads finishing during a newer refresh never clear the newer single-flight promise", async () => {
  const old = deferred<string>(), fresh = deferred<string>(); let n = 0;
  const cache = createTtlCache({ load: () => ++n === 1 ? old.promise : fresh.promise, nowMs: () => 0, ttlMs: 10 });
  const before = cache.get(); const refresh = cache.get({ refresh: true }); old.resolve("old"); assert.equal(await before, "old");
  const joined = cache.get(); fresh.resolve("fresh"); assert.deepEqual(await Promise.all([refresh, joined]), ["fresh", "fresh"]); assert.equal(await cache.get(), "fresh"); assert.equal(n, 2);
});

test("an older refresh finishing last cannot replace a newer refresh", async () => {
  const a = deferred<number>(), b = deferred<number>(); let n = 0;
  const cache = createTtlCache({ load: () => ++n === 1 ? a.promise : b.promise, nowMs: () => 0, ttlMs: 1 });
  const old = cache.get({ refresh: true }), fresh = cache.get({ refresh: true }); b.resolve(2); assert.equal(await fresh, 2); a.resolve(1); assert.equal(await old, 1); assert.equal(await cache.get(), 2);
});


test("refresh minimum interval coalesces concurrent and repeated forced reads; invalidation permits immediate rebuild", async () => {
  let now = 0, calls = 0;
  const cache = createTtlCache({ load: async () => ++calls, ttlMs: 30_000, nowMs: () => now }, { minRefreshIntervalMs: 5_000 });
  assert.deepEqual(await Promise.all([cache.get({ refresh: true }), cache.get({ refresh: true })]), [1, 1]);
  now = 4_999; assert.equal(await cache.get({ refresh: true }), 1); assert.equal(calls, 1);
  now = 5_000; assert.equal(await cache.get({ refresh: true }), 2);
  cache.invalidate(); assert.equal(await cache.get({ refresh: true }), 3);
  assert.equal(calls, 3);
});
