import type { RequestHandler } from 'express';
import { expect, it, vi } from 'vitest';
import { registerAttachmentLookupRoutes } from '../attachment-lookup-routes.js';

it('serializes an unknown attachment result as explicit null', async () => {
  let handler!: RequestHandler;
  const resolveForRun = vi.fn(async () => undefined);
  const store = { resolveForRun, listPendingForOwner: async () => [] };
  registerAttachmentLookupRoutes({ app: { post: (_path, ...handlers) => { handler = handlers[1]!; } }, store });
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ body: { op: 'resolveForRun', ref: 'unknown', runId: 'run' } } as never, res as never, vi.fn());
  expect(resolveForRun).toHaveBeenCalledWith({ ref: 'unknown', runId: 'run' });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ value: null });
});
