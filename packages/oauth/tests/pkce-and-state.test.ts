import { afterEach, beforeEach, vi } from 'vitest';
import { describe, expect, it } from 'vitest';
import { generateOAuthState } from '../src/index.js';
import { fixtureEntropy } from "./fixtures.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { createPendingAuthorizationStore } from "../src/testing/index.js";
import { assertValidCodeVerifier, createPkcePair, deriveCodeChallenge } from "../src/index.js";
import { assertOAuthRejects, assertOAuthThrows, createTestClock } from "./helpers.js";
/**
 * @file PKCE (RFC 7636) and the single-use `state` ledger — the two mechanisms that make a PUBLIC
 * callback route safe to expose.
 *
 * The assertions here are the ones that would actually catch a regression that matters: that the
 * challenge is a real S256 digest rather than the verifier echoed back, that a state cannot be
 * replayed, that it cannot be redeemed against a connection it was not issued for, and that a
 * failed owner check still consumes it.
 */
test("the PKCE challenge is the S256 digest of the verifier, not the verifier", () => {
    const pair = createPkcePair({
        randomBytesFn: fixtureEntropy
    });
    assert.notEqual(pair.codeChallenge, pair.codeVerifier);
    assert.equal(pair.codeChallengeMethod, "S256");
    assert.equal(pair.codeChallenge, createHash("sha256").update(pair.codeVerifier, "ascii").digest("base64url"));
});
test("a minted verifier satisfies RFC 7636's length and charset rules", () => {
    for (let i = 0; i < 32; i += 1) {
        const { codeVerifier } = createPkcePair({
            randomBytesFn: fixtureEntropy
        });
        assert.ok(codeVerifier.length >= 43 && codeVerifier.length <= 128, `length ${codeVerifier.length} out of range`);
        assert.match(codeVerifier, /^[A-Za-z0-9\-._~]+$/);
    }
});
test("two mints never collide", () => {
    const verifiers = new Set(Array.from({ length: 64 }, () => createPkcePair({
        randomBytesFn: fixtureEntropy
    }).codeVerifier));
    assert.equal(verifiers.size, 64);
});
test("a too-short verifier is refused with the RFC's own bounds in the message", () => {
    const error = assertOAuthThrows(() => assertValidCodeVerifier({
        codeVerifier: "a".repeat(42)
    }), "OAUTH_INVALID_REQUEST");
    assert.equal(error.message, "PKCE code verifier must be 43–128 characters (RFC 7636 §4.1)");
    assert.equal(error.retryable, false);
});
test("a too-long verifier is refused", () => {
    assertOAuthThrows(() => assertValidCodeVerifier({
        codeVerifier: "a".repeat(129)
    }), "OAUTH_INVALID_REQUEST");
});
test("a verifier outside the unreserved charset is refused rather than silently hashed", () => {
    const error = assertOAuthThrows(() => deriveCodeChallenge({
        codeVerifier: `${"a".repeat(42)}/`
    }), "OAUTH_INVALID_REQUEST");
    assert.equal(error.message, "PKCE code verifier contains characters outside RFC 7636's unreserved set");
});
test("a state is single use — the second redemption fails", async () => {
    const clock = createTestClock();
    const store = createPendingAuthorizationStore({
        randomBytesFn: fixtureEntropy,
        clock
    });
    const entry = await store.put({
        ownerKey: "ws:server", providerId: "p", codeVerifier: "v".repeat(43), redirectUri: "https://example.example/cb", scopes: []
    });
    assert.equal((await store.take({ state: entry.state, ownerKey: "ws:server" })).state, entry.state);
    const error = await assertOAuthRejects(() => store.take({ state: entry.state, ownerKey: "ws:server" }), "OAUTH_INVALID_STATE");
    assert.equal(error.message, "the authorization request could not be matched — it may have expired or already been used");
});
test("a state cannot be redeemed against a different connection", async () => {
    const store = createPendingAuthorizationStore({
        randomBytesFn: fixtureEntropy,
        clock: createTestClock()
    });
    const entry = await store.put({
        ownerKey: "ws:server-a", providerId: "p", codeVerifier: "v".repeat(43), redirectUri: "https://example.example/cb", scopes: []
    });
    await assertOAuthRejects(() => store.take({ state: entry.state, ownerKey: "ws:server-b" }), "OAUTH_INVALID_STATE");
});
test("a failed owner check still consumes the state, so it cannot be used as a retry oracle", async () => {
    const store = createPendingAuthorizationStore({
        randomBytesFn: fixtureEntropy,
        clock: createTestClock()
    });
    const entry = await store.put({
        ownerKey: "ws:server-a", providerId: "p", codeVerifier: "v".repeat(43), redirectUri: "https://example.example/cb", scopes: []
    });
    await assertOAuthRejects(() => store.take({ state: entry.state, ownerKey: "ws:server-b" }), "OAUTH_INVALID_STATE");
    // The CORRECT owner must now also fail: the entry is gone.
    await assertOAuthRejects(() => store.take({ state: entry.state, ownerKey: "ws:server-a" }), "OAUTH_INVALID_STATE");
});
test("a state expires and is pruned rather than lingering redeemable", async () => {
    const clock = createTestClock();
    const store = createPendingAuthorizationStore({
        randomBytesFn: fixtureEntropy,
        clock
    }, {
        ttlMs: 60000
    });
    const entry = await store.put({
        ownerKey: "ws:server", providerId: "p", codeVerifier: "v".repeat(43), redirectUri: "https://example.example/cb", scopes: []
    });
    assert.equal(await store.size({}), 1);
    clock.advance(60001);
    await assertOAuthRejects(() => store.take({ state: entry.state, ownerKey: "ws:server" }), "OAUTH_INVALID_STATE");
    assert.equal(await store.size({}), 0);
});
test("the store is bounded — at the cap the oldest entry is evicted, never the newest refused", async () => {
    const store = createPendingAuthorizationStore({
        randomBytesFn: fixtureEntropy,
        clock: createTestClock()
    }, {
        maxEntries: 3
    });
    // Sequential `await`s, not `Promise.all` — insertion order is what "oldest" below depends on.
    const entries = [];
    for (let index = 0; index < 4; index += 1) {
        entries.push(await store.put({
            ownerKey: `ws:server-${index}`, providerId: "p", codeVerifier: "v".repeat(43), redirectUri: "https://example.example/cb", scopes: []
        }));
    }
    const [oldest, , , newest] = entries;
    assert.ok(oldest && newest);
    assert.equal(await store.size({}), 3);
    // Oldest gone...
    await assertOAuthRejects(() => store.take({ state: oldest.state, ownerKey: "ws:server-0" }), "OAUTH_INVALID_STATE");
    // ...newest still redeemable, which is the property that keeps one caller from wedging the flow.
    assert.equal((await store.take({ state: newest.state, ownerKey: "ws:server-3" })).ownerKey, "ws:server-3");
});
test("an unknown state is refused with the same message as an expired one", async () => {
    const store = createPendingAuthorizationStore({
        randomBytesFn: fixtureEntropy,
        clock: createTestClock()
    });
    const error = await assertOAuthRejects(() => store.take({ state: "not-a-real-state", ownerKey: "ws:server" }), "OAUTH_INVALID_STATE");
    assert.equal(error.message, "the authorization request could not be matched — it may have expired or already been used");
});

