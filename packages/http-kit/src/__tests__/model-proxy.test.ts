import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '../origin-validation.js';
import { registerModelProxyRoutes, type ModelProxyHttpDeps } from '../model-proxy.js';

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(() => true),
}));

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  patch: (path: string, handler: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return { get: make('get'), post: make('post'), put: make('put'), delete: make('delete'), patch: make('patch'), handlers };
}

function makeReq(body: unknown) {
  return { body };
}

function makeSseRes() {
  const closeListeners: Array<() => void> = [];
  const drainListeners: Array<() => void> = [];
  const res: any = {
    write: vi.fn((_chunk: string) => true),
    status: vi.fn().mockReturnThis(),
    statusCode: 0,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    end: vi.fn(() => {
      res.writableEnded = true;
    }),
    json: vi.fn().mockReturnThis(),
    headersSent: false,
    writableEnded: false,
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'close') closeListeners.push(listener);
      if (event === 'drain') drainListeners.push(listener);
    }),
  };
  return res;
}

const adapter = { resolvedPortRef: { current: 7456 } };

function mount(deps: ModelProxyHttpDeps = {}) {
  const app = makeApp();
  registerModelProxyRoutes(app as any, deps, adapter);
  return app;
}

/** Every SSE `data:` line's JSON payload, in write order, for a mocked `res.write`. */
function writtenEvents(res: ReturnType<typeof makeSseRes>): Array<{ kind: string; data: unknown }> {
  return res.write.mock.calls.map(([chunk]: [string]) => {
    const dataLine = chunk.split('\n').find((line: string) => line.startsWith('data: '))!;
    const parsed = JSON.parse(dataLine.slice('data: '.length));
    return { kind: parsed.kind, data: parsed.data };
  });
}

function sseBody(...lines: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield line;
    },
  };
}

function anthropicChunk(text: string): string {
  return (
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm1', content: [] } })}\n\n` +
    `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n` +
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n` +
    `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n` +
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} })}\n\n` +
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`
  );
}

function anthropicToolUseChunk(id: string, name: string, input: unknown): string {
  const json = JSON.stringify(input);
  return (
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm1', content: [] } })}\n\n` +
    `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } })}\n\n` +
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json } })}\n\n` +
    `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n` +
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: {} })}\n\n` +
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`
  );
}

function openAiChunk(text: string): string {
  const chunk = { id: 'c1', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] };
  const final = { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`;
}

function okResponse(body: AsyncIterable<string>) {
  return { ok: true, status: 200, body, text: async () => '' };
}

const validAnthropicBody = {
  apiKey: 'sk-ant-test',
  model: 'claude-opus-4-8',
  maxTokens: 256,
  messages: [{ role: 'user', content: 'hi' }],
};

const validOpenAiBody = {
  apiKey: 'sk-test',
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hi' }],
};

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerModelProxyRoutes — route registration', () => {
  it('mounts both provider streaming routes', () => {
    const app = mount();
    expect(Object.keys(app.handlers)).toEqual(
      expect.arrayContaining(['POST /api/proxy/anthropic/stream', 'POST /api/proxy/openai/stream']),
    );
  });
});

