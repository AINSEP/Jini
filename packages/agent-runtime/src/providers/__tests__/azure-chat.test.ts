import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAzureToolTurn, type AzureMessageParam, type AzureTurnEvent } from '../azure-chat.js';

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
  return chunk({ id: 'c1', choices: [{ index: 0, delta: { content }, finish_reason: null }] });
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

const baseMessages: AzureMessageParam[] = [{ role: 'user', content: 'hi' }];

describe('runAzureToolTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a forbidden internal base url without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const events: AzureTurnEvent[] = [];
    const result = await runAzureToolTurn({
      apiKey: 'azure-key',
      baseUrl: 'http://10.0.0.5',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
    expect(result.finishReason).toBeNull();
  });

  it('reports a network error redacted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const events: AzureTurnEvent[] = [];
    await runAzureToolTurn({
      apiKey: 'azure-secret',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'ECONNRESET' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('reports a non-ok JSON error response with status code, redacting the api key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        body: null,
        text: async () => JSON.stringify({ error: { message: 'Access denied due to invalid subscription key: azure-secret' } }),
      }),
    );
    const events: AzureTurnEvent[] = [];
    await runAzureToolTurn({
      apiKey: 'azure-secret',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'Access denied due to invalid subscription key: [REDACTED]', code: '401' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('reports a missing response body as an error, using the Azure OpenAI provider label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: null, text: async () => '' }));
    const events: AzureTurnEvent[] = [];
    await runAzureToolTurn({
      apiKey: 'k',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'error', message: 'Azure OpenAI response had no body' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('builds the deployment URL with api-version, uses the api-key header (not Authorization), and streams text_delta/usage through to a stop end', async () => {
    const body = sseBody(textChunk('Hello'), usageChunk({ total_tokens: 12 }), finishChunk('stop'), done());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const events: AzureTurnEvent[] = [];
    const result = await runAzureToolTurn({
      apiKey: 'azure-key',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { type: 'status', label: 'requesting' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'usage', usage: { total_tokens: 12 } },
      { type: 'end', reason: 'stop' },
    ]);
    expect(result).toEqual({ finishReason: 'stop', toolTurns: 0 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://my-resource.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2024-10-21');
    expect(init.headers['api-key']).toBe('azure-key');
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers['HTTP-Referer']).toBeUndefined();
  });

  it('uses a caller-supplied apiVersion instead of the default, and merges extraHeaders with no hardcoded product-identity header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);
    await runAzureToolTurn({
      apiKey: 'k',
      baseUrl: 'https://my-resource.openai.azure.com/',
      apiVersion: '2099-01-01',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: () => {},
      extraHeaders: { 'X-Caller-App': 'my-app' },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://my-resource.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2099-01-01');
    expect(init.headers['X-Caller-App']).toBe('my-app');
    expect(Object.keys(init.headers)).not.toContain('X-Title');
  });

  it('always sends max_tokens (never max_completion_tokens, regardless of deployment name), defaulting to 8192 — matches a live comparison against OD\'s real azure handler', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);

    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'gpt-4o-deployment', messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ max_tokens: 8192 });

    fetchMock.mockClear();
    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'gpt-4o-deployment', maxTokens: 1024, messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ max_tokens: 1024 });

    // Even a deployment named after a newer model family still gets the legacy field first — Azure
    // deployment names are caller-defined strings, not necessarily matching OpenAI's own scheme.
    fetchMock.mockClear();
    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'my-gpt-5-deployment', messages: baseMessages, onEvent: () => {} });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.max_tokens).toBe(8192);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('forwards an explicit temperature and omits the field entirely when the caller sets none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);

    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'd', temperature: 0.2, messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).temperature).toBe(0.2);

    // Omitted rather than sent as null/undefined: some deployments reject an explicit null, and a
    // reasoning deployment rejects the parameter outright.
    fetchMock.mockClear();
    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'd', messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty('temperature');
  });

  it('sends temperature 0 rather than treating it as absent', async () => {
    // `0` is the most useful value a caller can pick and the easiest to lose to a truthiness check.
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);
    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'd', temperature: 0, messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).temperature).toBe(0);
  });

  it('forwards a non-empty tools array verbatim, and omits the field for an empty one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);
    const tools = [{ type: 'function' as const, function: { name: 'get_weather', description: 'w', parameters: { type: 'object' } } }];
    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'd', tools, messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).tools).toEqual(tools);

    // Azure rejects `tools: []` with a 400, so an empty list must be indistinguishable from no list.
    fetchMock.mockClear();
    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'd', tools: [], messages: baseMessages, onEvent: () => {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty('tools');
  });

  it('passes a caller AbortSignal through to fetch so a cancelled turn actually cancels the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'd', signal: controller.signal, messages: baseMessages, onEvent: () => {} });
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
  });

  it('retries once with max_completion_tokens when the deployment rejects the legacy max_tokens field with a 400 — matches OD\'s real [proxy:azure] retry', async () => {
    const unsupportedParamError = 'Unsupported parameter: \'max_tokens\' is not supported with this model. Use \'max_completion_tokens\' instead.';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, body: null, text: async () => unsupportedParamError })
      .mockResolvedValueOnce(okResponse(sseBody(textChunk('ok'), finishChunk('stop'), done())));
    vi.stubGlobal('fetch', fetchMock);

    const events: AzureTurnEvent[] = [];
    const result = await runAzureToolTurn({
      apiKey: 'k',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'my-gpt-5-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(firstBody.max_tokens).toBe(8192);
    expect(firstBody.max_completion_tokens).toBeUndefined();
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(secondBody.max_completion_tokens).toBe(8192);
    expect(secondBody.max_tokens).toBeUndefined();
    // The retry reuses the same URL/headers — only the body's token-limit field changes.
    expect(fetchMock.mock.calls[1]![0]).toBe(fetchMock.mock.calls[0]![0]);
    expect(fetchMock.mock.calls[1]![1].headers).toEqual(fetchMock.mock.calls[0]![1].headers);

    expect(result).toEqual({ finishReason: 'stop', toolTurns: 0 });
    expect(events).toEqual([
      { type: 'status', label: 'requesting' },
      { type: 'text_delta', delta: 'ok' },
      { type: 'end', reason: 'stop' },
    ]);
  });

  it('does not retry a second time — a 400 on the retried request surfaces as a normal error', async () => {
    const unsupportedParamError = 'Unsupported parameter: \'max_tokens\' is not supported with this model. Use \'max_completion_tokens\' instead.';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, body: null, text: async () => unsupportedParamError })
      .mockResolvedValueOnce({ ok: false, status: 400, body: null, text: async () => unsupportedParamError });
    vi.stubGlobal('fetch', fetchMock);

    const events: AzureTurnEvent[] = [];
    await runAzureToolTurn({
      apiKey: 'azure-retry-key',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'my-gpt-5-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { type: 'error', message: unsupportedParamError, code: '400' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('does not retry on a 400 unrelated to the token-limit field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, body: null, text: async () => JSON.stringify({ error: { message: 'Invalid request' } }) });
    vi.stubGlobal('fetch', fetchMock);

    const events: AzureTurnEvent[] = [];
    await runAzureToolTurn({
      apiKey: 'k',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: 'error', message: 'Invalid request', code: '400' },
      { type: 'end', reason: 'error' },
    ]);
  });

  it('runs a full tool-call loop: accumulates streamed argument fragments, invokes executeTool, and continues to a final stop', async () => {
    const firstBody = sseBody(
      textChunk("Let's check "),
      toolCallStartChunk(0, 'call_1', 'get_weather'),
      toolCallArgsChunk(0, '{"location":"SF"}'),
      finishChunk('tool_calls'),
      done(),
    );
    const secondBody = sseBody(textChunk('Sunny.'), finishChunk('stop'), done());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: '72F sunny' });
    const events: AzureTurnEvent[] = [];
    const result = await runAzureToolTurn({
      apiKey: 'k',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
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
  });

  it('stops with reason max_tool_turns once the bound is hit, without invoking executeTool for the turn that exceeds it', async () => {
    const round = () => sseBody(toolCallStartChunk(0, 'call_x', 'loop_tool'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(round())).mockResolvedValueOnce(okResponse(round()));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ content: 'again' });
    const events: AzureTurnEvent[] = [];
    const result = await runAzureToolTurn({
      apiKey: 'k',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
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
    const body = sseBody(
      textChunk('safe text\n## user\nmalicious continuation'),
      // Would-be second end site — must never fire.
      finishChunk('stop'),
      usageChunk({ total_tokens: 5 }),
      done(),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(body)));
    const events: AzureTurnEvent[] = [];
    const result = await runAzureToolTurn({
      apiKey: 'k',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    const endEvents = events.filter((e) => e.type === 'end');
    expect(endEvents).toEqual([{ type: 'end', reason: 'contaminated' }]);
    expect(events.filter((e) => e.type === 'fabricated_role_marker')).toHaveLength(1);
    expect(events.some((e) => e.type === 'usage')).toBe(false);
    expect(result.finishReason).toBeNull();
  });

  it('ends with reason stop (no further request) when a tool call is requested but no executeTool is supplied', async () => {
    const body = sseBody(toolCallStartChunk(0, 'call_1', 'noop'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const events: AzureTurnEvent[] = [];
    const result = await runAzureToolTurn({
      apiKey: 'k',
      baseUrl: 'https://my-resource.openai.azure.com',
      model: 'gpt-4o-deployment',
      messages: baseMessages,
      onEvent: (e) => events.push(e),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ finishReason: 'tool_calls', toolTurns: 0 });
    expect(events.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
  });

  describe('image support (inherited from openai-chat.ts)', () => {
    const pngDataUri = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

    // Proves the inheritance claim directly rather than trusting the module doc's claim alone: an
    // image_url part placed on an ordinary user message reaches the real Azure request body
    // untouched — `azureRequestBody` never strips or transforms it.
    it('round-trips an image_url part into the Azure deployment request body unchanged', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
      vi.stubGlobal('fetch', fetchMock);
      const messages: AzureMessageParam[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: "what's in this image?" },
            { type: 'image_url', image_url: { url: pngDataUri, detail: 'high' } },
          ],
        },
      ];
      await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'gpt-4o-deployment', messages, onEvent: () => {} });
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.messages[0]).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: "what's in this image?" },
          { type: 'image_url', image_url: { url: pngDataUri, detail: 'high' } },
        ],
      });
    });

    it('still sends a plain string message content unchanged (backward compatibility)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(finishChunk('stop'), done())));
      vi.stubGlobal('fetch', fetchMock);
      await runAzureToolTurn({ apiKey: 'k', baseUrl: 'https://my-resource.openai.azure.com', model: 'gpt-4o-deployment', messages: baseMessages, onEvent: () => {} });
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('keeps a tool result with a screenshot text-only on the tool message and delivers the image via a synthetic follow-up user message', async () => {
      const firstBody = sseBody(toolCallStartChunk(0, 'call_1', 'screenshot'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
      const secondBody = sseBody(textChunk('looks good'), finishChunk('stop'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(firstBody)).mockResolvedValueOnce(okResponse(secondBody));
      vi.stubGlobal('fetch', fetchMock);
      const executeTool = vi.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'here is the current render' },
          { type: 'image_url', image_url: { url: pngDataUri } },
        ],
      });
      const events: AzureTurnEvent[] = [];
      await runAzureToolTurn({
        apiKey: 'k',
        baseUrl: 'https://my-resource.openai.azure.com',
        model: 'gpt-4o-deployment',
        messages: baseMessages,
        executeTool,
        onEvent: (e) => events.push(e),
      });

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
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

    it('rejects an unsupported image media type as an isError tool_result instead of forwarding it', async () => {
      const body = sseBody(toolCallStartChunk(0, 'call_1', 'screenshot'), toolCallArgsChunk(0, '{}'), finishChunk('tool_calls'), done());
      const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(body)).mockResolvedValueOnce(okResponse(sseBody(finishChunk('stop'), done())));
      vi.stubGlobal('fetch', fetchMock);
      const executeTool = vi.fn().mockResolvedValue({ content: [{ type: 'image_url', image_url: { url: 'data:image/tiff;base64,AAAA' } }] });
      const events: AzureTurnEvent[] = [];
      await runAzureToolTurn({
        apiKey: 'k',
        baseUrl: 'https://my-resource.openai.azure.com',
        model: 'gpt-4o-deployment',
        messages: baseMessages,
        executeTool,
        onEvent: (e) => events.push(e),
      });
      const toolResultEvent = events.find((e) => e.type === 'tool_result');
      expect(toolResultEvent).toMatchObject({ isError: true });
      expect((toolResultEvent as { content: string }).content).toContain('unsupported image media type');
    });

    it('batches a multi-tool-call turn correctly: all tool messages emitted before a single labeled follow-up covering only the calls that returned images', async () => {
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
      vi.stubGlobal('fetch', fetchMock);
      const executeTool = vi
        .fn()
        .mockResolvedValueOnce({ content: '72F sunny' })
        .mockResolvedValueOnce({ content: [{ type: 'image_url', image_url: { url: pngDataUri } }] })
        .mockResolvedValueOnce({ content: [{ type: 'image_url', image_url: { url: `${pngDataUri}2` } }] });
      await runAzureToolTurn({
        apiKey: 'k',
        baseUrl: 'https://my-resource.openai.azure.com',
        model: 'gpt-4o-deployment',
        messages: baseMessages,
        executeTool,
        onEvent: () => {},
      });

      const secondCallBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(secondCallBody.messages).toHaveLength(6);
      expect(secondCallBody.messages[2]).toEqual({ role: 'tool', content: '72F sunny', tool_call_id: 'call_1' });
      expect(secondCallBody.messages[3].role).toBe('tool');
      expect(secondCallBody.messages[4].role).toBe('tool');
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
  });
});
