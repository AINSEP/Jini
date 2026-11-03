import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { expect, it } from 'vitest';
import { serve } from '../../bin/serve.js';
import { createMcpToolServer, type McpServerLike, type McpTransportLike } from '../tool-server.js';
import { ASK_CHOICE_INPUT_SCHEMA } from '../../tools/ask-choice/schema.js';

const discovered = [
  { id: 'theme_list_files', readOnly: true, inputSchema: { type: 'object', required: ['themeId'],
    properties: { themeId: { type: 'string', minLength: 1 } }, additionalProperties: false } },
  { id: 'fs_list_files', readOnly: true, inputSchema: { type: 'object', required: ['root'],
    properties: { root: { type: 'string', enum: ['site', 'custom'] } }, additionalProperties: false } },
  { id: 'assistant_ask_choice', readOnly: false, inputSchema: ASK_CHOICE_INPUT_SCHEMA },
];

/** Exercise the production serve tool list and dispatch handlers without opening a listener. */
async function host() {
  const handlers = new Map<unknown, (...args: any[]) => Promise<any>>();
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  const pending: Array<{ id: string; seq: number; text: string }> = [];
  let ready!: () => void;
  const connected = new Promise<void>(resolve => { ready = resolve; });
  const transport: McpTransportLike = { close: async () => { transport.onclose?.(); } };
  const server: McpServerLike = {
    setRequestHandler: (({ schema, handler }: { schema: unknown; handler: (...args: any[]) => Promise<any> }) => {
      handlers.set(schema, handler);
    }) as McpServerLike['setRequestHandler'],
    connect: async () => { ready(); }, sendToolListChanged: async () => {},
  };
  const running = serve({}, {
    env: { JINI_RUN_ID: 'run-a', JINI_DAEMON_URL: 'http://127.0.0.1', JINI_DAEMON_TOKEN: 'run-token',
      JINI_MESSAGE_RELAY: '1', JINI_MESSAGE_RELAY_NONCE: 'a'.repeat(48) },
    stdin: new EventEmitter() as Readable,
    exit: ({ code }) => { throw new Error(`Unexpected exit ${code}`); },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      requests.push({ url: String(url), body, headers: new Headers(init?.headers) });
      if (String(url).includes('/api/tools/search?')) return Response.json({ hits: discovered.map(({ inputSchema: _schema, ...tool }) => ({
        ...tool, description: `Call ${tool.id}`, source: 'fixture', score: 1, signature: `signature of ${tool.id}`,
      })) });
      const described = discovered.find(tool => String(url).endsWith(`/api/tools/${tool.id}`));
      if (described) return Response.json(described);
      if (String(url).endsWith('/api/tools/fixture_read')) return Response.json({ id: 'fixture_read', readOnly: true,
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } });
      if (String(url).endsWith('/api/delegated-tool-calls')) {
        if (body.toolId === 'fixture_read' || discovered.some(tool => tool.id === body.toolId)) return Response.json({ result: {
          status: 'completed', output: { content: [{ type: 'text', text: `found ${JSON.stringify(body.input)}` }] },
        } });
        return Response.json({ error: { code: 'TOOL_NOT_FOUND', message: `no tool registered: ${body.toolId}` } }, { status: 404 });
      }
      if (String(url).endsWith('/messages/claim')) return Response.json({ messages: pending.splice(0) });
      return Response.json({ runs: [], tools: [], components: [] });
    },
    createMcpToolServer: (required, options) => createMcpToolServer(required, {
      ...options, createServer: () => server, createTransport: () => transport,
    }),
  });
  await connected;
  return {
    requests,
    pending,
    list: () => handlers.get(ListToolsRequestSchema)!() as Promise<ListToolsResult>,
    call: (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) =>
      handlers.get(CallToolRequestSchema)!({ request: { params: { name, arguments: args } } }, { extra: { signal } }) as Promise<CallToolResult>,
    close: async () => { await transport.close({}); await running; },
  };
}

it('every advertised tool resolves to its existing handler through the delegated gateway', async () => {
  const h = await host();
  try {
    expect((await h.call('describe_tool', { id: 'fixture_read' })).isError).not.toBe(true);
    const { tools } = await h.list();
    expect(tools.map(tool => tool.name)).toContain('check_messages');
    expect(tools.map(tool => tool.name)).toContain('fixture_read');
    for (const tool of tools) {
      // Required inputs deliberately exercise each owner's validation, including gateway tools.
      // Equality with direct dispatch proves resolution without inventing inputs for every tool.
      const direct = await h.call(tool.name);
      const delegated = await h.call('execute_delegated_tool', { toolId: tool.name, input: {} });
      expect(delegated, tool.name).toEqual(direct);
    }
    expect(h.requests.some(request => request.url.endsWith('/api/delegated-tool-calls'))).toBe(false);
  } finally { await h.close(); }
}, 10_000);

