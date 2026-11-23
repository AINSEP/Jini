import { describe, it, expect, vi } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import { currentUserRoute, createPasswordStatusRoute, type CurrentUserRouteDeps, type PasswordStatusRouteDeps } from '../index.js';
import { fakeAuthRequest } from './fake-auth-request.js';

async function refusal(promise: unknown) { try { await promise; } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; } throw new Error('expected a refusal'); }
const UNAUTHENTICATED = { status: 401, body: { error: 'unauthenticated', code: 'UNAUTHENTICATED' } };
const signedIn = (id = 'p1', displayName = 'Owner Name') => fakeAuthRequest({ currentPrincipal: vi.fn(async () => ({ id, displayName })) }).auth;
function meDeps(over: Partial<CurrentUserRouteDeps> = {}): CurrentUserRouteDeps {
  return { workspaceId: 'w1', findUserByPrincipalId: vi.fn(async () => ({ username: 'owner' })), effectivePermissions: vi.fn(async () => ['*']), callerMayManageUserTrash: vi.fn(async () => true), canPublishToLive: () => false, ...over };
}
function statusDeps(over: Partial<PasswordStatusRouteDeps> = {}): PasswordStatusRouteDeps {
  return { workspaceId: 'w1', findUserByPrincipalId: vi.fn(async () => ({ passwordHash: 'hash-1' })), verifyPassword: vi.fn(async () => true), defaultOwnerPassword: 'fixture-default', ...over };
}

describe('GET /auth/me (U-AUTH-3)', () => {
  it('B21 answers an unauthenticated caller with the exact 401', async () => {
    expect(await refusal(currentUserRoute.handle({ input: {}, deps: meDeps(), context: fakeAuthRequest().auth }))).toEqual(UNAUTHENTICATED);
  });
  it('B21 answers exactly four keys', async () => {
    const deps = meDeps();
    const result = await currentUserRoute.handle({ input: {}, deps, context: signedIn() });
    expect(result).toEqual({ ok: true, value: { user: { id: 'p1', username: 'owner' }, effectivePermissions: ['*'], canManageUserTrash: true, canPublishToLive: false } });
    expect(deps.callerMayManageUserTrash).toHaveBeenCalledWith({ workspaceId: 'w1', callerPrincipalId: 'p1' });
  });
  it('falls back to the display name without a user row', async () => {
    const result = await currentUserRoute.handle({ input: {}, deps: meDeps({ findUserByPrincipalId: vi.fn(async () => null) }), context: signedIn() });
    expect(result).toMatchObject({ value: { user: { id: 'p1', username: 'Owner Name' } } });
  });
});
describe('GET /auth/me/password-status (U-AUTH-3)', () => {
  it('B21 answers an unauthenticated caller with the exact 401', async () => {
    expect(await refusal(createPasswordStatusRoute().handle({ input: {}, deps: statusDeps(), context: fakeAuthRequest().auth }))).toEqual(UNAUTHENTICATED);
  });
  it('B22 answers false for a missing user row without verifying', async () => {
    const deps = statusDeps({ findUserByPrincipalId: vi.fn(async () => null) });
    expect(await createPasswordStatusRoute().handle({ input: {}, deps, context: signedIn() })).toEqual({ ok: true, value: { usesDefaultPassword: false } });
    expect(deps.verifyPassword).not.toHaveBeenCalled();
  });
  it('B22 verifies against the injected default password and memoizes by hash', async () => {
    const deps = statusDeps(); const route = createPasswordStatusRoute();
    await route.handle({ input: {}, deps, context: signedIn() }); await route.handle({ input: {}, deps, context: signedIn() });
    expect(deps.verifyPassword).toHaveBeenCalledExactlyOnceWith({ hash: 'hash-1', password: 'fixture-default' });
  });
  it('B22 keeps the memo per registration: two factory calls do not share hits', async () => {
    const deps = statusDeps();
    await createPasswordStatusRoute().handle({ input: {}, deps, context: signedIn() });
    await createPasswordStatusRoute().handle({ input: {}, deps, context: signedIn() });
    expect(deps.verifyPassword).toHaveBeenCalledTimes(2);
  });
  it('B22 re-verifies a new hash', async () => {
    let hash = 'hash-1'; const deps = statusDeps({ findUserByPrincipalId: vi.fn(async () => ({ passwordHash: hash })), verifyPassword: vi.fn(async ({ hash: h }) => h === 'hash-1') });
    const route = createPasswordStatusRoute();
    expect(await route.handle({ input: {}, deps, context: signedIn() })).toEqual({ ok: true, value: { usesDefaultPassword: true } });
    hash = 'hash-2';
    expect(await route.handle({ input: {}, deps, context: signedIn() })).toEqual({ ok: true, value: { usesDefaultPassword: false } });
    expect(deps.verifyPassword).toHaveBeenCalledTimes(2);
  });
  it('B22 clears the memo wholesale at 256 entries', async () => {
    let n = 0; const deps = statusDeps({ findUserByPrincipalId: vi.fn(async () => ({ passwordHash: `h${n}` })) }); const route = createPasswordStatusRoute();
    for (n = 0; n < 257; n += 1) await route.handle({ input: {}, deps, context: signedIn() });
    expect(deps.verifyPassword).toHaveBeenCalledTimes(257);
    n = 1; await route.handle({ input: {}, deps, context: signedIn() });
    expect(deps.verifyPassword).toHaveBeenCalledTimes(258);
    n = 256; await route.handle({ input: {}, deps, context: signedIn() });
    expect(deps.verifyPassword).toHaveBeenCalledTimes(258);
  });
});
