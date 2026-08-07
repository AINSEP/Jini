import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runOpenAiToolTurn,
  openAiRequestUrl,
  openAiHeaders,
  openAiRequestBody,
  extractOpenAiErrorDetail,
  parseOpenAiSseData,
  applyOpenAiStreamUsage,
  firstOpenAiChoice,
  handleOpenAiTextContentDelta,
  newPendingOpenAiToolCall,
  accumulateOpenAiToolCallDelta,
  handleOpenAiChoiceDelta,
  resolveOpenAiToolCalls,
  processOpenAiStreamFrame,
  invalidOpenAiContentPartReason,
  sanitizeOpenAiToolResult,
  splitOpenAiToolResultContent,
  openAiLoopExitReason,
  executeOpenAiToolCalls,
  buildOpenAiAssistantToolCallMessage,
  buildOpenAiToolExchangeMessages,
  type OpenAiMessageParam,
  type OpenAiTurnEvent,
  type OpenAiStreamState,
  type OpenAiToolCall,
  type OpenAiContentPart,
  type OpenAiCompatibleRequestOutcome,
  type PendingToolCall,
} from '../openai-chat.js';
import { pinnedFetch } from '../connection-guard.js';
import { createRoleMarkerGuard } from '../../role-marker-guard.js';

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

