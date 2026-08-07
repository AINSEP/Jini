import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runAnthropicToolTurn,
  anthropicRequestUrl,
  anthropicHeaders,
  anthropicRequestBody,
  extractAnthropicErrorDetail,
  invalidToolResultContentBlockReason,
  guardToolResult,
  parseAnthropicSseData,
  handleContentBlockStart,
  handleAnthropicTextDelta,
  handleAnthropicInputJsonDelta,
  handleContentBlockDelta,
  parseAccumulatedToolInputJson,
  handleContentBlockStop,
  handleMessageDelta,
  handleAnthropicErrorFrame,
  anthropicFrameKind,
  anthropicLoopExitReason,
  buildAnthropicAssistantContent,
  executeAnthropicToolCalls,
  type AnthropicMessageParam,
  type AnthropicTurnEvent,
  type AnthropicStreamState,
  type AnthropicToolCall,
  type AnthropicToolResultContentBlock,
  type SingleRequestOutcome,
} from '../anthropic-messages.js';
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
 * `pinnedFetch` (the transport `runSingleAnthropicRequest` actually calls, since the DNS-rebinding
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

function sseFrame(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function messageStart(id = 'msg_1'): string {
  return sseFrame('message_start', {
    type: 'message_start',
    message: { id, type: 'message', role: 'assistant', content: [], model: 'claude-opus-4-8', stop_reason: null, stop_sequence: null },
  });
}

function textBlock(index: number, text: string): string {
  return (
    sseFrame('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }) +
    sseFrame('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }) +
    sseFrame('content_block_stop', { type: 'content_block_stop', index })
  );
}

function toolUseBlock(index: number, id: string, name: string, input: unknown): string {
  const json = JSON.stringify(input);
  return (
    sseFrame('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } }) +
    sseFrame('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json } }) +
    sseFrame('content_block_stop', { type: 'content_block_stop', index })
  );
}

function messageDelta(stopReason: string, usage: Record<string, unknown> = { output_tokens: 10 }): string {
  return sseFrame('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage });
}

function messageStop(): string {
  return sseFrame('message_stop', { type: 'message_stop' });
}

function okResponse(body: AsyncIterable<string>) {
  return { ok: true, status: 200, body, text: async () => '' };
}

const baseMessages: AnthropicMessageParam[] = [{ role: 'user', content: 'hi' }];

describe('runAnthropicToolTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(pinnedFetch).mockReset();
  });

  it('rejects a forbidden internal base url without making any request', async () => {
    const fetchMock = vi.fn();
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: AnthropicTurnEvent[] = [];
    const result = await runAnthropicToolTurn({
      apiKey: 'sk-ant-test',
      baseUrl: 'http://10.0.0.5',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
    expect(result.stopReason).toBeNull();
  });

  // Same textual-only guard as the OpenAI runner had: `http://10.0.0.5` was rejected, but a
  // hostname resolving to it was not, so `baseUrl` could steer this runner at internal
  // infrastructure. The DNS-resolving guard already existed and was already used by Azure/Google/
  // Ollama — it simply was not wired in here.
  it('rejects a public hostname that resolves into private address space, without making any request', async () => {
    dnsAnswers.set('internal.example.com', [{ address: '10.0.0.5', family: 4 }]);
    const fetchMock = vi.fn();
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: AnthropicTurnEvent[] = [];

    await runAnthropicToolTurn({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      maxTokens: 256,
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
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: AnthropicTurnEvent[] = [];

    await runAnthropicToolTurn({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      baseUrl: 'https://api.vendor.example',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });

    // The guard let it through — the request was attempted and failed at the network, not at the
    // guard. Asserting on the *reason* it failed is what distinguishes "allowed" from "blocked".
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'error', message: 'ECONNRESET' });
  });

  it('reports a network error (non-Error rejection) as a redacted error event and ends once', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockRejectedValue('boom'));
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant-secret',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'boom' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('reports a network error (real Error rejection) using its message', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockRejectedValue(new Error('fetch failed: ECONNRESET')));
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'fetch failed: ECONNRESET' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('reports a non-ok JSON error response with the status code and redacts the api key', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        body: null,
        text: async () => JSON.stringify({ error: { message: 'invalid x-api-key: sk-ant-secret' } }),
      }),
    );
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant-secret',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'invalid x-api-key: [REDACTED]', code: '401' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('falls back to the raw truncated body when the error response is not JSON', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: false, status: 500, body: null, text: async () => 'gateway exploded' }));
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events[0]).toEqual({ type: 'error', message: 'gateway exploded', code: '500' });
  });

  it('reports a missing response body as an error', async () => {
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue({ ok: true, status: 200, body: null, text: async () => '' }));
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'Anthropic response had no body' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('streams a plain text response through to text_delta/usage events and ends with reason stop', async () => {
    const body = sseBody(
      messageStart(),
      textBlock(0, 'Hello'),
      messageDelta('end_turn'),
      messageStop(),
    );
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: AnthropicTurnEvent[] = [];
    const result = await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'status', label: 'requesting' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'usage', usage: { output_tokens: 10 } },
      { type: 'end', reason: 'stop' },
    ]);
    expect(result).toEqual({ stopReason: 'end_turn', toolTurns: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['HTTP-Referer']).toBeUndefined();
    expect(init.headers['X-Title']).toBeUndefined();
  });

  it('merges caller-supplied extraHeaders verbatim (never a hardcoded product-identity header)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(messageStart(), textBlock(0, 'hi'), messageDelta('end_turn'), messageStop())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: () => {},
      extraHeaders: { 'HTTP-Referer': 'https://caller.example.com', 'X-Title': 'Caller App' },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['HTTP-Referer']).toBe('https://caller.example.com');
    expect(init.headers['X-Title']).toBe('Caller App');
  });

  it('includes system/temperature/tools/custom apiVersion/baseUrl and forwards the abort signal when provided, and omits them when not', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(messageStart(), textBlock(0, 'hi'), messageDelta('end_turn'), messageStop())));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const controller = new AbortController();
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      baseUrl: 'https://gateway.example.com/',
      apiVersion: '2099-01-01',
      model: 'claude-opus-4-8',
      system: 'be terse',
      temperature: 0.5,
      tools: [{ name: 'get_weather', input_schema: { type: 'object', properties: {} } }],
      maxTokens: 256,
      messages: baseMessages,
      onEvent: () => {},
      signal: controller.signal,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/v1/messages');
    expect(init.headers['anthropic-version']).toBe('2099-01-01');
    expect(init.signal).toBe(controller.signal);
    const requestBody = JSON.parse(init.body);
    expect(requestBody.system).toBe('be terse');
    expect(requestBody.temperature).toBe(0.5);
    expect(requestBody.tools).toEqual([{ name: 'get_weather', input_schema: { type: 'object', properties: {} } }]);

    fetchMock.mockClear();
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: () => {},
    });
    const [, initNoExtras] = fetchMock.mock.calls[0]!;
    expect(initNoExtras.signal).toBeUndefined();
    const bodyNoExtras = JSON.parse(initNoExtras.body);
    expect(bodyNoExtras.system).toBeUndefined();
    expect(bodyNoExtras.temperature).toBeUndefined();
    expect(bodyNoExtras.tools).toBeUndefined();
  });

  it('ignores an unrecognized content-block type, a non-record JSON frame, and a malformed JSON keep-alive frame without crashing', async () => {
    const body = sseBody(
      messageStart(),
      'data: not-json-at-all\n\n',
      'data: 42\n\n',
      'data: ["not","a","record"]\n\n',
      // A frame whose JSON body has no `type` field — `kind` falls back to the SSE `event:` line.
      'event: ping\ndata: {}\n\n',
      sseFrame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking' } }),
      sseFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'redacted_delta' } }),
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      // input_json_delta arriving with no matching content_block_start (never-started index).
      sseFrame('content_block_delta', { type: 'content_block_delta', index: 9, delta: { type: 'input_json_delta', partial_json: '{}' } }),
      messageDelta('end_turn'),
      messageStop(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: AnthropicTurnEvent[] = [];
    const result = await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(result.stopReason).toBe('end_turn');
    expect(events.map((e) => e.type)).toEqual(['status', 'usage', 'end']);
  });

  it('ignores content_block_start/delta/stop frames with a malformed shape (non-record payload, non-numeric index) without crashing', async () => {
    const body = sseBody(
      messageStart(),
      // No `event:` line and no `type` field — `kind` has nothing to fall back to.
      'data: {}\n\n',
      // content_block_start: `content_block` isn't a record.
      sseFrame('content_block_start', { type: 'content_block_start', index: 0, content_block: 'not-a-record' }),
      // content_block_start: `index` isn't a number.
      sseFrame('content_block_start', { type: 'content_block_start', index: 'zero', content_block: { type: 'text', text: '' } }),
      // content_block_delta: `delta` isn't a record.
      sseFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: 'not-a-record' }),
      // content_block_delta: `index` isn't a number.
      sseFrame('content_block_delta', { type: 'content_block_delta', index: 'zero', delta: { type: 'text_delta', text: 'x' } }),
      // content_block_stop: `index` isn't a number.
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 'zero' }),
      messageDelta('end_turn'),
      messageStop(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: AnthropicTurnEvent[] = [];
    const result = await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(result.stopReason).toBe('end_turn');
    expect(events.map((e) => e.type)).toEqual(['status', 'usage', 'end']);
  });

  it('closes a tool_use block that received no input_json_delta with an empty-object input', async () => {
    const body = sseBody(
      messageStart(),
      sseFrame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'no_args_tool' },
      }),
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      messageDelta('tool_use'),
      messageStop(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    const toolUseEvent = events.find((e) => e.type === 'tool_use');
    expect(toolUseEvent).toMatchObject({ type: 'tool_use', id: 'toolu_1', name: 'no_args_tool', input: {} });
  });

  it('runs a full tool-use loop: emits tool_use, invokes executeTool, emits tool_result, and continues to a final stop', async () => {
    const firstBody = sseBody(
      messageStart('msg_1'),
      textBlock(0, "Let's check "),
      toolUseBlock(1, 'toolu_1', 'get_weather', { location: 'SF' }),
      messageDelta('tool_use'),
      messageStop(),
    );
    const secondBody = sseBody(messageStart('msg_2'), textBlock(0, 'Sunny.'), messageDelta('end_turn'), messageStop());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(firstBody))
      .mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

    const events: AnthropicTurnEvent[] = [];
    const executeTool = vi.fn().mockResolvedValue({ content: '72F sunny' });
    const result = await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith({ id: 'toolu_1', name: 'get_weather', input: { location: 'SF' } });
    expect(result).toEqual({ stopReason: 'end_turn', toolTurns: 1 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
    expect(events).toContainEqual({ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { location: 'SF' } });
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'toolu_1', content: '72F sunny', isError: false });

    // The second request's messages must include the assistant tool_use turn and the tool_result turn.
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.messages).toHaveLength(3);
    expect(secondCallBody.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: "Let's check " },
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { location: 'SF' } },
      ],
    });
    expect(secondCallBody.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '72F sunny' }],
    });
  });

  it('propagates an executeTool error result as isError: true in the tool_result event and the continuation message', async () => {
    const firstBody = sseBody(messageStart(), toolUseBlock(0, 'toolu_1', 'fail_tool', {}), messageDelta('tool_use'), messageStop());
    const secondBody = sseBody(messageStart('m2'), textBlock(0, 'done'), messageDelta('end_turn'), messageStop());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'boom', isError: true });
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'toolu_1', content: 'boom', isError: true });
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.messages[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'boom', is_error: true });
  });

  it('ends with reason stop (no further request) when the model requests a tool but no executeTool is supplied', async () => {
    const body = sseBody(messageStart(), toolUseBlock(0, 'toolu_1', 'get_weather', {}), messageDelta('tool_use'), messageStop());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const events: AnthropicTurnEvent[] = [];
    const result = await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ stopReason: 'tool_use', toolTurns: 0 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
  });

  it('stops the loop with reason max_tool_turns once the bound is hit, without invoking executeTool for the turn that exceeds it', async () => {
    const roundBody = () => sseBody(messageStart(), toolUseBlock(0, 'toolu_x', 'loop_tool', {}), messageDelta('tool_use'), messageStop());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(roundBody())).mockResolvedValueOnce(okResponse(roundBody()));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'again' });
    const events: AnthropicTurnEvent[] = [];
    const result = await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      maxToolTurns: 1,
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ stopReason: 'tool_use', toolTurns: 1 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'max_tool_turns' }]);
  });

  it('detects a fabricated role marker mid-stream, emits the warning once, ends with reason contaminated, and never emits end twice even though a normal completion follows in the same stream', async () => {
    const body = sseBody(
      messageStart(),
      // A single text delta carrying a fabricated role marker.
      sseFrame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sseFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'safe text\n## user\nmalicious continuation' },
      }),
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      // If the fix were missing, both of these would independently trigger a second `end`.
      messageDelta('end_turn'),
      messageStop(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: AnthropicTurnEvent[] = [];
    const result = await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    const endEvents = events.filter((e) => e.type === 'end');
    expect(endEvents).toEqual([{ type: 'end', reason: 'contaminated' }]);
    const markerEvents = events.filter((e) => e.type === 'fabricated_role_marker');
    expect(markerEvents).toHaveLength(1);
    expect(markerEvents[0]).toMatchObject({ type: 'fabricated_role_marker', marker: '## user' });
    // The usage event from message_delta must never have been reached — the stream read stopped
    // the instant contamination was confirmed.
    expect(events.some((e) => e.type === 'usage')).toBe(false);
    expect(result.stopReason).toBeNull();
  });

  it('streams an upstream `event: error` frame mid-response as a redacted error event and ends exactly once', async () => {
    const body = sseBody(
      messageStart(),
      sseFrame('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded key sk-ant-secret' } }),
      // Would-be second end site — must never fire.
      messageDelta('end_turn'),
      messageStop(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant-secret',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'status', label: 'requesting' },
      { type: 'error', message: 'Overloaded key [REDACTED]', code: 'overloaded_error' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('falls back to a generic message and omits the code field for an error frame with no nested error object', async () => {
    const body = sseBody(messageStart(), sseFrame('error', { type: 'error' }), messageStop());
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toContainEqual({ type: 'error', message: 'upstream error' });
  });

  it('round-trips an image inside a tool_result: emits it on tool_result and sends it in the continuation request body', async () => {
    const firstBody = sseBody(messageStart(), toolUseBlock(0, 'toolu_1', 'take_screenshot', {}), messageDelta('tool_use'), messageStop());
    const secondBody = sseBody(messageStart('m2'), textBlock(0, 'looks right'), messageDelta('end_turn'), messageStop());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

    const imageBlock = {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'iVBORw0KGgoAAAANSUhEUg==' },
    };
    const executeTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'here is the screenshot' }, imageBlock],
    });
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });

    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'toolu_1',
      content: [{ type: 'text', text: 'here is the screenshot' }, imageBlock],
      isError: false,
    });
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: [{ type: 'text', text: 'here is the screenshot' }, imageBlock],
        },
      ],
    });
  });

  it('still accepts a plain-string tool_result alongside image-bearing ones in the same turn (backward compatibility)', async () => {
    const firstBody = sseBody(
      messageStart(),
      toolUseBlock(0, 'toolu_1', 'get_weather', {}),
      toolUseBlock(1, 'toolu_2', 'take_screenshot', {}),
      messageDelta('tool_use'),
      messageStop(),
    );
    const secondBody = sseBody(messageStart('m2'), textBlock(0, 'done'), messageDelta('end_turn'), messageStop());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

    const executeTool = vi.fn().mockImplementation(async (call: { name: string }) =>
      call.name === 'get_weather'
        ? { content: '72F sunny' }
        : { content: [{ type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/shot.png' } }] },
    );
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      executeTool,
      onEvent: () => {},
    });

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '72F sunny' },
      {
        type: 'tool_result',
        tool_use_id: 'toolu_2',
        content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/shot.png' } }],
      },
    ]);
  });

  it('rejects a tool_result image with an unsupported media_type as a normal is_error result instead of forwarding it upstream', async () => {
    const firstBody = sseBody(messageStart(), toolUseBlock(0, 'toolu_1', 'take_screenshot', {}), messageDelta('tool_use'), messageStop());
    const secondBody = sseBody(messageStart('m2'), textBlock(0, 'ok'), messageDelta('end_turn'), messageStop());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

    const executeTool = vi.fn().mockResolvedValue({
      content: [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/heic' as never, data: 'abc' } }],
    });
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toMatchObject({ isError: true });
    expect(String((toolResultEvent as { content: unknown }).content)).toContain('unsupported image media_type');
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondCallBody.messages[2].content[0].is_error).toBe(true);
    expect(typeof secondCallBody.messages[2].content[0].content).toBe('string');
  });

  it('rejects a tool_result image whose base64 payload exceeds the direct API 10 MB limit as an is_error result', async () => {
    const firstBody = sseBody(messageStart(), toolUseBlock(0, 'toolu_1', 'take_screenshot', {}), messageDelta('tool_use'), messageStop());
    const secondBody = sseBody(messageStart('m2'), textBlock(0, 'ok'), messageDelta('end_turn'), messageStop());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

    const oversizedData = 'A'.repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 1);
    const executeTool = vi.fn().mockResolvedValue({
      content: [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: oversizedData } }],
    });
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });

    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toMatchObject({ isError: true });
    expect(String((toolResultEvent as { content: unknown }).content)).toContain('10 MB base64 size limit');
  });

  it('does not size-check a url-sourced tool_result image (Anthropic fetches it, not this adapter)', async () => {
    const firstBody = sseBody(messageStart(), toolUseBlock(0, 'toolu_1', 'take_screenshot', {}), messageDelta('tool_use'), messageStop());
    const secondBody = sseBody(messageStart('m2'), textBlock(0, 'ok'), messageDelta('end_turn'), messageStop());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.mocked(pinnedFetch).mockImplementation(fetchMock);

    const executeTool = vi.fn().mockResolvedValue({
      content: [{ type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/huge.png' } }],
    });
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      executeTool,
      onEvent: (e) => events.push(e),
    });

    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'toolu_1',
      content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/huge.png' } }],
      isError: false,
    });
  });

  it('defaults a tool_use block with unparsable partial JSON input to an empty object', async () => {
    const body = sseBody(
      messageStart(),
      sseFrame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'noop', input: {} } }),
      sseFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'not valid json' } }),
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      messageDelta('tool_use'),
      messageStop(),
    );
    vi.mocked(pinnedFetch).mockImplementation(vi.fn().mockResolvedValue(okResponse(body)));
    const events: AnthropicTurnEvent[] = [];
    await runAnthropicToolTurn({
      apiKey: 'sk-ant',
      model: 'claude-opus-4-8',
      maxTokens: 256,
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toContainEqual({ type: 'tool_use', id: 't1', name: 'noop', input: {} });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for the extracted reducer/builder helpers, exercised directly
// (no HTTP mock, no full turn) so their branches, edge cases, and error paths
// are pinned independently of the end-to-end characterization tests above.
// ---------------------------------------------------------------------------

function minimalOptions(overrides: Partial<Parameters<typeof anthropicHeaders>[0]> = {}): Parameters<typeof anthropicHeaders>[0] {
  return {
    apiKey: 'sk-ant-test',
    model: 'claude-opus-4-8',
    maxTokens: 256,
    messages: [],
    onEvent: () => {},
    ...overrides,
  };
}

function freshAnthropicState(messageId = 'unit-test'): AnthropicStreamState {
  return { guard: createRoleMarkerGuard(messageId), blocks: new Map(), toolCalls: [], fullText: '', stopReason: null, usage: null };
}

describe('unit: anthropicRequestUrl', () => {
  it('defaults to api.anthropic.com/v1/messages when baseUrl is omitted', () => {
    expect(anthropicRequestUrl(undefined)).toBe('https://api.anthropic.com/v1/messages');
  });

  it('trims one or more trailing slashes from a caller-supplied baseUrl', () => {
    expect(anthropicRequestUrl('https://gateway.example.com/')).toBe('https://gateway.example.com/v1/messages');
    expect(anthropicRequestUrl('https://gateway.example.com///')).toBe('https://gateway.example.com/v1/messages');
  });

  it('leaves a baseUrl with no trailing slash unchanged before appending the path', () => {
    expect(anthropicRequestUrl('https://gateway.example.com')).toBe('https://gateway.example.com/v1/messages');
  });
});

describe('unit: anthropicHeaders', () => {
  it('sends the default anthropic-version and the api key when apiVersion/extraHeaders are omitted', () => {
    expect(anthropicHeaders(minimalOptions())).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
    });
  });

  it('uses a caller-supplied apiVersion instead of the default', () => {
    expect(anthropicHeaders(minimalOptions({ apiVersion: '2024-01-01' }))['anthropic-version']).toBe('2024-01-01');
  });

  it('merges extraHeaders in, and lets them override a default header of the same name (gateway rewrite use case)', () => {
    const headers = anthropicHeaders(minimalOptions({ extraHeaders: { 'x-api-key': 'overridden', 'X-Gateway': 'openrouter' } }));
    expect(headers['x-api-key']).toBe('overridden');
    expect(headers['X-Gateway']).toBe('openrouter');
  });
});

