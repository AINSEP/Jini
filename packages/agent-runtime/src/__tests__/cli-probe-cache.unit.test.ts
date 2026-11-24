import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { createCliProbeCache } from "../cli-probe-cache.js";
import { MODEL_CATALOG_TTL_MS, MODEL_NEGATIVE_TTL_MS } from "../model-discovery.js";

afterEach(() => { vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("cold and repeated requests return immediately while one background probe runs", async () => {
  const next = deferred<string[]>();
  const started = deferred<void>();
  let calls = 0;
  const cache = createCliProbeCache({ initial: () => ["previous"], probe: () => {
    calls++; started.resolve(); return next.promise;
  } });
  assert.deepEqual(await cache.read({}), ["previous"]);
  await started.promise;
  assert.deepEqual(await cache.read({}), ["previous"]);
  assert.equal(calls, 1);
  next.resolve(["exact-model-v2"]);
  await cache.settled({});
  assert.deepEqual(await cache.read({}), ["exact-model-v2"]);
  assert.equal(calls, 1);
});

test("Rescan queues one forced refresh behind an in-flight probe and keeps the previous value", async () => {
  const first = deferred<string[]>();
  const started = deferred<void>();
  const forces: boolean[] = [];
  let active = 0;
  let peak = 0;
  const cache = createCliProbeCache({ initial: () => ["previous"], probe: async ({ force }) => {
    forces.push(force); peak = Math.max(peak, ++active); started.resolve();
    const result = forces.length === 1 ? await first.promise : ["rescanned"];
    active--; return result;
  } });
  await cache.read({});
  await started.promise;
  assert.deepEqual(await cache.read({ force: true }), ["previous"]);
  assert.deepEqual(await cache.read({ force: true }), ["previous"]);
  first.resolve(["first"]);
  await cache.settled({});
  assert.deepEqual(await cache.read({}), ["rescanned"]);
  assert.deepEqual(forces, [false, true]);
  assert.equal(peak, 1);
});

test("failed background probes retain the cache and require an explicit Rescan to retry", async () => {
  let calls = 0;
  const cache = createCliProbeCache({ initial: () => ["previous"], probe: async () => {
    if (++calls === 1) throw new Error("private stderr");
    return ["recovered"];
  } });
  await cache.read({}); await cache.settled({});
  assert.deepEqual(await cache.read({}), ["previous"]);
  assert.equal(calls, 1);
  await cache.read({ force: true }); await cache.settled({});
  assert.deepEqual(await cache.read({}), ["recovered"]);
});

for (const initialFailure of [true, false]) {
  test(`${initialFailure ? "initial" : "post-expiry"} rejection retains the snapshot and retries after the supplied cooldown`, async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let calls = 0;
    const cache = createCliProbeCache({
      initial: () => ["initial"],
      probe: async () => {
        calls++;
        if (calls === (initialFailure ? 1 : 2)) throw new Error("private stderr");
        return [calls === 1 ? "previous" : "recovered"];
      },
    }, { expiresAt: () => now + MODEL_CATALOG_TTL_MS, retryAfterMs: MODEL_NEGATIVE_TTL_MS });
    await cache.read({});
    await cache.settled({});
    if (!initialFailure) {
      now = MODEL_CATALOG_TTL_MS;
      await cache.read({});
      await cache.settled({});
    }
    const failedAt = now;
    const failedCalls = calls;
    const retained = initialFailure ? ["initial"] : ["previous"];
    for (const elapsed of [0, MODEL_NEGATIVE_TTL_MS - 1]) {
      now = failedAt + elapsed;
      assert.deepEqual(await cache.read({}), retained);
      await cache.settled({});
      assert.equal(calls, failedCalls);
    }
    now = failedAt + MODEL_NEGATIVE_TTL_MS;
    assert.deepEqual(await cache.read({}), retained);
    await cache.settled({});
    assert.equal(calls, failedCalls + 1);
    assert.deepEqual(await cache.read({}), ["recovered"]);
  });
}

for (const [freshness, ttl] of [["offline-fallback", MODEL_NEGATIVE_TTL_MS], ["fresh", MODEL_CATALOG_TTL_MS]] as const) {
  test(`${freshness} inventory refreshes lazily at its catalog expiry`, async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let calls = 0;
    const previous = { freshness, expiresAt: new Date(ttl).toISOString(), models: ["previous"] };
    const cache = createCliProbeCache({
      initial: () => previous,
      probe: async () => ++calls === 1 ? previous : {
        freshness: "fresh" as const, expiresAt: new Date(now + MODEL_CATALOG_TTL_MS).toISOString(), models: ["recovered"],
      },
    }, { expiresAt: ({ snapshot }) => Date.parse(snapshot.expiresAt) });
    assert.deepEqual(await cache.read({}), previous);
    await cache.settled({});
    now = ttl - 1;
    assert.deepEqual(await cache.read({}), previous);
    await cache.settled({});
    assert.equal(calls, 1);
    now++;
    // Reads retain the settled snapshot while one background discovery updates it.
    assert.deepEqual(await cache.read({}), previous);
    await cache.read({});
    await cache.settled({});
    assert.equal(calls, 2);
    assert.deepEqual((await cache.read({})).models, ["recovered"]);
    assert.equal((await cache.read({})).freshness, "fresh");
    assert.equal(cache.isPending({}), false);
  });
}
