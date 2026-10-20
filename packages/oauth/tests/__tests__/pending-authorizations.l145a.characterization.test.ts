import { describe, expect, it } from 'vitest';
import { createPendingAuthorizationStore, DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS,
  type PendingAuthorizationScheduler } from '../../src/pending-authorizations.js';
import type { OAuthRandomBytes } from '../../src/ports.js';
import { createTestClock } from '../helpers.js';

const authorization = { ownerKey: 'owner', providerId: 'provider', codeVerifier: 'verifier',
  redirectUri: 'https://client.example/callback', scopes: ['read'] };
function entropy(_required: Record<string, never>, _optional: Record<string, never> = {}): OAuthRandomBytes {
  let byte = 0;
  return ({ byteLength }) => new Uint8Array(byteLength).fill(++byte);
}

describe('pending authorization limits characterization', () => {
  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid TTL before scheduling or entropy: %s', ttlMs => {
    const scheduler: PendingAuthorizationScheduler = { every() { throw new Error('must not schedule'); } };
    expect(() => createPendingAuthorizationStore({ clock: createTestClock(), randomBytesFn: () => { throw new Error('must not generate entropy'); } }, { ttlMs, scheduler }))
      .toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST', message: 'pending store limits must be positive',
        operatorAction: 'Configure positive TTL and capacity values.' }));
    expect(() => createPendingAuthorizationStore({ clock: createTestClock() }, { ttlMs, scheduler, expiry: ({ ttlMs }) => ttlMs }))
      .toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST' }));
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid capacity in both modes: %s', maxEntries => {
    expect(() => createPendingAuthorizationStore({ clock: createTestClock(), randomBytesFn: entropy({}) }, { maxEntries }))
      .toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST' }));
    expect(() => createPendingAuthorizationStore({ clock: createTestClock() }, { maxEntries, expiry: ({ ttlMs }) => ttlMs }))
      .toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_REQUEST' }));
  });

  it('requires entropy only in owner-bound mode', () => {
    expect(() => Reflect.apply(createPendingAuthorizationStore, undefined, [{ clock: createTestClock() }]))
      .toThrow(new TypeError('owner-bound authorizations require cryptographic entropy'));
    expect(createPendingAuthorizationStore({ clock: createTestClock() }, { expiry: ({ ttlMs }) => ttlMs }).size({})).toBe(0);
  });

  it('uses default TTL and capacity and evicts the oldest state', async () => {
    const clock = createTestClock();
    const randomBytesFn: OAuthRandomBytes = ({ byteLength }) => {
      const bytes = new Uint8Array(byteLength);
      new DataView(bytes.buffer).setUint32(0, sequence++);
      return bytes;
    };
    let sequence = 0;
    const store = createPendingAuthorizationStore({ clock, randomBytesFn });
    const first = await store.put(authorization);
    expect(first.expiresAt).toBe('2026-08-25T12:10:00.000Z');
    for (let i = 0; i < DEFAULT_MAX_ENTRIES; i++) await store.put(authorization);
    expect(await store.size({})).toBe(256);
    await expect(store.take({ state: first.state, ownerKey: 'owner' })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
    clock.advance(DEFAULT_TTL_MS);
    expect(await store.size({})).toBe(0);
  });

  it('honors positive fractional TTL, clones entries and burns wrong-owner state', async () => {
    const clock = createTestClock();
    const store = createPendingAuthorizationStore({ clock, randomBytesFn: entropy({}) }, { ttlMs: 10.5, maxEntries: 1 });
    const scopes = ['read'];
    const resources = ['https://api.example/'];
    const first = await store.put({ ...authorization, scopes }, { resource: resources });
    expect(first.expiresAt).toBe('2026-08-25T12:00:00.010Z');
    scopes.push('mutated'); resources.push('https://other.example/');
    Object.assign(first, { codeVerifier: 'changed' });
    const saved = await store.take({ state: first.state, ownerKey: 'owner' });
    expect(saved.scopes).toEqual(['read']);
    expect(saved.resource).toEqual(['https://api.example/']);
    expect(saved.codeVerifier).toBe('verifier');
    const second = await store.put(authorization);
    await expect(store.take({ state: second.state, ownerKey: 'wrong' })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
    await expect(store.take({ state: second.state, ownerKey: 'owner' })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
    const third = await store.put(authorization);
    clock.advance(10);
    await expect(store.take({ state: third.state, ownerKey: 'owner' })).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
    expect(await store.size({})).toBe(0);
  });

  it('preserves inclusive and exclusive expiry boundaries for host payloads', () => {
    const clock = createTestClock();
    const deadline = clock.nowMs() + 5;
    const inclusive = createPendingAuthorizationStore<{ deadline: number }>({ clock }, { ttlMs: 5, maxEntries: 1, expiry: ({ value }) => value.deadline });
    const exclusive = createPendingAuthorizationStore<{ deadline: number }>({ clock }, { ttlMs: 5, maxEntries: 1,
      exclusiveExpiry: true, expiry: ({ value }) => value.deadline });
    inclusive.put({ state: 'state', value: { deadline } });
    exclusive.put({ state: 'state', value: { deadline } });
    clock.advance(5);
    expect(inclusive.consume({ state: 'state' })).toBeNull();
    expect(exclusive.consume({ state: 'state' })).toEqual({ deadline });
    expect(exclusive.consume({ state: 'state' })).toBeNull();
  });
});