const randomBytesFn = fixtureEntropy;
describe('createPkcePair / deriveCodeChallenge / generateOAuthState', () => {
  // PARITY
  it('generates a base64url verifier of the expected length with no padding', () => {
    const verifier = createPkcePair({ randomBytesFn }, { verifierBytes: 64 }).codeVerifier;
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThan(40);
  });

  // PARITY
  it('derives a deterministic S256 challenge for a given verifier', () => {
    const challenge1 = deriveCodeChallenge({ codeVerifier: 'a'.repeat(43) });
    const challenge2 = deriveCodeChallenge({ codeVerifier: 'a'.repeat(43) });
    expect(challenge1).toBe(challenge2);
    expect(challenge1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // PARITY
  it('generates a base64url state value', () => {
    expect(generateOAuthState({ randomBytesFn })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // PARITY
  it('generates distinct verifiers/states across calls', () => {
    expect(createPkcePair({ randomBytesFn }, { verifierBytes: 64 }).codeVerifier).not.toBe(createPkcePair({ randomBytesFn }, { verifierBytes: 64 }).codeVerifier);
    expect(generateOAuthState({ randomBytesFn })).not.toBe(generateOAuthState({ randomBytesFn }));
  });
});


// REGRESSION: fails if createPkcePair ignores verifierBytes or changes the 32-byte default.
test('PKCE retains the main default and supports the provider 64-byte choice', () => {
    assert.equal(createPkcePair({ randomBytesFn: fixtureEntropy }).codeVerifier.length, 43);
    assert.equal(createPkcePair({ randomBytesFn: fixtureEntropy }, { verifierBytes: 64 }).codeVerifier.length, 86);
});


// Generalized characterization of the fixed-issuer provider client.
interface PendingFixture {
  serverId: string; authServerIssuer: string; tokenEndpoint: string; clientId: string;
  redirectUri: string; codeVerifier: string; createdAt: number;
}
const cachePorts = { clock: { nowMs: () => Date.now() } };
const cacheOptions = {
  expiry: ({ value, ttlMs }: { value: PendingFixture; ttlMs: number }) => value.createdAt + ttlMs,
  exclusiveExpiry: true,
  scheduler: { every: ({ intervalMs, run }: { intervalMs: number; run: () => void }) => {
    const timer = setInterval(run, intervalMs); timer.unref(); return () => clearInterval(timer);
  } },
};
describe('createPendingAuthorizationStore', () => {
  const state = (overrides: Partial<PendingFixture> = {}): PendingFixture => ({
    serverId: 'p1',
    authServerIssuer: 'https://auth.example.com',
    tokenEndpoint: 'https://auth.example.com/token',
    clientId: 'client-1',
    redirectUri: 'http://127.0.0.1:5555/callback',
    codeVerifier: 'verifier-1',
    createdAt: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // PARITY
  it('stores and one-shot consumes a pending state', () => {
    const cache = createPendingAuthorizationStore<PendingFixture>({ clock: cachePorts.clock }, cacheOptions);
    cache.put({ state: 'state-1', value: state() });
    expect(cache.size({})).toBe(1);
    expect(cache.consume({ state: 'state-1' })?.clientId).toBe('client-1');
    expect(cache.consume({ state: 'state-1' })).toBeNull();
    cache.stop({});
  });

  // PARITY
  it('returns null for an unknown state', () => {
    const cache = createPendingAuthorizationStore<PendingFixture>({ clock: cachePorts.clock }, cacheOptions);
    expect(cache.consume({ state: 'nope' })).toBeNull();
    cache.stop({});
  });

  // PARITY
  it('treats an entry older than the ttl as expired even if still present in the store', () => {
    // Jump the system clock without advancing timers, so the sweeper's own
    // interval never fires and doesn't delete the entry first — this
    // isolates consume()'s own TTL check (as opposed to the sweeper's).
    const start = Date.now();
    const cache = createPendingAuthorizationStore<PendingFixture>({ clock: cachePorts.clock }, { ...cacheOptions, ttlMs: 1000 });
    cache.put({ state: 'state-1', value: state({ createdAt: start }) });
    vi.setSystemTime(start + 1001);
    expect(cache.consume({ state: 'state-1' })).toBeNull();
    cache.stop({});
  });

  // PARITY
  it('sweeps expired entries on its own timer and stops the sweeper once empty', () => {
    const cache = createPendingAuthorizationStore<PendingFixture>({ clock: cachePorts.clock }, { ...cacheOptions, ttlMs: 100 });
    cache.put({ state: 'state-1', value: state() });
    expect(cache.size({})).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_000 + 1);
    expect(vi.getTimerCount()).toBe(0);
    expect(cache.size({})).toBe(0);
  });

  // PARITY
  it('does not restart an already-running sweeper on a second put', () => {
    const cache = createPendingAuthorizationStore<PendingFixture>({ clock: cachePorts.clock }, { ...cacheOptions, ttlMs: 10_000 });
    cache.put({ state: 'state-1', value: state() });
    cache.put({ state: 'state-2', value: state() });
    expect(vi.getTimerCount()).toBe(1);
    expect(cache.size({})).toBe(2);
    cache.stop({});
  });

  // PARITY
  it('stop() is idempotent and safe when never started', () => {
    const cache = createPendingAuthorizationStore<PendingFixture>({ clock: cachePorts.clock }, cacheOptions);
    expect(() => cache.stop({})).not.toThrow();
    expect(() => cache.stop({})).not.toThrow();
  });
});

// REGRESSION: fails if the merged callback payload store is returned to the unbounded cache.
test('host payload storage shares the owner-store capacity and can preserve its exclusive expiry', () => {
    let now = 0;
    const store = createPendingAuthorizationStore<{ createdAt: number }>({ clock: { nowMs: () => now } }, {
        expiry: ({ value, ttlMs }) => value.createdAt + ttlMs, exclusiveExpiry: true,
    });
    for (let index = 0; index < 257; index++) store.put({ state: String(index), value: { createdAt: 0 } });
    assert.equal(store.size({}), 256);
    assert.equal(store.consume({ state: '0' }), null);
    now = 600000;
    assert.deepEqual(store.consume({ state: '1' }), { createdAt: 0 });
    now++;
    assert.equal(store.consume({ state: '2' }), null);
});
