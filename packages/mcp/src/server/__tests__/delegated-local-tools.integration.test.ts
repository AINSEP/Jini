import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { expect, it } from 'vitest';
import { serve } from '../../bin/serve.js';
import { createMcpToolServer, type McpServerLike, type McpTransportLike } from '../tool-server.js';

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
      if (String(url).endsWith('/api/tools/fixture_read')) return Response.json({ id: 'fixture_read', readOnly: true,
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } });
      if (String(url).endsWith('/api/delegated-tool-calls')) {
        if (body.toolId === 'fixture_read') return Response.json({ result: {
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
