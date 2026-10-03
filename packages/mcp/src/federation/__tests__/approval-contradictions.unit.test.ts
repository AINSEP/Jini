import { defaultFederationMessages } from "../messages.js";
import { afterEach, expect, it, vi } from 'vitest';
import { admitRemoteTools, extractFederatedImageBlocks, federatedCallConfirmationForAction, wrapUntrustedResult } from '../trust.js';
import { connectMcpHttpSession } from '../adapter.http.js';
import { McpAuthFailedError, McpProtocolError } from '../mcp-protocol.js';
import { createDefaultConnect } from '../stdio/default-connect.js';
import { ScriptedMcpHttpExchange, ScriptedMcpStdioChannel } from '../testing/adapter.memory.js';
import { IDENTITY_STDIO_LAUNCH_RESOLVER } from '../stdio/stdio-launch-resolver.js';
import { clientInfo, messages } from './fixtures.js';

const config = { connectionId: 'example', label: 'Example', allowedToolNames: ['update_record', 'delete_record'],
  writeAllowedToolNames: [], connectTimeoutMs: 100, callTimeoutMs: 1000, maxResultBytes: 100, maxTools: 2 };
afterEach(() => vi.useRealTimers());

it('admits allowlisted writes without a second list and asks only for protected actions', () => {
  const report = admitRemoteTools({ config, tools: [
    { name: 'update_record', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
    { name: 'delete_record', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
  ] });
  expect(report.refused).toEqual([]);
  expect(report.admitted.map(tool => tool.confirmation)).toEqual(['none', 'confirm-destructive']);
  for (const [remoteName, args, expected] of [
    ['execute_sql', { sql: 'SELECT 1' }, 'none'], ['execute_sql', { sql: 'CREATE TABLE x(id int)' }, 'none'],
    ['execute_sql', { sql: 'DELETE FROM x' }, 'confirm-destructive'], ['send_email', {}, 'confirm'],
    ['assistant_update_privacy', {}, 'confirm'], ['update_record', { query: 'value' }, 'none'],
  ] as const) expect(federatedCallConfirmationForAction({ remoteName, args, annotations: undefined })).toBe(expected);
});

it('caps serialized text by UTF-8 bytes without splitting a code point', () => {
  const wrapped = wrapUntrustedResult({ connectionLabel: 'Example', remoteName: 'read', result: 'é😀é', maxResultBytes: 5 });
  const payload = wrapped.split(/<untrusted-data-[^>]+>\n/)[1]!.split('\n</untrusted-data-')[0]!;
  expect(payload).toBe('"é');
  expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(5);
  expect(wrapped).toContain('truncated to 5 bytes');
});

it('uses one serialized image-array budget per result and reports dropped blocks', () => {
  const image = { type: 'image' as const, mimeType: 'image/png', data: 'AAAA' };
  const maxResultBytes = Buffer.byteLength(JSON.stringify([image]), 'utf8');
  expect(extractFederatedImageBlocks({ content: [image], maxResultBytes }).images).toEqual([image]);
  const result = extractFederatedImageBlocks({ content: [image, image], maxResultBytes });
  expect(result.images).toEqual([image]);
  expect(JSON.stringify(result.remainder)).toContain('1 image block(s)');
  const unicodeImage = { ...image, data: 'é'.repeat(10) };
  expect(extractFederatedImageBlocks({ content: [unicodeImage], maxResultBytes: JSON.stringify([unicodeImage]).length }).images).toEqual([]);
});

async function httpSession(status = 200, largeText?: string) {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => {
    if (request.message?.method === 'notifications/initialized') return { status: 202, body: '' };
    if (request.message?.method === 'tools/call') return { status, body: largeText ?? '' };
    return { sessionId: 'session', body: { jsonrpc: '2.0', id: request.message?.id,
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fixture' } } } };
  } });
  let deleteSignal: AbortSignal | undefined;
  const session = await connectMcpHttpSession({ messages: defaultFederationMessages, spec: { url: 'https://example.invalid/mcp', headers: {} },
    exchange: { send: (request, options = {}) => {
      if (request.method === 'DELETE') {
        deleteSignal = options.signal;
        return new Promise(() => {});
      }
      return exchange.send(request, options);
    } }, clientInfo, bearerToken: () => undefined, requestTimeoutMs: 100 });
  return { session, deleteSignal: () => deleteSignal };
}

it.each([401, 403])('keeps HTTP %i authentication and authorization distinct', async status => {
  const { session } = await httpSession(status);
  const error = await session.callTool({ name: 'read', arguments: {} }).catch(error => error);
  expect(error).toBeInstanceOf(status === 401 ? McpAuthFailedError : McpProtocolError);
  if (status === 403) expect(error).not.toBeInstanceOf(McpAuthFailedError);
});

it('rejects an HTTP frame whose UTF-8 size exceeds the response ceiling', async () => {
  const { session } = await httpSession(200, JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [], padding: 'é'.repeat(2 * 1024 * 1024) } }));
  await expect(session.callTool({ name: 'read', arguments: {} })).rejects.toThrow(/exceeded .* bytes/);
});

it('bounds and aborts shutdown DELETE even when the exchange ignores cancellation', async () => {
  vi.useFakeTimers();
  const { session, deleteSignal } = await httpSession();
  const closing = session.close({});
  await vi.advanceTimersByTimeAsync(100);
  await expect(closing).resolves.toBeUndefined();
  expect(deleteSignal()?.aborted).toBe(true);
  await expect(session.callTool({ name: 'read', arguments: {} })).rejects.toThrow('session is closed');
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['resolve', 'spawn'])('includes synchronous %s time in the stdio connection deadline', async phase => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const channel = new ScriptedMcpStdioChannel({ messages, respond: () => undefined });
  const spawnChannel = vi.fn(() => { if (phase === 'spawn') vi.setSystemTime(101); return channel; });
  const connect = createDefaultConnect({ clientInfo, messages, bearerToken: () => undefined,
    resolver: { resolve: required => { if (phase === 'resolve') vi.setSystemTime(101); return IDENTITY_STDIO_LAUNCH_RESOLVER.resolve(required); } } }, { spawnChannel });
  await expect(connect({ connection: { config, launch: { command: 'example', args: [], env: {} } } })).rejects.toThrow('connect timed out after 100ms');
  if (phase === 'resolve') expect(spawnChannel).not.toHaveBeenCalled();
  else expect(channel.closedReason).toBe(messages.closedByHost);
  expect(vi.getTimerCount()).toBe(0);
});
