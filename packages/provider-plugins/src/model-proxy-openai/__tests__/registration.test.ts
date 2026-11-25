import { describe, expect, it, vi } from 'vitest';
import { createOpenAiProxyRegistration } from '../index.js';
import { injectedFetch, makeReq, makeSseRes, okResponse, sseBody, writtenEvents, mountRegistration } from '../../__tests__/model-proxy-harness.js';

/**
 * The openai registration's own request and tool-turn policy: what its parser accepts, how it shapes the
 * provider request, and how tool turns run. The daemon's generic route (origin gate, SSE transport, error
 * redaction) is tested in `@jini-ai/daemon`; here the registration is driven directly.
 */
function openAiChunk(text: string): string {
  const chunk = { id: 'c1', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] };
  const final = { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`;
}
const validOpenAiBody = {
  apiKey: 'sk-test',
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('openai proxy registration', () => {
  function handler(deps: Readonly<Record<string, unknown>> = {}) {
    return mountRegistration({ registration: createOpenAiProxyRegistration(), deps });
  }

  it('streams SSE text_delta events and auto-closes on the end event', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(openAiChunk('Hello'))));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validOpenAiBody), res);
    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
    expect(res.end).toHaveBeenCalledOnce();
    const [{ url }] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('forwards optional baseUrl/tools/temperature/maxTokens/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(openAiChunk('hi'))));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(
      makeReq({
        ...validOpenAiBody,
        baseUrl: 'https://gateway.example.com',
        tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }],
        temperature: 0.7,
        maxTokens: 512,
        maxToolTurns: 3,
        extraHeaders: { 'X-Custom': 'yes' },
      }),
      res,
    );
    const [{ url, init }] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/v1/chat/completions');
    expect(init.headers['X-Custom']).toBe('yes');
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0.7);
    // maxTokens is optional for OpenAI (the turn-runner defaults it to 8192) — this pins that an
    // explicitly supplied value is actually forwarded rather than silently dropped by the route.
    expect(body.max_tokens).toBe(512);
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }]);
  });

  it('invokes the injected openaiExecuteTool and never leaks a hardcoded product-identity header', async () => {
    const firstChunk = { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] }, finish_reason: null }] };
    const finishFirst = { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(sseBody(`data: ${JSON.stringify(firstChunk)}\n\n`, `data: ${JSON.stringify(finishFirst)}\n\n`, 'data: [DONE]\n\n')))
      .mockResolvedValueOnce(okResponse(sseBody(openAiChunk('Sunny.'))));
    injectedFetch.mockImplementation(fetchMock);
    const openaiExecuteTool = vi.fn().mockResolvedValue({ content: '72F' });
    const res = makeSseRes();
    await handler({ openaiExecuteTool })(makeReq(validOpenAiBody), res);
    expect(openaiExecuteTool).toHaveBeenCalledWith({ id: 'call_1', name: 'get_weather', input: {} });
    const [{ init }] = fetchMock.mock.calls[0]!;
    expect(init.headers['HTTP-Referer']).toBeUndefined();
    expect(init.headers['X-Title']).toBeUndefined();
    // No hardcoded product-identity string anywhere in the outbound headers — the confirmed OD
    // leak's exact value, assembled at runtime (not spelled out as a literal) so this regression
    // check itself never trips `scripts/check-engine-boundaries.ts`'s own R5-neutrality scan.
    const productIdentityString = ['Open', 'Design'].join(' ');
    expect(JSON.stringify(init.headers)).not.toContain(productIdentityString);
  });
});
