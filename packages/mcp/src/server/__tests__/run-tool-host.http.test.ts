import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { assembleRunToolHost } from '../run-tool-host.js';
import { startMcpHttpToolServer, type McpHttpToolServerHandle } from '../http-tool-server.adapter.js';
import type { McpToolDef } from '../tool-protocol.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const descriptor = { id: 'content.read', description: 'Read content', readOnly: true, inputSchema: { type: 'object' as const } };
async function connect(host: McpHttpToolServerHandle, session = true) {
  const client = new Client({ name: 'run-wire', version: '1' });
  cleanup.push(() => client.close());
  const transport = new StreamableHTTPClientTransport(new URL(host.url), {
    requestInit: { headers: { Authorization: `Bearer ${host.token}` } },
  });
  await client.connect(transport as Transport);
  if (session) expect(transport.sessionId).toEqual(expect.any(String));
  else expect(transport.sessionId).toBeUndefined();
  return { client, transport };
}
async function hostRun(options: { fetchImpl?: typeof fetch; messageRelayNonce?: string } = {}, tools: readonly McpToolDef[] = []) {
  const assembled = await assembleRunToolHost({ runId: 'run-a', resolveBaseUrl: () => 'http://daemon.invalid' }, { credential: 'callback', delegatedToolTimeoutMs: 2000, ...options });
  const httpOptions = { ...assembled.options, sessionMode: true };
  const host = await startMcpHttpToolServer({ ...assembled.required, tools: [...assembled.required.tools, ...tools] }, httpOptions);
  cleanup.push(() => host.close({}));
  return host;
}

it('CLI session retains described tools across requests', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'GET' ? Response.json(descriptor)
    : Response.json({ result: { executionId: 'read', status: 'completed', output: { title: 'hello' } } }));
  const host = await hostRun({ fetchImpl });
  const { client } = await connect(host);
  await client.callTool({ name: 'describe_tool', arguments: { id: descriptor.id } });
  const tools = (await client.listTools()).tools;
  const concrete = tools.find(tool => tool.annotations?.title === descriptor.id);
  expect(concrete).toBeDefined();
  expect((await client.callTool({ name: concrete!.name, arguments: {} })).isError).not.toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('paged result remains readable on the next request', async () => {
  const original = 'x'.repeat(16000);
  const host = await hostRun({}, [{ name: 'large', description: 'Large', inputSchema: { type: 'object' }, handler: () => original }]);
  const { client } = await connect(host);
  const result = await client.callTool({ name: 'large', arguments: {} });
  const match = /"resultId":"([^"]+)"/u.exec(JSON.stringify(result.content).replaceAll('\\"', '"'));
  expect(match).not.toBeNull();
  const page = await client.callTool({ name: 'read_tool_result', arguments: { resultId: match![1], offset: 0 } });
  expect(page.isError).not.toBe(true);
  expect(JSON.stringify(page.content)).toContain('x'.repeat(4000));
});

it('session preserves relay and structured results', async () => {
  let claims = 0;
  const host = await hostRun({ messageRelayNonce: 'a'.repeat(48), fetchImpl: async () => Response.json({ messages: ++claims === 1 ? [{ id: 'next', seq: 1, text: 'Continue' }] : [] }) },
    [{ name: 'structured', description: 'Structured', inputSchema: { type: 'object' }, handler: () => ({ content: [{ type: 'text', text: 'result' }], structuredContent: { value: 42 } }) }]);
  const { client } = await connect(host);
  const result = await client.callTool({ name: 'structured', arguments: {} });
  expect(result.structuredContent).toEqual({ value: 42 });
  expect(JSON.stringify(result.content)).toContain(`nonce=${'a'.repeat(48)}`);
  expect(JSON.stringify((await client.callTool({ name: 'check_messages', arguments: {} })).content)).not.toContain('id=next');
});

it('foreign and revoked capabilities dispatch zero tools', async () => {
  const handler = vi.fn(() => 'forbidden');
  const tool = { name: 'count', description: 'Count', inputSchema: { type: 'object' as const }, handler };
  const first = await hostRun({}, [tool]);
  const second = await hostRun({}, [tool]);
  const { transport } = await connect(first);
  for (const method of ['GET', 'POST', 'DELETE']) {
    for (const token of ['', 'wrong', second.token]) {
      const response = await fetch(first.url, { method, headers: { Authorization: `Bearer ${token}` }, ...(method === 'POST' ? { body: '{invalid' } : {}) });
      expect(response.status).toBe(403);
      await response.body?.cancel();
    }
  }
  const foreignSession = await fetch(second.url, { method: 'POST', headers: { Authorization: `Bearer ${second.token}`,
    'mcp-session-id': transport.sessionId!, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 50, method: 'tools/call', params: { name: 'count', arguments: {} } }) });
  expect(foreignSession.status).toBeGreaterThanOrEqual(400);
  await foreignSession.body?.cancel();
  await first.close({});
  await expect(fetch(first.url, { method: 'POST', headers: { Authorization: `Bearer ${first.token}` }, body: '{}' })).rejects.toThrow();
  expect(handler).not.toHaveBeenCalled();
});

it('cancellation reaches the delegated handler', async () => {
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const cancelled = vi.fn();
  const host = await hostRun({ fetchImpl: async (_url, init) => {
    entered();
    return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => { cancelled(); reject(new Error('cancelled')); }, { once: true }));
  } });
  const { client } = await connect(host);
  const controller = new AbortController();
  const call = client.callTool({ name: 'execute_delegated_tool', arguments: { toolId: 'content.read', input: {} } }, undefined, { signal: controller.signal });
  const rejected = expect(call).rejects.toThrow();
  await ready;
  controller.abort();
  await rejected;
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
});

it('terminal cleanup stops admission and disposes sessions', async () => {
  const host = await hostRun();
  const { client } = await connect(host);
  expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  await host.close({});
  await expect(client.listTools()).rejects.toThrow();
});

it('desktop stateless behavior remains unchanged', async () => {
  const host = await startMcpHttpToolServer({ name: 'desktop', version: '1', tools: [], resolveBaseUrl: () => '' });
  cleanup.push(() => host.close({}));
  const { client } = await connect(host, false);
  expect((await client.listTools()).tools).toEqual([]);
});
