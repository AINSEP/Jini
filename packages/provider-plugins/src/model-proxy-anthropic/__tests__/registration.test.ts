import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProxyRegistration } from '../index.js';
import { injectedFetch, makeReq, makeSseRes, okResponse, sseBody, writtenEvents, mountRegistration } from '../../__tests__/model-proxy-harness.js';

/**
 * The anthropic registration's own request and tool-turn policy: what its parser accepts, how it shapes the
 * provider request, and how tool turns run. The daemon's generic route (origin gate, SSE transport, error
 * redaction) is tested in `@jini-ai/daemon`; here the registration is driven directly.
 */
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
const validAnthropicBody = {
  apiKey: 'sk-ant-test',
  model: 'claude-opus-4-8',
  maxTokens: 256,
  messages: [{ role: 'user', content: 'hi' }],
};

describe('anthropic proxy registration', () => {
  function handler(deps: Readonly<Record<string, unknown>> = {}) {
    return mountRegistration({ registration: createAnthropicProxyRegistration(), deps });
  }

  it('streams SSE events end-to-end for a plain text response and auto-closes on the end event', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(anthropicChunk('Hello there'))));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validAnthropicBody), res);

    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello there' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
    expect(res.end).toHaveBeenCalledOnce();

    const [{ url, init }] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const requestBody = JSON.parse(init.body);
    expect(requestBody.max_tokens).toBe(256);
    expect(requestBody.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('forwards optional baseUrl/apiVersion/system/tools/temperature/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(anthropicChunk('hi'))));
    injectedFetch.mockImplementation(fetchMock);
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
    const [{ url, init }] = fetchMock.mock.calls[0]!;
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
    injectedFetch.mockImplementation(fetchMock);
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
    injectedFetch.mockImplementation(fetchMock);
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
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]![0].init.body);
    expect(secondRequestBody.messages[2].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: [imageBlock],
    });
  });
});
