import { expect, it } from 'vitest';
import { createRecordingReporter } from '@jini-ai/core/errors/testing';
import { assembleRunToolHost } from '../run-tool-host.js';
import { createMcpToolServer, type McpTransportLike } from '../tool-server.js';
import { createToolServerCapture } from './tool-server-capture.fixture.js';

const ERROR_ID = 'ERR-0000-0000-0000-0001';
const transport: McpTransportLike = { close: async () => {} };

it('an unreadable daemon answer to a delegated call reaches the model with one recorded error ID', async () => {
  const { reporter, entries } = createRecordingReporter({ ids: [ERROR_ID], iso: '2026-01-01T00:00:00.000Z' });
  const fetchImpl = (async () => new Response("<html>PRIVATE-CANARY draft of the owner's page</html>", { status: 500, headers: { 'content-type': 'text/html' } })) as typeof fetch;
  const host = await assembleRunToolHost(
    { runId: 'run-1', resolveBaseUrl: () => 'http://daemon.invalid' },
    { fetchImpl, reportFailure: reporter.record, delegatedToolTimeoutMs: 2000 },
  );
  const capture = createToolServerCapture();
  await createMcpToolServer(host.required, { ...host.options, createServer: () => capture.server }).run({ transport });

  const result = await capture.call('execute_delegated_tool', { toolId: 'theme_write_file', input: {} });

  expect(result.isError).toBe(true);
  const text = JSON.stringify(result.content);
  expect(text).toContain(`Error ID: ${ERROR_ID}.`);
  expect(text).toContain('The tool service failed (HTTP 500) and its answer was not readable.');
  expect(text).not.toContain('PRIVATE-CANARY');
  const incidents = entries.filter(entry => entry.message.includes(ERROR_ID));
  expect(incidents).toHaveLength(1);
  expect(incidents[0]?.meta?.step).toBe('mcp daemon call');
});
