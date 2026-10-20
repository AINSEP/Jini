// Branch-by-branch pins for the run-credential gate, taken on the pre-refactor module
// (code-health wave 3). Every refusal asserts its exact status and body so splitting
// authorizeDaemonRequest into steps cannot change a single decision.
import { describe, expect, test } from 'vitest';
import {
  authorizeDaemonRequest, authorizeRunOwnership, createNodeCredentialCrypto, createRouteAccessPolicy,
  createRunOwnerRegistry, createRunScopedCredentials, ensureAgentDaemonToken,
  type CredentialCryptoPort, type RouteAccessPolicy, type RunScopedCallerResolver,
} from '../run-credentials.js';

const crypto = createNodeCredentialCrypto({});
const ENV = 'PIN_TOKEN';
const PROXY = 'proxy-' + 'x'.repeat(20);
const routes = createRouteAccessPolicy({
  runPathPrefix: '/api/runs', delegatedToolCallsPath: '/api/delegated-tool-calls', eventStreamSuffix: '/events',
  allowedRoutes: [
    { method: 'GET', path: /^\/api\/runs\/[^/]+(\/events)?$/ }, { method: 'GET', path: /^\/api\/active$/ },
    { method: 'POST', path: /^\/api\/delegated-tool-calls$/ },
  ],
});
const resolver: RunScopedCallerResolver = {
  resolveCaller: ({ token }) => (token === 'run-own' ? { runId: 'own', principalId: 'alice' } : undefined),
};
type Request = Parameters<typeof authorizeDaemonRequest>[0]['request'];
function gate(
  request: Partial<Request> & { authorization?: string },
  options: Parameters<typeof authorizeDaemonRequest>[1] & { env?: Record<string, string | undefined>; routes?: RouteAccessPolicy } = { runScopedCallers: resolver },
) {
  const { env = { [ENV]: PROXY }, routes: policy = routes, ...rest } = options;
  const { authorization, method = 'GET', path = '/api/active', headers, ...body } = request;
  return authorizeDaemonRequest({
    request: { method, path, headers: headers ?? (authorization === undefined ? {} : { authorization }), ...body },
    env, envVarName: ENV, principalHeaderName: 'x-principal', authorizationHeaderName: 'authorization', crypto, routes: policy,
  }, rest);
}
const unauthenticated = { allowed: false, status: 401, body: { error: `Authorization: Bearer <${ENV}> is required`, code: 'UNAUTHENTICATED' } };
const asAlice = { allowed: true, principalHeader: { name: 'x-principal', value: 'alice' } };

describe('authorizeDaemonRequest exemptions and configuration', () => {
  test('an exempt path without an authorization header is allowed even when unconfigured', () => {
    expect(gate({ path: '/health' }, { exemptPaths: ['/health'], env: {} })).toEqual({ allowed: true });
  });
  test('an exempt path with an empty authorization header still validates', () => {
    expect(gate({ path: '/health', authorization: '' }, { exemptPaths: ['/health'] })).toEqual(unauthenticated);
  });
  test('exemption is exact equality, not prefix', () => {
    expect(gate({ path: '/health/' }, { exemptPaths: ['/health'] })).toEqual(unauthenticated);
  });
  test.each([[{}], [{ [ENV]: '' }]])('unset or empty configuration refuses with 503 (%j)', (env) => {
    expect(gate({ authorization: `Bearer ${PROXY}` }, { env })).toEqual({
      allowed: false, status: 503, body: { error: `the agent daemon is not configured: ${ENV} is unset`, code: 'AGENT_DAEMON_UNCONFIGURED' },
    });
  });
});

