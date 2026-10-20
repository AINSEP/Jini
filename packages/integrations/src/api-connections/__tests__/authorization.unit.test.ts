/**
 * @file Unit tests for starting and completing a sign-in: request refusals, which records may
 * start which intent, what the authorization URL carries, and how OAuth core failures map to
 * connection codes while every other failure passes through unchanged. Network-free: no test
 * here reaches a token exchange.
 */
import { describe, expect, it } from 'vitest';
import type { ApiConnectionIntent } from '../types.js';
import { ApiConnectionError } from '../errors.js';
import { completeApiConnectionAuthorization, startApiConnectionAuthorization } from '../authorization.js';
import { KEY, connectedRecord, seedRecord, unitDeps, type UnitDeps } from './fixtures/unit-deps.js';

const CALLBACK = 'http://127.0.0.1:47011/callback';

const start = (deps: UnitDeps, over: Partial<{ intent: ApiConnectionIntent; workspaceId: string; redirectUri: string }> = {},
  optional: { startParams?: Record<string, string> } = {}) =>
  startApiConnectionAuthorization(deps, { workspaceId: 'ws-1', actorId: 'actor-1', intent: 'connect', scopeSetIds: ['files'],
    redirectUri: CALLBACK, ...over }, optional);

const complete = (deps: UnitDeps, callbackParams: Record<string, string>, { redirectUri = CALLBACK, browserBinding = '' } = {}) =>
  completeApiConnectionAuthorization(deps, { workspaceId: 'ws-1', actorId: 'actor-1', redirectUri, callbackParams, browserBinding });

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error);
}

async function refusalCode(promise: Promise<unknown>): Promise<string> {
  const error = await caught(promise);
  if (error instanceof ApiConnectionError) return error.code;
  throw error;
}

function startDescriptorDeps(): UnitDeps {
  const base = unitDeps();
  return unitDeps({ descriptor: { ...base.descriptor, authorizationParams: { public: { prompt: 'consent' }, confidential: { access: 'offline' } },
    startParams: [{ name: 'pick_mode', maxLength: 8 }] } });
}

describe('start: request checks', () => {
  it('refuses an intent it does not know', async () => {
    // Malformed input on purpose: hosts pass intents from untyped request bodies.
    const error = await caught(start(unitDeps(), { intent: 'merge-accounts' as ApiConnectionIntent }));
    expect(error).toMatchObject({ code: 'request-invalid', message: expect.stringContaining('(intent)') });
  });

  it('refuses an empty workspace id before reading any record', async () => {
    const deps = unitDeps({ records: { ...unitDeps().records, read: async () => { throw new Error('must not read'); } } });
    expect(await refusalCode(start(deps, { workspaceId: '' }))).toBe('request-invalid');
  });

  it('refuses a switch when the connection was never created', async () => {
    expect(await refusalCode(start(unitDeps(), { intent: 'switch-account' }))).toBe('not-connected');
  });

  it('refuses a switch when the record has no account (disconnected)', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord({ status: 'disconnected', account: null }));
    expect(await refusalCode(start(deps, { intent: 'switch-account' }))).toBe('not-connected');
  });

  it('stores no attempt when a start is refused', async () => {
    const deps = unitDeps();
    await refusalCode(start(deps, { intent: 'switch-account' }));
    expect(deps.records.attempts.size).toBe(0);
  });
});

describe('start: the authorization request', () => {
  it('returns the derived connection ref and an attempt bound to the record generation', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord({ generation: 4 }));
    const started = await start(deps);
    expect([started.connectionRef, deps.records.attempts.get(started.state)?.generation]).toEqual([KEY, 4]);
  });

  it('sends the client kind parameters and the declared start parameters', async () => {
    const started = await start(startDescriptorDeps(), {}, { startParams: { pick_mode: 'one' } });
    const params = new URL(started.authorizationUrl).searchParams;
    expect([params.get('prompt'), params.get('access'), params.get('pick_mode'), params.get('code_challenge_method')])
      .toEqual(['consent', null, 'one', 'S256']);
  });

  it('requests the scopes the plugin resolved', async () => {
    const started = await start(unitDeps());
    expect(new URL(started.authorizationUrl).searchParams.get('scope')).toBe('acme.files');
  });

  it('maps an OAuth core refusal (unregistered callback URL) to authorization-failed', async () => {
    const error = await caught(start(unitDeps(), { redirectUri: 'http://127.0.0.1:47099/elsewhere' }));
    expect(error instanceof ApiConnectionError && [error.code, error.message.startsWith('Sign-in did not complete: ')])
      .toEqual(['authorization-failed', true]);
  });

  it('passes a record-store failure while storing the attempt through unchanged', async () => {
    const failure = new Error('attempt store unavailable');
    const deps = unitDeps({ records: { ...unitDeps().records, putAttempt: async () => { throw failure; } } });
    expect(await caught(start(deps))).toBe(failure);
  });
});

describe('complete', () => {
  it('refuses a callback URL that does not parse', async () => {
    expect(await refusalCode(complete(unitDeps(), { state: 's', code: 'c' }, { redirectUri: 'not a url' }))).toBe('request-invalid');
  });

  it('maps a declined consent to access-denied and burns the attempt', async () => {
    const deps = unitDeps();
    const started = await start(deps);
    expect(await refusalCode(complete(deps, { state: started.state, error: 'access_denied' }, { browserBinding: started.browserBinding }))).toBe('access-denied');
    expect(deps.records.attempts.size).toBe(0);
  });

  it('maps any other provider error to authorization-failed with the core operator action', async () => {
    const deps = unitDeps();
    const started = await start(deps);
    const error = await caught(complete(deps, { state: started.state, error: 'server_error' }, { browserBinding: started.browserBinding }));
    expect(error instanceof ApiConnectionError && [error.code, error.message.includes('try connecting again')])
      .toEqual(['authorization-failed', true]);
  });

  it('refuses a callback without state as an invalid attempt', async () => {
    expect(await refusalCode(complete(unitDeps(), { code: 'c' }))).toBe('invalid-attempt');
  });

  it('passes a record-store failure while redeeming the attempt through unchanged', async () => {
    const failure = new Error('attempt store unavailable');
    const deps = unitDeps({ records: { ...unitDeps().records, takeAttempt: async () => { throw failure; } } });
    expect(await caught(complete(deps, { state: 'state-1', code: 'c' }))).toBe(failure);
  });
});