it('a dynamically advertised operation keeps the daemon run scope and read-only enforcement', async () => {
  const h = await host();
  try {
    await h.call('describe_tool', { id: 'fixture_read' });
    for (const name of ['fixture_read', 'execute_delegated_tool', 'execute_readonly_delegated_tool']) {
      h.requests.length = 0;
      const input = { query: 'hello' };
      const result = await h.call(name, name === 'fixture_read' ? input : { toolId: 'fixture_read', input });
      expect(result).toEqual({ content: [{ type: 'text', text: 'found {"query":"hello"}' }] });
      const delegated = h.requests.filter(request => request.url.endsWith('/api/delegated-tool-calls'));
      expect(delegated).toHaveLength(1);
      expect(delegated[0]!.body).toMatchObject({ runId: 'run-a', toolId: 'fixture_read', input, requireReadOnly: true });
      expect(delegated[0]!.headers.get('Authorization')).toBe('Bearer run-token');
    }
  } finally { await h.close(); }
}, 10_000);

it('prefixed direct and delegated tool names use the same published handler and validation', async () => {
  const h = await host();
  try {
    await h.call('describe_tool', { id: 'fixture_read' });
    for (const name of ['mcp__jini__fixture_read', 'execute_delegated_tool', 'execute_readonly_delegated_tool']) {
      const input = { query: 'hello' };
      const result = await h.call(name, name.startsWith('mcp__') ? input : { toolId: 'mcp__jini__fixture_read', input });
      expect(result).toEqual({ content: [{ type: 'text', text: 'found {"query":"hello"}' }] });
      expect(h.requests.filter(request => request.url.endsWith('/api/delegated-tool-calls')).at(-1)?.body)
        .toMatchObject({ runId: 'run-a', toolId: 'fixture_read', requireReadOnly: true, input });
    }
    h.requests.length = 0;
    const malformed = await h.call('execute_delegated_tool', { toolId: 'mcp__jini__fixture_read', input: {} });
    expect(malformed.isError).toBe(true);
    expect(JSON.stringify(malformed)).toContain('query');
    expect(h.requests.some(request => request.url.endsWith('/api/delegated-tool-calls'))).toBe(false);
  } finally { await h.close(); }
}, 10_000);

it('both delegated gateways poll check_messages once with the run credential and cancellation signal', async () => {
  const h = await host();
  try {
    for (const gateway of ['execute_delegated_tool', 'execute_readonly_delegated_tool']) {
      h.requests.length = 0;
      expect(await h.call(gateway, { toolId: 'check_messages', input: {} })).toEqual({ content: [{ type: 'text', text: 'none' }] });
      expect(h.requests).toHaveLength(1);
      expect(h.requests[0]).toMatchObject({ url: 'http://127.0.0.1/api/runs/run-a/messages/claim', body: { via: 'check_messages' } });
      expect(h.requests[0]!.headers.get('Authorization')).toBe('Bearer run-token');
      const controller = new AbortController(); controller.abort();
      await h.call(gateway, { toolId: 'check_messages', input: {} }, controller.signal);
      expect(h.requests).toHaveLength(1);
    }
  } finally { await h.close(); }
}, 10_000);

it('readonly delegation refuses a local mutator and unknown targets still reach daemon authorization', async () => {
  const h = await host();
  try {
    const refusal = await h.call('execute_readonly_delegated_tool', { toolId: 'execute_delegated_tool', input: {} });
    expect(refusal.isError).toBe(true);
    expect(JSON.stringify(refusal)).toContain('read-only');
    expect(h.requests.some(request => request.url.endsWith('/api/delegated-tool-calls'))).toBe(false);
    const unknown = await h.call('execute_delegated_tool', { toolId: 'unregistered', input: {} });
    expect(unknown.isError).toBe(true);
    expect(h.requests.at(-2)?.body).toMatchObject({ runId: 'run-a', toolId: 'unregistered' });
  } finally { await h.close(); }
}, 10_000);

it('delegated check_messages preserves the trusted nonce and validates input before claiming', async () => {
  const h = await host();
  try {
    h.pending.push({ id: 'user-1', seq: 1, text: 'Keep going' });
    const invalid = await h.call('execute_delegated_tool', { toolId: 'check_messages', input: { runId: 'other-run' } });
    expect(invalid.isError).toBe(true);
    expect(h.pending).toHaveLength(1);
    h.requests.length = 0;
    const result = await h.call('execute_delegated_tool', { toolId: 'check_messages', input: {} });
    expect(result).toEqual({ content: [{ type: 'text', text:
      `[run-user-message nonce=${'a'.repeat(48)} id=user-1 seq=1]\n{"text":"Keep going"}` }] });
    expect(h.pending).toEqual([]);
    expect(h.requests).toHaveLength(1);
  } finally { await h.close(); }
}, 10_000);

