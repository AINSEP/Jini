import { describe, expect, it } from 'vitest';
import { buildAcpMcpServersForAgent } from '../mcp.js';

describe('buildAcpMcpServersForAgent', () => {
  it('returns an empty array when the def does not opt into mature-acp discovery', () => {
    const servers = buildAcpMcpServersForAgent({ def: {}, spec: { name: 'x', command: 'x' } });
    expect(servers).toEqual([]);
  });

  it('returns an empty array when explicitly disabled via spec.enabled', () => {
    const servers = buildAcpMcpServersForAgent({ def: { mcpDiscovery: 'mature-acp' }, spec: { name: 'x', command: 'x', enabled: false } }
    );
    expect(servers).toEqual([]);
  });

  it('builds an array-shaped env entry by default', () => {
    const servers = buildAcpMcpServersForAgent({ def: { mcpDiscovery: 'mature-acp' }, spec: { name: 'my-server', command: 'my-bin', args: ['serve'] } }
    );
    expect(servers).toEqual([
      {
        name: 'my-server',
        command: 'my-bin',
        args: ['serve'],
        env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
      },
    ]);
  });

  it('builds a map-shaped env entry when acpMcpEnvFormat is "map"', () => {
    const servers = buildAcpMcpServersForAgent({ def: { mcpDiscovery: 'mature-acp', acpMcpEnvFormat: 'map' }, spec: { name: 'my-server', command: 'my-bin' } }
    );
    expect(servers).toEqual([
      { name: 'my-server', command: 'my-bin', args: [], env: { ELECTRON_RUN_AS_NODE: '1' } },
    ]);
  });

  it('merges spec.extraEnv into the base env, in both array and map shapes', () => {
    const arrayShaped = buildAcpMcpServersForAgent({ def: { mcpDiscovery: 'mature-acp' }, spec: { name: 'x', command: 'x', extraEnv: { FOO: 'bar' } } }
    );
    expect(arrayShaped[0]?.env).toEqual(
      expect.arrayContaining([
        { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
        { name: 'FOO', value: 'bar' },
      ]),
    );

    const mapShaped = buildAcpMcpServersForAgent({ def: { mcpDiscovery: 'mature-acp', acpMcpEnvFormat: 'map' }, spec: { name: 'x', command: 'x', extraEnv: { FOO: 'bar' } } }
    );
    expect(mapShaped[0]?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1', FOO: 'bar' });
  });

  it('defaults args to an empty array when omitted', () => {
    const servers = buildAcpMcpServersForAgent({ def: { mcpDiscovery: 'mature-acp' }, spec: { name: 'x', command: 'x' } });
    expect(servers[0]?.args).toEqual([]);
  });
});
