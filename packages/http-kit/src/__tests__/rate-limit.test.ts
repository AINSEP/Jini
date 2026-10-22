// Generalized from the copied fixed-window and client-IP tests. Host profiles are fixtures.
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createRateLimiter as createLimiter,
  createMemoryCounterStore,
  type Clock,
  type ClientIpSource,
  resolveClientIp as resolveWithPolicy,
  type RateLimitProfile,
} from "../rate-limit.js";

const SHORT_WINDOW = { max: 10, windowSeconds: 60, burst: 0 };
const LONG_WINDOW = { max: 5, windowSeconds: 3600, burst: 0 };
const HIGH_CEILING = { max: 20, windowSeconds: 3600, burst: 0 };
const WITH_BURST = { max: 20, windowSeconds: 60, burst: 5 };
const FIVE_MINUTES = { max: 10, windowSeconds: 300, burst: 0 };

// REGRESSION: fails if consume converts clock.nowIso() instead of reading core Clock.nowMs().
test("createRateLimiter: stores the injected millisecond clock without an ISO round-trip", async () => {
  const store = createMemoryCounterStore({});
  const clock: Clock = { nowMs: () => 1_750_000_000_000.25 };
  const limiter = createLimiter({ profile: SHORT_WINDOW, clock, store });
  assert.deepEqual(await limiter.check({ key: "client" }), { allowed: true });
  assert.deepEqual(await store.get({ key: "client" }), { windowStartMs: clock.nowMs(), count: 1 });
});

function createRateLimiter(required: { profile: RateLimitProfile; clock: Clock }) {
  return createLimiter({ ...required, store: createMemoryCounterStore({}) });
}

function resolveClientIp(source: ClientIpSource, trustedProxies: readonly string[] = []) {
  return resolveWithPolicy({ source, policy: {
    unknownAddress: "unknown",
    isTrustedProxy: ({ address }) => trustedProxies.includes(address),
    fallbackAddress: ({ source, socketPeer }) => source.ip || socketPeer,
  } });
}


function fakeClock(startIso: string) {
  let currentIso = startIso;
  return {
    clock: { nowMs: () => Date.parse(currentIso) },
    advanceMs(ms: number) {
      currentIso = new Date(new Date(currentIso).getTime() + ms).toISOString();
    },
  };
}

test("createRateLimiter: requests under the max all pass", async () => {
  assert.deepEqual(SHORT_WINDOW, { max: 10, windowSeconds: 60, burst: 0 });
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: SHORT_WINDOW, clock });

  for (let i = 0; i < 10; i++) {
    const result = (await limiter.check({ key: "1.2.3.4" }));
    assert.equal(result.allowed, true, `request ${i + 1} should pass`);
  }
});

test("createRateLimiter: the (max+1)th request in the window is rejected with a positive integer retryAfterSeconds", async () => {
  const { clock, advanceMs } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: SHORT_WINDOW, clock });

  for (let i = 0; i < 10; i++) {
    assert.equal((await limiter.check({ key: "1.2.3.4" })).allowed, true);
  }

  const eleventh = (await limiter.check({ key: "1.2.3.4" }));
  assert.equal(eleventh.allowed, false);
  if (eleventh.allowed) throw new Error("unreachable");
  assert.ok(Number.isInteger(eleventh.retryAfterSeconds), "retryAfterSeconds must be an integer");
  assert.ok(eleventh.retryAfterSeconds > 0, "retryAfterSeconds must be positive");
  assert.ok(
    eleventh.retryAfterSeconds <= SHORT_WINDOW.windowSeconds,
    "retryAfterSeconds must not exceed the window length"
  );
  advanceMs(30_000);
  assert.deepEqual((await limiter.check({ key: "1.2.3.4" })), { allowed: false, retryAfterSeconds: 30 });
  advanceMs(1);
  assert.deepEqual((await limiter.check({ key: "1.2.3.4" })), { allowed: false, retryAfterSeconds: 30 }, "fractional seconds round up");
});

test("createRateLimiter: different IPs have independent counters", async () => {
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: SHORT_WINDOW, clock });

  for (let i = 0; i < SHORT_WINDOW.max; i++) {
    assert.equal((await limiter.check({ key: "1.1.1.1" })).allowed, true);
  }
  // 1.1.1.1 is now exhausted...
  assert.equal((await limiter.check({ key: "1.1.1.1" })).allowed, false);
  // ...but a different key starts with a fresh window.
  assert.equal((await limiter.check({ key: "2.2.2.2" })).allowed, true);
});

