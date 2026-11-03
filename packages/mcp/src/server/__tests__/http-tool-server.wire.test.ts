import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpHttpToolServer } from '../http-tool-server.js';
import { createMcpHttpToolServerRuntime } from '../http-tool-server.js';
import type { McpToolDef } from '../tool-protocol.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it('an embedding waiting during initial bind failure receives the recovered capability', async () => {
  vi.useFakeTimers();
  let attempts = 0;
  const delivered: string[] = [];
  const runtime = createMcpHttpToolServerRuntime({ name: 'host', version: '1', tools: [], resolveBaseUrl: () => '' }, {
    start: async () => {
      if (++attempts === 1) throw new Error('bind failed');
      return { url: 'http://127.0.0.1:49001/mcp', token: 'private', close: async () => {} };
    },
  });
  try {
    const stop = runtime.subscribe({ listener: capability => { delivered.push(capability.url); } });
    expect(await runtime.capability({})).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(delivered).toEqual(['http://127.0.0.1:49001/mcp']);
    stop();
    const unsubscribe = runtime.subscribe({ listener: capability => { delivered.push(capability.url); } });
    await Promise.resolve();
    unsubscribe();
    expect(delivered).toHaveLength(2);
  } finally { await runtime.close({}); vi.useRealTimers(); }
});

it('capability delivery retries failures and unsubscribe cancels further delivery', async () => {
  vi.useFakeTimers();
  const listener = vi.fn().mockRejectedValueOnce(new Error('site not ready')).mockResolvedValue(undefined);
  const runtime = createMcpHttpToolServerRuntime({ name: 'host', version: '1', tools: [], resolveBaseUrl: () => '' }, {
    start: async () => ({ url: 'http://127.0.0.1:49001/mcp', token: 'private', close: async () => {} }),
  });
  try {
    const stop = runtime.subscribe({ listener });
    await runtime.capability({});
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).toHaveBeenCalledTimes(2);
  } finally { await runtime.close({}); vi.useRealTimers(); }
});

async function host(tools: readonly McpToolDef[]) {
  const server = await startMcpHttpToolServer({ name: 'wire-host', version: '1', tools, resolveBaseUrl: () => '' });
  cleanup.push(() => server.close({}));
  return server;
}

async function connect(server: Awaited<ReturnType<typeof host>>) {
  const client = new Client({ name: 'wire-client', version: '1' });
  cleanup.push(() => client.close());
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: { Authorization: `Bearer ${server.token}` } },
  });
  await client.connect(transport as Transport);
  expect(transport.sessionId).toBeUndefined();
  return client;
}

it('SDK initialize list and call preserve tool-host behavior', async () => {
  const handler = vi.fn(({ args }: { args: Record<string, unknown> }) => ({
    content: [{ type: 'text', text: `Hello ${args.name}` }], structuredContent: { name: args.name },
  }));
  const tool: McpToolDef = { name: 'greet', description: 'Greeting', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, handler };
  const server = await host([tool]);
  const client = await connect(server);
  expect(client.getServerCapabilities()).toEqual({ tools: {} });
  expect((await client.listTools()).tools).toEqual([{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }]);
  expect(await client.callTool({ name: 'greet', arguments: { name: 'Ada' } })).toEqual({
    content: [{ type: 'text', text: 'Hello Ada' }], structuredContent: { name: 'Ada' },
  });
  expect((await client.callTool({ name: 'greet', arguments: { name: 12 } })).isError).toBe(true);
  expect((await client.callTool({ name: 'absent', arguments: {} })).isError).toBe(true);
  expect(handler).toHaveBeenCalledTimes(1);
});

it('HTTP hosting never reads process stdin', async () => {
  // A getter catches even acquiring stdin, which a listener-spy alone would miss.
  const stdin = vi.spyOn(process, 'stdin', 'get').mockImplementation(() => { throw new Error('HTTP acquired stdin'); });
  try {
    const server = await host([]);
    const client = await connect(server);
    expect((await client.listTools()).tools).toEqual([]);
    await client.close();
    await server.close({});
    expect(stdin).not.toHaveBeenCalled();
  } finally { stdin.mockRestore(); }
});

it('oversized authenticated input never reaches a tool', async () => {
  const handler = vi.fn(() => 'should not run');
  const server = await host([{ name: 'write', description: 'Write', inputSchema: { type: 'object' }, handler }]);
  const response = await fetch(server.url, { method: 'POST', headers: {
    Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: ' '.repeat(1_000_001) });
  expect(response.status).toBe(413);
  await response.body?.cancel();
  expect(handler).not.toHaveBeenCalled();
});

it('listener recovery preserves the exact runtime endpoint and credential', async () => {
  let listener!: Server;
  const server = await startMcpHttpToolServer({ name: 'repair', version: '1', tools: [], resolveBaseUrl: () => '' }, {
    createHttpServer: handler => { listener = createServer(handler); return listener; },
  });
  cleanup.push(() => server.close({}));
  const client = await connect(server);
  expect((await client.listTools()).tools).toEqual([]);
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    await new Promise<void>(resolve => listener.close(() => resolve()));
    const listening = once(listener, 'listening');
    await vi.advanceTimersByTimeAsync(1000);
    await listening;
  } finally { vi.useRealTimers(); }
  expect((await client.listTools()).tools).toEqual([]);
});

it('closing the listener drains accepted tool work without cutting it off', async () => {
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const server = await host([{ name: 'slow', description: 'Slow work', inputSchema: { type: 'object' },
    handler: async () => { enter(); await gate; return 'completed'; },
  }]);
  const client = await connect(server);
  const call = client.callTool({ name: 'slow', arguments: {} });
  await entered;
  let closed = false;
  const closing = server.close({}).then(() => { closed = true; });
  try {
    await Promise.resolve();
    expect(closed).toBe(false);
  } finally { release(); }
  expect((await call).content).toEqual([{ type: 'text', text: 'completed' }]);
  await closing;
  expect(closed).toBe(true);
});

it('initial listener failure repairs without a manual reconnect', async () => {
  const { createMcpHttpToolServerRuntime } = await import('../http-tool-server.js');
  const close = vi.fn(async () => {});
  const warn = vi.fn();
  const start = vi.fn().mockRejectedValueOnce(new Error('private native detail')).mockResolvedValue({
    url: 'http://127.0.0.1:4100/mcp', token: 'a'.repeat(64), close,
  });
  const runtime = createMcpHttpToolServerRuntime({ name: 'repair', version: '1', tools: [], resolveBaseUrl: () => '' }, { start, warn });
  cleanup.push(() => runtime.close({}));
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    expect(await runtime.capability({})).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('MCP HTTP listener unavailable; retrying automatically');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await runtime.capability({})).toEqual({ url: 'http://127.0.0.1:4100/mcp', token: 'a'.repeat(64) });
    expect(start).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