/**
 * `pinnedFetch` (the transport `runOpenAiCompatibleRequest` actually calls, since the
 * DNS-rebinding fix — see `connection-guard.ts`) is mocked instead of global `fetch`: it dials via
 * `node:https`/`node:http`, not `fetch`, so stubbing `globalThis.fetch` no longer intercepts
 * anything. Every other export (`validateBaseUrlResolved`, `defaultDnsLookup`, `redactSecrets`)
 * stays real — only the actual network call is replaced — which is why every test below still
 * assigns its own `fetchMock` and wires it in with `.mockImplementation(fetchMock)`: same
 * per-test mock shape as before, just handed to `pinnedFetch` instead of `vi.stubGlobal`.
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
    vi.mocked(pinnedFetch).mockReset();
  });

  it('rejects a forbidden internal base url without making any request', async () => {
    const fetchMock = vi.fn();
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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

  /**
   * The guard only ever validates the ORIGINAL url. With the default `redirect: 'follow'`, a
   * public endpoint that passes both the literal and the DNS check could answer `302 ->
   * http://169.254.169.254/...` and `fetch` would quietly chase it — reaching exactly the address
   * space the guard exists to refuse, with the provider auth headers still attached. Asserted on
   * the request init rather than by simulating a redirect, because that is the whole mechanism:
   * `redirect: 'error'` is what makes the hop impossible.
   */
  it('refuses to follow redirects, so a guard-passing endpoint cannot bounce the request into blocked address space', async () => {
    dnsAnswers.set('api.vendor.example', [{ address: '203.0.113.10', family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

    await runOpenAiToolTurn({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseUrl: 'https://api.vendor.example',
      messages: baseMessages,
      onEvent: () => {},
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.redirect).toBe('error');
  });

  it('reports a network error (Error instance) redacted, and a non-Error rejection stringified', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk-x', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: 'error', message: 'ECONNRESET' }, { type: 'end', reason: 'error' }]);

    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockRejectedValue('offline'));
    const events2: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk-x', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events2.push(e) });
    expect(events2[0]).toEqual({ type: 'error', message: 'offline' });
  });

  it('reports a non-ok JSON error response with status code, redacting the api key', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: false, status: 503, body: null, text: async () => 'upstream down' }));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events[0]).toEqual({ type: 'error', message: 'upstream down', code: '503' });
  });

  it('reports a missing response body as an error', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: true, status: 200, body: null, text: async () => '' }));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: 'error', message: 'OpenAI response had no body' }, { type: 'end', reason: 'error' }]);
  });

  it('streams text_delta/usage events and ends with reason stop for a plain text response', async () => {
    const body = sseBody(textChunk('Hello'), textChunk(' world'), usageChunk({ total_tokens: 12 }), finishChunk('stop'), done());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    await runOpenAiToolTurn({ apiKey: 'sk', baseUrl: 'https://gateway.example.com/v1/', model: 'gpt-4o', messages: baseMessages, onEvent: () => {} });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/v1/chat/completions');
  });

  it('merges caller-supplied extraHeaders verbatim and includes temperature/tools/signal when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(result.finishReason).toBe('stop');
    expect(events.map((e) => e.type)).toEqual(['status', 'end']);
  });

  it('stops reading immediately at the [DONE] sentinel, never processing frames after it', async () => {
    const body = sseBody(finishChunk('stop'), done(), textChunk('should never be read'));
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(result.finishReason).toBe('stop');
    expect(events.some((e) => e.type === 'tool_use')).toBe(false);
  });

  it('ends with reason stop (no further request) when a tool call is requested but no executeTool is supplied', async () => {
    const body = sseBody(toolCallStartChunk(0, 'call_1', 'noop'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: OpenAiTurnEvent[] = [];
    const result = await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'tool_calls', toolTurns: 0 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
  });

  it('stops with reason max_tool_turns once the bound is hit, without invoking executeTool for the turn that exceeds it', async () => {
    const round = () => sseBody(toolCallStartChunk(0, 'call_x', 'loop_tool'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(round())).mockResolvedValueOnce(okResponse(round()));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
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
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: OpenAiTurnEvent[] = [];
    await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.type === 'tool_use')).toBe(false);
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'contaminated' }]);
  });

  describe('image support', () => {
    const pngDataUri = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

    it('round-trips an image_url part in the initial request body, alongside plain string messages elsewhere', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const messages: OpenAiMessageParam[] = [
        { role: 'system', content: 'be terse' },
        {
          role: 'user',
          content: [
            { type: 'text', text: "what's in this image?" },
            { type: 'image_url', image_url: { url: pngDataUri, detail: 'high' } },
          ],
        },
      ];
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages, onEvent: () => {} });
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'be terse' });
      expect(body.messages[1]).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: "what's in this image?" },
          { type: 'image_url', image_url: { url: pngDataUri, detail: 'high' } },
        ],
      });
    });

    it('still sends a plain string message content unchanged (backward compatibility)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, onEvent: () => {} });
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('keeps a tool result with a screenshot text-only on the tool message and delivers the image via a synthetic follow-up user message', async () => {
      // OpenAI documents `role:'tool'` content as text-only — an image_url part cannot live there.
      const firstBody = sseBody(toolCallStartChunk(0, 'call_1', 'screenshot'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
      const secondBody = sseBody(textChunk('looks good'), finishChunk('stop'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'here is the current render' },
          { type: 'image_url', image_url: { url: pngDataUri } },
        ],
      });
      const events: OpenAiTurnEvent[] = [];
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      // messages: [user, assistant(tool_calls), tool, user(labeled image)]
      expect(secondCallBody.messages).toHaveLength(4);
      expect(secondCallBody.messages[2]).toEqual({
        role: 'tool',
        content: [{ type: 'text', text: 'here is the current render' }],
        tool_call_id: 'call_1',
      });
      expect(secondCallBody.messages[3]).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Image output from tool `screenshot` (tool_call_id: call_1):' },
          { type: 'image_url', image_url: { url: pngDataUri } },
        ],
      });
      expect(events).toContainEqual({
        type: 'tool_result',
        toolUseId: 'call_1',
        content: [
          { type: 'text', text: 'here is the current render' },
          { type: 'image_url', image_url: { url: pngDataUri } },
        ],
        isError: false,
      });
    });

    it('batches a multi-tool-call turn correctly: all tool messages emitted before a single labeled follow-up covering only the calls that returned images', async () => {
      // The naive per-call implementation would interleave a synthetic user message between tool
      // messages, which OpenAI rejects — every `tool` message answering a batch of parallel
      // tool_calls must directly follow the assistant message with nothing else in between.
      const firstBody = sseBody(
        toolCallStartChunk(0, 'call_1', 'get_weather'),
        toolCallArgsChunk(0, '{}'),
        toolCallStartChunk(1, 'call_2', 'screenshot'),
        toolCallArgsChunk(1, '{}'),
        toolCallStartChunk(2, 'call_3', 'screenshot_2'),
        toolCallArgsChunk(2, '{}'),
        finishChunk('tool_calls'),
        done(),
      );
      const secondBody = sseBody(finishChunk('stop'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi
        .fn()
        .mockResolvedValueOnce({ content: '72F sunny' }) // call_1: no image
        .mockResolvedValueOnce({ content: [{ type: 'image_url', image_url: { url: pngDataUri } }] }) // call_2: image
        .mockResolvedValueOnce({ content: [{ type: 'image_url', image_url: { url: `${pngDataUri}2` } }] }); // call_3: image
      const events: OpenAiTurnEvent[] = [];
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      // messages: [user, assistant(tool_calls x3), tool(call_1), tool(call_2), tool(call_3), user(images)] —
      // exactly ONE follow-up message, positioned after all three tool messages.
      expect(secondCallBody.messages).toHaveLength(6);
      expect(secondCallBody.messages[2]).toEqual({ role: 'tool', content: '72F sunny', tool_call_id: 'call_1' });
      expect(secondCallBody.messages[3]).toEqual({
        role: 'tool',
        content: [{ type: 'text', text: '(tool result included only non-text content; see the following message)' }],
        tool_call_id: 'call_2',
      });
      expect(secondCallBody.messages[4]).toEqual({
        role: 'tool',
        content: [{ type: 'text', text: '(tool result included only non-text content; see the following message)' }],
        tool_call_id: 'call_3',
      });
      expect(secondCallBody.messages[5]).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Image output from tool `screenshot` (tool_call_id: call_2):' },
          { type: 'image_url', image_url: { url: pngDataUri } },
          { type: 'text', text: 'Image output from tool `screenshot_2` (tool_call_id: call_3):' },
          { type: 'image_url', image_url: { url: `${pngDataUri}2` } },
        ],
      });
    });

    it('substitutes a placeholder text part on the tool message when a tool result is image-only', async () => {
      const firstBody = sseBody(toolCallStartChunk(0, 'call_1', 'screenshot'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
      const secondBody = sseBody(finishChunk('stop'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi.fn().mockResolvedValue({ content: [{ type: 'image_url', image_url: { url: pngDataUri } }] });
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, executeTool, onEvent: () => {} });
      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(secondCallBody.messages[2].content).toEqual([
        { type: 'text', text: '(tool result included only non-text content; see the following message)' },
      ]);
    });

    it('rejects an unsupported image media type as an isError tool_result instead of forwarding it', async () => {
      const body = sseBody(toolCallStartChunk(0, 'call_1', 'screenshot'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(body)).mockResolvedValueOnce(okResponse(sseBody(finishChunk('stop'), done())));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi.fn().mockResolvedValue({
        content: [{ type: 'image_url', image_url: { url: 'data:image/tiff;base64,AAAA' } }],
      });
      const events: OpenAiTurnEvent[] = [];
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });
      const toolResultEvent = events.find((e) => e.type === 'tool_result');
      expect(toolResultEvent).toMatchObject({ isError: true });
      expect((toolResultEvent as { content: string }).content).toContain('unsupported image media type');
      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(secondCallBody.messages[2]).toEqual({
        role: 'tool',
        content: (toolResultEvent as { content: string }).content,
        tool_call_id: 'call_1',
      });
    });

    it('rejects an oversized data URI image as an isError tool_result', async () => {
      const body = sseBody(toolCallStartChunk(0, 'call_1', 'screenshot'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(body)).mockResolvedValueOnce(okResponse(sseBody(finishChunk('stop'), done())));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const oversized = 'A'.repeat(Math.ceil((20 * 1024 * 1024 * 4) / 3) + 100);
      const executeTool = vi.fn().mockResolvedValue({ content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${oversized}` } }] });
      const events: OpenAiTurnEvent[] = [];
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });
      const toolResultEvent = events.find((e) => e.type === 'tool_result');
      expect(toolResultEvent).toMatchObject({ isError: true });
      expect((toolResultEvent as { content: string }).content).toContain('20 MB base64 size guard');
    });

    it('rejects a tool result with more than 1500 content parts as an isError tool_result', async () => {
      const body = sseBody(toolCallStartChunk(0, 'call_1', 'screenshot'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(body)).mockResolvedValueOnce(okResponse(sseBody(finishChunk('stop'), done())));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const tooManyParts = Array.from({ length: 1501 }, () => ({ type: 'text' as const, text: 'x' }));
      const executeTool = vi.fn().mockResolvedValue({ content: tooManyParts });
      const events: OpenAiTurnEvent[] = [];
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });
      const toolResultEvent = events.find((e) => e.type === 'tool_result');
      expect(toolResultEvent).toMatchObject({ isError: true });
      expect((toolResultEvent as { content: string }).content).toContain('exceeds the 1500-image-per-request guard');
    });

    it('does not size-check a plain https image_url (OpenAI, not this adapter, fetches it)', async () => {
      const firstBody = sseBody(toolCallStartChunk(0, 'call_1', 'screenshot'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
      const secondBody = sseBody(finishChunk('stop'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
      vi.mocked(pinnedFetch).mockImplementation(fetchMock);
      const executeTool = vi.fn().mockResolvedValue({ content: [{ type: 'image_url', image_url: { url: 'https://example.com/huge-but-unchecked.png' } }] });
      const events: OpenAiTurnEvent[] = [];
      await runOpenAiToolTurn({ apiKey: 'sk', model: 'gpt-4o', messages: baseMessages, executeTool, onEvent: (e) => events.push(e) });
      expect(events).toContainEqual({
        type: 'tool_result',
        toolUseId: 'call_1',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/huge-but-unchecked.png' } }],
        isError: false,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for the extracted reducer/builder helpers, exercised directly
// (no HTTP mock, no full turn) so their branches, edge cases, and error paths
// are pinned independently of the end-to-end characterization tests above.
// ---------------------------------------------------------------------------

function minimalOpenAiOptions(overrides: Partial<Parameters<typeof openAiHeaders>[0]> = {}): Parameters<typeof openAiHeaders>[0] {
  return { apiKey: 'sk-test', model: 'gpt-4o', messages: [], onEvent: () => {}, ...overrides };
}

function freshOpenAiState(messageId = 'unit-test'): OpenAiStreamState {
  return { guard: createRoleMarkerGuard(messageId), toolCalls: new Map(), fullText: '', finishReason: null, usage: null };
}

describe('unit: openAiRequestUrl', () => {
  it('defaults to api.openai.com/v1/chat/completions when baseUrl is omitted', () => {
    expect(openAiRequestUrl(undefined)).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('trims trailing slashes before appending the path', () => {
    expect(openAiRequestUrl('https://gateway.example.com/')).toBe('https://gateway.example.com/v1/chat/completions');
  });

  it('appends /v1/chat/completions when the base has no version segment', () => {
    expect(openAiRequestUrl('https://gateway.example.com')).toBe('https://gateway.example.com/v1/chat/completions');
  });

  it('appends only /chat/completions when the base already ends in a version segment', () => {
    expect(openAiRequestUrl('https://gateway.example.com/v2')).toBe('https://gateway.example.com/v2/chat/completions');
  });

  it('appends only /chat/completions when the base has a version segment mid-path', () => {
    expect(openAiRequestUrl('https://gateway.example.com/v1/openai')).toBe('https://gateway.example.com/v1/openai/chat/completions');
  });
});

describe('unit: openAiHeaders', () => {
  it('sends a Bearer authorization header from apiKey', () => {
    expect(openAiHeaders(minimalOpenAiOptions())).toEqual({ 'content-type': 'application/json', authorization: 'Bearer sk-test' });
  });

  it('merges extraHeaders in, and lets them override a default header of the same name', () => {
    const headers = openAiHeaders(minimalOpenAiOptions({ extraHeaders: { authorization: 'Bearer overridden', 'X-Title': 'my-app' } }));
    expect(headers.authorization).toBe('Bearer overridden');
    expect(headers['X-Title']).toBe('my-app');
  });
});

describe('unit: openAiRequestBody', () => {
  it('defaults max_tokens to 8192 when maxTokens is omitted', () => {
    const body = openAiRequestBody(minimalOpenAiOptions(), []);
    expect(body).toMatchObject({ max_tokens: 8192 });
  });

  it('defaults max_tokens to 8192 when maxTokens is zero or negative (not a positive number)', () => {
    expect(openAiRequestBody(minimalOpenAiOptions({ maxTokens: 0 }), [])).toMatchObject({ max_tokens: 8192 });
    expect(openAiRequestBody(minimalOpenAiOptions({ maxTokens: -5 }), [])).toMatchObject({ max_tokens: 8192 });
  });

  it('uses a caller-supplied positive maxTokens', () => {
    expect(openAiRequestBody(minimalOpenAiOptions({ maxTokens: 4096 }), [])).toMatchObject({ max_tokens: 4096 });
  });

  it('always requests stream_options.include_usage so a usage chunk is guaranteed', () => {
    const body = openAiRequestBody(minimalOpenAiOptions(), []);
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('omits temperature and tools when not supplied, includes them when supplied', () => {
    expect(openAiRequestBody(minimalOpenAiOptions(), [])).not.toHaveProperty('temperature');
    const withExtras = openAiRequestBody(minimalOpenAiOptions({ temperature: 0.2, tools: [{ type: 'function', function: { name: 'f', parameters: {} } }] }), []);
    expect(withExtras).toMatchObject({ temperature: 0.2, tools: [{ type: 'function', function: { name: 'f', parameters: {} } }] });
  });

  it('omits tools when the array is present but empty', () => {
    expect(openAiRequestBody(minimalOpenAiOptions({ tools: [] }), [])).not.toHaveProperty('tools');
  });
});

describe('unit: extractOpenAiErrorDetail', () => {
  it('extracts error.message from a well-formed JSON error body', () => {
    expect(extractOpenAiErrorDetail(JSON.stringify({ error: { message: 'invalid api key' } }))).toBe('invalid api key');
  });

  it('falls back to raw trimmed text when JSON has no error.message', () => {
    expect(extractOpenAiErrorDetail(JSON.stringify({ foo: 'bar' }))).toBe('{"foo":"bar"}');
  });

  it('falls back to raw trimmed text for a non-JSON body', () => {
    expect(extractOpenAiErrorDetail('  Bad Gateway  ')).toBe('Bad Gateway');
  });

  it('truncates a very long raw body to 500 characters', () => {
    expect(extractOpenAiErrorDetail('x'.repeat(10_000))).toHaveLength(500);
  });
});

describe('unit: parseOpenAiSseData', () => {
  it('parses a valid JSON object', () => {
    expect(parseOpenAiSseData('{"id":"chatcmpl-1"}')).toEqual({ id: 'chatcmpl-1' });
  });

  it('returns null for a JSON array', () => {
    expect(parseOpenAiSseData('[1,2,3]')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseOpenAiSseData('not-json')).toBeNull();
  });
});

describe('unit: applyOpenAiStreamUsage', () => {
  it('sets usage and emits a usage event when present', () => {
    const state = freshOpenAiState();
    const events: OpenAiTurnEvent[] = [];
    applyOpenAiStreamUsage(state, { usage: { total_tokens: 42 } }, (e) => events.push(e));
    expect(state.usage).toEqual({ total_tokens: 42 });
    expect(events).toEqual([{ type: 'usage', usage: { total_tokens: 42 } }]);
  });

  it('is a no-op when usage is absent', () => {
    const state = freshOpenAiState();
    const events: OpenAiTurnEvent[] = [];
    applyOpenAiStreamUsage(state, {}, (e) => events.push(e));
    expect(state.usage).toBeNull();
    expect(events).toEqual([]);
  });
});

describe('unit: firstOpenAiChoice', () => {
  it('returns choices[0] when it is a record', () => {
    expect(firstOpenAiChoice({ choices: [{ index: 0, delta: {} }] })).toEqual({ index: 0, delta: {} });
  });

  it('returns null when choices is missing', () => {
    expect(firstOpenAiChoice({})).toBeNull();
  });

  it('returns null when choices is empty', () => {
    expect(firstOpenAiChoice({ choices: [] })).toBeNull();
  });

  it('returns null when choices[0] is not a record (defensive against a malformed upstream chunk)', () => {
    expect(firstOpenAiChoice({ choices: ['not-a-record'] })).toBeNull();
  });
});

describe('unit: handleOpenAiTextContentDelta', () => {
  it('appends safe text to fullText and emits a text_delta event', () => {
    const state = freshOpenAiState();
    const events: OpenAiTurnEvent[] = [];
    const result = handleOpenAiTextContentDelta(state, 'hello', (e) => events.push(e));
    expect(result).toBe('continue');
    expect(state.fullText).toBe('hello');
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }]);
  });

  it('returns "break" and emits a warning once a fabricated role marker contaminates the text', () => {
    const state = freshOpenAiState();
    const events: OpenAiTurnEvent[] = [];
    const result = handleOpenAiTextContentDelta(state, 'safe text\n## user\nmalicious continuation', (e) => events.push(e));
    expect(result).toBe('break');
    expect(events.some((e) => e.type === 'fabricated_role_marker')).toBe(true);
  });
});

describe('unit: newPendingOpenAiToolCall', () => {
  it('uses rawCall.id when it is a string', () => {
    expect(newPendingOpenAiToolCall({ id: 'call_abc', function: { name: 'get_weather' } }, 0)).toEqual({ id: 'call_abc', name: 'get_weather', argsJson: '' });
  });

  it('falls back to call_<index> when id is missing', () => {
    expect(newPendingOpenAiToolCall({ function: { name: 'get_weather' } }, 3)).toMatchObject({ id: 'call_3' });
  });

  it('falls back to an empty name when function.name is missing', () => {
    expect(newPendingOpenAiToolCall({ id: 'call_abc' }, 0)).toMatchObject({ name: '' });
  });
});

describe('unit: accumulateOpenAiToolCallDelta', () => {
  it('creates a pending call on the first chunk that mentions its index', () => {
    const state = freshOpenAiState();
    accumulateOpenAiToolCallDelta(state, { index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '' } });
    expect(state.toolCalls.get(0)).toEqual({ id: 'call_1', name: 'get_weather', argsJson: '' });
  });

  it('accumulates function.arguments dribbled in across multiple chunks for the same index', () => {
    const state = freshOpenAiState();
    accumulateOpenAiToolCallDelta(state, { index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"loc' } });
    accumulateOpenAiToolCallDelta(state, { index: 0, function: { arguments: 'ation":' } });
    accumulateOpenAiToolCallDelta(state, { index: 0, function: { arguments: '"SF"}' } });
    expect(state.toolCalls.get(0)?.argsJson).toBe('{"location":"SF"}');
  });

  it('accumulates two interleaved parallel tool calls at different indices independently', () => {
    const state = freshOpenAiState();
    // Simulates OpenAI streaming two parallel tool_calls whose argument fragments arrive interleaved
    // across chunks rather than one call completing before the next starts.
    accumulateOpenAiToolCallDelta(state, { index: 0, id: 'call_a', function: { name: 'a', arguments: '{"x":' } });
    accumulateOpenAiToolCallDelta(state, { index: 1, id: 'call_b', function: { name: 'b', arguments: '{"y":' } });
    accumulateOpenAiToolCallDelta(state, { index: 0, function: { arguments: '1}' } });
    accumulateOpenAiToolCallDelta(state, { index: 1, function: { arguments: '2}' } });
    expect(state.toolCalls.get(0)).toEqual({ id: 'call_a', name: 'a', argsJson: '{"x":1}' });
    expect(state.toolCalls.get(1)).toEqual({ id: 'call_b', name: 'b', argsJson: '{"y":2}' });
  });

  it('is a no-op for a malformed entry (not a record, or index not a number)', () => {
    const state = freshOpenAiState();
    accumulateOpenAiToolCallDelta(state, 'not-a-record');
    accumulateOpenAiToolCallDelta(state, { index: 'zero', function: { arguments: 'x' } });
    expect(state.toolCalls.size).toBe(0);
  });

  it('does not append arguments when function.arguments is absent on a later chunk', () => {
    const state = freshOpenAiState();
    accumulateOpenAiToolCallDelta(state, { index: 0, id: 'call_1', function: { name: 'f', arguments: '{}' } });
    accumulateOpenAiToolCallDelta(state, { index: 0, function: {} });
    expect(state.toolCalls.get(0)?.argsJson).toBe('{}');
  });
});

describe('unit: handleOpenAiChoiceDelta', () => {
  it('sets finishReason from choice.finish_reason', () => {
    const state = freshOpenAiState();
    handleOpenAiChoiceDelta(state, { finish_reason: 'stop' }, () => {});
    expect(state.finishReason).toBe('stop');
  });

  it('is a no-op returning "continue" when delta is absent', () => {
    const state = freshOpenAiState();
    expect(handleOpenAiChoiceDelta(state, { finish_reason: null }, () => {})).toBe('continue');
  });

  it('routes delta.content through the text-delta handler and can return "break" on contamination', () => {
    const state = freshOpenAiState();
    const events: OpenAiTurnEvent[] = [];
    const result = handleOpenAiChoiceDelta(state, { delta: { content: 'safe\n## user\nmalicious' } }, (e) => events.push(e));
    expect(result).toBe('break');
  });

  it('accumulates delta.tool_calls entries via accumulateOpenAiToolCallDelta', () => {
    const state = freshOpenAiState();
    handleOpenAiChoiceDelta(state, { delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'f', arguments: '{}' } }] } }, () => {});
    expect(state.toolCalls.get(0)).toMatchObject({ id: 'call_1', name: 'f' });
  });

  it('ignores empty-string delta.content (does not emit a text_delta event)', () => {
    const state = freshOpenAiState();
    const events: OpenAiTurnEvent[] = [];
    handleOpenAiChoiceDelta(state, { delta: { content: '' } }, (e) => events.push(e));
    expect(events).toEqual([]);
  });
});

describe('unit: resolveOpenAiToolCalls', () => {
  it('returns an empty array for an empty map', () => {
    expect(resolveOpenAiToolCalls(new Map())).toEqual([]);
  });

  it('parses valid accumulated argsJson', () => {
    const pending = new Map<number, PendingToolCall>([[0, { id: 'call_1', name: 'f', argsJson: '{"a":1}' }]]);
    expect(resolveOpenAiToolCalls(pending)).toEqual([{ id: 'call_1', name: 'f', input: { a: 1 } }]);
  });

  it('defaults to {} for empty or whitespace-only argsJson', () => {
    const pending = new Map<number, PendingToolCall>([[0, { id: 'call_1', name: 'f', argsJson: '   ' }]]);
    expect(resolveOpenAiToolCalls(pending)).toEqual([{ id: 'call_1', name: 'f', input: {} }]);
  });

  it('defaults to {} for malformed argsJson (e.g. a chunk boundary landed mid-token)', () => {
    const pending = new Map<number, PendingToolCall>([[0, { id: 'call_1', name: 'f', argsJson: '{"a":' }]]);
    expect(resolveOpenAiToolCalls(pending)).toEqual([{ id: 'call_1', name: 'f', input: {} }]);
  });

  it('preserves insertion order across multiple pending calls', () => {
    const pending = new Map<number, PendingToolCall>([
      [0, { id: 'call_a', name: 'a', argsJson: '{}' }],
      [1, { id: 'call_b', name: 'b', argsJson: '{}' }],
    ]);
    expect(resolveOpenAiToolCalls(pending).map((c) => c.id)).toEqual(['call_a', 'call_b']);
  });
});

describe('unit: processOpenAiStreamFrame', () => {
  it('returns "done" on the [DONE] sentinel without touching state', () => {
    const state = freshOpenAiState();
    expect(processOpenAiStreamFrame(state, { event: null, data: '[DONE]' }, () => {})).toBe('done');
  });

  it('returns "continue" for a malformed/non-JSON frame', () => {
    const state = freshOpenAiState();
    expect(processOpenAiStreamFrame(state, { event: null, data: 'not-json' }, () => {})).toBe('continue');
  });

  it('applies usage even when the chunk carries no choice (a usage-only trailer chunk)', () => {
    const state = freshOpenAiState();
    const events: OpenAiTurnEvent[] = [];
    const result = processOpenAiStreamFrame(state, { event: null, data: JSON.stringify({ usage: { total_tokens: 7 } }) }, (e) => events.push(e));
    expect(result).toBe('continue');
    expect(state.usage).toEqual({ total_tokens: 7 });
  });

  it('reduces a normal content chunk into state and returns "continue"', () => {
    const state = freshOpenAiState();
    const events: OpenAiTurnEvent[] = [];
    const frame = { event: null, data: JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) };
    const result = processOpenAiStreamFrame(state, frame, (e) => events.push(e));
    expect(result).toBe('continue');
    expect(state.fullText).toBe('hi');
  });

  it('returns "contaminated" once a fabricated role marker is detected in a content chunk', () => {
    const state = freshOpenAiState();
    const frame = { event: null, data: JSON.stringify({ choices: [{ delta: { content: 'safe\n## user\nmalicious' } }] }) };
    expect(processOpenAiStreamFrame(state, frame, () => {})).toBe('contaminated');
  });
});

describe('unit: invalidOpenAiContentPartReason', () => {
  it('accepts a text part', () => {
    expect(invalidOpenAiContentPartReason({ type: 'text', text: 'hi' })).toBeNull();
  });

  it('accepts a plain https url (not size-checked; OpenAI fetches it server-side)', () => {
    expect(invalidOpenAiContentPartReason({ type: 'image_url', image_url: { url: 'https://example.com/x.png' } })).toBeNull();
  });

  it('accepts a data URI within the size guard and an allowed media type', () => {
    expect(invalidOpenAiContentPartReason({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })).toBeNull();
  });

  it('rejects a data URI with an unsupported media type', () => {
    expect(invalidOpenAiContentPartReason({ type: 'image_url', image_url: { url: 'data:image/tiff;base64,AAAA' } })).toContain('unsupported image media type');
  });

  it('rejects a data URI over the 20MB size guard', () => {
    const oversized = 'A'.repeat(Math.ceil((20 * 1024 * 1024 * 4) / 3) + 1);
    expect(invalidOpenAiContentPartReason({ type: 'image_url', image_url: { url: `data:image/png;base64,${oversized}` } })).toContain('20 MB base64 size guard');
  });
});

describe('unit: sanitizeOpenAiToolResult', () => {
  it('passes a plain string through unchanged with isError:false', () => {
    expect(sanitizeOpenAiToolResult({ content: 'ok' })).toEqual({ content: 'ok', isError: false });
  });

  it('passes valid content parts through unchanged', () => {
    const content: OpenAiContentPart[] = [{ type: 'text', text: 'hi' }];
    expect(sanitizeOpenAiToolResult({ content })).toEqual({ content, isError: false });
  });

  it('rejects a result with more than 1500 parts', () => {
    const content: OpenAiContentPart[] = Array.from({ length: 1501 }, () => ({ type: 'text', text: 'x' }));
    const result = sanitizeOpenAiToolResult({ content });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('exceeds the 1500-image-per-request guard');
  });

  it('rejects a result containing an invalid image part', () => {
    const content: OpenAiContentPart[] = [{ type: 'image_url', image_url: { url: 'data:image/tiff;base64,AAAA' } }];
    const result = sanitizeOpenAiToolResult({ content });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('tool result rejected');
  });
});

describe('unit: splitOpenAiToolResultContent', () => {
  it('leaves a plain string untouched with no image parts', () => {
    expect(splitOpenAiToolResultContent('ok')).toEqual({ toolMessageContent: 'ok', imageParts: [] });
  });

  it('keeps text parts in order and separates image parts', () => {
    const content: OpenAiContentPart[] = [
      { type: 'text', text: 'first' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: 'second' },
    ];
    const split = splitOpenAiToolResultContent(content);
    expect(split.toolMessageContent).toEqual([{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }]);
    expect(split.imageParts).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
  });

  it('substitutes a placeholder text part when the result is image-only (never leaves an empty tool message)', () => {
    const content: OpenAiContentPart[] = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }];
    const split = splitOpenAiToolResultContent(content);
    expect(split.toolMessageContent).toEqual([{ type: 'text', text: '(tool result included only non-text content; see the following message)' }]);
    expect(split.imageParts).toHaveLength(1);
  });
});

describe('unit: openAiLoopExitReason', () => {
  const outcome = (over: Partial<OpenAiCompatibleRequestOutcome> = {}): OpenAiCompatibleRequestOutcome => ({ finishReason: null, toolCalls: [], text: '', ...over });

  it('returns "stop" when finishReason is not tool_calls', () => {
    expect(openAiLoopExitReason(outcome({ finishReason: 'stop' }), 0, 8)).toBe('stop');
  });

  it('returns "stop" when finishReason is tool_calls but toolCalls is empty', () => {
    expect(openAiLoopExitReason(outcome({ finishReason: 'tool_calls', toolCalls: [] }), 0, 8)).toBe('stop');
  });

  it('returns "max_tool_turns" once the ceiling is reached', () => {
    const call: OpenAiToolCall = { id: 'call_1', name: 'f', input: {} };
    expect(openAiLoopExitReason(outcome({ finishReason: 'tool_calls', toolCalls: [call] }), 8, 8)).toBe('max_tool_turns');
  });

  it('returns null (proceed to execute tools) when under the ceiling with pending tool calls', () => {
    const call: OpenAiToolCall = { id: 'call_1', name: 'f', input: {} };
    expect(openAiLoopExitReason(outcome({ finishReason: 'tool_calls', toolCalls: [call] }), 3, 8)).toBeNull();
  });
});

describe('unit: executeOpenAiToolCalls', () => {
  it('runs a text-only call: tool message carries the text, no follow-up message', async () => {
    const call: OpenAiToolCall = { id: 'call_1', name: 'get_weather', input: {} };
    const executeTool = vi.fn().mockResolvedValue({ content: 'sunny' });
    const events: OpenAiTurnEvent[] = [];
    const outcome = await executeOpenAiToolCalls(executeTool, [call], (e) => events.push(e));
    expect(outcome.toolResultMessages).toEqual([{ role: 'tool', content: 'sunny', tool_call_id: 'call_1' }]);
    expect(outcome.followUpParts).toEqual([]);
    expect(events).toEqual([{ type: 'tool_result', toolUseId: 'call_1', content: 'sunny', isError: false }]);
  });

  it('runs a call whose result includes an image: image is labeled and moved to followUpParts, tool message stays text-only', async () => {
    const call: OpenAiToolCall = { id: 'call_1', name: 'screenshot', input: {} };
    const executeTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'here' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
    });
    const outcome = await executeOpenAiToolCalls(executeTool, [call], () => {});
    expect(outcome.toolResultMessages).toEqual([{ role: 'tool', content: [{ type: 'text', text: 'here' }], tool_call_id: 'call_1' }]);
    expect(outcome.followUpParts[0]).toEqual({ type: 'text', text: 'Image output from tool `screenshot` (tool_call_id: call_1):' });
    expect(outcome.followUpParts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });

  it('runs two calls, only one with an image: followUpParts contains exactly one labeled group', async () => {
    const calls: OpenAiToolCall[] = [
      { id: 'call_1', name: 'get_weather', input: {} },
      { id: 'call_2', name: 'screenshot', input: {} },
    ];
    const executeTool = vi.fn().mockImplementation(async (c: OpenAiToolCall) =>
      c.id === 'call_2' ? { content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] } : { content: 'sunny' },
    );
    const outcome = await executeOpenAiToolCalls(executeTool, calls, () => {});
    expect(outcome.toolResultMessages).toHaveLength(2);
    expect(outcome.followUpParts).toHaveLength(2); // one label + one image, for call_2 only
    expect(outcome.followUpParts[0]).toMatchObject({ text: expect.stringContaining('call_2') });
  });

  it('routes an invalid image result through sanitizeOpenAiToolResult, marking it isError:true', async () => {
    const call: OpenAiToolCall = { id: 'call_1', name: 'screenshot', input: {} };
    const executeTool = vi.fn().mockResolvedValue({ content: [{ type: 'image_url', image_url: { url: 'data:image/tiff;base64,AAAA' } }] });
    const events: OpenAiTurnEvent[] = [];
    await executeOpenAiToolCalls(executeTool, [call], (e) => events.push(e));
    expect(events[0]).toMatchObject({ isError: true });
  });
});

describe('unit: buildOpenAiAssistantToolCallMessage', () => {
  it('carries non-empty text as content', () => {
    expect(buildOpenAiAssistantToolCallMessage('note', [])).toEqual({ role: 'assistant', content: 'note', tool_calls: [] });
  });

  it('falls back to null (never empty string) when text is empty', () => {
    const toolCalls = [{ id: 'call_1', type: 'function' as const, function: { name: 'f', arguments: '{}' } }];
    expect(buildOpenAiAssistantToolCallMessage('', toolCalls)).toEqual({ role: 'assistant', content: null, tool_calls: toolCalls });
  });
});

describe('unit: buildOpenAiToolExchangeMessages', () => {
  it('returns only the tool messages when there are no follow-up parts', () => {
    const toolMessages: OpenAiMessageParam[] = [{ role: 'tool', content: 'ok', tool_call_id: 'call_1' }];
    expect(buildOpenAiToolExchangeMessages(toolMessages, [])).toEqual(toolMessages);
  });

  it('appends a single follow-up user message when follow-up parts are present', () => {
    const toolMessages: OpenAiMessageParam[] = [{ role: 'tool', content: 'ok', tool_call_id: 'call_1' }];
    const followUpParts: OpenAiContentPart[] = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }];
    const result = buildOpenAiToolExchangeMessages(toolMessages, followUpParts);
    expect(result).toEqual([...toolMessages, { role: 'user', content: followUpParts }]);
  });
});