describe('POST /api/proxy/anthropic/stream', () => {
  function handler(deps: ModelProxyHttpDeps = {}) {
    return mount(deps).handlers['POST /api/proxy/anthropic/stream']!;
  }

  it('rejects a cross-origin request with 403 before touching fetch', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validAnthropicBody), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'FORBIDDEN', message: 'cross-origin request rejected' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-object body', 'not an object', 'body must be a JSON object'],
    ['a missing apiKey', { ...validAnthropicBody, apiKey: undefined }, 'apiKey must be a non-empty string'],
    ['an empty-string apiKey', { ...validAnthropicBody, apiKey: '  ' }, 'apiKey must be a non-empty string'],
    ['a missing model', { ...validAnthropicBody, model: undefined }, 'model must be a non-empty string'],
    ['a missing messages array', { ...validAnthropicBody, messages: undefined }, 'messages must be a non-empty array'],
    ['an empty messages array', { ...validAnthropicBody, messages: [] }, 'messages must be a non-empty array'],
    ['a non-string baseUrl', { ...validAnthropicBody, baseUrl: 42 }, 'baseUrl must be a string when provided'],
    ['a non-number temperature', { ...validAnthropicBody, temperature: 'hot' }, 'temperature must be a number when provided'],
    ['a non-number maxToolTurns', { ...validAnthropicBody, maxToolTurns: 'many' }, 'maxToolTurns must be a number when provided'],
    ['a non-object extraHeaders', { ...validAnthropicBody, extraHeaders: 'nope' }, 'extraHeaders must be an object when provided'],
    ['a missing maxTokens', { ...validAnthropicBody, maxTokens: undefined }, 'maxTokens must be a positive number'],
    ['a zero maxTokens', { ...validAnthropicBody, maxTokens: 0 }, 'maxTokens must be a positive number'],
    ['a non-string apiVersion', { ...validAnthropicBody, apiVersion: 1 }, 'apiVersion must be a string when provided'],
    ['a non-string system', { ...validAnthropicBody, system: 1 }, 'system must be a string when provided'],
    ['a non-array tools', { ...validAnthropicBody, tools: {} }, 'tools must be an array when provided'],
  ])('rejects %s with 400 before touching fetch', async (_label, body, message) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams SSE events end-to-end for a plain text response and auto-closes on the end event', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(anthropicChunk('Hello there'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validAnthropicBody), res);

    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello there' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
    expect(res.end).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const requestBody = JSON.parse(init.body);
    expect(requestBody.max_tokens).toBe(256);
    expect(requestBody.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('forwards optional baseUrl/apiVersion/system/tools/temperature/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(anthropicChunk('hi'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(
      makeReq({
        ...validAnthropicBody,
        baseUrl: 'https://gateway.example.com',
        apiVersion: '2099-01-01',
        system: 'be terse',
        tools: [{ name: 'get_weather', input_schema: { type: 'object', properties: {} } }],
        temperature: 0.4,
        maxToolTurns: 2,
        extraHeaders: { 'X-Custom': 'yes' },
      }),
      res,
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/v1/messages');
    expect(init.headers['anthropic-version']).toBe('2099-01-01');
    expect(init.headers['X-Custom']).toBe('yes');
    const body = JSON.parse(init.body);
    expect(body.system).toBe('be terse');
    expect(body.temperature).toBe(0.4);
    expect(body.tools).toEqual([{ name: 'get_weather', input_schema: { type: 'object', properties: {} } }]);
  });

  it('invokes the injected anthropicExecuteTool for a tool_use round and completes the loop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(sseBody(anthropicToolUseChunk('toolu_1', 'get_weather', { location: 'SF' }))))
      .mockResolvedValueOnce(okResponse(sseBody(anthropicChunk('Sunny.'))));
    vi.stubGlobal('fetch', fetchMock);
    const anthropicExecuteTool = vi.fn().mockResolvedValue({ content: '72F' });
    const res = makeSseRes();
    await handler({ anthropicExecuteTool })(makeReq(validAnthropicBody), res);
    expect(anthropicExecuteTool).toHaveBeenCalledWith({ id: 'toolu_1', name: 'get_weather', input: { location: 'SF' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      kind: 'tool_result',
      data: { type: 'tool_result', toolUseId: 'toolu_1', content: '72F', isError: false },
    });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
  });

  it('SEC-005: catches an executeTool exception, redacts it behind a correlation id, and still ends the stream exactly once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(anthropicToolUseChunk('toolu_1', 'boom_tool', {}))));
    vi.stubGlobal('fetch', fetchMock);
    const onInternalError = vi.fn();
    const anthropicExecuteTool = vi.fn().mockRejectedValue(new Error('tool exploded: secret-token-xyz'));
    const res = makeSseRes();
    await handler({ anthropicExecuteTool, onInternalError })(makeReq(validAnthropicBody), res);

    expect(onInternalError).toHaveBeenCalledTimes(1);
    const [context] = onInternalError.mock.calls[0]!;
    expect(context.provider).toBe('anthropic');
    expect(context.error).toBeInstanceOf(Error);
    expect(typeof context.correlationId).toBe('string');

    const events = writtenEvents(res);
    const errorEvent = events.find((e) => e.kind === 'error')!;
    expect((errorEvent.data as { message: string }).message).toBe('an internal error occurred');
    expect((errorEvent.data as { code: string }).code).toBe(context.correlationId);
    expect(events.filter((e) => e.kind === 'end')).toHaveLength(1);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it('SEC-005: falls back to console.error when no onInternalError sink is supplied', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(anthropicToolUseChunk('toolu_1', 'boom_tool', {}))));
    vi.stubGlobal('fetch', fetchMock);
    const anthropicExecuteTool = vi.fn().mockRejectedValue(new Error('boom'));
    const res = makeSseRes();
    await handler({ anthropicExecuteTool })(makeReq(validAnthropicBody), res);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/proxy/openai/stream', () => {
  function handler(deps: ModelProxyHttpDeps = {}) {
    return mount(deps).handlers['POST /api/proxy/openai/stream']!;
  }

  it('rejects a cross-origin request with 403 before touching fetch', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validOpenAiBody), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing apiKey', { ...validOpenAiBody, apiKey: undefined }, 'apiKey must be a non-empty string'],
    ['a missing model', { ...validOpenAiBody, model: undefined }, 'model must be a non-empty string'],
    ['an empty messages array', { ...validOpenAiBody, messages: [] }, 'messages must be a non-empty array'],
    ['a non-array tools', { ...validOpenAiBody, tools: 'nope' }, 'tools must be an array when provided'],
  ])('rejects %s with 400 before touching fetch', async (_label, body, message) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams SSE text_delta events and auto-closes on the end event', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(openAiChunk('Hello'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validOpenAiBody), res);
    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
    expect(res.end).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('forwards optional baseUrl/tools/temperature/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(openAiChunk('hi'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(
      makeReq({
        ...validOpenAiBody,
        baseUrl: 'https://gateway.example.com',
        tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }],
        temperature: 0.7,
        maxToolTurns: 3,
        extraHeaders: { 'X-Custom': 'yes' },
      }),
      res,
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/v1/chat/completions');
    expect(init.headers['X-Custom']).toBe('yes');
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0.7);
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }]);
  });

  it('invokes the injected openaiExecuteTool and never leaks a hardcoded product-identity header', async () => {
    const firstChunk = { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] }, finish_reason: null }] };
    const finishFirst = { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(sseBody(`data: ${JSON.stringify(firstChunk)}\n\n`, `data: ${JSON.stringify(finishFirst)}\n\n`, 'data: [DONE]\n\n')))
      .mockResolvedValueOnce(okResponse(sseBody(openAiChunk('Sunny.'))));
    vi.stubGlobal('fetch', fetchMock);
    const openaiExecuteTool = vi.fn().mockResolvedValue({ content: '72F' });
    const res = makeSseRes();
    await handler({ openaiExecuteTool })(makeReq(validOpenAiBody), res);
    expect(openaiExecuteTool).toHaveBeenCalledWith({ id: 'call_1', name: 'get_weather', input: {} });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['HTTP-Referer']).toBeUndefined();
    expect(init.headers['X-Title']).toBeUndefined();
    // No hardcoded product-identity string anywhere in the outbound headers — the confirmed OD
    // leak's exact value, assembled at runtime (not spelled out as a literal) so this regression
    // check itself never trips `scripts/check-engine-boundaries.ts`'s own R5-neutrality scan.
    const productIdentityString = ['Open', 'Design'].join(' ');
    expect(JSON.stringify(init.headers)).not.toContain(productIdentityString);
  });
});
