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

it('reports an unexpected lookup failure once, with the run ID, and answers plain words with the same request ID', async () => {
  let handler: RequestHandler | undefined;
  const failure = new Error('boom api_key=SECRETSECRETSECRETSECRET');
  const store = { resolveForRun: vi.fn(async () => { throw failure; }), listPendingForOwner: async () => [] };
  const onInternalError = vi.fn();
  registerAttachmentLookupRoutes({ app: { post: (_path, ...handlers) => { handler = handlers[1]; } }, store }, { onInternalError });
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  if (!handler) throw new Error('the lookup route was not registered');
  await handler({ body: { op: 'resolveForRun', ref: 'r', runId: 'run-7' } } as never, res as never, vi.fn());
  expect(res.status).toHaveBeenCalledWith(500);
  const body = res.json.mock.calls[0]?.[0] as { error: { code: string; message: string; requestId: string } };
  expect(body.error.message).toBe('The attachment could not be looked up. Try again; if it keeps failing, copy the request ID and report this problem.');
  expect(onInternalError).toHaveBeenCalledWith({ source: 'attachment-lookup', runId: 'run-7', error: failure, correlationId: body.error.requestId, logSource: 'attachment-lookup' });
  expect(onInternalError.mock.calls[0]?.[0].error).toBe(failure);
  expect(JSON.stringify(body)).not.toContain('SECRETSECRET');
});
