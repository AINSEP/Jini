import { describe, expect, it, vi } from 'vitest';
import { createDaemonAuthMiddleware, createRunOwnershipMiddleware, createOwnedRunListHandler } from '../run-credentials.js';

const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() });
describe('run credential Express adapters', () => {
  it('authenticates before reading an unparsed body and overwrites verified principal headers', () => {
    const authorize = vi.fn(() => ({ allowed: true as const, principalHeader: { name: 'x-principal', value: 'verified' } }));
    const req = { method: 'POST', path: '/tools', headers: { 'x-principal': 'spoofed' }, get: () => 'Bearer run', get body(): never { throw new Error('body not parsed'); } };
    const next = vi.fn();
    createDaemonAuthMiddleware({ authorize, authorizationHeaderName: 'authorization' })(req as never, response() as never, next);
    expect(authorize).toHaveBeenCalledWith({ request: { method: 'POST', path: '/tools', headers: { authorization: 'Bearer run' } } }, { validateDelegatedRunId: false });
    expect(req.headers['x-principal']).toBe('verified');
    expect(next).toHaveBeenCalledWith();
  });
  it.each([400, 401, 403, 404, 503] as const)('preserves denial status %s and body without calling the next handler', (status) => {
    const body = { error: { code: 'DENIED', message: 'denied' } };
    const res = response(); const next = vi.fn();
    createDaemonAuthMiddleware({ authorize: () => ({ allowed: false, status, body }), authorizationHeaderName: 'authorization' })({ method: 'GET', path: '/', get: () => undefined } as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(status); expect(res.json).toHaveBeenCalledWith(body); expect(next).not.toHaveBeenCalled();
  });
  it('binds the parsed delegated body in the second authentication gate', () => {
    const authorize = vi.fn(() => ({ allowed: false as const, status: 403 as const, body: { code: 'FORBIDDEN' } }));
    const res = response(); const next = vi.fn();
    createDaemonAuthMiddleware({ authorize, authorizationHeaderName: 'authorization' }, { validateDelegatedRunId: true })({ method: 'POST', path: '/tools', body: { runId: 'foreign' }, get: () => 'Bearer run' } as never, res as never, next);
    expect(authorize.mock.calls[0]).toEqual([{ request: { method: 'POST', path: '/tools', headers: { authorization: 'Bearer run' }, body: { runId: 'foreign' } } }, { validateDelegatedRunId: true }]);
    expect(next).not.toHaveBeenCalled();
  });
  it('uses the ownership decision unchanged and forwards policy failures to Express', async () => {
    const body = { error: { code: 'NOT_FOUND', message: 'run was not found' } };
    const authorize = vi.fn(async () => ({ allowed: false as const, status: 404 as const, body }));
    const req = { params: { runId: 'foreign' }, path: '/runs/foreign/events', get: () => 'principal' };
    const res = response(); const next = vi.fn();
    await createRunOwnershipMiddleware({ authorize, principalHeaderName: 'x-principal', isEventStream: ({ path }) => path.endsWith('/events') })(req as never, res as never, next);
    expect(authorize).toHaveBeenCalledWith({ runId: 'foreign', principalId: 'principal', eventStream: true });
    expect(res.status).toHaveBeenCalledWith(404); expect(res.json).toHaveBeenCalledWith(body); expect(next).not.toHaveBeenCalled();
    const error = new Error('policy failed');
    await createRunOwnershipMiddleware({ authorize: async () => { throw error; }, principalHeaderName: 'x-principal', isEventStream: () => false })(req as never, res as never, next);
    expect(next).toHaveBeenCalledWith(error);
  });
  it('filters the scoped run list and rejects missing principals before listing runs', async () => {
    const listRuns = vi.fn(async () => [{ id: 'own' }, { id: 'foreign' }]);
    const filterOwnedRuns = vi.fn(({ runs }: { runs: readonly { id: string }[]; principalId: string | undefined }) => ({ allowed: true as const, runs: runs.filter(run => run.id === 'own') }));
    const handle = createOwnedRunListHandler({ listRuns, filterOwnedRuns, principalHeaderName: 'x-principal' });
    const res = response(); const next = vi.fn();
    await handle({ query: { contextRef: 'context' }, get: () => 'principal' } as never, res as never, next);
    expect(listRuns).toHaveBeenCalledWith({}, { contextRef: 'context' }); expect(res.json).toHaveBeenCalledWith({ runs: [{ id: 'own' }] });
    listRuns.mockClear();
    await handle({ query: {}, get: () => undefined } as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(401); expect(listRuns).not.toHaveBeenCalled();
  });
  it('forwards an authorizer that throws to Express instead of answering', () => {
    const error = new Error('token store unavailable');
    const res = response(); const next = vi.fn();
    createDaemonAuthMiddleware({ authorize: () => { throw error; }, authorizationHeaderName: 'authorization' })({ method: 'GET', path: '/', get: () => undefined } as never, res as never, next);
    expect(next).toHaveBeenCalledWith(error); expect(res.status).not.toHaveBeenCalled();
  });
  it('passes an allowed ownership decision through, normalizing an empty runId and missing principal to undefined', async () => {
    const authorize = vi.fn(async () => ({ allowed: true as const }));
    const res = response(); const next = vi.fn();
    await createRunOwnershipMiddleware({ authorize, principalHeaderName: 'x-principal', isEventStream: () => false })({ params: { runId: '' }, path: '/runs', get: () => '' } as never, res as never, next);
    expect(authorize).toHaveBeenCalledWith({ runId: undefined, principalId: undefined, eventStream: false });
    expect(next).toHaveBeenCalledWith(); expect(res.status).not.toHaveBeenCalled();
  });
  it('lists without a context filter when contextRef is absent or not a string, and relays a denial or a listing failure', async () => {
    const listRuns = vi.fn(async () => [{ id: 'own' }]);
    const denied = { allowed: false as const, status: 403 as const, body: { code: 'FORBIDDEN' } };
    const res = response(); const next = vi.fn();
    await createOwnedRunListHandler({ listRuns, filterOwnedRuns: () => denied, principalHeaderName: 'x-principal' })({ query: { contextRef: ['a', 'b'] }, get: () => 'principal' } as never, res as never, next);
    expect(listRuns).toHaveBeenCalledWith({}, {});
    expect(res.status).toHaveBeenCalledWith(403); expect(res.json).toHaveBeenCalledWith({ code: 'FORBIDDEN' }); expect(next).not.toHaveBeenCalled();
    const error = new Error('store offline');
    await createOwnedRunListHandler({ listRuns: async () => { throw error; }, filterOwnedRuns: () => denied, principalHeaderName: 'x-principal' })({ query: {}, get: () => 'principal' } as never, res as never, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});

// F1 fix wave (Stryker L8 §4 http/run-credentials.ts:33,75,77).
describe('run credential Express adapters — F1 pins', () => {
  it('an allowed decision WITHOUT principalHeader leaves existing proxy headers untouched', () => {
    const req = { method: 'GET', path: '/', headers: { 'x-principal': 'from-trusted-proxy' }, get: () => 'Bearer proxy' };
    const next = vi.fn();
    createDaemonAuthMiddleware({ authorize: () => ({ allowed: true }), authorizationHeaderName: 'authorization' })(req as never, response() as never, next);
    expect(req.headers).toEqual({ 'x-principal': 'from-trusted-proxy' });
    expect(next).toHaveBeenCalledWith();
  });
  it('a mixed-case principal header name is written lower-cased (Node header map key), overwriting a spoof', () => {
    const req = { method: 'GET', path: '/', headers: { 'x-principal': 'spoofed' } as Record<string, string>, get: () => 'Bearer run' };
    createDaemonAuthMiddleware({ authorize: () => ({ allowed: true, principalHeader: { name: 'X-Principal', value: 'verified' } }), authorizationHeaderName: 'authorization' })(req as never, response() as never, vi.fn());
    expect(req.headers).toEqual({ 'x-principal': 'verified' });
  });
  it('the authorization header is read under the CONFIGURED name and passed under that name', () => {
    const get = vi.fn((name: string) => (name === 'x-daemon-auth' ? 'Bearer t' : undefined));
    const authorize = vi.fn(() => ({ allowed: true as const }));
    createDaemonAuthMiddleware({ authorize, authorizationHeaderName: 'x-daemon-auth' })({ method: 'GET', path: '/p', headers: {}, get } as never, response() as never, vi.fn());
    expect(get).toHaveBeenCalledWith('x-daemon-auth');
    expect(authorize).toHaveBeenCalledWith({ request: { method: 'GET', path: '/p', headers: { 'x-daemon-auth': 'Bearer t' } } }, { validateDelegatedRunId: false });
  });
  it('a missing principal on the run list gets the exact 401 envelope naming the header', async () => {
    const res = response();
    await createOwnedRunListHandler({ listRuns: vi.fn(), filterOwnedRuns: vi.fn(), principalHeaderName: 'x-principal' })({ query: {}, get: () => '' } as never, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'UNAUTHENTICATED', message: 'x-principal is required on run-scoped requests' } });
  });
  it('the principal is read under the configured header name and passed to the filter with the listed runs', async () => {
    const runs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const filterOwnedRuns = vi.fn(() => ({ allowed: true as const, runs: [runs[1]!] }));
    const get = vi.fn((name: string) => (name === 'x-who' ? 'alice' : undefined));
    const res = response();
    await createOwnedRunListHandler({ listRuns: async () => runs, filterOwnedRuns, principalHeaderName: 'x-who' })({ query: { contextRef: '' }, get } as never, res as never, vi.fn());
    expect(filterOwnedRuns).toHaveBeenCalledWith({ runs, principalId: 'alice' });
    expect(res.json).toHaveBeenCalledWith({ runs: [{ id: 'b' }] });
  });
});
