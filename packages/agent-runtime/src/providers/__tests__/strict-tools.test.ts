import { describe, expect, it, vi } from 'vitest';
import { runAnthropicToolTurn } from '../anthropic-messages.js';
import { runOpenAiToolTurn, createStrictToolRetry } from '../openai-chat.js';
import { runAzureToolTurn } from '../azure-chat.js';
import { runGoogleToolTurn } from '../google-messages.js';
import { runProviderToolTurn } from '../tool-turn.js';
import type { ProviderProtocol, ProviderToolDescriptor, ProviderToolExecutor, ProviderTurnAdapters, ProviderTurnEvent, ProviderSchemaFallback } from '../tool-turn-types.js';
import type { PinnedFetch, PinnedFetchResponse } from '../connection-guard.js';

const protocols = ['anthropic', 'openai', 'azure', 'google'] as const;
type Body = Record<string, unknown>;
type Call = { id: string; name: string; input: unknown; thoughtSignature?: string };
type CapturedRequest = { body: Body; url: string; headers: Record<string, string> };
const emptySchema = { type: 'object', additionalProperties: false, properties: {}, required: [] };
const describeTool: ProviderToolDescriptor = { id: 'describe', inputSchema: emptySchema };
const writeTool: ProviderToolDescriptor = {
  id: 'content.write', wireName: 'write', description: 'Write one record',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      id: { type: 'string' },
      nested: {
        type: 'object', additionalProperties: false,
        properties: { label: { type: 'string' }, clear: { type: ['string', 'null'] } },
        required: ['clear'],
      },
    },
    required: ['id', 'nested'],
  },
};

/** Only the transport is replaced: real projections, adapters, reducers and continuation builders run. */
function response(stream: string, status = 200): PinnedFetchResponse {
  return {
    ok: status >= 200 && status < 300, status, text: async () => stream,
    body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(stream); } },
  };
}

/** Emit the actual wire dialect, including opaque Gemini signatures beside functionCall. */
function toolReply(protocol: ProviderProtocol, calls: readonly Call[]): PinnedFetchResponse {
  if (protocol === 'anthropic') {
    const blocks = calls.map((call, index) => [
      { type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } },
      { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } },
      { type: 'content_block_stop', index },
    ]).flat();
    return response([...blocks, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''));
  }
  if (protocol === 'google') {
    return response(`data: ${JSON.stringify({ candidates: [{ content: { parts: calls.map(call => ({
      functionCall: { id: call.id, name: call.name, args: call.input }, thoughtSignature: call.thoughtSignature ?? 'opaque-signature',
    })) }, finishReason: 'STOP' }] })}\n\n`);
  }
  return response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls.map((call, index) => ({
    index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) },
  })) }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
}

