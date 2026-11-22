import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDescriptor } from '@jini-ai/core';
import { splitServerFixture } from '../../__tests__/args-fixtures.js';
import { createMcpToolServer, type McpToolServerOptions, type McpTransportLike } from '../tool-server.js';
import type { McpToolDef } from '../tool-protocol.js';
import { TOOL_CATALOG_TOOLS } from '../tools/tool-catalog-tools.js';
import { createToolServerCapture } from './tool-server-capture.fixture.js';

const SCHEMA = { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } as const;
const tool = (id: string, overrides: Partial<ToolDescriptor> = {}): ToolDescriptor => ({ id, description: `Tool ${id}`, readOnly: true, inputSchema: SCHEMA, ...overrides });

/** The real tool server and the real catalog tools over a captured SDK boundary: the production name index and publisher run; only the SDK is replaced. */
async function host({ catalog, delegatedTools, tools = TOOL_CATALOG_TOOLS }: {
  catalog: readonly ToolDescriptor[]; delegatedTools: NonNullable<McpToolServerOptions['delegatedTools']>; tools?: readonly McpToolDef[];
}) {
  const capture = createToolServerCapture();
  const notified = vi.fn(async () => {});
  const delegatedBodies: Array<Record<string, unknown>> = [];
  capture.server.sendToolListChanged = notified;
  const transport: McpTransportLike = { close: async () => { transport.onclose?.(); } };
  const handle = createMcpToolServer(...splitServerFixture({
    name: 'publication-test', version: '1', tools, resolveBaseUrl: () => 'http://d.example',
    stdin: new EventEmitter() as unknown as Readable, createServer: () => capture.server, createTransport: () => transport,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/api/delegated-tool-calls')) {
        delegatedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ result: { status: 'completed', output: { content: [{ type: 'text', text: 'ran' }] } } });
      }
      const found = catalog.find(candidate => String(url).endsWith(`/api/tools/${encodeURIComponent(candidate.id)}`));
      return found ? Response.json(found) : Response.json({ error: { message: 'unknown' } }, { status: 404 });
    },
    delegatedTools,
  }));
  const running = handle.run({});
  await capture.ready;
  closers.push(async () => { await transport.close({}); await running; });
  const describe_ = async (id: string) => {
    const result = await capture.call('describe_tool', { id });
    const text = (result.content[0] as { text: string }).text;
    return { result, text, parsed: result.isError ? undefined : JSON.parse(text) as Record<string, unknown> };
  };
  return { capture, notified, delegatedBodies, describe: describe_ };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length > 0) await closers.pop()!(); });

describe('describe_tool and the published tool set (characterization: a skipped publication is not listed and sends no notification)', () => {
  it('a third tool past maxTools describes normally, is not published, sends no tools/list_changed and its result says to use the gateway', async () => {
    const third = tool('third_tool');
    const h = await host({ catalog: [third], delegatedTools: { runId: 'run', maxTools: 2, initialTools: [tool('first_tool'), tool('second_tool')] } });
    const described = await h.describe('third_tool');
    expect(described.result.isError).toBeUndefined();
    expect(described.parsed).toEqual({ ...third, callAs: 'gateway', call: 'execute_readonly_delegated_tool({"toolId":"third_tool","input":{}})' });
    const names = (await h.capture.list()).tools.map(entry => entry.name);
    expect(names).toEqual(expect.arrayContaining(['first_tool', 'second_tool']));
    expect(names).not.toContain('third_tool');
    expect((await h.capture.list()).tools.some(entry => entry.annotations?.title === 'third_tool')).toBe(false);
    expect(h.notified).not.toHaveBeenCalled();
  });

  it('a startup tool whose id is not a safe name is indexed under its published wire name, not its id', async () => {
    const h = await host({ catalog: [], delegatedTools: { runId: 'run', initialTools: [tool('content_read.menu')] } });
    const { tools } = await h.capture.list();
    const published = tools.find(entry => entry.annotations?.title === 'content_read.menu')!;
    expect(published.name).toMatch(/^tool_content_read_menu_[0-9a-f]{8}$/);
    expect(tools.map(entry => entry.name)).not.toContain('content_read.menu');
  });
});

/** The name `tools/list` shows for a published id, found by its title. */
async function listedName(h: Awaited<ReturnType<typeof host>>, id: string): Promise<string | undefined> {
  return (await h.capture.list()).tools.find(entry => entry.annotations?.title === id)?.name;
}

