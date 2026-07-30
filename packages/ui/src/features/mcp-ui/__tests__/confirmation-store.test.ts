import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIRMATION_TTL_MS, createConfirmationStore } from '../confirmation-store.js';

const BINDING = { toolId: 'content_post_delete', workspaceId: 'w1', entityId: 'p1', entityVersion: 3 };

function createTestStore(overrides: Parameters<typeof createConfirmationStore>[0] = {}) {
  let clock = 1_000;
  let counter = 0;
  const store = createConfirmationStore({
    now: () => clock,
    randomToken: () => `token-${++counter}`,
    ...overrides,
  });
  return {
    store,
    advance(ms: number) {
      clock += ms;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createConfirmationStore', () => {
  it('mints a token that redeems exactly once against its own binding', () => {
    const { store } = createTestStore();
    const { token } = store.mint({ binding: BINDING, summary: 'Delete post p1' });

    const first = store.redeem({ token, binding: BINDING });
    expect(first).toEqual({
      ok: true,
      confirmation: { binding: BINDING, summary: 'Delete post p1', expiresAtMs: 1_000 + DEFAULT_CONFIRMATION_TTL_MS },
    });

    // A replay is indistinguishable from a guess, by design — see the module's rejection-reason doc.
    expect(store.redeem({ token, binding: BINDING })).toEqual({ ok: false, reason: 'unknown-or-expired' });
  });

  it('copies the binding at mint time, so mutating the caller’s object cannot change what was agreed', () => {
    const { store } = createTestStore();
    const mutable = { ...BINDING };
    const { token } = store.mint({ binding: mutable, summary: 's' });
    mutable.entityVersion = 99;
    expect(store.redeem({ token, binding: { ...BINDING, entityVersion: 99 } })).toEqual({
      ok: false,
      reason: 'binding-mismatch',
    });
  });

  it('rejects an unknown token', () => {
    const { store } = createTestStore();
    expect(store.redeem({ token: 'never-minted', binding: BINDING })).toEqual({ ok: false, reason: 'unknown-or-expired' });
  });

  it('rejects an expired token with the same reason as an unknown one', () => {
    const { store, advance } = createTestStore({ ttlMs: 100 });
    const { token } = store.mint({ binding: BINDING, summary: 's' });
    advance(101);
    expect(store.redeem({ token, binding: BINDING })).toEqual({ ok: false, reason: 'unknown-or-expired' });
  });

  it.each([
    ['a changed string value', { ...BINDING, entityId: 'p2' }],
    ['a changed numeric value', { ...BINDING, entityVersion: 4 }],
    ['a value whose length differs', { ...BINDING, entityId: 'p1-longer' }],
    ['an extra key', { ...BINDING, principalId: 'u1' }],
    ['a missing key', { toolId: BINDING.toolId, workspaceId: 'w1', entityId: 'p1' }],
    // Same key count, different key names — the case a length check alone would let through.
    ['a renamed key at the same count', { toolId: BINDING.toolId, workspaceId: 'w1', entityId: 'p1', version: 3 }],
    ['a string where a number was minted', { ...BINDING, entityVersion: '3' }],
  ])('rejects %s as a binding mismatch', (_label, binding) => {
    const { store } = createTestStore();
    const { token } = store.mint({ binding: BINDING, summary: 's' });
    expect(store.redeem({ token, binding: binding as Record<string, string | number> })).toEqual({
      ok: false,
      reason: 'binding-mismatch',
    });
  });

  it('burns a token even when the binding does not match, so it cannot be probed against other bindings', () => {
    const { store } = createTestStore();
    const { token } = store.mint({ binding: BINDING, summary: 's' });
    store.redeem({ token, binding: { ...BINDING, entityId: 'wrong' } });
    expect(store.redeem({ token, binding: BINDING })).toEqual({ ok: false, reason: 'unknown-or-expired' });
    expect(store.size()).toBe(0);
  });

  it('sweeps expired entries on mint and on size', () => {
    const { store, advance } = createTestStore({ ttlMs: 100 });
    store.mint({ binding: BINDING, summary: 'first' });
    expect(store.size()).toBe(1);
    advance(101);
    expect(store.size()).toBe(0);

    store.mint({ binding: BINDING, summary: 'second' });
    advance(101);
    store.mint({ binding: BINDING, summary: 'third' });
    expect(store.size()).toBe(1);
  });

  it('keys entries through the injected digest, so a Node consumer can restore hashing at rest', () => {
    const digestToken = vi.fn((token: string) => `sha:${token}`);
    const { store } = createTestStore({ digestToken });
    const { token } = store.mint({ binding: BINDING, summary: 's' });
    expect(digestToken).toHaveBeenCalledWith(token);
    expect(store.redeem({ token, binding: BINDING }).ok).toBe(true);
  });

  it('defaults its clock and TTL when neither is injected', () => {
    const store = createConfirmationStore({ randomToken: () => 'fixed' });
    const before = Date.now();
    const { expiresAtMs } = store.mint({ binding: BINDING, summary: 's' });
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + DEFAULT_CONFIRMATION_TTL_MS);
    expect(store.redeem({ token: 'fixed', binding: BINDING }).ok).toBe(true);
  });

  it('defaults to 256 bits of crypto.getRandomValues, base64url-encoded', () => {
    const store = createConfirmationStore();
    const tokens = new Set([0, 1, 2].map(() => store.mint({ binding: BINDING, summary: 's' }).token));
    expect(tokens.size).toBe(3);
    for (const token of tokens) {
      // 32 bytes base64url, padding stripped.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('refuses to mint rather than fall back to Math.random when getRandomValues is unavailable', () => {
    vi.stubGlobal('crypto', {});
    const store = createConfirmationStore();
    expect(() => store.mint({ binding: BINDING, summary: 's' })).toThrow(/crypto\.getRandomValues/);
  });
});