describe('unit: anthropicRequestBody', () => {
  it('omits system, temperature, and tools when none are supplied', () => {
    const body = anthropicRequestBody(minimalOptions(), []);
    expect(body).toEqual({ model: 'claude-opus-4-8', max_tokens: 256, stream: true, messages: [] });
  });

  it('includes system, temperature, and a non-empty tools array when all are supplied', () => {
    const body = anthropicRequestBody(
      minimalOptions({ system: 'be terse', temperature: 0.5, tools: [{ name: 'get_weather', input_schema: { type: 'object' } }] }),
      [{ role: 'user', content: 'hi' }],
    );
    expect(body).toMatchObject({
      system: 'be terse',
      temperature: 0.5,
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('omits tools when the array is present but empty', () => {
    const body = anthropicRequestBody(minimalOptions({ tools: [] }), []);
    expect(body).not.toHaveProperty('tools');
  });

  it('includes temperature 0 (a falsy-but-valid value) because the check is against undefined, not truthiness', () => {
    const body = anthropicRequestBody(minimalOptions({ temperature: 0 }), []);
    expect(body).toMatchObject({ temperature: 0 });
  });
});

describe('unit: extractAnthropicErrorDetail', () => {
  it('extracts error.message from a well-formed JSON error body', () => {
    expect(extractAnthropicErrorDetail(JSON.stringify({ error: { type: 'invalid_request_error', message: 'bad model id' } }))).toBe('bad model id');
  });

  it('falls back to the raw trimmed text when the JSON body has no error.message', () => {
    expect(extractAnthropicErrorDetail(JSON.stringify({ foo: 'bar' }))).toBe('{"foo":"bar"}');
  });

  it('falls back to the raw trimmed text for a non-JSON body', () => {
    expect(extractAnthropicErrorDetail('  <html>Bad Gateway</html>  ')).toBe('<html>Bad Gateway</html>');
  });

  it('truncates a very long raw body to 500 characters', () => {
    const huge = 'x'.repeat(10_000);
    expect(extractAnthropicErrorDetail(huge)).toHaveLength(500);
  });
});

describe('unit: invalidToolResultContentBlockReason', () => {
  const textBlock: AnthropicToolResultContentBlock = { type: 'text', text: 'hi' };
  const urlImage: AnthropicToolResultContentBlock = { type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } };
  const validBase64Image: AnthropicToolResultContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };

  it('accepts a text block', () => {
    expect(invalidToolResultContentBlockReason(textBlock)).toBeNull();
  });

  it('accepts a url-sourced image without checking its size (Anthropic fetches it server-side)', () => {
    expect(invalidToolResultContentBlockReason(urlImage)).toBeNull();
  });

  it('accepts a base64 image within the 10MB limit and an allowed media type', () => {
    expect(invalidToolResultContentBlockReason(validBase64Image)).toBeNull();
  });

  it('rejects a base64 image with an unsupported media type', () => {
    const block: AnthropicToolResultContentBlock = {
      type: 'image',
      // @ts-expect-error - deliberately unsupported media_type for this test
      source: { type: 'base64', media_type: 'image/tiff', data: 'AAAA' },
    };
    expect(invalidToolResultContentBlockReason(block)).toContain('unsupported image media_type');
  });

  it('rejects a base64 image over the 10MB size guard', () => {
    const oversized = 'A'.repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 1);
    const block: AnthropicToolResultContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: oversized } };
    expect(invalidToolResultContentBlockReason(block)).toContain("10 MB base64 size limit");
  });
});

