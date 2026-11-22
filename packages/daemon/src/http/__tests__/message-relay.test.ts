import { describe, expect, it, vi } from 'vitest';
import { createNodeCredentialCrypto, createRunScopedCredentials } from '../../run-credentials.js';
import { describeRoutes } from '../route-table.js';
import { messageRelayRoutes, MESSAGE_RELAY_CLAIM_PATH } from '../message-relay.js';
import { serveRoutes } from './fakes/serve-routes.js';

const BAD_BODY = { error: { code: 'BAD_REQUEST', message: 'body must contain only via: tool-result or check_messages' } };

function setup(optional: { readonly resolver?: ReturnType<typeof createRunScopedCredentials> | undefined; readonly claim?: () => unknown } = {}) {
  const live = new Map([['run-a', 'same-user'], ['run-b', 'same-user'], ['run-c', 'other-user']]);
  const credentials = createRunScopedCredentials({ principalOfLiveRun: ({ runId }) => live.get(runId), crypto: createNodeCredentialCrypto({}) });
  const claimUserMessages = vi.fn(optional.claim ?? (() => [{ id: 'm', seq: 1, text: 'private' }]));
  const fetch = serveRoutes({ routes: messageRelayRoutes({ agentExecutor: { claimUserMessages: claimUserMessages as never }, runScopedCallers: 'resolver' in optional ? optional.resolver : credentials }) });
  const tokens = { a: credentials.mint({ runId: 'run-a' }), b: credentials.mint({ runId: 'run-b' }), c: credentials.mint({ runId: 'run-c' }) };
  const claim = async ({ token, runId = 'run-a', body = { via: 'tool-result' }, contentType = 'application/json', authorization }: { token?: string | undefined; runId?: string; body?: unknown; contentType?: string | undefined; authorization?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (contentType) headers['content-type'] = contentType;
    if (authorization !== undefined) headers.authorization = authorization;
    else if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(new Request(`http://local/api/runs/${runId}/messages/claim`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    return { status: response.status, type: response.headers.get('content-type'), body: await response.json().catch(() => undefined) as unknown };
  };
  return { claim, claimUserMessages, live, tokens, fetch };
}

it('is one POST claim route with no named gate: the credential check is the route\'s own', () => {
  const routes = messageRelayRoutes({ agentExecutor: { claimUserMessages: vi.fn() as never }, runScopedCallers: undefined });
  expect(describeRoutes({ routes })).toEqual([{ method: 'POST', path: '/api/runs/:runId/messages/claim', gates: [] }]);
  expect(MESSAGE_RELAY_CLAIM_PATH).toBe('/api/runs/:runId/messages/claim');
});

it('claim_requires_run_bound_credential', async () => {
  const { claim, claimUserMessages, live, tokens } = setup();
  for (const token of [undefined, 'proxy-boot-token', 'forged']) expect((await claim({ token })).status).toBe(401);
  for (const token of [tokens.b, tokens.c]) expect((await claim({ token })).status).toBe(404);
  expect((await claim({ token: tokens.a, body: { via: 'tool-result', runId: 'run-b' } })).status).toBe(400);
  expect(claimUserMessages).not.toHaveBeenCalled();
  const ok = await claim({ token: tokens.a });
  expect([ok.status, ok.type, ok.body]).toEqual([200, 'application/json; charset=utf-8', { messages: [{ id: 'm', seq: 1, text: 'private' }] }]);
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'run-a', via: 'tool-result' });
  live.delete('run-a');
  expect((await claim({ token: tokens.a })).status).toBe(401);
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
});

it('explicit_loopback_trust_uses_the_path_and_the_same_claim', async () => {
  const { claim, claimUserMessages } = setup({ resolver: undefined, claim: () => [] });
  expect((await claim({ runId: 'local', body: { via: 'check_messages' } })).body).toEqual({ messages: [] });
  expect(claimUserMessages).toHaveBeenCalledTimes(1);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'local', via: 'check_messages' });
});

