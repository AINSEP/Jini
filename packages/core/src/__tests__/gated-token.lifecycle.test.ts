import { describe, expect, it } from 'vitest';
import { InMemoryTokenStore, TokenAlreadyRedeemedError, TokenExpiredError, expireToken, isRedeemable, mintToken, redeemToken } from '../gated-mutations/token.js';

/** L2 §4 gated-mutations/token: TTL validation, the inclusive expiry boundary (exactly at = ok,
 *  +1 ms = expired), single-use redemption, and revocation that can never un-spend a token. */
const NOW = '2026-01-01T00:00:00.000Z';
const mint = (overrides: Partial<Parameters<typeof mintToken>[0]> = {}) => mintToken({ planId: 'p', planHash: 'h', scopeId: 's', confirmerPrincipalId: 'u', now: NOW, ttlSeconds: 60, generateToken: () => 'tok', ...overrides });

describe('mintToken', () => {
  it('binds hash, scope and confirmer and expires exactly ttlSeconds later', () => {
    expect(mint()).toEqual({ confirmationToken: 'tok', planHash: 'h', scopeId: 's', confirmerPrincipalId: 'u', status: 'minted', createdAt: NOW, expiresAt: '2026-01-01T00:01:00.000Z' });
    expect(mint({ ttlSeconds: 0.5 }).expiresAt).toBe('2026-01-01T00:00:00.500Z');
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('ttl %s is refused', (ttlSeconds) => {
    expect(() => mint({ ttlSeconds })).toThrow(new RangeError('token timestamp must be valid and TTL must be positive and finite'));
  });
  it('an unparseable now is refused before the generator runs', () => {
    let called = false;
    expect(() => mint({ now: 'not a date', generateToken: () => { called = true; return 't'; } })).toThrow(RangeError);
    expect(called).toBe(false);
  });
  it.each(['', 7, null])('a generator returning %j is refused', (value) => {
    expect(() => mint({ generateToken: () => value as never })).toThrow('token generator must return a non-empty string');
  });
});

describe('isRedeemable / redeemToken', () => {
  const record = mint();
  it('expiry is inclusive: exactly at expiresAt is redeemable, one ms later is not', () => {
    expect(isRedeemable({ record, now: '2026-01-01T00:01:00.000Z' })).toBe(true);
    expect(isRedeemable({ record, now: '2026-01-01T00:01:00.001Z' })).toBe(false);
    expect(isRedeemable({ record: { ...record, status: 'redeemed' }, now: NOW })).toBe(false);
    expect(isRedeemable({ record: { ...record, status: 'expired' }, now: NOW })).toBe(false);
  });
  it('redeems once; a second redemption reports already-redeemed; unknown and late tokens report expired', async () => {
    const store = new InMemoryTokenStore({});
    await store.save({ record });
    await expect(redeemToken({ store, token: 'tok', now: NOW })).resolves.toMatchObject({ status: 'redeemed' });
    const second = redeemToken({ store, token: 'tok', now: NOW });
    await expect(second).rejects.toBeInstanceOf(TokenAlreadyRedeemedError);
    await expect(redeemToken({ store, token: 'tok', now: NOW })).rejects.toThrow('confirmation token has already been redeemed');
    await expect(redeemToken({ store, token: 'nope', now: NOW })).rejects.toThrow(new TokenExpiredError({ message: 'confirmation token was not found' }));
    const late = new InMemoryTokenStore({});
    await late.save({ record });
    await expect(redeemToken({ store: late, token: 'tok', now: '2026-01-01T00:01:00.001Z' })).rejects.toThrow('confirmation token has expired');
    expect((await late.findByToken({ token: 'tok' }))?.status).toBe('minted');
  });
  it('revocation expires a minted token but never un-redeems a spent one; save never overwrites', async () => {
    const store = new InMemoryTokenStore({});
    await store.save({ record });
    await store.save({ record: { ...record, confirmationToken: 'b' } });
    await expireToken({ store, token: 'tok', now: NOW });
    await expect(redeemToken({ store, token: 'tok', now: NOW })).rejects.toThrow('confirmation token has expired');
    await redeemToken({ store, token: 'b', now: NOW });
    await expireToken({ store, token: 'b', now: NOW });
    expect((await store.findByToken({ token: 'b' }))?.status).toBe('redeemed');
    await expect(store.save({ record })).rejects.toThrow('confirmation token already exists');
    const found = await store.findByToken({ token: 'tok' });
    found!.status = 'minted';
    expect((await store.findByToken({ token: 'tok' }))?.status).toBe('expired');
  });
});