describe('unit: guardToolResult', () => {
  it('passes a plain string result through unchanged', () => {
    expect(guardToolResult({ content: 'ok' })).toEqual({ content: 'ok' });
  });

  it('passes valid content blocks through unchanged', () => {
    const result = { content: [{ type: 'text', text: 'hi' } as const] };
    expect(guardToolResult(result)).toBe(result);
  });

  it('replaces an invalid block with a rejected, isError:true result naming the violation', () => {
    const badBlock: AnthropicToolResultContentBlock = {
      type: 'image',
      // @ts-expect-error - deliberately unsupported media_type for this test
      source: { type: 'base64', media_type: 'image/tiff', data: 'AAAA' },
    };
    const result = { content: [{ type: 'image' as const, source: { type: 'url' as const, url: 'https://x' } }, badBlock] };
    const guarded = guardToolResult(result);
    expect(guarded.isError).toBe(true);
    expect(guarded.content).toContain('[rejected tool result]');
  });
});

describe('unit: parseAnthropicSseData', () => {
  it('parses a valid JSON object', () => {
    expect(parseAnthropicSseData('{"type":"ping"}')).toEqual({ type: 'ping' });
  });

  it('returns null for a JSON array (not a record)', () => {
    expect(parseAnthropicSseData('["a","b"]')).toBeNull();
  });

  it('returns null for a JSON primitive', () => {
    expect(parseAnthropicSseData('42')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseAnthropicSseData('not-json')).toBeNull();
  });
});