describe('message-relay: exact refusals', () => {
  it('no/unknown credential → 401 UNAUTHENTICATED body', async () => {
    const { claim, claimUserMessages } = setup();
    for (const token of [undefined, 'garbage']) {
      expect(await claim({ token })).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'a live run credential is required' } } });
    }
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it('another run\'s credential → 404 NOT_FOUND body (no existence oracle)', async () => {
    const { claim, claimUserMessages, tokens } = setup();
    expect(await claim({ token: tokens.b, runId: 'run-a' })).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'run was not found' } } });
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it.each([
    ['null', 'null'], ['array', '[{"via":"tool-result"}]'], ['string', '"tool-result"'], ['empty object', '{}'], ['no body at all', ''],
    ['unknown via', '{"via":"other"}'], ['via wrong case', '{"via":"Tool-Result"}'], ['extra key', '{"via":"check_messages","principal":"x"}'],
  ])('a %s body → 400 BAD_REQUEST body', async (_label, body) => {
    const { claim, claimUserMessages, tokens } = setup();
    const answer = await claim({ token: tokens.a, body });
    // A non-object JSON text is the body reader's own refusal (it reads only objects and arrays, as the parser in front did); the rest reach the claim's own check.
    expect(answer.status).toBe(400);
    if (!['null', 'string'].includes(_label)) expect(answer.body).toEqual(BAD_BODY);
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it('a body that is not JSON text is read as an empty object, as the parser in front read it: the claim\'s own 400', async () => {
    const { claim, tokens, claimUserMessages } = setup();
    expect((await claim({ token: tokens.a, body: 'via=tool-result', contentType: 'text/plain' })).body).toEqual(BAD_BODY);
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it('the credential and the run are checked before the body is read: a refused caller\'s body is left unread', async () => {
    const { fetch, tokens } = setup();
    for (const [token, runId] of [['forged', 'run-a'], [tokens.b, 'run-a']] as const) {
      const request = new Request(`http://local/api/runs/${runId}/messages/claim`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"via":"tool-result"}' });
      expect((await fetch(request)).status).toBeGreaterThanOrEqual(401);
      expect(request.bodyUsed).toBe(false);
    }
  });

  it('reads at most 8 KiB: one byte over is 413, the limit itself reaches the claim\'s own check (400 for the extra key)', async () => {
    const { claim, tokens } = setup();
    const padded = (size: number) => { const base = '{"via":"tool-result","p":""}'; return `{"via":"tool-result","p":"${'x'.repeat(size - base.length)}"}`; };
    expect(await claim({ token: tokens.a, body: padded(8 * 1024) })).toMatchObject({ status: 400, body: BAD_BODY });
    expect((await claim({ token: tokens.a, body: padded(8 * 1024 + 1) })).status).toBe(413);
  });

  it('a body a 1 KB parser accepted is never refused as too large when written out again (1e20 prints 21 digits)', async () => {
    const { claim, tokens } = setup();
    const numbers = Array.from({ length: 100 }, () => '1e20').join(',');
    expect(await claim({ token: tokens.a, body: `{"via":"tool-result","n":[${numbers}]}` })).toMatchObject({ status: 400, body: BAD_BODY });
  });

  it.each([[undefined], ['']])('loopback trust with a missing path runId (%j) → never claims', async (runId) => {
    const { claimUserMessages } = setup({ resolver: undefined });
    const routes = messageRelayRoutes({ agentExecutor: { claimUserMessages: claimUserMessages as never }, runScopedCallers: undefined });
    const [route] = routes;
    const answer = await route!.handler({ request: new Request('http://local/x', { method: 'POST', body: '{"via":"tool-result"}', headers: { 'content-type': 'application/json' } }), params: runId === undefined ? {} : { runId } });
    expect(answer.status).toBe(404);
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it('a claim that throws is not answered here: it reaches the host\'s own error path', async () => {
    const boom = new Error('fifo broke');
    const { claim, tokens } = setup({ claim: () => { throw boom; } });
    await expect(claim({ token: tokens.a })).rejects.toBe(boom);
  });
});

it('F1: explicit loopback trust still claims by path when a bearer token is presented (no resolver to consult)', async () => {
  const { claim, claimUserMessages } = setup({ resolver: undefined, claim: () => [] });
  expect((await claim({ runId: 'local', authorization: 'Bearer some-token' })).status).toBe(200);
  expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'local', via: 'tool-result' });
});

describe('message-relay: answers and edges', () => {
  it.each(['tool-result', 'check_messages'])('claims through the %s channel for the credential\'s own run', async (via) => {
    const { claim, claimUserMessages, tokens } = setup();
    expect((await claim({ token: tokens.a, body: { via } })).status).toBe(200);
    expect(claimUserMessages).toHaveBeenCalledWith({ runId: 'run-a', via });
  });

  it('every refusal is JSON with Express\'s content type', async () => {
    const { claim, tokens } = setup();
    for (const answer of [await claim({ token: 'forged' }), await claim({ token: tokens.b }), await claim({ token: tokens.a, body: {} })]) {
      expect(answer.type).toBe('application/json; charset=utf-8');
    }
  });

  it('only POST claims: a GET of the same path is not routed here', async () => {
    const { fetch, claimUserMessages, tokens } = setup();
    const answer = await fetch(new Request('http://local/api/runs/run-a/messages/claim', { headers: { authorization: `Bearer ${tokens.a}` } }));
    expect(answer.status).not.toBe(200);
    expect(claimUserMessages).not.toHaveBeenCalled();
  });

  it('a credential resolver that throws is not answered here either', async () => {
    const boom = new Error('registry broke');
    const fetch = serveRoutes({ routes: messageRelayRoutes({ agentExecutor: { claimUserMessages: vi.fn() as never }, runScopedCallers: { resolveCaller: () => { throw boom; } } }) });
    await expect(fetch(new Request('http://local/api/runs/run-a/messages/claim', { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{}' }))).rejects.toBe(boom);
  });
});
