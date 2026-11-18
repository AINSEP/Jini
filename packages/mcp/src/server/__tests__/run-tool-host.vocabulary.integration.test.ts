import { expect, it } from 'vitest';
import { MASKED_IDENTIFIER_ROWS } from '@jini-ai/core/text/masked-identifier-rows';
import { assembleRunToolHost } from '../run-tool-host.js';
import { createMcpToolServer, type McpTransportLike } from '../tool-server.js';
import { createToolServerCapture } from './tool-server-capture.fixture.js';

const transport: McpTransportLike = { close: async () => {} };
const row2 = MASKED_IDENTIFIER_ROWS.find(entry => entry.row === 2)!.text;
const descriptor = {
  id: 'web_screenshot_page', description: 'Take a screenshot', readOnly: true,
  inputSchema: { type: 'object', properties: { viewport: { type: 'string' }, fullPage: { type: 'boolean' }, dismissCookieBanners: { type: 'boolean' } } },
};

it('a gateway call for a tool the run described keeps that tool\'s input names in the daemon\'s error', async () => {
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => init?.method === 'GET'
    ? Response.json(descriptor)
    : Response.json({ error: { code: 'BAD_REQUEST', message: row2 } }, { status: 400 })) as typeof fetch;
  const host = await assembleRunToolHost({ runId: 'run-1', resolveBaseUrl: () => 'http://daemon.invalid' }, { fetchImpl, delegatedToolTimeoutMs: 2000 });
  const capture = createToolServerCapture();
  await createMcpToolServer(host.required, { ...host.options, createServer: () => capture.server }).run({ transport });

  await capture.call('describe_tool', { id: descriptor.id });
  const result = await capture.call('execute_delegated_tool', { toolId: descriptor.id, input: {} });

  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain(row2);
});

it('a gateway call for a tool the run never described masks the input name it cannot know', async () => {
  const fetchImpl = (async () => Response.json({ error: { code: 'BAD_REQUEST', message: row2 } }, { status: 400 })) as typeof fetch;
  const host = await assembleRunToolHost({ runId: 'run-1', resolveBaseUrl: () => 'http://daemon.invalid' }, { fetchImpl, delegatedToolTimeoutMs: 2000 });
  const capture = createToolServerCapture();
  await createMcpToolServer(host.required, { ...host.options, createServer: () => capture.server }).run({ transport });

  const result = await capture.call('execute_delegated_tool', { toolId: descriptor.id, input: {} });

  expect(JSON.stringify(result.content)).toContain('[redacted] (optional)');
});
