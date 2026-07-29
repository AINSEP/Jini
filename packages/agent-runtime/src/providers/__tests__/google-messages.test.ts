import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGoogleToolTurn, type GoogleContent, type GoogleTurnEvent } from '../google-messages.js';

function sseBody(...lines: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield line;
    },
  };
}

function chunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function textCandidate(text: string, finishReason?: string): string {
  return chunk({
    candidates: [
      {
        content: { role: 'model', parts: [{ text }] },
        ...(finishReason ? { finishReason } : {}),
        index: 0,
      },
    ],
  });
}

function functionCallCandidate(name: string, args: unknown, id?: string): string {
  return chunk({
    candidates: [
      {
        content: { role: 'model', parts: [{ functionCall: { name, args, ...(id ? { id } : {}) } }] },
        index: 0,
      },
    ],
  });
}

function usageChunk(usageMetadata: Record<string, unknown>): string {
  return chunk({ usageMetadata });
}

function okResponse(body: AsyncIterable<string>) {
  return { ok: true, status: 200, body, text: async () => '' };
}

const baseContents: GoogleContent[] = [{ role: 'user', parts: [{ text: 'hi' }] }];

describe('runGoogleToolTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a forbidden internal base url without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({
      apiKey: 'goog-test',
      baseUrl: 'http://10.0.0.5',
      model: 'gemini-2.5-flash',
      contents: baseContents,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
    expect(result.finishReason).toBeNull();
  });

  it('reports a network error redacted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed: ECONNRESET')));
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({
      apiKey: 'goog-secret',
      model: 'gemini-2.5-flash',
      contents: baseContents,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'fetch failed: ECONNRESET' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('reports a non-ok JSON error response with status code, redacting the api key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        body: null,
        text: async () => JSON.stringify({ error: { code: 400, message: 'API key not valid: goog-secret', status: 'INVALID_ARGUMENT' } }),
      }),
    );
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({
      apiKey: 'goog-secret',
      model: 'gemini-2.5-flash',
      contents: baseContents,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'API key not valid: [REDACTED]', code: '400' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('falls back to the raw truncated body when the error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, body: null, text: async () => 'gateway exploded' }));
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(events[0]).toEqual({ type: 'error', message: 'gateway exploded', code: '500' });
  });

  it('reports a missing response body as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: null, text: async () => '' }));
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'error', message: 'Google response had no body' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('streams a plain text response through to text_delta/usage events, attaches the api key as an x-goog-api-key header (not a query param), and ends with reason stop', async () => {
    const body = sseBody(textCandidate('Hello'), usageChunk({ promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 }), textCandidate('', 'STOP'));
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({
      apiKey: 'goog-key',
      model: 'gemini-2.5-flash',
      contents: baseContents,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'status', label: 'requesting' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'usage', usage: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 } },
      { type: 'end', reason: 'stop' },
    ]);
    expect(result).toEqual({ finishReason: 'STOP', toolTurns: 0 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(init.headers['x-goog-api-key']).toBe('goog-key');
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers['HTTP-Referer']).toBeUndefined();
  });

  it('merges caller-supplied extraHeaders verbatim (never a hardcoded product-identity header)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(textCandidate('hi', 'STOP'))));
    vi.stubGlobal('fetch', fetchMock);
    await runGoogleToolTurn({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      contents: baseContents,
      onEvent: () => {},
      extraHeaders: { 'X-Caller-App': 'my-app' },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['X-Caller-App']).toBe('my-app');
    expect(Object.keys(init.headers)).not.toContain('X-Title');
  });

  it('includes system/temperature/maxOutputTokens/tools and forwards the abort signal when provided, and omits them when not', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(textCandidate('hi', 'STOP'))));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await runGoogleToolTurn({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      system: 'be terse',
      temperature: 0.5,
      maxOutputTokens: 512,
      tools: [{ functionDeclarations: [{ name: 'get_weather', parameters: { type: 'object', properties: {} } }] }],
      contents: baseContents,
      onEvent: () => {},
      signal: controller.signal,
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.signal).toBe(controller.signal);
    const requestBody = JSON.parse(init.body);
    expect(requestBody.systemInstruction).toEqual({ parts: [{ text: 'be terse' }] });
    expect(requestBody.generationConfig).toEqual({ temperature: 0.5, maxOutputTokens: 512 });
    expect(requestBody.tools).toEqual([{ functionDeclarations: [{ name: 'get_weather', parameters: { type: 'object', properties: {} } }] }]);

    fetchMock.mockClear();
    await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: () => {} });
    const [, initNoExtras] = fetchMock.mock.calls[0]!;
    expect(initNoExtras.signal).toBeUndefined();
    const bodyNoExtras = JSON.parse(initNoExtras.body);
    expect(bodyNoExtras.systemInstruction).toBeUndefined();
    expect(bodyNoExtras.generationConfig).toBeUndefined();
    expect(bodyNoExtras.tools).toBeUndefined();
  });

  it('treats a promptFeedback block reason with no candidates as an error and ends exactly once', async () => {
    const body = sseBody(chunk({ promptFeedback: { blockReason: 'SAFETY' } }), textCandidate('should never be read', 'STOP'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'status', label: 'requesting' },
      { type: 'error', message: 'prompt blocked: SAFETY', code: 'SAFETY' },
      { type: 'end', reason: 'error' },
    ]);
    expect(result.finishReason).toBeNull();
  });

  it('ignores a non-record JSON frame and a malformed JSON keep-alive frame without crashing', async () => {
    const body = sseBody('data: not-json-at-all\n\n', 'data: 42\n\n', 'data: ["not","a","record"]\n\n', textCandidate('hi', 'STOP'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(result.finishReason).toBe('STOP');
    expect(events.map((e) => e.type)).toEqual(['status', 'text_delta', 'end']);
  });

  it('reports a thrown non-Error rejection from fetch by stringifying it', async () => {
    // A patched or proxied global `fetch` can reject with a bare string; reading `.message` off it
    // would produce `undefined` as the user-visible error message.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('socket hang up'));
    const events: GoogleTurnEvent[] = [];
    // A realistic-length key, not this file's usual `'k'`: a single-character secret makes
    // `redactSecrets` rewrite the letter k inside "socket" and hides what is being asserted.
    await runGoogleToolTurn({ apiKey: 'AIzaSyTestKey', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'error', message: 'socket hang up' });
    expect(events).toContainEqual({ type: 'end', reason: 'error' });
  });

  it('skips a candidate that is present but not an object', async () => {
    const body = sseBody(chunk({ candidates: ['not-a-candidate'] }), textCandidate('hi', 'STOP'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(result.finishReason).toBe('STOP');
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([{ type: 'text_delta', delta: 'hi' }]);
  });

  it('accepts a candidate carrying only a finishReason, with no content and no parts array', async () => {
    // Gemini's terminal candidate frequently arrives content-free (and a safety-blocked one always
    // does), so a missing `content`/`parts` must still let the finishReason through.
    const body = sseBody(
      chunk({ candidates: [{ index: 0, finishReason: 'MAX_TOKENS' }] }),
      chunk({ candidates: [{ index: 0, content: { role: 'model' } }] }),
      chunk({ candidates: [{ index: 0, content: { role: 'model', parts: 'not-an-array' } }] }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(result.finishReason).toBe('MAX_TOKENS');
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([]);
  });

  it('skips a non-object part and a functionCall with no name, keeping the usable parts of the same candidate', async () => {
    // A nameless functionCall is unexecutable — forwarding it would fail inside `executeTool`
    // instead of the turn simply ignoring it.
    const body = sseBody(
      chunk({
        candidates: [
          {
            index: 0,
            content: {
              role: 'model',
              parts: ['not-a-part', { functionCall: { args: { a: 1 } } }, { functionCall: { name: 'noop' } }, { text: 'kept' }],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    // `noop` carries no `args` at all, which must default to an empty input object rather than
    // reaching the tool as `undefined`.
    expect(events.filter((e) => e.type === 'tool_use')).toEqual([{ type: 'tool_use', id: 'call_0', name: 'noop', input: {} }]);
    expect(events).toContainEqual({ type: 'text_delta', delta: 'kept' });
  });

  it('replays both the text and the tool calls of a mixed turn into the continuation request', async () => {
    // Gemini can put narration and a functionCall in the same turn. Dropping the text from the
    // replayed `model` content would silently rewrite the conversation the model then reasons over.
    const firstBody = sseBody(textCandidate("Let me check. "), functionCallCandidate('get_weather', { location: 'SF' }, 'fc_1'), textCandidate('', 'STOP'));
    const secondBody = sseBody(textCandidate('Sunny.', 'STOP'));
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.stubGlobal('fetch', fetchMock);

    await runGoogleToolTurn({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      contents: baseContents,
      executeTool: vi.fn().mockResolvedValue({ content: '72F sunny' }),
      onEvent: () => {},
    });

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).contents[1]).toEqual({
      role: 'model',
      parts: [{ text: 'Let me check. ' }, { functionCall: { name: 'get_weather', args: { location: 'SF' }, id: 'fc_1' } }],
    });
  });

  it('runs a full tool-use loop: emits tool_use, invokes executeTool, emits tool_result, and continues to a final stop (loop-continuation is toolCalls.length, not finishReason)', async () => {
    // Gemini's own finishReason enum has no tool-call-specific value — the model can return
    // `finishReason: 'STOP'` on the very same candidate that carries a functionCall part.
    const firstBody = sseBody(functionCallCandidate('get_weather', { location: 'SF' }, 'fc_1'), textCandidate('', 'STOP'));
    const secondBody = sseBody(textCandidate('Sunny.', 'STOP'));
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.stubGlobal('fetch', fetchMock);

    const events: GoogleTurnEvent[] = [];
    const executeTool = vi.fn().mockResolvedValue({ content: '72F sunny' });
    const result = await runGoogleToolTurn({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      contents: baseContents,
      executeTool,
      onEvent: (e) => events.push(e),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith({ id: 'fc_1', name: 'get_weather', input: { location: 'SF' } });
    expect(result).toEqual({ finishReason: 'STOP', toolTurns: 1 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
    expect(events).toContainEqual({ type: 'tool_use', id: 'fc_1', name: 'get_weather', input: { location: 'SF' } });
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'fc_1', content: '72F sunny', isError: false });

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.contents).toHaveLength(3);
    expect(secondCallBody.contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'get_weather', args: { location: 'SF' }, id: 'fc_1' } }],
    });
    expect(secondCallBody.contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'get_weather', id: 'fc_1', response: { content: '72F sunny', isError: false } } }],
    });
  });

  it('synthesizes a call id when the model omits functionCall.id', async () => {
    const body = sseBody(functionCallCandidate('noop', {}), textCandidate('', 'STOP'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_0', name: 'noop', input: {} });
  });

  it('ends with reason stop (no further request) when the model requests a tool but no executeTool is supplied', async () => {
    const body = sseBody(functionCallCandidate('get_weather', {}, 'fc_1'), textCandidate('', 'STOP'));
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'STOP', toolTurns: 0 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
  });

  it('stops the loop with reason max_tool_turns once the bound is hit, without invoking executeTool for the turn that exceeds it', async () => {
    const roundBody = () => sseBody(functionCallCandidate('loop_tool', {}, 'fc_x'), textCandidate('', 'STOP'));
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(roundBody())).mockResolvedValueOnce(okResponse(roundBody()));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'again' });
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      maxToolTurns: 1,
      contents: baseContents,
      executeTool,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'STOP', toolTurns: 1 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'max_tool_turns' }]);
  });

  it('propagates an executeTool error result as isError: true in the tool_result event and the continuation message', async () => {
    const firstBody = sseBody(functionCallCandidate('fail_tool', {}, 'fc_1'), textCandidate('', 'STOP'));
    const secondBody = sseBody(textCandidate('done', 'STOP'));
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'boom', isError: true });
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, executeTool, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'fc_1', content: 'boom', isError: true });
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.contents[2].parts[0].functionResponse.response).toEqual({ content: 'boom', isError: true });
  });

  it('detects a fabricated role marker mid-stream, emits the warning once, ends with reason contaminated, and never emits end twice even though a normal completion follows in the same stream', async () => {
    const body = sseBody(
      textCandidate('safe text\n## user\nmalicious continuation'),
      // Would-be second end site — must never fire.
      usageChunk({ promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }),
      textCandidate('', 'STOP'),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    const endEvents = events.filter((e) => e.type === 'end');
    expect(endEvents).toEqual([{ type: 'end', reason: 'contaminated' }]);
    const markerEvents = events.filter((e) => e.type === 'fabricated_role_marker');
    expect(markerEvents).toHaveLength(1);
    expect(markerEvents[0]).toMatchObject({ type: 'fabricated_role_marker', marker: '## user' });
    expect(events.some((e) => e.type === 'usage')).toBe(false);
    expect(result.finishReason).toBeNull();
  });
});
