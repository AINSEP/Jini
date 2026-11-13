import { describe, expect, it, vi } from 'vitest';
import { createNodeCredentialCrypto, createRunScopedCredentials } from '../../run-credentials.js';
import type { ServerRoute } from '@jini-ai/core/contracts/server';
import { createMessageRelayClaimHandler, registerMessageRelayRoutes } from '../message-relay.js';
import { postClaim } from './message-relay-test-helpers.js';

it('claim_requires_run_bound_credential', async () => {
  const live = new Map([['run-a', 'same-user'], ['run-b', 'same-user'], ['run-c', 'other-user']]);
  const credentials = createRunScopedCredentials({ principalOfLiveRun: ({ runId }) => live.get(runId), crypto: createNodeCredentialCrypto({}) });
  const a = credentials.mint({ runId: 'run-a' });
  const b = credentials.mint({ runId: 'run-b' });
  const c = credentials.mint({ runId: 'run-c' });
  const claimUserMessages = vi.fn(() => [{ id: 'm', seq: 1, text: 'private' }]);
  const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: credentials });
  const request = (token: string | undefined, runId = 'run-a', body: unknown = { via: 'tool-result' }) => postClaim({ handler }, { token, runId, body });
  for (const token of [undefined, 'proxy-boot-token', 'forged']) expect((await request(token)).status).toBe(401);
  for (const token of [b, c]) expect((await request(token)).status).toBe(404);
  expect((await request(a, 'run-a', { via: 'tool-result', runId: 'run-b' })).status).toBe(400);
  expect(claimUserMessages).not.toHaveBeenCalled();
  const granted = await request(a);
  expect([granted.status, await granted.json()]).toEqual([200, { messages: [{ id: 'm', seq: 1, text: 'private' }] }]);
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'run-a', via: 'tool-result' });
  live.delete('run-a');
  expect((await request(a)).status).toBe(401);
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
});

it('explicit_loopback_trust_uses_the_path_and_the_same_claim', async () => {
  const claimUserMessages = vi.fn(() => []);
  const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
  const res = await postClaim({ handler }, { runId: 'local', body: { via: 'check_messages' } });
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'local', via: 'check_messages' });
  expect(await res.json()).toEqual({ messages: [] });
});

// F1 fix wave (Stryker L8 §4 message-relay.ts:23-28,36,42): exact refusal bodies, the body
// validator's hostile-shape table, error forwarding, and route registration.
describe('message-relay — F1 exact refusals', () => {
  const live = new Map([['run-a', 'u'], ['run-b', 'u']]);
  const credentials = createRunScopedCredentials({ principalOfLiveRun: ({ runId }) => live.get(runId), crypto: createNodeCredentialCrypto({}) });
  const a = credentials.mint({ runId: 'run-a' });
  const b = credentials.mint({ runId: 'run-b' });
  async function call(opts: { token?: string | undefined; runId?: string | undefined; body?: unknown; resolver?: typeof credentials | undefined; claim?: () => unknown }) {
    const claimUserMessages = vi.fn(opts.claim ?? (() => []));
    const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages } as never, runScopedCallers: 'resolver' in opts ? opts.resolver : credentials });
    const res = await postClaim({ handler }, { token: opts.token, runId: 'runId' in opts ? opts.runId : 'run-a', body: 'body' in opts ? opts.body : { via: 'tool-result' } });
    return { res, claimUserMessages };
  }

  it('no/unknown credential → 401 UNAUTHENTICATED body', async () => {
    for (const token of [undefined, 'garbage']) {
      const { res, claimUserMessages } = await call({ token });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'a live run credential is required' } });
      expect(claimUserMessages).not.toHaveBeenCalled();
    }
  });

  it('another run\'s credential → 404 NOT_FOUND body (no existence oracle)', async () => {
    const { res, claimUserMessages } = await call({ token: b, runId: 'run-a' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'run was not found' } });
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it.each([[undefined], ['']])('loopback trust with a missing path runId (%j) → 404, never claims', async (runId) => {
    const { res, claimUserMessages } = await call({ resolver: undefined, runId, token: undefined });
    expect(res.status).toBe(404);
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it.each([
    ['array', [{ via: 'tool-result' }]], ['empty object', {}],
    ['unknown via', { via: 'other' }], ['via wrong case', { via: 'Tool-Result' }], ['extra key', { via: 'check_messages', principal: 'x' }],
  ])('a %s body → 400 BAD_REQUEST body', async (_l, body) => {
    const { res, claimUserMessages } = await call({ token: a, body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'body must contain only via: tool-result or check_messages' } });
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  // A bare JSON null or string never reached the handler behind express.json() (strict mode
  // refused it first); the shared body reader keeps that refusal, with its own plain-words message.
  it.each([['null', null], ['string', 'tool-result']])('a %s JSON body → 400 from the body reader, never claims', async (_l, body) => {
    const { res, claimUserMessages } = await call({ token: a, body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'The request body is not valid JSON. Send a JSON object or array.' } });
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it('a claim that throws rejects the handler, so the adapter hands it to the host error path', async () => {
    const boom = new Error('fifo broke');
    await expect(call({ token: a, claim: () => { throw boom; } })).rejects.toBe(boom);
  });

  it('registers exactly one POST claim route on the Server contract', () => {
    const routes: ServerRoute[] = [];
    registerMessageRelayRoutes({ app: { route: (r) => { routes.push(r); } }, agentExecutor: { claimUserMessages: vi.fn() } as never, runScopedCallers: undefined });
    expect(routes.map(({ method, path }) => ({ method, path }))).toEqual([{ method: 'POST', path: '/api/runs/:runId/messages/claim' }]);
    expect(typeof routes[0]!.handler).toBe('function');
  });
});

it('F1: explicit loopback trust still claims by path when a bearer token is presented (no resolver to consult)', async () => {
  const claimUserMessages = vi.fn(() => []);
  const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
  const res = await postClaim({ handler }, { token: 'some-token', runId: 'local' });
  expect(res.status).toBe(200);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'local', via: 'tool-result' });
});
