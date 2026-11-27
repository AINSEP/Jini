import { expect, it, vi } from 'vitest';
import { denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { attachmentCleanupRoutes, attachmentUploadRoutes } from '../attachment-routes.js';
import type { AttachmentStore } from '@jini-ai/core/contracts/site/daemon-http';
import { fakeDaemonRouteHost, injectedRecordingReporter } from './fakes/route-host.js';

/** The host's busy lease must outlive the handler's own tidy-up, not just the answer: it is released only when the whole call is done. */
it.each(['upload', 'cleanup'] as const)('%s holds activity until its cleanup finishes', async kind => {
  let finish!: () => void; let entered!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const cleaning = new Promise<void>(resolve => { entered = resolve; });
  const release = vi.fn();
  const acquireActivity = vi.fn(() => release);
  const store = {
    pruneExpired: async () => { throw new Error('upload aborted'); },
    deleteUnclaimed: async () => { entered(); await pending; },
  } as unknown as AttachmentStore;
  const deps = { store, requireSameOrigin: false, acquireActivity, reportInternalError: injectedRecordingReporter({ record: () => {} }) };
  const host = fakeDaemonRouteHost();
  const [route] = (kind === 'upload' ? attachmentUploadRoutes : attachmentCleanupRoutes)({ deps, host });
  const request = kind === 'upload'
    ? new Request('http://local/api/attachments?batch=batch&name=file', { method: 'POST', body: 'x' })
    : new Request('http://local/api/attachments', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batchId: 'batch', paths: [] }) });
  const work = route!.handler({ request, params: {} });
  await cleaning;
  expect(acquireActivity).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
  finish(); await work;
  expect(release).toHaveBeenCalledTimes(1);
});

it('releases the host activity lease when the origin policy refuses a cleanup, leaving the store untouched', async () => {
  const release = vi.fn();
  const acquireActivity = vi.fn(() => release);
  const deleteUnclaimed = vi.fn<AttachmentStore['deleteUnclaimed']>();
  const store = { deleteUnclaimed } as unknown as AttachmentStore;
  const host = fakeDaemonRouteHost({}, { originPolicy: denyAllOrigins });
  const [route] = attachmentCleanupRoutes({ deps: { store, acquireActivity }, host });
  if (!route) throw new Error('attachment cleanup route must be mounted');
  const request = new Request('http://local/api/attachments', {
    method: 'DELETE', headers: { origin: 'http://other.test', 'content-type': 'application/json' },
    body: JSON.stringify({ batchId: 'batch', paths: [] }),
  });
  const response = await route.handler({ request, params: {} });
  expect(response.status).toBe(403);
  expect(request.bodyUsed).toBe(false);
  expect(deleteUnclaimed).not.toHaveBeenCalled();
  expect(acquireActivity.mock.calls).toEqual([[]]);
  expect(release.mock.calls).toEqual([[]]);
});

it('passes the unsupported body encoding through cleanup without touching attachment storage', async () => {
  const deleteUnclaimed = vi.fn<AttachmentStore['deleteUnclaimed']>();
  const store = { deleteUnclaimed } as unknown as AttachmentStore;
  const [route] = attachmentCleanupRoutes({ deps: { store, requireSameOrigin: false }, host: fakeDaemonRouteHost() });
  if (!route) throw new Error('attachment cleanup route must be mounted');
  const request = new Request('http://local/api/attachments', {
    method: 'DELETE', headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
    body: JSON.stringify({ batchId: 'batch', paths: [] }),
  });
  const response = await route.handler({ request, params: {} });
  expect(response.status).toBe(415);
  expect(await response.json()).toEqual({ error: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'This address does not accept compressed request bodies. Send the body uncompressed (no Content-Encoding).',
  } });
  expect(deleteUnclaimed).not.toHaveBeenCalled();
});
