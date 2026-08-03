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

/** A request for the generic `/api/proxy/:provider/stream` catch-all, whose handler reads `req.params.provider`. */
function makeParamReq(params: Record<string, string>, body: unknown) {
  return { body, params };
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

/**
 * Azure OpenAI speaks the same Chat Completions SSE dialect as OpenAI, so this reuses
 * `openAiChunk`'s shape — matching `@jini-ai/agent-runtime`'s own `azure-chat.test.ts` fixtures.
 */
function azureChunk(text: string): string {
  return openAiChunk(text);
}

/** One OpenAI/Azure `tool_calls` round: a fragment-bearing delta, a `tool_calls` finish, then `[DONE]`. */
function openAiToolCallChunk(id: string, name: string, args: string): string {
  const call = { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] }, finish_reason: null }] };
  const finish = { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  return `data: ${JSON.stringify(call)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`;
}

/** Gemini `streamGenerateContent` SSE — `candidates[].content.parts[].text`. */
function googleChunk(text: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }] })}\n\n`;
}

/** Gemini `functionCall` part, which the turn-runner surfaces as a tool call. */
function googleFunctionCallChunk(name: string, args: unknown): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] }, index: 0 }] })}\n\n`;
}

/** Ollama's native `/api/chat` NDJSON — one JSON object per line, not SSE. */
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

// Loopback base URLs throughout the Azure/Ollama bodies below: `connection-guard.ts`'s
// `validateBaseUrlResolved` short-circuits on a loopback host *before* consulting DNS, so these
// fixtures never make a real resolver call.
const validAzureBody = {
  apiKey: 'azure-test-key',
  model: 'my-deployment',
  baseUrl: 'http://127.0.0.1:8443',
  apiVersion: '2024-10-21',
  messages: [{ role: 'user', content: 'hi' }],
};

const validGoogleBody = {
  apiKey: 'goog-test',
  model: 'gemini-2.5-flash',
  baseUrl: 'http://127.0.0.1:8444',
  messages: [{ role: 'user', parts: [{ text: 'hi' }] }],
};