describe('unit: handleContentBlockStart', () => {
  it('registers a text block', () => {
    const state = freshAnthropicState();
    handleContentBlockStart(state, { index: 0, content_block: { type: 'text', text: '' } });
    expect(state.blocks.get(0)).toMatchObject({ type: 'text' });
  });

  it('registers a tool_use block with its id and name', () => {
    const state = freshAnthropicState();
    handleContentBlockStart(state, { index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather' } });
    expect(state.blocks.get(1)).toMatchObject({ type: 'tool_use', toolId: 'toolu_1', toolName: 'get_weather' });
  });

  it('registers an unrecognized block type as "other"', () => {
    const state = freshAnthropicState();
    handleContentBlockStart(state, { index: 2, content_block: { type: 'redacted_thinking' } });
    expect(state.blocks.get(2)).toMatchObject({ type: 'other' });
  });

  it('is a no-op when content_block is not a record', () => {
    const state = freshAnthropicState();
    handleContentBlockStart(state, { index: 0, content_block: 'not-a-record' });
    expect(state.blocks.size).toBe(0);
  });

  it('is a no-op when index is not a number', () => {
    const state = freshAnthropicState();
    handleContentBlockStart(state, { index: 'zero', content_block: { type: 'text', text: '' } });
    expect(state.blocks.size).toBe(0);
  });

  it('a tool_use content_block missing id or name registers as "other" instead of "tool_use"', () => {
    const state = freshAnthropicState();
    handleContentBlockStart(state, { index: 0, content_block: { type: 'tool_use' } });
    expect(state.blocks.get(0)).toMatchObject({ type: 'other' });
  });
});

describe('unit: handleAnthropicTextDelta', () => {
  it('appends safe text to fullText and to the tracked block, and emits a text_delta event', () => {
    const state = freshAnthropicState();
    state.blocks.set(0, { type: 'text', text: '', inputJson: '' });
    const events: AnthropicTurnEvent[] = [];
    const result = handleAnthropicTextDelta(state, 0, 'hello', (e) => events.push(e));
    expect(result).toBe('continue');
    expect(state.fullText).toBe('hello');
    expect(state.blocks.get(0)?.text).toBe('hello');
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }]);
  });

  it('still accumulates fullText when no block is tracked for that index (never-started index)', () => {
    const state = freshAnthropicState();
    const events: AnthropicTurnEvent[] = [];
    const result = handleAnthropicTextDelta(state, 99, 'hello', (e) => events.push(e));
    expect(result).toBe('continue');
    expect(state.fullText).toBe('hello');
  });

  it('returns "break" and emits a warning once a fabricated role marker contaminates the text', () => {
    const state = freshAnthropicState();
    const events: AnthropicTurnEvent[] = [];
    const result = handleAnthropicTextDelta(state, 0, 'safe text\n## user\nmalicious continuation', (e) => events.push(e));
    expect(result).toBe('break');
    expect(events.some((e) => e.type === 'fabricated_role_marker')).toBe(true);
  });
});