describe('describe_tool says exactly how to call the tool it described', () => {
  it('a tool past maxTools: callAs gateway with the registry id in the gateway form (write tool: the full gateway)', async () => {
    const h = await host({ catalog: [tool('third_tool', { readOnly: false })], delegatedTools: { runId: 'run', maxTools: 1, initialTools: [tool('first_tool')] } });
    expect((await h.describe('third_tool')).parsed).toMatchObject({ callAs: 'gateway', call: 'execute_delegated_tool({"toolId":"third_tool","input":{}})' });
  });

  it('a read-only tool past maxTools is called through the read-only gateway', async () => {
    const h = await host({ catalog: [tool('third_tool')], delegatedTools: { runId: 'run', maxTools: 1, initialTools: [tool('first_tool')] } });
    expect((await h.describe('third_tool')).parsed).toMatchObject({ callAs: 'gateway', call: 'execute_readonly_delegated_tool({"toolId":"third_tool","input":{}})' });
  });

  it('a promoted tool with a safe id is called directly by its id', async () => {
    const h = await host({ catalog: [tool('third_tool')], delegatedTools: { runId: 'run' } });
    expect((await h.describe('third_tool')).parsed).toMatchObject({ callAs: 'direct', call: 'third_tool' });
    expect(await listedName(h, 'third_tool')).toBe('third_tool');
  });

  it('a promoted tool whose id is not a safe name is called by the wire name tools/list shows, never by its id', async () => {
    const h = await host({ catalog: [tool('content_read.menu')], delegatedTools: { runId: 'run' } });
    const { parsed } = await h.describe('content_read.menu');
    const wireName = await listedName(h, 'content_read.menu');
    expect(wireName).toMatch(/^tool_content_read_menu_[0-9a-f]{8}$/);
    expect(parsed).toMatchObject({ callAs: 'direct', call: wireName });
    expect(parsed?.call).not.toBe('content_read.menu');
  });

  it('a tool already published at startup answers with its existing wire name', async () => {
    const h = await host({ catalog: [tool('content_read.menu')], delegatedTools: { runId: 'run', initialTools: [tool('content_read.menu')] } });
    expect((await h.describe('content_read.menu')).parsed?.call).toBe(await listedName(h, 'content_read.menu'));
  });

  it.each([['an id longer than the wire limit', 'z'.repeat(90)], ['an id equal to a local tool name', 'search_tools']])('%s: call is the suffixed or hashed wire name tools/list shows', async (_label, id) => {
    const h = await host({ catalog: [tool(id)], delegatedTools: { runId: 'run' } });
    const { parsed } = await h.describe(id);
    const wireName = await listedName(h, id);
    expect(wireName).toBeDefined();
    expect(wireName).not.toBe(id);
    expect(wireName!.length).toBeLessThanOrEqual(64);
    expect(parsed).toMatchObject({ callAs: 'direct', call: wireName });
  });

  it('a schema-byte-limit skip says to use the gateway', async () => {
    const h = await host({ catalog: [tool('third_tool')], delegatedTools: { runId: 'run', maxSchemaBytes: 8 } });
    expect((await h.describe('third_tool')).parsed).toMatchObject({ callAs: 'gateway', call: 'execute_readonly_delegated_tool({"toolId":"third_tool","input":{}})' });
    expect(h.notified).not.toHaveBeenCalled();
  });

  it('a schema-less group descriptor can be called neither way: callAs none and no call', async () => {
    const family = { id: 'fam', description: 'A group', readOnly: true };
    const h = await host({ catalog: [family], delegatedTools: { runId: 'run' } });
    const { parsed } = await h.describe('fam');
    expect(parsed).toEqual({ ...family, callAs: 'none' });
    expect(parsed).not.toHaveProperty('call');
  });

  it('a server without dynamic publication still says how to call: the gateway', async () => {
    const capture = createToolServerCapture();
    const transport: McpTransportLike = { close: async () => { transport.onclose?.(); } };
    const handle = createMcpToolServer(...splitServerFixture({
      name: 'static', version: '1', tools: TOOL_CATALOG_TOOLS, resolveBaseUrl: () => 'http://d.example',
      stdin: new EventEmitter() as unknown as Readable, createServer: () => capture.server, createTransport: () => transport,
      fetchImpl: async () => Response.json(tool('plain_tool', { readOnly: false })),
    }));
    const running = handle.run({});
    await capture.ready;
    closers.push(async () => { await transport.close({}); await running; });
    const result = await capture.call('describe_tool', { id: 'plain_tool' });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ callAs: 'gateway', call: 'execute_delegated_tool({"toolId":"plain_tool","input":{}})' });
  });

  it.each([['a safe id', 'third_tool'], ['a dotted id', 'content_read.menu'], ['an id equal to a local tool name', 'search_tools']])(
    'round trip, %s: calling the returned call name reaches the daemon with the registry id', async (_label, id) => {
      const h = await host({ catalog: [tool(id)], delegatedTools: { runId: 'run' } });
      const { parsed } = await h.describe(id);
      const result = await h.capture.call(String(parsed?.call), { id: 'x' });
      expect(result.isError).toBeUndefined();
      expect(h.delegatedBodies).toHaveLength(1);
      expect(h.delegatedBodies[0]).toMatchObject({ toolId: id, input: { id: 'x' } });
    });
});
