import { test, expect } from 'vitest';
import {
  authorizeDaemonRequest, authorizeRunOwnership, createRunOwnerRegistry, createNodeCredentialCrypto,
  createRouteAccessPolicy, createRunScopedCredentials, listOwnedRuns,
} from '../run-credentials.js';

const crypto = createNodeCredentialCrypto({});
const routes = createRouteAccessPolicy({
  runPathPrefix: '/api/runs', delegatedToolCallsPath: '/api/delegated-tool-calls', eventStreamSuffix: '/events',
  allowedRoutes: [
    { method: 'GET', path: /^\/api\/runs\/[^/]+$/ }, { method: 'POST', path: /^\/api\/runs\/[^/]+\/cancel$/ },
    { method: 'GET', path: /^\/api\/tools\/[^/]+$/ }, { method: 'GET', path: /^\/api\/components\/[^/]+$/ },
    { method: 'GET', path: /^\/api\/active$/ }, { method: 'GET', path: /^\/api\/agents$/ },
    { method: 'POST', path: /^\/api\/delegated-tool-calls$/ },
  ],
});
function harness() {
  const live = new Map([['own', 'alice'], ['sibling', 'alice'], ['other', 'bob']]);
  const credentials = createRunScopedCredentials({ crypto, principalOfLiveRun: ({ runId }) => live.get(runId) });
  const token = credentials.mint({ runId: 'own' });
  const env: Record<string, string | undefined> = { EXAMPLE_TOKEN: 'proxy-token' };
  const gate = (method: string, path: string, authorization?: string, body?: unknown, options: { validateDelegatedRunId?: boolean; exemptPaths?: readonly string[] } = {}) => authorizeDaemonRequest({
    request: { method, path, headers: { authorization, 'x-example-principal': 'bob' }, ...(body !== undefined ? { body } : {}) },
    env, envVarName: 'EXAMPLE_TOKEN', principalHeaderName: 'x-example-principal', authorizationHeaderName: 'authorization', crypto, routes,
  }, { runScopedCallers: credentials, ...options });
  return { live, credentials, token, gate, env };
}

