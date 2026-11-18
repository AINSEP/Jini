import { expect, it, vi } from 'vitest';
import { attachmentLookupRoutes } from '../attachment-lookup-routes.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';

const lookup = (fetch: (request: Request) => Promise<Response>, body: unknown) => fetch(jsonRequest({ path: '/internal/attachment-lookup', method: 'POST' }, { body }));

it('serializes an unknown attachment result as explicit null', async () => {
  const resolveForRun = vi.fn(async () => undefined);
  const store = { resolveForRun, listPendingForOwner: async () => [] };
  const fetch = serveRoutes({ routes: attachmentLookupRoutes({ store, host: fakeDaemonRouteHost() }) });
  const response = await lookup(fetch, { op: 'resolveForRun', ref: 'unknown', runId: 'run' });
  expect(resolveForRun).toHaveBeenCalledWith({ ref: 'unknown', runId: 'run' });
  expect([response.status, await response.json()]).toEqual([200, { value: null }]);
});

it('reports an unexpected lookup failure once, with the run ID, and answers plain words with the same request ID', async () => {
  const failure = new Error('boom api_key=SECRETSECRETSECRETSECRET');
  const store = { resolveForRun: vi.fn(async () => { throw failure; }), listPendingForOwner: async () => [] };
  const onInternalError = vi.fn();
  const fetch = serveRoutes({ routes: attachmentLookupRoutes({ store, host: fakeDaemonRouteHost() }, { onInternalError }) });
  const response = await lookup(fetch, { op: 'resolveForRun', ref: 'r', runId: 'run-7' });
  expect(response.status).toBe(500);
  const body = await response.json() as { error: { code: string; message: string; requestId: string } };
  expect(body.error.message).toBe('The attachment could not be looked up. Try again; if it keeps failing, copy the request ID and report this problem.');
  expect(onInternalError).toHaveBeenCalledWith({ source: 'attachment-lookup', runId: 'run-7', error: failure, correlationId: body.error.requestId, logSource: 'attachment-lookup' });
  expect(onInternalError.mock.calls[0]?.[0].error).toBe(failure);
  expect(JSON.stringify(body)).not.toContain('SECRETSECRET');
});