test("createRateLimiter: two IPs each receive their full independent budget", async () => {
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const profile = { max: 2, burst: 0, windowSeconds: 60 };
  const limiter = createRateLimiter({ profile, clock });

  // Exhausting one client must never create a shared missing-key bucket.
  for (const key of ["203.0.113.1", "203.0.113.2"]) {
    for (let attempt = 0; attempt < profile.max; attempt++) {
      assert.deepEqual(await limiter.check({ key }), { allowed: true });
    }
    assert.deepEqual(await limiter.check({ key }), { allowed: false, retryAfterSeconds: 60 });
  }
  assert.equal(await limiter.size({}), 2);
});

test("createRateLimiter: malformed keys reject before touching storage and leave valid budgets intact", async () => {
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const memory = createMemoryCounterStore({});
  const reads: string[] = [];
  const store = { ...memory, get: async (required: { key: string }) => {
    reads.push(required.key);
    return memory.get(required);
  } };
  const limiter = createLimiter({ profile: { max: 1, burst: 0, windowSeconds: 60 }, clock, store });
  const malformed: unknown[] = [undefined, null, "203.0.113.1", {}, { key: undefined }, { key: null }, { key: 42 }, { key: false }, { key: {} }, { key: "" }];
  for (const required of malformed) {
    // Exercise callers that bypass TypeScript, including the old positional API.
    await assert.rejects(() => limiter.check(required as Parameters<typeof limiter.check>[0]), {
      name: "TypeError",
      message: "rate limit key must be a non-empty string",
    });
  }
  assert.deepEqual(reads, [], "invalid calls must not reach the counter store");
  assert.equal(await limiter.size({}), 0, "invalid calls must not allocate a bucket");
  assert.deepEqual(await limiter.check({ key: "203.0.113.1" }), { allowed: true });
  assert.deepEqual(await limiter.check({ key: "203.0.113.1" }), { allowed: false, retryAfterSeconds: 60 });
});

test("createRateLimiter: the window resets once windowSeconds elapses", async () => {
  const { clock, advanceMs } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: SHORT_WINDOW, clock });

  for (let i = 0; i < SHORT_WINDOW.max; i++) {
    assert.equal((await limiter.check({ key: "1.2.3.4" })).allowed, true);
  }
  assert.equal((await limiter.check({ key: "1.2.3.4" })).allowed, false);

  // Just under the window boundary: still blocked.
  advanceMs(60_000 - 1);
  assert.equal((await limiter.check({ key: "1.2.3.4" })).allowed, false);

  // At/after the window boundary: a fresh window starts.
  advanceMs(1);
  assert.equal((await limiter.check({ key: "1.2.3.4" })).allowed, true);
});

test("createRateLimiter: a profile's burst allowance extends the effective ceiling", async () => {
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const profileWithBurst: RateLimitProfile = { windowSeconds: 60, max: 2, burst: 1 };
  const limiter = createRateLimiter({ profile: profileWithBurst, clock });

  assert.equal((await limiter.check({ key: "k" })).allowed, true);
  assert.equal((await limiter.check({ key: "k" })).allowed, true);
  assert.equal((await limiter.check({ key: "k" })).allowed, true, "3rd request consumes the burst allowance");
  assert.equal((await limiter.check({ key: "k" })).allowed, false, "4th request exceeds max+burst");
});

test("resolveClientIp: without Express req.ip or a trusted-proxy list, uses the socket peer address", async () => {
  const req = {
    socket: { remoteAddress: "203.0.113.9" },
    headers: { "x-forwarded-for": "9.9.9.9" },
  };
  assert.equal(resolveClientIp(req), "203.0.113.9");
});

test("resolveClientIp: uses Express's resolved client IP when no explicit proxy matches", async () => {
  assert.equal(resolveClientIp({
    ip: "203.0.113.9", socket: { remoteAddress: "10.0.0.1" }, headers: { "x-forwarded-for": "6.6.6.6" },
  }), "203.0.113.9");
});

