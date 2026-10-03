import { describe, expect, it, vi } from 'vitest';
import { createJsonLineStream, createRoleMarkerGuard, getAgentDef, runOpenAiToolTurn } from '../index.js';
import { PendingAuthCache } from '../providers/pkce.js';
import { AmrModelLoadingCache } from '../amr-model-cache.js';

describe('public required and optional argument objects', () => {
  it('keeps CLI permission and model options separate from prompt inputs', () => {
    const def = getAgentDef({ id: 'claude' });
    expect(def).not.toBeNull();
    const args = def!.buildArgs({ prompt: 'hello', imagePaths: [] }, {
      options: { permissionMode: 'restricted', model: 'sonnet' },
    });
    expect(args).toContain('sonnet');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('delivers parsed frames through an object port and accepts named stream chunks', () => {
    const messages: Array<{ message: unknown; rawLine: string }> = [];
    const stream = createJsonLineStream({ onMessage: args => messages.push(args) });
    stream.feed({ chunk: '{"id":1}\n{"id":' });
    stream.feed({ chunk: '2}\n' });
    stream.flush();
    expect(messages).toEqual([
      { message: { id: 1 }, rawLine: '{"id":1}' },
      { message: { id: 2 }, rawLine: '{"id":2}' },
    ]);
  });

  it('retains role-marker suppression across named chunks', () => {
    const guard = createRoleMarkerGuard({ messageId: 'args-contract' });
    expect(guard.feedText({ text: '## us' })).toBe('');
    expect(guard.feedText({ text: 'er\ninjected' })).toBe('');
    expect(guard.warningEvent()).toMatchObject({ type: 'fabricated_role_marker', messageId: 'args-contract' });
  });

  it('keeps OAuth state single-use with constructor options in the second object', () => {
    const pending = new PendingAuthCache({}, { ttlMs: 60_000 });
    try {
      const value = { serverId: 'provider', authServerIssuer: 'https://issuer.example', tokenEndpoint: 'https://issuer.example/token',
        clientId: 'client', redirectUri: 'http://127.0.0.1/callback', codeVerifier: 'verifier', createdAt: Date.now() };
      pending.put({ state: 'one-use', value });
      expect(pending.consume({ state: 'one-use' })).toEqual(value);
      expect(pending.consume({ state: 'one-use' })).toBeNull();
    } finally {
      pending.stop();
    }
  });

  it('receives cache fetchers through a required object', async () => {
    const cache = new AmrModelLoadingCache({}, { refreshIntervalMs: 60_000 });
    const fetchPreset = vi.fn(async () => [{ id: 'preset', label: 'Preset' }]);
    const fetchRemote = vi.fn(async () => [{ id: 'live', label: 'Live' }]);
    const first = await cache.get({ cacheKey: 'isolated', fetchers: { fetchPreset, fetchRemote } });
    expect(first.source).toBe('preset');
    expect(first.models).toEqual([{ id: 'preset', label: 'Preset' }]);
    expect(fetchPreset).toHaveBeenCalledOnce();
    expect(fetchRemote).toHaveBeenCalledOnce();
  });

  it('uses the supplied HTTP port from the optional object without losing turn settings', async () => {
    const events: unknown[] = [];
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200,
      text: async () => '', body: { async *[Symbol.asyncIterator]() {
        yield Buffer.from('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      } },
    }));
    const result = await runOpenAiToolTurn({ apiKey: 'fake', model: 'example-model', messages: [{ role: 'user', content: 'hello' }],
      onEvent: event => events.push(event) }, { baseUrl: 'http://127.0.0.1', maxTokens: 123, fetchImpl });
    expect(result.finishReason).toBe('stop');
    expect(events).toContainEqual({ type: 'text_delta', delta: 'ok' });
    expect(events.filter((event: any) => event.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = vi.mocked(fetchImpl).mock.calls[0] as unknown as [{ url: string; init: { body: string }; pinnedAddress: undefined }];
    expect(request[0].url).toBe('http://127.0.0.1/v1/chat/completions');
    expect(JSON.parse(request[0].init.body)).toMatchObject({ model: 'example-model', max_tokens: 123 });
  });
});