const validOllamaBody = {
  apiKey: 'sk-ollama-cloud',
  model: 'llama3',
  baseUrl: 'http://127.0.0.1:11434',
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
  it('mounts all five fixed provider streaming routes plus the generic :provider catch-all', () => {
    const app = mount();
    expect(Object.keys(app.handlers)).toEqual(
      expect.arrayContaining([
        'POST /api/proxy/anthropic/stream',
        'POST /api/proxy/openai/stream',
        'POST /api/proxy/azure/stream',
        'POST /api/proxy/google/stream',
        'POST /api/proxy/ollama/stream',
        'POST /api/proxy/:provider/stream',
      ]),
    );
  });

  // Registration order is load-bearing, not incidental: Express matches in registration order, so
  // the five literal paths must precede the catch-all or `/api/proxy/anthropic/stream` would be
  // served by the generic handler instead of its own strongly-typed one (see module doc).
  it('registers the catch-all last, so a fixed path always wins the match', () => {
    const app = mount();
    const paths = Object.keys(app.handlers);
    expect(paths.at(-1)).toBe('POST /api/proxy/:provider/stream');
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

  // Proves the full live route, not just the agent-runtime adapter in isolation: `parseCommon`
  // never reshapes `messages`/tool-result content (see its own doc comment — provider wire-protocol
  // shape is explicitly not this package's concern), and `writtenEvents` parses the *actual*
  // `res.write` SSE bytes via `JSON.parse` rather than reading the in-memory event object, so this
  // also proves `sse.ts`'s `JSON.stringify`-based wire format survives a nested image content block
  // intact (no `String(...)` coercion anywhere on the way out — see `defaultFormatEvent`). This is
  // the class of test MSG-2 asked for: it would have caught a silent-strip or a `[object Object]`
  // stringification bug that a pure agent-runtime unit test (which only sees JS objects, never the
  // JSON round trip) cannot.
  it('round-trips an image-bearing tool result through the full live route: SSE-out and the continuation request body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(sseBody(anthropicToolUseChunk('toolu_1', 'take_screenshot', {}))))
      .mockResolvedValueOnce(okResponse(sseBody(anthropicChunk('looks right'))));
    vi.stubGlobal('fetch', fetchMock);
    const imageBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' },
    };
    const anthropicExecuteTool = vi.fn().mockResolvedValue({ content: [imageBlock] });
    const res = makeSseRes();
    await handler({ anthropicExecuteTool })(makeReq(validAnthropicBody), res);

    // 1. The image survives out over the real SSE wire bytes (JSON.parse'd from res.write, not the
    //    in-memory JS object) — proves `sse.ts` does not coerce `content` to a string.
    const events = writtenEvents(res);
    expect(events).toContainEqual({
      kind: 'tool_result',
      data: { type: 'tool_result', toolUseId: 'toolu_1', content: [imageBlock], isError: false },
    });

    // 2. The image survives into the second (continuation) request body sent to Anthropic — proves
    //    `parseCommon`/the registry's `run` closure never reshapes tool-result content en route.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondRequestBody.messages[2].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: [imageBlock],
    });
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
    // `parseCommon`'s own maxTokens type check, distinct from the Anthropic route's stricter
    // "required positive number" rule: for OpenAI maxTokens is optional, but must be numeric when
    // present. Anthropic's own suite can never reach this branch, because its parse rejects a
    // non-number maxTokens with the positive-number message instead.
    ['a non-number maxTokens', { ...validOpenAiBody, maxTokens: 'lots' }, 'maxTokens must be a number when provided'],
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

  it('forwards optional baseUrl/tools/temperature/maxTokens/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(openAiChunk('hi'))));
    vi.stubGlobal('fetch', fetchMock);
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
    const [url, init] = fetchMock.mock.calls[0]!;
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

describe('POST /api/proxy/azure/stream', () => {
  function handler(deps: ModelProxyHttpDeps = {}) {
    return mount(deps).handlers['POST /api/proxy/azure/stream']!;
  }

  it('rejects a cross-origin request with 403 before touching fetch', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validAzureBody), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    // Azure is the one provider whose baseUrl is required — every Azure OpenAI resource has its own
    // endpoint, so there is no defaultable value (see `azure-chat.ts`'s module doc).
    ['a missing baseUrl', { ...validAzureBody, baseUrl: undefined }, 'baseUrl must be a non-empty string'],
    ['an empty-string baseUrl', { ...validAzureBody, baseUrl: '' }, 'baseUrl must be a non-empty string'],
    ['a missing apiVersion', { ...validAzureBody, apiVersion: undefined }, 'apiVersion must be a non-empty string'],
    ['a whitespace-only apiVersion', { ...validAzureBody, apiVersion: '   ' }, 'apiVersion must be a non-empty string'],
    ['a non-array tools', { ...validAzureBody, tools: {} }, 'tools must be an array when provided'],
    ['a missing apiKey', { ...validAzureBody, apiKey: undefined }, 'apiKey must be a non-empty string'],
  ])('rejects %s with 400 before touching fetch', async (_label, body, message) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams SSE events and builds the deployment-scoped Azure URL from baseUrl/model/apiVersion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(azureChunk('Hello from Azure'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validAzureBody), res);

    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello from Azure' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
    expect(res.end).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    // `model` is the Azure *deployment* name, and apiVersion rides as a query param, not a header.
    expect(url).toBe('http://127.0.0.1:8443/openai/deployments/my-deployment/chat/completions?api-version=2024-10-21');
    expect(init.headers['api-key']).toBe('azure-test-key');
  });

  it('forwards optional tools/temperature/maxTokens/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(azureChunk('hi'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(
      makeReq({
        ...validAzureBody,
        tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }],
        temperature: 0.2,
        maxTokens: 128,
        maxToolTurns: 4,
        extraHeaders: { 'X-Custom': 'azure' },
      }),
      res,
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['X-Custom']).toBe('azure');
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(128);
    expect(body.tools).toHaveLength(1);
  });

  it('invokes the injected azureExecuteTool for a tool_calls round and completes the loop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(sseBody(openAiToolCallChunk('call_az', 'get_weather', '{}'))))
      .mockResolvedValueOnce(okResponse(sseBody(azureChunk('Sunny.'))));
    vi.stubGlobal('fetch', fetchMock);
    const azureExecuteTool = vi.fn().mockResolvedValue({ content: '72F' });
    const res = makeSseRes();
    await handler({ azureExecuteTool })(makeReq(validAzureBody), res);
    expect(azureExecuteTool).toHaveBeenCalledWith({ id: 'call_az', name: 'get_weather', input: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writtenEvents(res).at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
  });

  it('SEC-005: redacts an executeTool exception behind a correlation id under the azure provider tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(openAiToolCallChunk('call_az', 'boom', '{}'))));
    vi.stubGlobal('fetch', fetchMock);
    const onInternalError = vi.fn();
    const azureExecuteTool = vi.fn().mockRejectedValue(new Error('azure tool exploded: key-abc'));
    const res = makeSseRes();
    await handler({ azureExecuteTool, onInternalError })(makeReq(validAzureBody), res);

    expect(onInternalError).toHaveBeenCalledTimes(1);
    expect(onInternalError.mock.calls[0]![0].provider).toBe('azure');
    const errorEvent = writtenEvents(res).find((e) => e.kind === 'error')!;
    expect((errorEvent.data as { message: string }).message).toBe('an internal error occurred');
    expect(JSON.stringify(writtenEvents(res))).not.toContain('key-abc');
  });
});