test("resolveClientIp: handles array forwarded headers, exact mapped-IPv6 peers, and missing addresses", async () => {
  const req = {
    socket: { remoteAddress: "::ffff:10.0.0.1" },
    headers: { "x-forwarded-for": [" 9.9.9.9, 10.0.0.1", "8.8.8.8"] },
  };
  assert.equal(resolveClientIp(req, ["::ffff:10.0.0.1"]), "9.9.9.9");
  assert.equal(resolveClientIp(req, ["10.0.0.1"]), "::ffff:10.0.0.1", "explicit trust is an exact address match");
  assert.equal(resolveClientIp({ socket: {}, headers: {} }), "unknown");
});

test("resolveClientIp: an untrusted peer's X-Forwarded-For header is never honored", async () => {
  const req = {
    socket: { remoteAddress: "203.0.113.9" },
    headers: { "x-forwarded-for": "9.9.9.9" },
  };
  assert.equal(resolveClientIp(req, ["10.0.0.1"]), "203.0.113.9");
});

test("resolveClientIp: a trusted peer's X-Forwarded-For header is honored (first hop)", async () => {
  const req = {
    socket: { remoteAddress: "10.0.0.1" },
    headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
  };
  assert.equal(resolveClientIp(req, ["10.0.0.1"]), "9.9.9.9");
});

test("resolveClientIp: a trusted peer with no forwarded-for header falls back to the socket peer address", async () => {
  const req = {
    socket: { remoteAddress: "10.0.0.1" },
    headers: {},
  };
  assert.equal(resolveClientIp(req, ["10.0.0.1"]), "10.0.0.1");
});


test("LONG_WINDOW — the 6th request within the window for the same email is denied with retryAfterSeconds", async () => {
  assert.deepEqual(LONG_WINDOW, { max: 5, windowSeconds: 3600, burst: 0 });
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: LONG_WINDOW, clock });

  for (let i = 0; i < 5; i++) {
    assert.equal((await limiter.check({ key: "jane@example.com" })).allowed, true, `request ${i + 1} should pass`);
  }

  const sixth = (await limiter.check({ key: "jane@example.com" }));
  assert.equal(sixth.allowed, false);
  if (sixth.allowed) throw new Error("unreachable");
  assert.ok(Number.isInteger(sixth.retryAfterSeconds));
  assert.ok(sixth.retryAfterSeconds > 0);
});

test("LONG_WINDOW — the window resets correctly", async () => {
  const { clock, advanceMs } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: LONG_WINDOW, clock });

  for (let i = 0; i < LONG_WINDOW.max; i++) {
    assert.equal((await limiter.check({ key: "jane@example.com" })).allowed, true);
  }
  assert.equal((await limiter.check({ key: "jane@example.com" })).allowed, false);

  advanceMs(3_600_000 - 1);
  assert.equal((await limiter.check({ key: "jane@example.com" })).allowed, false);

  advanceMs(1);
  assert.equal((await limiter.check({ key: "jane@example.com" })).allowed, true);
});

test("HIGH_CEILING — the 21st request within the window for the same IP is denied", async () => {
  assert.deepEqual(HIGH_CEILING, { max: 20, windowSeconds: 3600, burst: 0 });
  const { clock, advanceMs } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: HIGH_CEILING, clock });

  for (let i = 0; i < 20; i++) {
    assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, true, `request ${i + 1} should pass`);
  }

  const twentyFirst = (await limiter.check({ key: "203.0.113.9" }));
  assert.equal(twentyFirst.allowed, false);
  advanceMs(3_600_000 - 1);
  assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, false);
  advanceMs(1);
  assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, true);
});

test("WITH_BURST — the 26th attempt within 60s from one IP is denied", async () => {
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: WITH_BURST, clock });

  const effectiveMax = WITH_BURST.max + WITH_BURST.burst;
  assert.equal(effectiveMax, 25, "sanity: max+burst should be 25 so the 26th attempt is the first denial");

  for (let i = 0; i < effectiveMax; i++) {
    assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, true, `attempt ${i + 1} should pass`);
  }

  const twentySixth = (await limiter.check({ key: "203.0.113.9" }));
  assert.equal(twentySixth.allowed, false);
});


