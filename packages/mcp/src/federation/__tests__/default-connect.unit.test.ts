import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultConnect } from '../stdio/default-connect.js';
import { IDENTITY_STDIO_LAUNCH_RESOLVER, type McpStdioLaunchResolver } from '../stdio/stdio-launch-resolver.js';
import { clientInfo, messages } from './fixtures.js';

const config = { connectionId: 'example', label: 'Example', allowedToolNames: [], writeAllowedToolNames: [],
  connectTimeoutMs: 1000, callTimeoutMs: 1000, maxResultBytes: 100, maxTools: 2 };
const connection = { config, launch: { command: 'example', args: [], env: {} } };

/** A resolver that falls back with a warning, as `stdioLaunchResolverFromEnv` does for an incomplete toolchain. */
const warningResolver: McpStdioLaunchResolver = {
  resolve: (required) => ({ ...IDENTITY_STDIO_LAUNCH_RESOLVER.resolve(required), warning: 'toolchain incomplete' }),
};
const refusingSpawn = () => { throw new Error('spawn refused'); };

afterEach(() => vi.restoreAllMocks());

it('logs a resolver fallback warning once per connect factory, however many connections resolve', async () => {
  const warnings: string[] = [];
  const connect = createDefaultConnect({ resolver: warningResolver, clientInfo, messages, bearerToken: () => undefined },
    { spawnChannel: refusingSpawn, logger: { warn: ({ message }) => warnings.push(message) } });
  await expect(connect({ connection })).rejects.toThrow('spawn refused');
  await expect(connect({ connection })).rejects.toThrow('spawn refused');
  expect(warnings).toEqual(['toolchain incomplete']);
});

it('a fresh connect factory warns again: deduplication is per instance, not process-wide', async () => {
  const warnings: string[] = [];
  const logger = { warn: ({ message }: { message: string }) => warnings.push(message) };
  for (let i = 0; i < 2; i += 1) {
    const connect = createDefaultConnect({ resolver: warningResolver, clientInfo, messages, bearerToken: () => undefined },
      { spawnChannel: refusingSpawn, logger });
    await expect(connect({ connection })).rejects.toThrow('spawn refused');
  }
  expect(warnings).toEqual(['toolchain incomplete', 'toolchain incomplete']);
});

it('without an injected logger the fallback warning goes to console.warn', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const connect = createDefaultConnect({ resolver: warningResolver, clientInfo, messages, bearerToken: () => undefined },
    { spawnChannel: refusingSpawn });
  await expect(connect({ connection })).rejects.toThrow('spawn refused');
  expect(warn).toHaveBeenCalledWith('toolchain incomplete');
});

it('a resolver without a warning logs nothing and leaves no timer behind after a spawn failure', async () => {
  vi.useFakeTimers();
  try {
    const warnings: string[] = [];
    const connect = createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages, bearerToken: () => undefined },
      { spawnChannel: refusingSpawn, logger: { warn: ({ message }) => warnings.push(message) } });
    await expect(connect({ connection })).rejects.toThrow('spawn refused');
    expect(warnings).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps fresh bearer suppliers bound to their connection, even at one URL', async () => {
  const requests: string[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push(new Headers(init?.headers).get('authorization') ?? '');
    const body = JSON.parse(String(init?.body));
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === 'initialize'
      ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'example', version: '1' } }
      : { tools: [] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const connect = createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages,
    bearerToken: () => 'unrelated-runtime-token' }, { fetch: fetchImpl });
  let tokenA = 'owner-a';
  let allowed = true;
  const a = await connect({ connection: { config, launch: { url: 'https://same.example/mcp', headers: {} },
    bearerToken: () => { if (!allowed) throw new Error('shared grant removed'); return tokenA; } } });
  const b = await connect({ connection: { config: { ...config, connectionId: 'other' }, launch: { url: 'https://same.example/mcp', headers: {} },
    bearerToken: () => 'owner-b' } });
  requests.length = 0;
  tokenA = 'owner-a-rotated';
  await a.listTools({});
  await b.listTools({});
  expect(requests).toEqual(['Bearer owner-a-rotated', 'Bearer owner-b']);
  allowed = false;
  await expect(a.listTools({})).rejects.toThrow('shared grant removed');
  expect(requests).toHaveLength(2);
});
