import { describe, expect, it } from 'vitest';
import { buildClaudeMcpJson, buildOpenCodeMcpConfigContent, isManagedProjectCwd, readMcpConfig, writeMcpConfig } from '../core/config.js';
import { getToken, setToken, clearToken, sanitizeTokensFile, isTokenExpired } from '../core/tokens.js';
import { createMcpIdleExitController } from '../client/client.js';
import { isAgentSlug, planAgentInstall, applyJsonInstall, removeJsonInstall } from '../agent-install/install.js';
import { requireString, buildToolIndex, handleToolCall } from '../server/tool-protocol.js';
import type { McpConfigFilesystemPort } from '../core/config.js';

function memoryFilesystem() {
  const texts = new Map<string, string>();
  const filesystem: McpConfigFilesystemPort = {
    readText: async ({ filePath }) => {
      const value = texts.get(filePath);
      if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return value;
    },
    writeSecretText: async ({ filePath, contents }) => { texts.set(filePath, contents); },
  };
  return { filesystem, texts };
}

describe('object arguments and injected ports', () => {
  it('uses a host filesystem for config and token round trips without disk I/O', async () => {
    const { filesystem, texts } = memoryFilesystem();
    const server = { id: 'remote', transport: 'http' as const, enabled: true, url: 'https://example.test/mcp' };
    const config = await writeMcpConfig({ dataDir: '/virtual', body: { servers: [server] } }, { filesystem });
    expect(await readMcpConfig({ dataDir: '/virtual' }, { filesystem })).toEqual(config);
    const token = { accessToken: 'access', tokenType: 'Bearer', savedAt: 123 };
    await setToken({ dataDir: '/virtual', serverId: 'remote', token }, { filesystem });
    expect(await getToken({ dataDir: '/virtual', serverId: 'remote' }, { filesystem })).toEqual(token);
    await clearToken({ dataDir: '/virtual', serverId: 'remote' }, { filesystem });
    expect(await getToken({ dataDir: '/virtual', serverId: 'remote' }, { filesystem })).toBeNull();
    expect([...texts.keys()].sort()).toEqual(['/virtual/mcp-config.json', '/virtual/mcp-tokens.json']);
  });

  it('uses the supplied clock when imported tokens omit their saved time', () => {
    const file = sanitizeTokensFile({ raw: { servers: { a: { accessToken: 'a' } } } }, { clock: { nowMs: () => 123 } });
    expect(file.servers.a?.savedAt).toBe(123);
    expect(isTokenExpired({ token: { accessToken: 'a', tokenType: 'Bearer', savedAt: 0, expiresAt: 500 } }, { now: 499, skew: 0 })).toBe(false);
  });

  it('keeps authentication bytes unchanged when optional tokens are supplied separately', () => {
    const servers = [{ id: 'a', transport: 'http' as const, enabled: true, url: 'https://example.test/mcp' }];
    expect(buildClaudeMcpJson({ servers }, { tokens: { a: 'token' } })).toEqual({ mcpServers: { a: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer token' } } } });
    expect(JSON.parse(buildOpenCodeMcpConfigContent({ servers }, { tokens: { a: 'token' } })!)).toEqual({ mcp: { a: { type: 'remote', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer token' }, enabled: true } } });
  });

  it('resolves managed paths through the supplied host resolver', () => {
    const seen: string[] = [];
    const result = isManagedProjectCwd({ cwd: '/alias/item', projectsDir: '/alias' }, {
      resolvePath: ({ filePath }) => { seen.push(filePath); return filePath.replace('/alias', '/real'); },
    });
    expect(result).toBe(true);
    expect(seen).toEqual(['/alias', '/alias/item']);
  });

  it('narrows the guarded argument object and preserves JSON install/remove behavior', () => {
    const args = { value: 'cursor' };
    if (!isAgentSlug(args)) throw new Error('fixture slug must be valid');
    const plan = planAgentInstall({ slug: args.value, spec: { command: 'node', args: ['server.js'], env: {} }, ctx: { home: '/home', platform: 'linux', serverName: 'example' } });
    if (plan.kind !== 'json') throw new Error('cursor must use JSON');
    const installed = applyJsonInstall({ existingText: '{"other":true}', plan });
    expect(JSON.parse(installed)).toEqual({ other: true, mcpServers: { example: { command: 'node', args: ['server.js'], type: 'stdio' } } });
    expect(JSON.parse(removeJsonInstall({ existingText: installed, plan })!)).toEqual({ other: true, mcpServers: {} });
  });

  it('uses injected timers and cancels the host handle when disposed', () => {
    const scheduled: number[] = [];
    const cancelled: ReturnType<typeof setTimeout>[] = [];
    const handle = {} as ReturnType<typeof setTimeout>;
    const controller = createMcpIdleExitController({ idleMs: 123, onIdle: () => { throw new Error('must not fire'); } }, {
      timers: {
        schedule: ({ delayMs }) => { scheduled.push(delayMs); return handle; },
        cancel: ({ handle }) => { cancelled.push(handle); },
      },
    });
    controller.dispose({});
    expect(scheduled).toEqual([123]);
    expect(cancelled).toEqual([handle]);
  });

  it('uses a supplied clock for expiration and environment for Windows install paths', () => {
    expect(isTokenExpired({ token: { accessToken: 'a', tokenType: 'Bearer', savedAt: 0, expiresAt: 500 } }, { clock: { nowMs: () => 500 }, skew: 0 })).toBe(true);
    const plan = planAgentInstall({ slug: 'cline', spec: { command: 'node', args: [], env: {} }, ctx: { home: '/home', platform: 'win32', serverName: 'example' } }, { env: { APPDATA: '/host/appdata' } });
    if (plan.kind !== 'json') throw new Error('cline must use JSON');
    expect(plan.configPath).toBe('/host/appdata/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
  });

  it('returns a validated string and dispatches a single required handler object', async () => {
    const ctx = { baseUrl: 'https://example.test', fetchImpl: fetch };
    const tools = buildToolIndex({ tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, handler: ({ args, ctx: received }) => {
      expect(received).toBe(ctx);
      return requireString({ value: args.text, name: 'text' });
    } }] });
    expect(await handleToolCall({ name: 'echo', tools, ctx }, { rawArgs: { text: 'hello' } })).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });
});