test("FIVE_MINUTES — the 11th request within the window for the same IP is denied with retryAfterSeconds", async () => {
  assert.deepEqual(FIVE_MINUTES, { max: 10, windowSeconds: 300, burst: 0 });
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: FIVE_MINUTES, clock });

  for (let i = 0; i < 10; i++) {
    assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, true, `request ${i + 1} should pass`);
  }

  const eleventh = (await limiter.check({ key: "203.0.113.9" }));
  assert.equal(eleventh.allowed, false);
  if (eleventh.allowed) throw new Error("unreachable");
  assert.ok(Number.isInteger(eleventh.retryAfterSeconds));
  assert.ok(eleventh.retryAfterSeconds > 0);
  assert.ok(eleventh.retryAfterSeconds <= FIVE_MINUTES.windowSeconds);
});

test("FIVE_MINUTES — the 5-minute window resets correctly", async () => {
  const { clock, advanceMs } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: FIVE_MINUTES, clock });

  for (let i = 0; i < FIVE_MINUTES.max; i++) {
    assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, true);
  }
  assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, false);

  advanceMs(300_000 - 1);
  assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, false);

  advanceMs(1);
  assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, true);
});

test("FIVE_MINUTES — different IPs have independent counters", async () => {
  const { clock } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: FIVE_MINUTES, clock });

  for (let i = 0; i < FIVE_MINUTES.max; i++) {
    assert.equal((await limiter.check({ key: "1.1.1.1" })).allowed, true);
  }
  assert.equal((await limiter.check({ key: "1.1.1.1" })).allowed, false);
  assert.equal((await limiter.check({ key: "2.2.2.2" })).allowed, true, "a different key starts with a fresh window");
});


test("expired windows are evicted once the sweep interval elapses, shrinking the store", async () => {
  const { clock, advanceMs } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: FIVE_MINUTES, clock });
  if (!limiter.size) throw new Error("expected the real createRateLimiter() to implement size()");

  // 50 distinct attacker-controlled IPs, all seen inside the same window.
  for (let i = 0; i < 50; i++) {
    (await limiter.check({ key: `203.0.113.${i}` }));
  }
  assert.equal((await limiter.size({})), 50, "every distinct key seen so far is tracked");

  advanceMs(150_000);
  for (let i = 0; i < 10; i++) assert.equal((await limiter.check({ key: "active" })).allowed, true);
  assert.equal((await limiter.check({ key: "active" })).allowed, false);
  assert.equal((await limiter.size({})), 51);

  // Advance past the window boundary. Eviction is sweep-on-write (amortized, not a background
  // timer — see `createRateLimiter`'s doc), so nothing is swept until the next `check()` call.
  advanceMs(150_000);
  assert.equal((await limiter.size({})), 51, "no sweep has run yet — no check() call has happened since the advance");

  (await limiter.check({ key: "203.0.113.new" }));

  // The 50 stale entries are gone; the newer exhausted key and the sweep trigger survive.
  assert.equal((await limiter.size({})), 2, "the sweep evicted only entries whose windows had fully expired");
  assert.deepEqual((await limiter.check({ key: "active" })), { allowed: false, retryAfterSeconds: 150 });
});

test("eviction does not change the outcome for a key whose own window just expired", async () => {
  const { clock, advanceMs } = fakeClock("2026-01-01T00:00:00.000Z");
  const limiter = createRateLimiter({ profile: FIVE_MINUTES, clock });

  for (let i = 0; i < FIVE_MINUTES.max; i++) {
    assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, true);
  }
  assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, false, "exhausted before the sweep boundary");

  // Past the sweep interval: this call both triggers the sweep (evicting "203.0.113.9"'s now-stale
  // entry) AND is itself the request for that same key — the eviction must not double-count or
  // otherwise change what the caller experiences versus the pre-eviction behavior asserted in the
  // "window resets correctly" test above.
  advanceMs(FIVE_MINUTES.windowSeconds * 1000);
  assert.equal((await limiter.check({ key: "203.0.113.9" })).allowed, true, "a fresh window starts exactly as before eviction existed");
});

