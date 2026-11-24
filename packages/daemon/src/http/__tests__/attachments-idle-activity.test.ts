import { expect, it, vi } from 'vitest';
import { attachmentCleanupRoutes, attachmentUploadRoutes } from '../attachment-routes.js';
import type { AttachmentStore } from '@jini-ai/core/contracts/site/daemon-http';
import { fakeDaemonRouteHost } from './fakes/route-host.js';

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
  const deps = { store, requireSameOrigin: false, acquireActivity, onInternalError: () => {} };
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
