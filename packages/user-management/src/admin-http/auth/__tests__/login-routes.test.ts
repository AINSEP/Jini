import { describe, it, expect, vi } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import type { RouteInputContext } from '@jini-ai/core/contracts/server';
import { AuthInvalidCredentialsError, IdentityValidationError } from '../../../core/types.js';
import { passwordLoginRoute, mfaLoginRoute, logoutRoute, type PasswordLoginRouteDeps, type MfaLoginRouteDeps } from '../index.js';
import { fakeAuthRequest } from './fake-auth-request.js';

const raw = (body: unknown): RouteInputContext => ({ body, query: {}, params: {} });
const SESSION = { principal: { id: 'p1', displayName: 'Owner Name' }, session: { expiresAt: '2030-01-01T00:00:00.000Z' }, rawToken: 'fixture-token' };
function loginDeps(over: Partial<PasswordLoginRouteDeps> = {}) {
  const order: string[] = [];
  const deps: PasswordLoginRouteDeps = { identityReady: Promise.resolve().then(() => { order.push('ready'); }), workspaceId: 'w1', login: vi.fn(async () => SESSION), beginOwnerLogin: vi.fn(async () => SESSION), ...over };
  return { deps, order };
}
async function runLogin(body: unknown, { deps = loginDeps().deps, ...authOver }: { deps?: PasswordLoginRouteDeps } & Parameters<typeof fakeAuthRequest>[0] = {}) {
  const { auth, events } = fakeAuthRequest(authOver);
  const parsed = passwordLoginRoute.parse(raw(body)); if (!parsed.ok) throw new Error('parse must be total');
  return { result: passwordLoginRoute.handle({ input: parsed.value, deps, context: auth }), auth, events };
}
async function refusal(promise: unknown) { try { await promise; } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; } throw new Error('expected a refusal'); }

