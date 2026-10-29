import type { RequestHandler } from 'express';
import { expect, it, vi } from 'vitest';
import { createMessageRelayClaimHandler, registerMessageRelayRoutes } from '../message-relay.js';

it('mounts the relay route and forwards executor failures to the host error boundary', () => {
  let handler!: RequestHandler;
  const post = vi.fn((path: string, callback: RequestHandler) => { handler = callback; });
  const failure = new Error('queue unavailable');
  const claimUserMessages = vi.fn(() => { throw failure; });
  registerMessageRelayRoutes({ app: { post } as never, agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
  expect(post).toHaveBeenCalledWith('/api/runs/:runId/messages/claim', handler);
  const json = vi.fn();
  const next = vi.fn();
  handler({ get: () => undefined, params: { runId: 'run' }, body: { via: 'check_messages' } } as never,
    { json } as never, next);
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'run', via: 'check_messages' });
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith(failure);
  expect(json).not.toHaveBeenCalled();
});

it.each([null, [], 'tool-result', {}, { via: 'invalid' }, { via: 'tool-result', principalId: 'forged' }])
  ('rejects malformed claim bodies before consuming messages: %j', body => {
    const claimUserMessages = vi.fn(() => []);
    const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    handler({ get: () => 'Bearer ignored-loopback-token', params: { runId: 'run' }, body } as never, res as never, next);
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST',
      message: 'body must contain only via: tool-result or check_messages' } });
    expect(claimUserMessages).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

it('refuses a missing loopback run id before touching the queue', () => {
  const claimUserMessages = vi.fn(() => []);
  const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  handler({ get: () => undefined, params: {}, body: { via: 'tool-result' } } as never, res as never, vi.fn());
  expect(res.status).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'run was not found' } });
  expect(claimUserMessages).not.toHaveBeenCalled();
});
