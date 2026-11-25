import { describe, expect, it, vi } from 'vitest';
import { createGoogleProxyRegistration } from '../index.js';
import { injectedFetch, makeReq, makeSseRes, okResponse, sseBody, writtenEvents, mountRegistration } from '../../__tests__/model-proxy-harness.js';

/**
 * The google registration's own request and tool-turn policy: what its parser accepts, how it shapes the
 * provider request, and how tool turns run. The daemon's generic route (origin gate, SSE transport, error
 * redaction) is tested in `@jini-ai/daemon`; here the registration is driven directly.
 */
function googleChunk(text: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }] })}\n\n`;
}
function googleFunctionCallChunk(name: string, args: unknown): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] }, index: 0 }] })}\n\n`;
}
const validGoogleBody = {
  apiKey: 'goog-test',
  model: 'gemini-2.5-flash',
  baseUrl: 'http://127.0.0.1:8444',
  messages: [{ role: 'user', parts: [{ text: 'hi' }] }],
};

describe('google proxy registration', () => {
  function handler(deps: Readonly<Record<string, unknown>> = {}) {
    return mountRegistration({ registration: createGoogleProxyRegistration(), deps });
  }

  it('streams SSE events and sends the uniform `messages` body field as Gemini `contents`', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(googleChunk('Hello from Gemini'))));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validGoogleBody), res);

    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello from Gemini' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });

    const [{ url, init }] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/models/gemini-2.5-flash:streamGenerateContent');
    expect(init.headers['x-goog-api-key']).toBe('goog-test');
    // The HTTP JSON schema stays `messages` across all five providers; only Gemini's own turn-runner
    // renames it to `contents` on the wire (see `parseGoogleProxyRequest`'s doc).
    expect(JSON.parse(init.body).contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('forwards optional system/tools/temperature/maxOutputTokens/maxToolTurns/extraHeaders', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(googleChunk('hi'))));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(
      makeReq({
        ...validGoogleBody,
        system: 'be terse',
        tools: [{ functionDeclarations: [{ name: 'get_weather', parameters: { type: 'object', properties: {} } }] }],
        temperature: 0.9,
        maxOutputTokens: 64,
        maxToolTurns: 2,
        extraHeaders: { 'X-Custom': 'gemini' },
      }),
      res,
    );
    const [{ init }] = fetchMock.mock.calls[0]!;
    expect(init.headers['X-Custom']).toBe('gemini');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'be terse' }] });
    expect(body.generationConfig.temperature).toBe(0.9);
    expect(body.generationConfig.maxOutputTokens).toBe(64);
    expect(body.tools).toHaveLength(1);
  });

  it('invokes the injected googleExecuteTool for a functionCall round and completes the loop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(sseBody(googleFunctionCallChunk('get_weather', { location: 'SF' }))))
      .mockResolvedValueOnce(okResponse(sseBody(googleChunk('Sunny.'))));
    injectedFetch.mockImplementation(fetchMock);
    const googleExecuteTool = vi.fn().mockResolvedValue({ content: '72F' });
    const res = makeSseRes();
    await handler({ googleExecuteTool })(makeReq(validGoogleBody), res);
    expect(googleExecuteTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_weather', input: { location: 'SF' } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writtenEvents(res).at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
  });

  it('falls back to the public Gemini endpoint when baseUrl is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(googleChunk('hi'))));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq({ apiKey: 'goog-test', model: 'gemini-2.5-flash', messages: [{ role: 'user', parts: [{ text: 'hi' }] }] }), res);
    expect(fetchMock.mock.calls[0]![0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
  });
});