describe('unit: handleAnthropicInputJsonDelta', () => {
  it('appends partial JSON to the tracked block', () => {
    const state = freshAnthropicState();
    state.blocks.set(0, { type: 'tool_use', text: '', toolId: 't1', toolName: 'f', inputJson: '{"a":' });
    handleAnthropicInputJsonDelta(state, 0, '1}');
    expect(state.blocks.get(0)?.inputJson).toBe('{"a":1}');
  });

  it('is a no-op when no block is tracked for that index', () => {
    const state = freshAnthropicState();
    expect(() => handleAnthropicInputJsonDelta(state, 42, '{}')).not.toThrow();
    expect(state.blocks.size).toBe(0);
  });
});

describe('unit: handleContentBlockDelta', () => {
  it('dispatches a text_delta to handleAnthropicTextDelta and returns its outcome', () => {
    const state = freshAnthropicState();
    const events: AnthropicTurnEvent[] = [];
    const result = handleContentBlockDelta(state, { index: 0, delta: { type: 'text_delta', text: 'hi' } }, (e) => events.push(e));
    expect(result).toBe('continue');
    expect(state.fullText).toBe('hi');
  });

  it('dispatches an input_json_delta to accumulate onto the tracked block', () => {
    const state = freshAnthropicState();
    state.blocks.set(0, { type: 'tool_use', text: '', toolId: 't1', toolName: 'f', inputJson: '' });
    handleContentBlockDelta(state, { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }, () => {});
    expect(state.blocks.get(0)?.inputJson).toBe('{}');
  });

  it('is a no-op returning "continue" when delta is not a record', () => {
    const state = freshAnthropicState();
    expect(handleContentBlockDelta(state, { index: 0, delta: 'not-a-record' }, () => {})).toBe('continue');
  });

  it('is a no-op returning "continue" when index is not a number', () => {
    const state = freshAnthropicState();
    expect(handleContentBlockDelta(state, { index: 'zero', delta: { type: 'text_delta', text: 'hi' } }, () => {})).toBe('continue');
    expect(state.fullText).toBe('');
  });

  it('is a no-op returning "continue" for an unrecognized delta.type', () => {
    const state = freshAnthropicState();
    expect(handleContentBlockDelta(state, { index: 0, delta: { type: 'redacted_delta' } }, () => {})).toBe('continue');
  });
});

