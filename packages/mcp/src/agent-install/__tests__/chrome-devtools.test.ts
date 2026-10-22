import { describe, expect, it } from 'vitest';
import { CHROME_DEVTOOLS_MCP_PRESET, planAgentInstall, applyJsonInstall,
  buildClaudeMcpJson, buildAcpMcpServers } from '../../index.js';

const args = ['-y', 'chrome-devtools-mcp@1.10.1', '--no-usage-statistics', '--no-performance-crux'];
const ctx = { home: '/home/test', platform: 'linux' as const, serverName: 'chrome-devtools' };

describe('Chrome DevTools on-demand preset', () => {
  it('pins the executable, version and both privacy flags with no environment additions', () => {
    expect(CHROME_DEVTOOLS_MCP_PRESET).toEqual({ command: 'npx', args, env: {} });
  });
  it.each(['claude', 'codex'] as const)('preserves exact argv through the %s planner', (slug) => {
    const plan = planAgentInstall({ slug, spec: CHROME_DEVTOOLS_MCP_PRESET, ctx }, { env: {} });
    if (plan.kind !== 'cli') throw new Error('expected CLI plan');
    expect(plan.bin).toBe(slug);
    expect(plan.addArgv).toEqual(['mcp', 'add', ...(slug === 'claude' ? ['--scope', 'user'] : []),
      'chrome-devtools', '--', 'npx', ...args]);
  });
  it('preserves exact JSON registration and unrelated servers on repeated application', () => {
    const plan = planAgentInstall({ slug: 'cursor', spec: CHROME_DEVTOOLS_MCP_PRESET, ctx }, { env: {} });
    if (plan.kind !== 'json') throw new Error('expected JSON plan');
    const existingText = '{"mcpServers":{"other":{"command":"other-server"}}}';
    const installed = applyJsonInstall({ existingText, plan });
    expect(JSON.parse(installed)).toEqual({ mcpServers: {
      other: { command: 'other-server' }, 'chrome-devtools': { type: 'stdio', command: 'npx', args },
    } });
    expect(applyJsonInstall({ existingText: installed, plan })).toBe(installed);
  });
  it('preserves the preset through Claude JSON and ACP adapters', () => {
    const servers = [{ id: 'chrome-devtools', transport: 'stdio' as const, enabled: true,
      ...CHROME_DEVTOOLS_MCP_PRESET }];
    expect(buildClaudeMcpJson({ servers })).toEqual({ mcpServers: {
      'chrome-devtools': { command: 'npx', args },
    } });
    expect(buildAcpMcpServers({ servers })).toEqual([
      { type: 'stdio', name: 'chrome-devtools', command: 'npx', args, env: [] },
    ]);
  });
});