test('CounterStore: an injected adapter records immutable updates and receives eviction deletes', async () => {
  const map = new Map<string, { windowStartMs: number; count: number }>();
  const calls: string[] = [];
  const store = {
    get: async ({ key }: { key: string }) => map.get(key),
    set: async ({ key, state }: { key: string; state: { windowStartMs: number; count: number } }) => {
      calls.push(`set:${key}:${state.count}`);
      map.set(key, Object.freeze({ ...state }));
    },
    delete: async ({ key }: { key: string }) => { calls.push(`delete:${key}`); map.delete(key); },
    entries: async () => { calls.push('scan'); return map.entries(); },
    size: async () => map.size,
  };
  const { clock, advanceMs } = fakeClock('2026-01-01T00:00:00.000Z');
  const limiter = createLimiter({ profile: { max: 2, burst: 0, windowSeconds: 1 }, clock, store });
  assert.deepEqual((await limiter.check({ key: 'k' })), { allowed: true });
  assert.deepEqual((await limiter.check({ key: 'k' })), { allowed: true });
  assert.deepEqual((await limiter.check({ key: 'k' })), { allowed: false, retryAfterSeconds: 1 });
  assert.deepEqual(calls, ['set:k:1', 'set:k:2']);
  advanceMs(1000);
  assert.deepEqual((await limiter.check({ key: 'new' })), { allowed: true });
  assert.deepEqual(calls, ['set:k:1', 'set:k:2', 'scan', 'delete:k', 'set:new:1']);
  assert.equal((await limiter.size({})), 1);
});

test('resolveClientIp: caller policy can ignore framework IP and supply a custom missing-address key', async () => {
  const policy = {
    unknownAddress: 'no-peer',
    isTrustedProxy: ({ address }: { address: string }) => address === 'proxy',
    fallbackAddress: ({ socketPeer }: { socketPeer: string }) => socketPeer,
  };
  assert.equal(resolveWithPolicy({ source: { socket: {}, headers: {}, ip: 'ignored' }, policy }), 'no-peer');
  assert.equal(resolveWithPolicy({ source: { socket: { remoteAddress: 'proxy' }, headers: { 'x-forwarded-for': ' , attacker' } }, policy }), 'proxy');
});

test('createRateLimiter: budgets remain isolated across separately injected stores', async () => {
  const { clock } = fakeClock('2026-01-01T00:00:00.000Z');
  const profile = { max: 1, burst: 0, windowSeconds: 60 };
  const first = createLimiter({ profile, clock, store: createMemoryCounterStore({}) });
  const second = createLimiter({ profile, clock, store: createMemoryCounterStore({}) });
  assert.deepEqual((await first.check({ key: 'same' })), { allowed: true });
  assert.deepEqual((await first.check({ key: 'same' })), { allowed: false, retryAfterSeconds: 60 });
  assert.deepEqual((await second.check({ key: 'same' })), { allowed: true });
});

test('createRateLimiter: concurrent checks cannot overwrite counters across async storage awaits', async () => {
  for (let max = 1; max <= 5; max++) {
    for (let burst = 0; burst <= 3; burst++) {
      const { clock } = fakeClock('2026-01-01T00:00:00.000Z');
      const limiter = createLimiter({ profile: { max, burst, windowSeconds: 60 }, clock, store: createMemoryCounterStore({}) });
      const outcomes = await Promise.all(Array.from({ length: max + burst + 2 }, () => limiter.check({ key: 'same' })));
      assert.deepEqual(outcomes, [
        ...Array.from({ length: max + burst }, () => ({ allowed: true })),
        { allowed: false, retryAfterSeconds: 60 },
        { allowed: false, retryAfterSeconds: 60 },
      ]);
    }
  }
});

test('createRateLimiter: a store failure rejects the check without poisoning later queued requests', async () => {
  const memory = createMemoryCounterStore({});
  let fail = true;
  const store = { ...memory, get: async (input: { key: string }) => {
    if (fail) { fail = false; throw new Error('counter unavailable'); }
    return memory.get(input);
  } };
  const { clock } = fakeClock('2026-01-01T00:00:00.000Z');
  const limiter = createLimiter({ profile: { max: 1, burst: 0, windowSeconds: 60 }, clock, store });
  const failed = limiter.check({ key: 'same' });
  const next = limiter.check({ key: 'same' });
  await assert.rejects(failed, /counter unavailable/);
  assert.deepEqual(await next, { allowed: true });
  assert.deepEqual(await limiter.check({ key: 'same' }), { allowed: false, retryAfterSeconds: 60 });
});
