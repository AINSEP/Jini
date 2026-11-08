import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createFrozenConnectionAccounts, createAgentPluginDisclosure, registerAgentPluginExecutableTools } from '@jini-ai/agent-plugins/connect/executable';
import { createAdminSurfaceConnections, type AdminSurfaceConnectionsHost } from '@jini-ai/agent-plugins/admin-surfaces/connections';

/** Traverse actual emitted imports, so a universal label cannot hide a node runtime closure. */
function emittedClosure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(entry, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1]!;
    expect(specifier).not.toMatch(/^node:/);
    expect(specifier).not.toMatch(/^@jini-ai\/(?!core(?:\/|$))/);
    if (specifier.startsWith('.')) emittedClosure(resolve(dirname(entry), specifier), seen);
  }
  return seen;
}

it('A6 exports both factories with universal runtime closures and declarations', () => {
  expect(typeof registerAgentPluginExecutableTools).toBe('function');
  expect(typeof createAgentPluginDisclosure).toBe('function');
  expect(typeof createAdminSurfaceConnections).toBe('function');
  const root = fileURLToPath(new URL('../../../packages/agent-plugins/', import.meta.url));
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const subpath of ['./connect/executable', './admin-surfaces/connections']) {
    expect(manifest.jini.entries[subpath]).toBe('universal');
    expect(emittedClosure(resolve(root, manifest.exports[subpath].import)).size).toBeGreaterThan(1);
    expect(readFileSync(resolve(root, manifest.exports[subpath].types), 'utf8')).toContain('export');
  }
});

it('A6 public disclosure uses the caller frozen-account instance and host copy', async () => {
  const frozen = createFrozenConnectionAccounts();
  const signal = new AbortController().signal;
  const disclose = createAgentPluginDisclosure({ frozen,
    source: { describeAffectedResources: async () => ({ effect: 'write', resources: ['entry'], connections: ['key'] }) },
    connections: { readAccount: async () => ({ accountId: 'identity', displayName: 'Other host identity' }), getAccessToken: async () => 'unused' },
    messages: { withdrawn: 'gone', notConnected: 'sign in', accountLabel: 'Identity', affectsLabel: 'Changes' },
  });
  expect(await disclose({ ctx: { executionId: 'e', principal: { id: 'p' }, run: { id: 'r' }, signal, input: {} }, toolId: 'tool', pluginId: 'plugin', workspaceId: 'workspace' })).toEqual([{ label: 'Identity', value: 'Other host identity' }, { label: 'Changes', value: 'entry' }]);
  expect(frozen.lookup({ signal, connectionRef: 'key' })).toBe('identity');
});

it('A6 public surface host preserves a host refusal before a foreign workspace can read', async () => {
  const refusal = new Error('Other host unavailable.');
  const unused = async (): Promise<never> => { throw new Error('No host call expected'); };
  const host: AdminSurfaceConnectionsHost = {
    workspaceId: 'workspace', nowMs: () => 0, connectionKey: () => 'key', listConnections: unused,
    requestedScopes: unused, readRecord: unused, getAccessToken: unused, startSignIn: unused,
    service: () => ({ confirmSwitchAccount: unused, cancelSwitchAccount: unused, disconnect: unused }),
    attempts: new Map(), callbackInbox: { deposit() {}, take: () => null }, notAvailable: () => refusal,
  };
  await expect(createAdminSurfaceConnections({ host, pluginId: 'plugin', workspaceId: 'foreign' }).status({ connectionId: 'account' })).rejects.toBe(refusal);
});
