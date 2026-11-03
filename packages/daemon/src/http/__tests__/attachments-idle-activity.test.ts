import type { Express, Request, Response } from 'express';
import type { AdapterContext } from '@jini-ai/http-kit';
import { expect, it, vi } from 'vitest';
import { registerAttachmentRoutes, type AttachmentStore } from '../attachments.js';

it.each(['upload', 'cleanup'] as const)('%s holds activity through cleanup after the response closes', async kind => {
  type Handler = (req: Request, res: Response) => Promise<void>;
  let upload!: Handler; let cleanup!: Handler;
  const app = {
    post: (_path: string, handler: Handler) => { upload = handler; },
    delete: (_path: string, handler: Handler) => { cleanup = handler; },
  } as unknown as Express;
  let finish!: () => void; let entered!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const cleaning = new Promise<void>(resolve => { entered = resolve; });
  const release = vi.fn();
  const acquireActivity = vi.fn(() => release);
  const store = {
    pruneExpired: async () => { throw new Error('upload aborted'); },
    deleteUnclaimed: async () => { entered(); await pending; },
  } as unknown as AttachmentStore;
  registerAttachmentRoutes({ app, adapter: {} as AdapterContext, deps: {
    store, requireSameOrigin: false, acquireActivity, onInternalError: () => {},
  } });
  const req = { query: { batch: 'batch', name: 'file' }, body: { batchId: 'batch', paths: [] } } as unknown as Request;
  const res = { headersSent: false, status() { return res; }, json() {}, end() {} } as unknown as Response;
  const work = (kind === 'upload' ? upload : cleanup)(req, res);
  await cleaning;
  res.end();
  expect(acquireActivity).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
  finish(); await work;
  expect(release).toHaveBeenCalledTimes(1);
});
