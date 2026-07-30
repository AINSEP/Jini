import { afterEach, describe, expect, it, vi } from 'vitest';
import { runOpenAiToolTurn, type OpenAiMessageParam, type OpenAiTurnEvent } from '../openai-chat.js';

/**
 * `node:dns` is mocked so the DNS-resolving SSRF guard is exercised deterministically. Only hosts
 * registered in `dnsAnswers` resolve; anything else rejects, which the guard deliberately treats as
 * "allow" (a resolver hiccup must not become a security verdict — see `validateBaseUrlResolved`),
 * so every pre-existing test in this file keeps its original behaviour.
 */
const dnsAnswers = new Map<string, Array<{ address: string; family: number }>>();
vi.mock('node:dns', () => ({
  promises: {
    lookup: async (hostname: string) => {
      const answer = dnsAnswers.get(hostname);
      if (!answer) throw new Error(`ENOTFOUND ${hostname}`);
      return answer;
    },
  },
}));


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

function done(): string {
  return 'data: [DONE]\n\n';
}

function textChunk(content: string): string {
  return chunk({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content }, finish_reason: null }] });
}

function toolCallStartChunk(index: number, id: string, name: string): string {
  return chunk({
    id: 'c1',
    choices: [{ index: 0, delta: { tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }],
  });
}

function toolCallArgsChunk(index: number, argsFragment: string): string {
  return chunk({
    id: 'c1',
    choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: argsFragment } }] }, finish_reason: null }],
  });
}

function finishChunk(reason: string): string {
  return chunk({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: reason }] });
}

function usageChunk(usage: Record<string, unknown>): string {
  return chunk({ id: 'c1', choices: [], usage });
}

function okResponse(body: AsyncIterable<string>) {
  return { ok: true, status: 200, body, text: async () => '' };
}

const baseMessages: OpenAiMessageParam[] = [{ role: 'user', content: 'hi' }];

