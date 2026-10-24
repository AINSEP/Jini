import { expect, it, vi } from 'vitest';
import { createNodeCredentialCrypto, createRunScopedCredentials } from '../../run-credentials.js';
import { createMessageRelayClaimHandler } from '../message-relay.js';

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
