import assert from "node:assert/strict";
import { test } from "vitest";
import { createMailLaneLimiter } from "../rate-limit.js";

test("bulk cannot consume the transactional reserve; transactional can drain it", () => {
  let now = 0;
  const limiter = createMailLaneLimiter({ limit: { perSecond: 1, burst: 3 } }, { reservedForTransactional: 1, now: () => now });
  assert.deepEqual(limiter.tryTake({ lane: "bulk" }), { ok: true });
  assert.deepEqual(limiter.tryTake({ lane: "bulk" }), { ok: true });
  // One token left = the reserve: bulk waits a full token's refill, transactional proceeds.
  assert.deepEqual(limiter.tryTake({ lane: "bulk" }), { ok: false, retryAfterMs: 1000 });
  assert.deepEqual(limiter.tryTake({ lane: "transactional" }), { ok: true });
  assert.deepEqual(limiter.tryTake({ lane: "transactional" }), { ok: false, retryAfterMs: 1000 });
  now = 500;
  assert.deepEqual(limiter.tryTake({ lane: "transactional" }), { ok: false, retryAfterMs: 500 });
  now = 1000;
  assert.deepEqual(limiter.tryTake({ lane: "transactional" }), { ok: true });
});

test("refill is capped at burst and the default reserve is 20% of burst", () => {
  let now = 0;
  const limiter = createMailLaneLimiter({ limit: { perSecond: 10, burst: 10 } }, { now: () => now });
  now = 60_000;
  let taken = 0;
  while (limiter.tryTake({ lane: "bulk" }).ok) taken += 1;
  assert.equal(taken, 8);
});

test("the reserve never blocks bulk entirely and the wall clock is the default", () => {
  const limiter = createMailLaneLimiter({ limit: { perSecond: 1, burst: 1 } }, { reservedForTransactional: 5 });
  assert.deepEqual(limiter.tryTake({ lane: "bulk" }), { ok: true });
});

test("invalid limits are refused at composition", () => {
  assert.throws(() => createMailLaneLimiter({ limit: { perSecond: 0, burst: 1 } }), RangeError);
  assert.throws(() => createMailLaneLimiter({ limit: { perSecond: 1, burst: 0 } }), RangeError);
});
