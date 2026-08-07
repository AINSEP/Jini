import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyGoogleUsage,
  buildGoogleAssistantParts,
  executeGoogleToolCalls,
  googleLoopExitReason,
  handleGoogleBlockedPrompt,
  handleGoogleFunctionCallPart,
  handleGoogleTextPart,
  processGoogleFrame,
  processGoogleRawPart,
  runGoogleToolTurn,
  type GoogleContent,
  type GoogleStreamState,
  type GoogleToolCall,
  type GoogleTurnEvent,
} from '../google-messages.js';
import { pinnedFetch } from '../connection-guard.js';
import { createRoleMarkerGuard } from '../../role-marker-guard.js';

/**
 * `pinnedFetch` (the transport `runSingleGoogleRequest` actually calls, since the DNS-rebinding
 * fix — see `connection-guard.ts`) is mocked instead of global `fetch`: it dials via
 * `node:https`/`node:http`, not `fetch`, so stubbing `globalThis.fetch` no longer intercepts
 * anything. Every other export stays real — only the actual network call is replaced.
 */
vi.mock('../connection-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../connection-guard.js')>();
  return { ...actual, pinnedFetch: vi.fn() };
});

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

function freshGoogleState(): GoogleStreamState {
  return { guard: createRoleMarkerGuard('test'), toolCalls: [], fullText: '', finishReason: null, usage: null };
}