describe('POST /api/proxy/google/stream', () => {
  function handler(deps: ModelProxyHttpDeps = {}) {
    return mount(deps).handlers['POST /api/proxy/google/stream']!;
  }

  it('rejects a cross-origin request with 403 before touching fetch', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validGoogleBody), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing apiKey', { ...validGoogleBody, apiKey: undefined }, 'apiKey must be a non-empty string'],
    ['a non-string system', { ...validGoogleBody, system: 7 }, 'system must be a string when provided'],
    ['a non-array tools', { ...validGoogleBody, tools: 'nope' }, 'tools must be an array when provided'],
    ['a non-number maxOutputTokens', { ...validGoogleBody, maxOutputTokens: 'many' }, 'maxOutputTokens must be a number when provided'],
  ])('rejects %s with 400 before touching fetch', async (_label, body, message) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams SSE events and sends the uniform `messages` body field as Gemini `contents`', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(googleChunk('Hello from Gemini'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validGoogleBody), res);

    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello from Gemini' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/models/gemini-2.5-flash:streamGenerateContent');
    expect(init.headers['x-goog-api-key']).toBe('goog-test');
    // The HTTP JSON schema stays `messages` across all five providers; only Gemini's own turn-runner
    // renames it to `contents` on the wire (see `parseGoogleProxyRequest`'s doc).
    expect(JSON.parse(init.body).contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('forwards optional system/tools/temperature/maxOutputTokens/maxToolTurns/extraHeaders', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(googleChunk('hi'))));
    vi.stubGlobal('fetch', fetchMock);
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
    const [, init] = fetchMock.mock.calls[0]!;
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
    vi.stubGlobal('fetch', fetchMock);
    const googleExecuteTool = vi.fn().mockResolvedValue({ content: '72F' });
    const res = makeSseRes();
    await handler({ googleExecuteTool })(makeReq(validGoogleBody), res);
    expect(googleExecuteTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_weather', input: { location: 'SF' } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writtenEvents(res).at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
  });

  it('falls back to the public Gemini endpoint when baseUrl is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(googleChunk('hi'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq({ apiKey: 'goog-test', model: 'gemini-2.5-flash', messages: [{ role: 'user', parts: [{ text: 'hi' }] }] }), res);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
  });

  it('SEC-005: redacts an executeTool exception behind a correlation id under the google provider tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(googleFunctionCallChunk('boom', {}))));
    vi.stubGlobal('fetch', fetchMock);
    const onInternalError = vi.fn();
    const googleExecuteTool = vi.fn().mockRejectedValue(new Error('gemini tool exploded: goog-secret'));
    const res = makeSseRes();
    await handler({ googleExecuteTool, onInternalError })(makeReq(validGoogleBody), res);

    expect(onInternalError).toHaveBeenCalledTimes(1);
    expect(onInternalError.mock.calls[0]![0].provider).toBe('google');
    expect(JSON.stringify(writtenEvents(res))).not.toContain('goog-secret');
  });
});