describe('unit: parseAccumulatedToolInputJson', () => {
  it('returns {} for an empty string', () => {
    expect(parseAccumulatedToolInputJson('')).toEqual({});
  });

  it('returns {} for a whitespace-only string', () => {
    expect(parseAccumulatedToolInputJson('   \n  ')).toEqual({});
  });

  it('parses valid accumulated JSON', () => {
    expect(parseAccumulatedToolInputJson('{"location":"SF"}')).toEqual({ location: 'SF' });
  });

  it('returns {} for malformed JSON (e.g. a chunk boundary landed mid-token)', () => {
    expect(parseAccumulatedToolInputJson('{"location":')).toEqual({});
  });
});

describe('unit: handleContentBlockStop', () => {
  it('closes a tool_use block: pushes a tool call, emits tool_use, and removes the block', () => {
    const state = freshAnthropicState();
    state.blocks.set(0, { type: 'tool_use', text: '', toolId: 't1', toolName: 'get_weather', inputJson: '{"location":"SF"}' });
    const events: AnthropicTurnEvent[] = [];
    handleContentBlockStop(state, { index: 0 }, (e) => events.push(e));
    expect(state.toolCalls).toEqual([{ id: 't1', name: 'get_weather', input: { location: 'SF' } }]);
    expect(events).toEqual([{ type: 'tool_use', id: 't1', name: 'get_weather', input: { location: 'SF' } }]);
    expect(state.blocks.has(0)).toBe(false);
  });

  it('closes a text block: no tool_use event, block still removed', () => {
    const state = freshAnthropicState();
    state.blocks.set(0, { type: 'text', text: 'hi', inputJson: '' });
    const events: AnthropicTurnEvent[] = [];
    handleContentBlockStop(state, { index: 0 }, (e) => events.push(e));
    expect(events).toEqual([]);
    expect(state.blocks.has(0)).toBe(false);
  });

  it('is a no-op when index is not a number', () => {
    const state = freshAnthropicState();
    state.blocks.set(0, { type: 'text', text: 'hi', inputJson: '' });
    handleContentBlockStop(state, { index: 'zero' }, () => {});
    expect(state.blocks.has(0)).toBe(true);
  });

  it('does nothing when there is no tracked block for that index (never-started index)', () => {
    const state = freshAnthropicState();
    expect(() => handleContentBlockStop(state, { index: 5 }, () => {})).not.toThrow();
    expect(state.toolCalls).toEqual([]);
  });
});