// Generalized decision assertions from the original daemon-auth HTTP suite.
test('missing configuration is 503; missing, malformed and mismatched credentials are 401', () => {
  const h = harness();
  for (const value of [undefined, 'Basic proxy-token', 'Bearer', 'Bearer proxy', 'Bearer proxy-token-more', 'Bearer PROXY-TOKEN']) {
    expect(h.gate('POST', '/api/runs', value)).toMatchObject({ allowed: false, status: 401 });
  }
  expect(h.gate('POST', '/api/runs', 'bEaReR proxy-token')).toEqual({ allowed: true });
  h.env.EXAMPLE_TOKEN = '';
  expect(h.gate('POST', '/api/runs', 'Bearer proxy-token')).toMatchObject({ allowed: false, status: 503 });
  h.env.EXAMPLE_TOKEN = 'later-token';
  expect(h.gate('POST', '/api/runs', 'Bearer later-token')).toEqual({ allowed: true });
});
test('an explicit exemption is exact and never bypasses a presented bearer', () => {
  const h = harness();
  const options = { exemptPaths: ['/health'] };
  expect(h.gate('GET', '/health', undefined, undefined, options)).toEqual({ allowed: true });
  expect(h.gate('GET', '/health/nested', undefined, undefined, options)).toMatchObject({ status: 401 });
  expect(h.gate('GET', '/health', 'Bearer wrong', undefined, options)).toMatchObject({ status: 401 });
});
test('live bridge identity overwrites the supplied principal and cannot address a sibling run', () => {
  const h = harness();
  expect(h.gate('GET', '/api/runs/own', `Bearer ${h.token}`)).toEqual({ allowed: true, principalHeader: { name: 'x-example-principal', value: 'alice' } });
  for (const id of ['sibling', 'other']) {
    expect(h.gate('GET', `/api/runs/${id}`, `Bearer ${h.token}`)).toEqual({ allowed: false, status: 404, body: { error: { code: 'NOT_FOUND', message: `run "${id}" was not found` } } });
    expect(h.gate('POST', `/api/runs/${id}/cancel`, `Bearer ${h.token}`)).toMatchObject({ status: 404 });
    expect(h.gate('GET', `/api/runs/${id}/events`, `Bearer ${h.token}`)).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'run was not found' } } });
  }
  expect(h.gate('GET', '/api/runs/%6fwn', `Bearer ${h.token}`)).toMatchObject({ allowed: true });
  expect(h.gate('GET', '/api/runs/%ZZ', `Bearer ${h.token}`)).toMatchObject({ status: 400 });
  expect(h.gate('POST', '/api/runs', `Bearer ${h.token}`)).toMatchObject({ status: 403 });
  expect(h.gate('GET', '/api/runs', `Bearer ${h.token}`)).toMatchObject({ status: 403 });
  expect(h.gate('GET', '/api/runs/own/events', `Bearer ${h.token}`)).toMatchObject({ status: 403 });
});
test('delegated binding is a second gate after parsing and rejects every foreign body run', () => {
  const h = harness(); const bearer = `Bearer ${h.token}`; const options = { validateDelegatedRunId: true };
  expect(h.gate('POST', '/api/delegated-tool-calls', bearer)).toMatchObject({ allowed: true });
  for (const body of [undefined, null, {}, { runId: 'sibling' }, { runId: 'other' }]) {
    expect(h.gate('POST', '/api/delegated-tool-calls', bearer, body, options)).toMatchObject({ status: 403 });
  }
  expect(h.gate('POST', '/api/delegated-tool-calls', bearer, { runId: 'own' }, options)).toMatchObject({ allowed: true });
  // Post-parsing mode still permits ordinary owned run routes.
  expect(h.gate('GET', '/api/runs/own', bearer, undefined, options)).toMatchObject({ allowed: true });
});
test('liveness, revocation and instance isolation invalidate tokens', () => {
  const h = harness();
  h.live.delete('own');
  expect(h.credentials.resolveCaller({ token: h.token })).toBeUndefined();
  expect(h.gate('GET', '/api/runs/own', `Bearer ${h.token}`)).toMatchObject({ status: 401 });
  h.live.set('own', 'alice'); h.credentials.revoke({ runId: 'own' });
  expect(h.credentials.resolveCaller({ token: h.token })).toBeUndefined();
  expect(harness().credentials.resolveCaller({ token: h.token })).toBeUndefined();
});

// Generalized ownership assertions from run-ownership.test.ts. Socket mounting remains host work.
test('ownership persists until forgotten; lists contain only caller-owned runs', async () => {
  const registry = createRunOwnerRegistry({}); registry.record({ runId: 'own', principalId: 'alice' }); registry.record({ runId: 'other', principalId: 'bob' });
  const args = { registry, runId: 'own', principalId: 'alice', principalHeaderName: 'x-example-principal', eventStream: false, runExists: async () => true };
  expect(await authorizeRunOwnership(args)).toEqual({ allowed: true });
  expect(await authorizeRunOwnership({ ...args, principalId: 'bob' })).toMatchObject({ status: 404 });
  expect(await authorizeRunOwnership({ ...args, principalId: undefined })).toMatchObject({ status: 401 });
  expect(listOwnedRuns({ registry, runs: [{ id: 'own' }, { id: 'other' }, { id: 'orphan' }], principalId: 'alice', principalHeaderName: 'x-example-principal' })).toEqual({ allowed: true, runs: [{ id: 'own' }] });
  expect(listOwnedRuns({ registry, runs: [], principalId: undefined, principalHeaderName: 'x-example-principal' })).toMatchObject({ status: 401 });
  registry.forget({ runId: 'own' });
  expect(registry.ownerOf({ runId: 'own' })).toBeUndefined();
  expect(await authorizeRunOwnership(args)).toMatchObject({ status: 404 });
  expect(await authorizeRunOwnership({ ...args, runExists: async () => { throw new Error('lookup failed'); } })).toMatchObject({ status: 404 });
  expect(await authorizeRunOwnership({ ...args, runExists: async () => false })).toEqual({ allowed: true });
});