describe('POST /api/proxy/ollama/stream', () => {
  function handler(deps: ModelProxyHttpDeps = {}) {
    return mount(deps).handlers['POST /api/proxy/ollama/stream']!;
  }

  it('rejects a cross-origin request with 403 before touching fetch', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validOllamaBody), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // apiKey is required for Ollama too — an earlier version of this module made it optional on a
  // "local install needs no auth" rationale that did not match the real upstream behavior, whose
  // default target is Ollama Cloud (see `model-proxy.ts`'s BYOK module-doc section).
  it('rejects a missing apiKey with 400, exactly like the other four providers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq({ ...validOllamaBody, apiKey: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe('apiKey must be a non-empty string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-array tools with 400', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq({ ...validOllamaBody, tools: 'nope' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe('tools must be an array when provided');
  });

  it('streams NDJSON-sourced SSE events against the native /api/chat endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(ollamaBody(ollamaTextLine('Hello from Ollama'), ollamaDoneLine())));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validOllamaBody), res);

    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello from Ollama' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(init.headers.authorization).toBe('Bearer sk-ollama-cloud');
  });

  it('forwards optional tools/temperature/maxTokens/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ollamaBody(ollamaDoneLine())));
    vi.stubGlobal('fetch', fetchMock);
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
    const [, init] = fetchMock.mock.calls[0]!;
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
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', fetchMock);
    const ollamaExecuteTool = vi.fn().mockResolvedValue({ content: 'here is the screenshot', images: ['iVBORw0KGgoAAAANSUhEUg=='] });
    const res = makeSseRes();
    await handler({ ollamaExecuteTool })(makeReq(validOllamaBody), res);

    const events = writtenEvents(res);
    const toolResultEvent = events.find((e) => e.kind === 'tool_result')!;
    expect((toolResultEvent.data as { images?: string[] }).images).toEqual(['iVBORw0KGgoAAAANSUhEUg==']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    const toolMessage = secondRequestBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMessage.images).toEqual(['iVBORw0KGgoAAAANSUhEUg==']);
  });

  it('falls back to https://ollama.com/api/chat when baseUrl is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ollamaBody(ollamaDoneLine())));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeReq({ apiKey: 'sk-ollama-cloud', model: 'llama3', messages: [{ role: 'user', content: 'hi' }] }), res);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://ollama.com/api/chat');
  });

  it('SEC-005: redacts an executeTool exception behind a correlation id under the ollama provider tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(ollamaBody(ollamaToolCallLine('boom', {}))));
    vi.stubGlobal('fetch', fetchMock);
    const onInternalError = vi.fn();
    const ollamaExecuteTool = vi.fn().mockRejectedValue(new Error('ollama tool exploded: ollama-secret'));
    const res = makeSseRes();
    await handler({ ollamaExecuteTool, onInternalError })(makeReq(validOllamaBody), res);

    expect(onInternalError).toHaveBeenCalledTimes(1);
    expect(onInternalError.mock.calls[0]![0].provider).toBe('ollama');
    expect(JSON.stringify(writtenEvents(res))).not.toContain('ollama-secret');
  });
});

/**
 * The generic `POST /api/proxy/:provider/stream` catch-all. In a real Express app the five fixed
 * paths always win the match (they register first), so this handler's per-provider registry entries
 * are only reachable over real traffic for a provider name with no dedicated literal route. Invoking
 * the handler directly is therefore the only way to exercise the registry itself — which is real,
 * shipped code a caller reaches by choosing the parameterized endpoint (see module doc).
 */
