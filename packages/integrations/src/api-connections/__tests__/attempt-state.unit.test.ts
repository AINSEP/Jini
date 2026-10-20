/**
 * @file Unit tests for the attempt adapters over the OAuth core's sealed-state seam: the sealer
 * stores a ten-minute, single-use attempt under fresh random state; the opener consumes it first
 * and only then checks expiry, owner and callback URI; each adapter refuses the other direction.
 */
import { describe, expect, it } from 'vitest';
import { OAuthError } from '@jini-ai/oauth';
import { ATTEMPT_TTL_MS, attemptOpener, attemptSealer } from '../attempt-state.js';
import type { ApiConnectionAttempt } from '../types.js';
import { attempt, unitDeps } from './fixtures/unit-deps.js';

const PROVIDER_ID = 'acme-office/account';
const ENTRY = { ownerKey: 'owner-1', providerId: PROVIDER_ID, codeVerifier: 'verifier-1', redirectUri: 'http://127.0.0.1:47011/callback',
  scopes: ['acme.files'] };

function draft() {
  const { state: _state, codeVerifier: _verifier, redirectUri: _redirect, createdAt: _created, expiresAt: _expires, ...rest } = attempt();
  return rest;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error);
}

function opener(deps = unitDeps()) {
  const opened: ApiConnectionAttempt[] = [];
  return { deps, opened, adapter: attemptOpener(deps, { onOpen: ({ attempt: value }) => { opened.push(value); } }) };
}

describe('attemptSealer', () => {
  it('stores the attempt with the verifier, callback URI and a ten-minute lifetime', async () => {
    const deps = unitDeps();
    const pending = await attemptSealer(deps, { draft: draft() }).seal({ entry: ENTRY });
    const stored = deps.records.attempts.get(pending.state);
    expect(stored).toMatchObject({ codeVerifier: 'verifier-1', redirectUri: ENTRY.redirectUri, createdAt: '2026-10-20T10:00:00.000Z',
      expiresAt: new Date(Date.parse('2026-10-20T10:00:00.000Z') + ATTEMPT_TTL_MS).toISOString() });
  });

  it('returns the pending entry for the core with the requested scopes and provider id', async () => {
    const pending = await attemptSealer(unitDeps(), { draft: draft() }).seal({ entry: ENTRY });
    expect([pending.providerId, pending.scopes, pending.ownerKey]).toEqual([PROVIDER_ID, ['acme.files'], draft().ownerKey]);
  });

  it('uses fresh state for every attempt', async () => {
    const sealer = attemptSealer(unitDeps(), { draft: draft() });
    const [first, second] = [await sealer.seal({ entry: ENTRY }), await sealer.seal({ entry: ENTRY })];
    expect(first.state).not.toBe(second.state);
  });

  it('refuses to open state (the core changed its contract)', async () => {
    const error = await caught(attemptSealer(unitDeps(), { draft: draft() }).open({ state: 's', ownerKey: 'o', providerId: PROVIDER_ID,
      redirectUri: ENTRY.redirectUri }));
    expect(error instanceof OAuthError && error.code).toBe('OAUTH_INVALID_STATE');
  });
});

describe('attemptOpener', () => {
  const stored = attempt({ state: 'state-1', ownerKey: 'owner-1' });
  const request = { state: 'state-1', ownerKey: 'owner-1', providerId: PROVIDER_ID, redirectUri: stored.redirectUri };

  it('opens a matching attempt and hands it to onOpen', async () => {
    const { deps, opened, adapter } = opener();
    await deps.records.putAttempt({ attempt: stored });
    const pending = await adapter.open(request);
    expect([pending.codeVerifier, opened]).toEqual(['verifier-1', [stored]]);
  });

  it('refuses unknown state', async () => {
    const error = await caught(opener().adapter.open(request));
    expect(error instanceof OAuthError && error.code).toBe('OAUTH_INVALID_STATE');
  });

  it('refuses an attempt at its expiry time and burns it', async () => {
    const { deps, opened, adapter } = opener();
    await deps.records.putAttempt({ attempt: stored });
    deps.clock.now = Date.parse(stored.expiresAt);
    const error = await caught(adapter.open(request));
    expect([error instanceof OAuthError && error.code, opened, deps.records.attempts.size]).toEqual(['OAUTH_INVALID_STATE', [], 0]);
  });

  it('refuses another owner', async () => {
    const { deps, adapter } = opener();
    await deps.records.putAttempt({ attempt: stored });
    const error = await caught(adapter.open({ ...request, ownerKey: 'owner-2' }));
    expect(error instanceof OAuthError && error.code).toBe('OAUTH_INVALID_STATE');
  });

  it('refuses another callback URI', async () => {
    const { deps, adapter } = opener();
    await deps.records.putAttempt({ attempt: stored });
    const error = await caught(adapter.open({ ...request, redirectUri: 'http://127.0.0.1:47012/callback' }));
    expect(error instanceof OAuthError && error.code).toBe('OAUTH_INVALID_STATE');
  });

  it('refuses to seal (the core changed its contract)', async () => {
    const error = await caught(opener().adapter.seal({ entry: ENTRY }));
    expect(error instanceof OAuthError && error.code).toBe('OAUTH_INVALID_STATE');
  });
});