describe('every owner-auth parser is total (thrown-only refusals)', () => {
  // `{"toString":1}` is valid JSON whose String() conversion throws; parsing must still be total.
  it.each([undefined, null, 'text', 7, { username: 'a' }, JSON.parse('{"username":{"toString":1},"password":{"toString":1}}')])('login, mfa and logout parse %j as ok', body => {
    for (const route of [passwordLoginRoute, mfaLoginRoute, logoutRoute]) expect(route.parse(raw(body)).ok).toBe(true);
  });
});
describe('POST /auth/login (U-AUTH-1)', () => {
  it('B1 awaits identityReady before the limiter', async () => {
    const order: string[] = []; const { deps } = loginDeps({ identityReady: Promise.resolve().then(() => { order.push('ready'); }) });
    const { auth } = fakeAuthRequest(); auth.rateLimit.check = vi.fn(async () => { order.push('rate'); return { allowed: true, retryAfterSeconds: 0 }; });
    await passwordLoginRoute.handle({ input: { body: { username: 'u', password: 'p' } }, deps, context: auth });
    expect(order).toEqual(['ready', 'rate']);
  });
  it('B2 refuses with 429, the exact body and Retry-After equal to retryAfterSeconds', async () => {
    const { result, events, deps } = await runLogin({ username: 'u', password: 'p' }, { allowed: false, retryAfterSeconds: 17 }).then(r => ({ ...r, deps: undefined }));
    expect(await refusal(result)).toEqual({ status: 429, body: { error: 'too many login attempts', code: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: 17 } } });
    expect(events).toEqual(['rate', 'retry-after:17']); expect(deps).toBeUndefined();
  });
  it('B2 a denied request whose fields fail string coercion still gets the exact 429 and Retry-After', async () => {
    const { deps } = loginDeps();
    const { result, events } = await runLogin(JSON.parse('{"username":{"toString":1},"password":{"toString":1}}'), { deps, allowed: false, retryAfterSeconds: 23 });
    expect(await refusal(result)).toEqual({ status: 429, body: { error: 'too many login attempts', code: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: 23 } } });
    expect(events).toEqual(['rate', 'retry-after:23']); expect(deps.login).not.toHaveBeenCalled();
  });
  it('an allowed request whose fields fail coercion fails after the limiter, inside the handler, without signing in', async () => {
    const { deps } = loginDeps();
    const { result, events } = await runLogin(JSON.parse('{"username":{"toString":1},"password":"p"}'), { deps });
    await expect(result).rejects.toBeInstanceOf(TypeError);
    expect(events).toEqual(['rate']); expect(deps.login).not.toHaveBeenCalled();
  });
  it('B3 coerces username 123 and password null to "123" and ""', async () => {
    const { deps } = loginDeps(); await (await runLogin({ username: 123, password: null }, { deps })).result;
    expect(deps.login).toHaveBeenCalledWith({ input: { workspaceId: 'w1', username: '123', password: '' } }, { ip: '203.0.113.7', userAgent: 'ua', sessionTtlMs: 1000 });
  });
  it('starts the owner login when an MFA store is configured', async () => {
    const { deps } = loginDeps({ mfaStore: {} }); await (await runLogin({ username: 'u', password: 'p' }, { deps })).result;
    expect(deps.beginOwnerLogin).toHaveBeenCalledTimes(1); expect(deps.login).not.toHaveBeenCalled();
  });
  it('B4 passes an MFA challenge through with no-store and no cookie', async () => {
    const challenge = { mfaRequired: true as const, pendingToken: 'pending' };
    const { deps } = loginDeps({ mfaStore: {}, beginOwnerLogin: vi.fn(async () => challenge) });
    const { result, events, auth } = await runLogin({ username: 'u', password: 'p' }, { deps });
    expect(await result).toEqual({ ok: true, value: challenge });
    expect(events).toEqual(['rate', 'no-store']); expect(auth.cookies.replaceSession).not.toHaveBeenCalled();
  });
  it('B5/B8 revokes before replacing the cookie, then signals sign-in, then answers {user:{id,username}}', async () => {
    const { result, events } = await runLogin({ username: 'owner', password: 'p' });
    expect(await result).toEqual({ ok: true, value: { user: { id: 'p1', username: 'owner' } } });
    expect(events).toEqual(['rate', 'no-store', 'revoke', 'cookie:session', 'signed-in:p1']);
  });
  it('B7 answers wrong credentials with the exact 401 and no no-store', async () => {
    const { deps } = loginDeps({ login: vi.fn(async () => { throw new AuthInvalidCredentialsError({ message: 'bad' }); }) });
    const { result, events } = await runLogin({ username: 'u', password: 'p' }, { deps });
    expect(await refusal(result)).toEqual({ status: 401, body: { error: 'invalid username or password', code: 'UNAUTHENTICATED' } });
    expect(events).not.toContain('no-store');
  });
  it('hands any other failure to the host unchanged', async () => {
    const boom = new Error('store down'); const { deps } = loginDeps({ login: vi.fn(async () => { throw boom; }) });
    await expect((await runLogin({ username: 'u', password: 'p' }, { deps })).result).rejects.toBe(boom);
  });
});
function mfaDeps(over: Partial<MfaLoginRouteDeps> = {}): MfaLoginRouteDeps {
  return { workspaceId: 'w1', completeOwnerLogin: vi.fn(async () => SESSION), findUserByPrincipalId: vi.fn(async () => ({ username: 'owner' })), ...over };
}
async function runMfa(body: unknown, deps = mfaDeps(), over: Parameters<typeof fakeAuthRequest>[0] = {}) {
  const { auth, events } = fakeAuthRequest(over); const parsed = mfaLoginRoute.parse(raw(body)); if (!parsed.ok) throw new Error('total');
  return { result: mfaLoginRoute.handle({ input: parsed.value, deps, context: auth }), events };
}
describe('POST /auth/mfa/login (U-AUTH-1)', () => {
  it('B9 sets no-store first on the 429, the 400, a failure and success', async () => {
    const r429 = await runMfa({}, mfaDeps(), { allowed: false }); await refusal(r429.result); expect(r429.events[0]).toBe('no-store');
    const r400 = await runMfa({}, mfaDeps({ completeOwnerLogin: vi.fn(async () => { throw new IdentityValidationError({ message: 'Code expired.' }); }) })); await refusal(r400.result); expect(r400.events[0]).toBe('no-store');
    const r500 = await runMfa({}, mfaDeps({ completeOwnerLogin: vi.fn(async () => { throw new Error('down'); }) })); await expect(r500.result).rejects.toThrow('down'); expect(r500.events[0]).toBe('no-store');
    const r200 = await runMfa({}); await r200.result; expect(r200.events[0]).toBe('no-store');
  });
  it('B10 turns object and number proofs into ""', async () => {
    const deps = mfaDeps(); await (await runMfa({ pendingToken: { a: 1 }, code: 123456 }, deps)).result;
    expect(deps.completeOwnerLogin).toHaveBeenCalledWith({ input: { workspaceId: 'w1', pendingToken: '', code: '' } }, expect.anything());
  });
  it('B11 refuses with the exact 429 body, without details', async () => {
    const { result, events } = await runMfa({}, mfaDeps(), { allowed: false, retryAfterSeconds: 9 });
    expect(await refusal(result)).toEqual({ status: 429, body: { error: 'Too many authenticator attempts. Wait a minute and try again.', code: 'RATE_LIMIT_EXCEEDED' } });
    expect(events).toContain('retry-after:9');
  });
  it('B12 answers an IdentityValidationError with 400 MFA_REFUSED and its message', async () => {
    const { result } = await runMfa({}, mfaDeps({ completeOwnerLogin: vi.fn(async () => { throw new IdentityValidationError({ message: 'Code expired.' }); }) }));
    expect(await refusal(result)).toEqual({ status: 400, body: { error: 'Code expired.', code: 'MFA_REFUSED' } });
  });
  it('revokes, sets the cookie, looks up the user, signals, and answers the username', async () => {
    const { result, events } = await runMfa({ pendingToken: 'pt', code: '123456' });
    expect(await result).toEqual({ ok: true, value: { user: { id: 'p1', username: 'owner' } } });
    expect(events).toEqual(['no-store', 'rate', 'revoke', 'cookie:session', 'signed-in:p1']);
  });
  it('falls back to the display name when no user row exists', async () => {
    const { result } = await runMfa({}, mfaDeps({ findUserByPrincipalId: vi.fn(async () => null) }));
    expect(await result).toEqual({ ok: true, value: { user: { id: 'p1', username: 'Owner Name' } } });
  });
});
describe('POST /auth/logout (U-AUTH-1)', () => {
  it('B13 awaits readiness, revokes once, clears both cookies and answers {ok:true}', async () => {
    const { auth, events } = fakeAuthRequest();
    expect(await logoutRoute.handle({ input: {}, deps: { identityReady: Promise.resolve() }, context: auth })).toEqual({ ok: true, value: { ok: true } });
    expect(events).toEqual(['revoke', 'clear']); expect(auth.revokeSessions).toHaveBeenCalledTimes(1);
  });
  it('throws a readiness failure for the host to answer', async () => {
    const { auth } = fakeAuthRequest(); const failed = Promise.reject(new Error('identity down')); failed.catch(() => {});
    await expect(logoutRoute.handle({ input: {}, deps: { identityReady: failed }, context: auth })).rejects.toThrow('identity down');
  });
});