describe('runGoogleToolTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(pinnedFetch).mockReset();
  });

  it('rejects a forbidden internal base url without making any request', async () => {
    const fetchMock = vi.fn();
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockRejectedValue(new Error('fetch failed: ECONNRESET')));
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: false, status: 500, body: null, text: async () => 'gateway exploded' }));
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(events[0]).toEqual({ type: 'error', message: 'gateway exploded', code: '500' });
  });

  it('reports a missing response body as an error', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: true, status: 200, body: null, text: async () => '' }));
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(result.finishReason).toBe('STOP');
    expect(events.map((e) => e.type)).toEqual(['status', 'text_delta', 'end']);
  });

  it('reports a thrown non-Error rejection from fetch by stringifying it', async () => {
    // A patched or proxied global `fetch` can reject with a bare string; reading `.message` off it
    // would produce `undefined` as the user-visible error message.
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockRejectedValue('socket hang up'));
    const events: GoogleTurnEvent[] = [];
    // A realistic-length key, not this file's usual `'k'`: a single-character secret makes
    // `redactSecrets` rewrite the letter k inside "socket" and hides what is being asserted.
    await runGoogleToolTurn({ apiKey: 'AIzaSyTestKey', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'error', message: 'socket hang up' });
    expect(events).toContainEqual({ type: 'end', reason: 'error' });
  });

  it('skips a candidate that is present but not an object', async () => {
    const body = sseBody(chunk({ candidates: ['not-a-candidate'] }), textCandidate('hi', 'STOP'));
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: GoogleTurnEvent[] = [];
    await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_0', name: 'noop', input: {} });
  });

  it('ends with reason stop (no further request) when the model requests a tool but no executeTool is supplied', async () => {
    const body = sseBody(functionCallCandidate('get_weather', {}, 'fc_1'), textCandidate('', 'STOP'));
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: GoogleTurnEvent[] = [];
    const result = await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: (e) => events.push(e) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'STOP', toolTurns: 0 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
  });

  it('stops the loop with reason max_tool_turns once the bound is hit, without invoking executeTool for the turn that exceeds it', async () => {
    const roundBody = () => sseBody(functionCallCandidate('loop_tool', {}, 'fc_x'), textCandidate('', 'STOP'));
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(roundBody())).mockResolvedValueOnce(okResponse(roundBody()));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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

  describe('image support', () => {
    const pngBase64 = Buffer.from('fake-png-bytes').toString('base64');

    it('round-trips an inlineData part in the initial request body, alongside a plain text part', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(textCandidate('hi', 'STOP'))));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const contents: GoogleContent[] = [
        { role: 'user', parts: [{ text: "what's in this image?" }, { inlineData: { mimeType: 'image/png', data: pngBase64 } }] },
      ];
      await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents, onEvent: () => {} });
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.contents[0]).toEqual({
        role: 'user',
        parts: [{ text: "what's in this image?" }, { inlineData: { mimeType: 'image/png', data: pngBase64 } }],
      });
    });

    it('still sends plain-text-only contents unchanged (backward compatibility)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(textCandidate('hi', 'STOP'))));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, onEvent: () => {} });
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    });

    it('folds a tool result screenshot into the same continuation Content as the functionResponse, keeping functionResponse.response.content plain text', async () => {
      const firstBody = sseBody(functionCallCandidate('screenshot', {}, 'fc_1'), textCandidate('', 'STOP'));
      const secondBody = sseBody(textCandidate('looks good', 'STOP'));
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi.fn().mockResolvedValue({
        content: [{ text: 'here is the current render' }, { inlineData: { mimeType: 'image/png', data: pngBase64 } }],
      });
      const events: GoogleTurnEvent[] = [];
      await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, executeTool, onEvent: (e) => events.push(e) });

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(secondCallBody.contents).toHaveLength(3);
      expect(secondCallBody.contents[2]).toEqual({
        role: 'user',
        parts: [
          { functionResponse: { name: 'screenshot', id: 'fc_1', response: { content: 'here is the current render', isError: false } } },
          { text: 'Image output from tool `screenshot` (tool_call_id: fc_1):' },
          { inlineData: { mimeType: 'image/png', data: pngBase64 } },
        ],
      });
      expect(events).toContainEqual({
        type: 'tool_result',
        toolUseId: 'fc_1',
        content: [{ text: 'here is the current render' }, { inlineData: { mimeType: 'image/png', data: pngBase64 } }],
        isError: false,
      });
    });

    it('batches a multi-tool-call turn correctly: all functionResponse parts come first, then one labeled follow-up section covering only the calls that returned images', async () => {
      const firstBody = sseBody(
        chunk({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'get_weather', args: {}, id: 'fc_1' } },
                  { functionCall: { name: 'screenshot', args: {}, id: 'fc_2' } },
                  { functionCall: { name: 'screenshot_2', args: {}, id: 'fc_3' } },
                ],
              },
              index: 0,
              finishReason: 'STOP',
            },
          ],
        }),
      );
      const secondBody = sseBody(textCandidate('ok', 'STOP'));
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi
        .fn()
        .mockResolvedValueOnce({ content: '72F sunny' })
        .mockResolvedValueOnce({ content: [{ inlineData: { mimeType: 'image/png', data: pngBase64 } }] })
        .mockResolvedValueOnce({ content: [{ inlineData: { mimeType: 'image/png', data: `${pngBase64}2` } }] });
      await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, executeTool, onEvent: () => {} });

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      // contents: [baseContents, model(3 functionCalls), user(3 functionResponses + one batched labeled image section)]
      expect(secondCallBody.contents).toHaveLength(3);
      expect(secondCallBody.contents[2]).toEqual({
        role: 'user',
        parts: [
          { functionResponse: { name: 'get_weather', id: 'fc_1', response: { content: '72F sunny', isError: false } } },
          {
            functionResponse: {
              name: 'screenshot',
              id: 'fc_2',
              response: { content: '(tool result included only non-text content; see the accompanying image parts)', isError: false },
            },
          },
          {
            functionResponse: {
              name: 'screenshot_2',
              id: 'fc_3',
              response: { content: '(tool result included only non-text content; see the accompanying image parts)', isError: false },
            },
          },
          { text: 'Image output from tool `screenshot` (tool_call_id: fc_2):' },
          { inlineData: { mimeType: 'image/png', data: pngBase64 } },
          { text: 'Image output from tool `screenshot_2` (tool_call_id: fc_3):' },
          { inlineData: { mimeType: 'image/png', data: `${pngBase64}2` } },
        ],
      });
    });

    it('substitutes a placeholder response.content string when a tool result is image-only', async () => {
      const firstBody = sseBody(functionCallCandidate('screenshot', {}, 'fc_1'), textCandidate('', 'STOP'));
      const secondBody = sseBody(textCandidate('ok', 'STOP'));
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi.fn().mockResolvedValue({ content: [{ inlineData: { mimeType: 'image/png', data: pngBase64 } }] });
      await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, executeTool, onEvent: () => {} });
      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(secondCallBody.contents[2].parts[0].functionResponse.response.content).toBe(
        '(tool result included only non-text content; see the accompanying image parts)',
      );
    });

    it('rejects an unsupported image mimeType as an isError tool_result instead of forwarding it', async () => {
      const firstBody = sseBody(functionCallCandidate('screenshot', {}, 'fc_1'), textCandidate('', 'STOP'));
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(sseBody(textCandidate('ok', 'STOP'))));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi.fn().mockResolvedValue({ content: [{ inlineData: { mimeType: 'image/tiff', data: 'AAAA' } }] });
      const events: GoogleTurnEvent[] = [];
      await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, executeTool, onEvent: (e) => events.push(e) });
      const toolResultEvent = events.find((e) => e.type === 'tool_result');
      expect(toolResultEvent).toMatchObject({ isError: true });
      expect((toolResultEvent as { content: string }).content).toContain('unsupported image mimeType');
    });

    it('rejects an oversized inline image as an isError tool_result', async () => {
      const firstBody = sseBody(functionCallCandidate('screenshot', {}, 'fc_1'), textCandidate('', 'STOP'));
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(sseBody(textCandidate('ok', 'STOP'))));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const oversized = 'A'.repeat(Math.ceil((20 * 1024 * 1024 * 4) / 3) + 100);
      const executeTool = vi.fn().mockResolvedValue({ content: [{ inlineData: { mimeType: 'image/png', data: oversized } }] });
      const events: GoogleTurnEvent[] = [];
      await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, executeTool, onEvent: (e) => events.push(e) });
      const toolResultEvent = events.find((e) => e.type === 'tool_result');
      expect(toolResultEvent).toMatchObject({ isError: true });
      expect((toolResultEvent as { content: string }).content).toContain('20 MB inline-data base64 size guard');
    });

    it('preserves an executeTool isError:true alongside a rejected image (validation failure still wins the message)', async () => {
      const firstBody = sseBody(functionCallCandidate('screenshot', {}, 'fc_1'), textCandidate('', 'STOP'));
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(sseBody(textCandidate('ok', 'STOP'))));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi.fn().mockResolvedValue({ content: 'plain error text', isError: true });
      const events: GoogleTurnEvent[] = [];
      await runGoogleToolTurn({ apiKey: 'k', model: 'gemini-2.5-flash', contents: baseContents, executeTool, onEvent: (e) => events.push(e) });
      expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'fc_1', content: 'plain error text', isError: true });
    });
  });

  describe('thoughtSignature', () => {
    /**
     * Regression cover for a measured production break: every currently-served Gemini model
     * rejects a tool continuation whose `functionCall` part carries no `thoughtSignature`, with
     * HTTP 400 "Function call is missing a thought_signature in functionCall parts". The whole
     * loop failed before the model evaluated anything, so this is not a quality nicety.
     *
     * The shape is the easy thing to get wrong: `thoughtSignature` is a SIBLING of `functionCall`
     * on the same `Part`, not a field inside it. Verified against a live response.
     */
    function signedFunctionCallCandidate(name: string, args: unknown, id: string, signature: string): string {
      return chunk({
        candidates: [
          { content: { role: 'model', parts: [{ functionCall: { name, args, id }, thoughtSignature: signature }] }, index: 0 },
        ],
      });
    }

    it('echoes the thoughtSignature back on the continuation, verbatim and as a sibling of functionCall', async () => {
      const SIGNATURE = 'EukCCuYCARFNMg+HEX+iufpVJfgG/opaque==';
      const firstBody = sseBody(signedFunctionCallCandidate('render_preview', {}, 'fc_1', SIGNATURE), textCandidate('', 'STOP'));
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(sseBody(textCandidate('done', 'STOP'))));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);

      await runGoogleToolTurn({
        apiKey: 'k',
        model: 'gemini-2.5-flash',
        contents: baseContents,
        executeTool: vi.fn().mockResolvedValue({ content: 'ok' }),
        onEvent: () => {},
      });

      const continuation = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as { contents: GoogleContent[] };
      const modelContent = continuation.contents.find((c) => c.role === 'model');
      const callPart = modelContent?.parts.find((p) => 'functionCall' in p) as unknown as Record<string, unknown>;

      // Sibling, not nested — asserted explicitly, because nesting it inside `functionCall` is the
      // natural-looking mistake and would sail through a loose `args: unknown`.
      expect(callPart.thoughtSignature).toBe(SIGNATURE);
      expect((callPart.functionCall as Record<string, unknown>).thoughtSignature).toBeUndefined();
    });

    it('omits thoughtSignature entirely when the response carried none, rather than sending an empty string', async () => {
      // A `functionCall` with no signature is legal (older/non-thinking paths). An empty-string
      // signature is NOT — the API reads it as malformed rather than as "absent", so "absent" and
      // "empty" must stay distinguishable all the way to the wire.
      const firstBody = sseBody(functionCallCandidate('render_preview', {}, 'fc_1'), textCandidate('', 'STOP'));
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(sseBody(textCandidate('done', 'STOP'))));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);

      await runGoogleToolTurn({
        apiKey: 'k',
        model: 'gemini-2.5-flash',
        contents: baseContents,
        executeTool: vi.fn().mockResolvedValue({ content: 'ok' }),
        onEvent: () => {},
      });

      const continuation = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as { contents: GoogleContent[] };
      const callPart = continuation.contents.find((c) => c.role === 'model')?.parts.find((p) => 'functionCall' in p) as unknown as Record<string, unknown>;
      expect('thoughtSignature' in callPart).toBe(false);
    });
  });
});