/** A normal language answer must remain possible in strict/VALIDATED mode. */
function textReply(protocol: ProviderProtocol): PinnedFetchResponse {
  if (protocol === 'anthropic') return response([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
    { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''));
  if (protocol === 'google') return response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] })}\n\n`);
  return response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
}

function schemaRejection(protocol: ProviderProtocol): PinnedFetchResponse {
  const message = protocol === 'google' ? 'Function calling mode VALIDATED is not supported' : 'strict tool schema is not supported';
  return response(JSON.stringify({ error: { message } }), 400);
}

/** Socket-free capture via the existing transport and DNS ports, with a fresh run for every test. */
function harness(
  { protocol, respond }: { protocol: ProviderProtocol; respond: (requests: readonly CapturedRequest[]) => PinnedFetchResponse | Promise<PinnedFetchResponse> },
  { extraHeaders, omitGetter = false }: { extraHeaders?: Record<string, string>; omitGetter?: boolean } = {},
) {
  const requests: CapturedRequest[] = [];
  const events: ProviderTurnEvent[] = [];
  const fallbacks: ProviderSchemaFallback[] = [];
  const fetchImpl: PinnedFetch = async ({ url, init }) => {
    requests.push({ url, body: JSON.parse(init.body) as Body, headers: init.headers });
    return respond(requests);
  };
  const transport = { fetchImpl, dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }] };
  /** Model the legacy adapter call by omitting its hook, preserving every other supplied option. */
  function adapterOptions<T extends { readonly getTools?: unknown }>(options: T) {
    if (!omitGetter) return options;
    const { getTools: _getTools, ...legacy } = options;
    return legacy;
  }
  const adapters: ProviderTurnAdapters = {
    anthropic: (required, optional = {}) => runAnthropicToolTurn(required, { ...adapterOptions(optional), ...transport, ...(extraHeaders ? { extraHeaders } : {}) }),
    openai: (required, optional = {}) => runOpenAiToolTurn(required, { ...adapterOptions(optional), ...transport }),
    azure: (required, optional = {}) => runAzureToolTurn(required, { ...adapterOptions(optional), ...transport }),
    google: (required, optional = {}) => runGoogleToolTurn(required, { ...adapterOptions(optional), ...transport }),
  };
  const run = ({ tools = [describeTool], getToolSnapshot, executeTool = async () => ({ content: 'ok' }) }: {
    tools?: readonly ProviderToolDescriptor[]; getToolSnapshot?: () => readonly ProviderToolDescriptor[]; executeTool?: ProviderToolExecutor;
  } = {}) => runProviderToolTurn({
    protocol, adapters, apiKey: 'test-key', model: 'test-model', system: 'system instruction',
    messages: [{ role: 'user', content: 'original question' }], tools, executeTool, onEvent: event => events.push(event),
  }, { baseUrl: 'https://provider.example', ...(getToolSnapshot ? { getToolSnapshot } : {}), onSchemaFallback: event => fallbacks.push(event) });
  return { run, requests, events, fallbacks };
}

/** Compare the declarations and strict flags without normalizing the captured request itself. */
function declarations(protocol: ProviderProtocol, body: Body): Body[] {
  const tools = body.tools as Body[];
  if (protocol === 'anthropic') return tools;
  if (protocol === 'google') return tools.flatMap(tool => tool.functionDeclarations as Body[]);
  return tools.map(tool => tool.function as Body);
}

function expectStrict(protocol: ProviderProtocol, body: Body, enabled: boolean): void {
  if (protocol === 'google') {
    expect(body.toolConfig).toEqual(enabled ? { functionCallingConfig: { mode: 'VALIDATED' } } : undefined);
    return;
  }
  expect(declarations(protocol, body).map(tool => tool.strict)).toEqual(declarations(protocol, body).map(() => enabled ? true : undefined));
}

/** Histories are compared verbatim across downgrade; these checks also prove vendor-specific ordering. */
function expectExchange(protocol: ProviderProtocol, body: Body): void {
  if (protocol === 'google') {
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'system instruction' }] });
    const contents = body.contents as Body[];
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'original question' }] });
    expect(contents[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'describe', args: {}, id: 'discover' }, thoughtSignature: 'opaque-signature' }] });
    expect(contents[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'describe', id: 'discover', response: { content: 'definition published', isError: false } } }] });
    return;
  }
  const messages = body.messages as Body[];
  if (protocol === 'anthropic') {
    expect(body.system).toBe('system instruction');
    expect(messages[0]).toEqual({ role: 'user', content: 'original question' });
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'tool_use', name: 'describe', id: 'discover', input: {} }] });
    expect(messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'discover', content: 'definition published' }] });
    return;
  }
  expect(messages).toEqual([
    { role: 'system', content: 'system instruction' }, { role: 'user', content: 'original question' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'discover', type: 'function', function: { name: 'describe', arguments: '{}' } }] },
    { role: 'tool', content: 'definition published', tool_call_id: 'discover' },
  ]);
}

describe.each(protocols)('%s strict tool request loop', protocol => {
  it('request 2 publishes a discovered schema, preserves history/signatures, and executes decoded canonical input', async () => {
    let snapshot: readonly ProviderToolDescriptor[] = [describeTool];
    const calls: unknown[] = [];
    const fixture = harness({ protocol, respond: requests => {
      if (requests.length === 1) return toolReply(protocol, [{ id: 'discover', name: 'describe', input: {} }]);
      if (requests.length === 2) return toolReply(protocol, [{ id: 'change', name: 'write', input: { id: 'record', nested: { label: null, clear: null } } }]);
      return textReply(protocol);
    } });
    const result = await fixture.run({ getToolSnapshot: () => snapshot, executeTool: async call => {
      calls.push(call);
      if (call.name === 'describe') { snapshot = [...snapshot, writeTool]; return { content: 'definition published' }; }
      return { content: 'written' };
    } });
    expect(result.toolTurns).toBe(2);
    expect(fixture.requests).toHaveLength(3);
    expect(declarations(protocol, fixture.requests[0]!.body).map(tool => tool.name)).toEqual(['describe']);
    const second = fixture.requests[1]!.body;
    const published = declarations(protocol, second);
    expect(published.map(tool => tool.name)).toEqual(['describe', 'write']);
    expect(published[1]!.description).toBe('Write one record');
    const schema = published[1]![protocol === 'anthropic' ? 'input_schema' : 'parameters'] as Body;
    expect(schema.required).toEqual(['id', 'nested']);
    const nested = (schema.properties as Body).nested as Body;
    expect(nested.required).toEqual(['label', 'clear']);
    for (const request of fixture.requests) expectStrict(protocol, request.body, true);
    expectExchange(protocol, second);
    expect(calls).toEqual([
      { id: 'discover', name: 'describe', input: {} },
      { id: 'change', name: 'content.write', input: { id: 'record', nested: { clear: null } } },
    ]);
    expect(fixture.fallbacks).toEqual([]);
    expect(fixture.events.filter(event => event.type === 'text_delta')).toEqual([{ type: 'text_delta', delta: 'done' }]);
    expect(fixture.events.filter(event => event.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
  });

  it('downgrades only the rejected request once, keeps history, and never replays an executed write', async () => {
    const executed: string[] = [];
    const fixture = harness({ protocol, respond: requests => {
      if (requests.length === 1) return toolReply(protocol, [{ id: 'write-once', name: 'write', input: { id: 'record', nested: { clear: null } } }]);
      if (requests.length === 2) return schemaRejection(protocol);
      if (requests.length === 3) return toolReply(protocol, [{ id: 'read', name: 'describe', input: {} }]);
      return textReply(protocol);
    } });
    const result = await fixture.run({ tools: [describeTool, writeTool], executeTool: async call => {
      executed.push(call.name); return { content: call.id === 'write-once' ? 'write committed' : 'read complete' };
    } });
    expect(result.toolTurns).toBe(2);
    expect(executed).toEqual(['content.write', 'describe']);
    expect(fixture.requests).toHaveLength(4);
    expectStrict(protocol, fixture.requests[1]!.body, true);
    expectStrict(protocol, fixture.requests[2]!.body, false);
    expectStrict(protocol, fixture.requests[3]!.body, false);
    const historyKey = protocol === 'google' ? 'contents' : 'messages';
    expect(fixture.requests[2]!.body[historyKey]).toEqual(fixture.requests[1]!.body[historyKey]);
    expect(JSON.stringify(fixture.requests[2]!.body[historyKey])).toContain('write committed');
    expect(fixture.fallbacks.filter(event => event.reason === 'endpoint-rejected')).toEqual([
      { toolId: 'describe', protocol, reason: 'endpoint-rejected' }, { toolId: 'write', protocol, reason: 'endpoint-rejected' },
    ]);
    expect(fixture.events.filter(event => event.type === 'error')).toEqual([]);
    expect(fixture.events.filter(event => event.type === 'end')).toEqual([{ type: 'end', reason: 'stop' }]);
  });

  it('refreshes again during downgrade and uses the fallback decoder for newly discovered definitions', async () => {
    let snapshot: readonly ProviderToolDescriptor[] = [describeTool];
    const seen: unknown[] = [];
    const fixture = harness({ protocol, respond: requests => {
      if (requests.length === 1) { snapshot = [...snapshot, writeTool]; return schemaRejection(protocol); }
      if (requests.length === 2) return toolReply(protocol, [{ id: 'change', name: 'write', input: { id: 'record', nested: { label: null, clear: null } } }]);
      return textReply(protocol);
    } });
    await fixture.run({ getToolSnapshot: () => snapshot, executeTool: async call => { seen.push(call.input); return { content: 'host validates here' }; } });
    expect(declarations(protocol, fixture.requests[1]!.body).map(tool => tool.name)).toEqual(['describe', 'write']);
    expectStrict(protocol, fixture.requests[1]!.body, false);
    // Host validation must see a real null from a non-strict response, not a stale strict omission decoder.
    expect(seen).toEqual([{ id: 'record', nested: { label: null, clear: null } }]);
  });

  it('stops after a second schema rejection with exactly one downgrade', async () => {
    const executeTool = vi.fn(async () => ({ content: 'unexpected' }));
    const fixture = harness({ protocol, respond: () => schemaRejection(protocol) });
    await fixture.run({ executeTool });
    expect(fixture.requests).toHaveLength(2);
    expect(executeTool).not.toHaveBeenCalled();
    expect(fixture.fallbacks.filter(event => event.reason === 'endpoint-rejected')).toEqual([{ toolId: 'describe', protocol, reason: 'endpoint-rejected' }]);
    expect(fixture.events.filter(event => event.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
  });

  it.each([401, 403, 429, 500])('does not downgrade HTTP %i even if the error mentions strict schemas', async status => {
    const fixture = harness({ protocol, respond: () => response('{"error":{"message":"strict schema not supported"}}', status) });
    await fixture.run();
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.fallbacks).toEqual([]);
    expect(fixture.events.filter(event => event.type === 'end')).toEqual([{ type: 'end', reason: 'error' }]);
  });

  it('does not downgrade unrelated HTTP 400 validation errors', async () => {
    const fixture = harness({ protocol, respond: () => response('{"error":{"message":"invalid tool arguments: id is missing"}}', 400) });
    await fixture.run();
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.fallbacks).toEqual([]);
  });

  it('does not retry a transport failure or expose its secret in diagnostics', async () => {
    const fixture = harness({ protocol, respond: () => { throw new Error('network failed test-key strict schema not supported'); } });
    await fixture.run();
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.fallbacks).toEqual([]);
    expect(fixture.events.filter(event => event.type === 'error')).toHaveLength(1);
    expect(JSON.stringify(fixture.events)).not.toContain('test-key');
  });

  it('never retries after streaming starts, even after a previous request committed a write', async () => {
    const executed: string[] = [];
    // OpenAI's [DONE] sentinel ends iteration before a trailing transport error. For all vendors,
    // errors occurring inside the active stream must never be classified as HTTP schema rejections.
    const streamFixture = harness({ protocol, respond: requests => {
      if (requests.length === 1) return toolReply(protocol, [{ id: 'committed', name: 'write', input: { id: 'record', nested: { clear: null } } }]);
      return { ...response(''), body: { async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode('data: {}\n\n');
        throw new Error('stream closed: strict schema not supported');
      } } };
    } });
    await expect(streamFixture.run({ tools: [writeTool], executeTool: async call => { executed.push(call.id); return { content: 'write committed' }; } })).rejects.toThrow('stream closed');
    expect(executed).toEqual(['committed']);
    expect(streamFixture.requests).toHaveLength(2);
    expect(streamFixture.fallbacks).toEqual([]);
  });

  it('keeps legacy tools usable when an adapter caller omits the refresh hook', async () => {
    const fixture = harness({ protocol, respond: () => textReply(protocol) }, { omitGetter: true });
    await fixture.run();
    expect(fixture.requests).toHaveLength(1);
    expect(declarations(protocol, fixture.requests[0]!.body).map(tool => tool.name)).toEqual(['describe']);
    expectStrict(protocol, fixture.requests[0]!.body, false);
    expect(fixture.fallbacks).toEqual([]);
  });

  it('keeps downgrade state isolated between concurrent runs', async () => {
    const rejected = harness({ protocol, respond: requests => requests.length === 1 ? schemaRejection(protocol) : textReply(protocol) });
    const supported = harness({ protocol, respond: requests => requests.length === 1
      ? toolReply(protocol, [{ id: 'describe', name: 'describe', input: {} }]) : textReply(protocol) });
    await Promise.all([rejected.run(), supported.run()]);
    expect(rejected.requests).toHaveLength(2);
    expect(supported.requests).toHaveLength(2);
    expectStrict(protocol, rejected.requests[1]!.body, false);
    expectStrict(protocol, supported.requests[1]!.body, true);
    expect(supported.fallbacks).toEqual([]);
  });
});

it('Anthropic preserves the approved beta route and existing caller headers on refresh and downgrade', async () => {
  const headers = { 'anthropic-beta': 'structured-outputs-2025-11-13', 'x-host-routing': 'preserve' };
  const fixture = harness({ protocol: 'anthropic', respond: requests => requests.length === 1 ? schemaRejection('anthropic') : textReply('anthropic') }, { extraHeaders: headers });
  await fixture.run();
  expect(fixture.requests).toHaveLength(2);
  for (const request of fixture.requests) expect(request.headers).toEqual({
    'content-type': 'application/json', 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01', ...headers,
  });
  expectStrict('anthropic', fixture.requests[0]!.body, true);
  expectStrict('anthropic', fixture.requests[1]!.body, false);
});

it.each(['schema-first', 'tokens-first'] as const)('Azure preserves its independent token-parameter retry (%s)', async order => {
  const tokenFailure = response('{"error":{"message":"Unsupported parameter max_tokens; use max_completion_tokens"}}', 400);
  const fixture = harness({ protocol: 'azure', respond: requests => {
    if (requests.length > 2) return textReply('azure');
    const schemaFirst = order === 'schema-first';
    return (requests.length === 1) === schemaFirst ? schemaRejection('azure') : tokenFailure;
  } });
  await fixture.run();
  expect(fixture.requests).toHaveLength(3);
  expect(fixture.requests[0]!.body.max_tokens).toBe(8192);
  expect(fixture.requests[2]!.body.max_tokens).toBeUndefined();
  expect(fixture.requests[2]!.body.max_completion_tokens).toBe(8192);
  expectStrict('azure', fixture.requests[2]!.body, false);
  expect(fixture.events.filter(event => event.type === 'error')).toEqual([]);
  expect(fixture.requests[2]!.body.messages).toEqual(fixture.requests[0]!.body.messages);
});

describe('strict downgrade recognition', () => {
  it.each([
    'tools.0.strict: Extra inputs are not permitted',
    'Unknown parameter: tools[0].function.strict',
    'Invalid schema for function describe: unsupported keyword',
    'This model does not support strict tool use',
    'Invalid value at tool_config.function_calling_config.mode: VALIDATED',
    'Strict tool use requires the structured-outputs beta header',
  ])('recognizes only a pre-generation rejection: %s', rawErrorText => {
    const diagnostics: ProviderSchemaFallback[] = [];
    const retry = createStrictToolRetry({ protocol: 'openai', onSchemaFallback: event => diagnostics.push(event) });
    expect(retry.downgrade({ status: 422, rawErrorText, toolNames: ['describe', 'describe'] })).toBe(true);
    expect(retry.enabled).toBe(false);
    expect(retry.downgrade({ status: 422, rawErrorText, toolNames: ['describe'] })).toBe(false);
    expect(diagnostics).toEqual([{ toolId: 'describe', protocol: 'openai', reason: 'endpoint-rejected' }]);
  });

  it('does not retry a schema rejection when no strict tools were sent', () => {
    const retry = createStrictToolRetry({ protocol: 'anthropic' });
    expect(retry.downgrade({ status: 400, rawErrorText: 'strict not supported', toolNames: [] })).toBe(false);
    expect(retry.enabled).toBe(true);
  });
});
