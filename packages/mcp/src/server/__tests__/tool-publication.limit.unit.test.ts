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

describe('describe_tool and the published tool set (characterization: today a skipped publication is silent)', () => {
  it('a third tool past maxTools describes normally, is not published, sends no tools/list_changed and the result has no field telling the caller so', async () => {
    const third = tool('third_tool');
    const h = await host({ catalog: [third], delegatedTools: { runId: 'run', maxTools: 2, initialTools: [tool('first_tool'), tool('second_tool')] } });
    const described = await h.describe('third_tool');
    expect(described.result.isError).toBeUndefined();
    expect(described.parsed).toEqual(third);
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
