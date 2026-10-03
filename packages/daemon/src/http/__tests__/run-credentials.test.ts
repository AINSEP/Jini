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
});