describe('authorizeDaemonRequest bearer parsing', () => {
  test.each([`Bearer ${PROXY}`, `bearer\t${PROXY} \t`, `BEARER  ${PROXY}`])('the proxy token is allowed without a principal header (%j)', (authorization) => {
    expect(gate({ authorization })).toEqual({ allowed: true });
  });
  test.each([undefined, '', 'Bearer', 'Bearer ', `Basic ${PROXY}`, `Bearer ${PROXY} extra`, `Bearer${PROXY}`, ` Bearer ${PROXY}`])(
    'a missing or malformed bearer is 401 (%j)', (authorization) => {
      expect(gate(authorization === undefined ? {} : { authorization })).toEqual(unauthenticated);
    });
  test('a malformed run bearer is never offered to the resolver', () => {
    const seen: string[] = [];
    const spy: RunScopedCallerResolver = { resolveCaller: ({ token }) => { seen.push(token); return undefined; } };
    gate({ authorization: 'Bearer run-own extra' }, { runScopedCallers: spy });
    expect(seen).toEqual([]);
  });
  test('a wrong token with no resolver is 401', () => {
    expect(gate({ authorization: 'Bearer run-own' }, {})).toEqual(unauthenticated);
  });
  test('a wrong token the resolver does not know is 401', () => {
    expect(gate({ authorization: 'Bearer nope' })).toEqual(unauthenticated);
  });
  test('the header is read from the configured header name only', () => {
    expect(gate({ headers: { Authorization: `Bearer ${PROXY}` } })).toEqual(unauthenticated);
  });
  test('the proxy token bypasses run binding, the allowlist and URL decoding', () => {
    expect(gate({ authorization: `Bearer ${PROXY}`, method: 'DELETE', path: '/api/runs/%E0%A4%A' })).toEqual({ allowed: true });
  });
});

describe('authorizeDaemonRequest run-scoped binding', () => {
  const run = { authorization: 'Bearer run-own' };
  test('malformed run-id encoding is 400', () => {
    expect(gate({ ...run, path: '/api/runs/%E0%A4%A' })).toEqual({
      allowed: false, status: 400, body: { error: { code: 'BAD_REQUEST', message: 'runId is not valid URL encoding' } },
    });
  });
  test('a non-URIError from the route policy propagates', () => {
    const failing: RouteAccessPolicy = { ...routes, targetRun: () => { throw new TypeError('policy broke'); } };
    expect(() => gate({ ...run }, { runScopedCallers: resolver, routes: failing })).toThrow(new TypeError('policy broke'));
  });
  test('a foreign run is the JSON not-found naming the run', () => {
    expect(gate({ ...run, path: '/api/runs/other' })).toEqual({
      allowed: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'run "other" was not found' } },
    });
  });
  test('a foreign run event stream is the stream not-found without the id (case-insensitive prefix)', () => {
    expect(gate({ ...run, path: '/API/RUNS/other/EVENTS/' })).toEqual({
      allowed: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'run was not found' } },
    });
  });
  test('the decoded run id is what binds', () => {
    expect(gate({ ...run, path: '/api/runs/%6Fwn' })).toEqual(asAlice);
  });
  test('an own-run path outside the allowlist is 403', () => {
    expect(gate({ ...run, method: 'POST', path: '/api/runs/own' })).toEqual({
      allowed: false, status: 403, body: { error: 'a run-scoped credential cannot call POST /api/runs/own', code: 'FORBIDDEN' },
    });
  });
  test('an allowlisted path with no run segment carries the live principal', () => {
    expect(gate({ ...run })).toEqual(asAlice);
  });
  test('an allowlisted own-run path carries the live principal and overwrites a supplied one', () => {
    expect(gate({ headers: { authorization: 'Bearer run-own', 'x-principal': 'mallory' }, path: '/api/runs/own' })).toEqual(asAlice);
  });
});