describe('unit: applyGoogleUsage', () => {
  it('records usage and emits a usage event when usageMetadata is present', () => {
    const state = freshGoogleState();
    const events: GoogleTurnEvent[] = [];
    applyGoogleUsage(state, { usageMetadata: { totalTokenCount: 42 } }, (e) => events.push(e));
    expect(state.usage).toEqual({ totalTokenCount: 42 });
    expect(events).toEqual([{ type: 'usage', usage: { totalTokenCount: 42 } }]);
  });

  it('is a no-op when usageMetadata is absent or not a record', () => {
    const state = freshGoogleState();
    const events: GoogleTurnEvent[] = [];
    applyGoogleUsage(state, {}, (e) => events.push(e));
    applyGoogleUsage(state, { usageMetadata: 'not-a-record' }, (e) => events.push(e));
    expect(state.usage).toBeNull();
    expect(events).toHaveLength(0);
  });
});

describe('unit: handleGoogleBlockedPrompt', () => {
  it('emits an error event and reports blocked when promptFeedback.blockReason is a string', () => {
    const events: GoogleTurnEvent[] = [];
    const blocked = handleGoogleBlockedPrompt({ promptFeedback: { blockReason: 'SAFETY' } }, (e) => events.push(e));
    expect(blocked).toBe(true);
    expect(events).toEqual([{ type: 'error', message: 'prompt blocked: SAFETY', code: 'SAFETY' }]);
  });

  it('reports not-blocked and emits nothing when promptFeedback is absent', () => {
    const events: GoogleTurnEvent[] = [];
    expect(handleGoogleBlockedPrompt({}, (e) => events.push(e))).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('reports not-blocked when promptFeedback is present but blockReason is not a string', () => {
    const events: GoogleTurnEvent[] = [];
    expect(handleGoogleBlockedPrompt({ promptFeedback: { blockReason: 42 } }, (e) => events.push(e))).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe('unit: handleGoogleTextPart', () => {
  it('appends safe text to fullText and emits a text_delta event', () => {
    const state = freshGoogleState();
    const events: GoogleTurnEvent[] = [];
    const result = handleGoogleTextPart(state, 'hello', (e) => events.push(e));
    expect(result).toBe('continue');
    expect(state.fullText).toBe('hello');
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }]);
  });

  it('returns "break" and emits a warning once a fabricated role marker contaminates the text', () => {
    const state = freshGoogleState();
    const events: GoogleTurnEvent[] = [];
    const result = handleGoogleTextPart(state, 'safe text\n## user\nmalicious continuation', (e) => events.push(e));
    expect(result).toBe('break');
    expect(events.some((e) => e.type === 'fabricated_role_marker')).toBe(true);
  });
});

describe('unit: handleGoogleFunctionCallPart', () => {
  it('pushes a tool call and emits tool_use, carrying thoughtSignature only when non-empty', () => {
    const state = freshGoogleState();
    const events: GoogleTurnEvent[] = [];
    handleGoogleFunctionCallPart(
      state,
      { functionCall: { name: 'render', args: { a: 1 }, id: 'call_1' }, thoughtSignature: 'sig' },
      (e) => events.push(e),
    );
    expect(state.toolCalls).toEqual([{ id: 'call_1', name: 'render', input: { a: 1 }, thoughtSignature: 'sig' }]);
    expect(events).toEqual([{ type: 'tool_use', id: 'call_1', name: 'render', input: { a: 1 } }]);
  });

  it('synthesizes a call id from the current toolCalls length when the part omits one', () => {
    const state = freshGoogleState();
    state.toolCalls.push({ id: 'existing', name: 'x', input: {} });
    handleGoogleFunctionCallPart(state, { functionCall: { name: 'render', args: {} } }, () => {});
    expect(state.toolCalls[1]?.id).toBe('call_1');
  });

  it('omits thoughtSignature entirely when the part carries an empty string (absent and empty must stay distinguishable)', () => {
    const state = freshGoogleState();
    handleGoogleFunctionCallPart(state, { functionCall: { name: 'render', args: {} }, thoughtSignature: '' }, () => {});
    expect('thoughtSignature' in state.toolCalls[0]!).toBe(false);
  });

  it('is a no-op when functionCall.name is missing', () => {
    const state = freshGoogleState();
    handleGoogleFunctionCallPart(state, { functionCall: { args: {} } }, () => {});
    expect(state.toolCalls).toHaveLength(0);
  });
});

describe('unit: processGoogleRawPart', () => {
  it('returns "continue" for a non-record part', () => {
    const state = freshGoogleState();
    expect(processGoogleRawPart(state, 'not-a-record', () => {})).toBe('continue');
  });

  it('dispatches a text part to handleGoogleTextPart and returns its outcome', () => {
    const state = freshGoogleState();
    const result = processGoogleRawPart(state, { text: 'hi' }, () => {});
    expect(result).toBe('continue');
    expect(state.fullText).toBe('hi');
  });

  it('ignores an empty-string text part (falls through to the functionCall check, finds none, continues)', () => {
    const state = freshGoogleState();
    expect(processGoogleRawPart(state, { text: '' }, () => {})).toBe('continue');
    expect(state.fullText).toBe('');
  });

  it('dispatches a functionCall part to handleGoogleFunctionCallPart', () => {
    const state = freshGoogleState();
    processGoogleRawPart(state, { functionCall: { name: 'f', args: {} } }, () => {});
    expect(state.toolCalls).toHaveLength(1);
  });

  it('is a no-op for a part with neither text nor functionCall (an unrecognized part kind)', () => {
    const state = freshGoogleState();
    expect(processGoogleRawPart(state, { inlineData: { mimeType: 'image/png', data: 'x' } }, () => {})).toBe('continue');
    expect(state.toolCalls).toHaveLength(0);
    expect(state.fullText).toBe('');
  });
});

describe('unit: processGoogleFrame', () => {
  it('reports "end"/"error" when candidates is empty and promptFeedback carries a block reason', () => {
    const state = freshGoogleState();
    const events: GoogleTurnEvent[] = [];
    const outcome = processGoogleFrame(state, { candidates: [], promptFeedback: { blockReason: 'SAFETY' } }, (e) => events.push(e));
    expect(outcome).toEqual({ action: 'end', reason: 'error' });
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('reports "continue" when there is no candidate and no block reason', () => {
    const state = freshGoogleState();
    expect(processGoogleFrame(state, {}, () => {})).toEqual({ action: 'continue' });
  });

  it('reports "continue" and skips entirely when the first candidate is present but not a record (a malformed frame)', () => {
    const state = freshGoogleState();
    expect(processGoogleFrame(state, { candidates: ['not-a-record'] }, () => {})).toEqual({ action: 'continue' });
    expect(state.finishReason).toBeNull();
  });

  it('records finishReason from the candidate even with no content/parts', () => {
    const state = freshGoogleState();
    const outcome = processGoogleFrame(state, { candidates: [{ finishReason: 'STOP' }] }, () => {});
    expect(outcome).toEqual({ action: 'continue' });
    expect(state.finishReason).toBe('STOP');
  });

  it('reports "end"/"contaminated" when a part in the candidate trips the role-marker guard', () => {
    const state = freshGoogleState();
    const events: GoogleTurnEvent[] = [];
    const outcome = processGoogleFrame(
      state,
      { candidates: [{ content: { parts: [{ text: 'safe\n## user\nmalicious' }] } }] },
      (e) => events.push(e),
    );
    expect(outcome).toEqual({ action: 'end', reason: 'contaminated' });
  });

  it('also applies usageMetadata alongside a candidate in the same frame', () => {
    const state = freshGoogleState();
    const events: GoogleTurnEvent[] = [];
    processGoogleFrame(state, { usageMetadata: { totalTokenCount: 7 }, candidates: [{ finishReason: 'STOP' }] }, (e) => events.push(e));
    expect(state.usage).toEqual({ totalTokenCount: 7 });
    expect(events.some((e) => e.type === 'usage')).toBe(true);
  });
});

describe('unit: googleLoopExitReason', () => {
  it('returns "stop" when there are no tool calls', () => {
    expect(googleLoopExitReason({ finishReason: 'STOP', toolCalls: [], text: '' }, 0, 8)).toBe('stop');
  });

  it('returns "max_tool_turns" once toolTurns reaches the ceiling', () => {
    const outcome = { finishReason: null, toolCalls: [{ id: '1', name: 'f', input: {} }], text: '' };
    expect(googleLoopExitReason(outcome, 8, 8)).toBe('max_tool_turns');
  });

  it('returns null (continue the loop) when there are pending tool calls under the ceiling', () => {
    const outcome = { finishReason: null, toolCalls: [{ id: '1', name: 'f', input: {} }], text: '' };
    expect(googleLoopExitReason(outcome, 2, 8)).toBeNull();
  });
});

describe('unit: buildGoogleAssistantParts', () => {
  it('omits the text part entirely when text is empty', () => {
    const parts = buildGoogleAssistantParts('', []);
    expect(parts).toEqual([]);
  });

  it('includes text followed by one functionCall part per call, carrying thoughtSignature only when present', () => {
    const calls: GoogleToolCall[] = [
      { id: 'c1', name: 'f1', input: { a: 1 }, thoughtSignature: 'sig' },
      { id: 'c2', name: 'f2', input: {} },
    ];
    const parts = buildGoogleAssistantParts('thinking...', calls);
    expect(parts).toEqual([
      { text: 'thinking...' },
      { functionCall: { name: 'f1', args: { a: 1 }, id: 'c1' }, thoughtSignature: 'sig' },
      { functionCall: { name: 'f2', args: {}, id: 'c2' } },
    ]);
    expect('thoughtSignature' in parts[2]!).toBe(false);
  });
});

describe('unit: executeGoogleToolCalls', () => {
  it('runs each call, sanitizes the result, and emits tool_result for each', async () => {
    const events: GoogleTurnEvent[] = [];
    const executeTool = vi.fn().mockResolvedValue({ content: 'ok result' });
    const calls: GoogleToolCall[] = [{ id: 'c1', name: 'f1', input: {} }];
    const outcome = await executeGoogleToolCalls(executeTool, calls, (e) => events.push(e));
    expect(outcome.functionResponseParts).toEqual([
      { functionResponse: { name: 'f1', id: 'c1', response: { content: 'ok result', isError: false } } },
    ]);
    expect(outcome.followUpParts).toEqual([]);
    expect(events).toEqual([{ type: 'tool_result', toolUseId: 'c1', content: 'ok result', isError: false }]);
  });

  it('folds an image-carrying result into a labeled followUpParts entry alongside the batch', async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValue({ content: [{ inlineData: { mimeType: 'image/png', data: 'YQ==' } }] });
    const calls: GoogleToolCall[] = [{ id: 'c1', name: 'shot', input: {} }];
    const outcome = await executeGoogleToolCalls(executeTool, calls, () => {});
    expect(outcome.followUpParts[0]).toEqual({ text: "Image output from tool `shot` (tool_call_id: c1):" });
    expect(outcome.followUpParts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'YQ==' } });
  });

  it('rejects an oversized/invalid image, surfacing isError: true in both the event and the functionResponse', async () => {
    const executeTool = vi.fn().mockResolvedValue({ content: [{ inlineData: { mimeType: 'image/heic-invalid', data: 'x' } }] });
    const events: GoogleTurnEvent[] = [];
    const calls: GoogleToolCall[] = [{ id: 'c1', name: 'shot', input: {} }];
    const outcome = await executeGoogleToolCalls(executeTool, calls, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: 'tool_result', isError: true });
    expect(outcome.functionResponseParts[0]).toMatchObject({
      functionResponse: { response: { isError: true } },
    });
  });

  it('runs multiple calls in order, batching every functionResponse before any image follow-up', async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ content: 'first' })
      .mockResolvedValueOnce({ content: [{ inlineData: { mimeType: 'image/png', data: 'YQ==' } }] });
    const calls: GoogleToolCall[] = [
      { id: 'c1', name: 'f1', input: {} },
      { id: 'c2', name: 'f2', input: {} },
    ];
    const outcome = await executeGoogleToolCalls(executeTool, calls, () => {});
    expect(outcome.functionResponseParts).toHaveLength(2);
    expect(outcome.followUpParts).toHaveLength(2); // label + inlineData, only for c2
  });
});
