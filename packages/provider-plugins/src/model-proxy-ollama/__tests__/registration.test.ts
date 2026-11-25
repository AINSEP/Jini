import { describe, expect, it, vi } from 'vitest';
import { createOllamaProxyRegistration } from '../index.js';
import { injectedFetch, makeReq, makeSseRes, okResponse, writtenEvents, mountRegistration } from '../../__tests__/model-proxy-harness.js';

/**
 * The ollama registration's own request and tool-turn policy: what its parser accepts, how it shapes the
 * provider request, and how tool turns run. The daemon's generic route (origin gate, SSE transport, error
 * redaction) is tested in `@jini-ai/daemon`; here the registration is driven directly.
 */
function ollamaBody(...lines: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield `${line}\n`;
    },
  };
}
function ollamaTextLine(content: string): string {
  return JSON.stringify({ model: 'llama3', message: { role: 'assistant', content }, done: false });
}
function ollamaToolCallLine(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    model: 'llama3',
    message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] },
    done: false,
  });
}
function ollamaDoneLine(): string {
  return JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' });
}
const validOllamaBody = {
  apiKey: 'sk-ollama-cloud',
  model: 'llama3',
  baseUrl: 'http://127.0.0.1:11434',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('ollama proxy registration', () => {
  function handler(deps: Readonly<Record<string, unknown>> = {}) {
    return mountRegistration({ registration: createOllamaProxyRegistration(), deps });
  }

  // apiKey is required for Ollama too — an earlier version of this module made it optional on a
  // "local install needs no auth" rationale that did not match the real upstream behavior, whose
  // default target is Ollama Cloud (see `model-proxy.ts`'s BYOK module-doc section).
  it('rejects a missing apiKey with 400, exactly like the other four providers', async () => {
    const fetchMock = vi.fn();
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq({ ...validOllamaBody, apiKey: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe('apiKey must be a non-empty string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-array tools with 400', async () => {
    const fetchMock = vi.fn();
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq({ ...validOllamaBody, tools: 'nope' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe('tools must be an array when provided');
  });

  it('streams NDJSON-sourced SSE events against the native /api/chat endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(ollamaBody(ollamaTextLine('Hello from Ollama'), ollamaDoneLine())));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validOllamaBody), res);

    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello from Ollama' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });

    const [{ url, init }] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(init.headers.authorization).toBe('Bearer sk-ollama-cloud');
  });

  it('forwards optional tools/temperature/maxTokens/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ollamaBody(ollamaDoneLine())));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(
      makeReq({
        ...validOllamaBody,
        tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }],
        temperature: 0.1,
        maxTokens: 256,
        maxToolTurns: 5,
        extraHeaders: { 'X-Custom': 'ollama' },
      }),
      res,
    );
    const [{ init }] = fetchMock.mock.calls[0]!;
    expect(init.headers['X-Custom']).toBe('ollama');
    const body = JSON.parse(init.body);
    expect(body.options.temperature).toBe(0.1);
    expect(body.tools).toHaveLength(1);
  });

  it('invokes the injected ollamaExecuteTool for a tool_calls round and completes the loop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(ollamaBody(ollamaToolCallLine('get_weather', { location: 'SF' }))))
      .mockResolvedValueOnce(okResponse(ollamaBody(ollamaTextLine('Sunny.'), ollamaDoneLine())));
    injectedFetch.mockImplementation(fetchMock);
    const ollamaExecuteTool = vi.fn().mockResolvedValue({ content: '72F' });
    const res = makeSseRes();
    await handler({ ollamaExecuteTool })(makeReq(validOllamaBody), res);
    expect(ollamaExecuteTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_weather', input: { location: 'SF' } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writtenEvents(res).at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
  });

  // Ollama Cloud, not a local install — the corrected default (see module doc's BYOK section).
  // Same class of test as the Anthropic one above (MSG-2): reads the actual `res.write` SSE bytes
  // via `writtenEvents`'s `JSON.parse`, and asserts the bare-base64 image survives into the real
  // continuation request body — proving the live route, not just the adapter in isolation. Ollama's
  // `parseCommon`/registry wiring is identical to every other provider's (see model-proxy.ts's own
  // doc — the ignorance of `messages` contents is uniform across all five providers, not
  // Anthropic-specific), so this closes the same gap MSG-2 investigated for the fifth provider.
  it('round-trips a bare-base64 image-bearing tool result through the full live route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(ollamaBody(ollamaToolCallLine('take_screenshot', {}), ollamaDoneLine())))
      .mockResolvedValueOnce(okResponse(ollamaBody(ollamaTextLine('looks right'), ollamaDoneLine())));
    injectedFetch.mockImplementation(fetchMock);
    const ollamaExecuteTool = vi.fn().mockResolvedValue({ content: 'here is the screenshot', images: ['iVBORw0KGgoAAAANSUhEUg=='] });
    const res = makeSseRes();
    await handler({ ollamaExecuteTool })(makeReq(validOllamaBody), res);

    const events = writtenEvents(res);
    const toolResultEvent = events.find((e) => e.kind === 'tool_result')!;
    expect((toolResultEvent.data as { images?: string[] }).images).toEqual(['iVBORw0KGgoAAAANSUhEUg==']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]![0].init.body);
    const toolMessage = secondRequestBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMessage.images).toEqual(['iVBORw0KGgoAAAANSUhEUg==']);
  });

  it('falls back to https://ollama.com/api/chat when baseUrl is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ollamaBody(ollamaDoneLine())));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq({ apiKey: 'sk-ollama-cloud', model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }), res);
    expect(fetchMock.mock.calls[0]![0].url).toBe('https://ollama.com/api/chat');
  });
});