it('search returns compact signatures without publishing; describe publishes, and a {} call then gets the full contract, for every CLI', async () => {
  const h = await host();
  try {
    const before = (await h.list()).tools.map(tool => tool.name);
    const search = await h.call('search_tools', { query: 'list files and ask a question' });
    const hits = JSON.parse((search.content[0] as { text: string }).text) as Array<{ id: string; signature: string }>;
    expect(hits.map(hit => hit.signature)).toEqual(discovered.map(tool => `signature of ${tool.id}`));
    expect(JSON.stringify(hits)).not.toContain('inputSchema');
    // Publishing every hit would re-send up to 64 schemas in tools/list on every later turn.
    expect((await h.list()).tools.map(tool => tool.name)).toEqual(before);
    for (const tool of discovered) expect((await h.call('describe_tool', { id: tool.id })).isError).not.toBe(true);
    const { tools } = await h.list();
    for (const tool of discovered) expect(tools.find(listed => listed.name === tool.id)?.inputSchema).toEqual(tool.inputSchema);
    h.requests.length = 0;
    for (const tool of discovered) {
      for (const gateway of [tool.id, 'execute_delegated_tool', ...(tool.readOnly ? ['execute_readonly_delegated_tool'] : [])]) {
        const error = await h.call(gateway, gateway === tool.id ? {} : { toolId: tool.id, input: {} });
        expect(error.isError).toBe(true);
        const text = (error.content[0] as { text: string }).text;
        expect(text).toContain(`invalid arguments for ${tool.id}`);
        expect(text).toContain(`Input schema: ${JSON.stringify(tool.inputSchema)}`);
      }
    }
    // Malformed calls must be refused before reaching the daemon's handlers.
    expect(h.requests.map(request => request.url)).toEqual(Array(8).fill('http://127.0.0.1/api/runs/run-a/messages/claim'));
    const invalidOptions = await h.call('assistant_ask_choice', { question: 'Which?', options: ['One'] });
    expect(invalidOptions.isError).toBe(true);
    expect((invalidOptions.content[0] as { text: string }).text).toContain('"required":["label"]');
    const refusedWrite = await h.call('execute_readonly_delegated_tool', { toolId: 'assistant_ask_choice', input: {} });
    expect(refusedWrite.isError).toBe(true);
    expect(JSON.stringify(refusedWrite)).toContain('read-only');
    for (const [toolId, input] of [
      ['theme_list_files', { themeId: 'plain' }], ['fs_list_files', { root: 'site' }],
      ['assistant_ask_choice', { question: 'Which?', options: [{ label: 'One' }] }],
    ] as const) {
      expect((await h.call(toolId, input)).isError).toBeUndefined();
      expect(h.requests.filter(request => request.url.endsWith('/api/delegated-tool-calls')).at(-1)?.body)
        .toMatchObject({ toolId, input, runId: 'run-a' });
    }
  } finally { await h.close(); }
}, 10_000);

it('an oversized tool result is read through the advertised local tool and either gateway without HTTP file access', async () => {
  const h = await host();
  try {
    const query = 'saved result line\n'.repeat(1200);
    await h.call('describe_tool', { id: 'fixture_read' });
    const original = await h.call('fixture_read', { query });
    const block = original.content[0];
    if (block?.type !== 'text') throw new Error('Expected saved result pointer');
    expect(block.text.length).toBeLessThan(12000);
    const match = /"resultId":"([^"]+)"/.exec(block.text);
    expect(match).not.toBeNull();
    const resultId = match![1]!;
    expect((await h.list()).tools.map(tool => tool.name)).toContain('read_tool_result');
    h.requests.length = 0;
    const first = await h.call('read_tool_result', { resultId });
    for (const gateway of ['execute_delegated_tool', 'execute_readonly_delegated_tool']) {
      const viaGateway = await h.call(gateway, { toolId: 'read_tool_result', input: { resultId } });
      expect(viaGateway).toEqual(first);
    }
    let recovered = '';
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await h.call('read_tool_result', { resultId, offset });
      const textBlock = page.content[0];
      if (textBlock?.type !== 'text') throw new Error('Expected saved result page');
      const split = textBlock.text.indexOf('\n');
      const cursor = JSON.parse(textBlock.text.slice(0, split)) as { nextOffset: number | null };
      recovered += textBlock.text.slice(split + 1);
      offset = cursor.nextOffset;
    }
    expect(recovered).toBe(`found ${JSON.stringify({ query })}`);
    expect(h.requests.every(request => request.url.endsWith('/messages/claim'))).toBe(true);
  } finally { await h.close(); }
});

it('a generation poll can pause through either delegated gateway without shell sleep or a delegated HTTP call', async () => {
  const h = await host();
  try {
    expect((await h.list()).tools.map(tool => tool.name)).toContain('wait_for');
    for (const gateway of ['execute_delegated_tool', 'execute_readonly_delegated_tool']) {
      const result = await h.call(gateway, { toolId: 'wait_for', input: { seconds: 0 } });
      expect(result).toEqual({ content: [{ type: 'text', text: '{"waitedSeconds":0}' }] });
    }
    expect(h.requests.every(request => request.url.endsWith('/messages/claim'))).toBe(true);
  } finally { await h.close(); }
});

it('a long user follow-up keeps its trusted relay notice inline rather than becoming a saved tool result', async () => {
  const h = await host();
  try {
    const message = 'Continue with this detail. '.repeat(700);
    h.pending.push({ id: 'user-long', seq: 1, text: message });
    const result = await h.call('check_messages');
    expect(JSON.stringify(result)).toContain(message);
    expect(JSON.stringify(result)).not.toContain('read_tool_result');
  } finally { await h.close(); }
});