describe('runOpenAiToolTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a forbidden internal base url without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({
      apiKey: 'sk-test',
      baseUrl: 'http://192.168.1.5',
      model: 'gpt-4o',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
    expect(result.finishReason).toBeNull();
  });

  // A literal `http://10.0.0.5` was already rejected, but the check was purely textual: a hostname
  // that *resolves* into private space sailed through and this runner issued the request, exposing
  // whatever internal endpoint it pointed at to whoever supplied `baseUrl`. The Azure, Google and
  // Ollama runners already resolved DNS before connecting; this one and Anthropic's did not.
  it('rejects a public hostname that resolves into private address space, without making any request', async () => {
    dnsAnswers.set('internal.example.com', [{ address: '10.0.0.5', family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const events: OpenAiTurnEvent[] = [];

    await runOpenAiToolTurn({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseUrl: 'https://internal.example.com',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'error', message: 'Internal IPs blocked' });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
  });

  it('still allows a hostname that resolves to public address space', async () => {
    dnsAnswers.set('api.vendor.example', [{ address: '203.0.113.10', family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(textChunk('hi'), finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);
    const events: OpenAiTurnEvent[] = [];

    await runOpenAiToolTurn({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseUrl: 'https://api.vendor.example',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).not.toContainEqual({ type: 'error', message: 'Internal IPs blocked' });
  });

  it('reports a network error (Error instance) redacted, and a non-Error rejection stringified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk-x', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: 'error', message: 'ECONNRESET' }, { type: 'end', reason: 'error' }]);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('offline'));
    const events2: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk-x', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events2.push(e) });
    expect(events2[0]).toEqual({ type: 'error', message: 'offline' });
  });

  it('reports a non-ok JSON error response with status code, redacting the api key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        body: null,
        text: async () => JSON.stringify({ error: { message: 'Incorrect API key provided: sk-secret' } }),
      }),
    );
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk-secret', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'error', message: 'Incorrect API key provided: [REDACTED]', code: '401' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('falls back to the raw truncated body for a non-JSON error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, body: null, text: async () => 'upstream down' }));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events[0]).toEqual({ type: 'error', message: 'upstream down', code: '503' });
  });

  it('reports a missing response body as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: null, text: async () => '' }));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: 'error', message: 'OpenAI response had no body' }, { type: 'end', reason: 'error' }]);
  });

  it('streams text_delta/usage events and ends with reason stop for a plain text response', async () => {
    const body = sseBody(textChunk('Hello'), textChunk(' world'), usageChunk({ total_tokens: 12 }), finishChunk('stop'), done());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'status', label: 'requesting' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'usage', usage: { total_tokens: 12 } },
      { type: 'end', reason: 'stop' },
    ]);
    expect(result).toEqual({ finishReason: 'stop', toolTurns: 0 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk');
    expect(init.headers['HTTP-Referer']).toBeUndefined();
  });

  it('resolves a baseUrl that already ends in a versioned path without adding a second /v1', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);
    await runOpenAiToolTurn({ apiKey: 'sk', baseUrl: 'https://gateway.example.com/v1/', model: 'gpt-4o', messages: baseMessages, onEvent: () => {} });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/v1/chat/completions');
  });

  it('merges caller-supplied extraHeaders verbatim and includes temperature/tools/signal when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await runOpenAiToolTurn({
      apiKey: 'sk',
      model: 'gpt-4o',
      messages: baseMessages,
      temperature: 0.2,
      tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }],
      onEvent: () => {},
      signal: controller.signal,
      extraHeaders: { 'HTTP-Referer': 'https://caller.example.com', 'X-Title': 'Caller App' },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['HTTP-Referer']).toBe('https://caller.example.com');
    expect(init.headers['X-Title']).toBe('Caller App');
    expect(init.signal).toBe(controller.signal);
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0.2);
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }]);
    expect(body.stream_options).toEqual({ include_usage: true });

    fetchMock.mockClear();
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: () => {} });
    const [, initNoExtras] = fetchMock.mock.calls[0]!;
    expect(initNoExtras.signal).toBeUndefined();
    const bodyNoExtras = JSON.parse(initNoExtras.body);
    expect(bodyNoExtras.temperature).toBeUndefined();
    expect(bodyNoExtras.tools).toBeUndefined();
  });

  it('always sends a token-limit field, defaulting to 8192 and picking max_tokens vs max_completion_tokens per model — matches a live comparison against OD\'s real handler', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);

    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ max_tokens: 8192 });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).max_completion_tokens).toBeUndefined();

    fetchMock.mockClear();
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', maxTokens: 512, messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ max_tokens: 512 });

    fetchMock.mockClear();
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-5-mini', messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ max_completion_tokens: 8192 });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).max_tokens).toBeUndefined();

    fetchMock.mockClear();
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'o1-preview', messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ max_completion_tokens: 8192 });

    fetchMock.mockClear();
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', maxTokens: -5, messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ max_tokens: 8192 });
  });

  it('ignores a non-record JSON frame, a malformed JSON frame, a missing/empty choices array, and a non-record delta', async () => {
    const body = sseBody(
      'data: 42\n\n',
      'data: not-json\n\n',
      chunk({ id: 'c1' }), // no `choices` field at all
      chunk({ id: 'c1', choices: [] }),
      chunk({ id: 'c1', choices: [{ index: 0, delta: 'not-a-record', finish_reason: null }] }),
      finishChunk('stop'),
      done(),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(result.finishReason).toBe('stop');
    expect(events.map((e) => e.type)).toEqual(['status', 'end']);
  });

  it('stops reading immediately at the [DONE] sentinel, never processing frames after it', async () => {
    const body = sseBody(finishChunk('stop'), done(), textChunk('should never be read'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.type === 'text_delta')).toBe(false);
  });

  it('runs a full tool-call loop: accumulates streamed argument fragments, invokes executeTool, and continues to a final stop', async () => {
    const firstBody = sseBody(
      textChunk("Let's check "),
      toolCallStartChunk(0, 'call_1', 'get_weather'),
      toolCallArgsChunk(0, '{"location":'),
      toolCallArgsChunk(0, '"SF"}'),
      finishChunk('tool_calls'),
      done(),
    );
    const secondBody = sseBody(textChunk('Sunny.'), finishChunk('stop'), done());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: '72F sunny' });
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({
      apiKey: 'sk',
      model: 'gpt-4o',
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

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.messages).toHaveLength(3);
    expect(secondCallBody.messages[1]).toEqual({
      role: 'assistant',
      content: "Let's check ",
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"location":"SF"}' } }],
    });
    expect(secondCallBody.messages[2]).toEqual({ role: 'tool', content: '72F sunny', tool_call_id: 'call_1' });
  });

  it('sends null content (not empty string) for a tool-call continuation with no preceding text', async () => {
    const firstBody = sseBody(toolCallStartChunk(0, 'call_1', 'noop'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
    const secondBody = sseBody(finishChunk('stop'), done());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.stubGlobal('fetch', fetchMock);
    await runOpenAiToolTurn({
      apiKey: 'sk',
      model: 'gpt-4o',
      messages: baseMessages,
      executeTool: vi.fn().mockResolvedValue({ content: 'ok' }),
      onEvent: () => {},
    });
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.messages[1].content).toBeNull();
  });

  it('defaults an unparsable accumulated tool-call arguments string to an empty object', async () => {
    const body = sseBody(toolCallStartChunk(0, 'call_1', 'noop'), toolCallArgsChunk(0, 'not valid json'), finishChunk('tool_calls'), done());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'noop', input: {} });
  });

  it('falls back to a synthesized id and empty name when a tool-call delta omits them on first appearance', async () => {
    const body = sseBody(
      chunk({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: {} }] }, finish_reason: null }] }),
      toolCallArgsChunk(0, '{}'),
      finishChunk('tool_calls'),
      done(),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_0', name: '', input: {} });
  });

  it('tolerates a tool-call delta entry with no function field at all, on both first appearance and a follow-up fragment', async () => {
    const body = sseBody(
      chunk({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1' }] }, finish_reason: null }] }),
      chunk({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0 }] }, finish_reason: null }] }),
      finishChunk('tool_calls'),
      done(),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: '', input: {} });
  });

  it('ignores a non-record entry inside delta.tool_calls[] without crashing', async () => {
    const body = sseBody(
      chunk({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: ['not-a-record', { index: 'not-a-number' }] }, finish_reason: null }] }),
      finishChunk('stop'),
      done(),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(result.finishReason).toBe('stop');
    expect(events.some((e) => e.type === 'tool_use')).toBe(false);
  });

  it('ends with reason stop (no further request) when a tool call is requested but no executeTool is supplied', async () => {
    const body = sseBody(toolCallStartChunk(0, 'call_1', 'noop'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'tool_calls', toolTurns: 0 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
  });

  it('stops with reason max_tool_turns once the bound is hit, without invoking executeTool for the turn that exceeds it', async () => {
    const round = () => sseBody(toolCallStartChunk(0, 'call_x', 'loop_tool'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(round())).mockResolvedValueOnce(okResponse(round()));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'again' });
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({
      apiKey: 'sk',
      model: 'gpt-4o',
      messages: baseMessages,
      maxToolTurns: 1,
      executeTool,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'tool_calls', toolTurns: 1 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'max_tool_turns' }]);
  });

  it('detects a fabricated role marker mid-stream, ends with reason contaminated, and never emits end twice even though a normal completion follows in the same stream', async () => {
    const body = sseBody(
      textChunk('safe text\n## user\nmalicious continuation'),
      // Would-be second end site — must never fire.
      finishChunk('stop'),
      usageChunk({ total_tokens: 5 }),
      done(),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'contaminated' }]);
    expect(events.filter((e) => e.type === 'fabricated_role_marker')).toHaveLength(1);
    expect(events.some((e) => e.type === 'usage')).toBe(false);
    expect(result.finishReason).toBeNull();
  });

  it('does not emit pending tool_use events when a tool call is requested but contamination is detected before the loop ends', async () => {
    const body = sseBody(
      toolCallStartChunk(0, 'call_1', 'get_weather'),
      toolCallArgsChunk(0, '{}'),
      finishChunk('tool_calls'),
      textChunk('## user\nmalicious'),
      done(),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.type === 'tool_use')).toBe(false);
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'contaminated' }]);
  });
});
