import { describe, it, expect, vi } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import type { RouteInputContext } from '@jini-ai/core/contracts/server';
import { bootSessionRoute, localBootSessionRoute, OwnerAuthFailure, type BootRedemption } from '../index.js';
import { fakeAuthRequest } from './fake-auth-request.js';

const raw = (body: unknown): RouteInputContext => ({ body, query: {}, params: {} });
async function refusal(promise: unknown) { try { await promise; } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; } throw new Error('expected a refusal'); }
const SESSION: BootRedemption = { kind: 'session', principal: { id: 'owner-1' }, setCookies: ['session=fixture-token'] };
function boot(body: unknown, over: Parameters<typeof fakeAuthRequest>[0] = {}) {
  const fake = fakeAuthRequest(over); const parsed = bootSessionRoute.parse(raw(body)); if (!parsed.ok) throw new Error('total');
  return { ...fake, result: bootSessionRoute.handle({ input: parsed.value, deps: {}, context: fake.auth }) };
}
const policy = (over: Partial<{ enabled: boolean; capability: boolean; request: boolean }> = {}) => {
  const { enabled = true, capability = true, request = true } = over;
  return { enabled, acceptsCapability: () => capability, allowsRequest: () => request };
};
function local(over: Parameters<typeof fakeAuthRequest>[0] = {}) {
  const fake = fakeAuthRequest({ localOwnerSignIn: policy(), ...over });
  return { ...fake, result: localBootSessionRoute.handle({ input: {}, deps: {}, context: fake.auth }) };
}

describe('POST /auth/boot-session (U-AUTH-2)', () => {
  it('B14 refuses a non-loopback caller with 403 before the token is read', async () => {
    const read = vi.fn(() => 'fixture-token'); const body = Object.defineProperty({}, 'token', { get: read, enumerable: true });
    const { result, auth } = boot(body, { loopback: false });
    expect(await refusal(result)).toEqual({ status: 403, body: { error: 'boot-session is loopback-only', code: 'FORBIDDEN' } });
    expect(read).not.toHaveBeenCalled(); expect(auth.redeemBootSession).not.toHaveBeenCalled();
  });
  it('B15 answers an unarmed, a wrong and a spent token with the identical 401', async () => {
    const answers = [];
    for (const token of [undefined, 'wrong', 'spent']) answers.push(await refusal(boot({ token }).result));
    expect(new Set(answers.map(answer => JSON.stringify(answer))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 401, body: { error: 'invalid or spent boot token', code: 'UNAUTHENTICATED' } });
  });
  it('redeems the posted token and answers {user:{id}} after the cookie, then signals sign-in', async () => {
    const redeem = vi.fn(async () => SESSION);
    const { result, events } = boot({ token: 'fixture-token' }, { redeemBootSession: redeem });
    expect(await result).toEqual({ ok: true, value: { user: { id: 'owner-1' } } });
    expect(redeem).toHaveBeenCalledWith({ token: 'fixture-token' });
    expect(events).toEqual(['signed-in:owner-1']);
  });
  it('B16 returns an MFA challenge as a 200 with no-store and no cookie or signal', async () => {
    const body = { mfaRequired: true, pendingToken: 'pending' };
    const { result, events } = boot({ token: 't' }, { redeemBootSession: vi.fn(async (): Promise<BootRedemption> => ({ kind: 'mfa', body })) });
    expect(await result).toEqual({ ok: true, value: body }); expect(events).toEqual(['no-store']);
  });
  it('B17 throws a failed confirmation as an OwnerAuthFailure for the redacted boot-session envelope', async () => {
    const cause = new Error('Boot session confirmation failed');
    const { result, events } = boot({ token: 't' }, { redeemBootSession: vi.fn(async (): Promise<BootRedemption> => ({ kind: 'failure', error: cause })) });
    const thrown = await Promise.resolve(result).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(OwnerAuthFailure); expect((thrown as OwnerAuthFailure).operation).toBe('boot-session'); expect((thrown as OwnerAuthFailure).cause).toBe(cause);
    expect(events).toEqual([]);
  });
  it('lets a repository fault through untouched for the host error chain', async () => {
    const boom = new Error('repository down');
    await expect(boot({ token: 't' }, { redeemBootSession: vi.fn(async () => { throw boom; }) }).result).rejects.toBe(boom);
  });
});
describe('POST /auth/local-boot-session (U-AUTH-2)', () => {
  it('B18 answers 404 when disabled or the capability is refused, before the loopback check', async () => {
    const disabled = { error: 'local owner sign-in is disabled', code: 'NOT_FOUND' };
    expect(await refusal(local({ loopback: false, localOwnerSignIn: policy({ enabled: false }) }).result)).toEqual({ status: 404, body: disabled });
    expect(await refusal(local({ loopback: false, localOwnerSignIn: policy({ capability: false }) }).result)).toEqual({ status: 404, body: disabled });
  });
  it('answers 403 for a non-loopback or cross-origin request', async () => {
    const forbidden = { status: 403, body: { error: 'local owner sign-in requires a same-origin loopback request', code: 'FORBIDDEN' } };
    expect(await refusal(local({ loopback: false }).result)).toEqual(forbidden);
    expect(await refusal(local({ localOwnerSignIn: policy({ request: false }) }).result)).toEqual(forbidden);
  });
  it('B19 keeps an existing session with {user:{id}}: no mint, no cookie, no signal', async () => {
    const { result, auth, events } = local({ currentPrincipal: vi.fn(async () => ({ id: 'staff-1' })) });
    expect(await result).toEqual({ ok: true, value: { user: { id: 'staff-1' } } });
    expect(auth.redeemBootSession).not.toHaveBeenCalled(); expect(events).toEqual(['no-store']);
  });
  it('B20 sets no-store after both checks, then mints a request-local token and signals after the cookie', async () => {
    const redeem = vi.fn(async () => SESSION);
    const { result, events } = local({ redeemBootSession: redeem });
    expect(await result).toEqual({ ok: true, value: { user: { id: 'owner-1' } } });
    expect(redeem).toHaveBeenCalledWith({ token: undefined }, { mintLocal: true });
    expect(events).toEqual(['no-store', 'signed-in:owner-1']);
  });
  it('does not set no-store on a refused request', async () => {
    const { result, events } = local({ loopback: false }); await refusal(result); expect(events).toEqual([]);
  });
});
