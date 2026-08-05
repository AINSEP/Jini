import { afterEach, describe, expect, it, vi } from 'vitest';
import { runOllamaToolTurn, type OllamaMessageParam, type OllamaTurnEvent } from '../ollama-chat.js';
import { pinnedFetch } from '../connection-guard.js';

/**
 * `pinnedFetch` (the transport `runSingleOllamaRequest` actually calls, since the DNS-rebinding
 * fix — see `connection-guard.ts`) is mocked instead of global `fetch`: it dials via
 * `node:https`/`node:http`, not `fetch`, so stubbing `globalThis.fetch` no longer intercepts
 * anything. Every other export stays real — only the actual network call is replaced.
 */
vi.mock('../connection-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../connection-guard.js')>();
  return { ...actual, pinnedFetch: vi.fn() };
});

/** Builds a fake NDJSON response body — each argument is one already-JSON-stringified line. */
function ndjsonBody(...lines: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield `${line}\n`;
    },
  };
}

function textLine(content: string, done = false): string {
  return JSON.stringify({ model: 'llama3', message: { role: 'assistant', content }, done });
}

function toolCallLine(name: string, args: Record<string, unknown>, id?: string): string {
  return JSON.stringify({
    model: 'llama3',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ ...(id ? { id } : {}), function: { name, arguments: args } }],
    },
    done: false,
  });
}

function doneLine(): string {
  return JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' });
}

function okResponse(body: AsyncIterable<string>) {
  return { ok: true, status: 200, body, text: async () => '' };
}

const baseMessages: OllamaMessageParam[] = [{ role: 'user', content: 'hi' }];
const apiKey = 'sk-ollama-cloud';