describe('unit: handleMessageDelta', () => {
  it('sets stopReason from delta.stop_reason', () => {
    const state = freshAnthropicState();
    handleMessageDelta(state, { delta: { stop_reason: 'end_turn' } }, () => {});
    expect(state.stopReason).toBe('end_turn');
  });

  it('sets usage and emits a usage event when usage is present', () => {
    const state = freshAnthropicState();
    const events: AnthropicTurnEvent[] = [];
    handleMessageDelta(state, { usage: { output_tokens: 12 } }, (e) => events.push(e));
    expect(state.usage).toEqual({ output_tokens: 12 });
    expect(events).toEqual([{ type: 'usage', usage: { output_tokens: 12 } }]);
  });

  it('is a no-op when neither delta nor usage is present', () => {
    const state = freshAnthropicState();
    const events: AnthropicTurnEvent[] = [];
    handleMessageDelta(state, {}, (e) => events.push(e));
    expect(state.stopReason).toBeNull();
    expect(events).toEqual([]);
  });
});

describe('unit: handleAnthropicErrorFrame', () => {
  it('emits an error event with message and code when both are present', () => {
    const events: AnthropicTurnEvent[] = [];
    handleAnthropicErrorFrame({ error: { type: 'overloaded_error', message: 'busy' } }, (e) => events.push(e), 'sk-ant-secret');
    expect(events).toEqual([{ type: 'error', message: 'busy', code: 'overloaded_error' }]);
  });

  it('falls back to "upstream error" when error.message is missing', () => {
    const events: AnthropicTurnEvent[] = [];
    handleAnthropicErrorFrame({ error: {} }, (e) => events.push(e), 'sk-ant-secret');
    expect(events).toEqual([{ type: 'error', message: 'upstream error' }]);
  });

  it('omits the code field when error.type is missing', () => {
    const events: AnthropicTurnEvent[] = [];
    handleAnthropicErrorFrame({ error: { message: 'oops' } }, (e) => events.push(e), 'sk-ant-secret');
    expect(events).toEqual([{ type: 'error', message: 'oops' }]);
  });

  it('redacts the api key if it appears in the error message', () => {
    const events: AnthropicTurnEvent[] = [];
    handleAnthropicErrorFrame({ error: { message: 'key sk-ant-secret rejected' } }, (e) => events.push(e), 'sk-ant-secret');
    const event = events[0] as { message: string };
    expect(event.message).not.toContain('sk-ant-secret');
  });
});

