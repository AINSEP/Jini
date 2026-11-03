import { expect, it } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { attachFederatedMcpTools } from '../bootstrap.js';
import { createFederationReloadCoordinator } from '../reload.js';
import { FEDERATED_CONNECTION_DEFAULTS, type ResolvedFederatedConnection } from '../config.js';
import { InMemoryMcpSession } from '../testing/adapter.memory.js';
import { messages, testPermissionGate } from './fixtures.js';

it('makes tools available after granting an already-on connection without restarting the assistant', async () => {
  const registry = createToolRegistry({});
  let connection: ResolvedFederatedConnection = { config: {
    ...FEDERATED_CONNECTION_DEFAULTS, connectionId: 'media', label: 'Media',
    allowedToolNames: [], writeAllowedToolNames: [], origin: { kind: 'roster', admissionRevision: 'endpoint-1' },
  }, launch: { url: 'https://example.test/mcp', headers: {} } };
  let connects = 0;
  const connect = async () => { connects += 1; return new InMemoryMcpSession({ tools: [
    { name: 'list_media', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  ] }); };
  const deps = { errorCode: 'EXTERNAL_MCP', messages,
    permissionGate: testPermissionGate({ authorize: async () => ({ allowed: true, reason: 'matched' }), scope: 'ws' }), scope: 'ws' };
  const boot = await attachFederatedMcpTools({ registry, deps, connect }, { connections: [], extraConnections: [connection] });
  expect(boot.reports[0]?.report.admitted).toEqual([]);
  expect(boot.sessions, 'an empty grant must not retain an unused session across re-admission').toEqual([]);
  const reload = createFederationReloadCoordinator({ coordDeps: { registry, deps, connect, resolveConnections: async () => [connection] },
    initiallyAdmitted: ['media'] }, { initiallyAwaitingGrants: ['media'] });
  await reload.reload({});
  expect(connects).toBe(1);
  expect(registry.list({})).toEqual([]);
  connection = { ...connection, config: { ...connection.config, allowedToolNames: ['list_media'] } };
  const result = await reload.reload({});
  expect(result.newlyAdmittedConnectionIds).toEqual(['media']);
  expect(registry.list({}).map(tool => tool.id)).toEqual(['mcp__media__list_media']);
  await reload.reload({});
  expect(connects).toBe(2);
});

it('keeps an admitted tool set frozen when a later grant names another tool', async () => {
  const registry = createToolRegistry({});
  let connection: ResolvedFederatedConnection = { config: { ...FEDERATED_CONNECTION_DEFAULTS,
    connectionId: 'media', label: 'Media', allowedToolNames: ['first'], writeAllowedToolNames: [] },
    launch: { url: 'https://example.test/mcp', headers: {} } };
  let connects = 0;
  const reload = createFederationReloadCoordinator({ initiallyAdmitted: ['media'], coordDeps: {
    registry, deps: { errorCode: 'MCP', messages, permissionGate: async () => {} },
    resolveConnections: async () => [connection], connect: async () => { connects += 1; return new InMemoryMcpSession({ tools: [] }); },
  } });
  connection = { ...connection, config: { ...connection.config, allowedToolNames: ['first', 'second'] } };
  expect((await reload.reload({})).newlyAdmittedConnectionIds).toEqual([]);
  expect(connects).toBe(0);
});