describe('authorizeDaemonRequest delegated body binding', () => {
  const delegated = { authorization: 'Bearer run-own', method: 'POST', path: '/api/delegated-tool-calls' };
  const mismatch = { allowed: false, status: 403, body: { error: 'a run-scoped credential requires body.runId to match its own run', code: 'FORBIDDEN' } };
  test('without validateDelegatedRunId the body is not checked', () => {
    expect(gate({ ...delegated, body: { runId: 'other' } })).toEqual(asAlice);
  });
  test('with validateDelegatedRunId a matching body.runId is allowed', () => {
    expect(gate({ ...delegated, body: { runId: 'own' } }, { runScopedCallers: resolver, validateDelegatedRunId: true })).toEqual(asAlice);
  });
  test.each([[undefined], [null], ['own'], [['own']], [{}], [{ runId: 'other' }], [{ runId: ['own'] }]])(
    'with validateDelegatedRunId a missing, non-object or foreign body is 403 (%j)', (body) => {
      expect(gate({ ...delegated, ...(body === undefined ? {} : { body }) }, { runScopedCallers: resolver, validateDelegatedRunId: true })).toEqual(mismatch);
    });
  test('with validateDelegatedRunId a non-delegated route ignores the body', () => {
    expect(gate({ authorization: 'Bearer run-own', body: { runId: 'other' } }, { runScopedCallers: resolver, validateDelegatedRunId: true })).toEqual(asAlice);
  });
  test('a GET on the delegated path is not a delegated call', () => {
    const policy = createRouteAccessPolicy({ runPathPrefix: '/api/runs', delegatedToolCallsPath: '/api/delegated-tool-calls', eventStreamSuffix: '/events', allowedRoutes: [{ method: 'GET', path: /^\/api\/delegated-tool-calls$/ }] });
    expect(gate({ ...delegated, method: 'GET', body: { runId: 'other' } }, { runScopedCallers: resolver, validateDelegatedRunId: true, routes: policy })).toEqual(asAlice);
  });
});

describe('createRouteAccessPolicy edges', () => {
  const policy = createRouteAccessPolicy({ runPathPrefix: '/api/runs/', delegatedToolCallsPath: '/d', eventStreamSuffix: '/events', allowedRoutes: [{ method: 'GET', path: /^\/a$/gy }] });
  test('a prefix that already ends in a slash is used as-is', () => {
    expect(policy.targetRun({ path: '/api/runs/r1/x' })).toBe('r1');
  });
  test('an empty run segment targets no run', () => {
    expect(policy.targetRun({ path: '/api/runs//x' })).toBeUndefined();
  });
  test('stateful regex flags cannot alternate the allowlist decision', () => {
    expect([policy.allowsRunScoped({ method: 'GET', path: '/a' }), policy.allowsRunScoped({ method: 'GET', path: '/a' })]).toEqual([true, true]);
  });
});

describe('credential store and token edges', () => {
  test('mint refuses an empty token from the crypto port', () => {
    const empty: Pick<CredentialCryptoPort, 'mintToken' | 'digest'> = { mintToken: () => '', digest: ({ token }) => `d:${token}` };
    const store = createRunScopedCredentials({ crypto: empty, principalOfLiveRun: () => 'alice' });
    expect(() => store.mint({ runId: 'r' })).toThrow(new Error('run credential must be nonempty and unique'));
  });
  test('mint refuses a token whose digest collides with another run', () => {
    const fixed: Pick<CredentialCryptoPort, 'mintToken' | 'digest'> = { mintToken: () => 'same', digest: () => 'd' };
    const store = createRunScopedCredentials({ crypto: fixed, principalOfLiveRun: () => 'alice' });
    store.mint({ runId: 'r1' });
    expect(() => store.mint({ runId: 'r2' })).toThrow(new Error('run credential must be nonempty and unique'));
  });
  test('revoking an unknown run is a no-op', () => {
    const store = createRunScopedCredentials({ crypto, principalOfLiveRun: () => 'alice' });
    const token = store.mint({ runId: 'r1' });
    store.revoke({ runId: 'never' });
    expect(store.resolvePrincipal({ token })).toBe('alice');
  });
  test('ensureAgentDaemonToken refuses an empty minted token and leaves env unset', () => {
    const env: Record<string, string | undefined> = {};
    expect(() => ensureAgentDaemonToken({ env, envVarName: ENV, crypto: { mintToken: () => '' } })).toThrow(new Error('daemon credential must be nonempty'));
    expect(env).toEqual({});
  });
  test.each([undefined, ''])('authorizeRunOwnership lets a request with no run id through (%j)', async (runId) => {
    expect(await authorizeRunOwnership({ runId, principalId: 'alice', principalHeaderName: 'x-principal', registry: createRunOwnerRegistry({}), runExists: async () => true, eventStream: false })).toEqual({ allowed: true });
  });
});