describe('POST /api/proxy/:provider/stream — the generic catch-all', () => {
  function handler(deps: ModelProxyHttpDeps = {}) {
    return mount(deps).handlers['POST /api/proxy/:provider/stream']!;
  }

  it('rejects a cross-origin request with 403 before looking at the provider param', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeParamReq({ provider: 'anthropic' }, validAnthropicBody), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized provider name with 400 and names it in the message', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeParamReq({ provider: 'openrouter' }, validOpenAiBody), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST', message: 'unknown provider: openrouter' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Express always supplies a matched `:provider` segment, so the `?? ''` fallback is a
  // belt-and-braces guard; this pins that it degrades to the same 400 rather than throwing.
  it('treats an absent provider param as an unknown provider rather than crashing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeParamReq({}, validOpenAiBody), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST', message: 'unknown provider: ' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies the named provider’s own parse rules, not a generic one', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // A body that is valid for OpenAI but not for Anthropic (which requires maxTokens) must be
    // rejected when routed at `anthropic` — proving the registry dispatches to the right parser.
    const res = makeSseRes();
    await handler()(makeParamReq({ provider: 'anthropic' }, validOpenAiBody), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]![0].error.message).toBe('maxTokens must be a positive number');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['anthropic', () => validAnthropicBody, () => sseBody(anthropicChunk('via catch-all')), 'https://api.anthropic.com/v1/messages'],
    ['openai', () => validOpenAiBody, () => sseBody(openAiChunk('via catch-all')), 'https://api.openai.com/v1/chat/completions'],
    ['azure', () => validAzureBody, () => sseBody(azureChunk('via catch-all')), 'http://127.0.0.1:8443/openai/deployments/my-deployment/chat/completions?api-version=2024-10-21'],
    ['ollama', () => validOllamaBody, () => ollamaBody(ollamaTextLine('via catch-all'), ollamaDoneLine()), 'http://127.0.0.1:11434/api/chat'],
  ])('dispatches %s through its registry entry to the real turn-runner', async (_provider, body, stream, expectedUrl) => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(stream()));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeParamReq({ provider: _provider }, body()), res);

    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'via catch-all' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
    expect(fetchMock.mock.calls[0]![0]).toBe(expectedUrl);
  });

  it('dispatches google through its registry entry, renaming messages to contents', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(googleChunk('via catch-all'))));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeParamReq({ provider: 'google' }, validGoogleBody), res);

    expect(writtenEvents(res)).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'via catch-all' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/models/gemini-2.5-flash:streamGenerateContent');
    expect(JSON.parse(init.body).contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it.each([
    ['anthropic', 'anthropicExecuteTool', () => validAnthropicBody, () => sseBody(anthropicToolUseChunk('toolu_1', 'get_weather', { location: 'SF' }))],
    ['openai', 'openaiExecuteTool', () => validOpenAiBody, () => sseBody(openAiToolCallChunk('call_1', 'get_weather', '{"location":"SF"}'))],
    ['azure', 'azureExecuteTool', () => validAzureBody, () => sseBody(openAiToolCallChunk('call_1', 'get_weather', '{"location":"SF"}'))],
    ['google', 'googleExecuteTool', () => validGoogleBody, () => sseBody(googleFunctionCallChunk('get_weather', { location: 'SF' }))],
    ['ollama', 'ollamaExecuteTool', () => validOllamaBody, () => ollamaBody(ollamaToolCallLine('get_weather', { location: 'SF' }))],
  ])('wires %s’s registry entry to the matching deps.%s executor', async (provider, depsKey, body, stream) => {
    const executeTool = vi.fn().mockResolvedValue({ content: '72F' });
    const fetchMock = vi.fn().mockResolvedValue(okResponse(stream()));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler({ [depsKey]: executeTool } as ModelProxyHttpDeps)(makeParamReq({ provider }, body()), res);
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_weather', input: { location: 'SF' } }));
  });

  /**
   * The registry's per-provider `run` closures are a second, independent copy of each fixed route's
   * option-forwarding spread, so covering the fixed routes proves nothing about these. Each case
   * below sends every optional field the provider accepts and asserts it survived onto the wire.
   *
   * `google` and `ollama` deliberately omit `baseUrl` here: their fixed-route counterparts above
   * always supply one, so this is where the default-endpoint arm of the registry spread gets
   * exercised.
   */
  it.each([
    [
      'anthropic',
      { ...validAnthropicBody, baseUrl: 'http://127.0.0.1:9001', apiVersion: '2099-01-01', system: 'be terse', tools: [{ name: 't', input_schema: { type: 'object', properties: {} } }], temperature: 0.4, maxToolTurns: 2, extraHeaders: { 'X-Custom': 'yes' } },
      () => sseBody(anthropicChunk('ok')),
      (url: string, init: any) => {
        expect(url).toBe('http://127.0.0.1:9001/v1/messages');
        expect(init.headers['anthropic-version']).toBe('2099-01-01');
        expect(init.headers['X-Custom']).toBe('yes');
        const body = JSON.parse(init.body);
        expect(body.system).toBe('be terse');
        expect(body.temperature).toBe(0.4);
        expect(body.tools).toHaveLength(1);
      },
    ],
    [
      'openai',
      { ...validOpenAiBody, baseUrl: 'http://127.0.0.1:9002', tools: [{ type: 'function', function: { name: 't', parameters: { type: 'object', properties: {} } } }], temperature: 0.7, maxTokens: 512, maxToolTurns: 3, extraHeaders: { 'X-Custom': 'yes' } },
      () => sseBody(openAiChunk('ok')),
      (url: string, init: any) => {
        expect(url).toBe('http://127.0.0.1:9002/v1/chat/completions');
        expect(init.headers['X-Custom']).toBe('yes');
        const body = JSON.parse(init.body);
        expect(body.temperature).toBe(0.7);
        expect(body.max_tokens).toBe(512);
        expect(body.tools).toHaveLength(1);
      },
    ],
    [
      'azure',
      { ...validAzureBody, tools: [{ type: 'function', function: { name: 't', parameters: { type: 'object', properties: {} } } }], temperature: 0.2, maxTokens: 128, maxToolTurns: 4, extraHeaders: { 'X-Custom': 'yes' } },
      () => sseBody(azureChunk('ok')),
      (_url: string, init: any) => {
        expect(init.headers['X-Custom']).toBe('yes');
        const body = JSON.parse(init.body);
        expect(body.temperature).toBe(0.2);
        expect(body.max_tokens).toBe(128);
        expect(body.tools).toHaveLength(1);
      },
    ],
    [
      'google',
      { apiKey: 'goog-test', model: 'gemini-2.5-flash', messages: [{ role: 'user', parts: [{ text: 'hi' }] }], system: 'be terse', tools: [{ functionDeclarations: [{ name: 't', parameters: { type: 'object', properties: {} } }] }], temperature: 0.9, maxOutputTokens: 64, maxToolTurns: 2, extraHeaders: { 'X-Custom': 'yes' } },
      () => sseBody(googleChunk('ok')),
      (url: string, init: any) => {
        // No baseUrl supplied -> the turn-runner's own public Gemini endpoint.
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
        expect(init.headers['X-Custom']).toBe('yes');
        const body = JSON.parse(init.body);
        expect(body.systemInstruction).toEqual({ parts: [{ text: 'be terse' }] });
        expect(body.generationConfig.temperature).toBe(0.9);
        expect(body.generationConfig.maxOutputTokens).toBe(64);
        expect(body.tools).toHaveLength(1);
      },
    ],
    [
      'ollama',
      { apiKey: 'sk-ollama-cloud', model: 'llama3', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 't', parameters: { type: 'object', properties: {} } } }], temperature: 0.1, maxTokens: 256, maxToolTurns: 5, extraHeaders: { 'X-Custom': 'yes' } },
      () => ollamaBody(ollamaTextLine('ok'), ollamaDoneLine()),
      (url: string, init: any) => {
        // No baseUrl supplied -> Ollama Cloud, not a local install (see module doc).
        expect(url).toBe('https://ollama.com/api/chat');
        expect(init.headers['X-Custom']).toBe('yes');
        const body = JSON.parse(init.body);
        expect(body.options.temperature).toBe(0.1);
        expect(body.tools).toHaveLength(1);
      },
    ],
  ])('forwards every optional field through %s’s registry entry', async (provider, body, stream, assertWire) => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(stream()));
    vi.stubGlobal('fetch', fetchMock);
    const res = makeSseRes();
    await handler()(makeParamReq({ provider }, body), res);
    expect(writtenEvents(res)).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'ok' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    assertWire(url as string, init);
  });

  it('SEC-005: tags the internal-error context with the provider read from the path param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(anthropicToolUseChunk('toolu_1', 'boom', {}))));
    vi.stubGlobal('fetch', fetchMock);
    const onInternalError = vi.fn();
    const anthropicExecuteTool = vi.fn().mockRejectedValue(new Error('boom'));
    const res = makeSseRes();
    await handler({ anthropicExecuteTool, onInternalError })(makeParamReq({ provider: 'anthropic' }, validAnthropicBody), res);
    expect(onInternalError).toHaveBeenCalledTimes(1);
    expect(onInternalError.mock.calls[0]![0].provider).toBe('anthropic');
  });
});
