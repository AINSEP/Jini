import { describe, expect, it, vi } from 'vitest';
import { createNodeCredentialCrypto, createRunScopedCredentials } from '../../run-credentials.js';
import { createMessageRelayClaimHandler, registerMessageRelayRoutes } from '../message-relay.js';

it('claim_requires_run_bound_credential', () => {
  const live = new Map([['run-a', 'same-user'], ['run-b', 'same-user'], ['run-c', 'other-user']]);
  const credentials = createRunScopedCredentials({ principalOfLiveRun: ({ runId }) => live.get(runId), crypto: createNodeCredentialCrypto({}) });
  const a = credentials.mint({ runId: 'run-a' });
  const b = credentials.mint({ runId: 'run-b' });
  const c = credentials.mint({ runId: 'run-c' });
  const claimUserMessages = vi.fn(() => [{ id: 'm', seq: 1, text: 'private' }]);
  const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: credentials });
  function request(token: string | undefined, runId = 'run-a', body: unknown = { via: 'tool-result' }) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    handler({ get: () => token ? `Bearer ${token}` : undefined, params: { runId }, body } as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    return res;
  }
  for (const token of [undefined, 'proxy-boot-token', 'forged']) expect(request(token).status).toHaveBeenCalledWith(401);
  for (const token of [b, c]) expect(request(token).status).toHaveBeenCalledWith(404);
  expect(request(a, 'run-a', { via: 'tool-result', runId: 'run-b' }).status).toHaveBeenCalledWith(400);
  expect(claimUserMessages).not.toHaveBeenCalled();
  expect(request(a).json).toHaveBeenCalledWith({ messages: [{ id: 'm', seq: 1, text: 'private' }] });
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'run-a', via: 'tool-result' });
  live.delete('run-a');
  expect(request(a).status).toHaveBeenCalledWith(401);
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
});

it('explicit_loopback_trust_uses_the_path_and_the_same_claim', () => {
  const claimUserMessages = vi.fn(() => []);
  const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages }, runScopedCallers: undefined });
  const json = vi.fn();
  handler({ get: () => undefined, params: { runId: 'local' }, body: { via: 'check_messages' } } as never, { json } as never, vi.fn());
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'local', via: 'check_messages' });
  expect(json).toHaveBeenCalledWith({ messages: [] });
});

// F1 fix wave (Stryker L8 §4 message-relay.ts:23-28,36,42): exact refusal bodies, the body
// validator's hostile-shape table, error forwarding, and route registration.
describe('message-relay — F1 exact refusals', () => {
  const live = new Map([['run-a', 'u'], ['run-b', 'u']]);
  const credentials = createRunScopedCredentials({ principalOfLiveRun: ({ runId }) => live.get(runId), crypto: createNodeCredentialCrypto({}) });
  const a = credentials.mint({ runId: 'run-a' });
  const b = credentials.mint({ runId: 'run-b' });
  function call(opts: { token?: string | undefined; runId?: string | undefined; body?: unknown; resolver?: typeof credentials | undefined; claim?: () => unknown }) {
    const claimUserMessages = vi.fn(opts.claim ?? (() => []));
    const handler = createMessageRelayClaimHandler({ agentExecutor: { claimUserMessages } as never, runScopedCallers: 'resolver' in opts ? opts.resolver : credentials });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    handler({ get: () => (opts.token ? `Bearer ${opts.token}` : undefined), params: { runId: 'runId' in opts ? opts.runId : 'run-a' }, body: 'body' in opts ? opts.body : { via: 'tool-result' } } as never, res as never, next);
    return { res, next, claimUserMessages };
  }

  it('no/unknown credential → 401 UNAUTHENTICATED body', () => {
    for (const token of [undefined, 'garbage']) {
      const { res, claimUserMessages } = call({ token });
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: { code: 'UNAUTHENTICATED', message: 'a live run credential is required' } });
      expect(claimUserMessages).not.toHaveBeenCalled();
    }
  });

  it('another run\'s credential → 404 NOT_FOUND body (no existence oracle)', () => {
    const { res, claimUserMessages } = call({ token: b, runId: 'run-a' });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'run was not found' } });
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it.each([[undefined], ['']])('loopback trust with a missing path runId (%j) → 404, never claims', (runId) => {
    const { res, claimUserMessages } = call({ resolver: undefined, runId, token: undefined });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null], ['array', [{ via: 'tool-result' }]], ['string', 'tool-result'], ['empty object', {}],
    ['unknown via', { via: 'other' }], ['via wrong case', { via: 'Tool-Result' }], ['extra key', { via: 'check_messages', principal: 'x' }],
  ])('a %s body → 400 BAD_REQUEST body', (_l, body) => {
    const { res, claimUserMessages } = call({ token: a, body });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST', message: 'body must contain only via: tool-result or check_messages' } });
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it('a claim that throws is forwarded to next(error), not answered', () => {
    const boom = new Error('fifo broke');
    const { res, next } = call({ token: a, claim: () => { throw boom; } });
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('registers exactly one POST claim route', () => {
    const post = vi.fn();
    registerMessageRelayRoutes({ app: { post } as never, agentExecutor: { claimUserMessages: vi.fn() } as never, runScopedCallers: undefined });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toBe('/api/runs/:runId/messages/claim');
    expect(typeof post.mock.calls[0]![1]).toBe('function');
  });
});
