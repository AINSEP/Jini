/**
 * F1 fix-wave negatives for the run-credential guards (Stryker L8 §2.2, §4 run-credentials).
 * Each case is built from one valid input with exactly one thing wrong, and asserts the specific
 * refusal (status + code + message), so removing any single guard clause fails a test here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  authorizeDaemonRequest, authorizeRunOwnership, createNodeCredentialCrypto, createRouteAccessPolicy,
  createRunOwnerRegistry, createRunScopedCredentials, listOwnedRuns,
} from '../run-credentials.js';

const NOT_FOUND_JSON = (runId: string) => ({ allowed: false, status: 404, body: { error: { code: 'NOT_FOUND', message: `run "${runId}" was not found` } } });
const NOT_FOUND_SSE = { allowed: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'run was not found' } } };

function ownership(overrides: Partial<Parameters<typeof authorizeRunOwnership>[0]> = {}) {
  const registry = createRunOwnerRegistry({});
  registry.record({ runId: 'r-bob', principalId: 'bob' });
  registry.record({ runId: 'r-alice', principalId: 'alice' });
  return { registry, runId: 'r-bob', principalId: 'alice', principalHeaderName: 'x-p', eventStream: false, runExists: vi.fn(async () => true), ...overrides };
}

describe('authorizeRunOwnership — owner known but run record missing', () => {
  it('another principal\'s run is 404 even when runExists says the run is gone (registry wins)', async () => {
    const args = ownership({ runExists: vi.fn(async () => false) });
    expect(await authorizeRunOwnership(args)).toEqual(NOT_FOUND_JSON('r-bob'));
    // The registry answer is final: the existence lookup must not even be consulted.
    expect(args.runExists).not.toHaveBeenCalled();
  });

  it('same, for the event-stream shape: the SSE message never names the run id', async () => {
    const args = ownership({ runExists: vi.fn(async () => false), eventStream: true });
    expect(await authorizeRunOwnership(args)).toEqual(NOT_FOUND_SSE);
  });

  it('owner match allows without consulting runExists', async () => {
    const args = ownership({ runId: 'r-alice' });
    expect(await authorizeRunOwnership(args)).toEqual({ allowed: true });
    expect(args.runExists).not.toHaveBeenCalled();
  });

  it('an unowned but existing run is 404 (cannot be claimed by asking)', async () => {
    const args = ownership({ runId: 'r-orphan', runExists: vi.fn(async () => true) });
    expect(await authorizeRunOwnership(args)).toEqual(NOT_FOUND_JSON('r-orphan'));
    expect(args.runExists).toHaveBeenCalledWith({ runId: 'r-orphan' });
  });

  it.each([
    ['rejects with an Error', async () => { throw new Error('db down'); }],
    ['rejects with a non-Error', async () => { throw 'boom'; }],
  ])('an unowned run whose lookup %s fails CLOSED (404, not allowed)', async (_label, runExists) => {
    expect(await authorizeRunOwnership(ownership({ runId: 'r-orphan', runExists }))).toEqual(NOT_FOUND_JSON('r-orphan'));
  });

  it('only a genuinely absent unowned run passes through to the route\'s own 404', async () => {
    expect(await authorizeRunOwnership(ownership({ runId: 'r-orphan', runExists: async () => false }))).toEqual({ allowed: true });
  });

  it.each([undefined, ''])('missing principal (%j) is 401 with the header name in the message, even for an owned run', async (principalId) => {
    expect(await authorizeRunOwnership(ownership({ principalId, runId: 'r-alice' }))).toEqual({
      allowed: false, status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x-p is required on run-scoped requests' } },
    });
  });
});

describe('listOwnedRuns', () => {
  it('keeps only the caller\'s runs, preserving input order, across ≥3 runs with the caller\'s first, middle and last', () => {
    const registry = createRunOwnerRegistry({});
    for (const [runId, principalId] of [['a1', 'alice'], ['b1', 'bob'], ['a2', 'alice'], ['b2', 'bob'], ['a3', 'alice']] as const) registry.record({ runId, principalId });
    const runs = [{ id: 'a1' }, { id: 'b1' }, { id: 'a2' }, { id: 'orphan' }, { id: 'b2' }, { id: 'a3' }];
    expect(listOwnedRuns({ runs, registry, principalId: 'alice', principalHeaderName: 'x-p' })).toEqual({ allowed: true, runs: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] });
    expect(listOwnedRuns({ runs, registry, principalId: 'bob', principalHeaderName: 'x-p' })).toEqual({ allowed: true, runs: [{ id: 'b1' }, { id: 'b2' }] });
  });
  it('an empty principal is refused with the specific 401 body', () => {
    expect(listOwnedRuns({ runs: [{ id: 'a1' }], registry: createRunOwnerRegistry({}), principalId: '', principalHeaderName: 'x-p' })).toEqual({
      allowed: false, status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x-p is required on run-scoped requests' } },
    });
  });
});

describe('createRouteAccessPolicy', () => {
  it('stateful /g and /y route regexes give the same answer on every repeated call', () => {
    const policy = createRouteAccessPolicy({
      runPathPrefix: '/api/runs', delegatedToolCallsPath: '/api/delegated-tool-calls', eventStreamSuffix: '/events',
      allowedRoutes: [{ method: 'GET', path: /^\/api\/runs\/[^/]+$/g }, { method: 'POST', path: /^\/api\/runs\/[^/]+\/cancel$/y }],
    });
    const answers = [1, 2, 3, 4].flatMap(() => [
      policy.allowsRunScoped({ method: 'GET', path: '/api/runs/r1' }),
      policy.allowsRunScoped({ method: 'POST', path: '/api/runs/r1/cancel' }),
    ]);
    expect(answers).toEqual([true, true, true, true, true, true, true, true]);
  });
  it('keeps non-stateful flags (/i) when stripping /g', () => {
    const policy = createRouteAccessPolicy({
      runPathPrefix: '/api/runs', delegatedToolCallsPath: '/d', eventStreamSuffix: '/events',
      allowedRoutes: [{ method: 'GET', path: /^\/api\/active$/gi }],
    });
    expect([policy.allowsRunScoped({ method: 'GET', path: '/API/ACTIVE' }), policy.allowsRunScoped({ method: 'GET', path: '/API/ACTIVE' })]).toEqual([true, true]);
  });
  it('method must match the route exactly; path regex anchors are respected', () => {
    const policy = createRouteAccessPolicy({
      runPathPrefix: '/api/runs', delegatedToolCallsPath: '/d', eventStreamSuffix: '/events',
      allowedRoutes: [{ method: 'GET', path: /^\/api\/active$/ }, { method: 'POST', path: /^\/api\/runs\/[^/]+\/cancel$/ }],
    });
    expect(policy.allowsRunScoped({ method: 'POST', path: '/api/active' })).toBe(false);
    expect(policy.allowsRunScoped({ method: 'get', path: '/api/active' })).toBe(false);
    expect(policy.allowsRunScoped({ method: 'GET', path: '/x/api/active' })).toBe(false);
    expect(policy.allowsRunScoped({ method: 'GET', path: '/api/active/extra' })).toBe(false);
    // second route matches: `some`, not `every`
    expect(policy.allowsRunScoped({ method: 'POST', path: '/api/runs/r1/cancel' })).toBe(true);
  });
  it('isDelegatedCall needs BOTH POST and the exact path', () => {
    const policy = createRouteAccessPolicy({ runPathPrefix: '/api/runs', delegatedToolCallsPath: '/api/delegated-tool-calls', eventStreamSuffix: '/events', allowedRoutes: [] });
    expect(policy.isDelegatedCall({ method: 'POST', path: '/api/delegated-tool-calls' })).toBe(true);
    expect(policy.isDelegatedCall({ method: 'GET', path: '/api/delegated-tool-calls' })).toBe(false);
    expect(policy.isDelegatedCall({ method: 'POST', path: '/api/delegated-tool-calls/' })).toBe(false);
    expect(policy.isDelegatedCall({ method: 'POST', path: '/api/other' })).toBe(false);
  });
  it('targetRun handles a prefix with/without trailing slash, case-insensitively, and decodes the segment', () => {
    for (const runPathPrefix of ['/api/runs', '/api/runs/']) {
      const policy = createRouteAccessPolicy({ runPathPrefix, delegatedToolCallsPath: '/d', eventStreamSuffix: '/events', allowedRoutes: [] });
      expect(policy.targetRun({ path: '/API/Runs/r%201/events' })).toBe('r 1');
      expect(policy.targetRun({ path: '/api/runs/' })).toBeUndefined();
      expect(policy.targetRun({ path: '/api/runsX/r1' })).toBeUndefined();
      expect(policy.targetRun({ path: '/x/api/runs/r1' })).toBeUndefined();
    }
  });
  it('isEventStream: suffix match ignores one trailing slash and case', () => {
    const policy = createRouteAccessPolicy({ runPathPrefix: '/api/runs', delegatedToolCallsPath: '/d', eventStreamSuffix: '/Events', allowedRoutes: [] });
    expect(policy.isEventStream({ path: '/api/runs/r1/events/' })).toBe(true);
    expect(policy.isEventStream({ path: '/api/runs/r1/EVENTS' })).toBe(true);
    expect(policy.isEventStream({ path: '/api/runs/r1/events/x' })).toBe(false);
  });
});

describe('authorizeDaemonRequest — one broken clause at a time', () => {
  const crypto = createNodeCredentialCrypto({});
  const routes = createRouteAccessPolicy({
    runPathPrefix: '/api/runs', delegatedToolCallsPath: '/api/delegated-tool-calls', eventStreamSuffix: '/events',
    allowedRoutes: [{ method: 'GET', path: /^\/api\/runs\/[^/]+$/ }, { method: 'POST', path: /^\/api\/delegated-tool-calls$/ }],
  });
  const credentials = createRunScopedCredentials({ crypto, principalOfLiveRun: ({ runId }) => (runId === 'own' ? 'alice' : undefined) });
  const token = credentials.mint({ runId: 'own' });
  const gate = (request: { method: string; path: string; headers: Record<string, string | undefined>; body?: unknown }, options: Parameters<typeof authorizeDaemonRequest>[1] = {}, env: Record<string, string | undefined> = { T: 'proxy-token' }) =>
    authorizeDaemonRequest({ request, env, envVarName: 'T', principalHeaderName: 'x-p', authorizationHeaderName: 'authorization', crypto, routes }, { runScopedCallers: credentials, ...options });
  const UNAUTH = { allowed: false, status: 401, body: { error: 'Authorization: Bearer <T> is required', code: 'UNAUTHENTICATED' } };

  it.each([
    ['no header', undefined],
    ['empty', ''],
    ['wrong scheme', 'Basic proxy-token'],
    ['trailing junk word', 'Bearer proxy-token x'],
    ['wrong token', 'Bearer proxy-tokeN'],
    ['unknown run-like token', 'Bearer jrc_definitely-not-minted'],
  ])('%s → exact 401 body', (_l, authorization) => {
    expect(gate({ method: 'GET', path: '/api/runs/own', headers: { authorization } })).toEqual(UNAUTH);
  });

  it.each([[undefined], [''], [{}]])('unconfigured env (%j) → 503 even with a proxy-looking token', (envValue) => {
    const env = typeof envValue === 'string' || envValue === undefined ? { T: envValue } : (envValue as Record<string, string | undefined>);
    expect(gate({ method: 'GET', path: '/api/runs/own', headers: { authorization: 'Bearer proxy-token' } }, {}, env)).toEqual({
      allowed: false, status: 503, body: { error: 'the agent daemon is not configured: T is unset', code: 'AGENT_DAEMON_UNCONFIGURED' },
    });
  });

  it('an exempt path is open only WITHOUT a credential; a bad credential on it is still 401', () => {
    expect(gate({ method: 'GET', path: '/health', headers: {} }, { exemptPaths: ['/health'] })).toEqual({ allowed: true });
    expect(gate({ method: 'GET', path: '/health', headers: { authorization: 'Bearer nope' } }, { exemptPaths: ['/health'] })).toEqual(UNAUTH);
    // exemption is exact equality: a trailing slash is not exempt
    expect(gate({ method: 'GET', path: '/health/', headers: {} }, { exemptPaths: ['/health'] })).toEqual(UNAUTH);
  });

  it('a run credential with no resolver configured is no credential (401), never the proxy', () => {
    expect(authorizeDaemonRequest({ request: { method: 'GET', path: '/api/runs/own', headers: { authorization: `Bearer ${token}` } }, env: { T: 'proxy-token' }, envVarName: 'T', principalHeaderName: 'x-p', authorizationHeaderName: 'authorization', crypto, routes })).toEqual(UNAUTH);
  });

  it('run credential: own run allowed with the server-set principal header', () => {
    expect(gate({ method: 'GET', path: '/api/runs/own', headers: { authorization: `Bearer ${token}` } })).toEqual({ allowed: true, principalHeader: { name: 'x-p', value: 'alice' } });
  });

  it('run credential: a foreign run is the JSON 404 naming that run', () => {
    expect(gate({ method: 'GET', path: '/api/runs/other', headers: { authorization: `Bearer ${token}` } })).toEqual(NOT_FOUND_JSON('other'));
  });

  it('run credential: bad percent-encoding in the run segment is a 400 BAD_REQUEST', () => {
    expect(gate({ method: 'GET', path: '/api/runs/%E0%A4%A', headers: { authorization: `Bearer ${token}` } })).toEqual({
      allowed: false, status: 400, body: { error: { code: 'BAD_REQUEST', message: 'runId is not valid URL encoding' } },
    });
  });

  it('run credential: a route outside the allowlist is 403 FORBIDDEN with the method+path', () => {
    expect(gate({ method: 'DELETE', path: '/api/runs/own', headers: { authorization: `Bearer ${token}` } })).toEqual({
      allowed: false, status: 403, body: { error: 'a run-scoped credential cannot call DELETE /api/runs/own', code: 'FORBIDDEN' },
    });
  });

  it.each([
    ['other run id', { runId: 'other' }],
    ['no runId', {}],
    ['null body', null],
    ['string body', 'own'],
    ['array body', ['own']],
  ])('delegated call with validateDelegatedRunId: %s → 403', (_l, body) => {
    expect(gate({ method: 'POST', path: '/api/delegated-tool-calls', headers: { authorization: `Bearer ${token}` }, body }, { validateDelegatedRunId: true })).toEqual({
      allowed: false, status: 403, body: { error: 'a run-scoped credential requires body.runId to match its own run', code: 'FORBIDDEN' },
    });
  });

  it('delegated call: matching body.runId allowed; mismatch allowed only when validation is off', () => {
    expect(gate({ method: 'POST', path: '/api/delegated-tool-calls', headers: { authorization: `Bearer ${token}` }, body: { runId: 'own' } }, { validateDelegatedRunId: true })).toMatchObject({ allowed: true });
    expect(gate({ method: 'POST', path: '/api/delegated-tool-calls', headers: { authorization: `Bearer ${token}` }, body: { runId: 'other' } })).toMatchObject({ allowed: true });
  });
});
