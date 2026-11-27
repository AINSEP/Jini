import { describe, expect, it, vi } from 'vitest';
import { createAzureProxyRegistration, parseAzureProxyRequest } from '../index.js';
import { injectedFetch, makeReq, makeSseRes, okResponse, sseBody, writtenEvents, mountRegistration } from '../../__tests__/model-proxy-harness.js';

/**
 * The azure registration's own request and tool-turn policy: what its parser accepts, how it shapes the
 * provider request, and how tool turns run. The daemon's generic route (origin gate, SSE transport, error
 * redaction) is tested in `@jini-ai/daemon`; here the registration is driven directly.
 */
function openAiChunk(text: string): string {
  const chunk = { id: 'c1', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] };
  const final = { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`;
}
function azureChunk(text: string): string {
  return openAiChunk(text);
}
function openAiToolCallChunk(id: string, name: string, args: string): string {
  const call = { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] }, finish_reason: null }] };
  const finish = { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  return `data: ${JSON.stringify(call)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`;
}
const validAzureBody = {
  apiKey: 'azure-test-key',
  model: 'my-deployment',
  baseUrl: 'http://127.0.0.1:8443',
  apiVersion: '2024-10-21',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('azure proxy registration', () => {
  it.each([
    ['baseUrl', undefined], ['baseUrl', ''], ['apiVersion', undefined], ['apiVersion', ''], ['apiVersion', '  '], ['apiVersion', 1234],
  ] as const)('requires a non-empty %s, not %s', (field, value) => {
    expect(parseAzureProxyRequest({ ...validAzureBody, [field]: value })).toEqual({
      ok: false, error: { code: 'BAD_REQUEST', message: `${field} must be a non-empty string`,
        details: { kind: 'validation', issues: [{ path: field, message: 'required non-empty string' }] } },
    });
  });

  it('returns the shared parse error before deciding whether an Azure endpoint was supplied', () => {
    expect(parseAzureProxyRequest({ ...validAzureBody, apiKey: '', baseUrl: undefined })).toEqual({
      ok: false, error: { code: 'BAD_REQUEST', message: 'apiKey must be a non-empty string',
        details: { kind: 'validation', issues: [{ path: 'apiKey', message: 'required non-empty string' }] } },
    });
  });

  function handler(deps: Readonly<Record<string, unknown>> = {}) {
    return mountRegistration({ registration: createAzureProxyRegistration(), deps });
  }

  it('streams SSE events and builds the deployment-scoped Azure URL from baseUrl/model/apiVersion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(azureChunk('Hello from Azure'))));
    injectedFetch.mockImplementation(fetchMock);
    const res = makeSseRes();
    await handler()(makeReq(validAzureBody), res);

    const events = writtenEvents(res);
    expect(events).toContainEqual({ kind: 'text_delta', data: { type: 'text_delta', delta: 'Hello from Azure' } });
    expect(events.at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
    expect(res.end).toHaveBeenCalledOnce();

    const [{ url, init }] = fetchMock.mock.calls[0]!;
    // `model` is the Azure *deployment* name, and apiVersion rides as a query param, not a header.
    expect(url).toBe('http://127.0.0.1:8443/openai/deployments/my-deployment/chat/completions?api-version=2024-10-21');
    expect(init.headers['api-key']).toBe('azure-test-key');
  });

  it('forwards optional tools/temperature/maxTokens/maxToolTurns/extraHeaders to the turn-runner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sseBody(azureChunk('hi'))));
    injectedFetch.mockImplementation(fetchMock);
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
    const [{ init }] = fetchMock.mock.calls[0]!;
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
    injectedFetch.mockImplementation(fetchMock);
    const azureExecuteTool = vi.fn().mockResolvedValue({ content: '72F' });
    const res = makeSseRes();
    await handler({ azureExecuteTool })(makeReq(validAzureBody), res);
    expect(azureExecuteTool).toHaveBeenCalledWith({ id: 'call_az', name: 'get_weather', input: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writtenEvents(res).at(-1)).toEqual({ kind: 'end', data: { type: 'end', reason: 'stop' } });
  });
});
