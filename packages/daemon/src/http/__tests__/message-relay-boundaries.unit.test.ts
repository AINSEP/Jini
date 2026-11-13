import type { ServerRoute } from '@jini-ai/core/contracts/server';
import { expect, it, vi } from 'vitest';
import { createMessageRelayClaimHandler, registerMessageRelayRoutes } from '../message-relay.js';
import { postClaim } from './message-relay-test-helpers.js';

it('mounts the relay route and lets executor failures reach the host error boundary', async () => {
  const routes: ServerRoute[] = [];
  const failure = new Error('queue unavailable');
  const claimUserMessages = vi.fn(() => { throw failure; });
  registerMessageRelayRoutes({ app: { route: (r) => { routes.push(r); } }, agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
  expect(routes).toHaveLength(1);
  expect(routes[0]).toMatchObject({ method: 'POST', path: '/api/runs/:runId/messages/claim' });
  // The adapter turns a rejected handler into `next(error)` (Express) or its own 500 (node:http).
  await expect(postClaim({ handler: routes[0]!.handler }, { runId: 'run', body: { via: 'check_messages' } })).rejects.toBe(failure);
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'run', via: 'check_messages' });
});

it.each([[], {}, { via: 'invalid' }, { via: 'tool-result', principalId: 'forged' }])
  ('rejects malformed claim bodies before consuming messages: %j', async body => {
    const claimUserMessages = vi.fn(() => []);
    const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
    const res = await postClaim({ handler }, { token: 'ignored-loopback-token', runId: 'run', body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'BAD_REQUEST',
      message: 'body must contain only via: tool-result or check_messages' } });
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

it('refuses a missing loopback run id before touching the queue', async () => {
  const claimUserMessages = vi.fn(() => []);
  const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
  const res = await postClaim({ handler }, { body: { via: 'tool-result' } });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'run was not found' } });
  expect(claimUserMessages).not.toHaveBeenCalled();
});

it('states the claim body limit itself (1 KiB, as the production host enforces), never the reader default', async () => {
  const claimUserMessages = vi.fn(() => []);
  const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
  const res = await postClaim({ handler }, { runId: 'run', body: { via: 'tool-result', pad: 'x'.repeat(2048) } });
  expect(res.status).toBe(413);
  expect(claimUserMessages).not.toHaveBeenCalled();
});