describe('runOllamaToolTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(pinnedFetch).mockReset();
  });

  it('defaults to https://ollama.com/api/chat and sends a Bearer authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ndjsonBody(doneLine())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const result = await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: () => {} });
    expect(result).toEqual({ finishReason: 'stop', toolTurns: 0 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://ollama.com/api/chat');
    expect(init.headers.authorization).toBe(`Bearer ${apiKey}`);
  });

  it('accepts an explicit local baseUrl (loopback carve-out still applies)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ndjsonBody(doneLine())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({
      apiKey,
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:11434/api/chat');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('still rejects a non-loopback internal base url', async () => {
    const fetchMock = vi.fn();
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({
      apiKey,
      model: 'llama3',
      baseUrl: 'http://192.168.1.5:11434',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
    expect(result.finishReason).toBeNull();
  });

  it('strips a trailing /api from a caller-supplied baseUrl before appending /api/chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ndjsonBody(doneLine())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    await runOllamaToolTurn({ apiKey, baseUrl: 'https://ollama.example.com/api/', model: 'llama3', messages: baseMessages, onEvent: () => {} });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://ollama.example.com/api/chat');
  });

  it('reports a network error, redacting the api key when it appears in the message', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockRejectedValue(new Error(`upstream rejected key ${apiKey}`)));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'error', message: 'upstream rejected key [REDACTED]' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('reports a non-ok error response with status code', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: false, status: 404, body: null, text: async () => JSON.stringify({ error: 'model "llama3" not found' }) }));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'error', message: 'model "llama3" not found', code: '404' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('reports a missing response body as an error, using the Ollama provider label', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: true, status: 200, body: null, text: async () => '' }));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'error', message: 'Ollama response had no body' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('streams text_delta events from message.content and ends with reason stop on the done:true line', async () => {
    const body = ndjsonBody(textLine('Hello'), textLine(' world'), doneLine());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'status', label: 'requesting' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'end', reason: 'stop' },
    ]);
    expect(result).toEqual({ finishReason: 'stop', toolTurns: 0 });
  });

  it('tolerates a chunk boundary splitting a single NDJSON line across two reads', async () => {
    const line = textLine('split across chunks');
    const body: AsyncIterable<string> = {
      async *[Symbol.asyncIterator]() {
        yield line.slice(0, 10);
        yield line.slice(10);
        yield '\n';
        yield `${doneLine()}\n`;
      },
    };
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'split across chunks' });
  });

  it('sends options.num_predict only when maxTokens is a positive number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ndjsonBody(doneLine())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, maxTokens: 256, onEvent: () => {} });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.options).toEqual({ num_predict: 256 });

    fetchMock.mockClear();
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: () => {} });
    const [, init2] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init2.body).options).toBeUndefined();
  });

  it('sends options.temperature, alongside num_predict when both are set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ndjsonBody(doneLine())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, temperature: 0, maxTokens: 64, onEvent: () => {} });
    // Temperature 0 must survive: it is the most useful value and the easiest to lose to a
    // truthiness check, and Ollama nests both under a single `options` object.
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).options).toEqual({ temperature: 0, num_predict: 64 });
  });

  it('forwards a non-empty tools array verbatim, and omits the field for an empty one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ndjsonBody(doneLine())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const tools = [{ type: 'function' as const, function: { name: 'get_weather', description: 'w', parameters: { type: 'object' } } }];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, tools, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).tools).toEqual(tools);

    // Ollama rejects `tools: []`, so an empty list must be indistinguishable from no list.
    fetchMock.mockClear();
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, tools: [], onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty('tools');
  });

  it('passes a caller AbortSignal through to fetch so a cancelled turn actually cancels the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ndjsonBody(doneLine())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const controller = new AbortController();
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, signal: controller.signal, onEvent: () => {} });
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
  });

  it('reports a thrown non-Error rejection from fetch by stringifying it', async () => {
    // `fetch` rejecting with a non-Error is rare but real (a bare string from a patched global, an
    // undici internal); the turn must still surface an error rather than crash on `.message`.
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockRejectedValue('socket hang up'));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'error', message: 'socket hang up' });
    expect(events).toContainEqual({ type: 'end', reason: 'error' });
  });

  it('falls back to the raw (truncated) body when a non-ok error response is not JSON', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: false, status: 502, body: null, text: async () => '<html>Bad Gateway</html>' }));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'error', message: '<html>Bad Gateway</html>', code: '502' });
  });

  it('truncates an overlong non-JSON error body to 500 characters', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: false, status: 500, body: null, text: async () => 'x'.repeat(2000) }));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    const error = events.find((e): e is Extract<OllamaTurnEvent, { type: 'error' }> => e.type === 'error');
    expect(error?.message).toHaveLength(500);
  });

  it('falls back to the raw body when the error JSON has no string error field', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: false, status: 400, body: null, text: async () => '{"detail":"nope"}' }));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'error', message: '{"detail":"nope"}', code: '400' });
  });

  it('decodes a body delivered as Uint8Array chunks, which is what a real fetch stream yields', async () => {
    const encoder = new TextEncoder();
    const body: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(`${textLine('from bytes')}\n`);
        yield encoder.encode(`${doneLine()}\n`);
      },
    };
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body as unknown as AsyncIterable<string>)));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'from bytes' });
  });

  it('skips blank and malformed lines in the stream instead of aborting the turn', async () => {
    // Ollama sends blank keep-alive lines, and a proxy can inject non-JSON noise. Either must be
    // survivable: the surrounding real lines still have to be processed.
    const body = ndjsonBody('', '   ', 'not json at all', textLine('still here'), '[]', doneLine());
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'still here' });
    expect(result).toEqual({ finishReason: 'stop', toolTurns: 0 });
  });

  it('yields a final line that arrived without a terminating newline', async () => {
    const body: AsyncIterable<string> = {
      async *[Symbol.asyncIterator]() {
        yield `${textLine('mid')}\n`;
        yield doneLine(); // no trailing newline — the stream simply ends
      },
    };
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const result = await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: () => {} });
    expect(result).toEqual({ finishReason: 'stop', toolTurns: 0 });
  });

  it('completes the read loop normally when the unterminated final line is content rather than the done marker', async () => {
    // Distinct from the case above: there `done: true` breaks the read loop the moment the trailing
    // line is consumed, so the decoder never runs to completion. Here the stream just stops (a
    // dropped connection), the loop asks for another line, and the decoder must finish cleanly
    // instead of hanging or throwing.
    const body: AsyncIterable<string> = {
      async *[Symbol.asyncIterator]() {
        yield `${textLine('first ')}\n`;
        yield textLine('and the tail'); // complete JSON, no newline, no done marker
      },
    };
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', delta: 'first ' },
      { type: 'text_delta', delta: 'and the tail' },
    ]);
    expect(result.finishReason).toBeNull();
  });

  it('drops a truncated final line that is not valid JSON rather than throwing at end of stream', async () => {
    // A connection cut mid-line leaves an unparseable remainder, and there is no `done: true` line
    // to have broken out of the read loop first — so the decoder itself has to survive it. The turn
    // ends on whatever text already arrived instead of rejecting.
    const body: AsyncIterable<string> = {
      async *[Symbol.asyncIterator]() {
        yield `${textLine('partial answer')}\n`;
        yield '{"model":"llama3","mess';
      },
    };
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'partial answer' });
    expect(result.finishReason).toBeNull();
  });

  it('ignores a line whose message field is not an object', async () => {
    const body = ndjsonBody(JSON.stringify({ model: 'llama3', message: 'oops', done: false }), doneLine());
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([]);
  });

  it('skips malformed tool_calls entries — a non-object, a missing function, and a nameless function', async () => {
    // A nameless call is unexecutable: forwarding it would make `executeTool` fail on an empty name
    // instead of the turn simply ignoring noise.
    const body = ndjsonBody(
      JSON.stringify({
        model: 'llama3',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: ['nope', { id: 'x' }, { function: {} }, { function: { name: '', arguments: {} } }, { function: { name: 'get_weather', arguments: { location: 'SF' } } }],
        },
        done: false,
      }),
      doneLine(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({
      apiKey,
      model: 'llama3',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events.filter((e) => e.type === 'tool_use')).toEqual([
      { type: 'tool_use', id: 'ollama-tool-0', name: 'get_weather', input: { location: 'SF' } },
    ]);
  });

  it('parses string-encoded tool arguments, and keeps them as a raw string when they are not JSON', async () => {
    // Ollama sends `arguments` as an object, but an OpenAI-compatible proxy in front of it sends the
    // JSON-encoded string form. Both have to reach `executeTool` as something usable.
    const body = ndjsonBody(
      JSON.stringify({
        model: 'llama3',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'a', function: { name: 'get_weather', arguments: '{"location":"SF"}' } },
            { id: 'b', function: { name: 'get_weather', arguments: 'location=SF' } },
          ],
        },
        done: false,
      }),
      doneLine(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'tool_use')).toEqual([
      { type: 'tool_use', id: 'a', name: 'get_weather', input: { location: 'SF' } },
      { type: 'tool_use', id: 'b', name: 'get_weather', input: 'location=SF' },
    ]);
  });

  it('merges caller-supplied extraHeaders verbatim (no hardcoded product-identity header)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ndjsonBody(doneLine())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    await runOllamaToolTurn({
      apiKey,
      model: 'llama3',
      messages: baseMessages,
      onEvent: () => {},
      extraHeaders: { 'X-Caller-App': 'my-app' },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['X-Caller-App']).toBe('my-app');
    expect(Object.keys(init.headers)).not.toContain('X-Title');
    expect(Object.keys(init.headers)).not.toContain('HTTP-Referer');
  });

  it('runs a full tool-call loop: parses message.tool_calls, invokes executeTool, and continues to a final stop', async () => {
    const firstBody = ndjsonBody(
      textLine("Let's check "),
      toolCallLine('get_weather', { location: 'SF' }, 'call_1'),
      doneLine(),
    );
    const secondBody = ndjsonBody(textLine('Sunny.'), doneLine());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: '72F sunny' });
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({
      apiKey,
      model: 'llama3',
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledWith({ id: 'call_1', name: 'get_weather', input: { location: 'SF' } });
    expect(result).toEqual({ finishReason: 'stop', toolTurns: 1 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { location: 'SF' } });
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'call_1', content: '72F sunny', isError: false });

    // Ollama's native continuation shape: `arguments` is a real object (never stringified), no
    // `id`/`type` on the tool_calls entry, and the tool-result message uses `tool_name` — NOT the
    // OpenAI-shaped `tool_call_id` (AUD-R4-002 regression test).
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondRequestBody.messages).toContainEqual({
      role: 'assistant',
      content: "Let's check ",
      tool_calls: [{ function: { name: 'get_weather', arguments: { location: 'SF' } } }],
    });
    expect(secondRequestBody.messages).toContainEqual({
      role: 'tool',
      content: '72F sunny',
      tool_name: 'get_weather',
    });
    const assistantMessage = secondRequestBody.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMessage.tool_calls[0].id).toBeUndefined();
    expect(assistantMessage.tool_calls[0].type).toBeUndefined();
    const toolResultMessage = secondRequestBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolResultMessage.tool_call_id).toBeUndefined();
  });

  it('round-trips a bare-base64 image inside a tool result: emits it on tool_result and sends it on the continuation tool message', async () => {
    const firstBody = ndjsonBody(toolCallLine('take_screenshot', {}, 'call_1'), doneLine());
    const secondBody = ndjsonBody(textLine('looks right'), doneLine());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'here is the screenshot', images: ['iVBORw0KGgoAAAANSUhEUg=='] });
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });

    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'call_1',
      content: 'here is the screenshot',
      images: ['iVBORw0KGgoAAAANSUhEUg=='],
      isError: false,
    });
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondRequestBody.messages).toContainEqual({
      role: 'tool',
      content: 'here is the screenshot',
      tool_name: 'take_screenshot',
      images: ['iVBORw0KGgoAAAANSUhEUg=='],
    });
  });

  it('still accepts an image-free tool result alongside an image-bearing one in the same turn (backward compatibility)', async () => {
    const firstBody = ndjsonBody(
      JSON.stringify({
        model: 'llama3',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', function: { name: 'get_weather', arguments: {} } },
            { id: 'call_2', function: { name: 'take_screenshot', arguments: {} } },
          ],
        },
        done: false,
      }),
      doneLine(),
    );
    const secondBody = ndjsonBody(textLine('done'), doneLine());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockImplementation(async (call: { name: string }) =>
      call.name === 'get_weather' ? { content: '72F sunny' } : { content: 'shot', images: ['aGVsbG8='] },
    );
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, executeTool, onEvent: () => {} });

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    const toolMessages = secondRequestBody.messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolMessages).toEqual([
      { role: 'tool', content: '72F sunny', tool_name: 'get_weather' },
      { role: 'tool', content: 'shot', tool_name: 'take_screenshot', images: ['aGVsbG8='] },
    ]);
  });

  it('rejects a data:-URI-prefixed tool-result image as a normal is_error result instead of forwarding malformed bytes to Ollama', async () => {
    const firstBody = ndjsonBody(toolCallLine('take_screenshot', {}, 'call_1'), doneLine());
    const secondBody = ndjsonBody(textLine('ok'), doneLine());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'shot', images: ['data:image/png;base64,aGVsbG8='] });
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toMatchObject({ isError: true });
    expect(String((toolResultEvent as { content: unknown }).content)).toContain('data:');
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    const toolMessage = secondRequestBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMessage.images).toBeUndefined();
  });

  it('rejects an empty-string tool-result image as an is_error result', async () => {
    const firstBody = ndjsonBody(toolCallLine('take_screenshot', {}, 'call_1'), doneLine());
    const secondBody = ndjsonBody(textLine('ok'), doneLine());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'shot', images: [''] });
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toMatchObject({ isError: true });
  });

  it('propagates an explicit executeTool isError result, including when it carries no images', async () => {
    const body = ndjsonBody(toolCallLine('fail_tool', {}, 'call_1'), doneLine());
    const secondBody = ndjsonBody(textLine('done'), doneLine());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(body)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'boom', isError: true });
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'call_1', content: 'boom', isError: true });
  });

  it('generates a stable synthetic id for a tool call with no id in the response', async () => {
    const body = ndjsonBody(toolCallLine('noop', {}), doneLine());
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    const toolUse = events.find((e) => e.type === 'tool_use');
    expect(toolUse && 'id' in toolUse ? toolUse.id : undefined).toBe('ollama-tool-0');
  });

  it('stops with reason max_tool_turns once the bound is hit, without invoking executeTool for the turn that exceeds it', async () => {
    const round = () => ndjsonBody(toolCallLine('loop_tool', {}, 'call_x'), doneLine());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(round())).mockResolvedValueOnce(okResponse(round()));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'again' });
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({
      apiKey,
      model: 'llama3',
      maxToolTurns: 1,
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'tool_calls', toolTurns: 1 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'max_tool_turns' }]);
  });

  it('detects a fabricated role marker mid-stream, ends with reason contaminated, and never emits end twice even though a normal completion follows in the same stream', async () => {
    const body = ndjsonBody(
      textLine('safe text\n## user\nmalicious continuation'),
      // Would-be second end site — must never fire.
      doneLine(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    const endEvents = events.filter((e) => e.type === 'end');
    expect(endEvents).toEqual([{ type: 'end', reason: 'contaminated' }]);
    expect(events.filter((e) => e.type === 'fabricated_role_marker')).toHaveLength(1);
    expect(result.finishReason).toBe('contaminated');
  });

  it('ends with reason stop (no further request) when a tool call is requested but no executeTool is supplied, but still emits tool_use for the resolved call', async () => {
    const body = ndjsonBody(toolCallLine('noop', {}, 'call_1'), doneLine());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: OllamaTurnEvent[] = [];
    const result = await runOllamaToolTurn({ apiKey, model: 'llama3', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'tool_calls', toolTurns: 0 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'noop', input: {} });
  });
});