describe('unit: anthropicFrameKind', () => {
  it('uses data.type when it is a string', () => {
    expect(anthropicFrameKind({ type: 'content_block_start' }, 'ping')).toBe('content_block_start');
  });

  it('falls back to the SSE event: line when data.type is missing', () => {
    expect(anthropicFrameKind({}, 'ping')).toBe('ping');
  });

  it('falls back to an empty string when both data.type and the event: line are absent', () => {
    expect(anthropicFrameKind({}, null)).toBe('');
  });
});

describe('unit: anthropicLoopExitReason', () => {
  const outcome = (over: Partial<SingleRequestOutcome>): SingleRequestOutcome => ({ stopReason: null, toolCalls: [], text: '', ...over });

  it('returns "stop" when the model did not request tool use', () => {
    expect(anthropicLoopExitReason(outcome({ stopReason: 'end_turn' }), 0, 8)).toBe('stop');
  });

  it('returns "stop" when stopReason is tool_use but toolCalls is empty', () => {
    expect(anthropicLoopExitReason(outcome({ stopReason: 'tool_use', toolCalls: [] }), 0, 8)).toBe('stop');
  });

  it('returns "max_tool_turns" once the ceiling is reached', () => {
    const call: AnthropicToolCall = { id: 't1', name: 'f', input: {} };
    expect(anthropicLoopExitReason(outcome({ stopReason: 'tool_use', toolCalls: [call] }), 8, 8)).toBe('max_tool_turns');
  });

  it('returns null (proceed to execute tools) when under the ceiling with pending tool calls', () => {
    const call: AnthropicToolCall = { id: 't1', name: 'f', input: {} };
    expect(anthropicLoopExitReason(outcome({ stopReason: 'tool_use', toolCalls: [call] }), 3, 8)).toBeNull();
  });
});

describe('unit: buildAnthropicAssistantContent', () => {
  it('includes a leading text block when text is non-empty', () => {
    const content = buildAnthropicAssistantContent('thinking...', []);
    expect(content).toEqual([{ type: 'text', text: 'thinking...' }]);
  });

  it('omits the text block when text is empty', () => {
    const call: AnthropicToolCall = { id: 't1', name: 'f', input: { a: 1 } };
    const content = buildAnthropicAssistantContent('', [call]);
    expect(content).toEqual([{ type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } }]);
  });

  it('includes both text and every tool_use block, text first', () => {
    const call: AnthropicToolCall = { id: 't1', name: 'f', input: {} };
    const content = buildAnthropicAssistantContent('note', [call]);
    expect(content).toEqual([{ type: 'text', text: 'note' }, { type: 'tool_use', id: 't1', name: 'f', input: {} }]);
  });
});

describe('unit: executeAnthropicToolCalls', () => {
  it('runs a single call and reduces its result into a tool_result block plus an event', async () => {
    const call: AnthropicToolCall = { id: 't1', name: 'get_weather', input: { location: 'SF' } };
    const events: AnthropicTurnEvent[] = [];
    const executeTool = vi.fn().mockResolvedValue({ content: 'sunny' });
    const blocks = await executeAnthropicToolCalls(executeTool, [call], (e) => events.push(e));
    expect(blocks).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'sunny' }]);
    expect(events).toEqual([{ type: 'tool_result', toolUseId: 't1', content: 'sunny', isError: false }]);
  });

  it('marks a failed tool result with is_error:true and threads it through guardToolResult', async () => {
    const call: AnthropicToolCall = { id: 't1', name: 'fail_tool', input: {} };
    const executeTool = vi.fn().mockResolvedValue({ content: 'boom', isError: true });
    const blocks = await executeAnthropicToolCalls(executeTool, [call], () => {});
    expect(blocks).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }]);
  });

  it('runs multiple calls in order, one tool_result block per call', async () => {
    const calls: AnthropicToolCall[] = [
      { id: 't1', name: 'a', input: {} },
      { id: 't2', name: 'b', input: {} },
    ];
    const executeTool = vi.fn().mockImplementation(async (c: AnthropicToolCall) => ({ content: `result-for-${c.id}` }));
    const blocks = await executeAnthropicToolCalls(executeTool, calls, () => {});
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['t1', 't2']);
    expect(blocks.map((b) => b.content)).toEqual(['result-for-t1', 'result-for-t2']);
  });

  it('rejects an oversized image tool result via the same guardToolResult path used in the full turn', async () => {
    const call: AnthropicToolCall = { id: 't1', name: 'screenshot', input: {} };
    const oversized = 'A'.repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 1);
    const executeTool = vi.fn().mockResolvedValue({ content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: oversized } }] });
    const blocks = await executeAnthropicToolCalls(executeTool, [call], () => {});
    expect(blocks[0]?.is_error).toBe(true);
    expect(blocks[0]?.content).toContain('[rejected tool result]');
  });
});
