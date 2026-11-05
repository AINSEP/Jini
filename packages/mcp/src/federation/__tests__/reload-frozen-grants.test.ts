import { expect, it } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { attachFederatedMcpTools } from '../bootstrap.js';
import { createFederationReloadCoordinator } from '../reload.js';
import { FEDERATED_CONNECTION_DEFAULTS, type ResolvedFederatedConnection } from '../config.js';
import { InMemoryMcpSession } from '../testing/adapter.memory.js';
import { messages } from './fixtures.js';
import { buildFederatedMcpRegistrations } from '../registrations.js';

it('reloads owner grants and withdraws disabled sources using frozen schemas without another handshake', async () => {
  const registry = createToolRegistry({});
  let connection: ResolvedFederatedConnection = { config: { ...FEDERATED_CONNECTION_DEFAULTS, connectionId: 'media', label: 'Media',
    allowedToolNames: ['read'], writeAllowedToolNames: [], origin: { kind: 'roster', admissionRevision: 'original-endpoint' } },
    launch: { url: 'https://media.example.test/mcp', headers: {} } };
  let connections = [connection];
  let connects = 0;
  let lists = 0;
  const session = new InMemoryMcpSession({ tools: [] });
  session.listTools = async () => {
    lists++;
    return [
      { name: 'read', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
      { name: 'write', inputSchema: { type: 'object', properties: { original: { type: 'string' } } }, annotations: { readOnlyHint: false } },
    ];
  };
  const connect = async () => { connects++; return session; };
  const deps = { errorCode: 'MCP', messages, permissionGate: async () => {} };
  await attachFederatedMcpTools({ registry, deps, connect }, { connections: [], extraConnections: connections,
    buildRegistrations: params => {
      const built = buildFederatedMcpRegistrations(params);
      return { ...built, registrations: built.registrations.map(registration => ({ ...registration, descriptor: { ...registration.descriptor, description: 'Host approval adapter retained' } })) };
    },
  });
  const coordinator = createFederationReloadCoordinator({ initiallyAdmitted: ['media'], coordDeps: { registry, deps, connect, resolveConnections: async () => connections } });
  expect(registry.has({ toolId: 'mcp__media__write' })).toBe(false);
  connection = { ...connection, config: { ...connection.config, allowedToolNames: ['read', 'write'], writeAllowedToolNames: ['write'] } };
  connections = [connection];
  await coordinator.reload({});
  expect(registry.list({}).find(tool => tool.id === 'mcp__media__write')?.inputSchema).toEqual({ type: 'object', properties: { original: { type: 'string' } } });
  expect(registry.list({}).find(tool => tool.id === 'mcp__media__write')?.description).toBe('Host approval adapter retained');
  connections = [];
  await coordinator.reload({});
  expect(registry.list({})).toEqual([]);
  connections = [connection];
  await coordinator.reload({});
  expect(registry.list({})).toHaveLength(2);
  connections = [{ ...connection, config: { ...connection.config, origin: { kind: 'roster', admissionRevision: 'different-endpoint' } } }];
  await coordinator.reload({});
  expect(registry.list({})).toEqual([]);
  expect({ connects, lists }).toEqual({ connects: 1, lists: 1 });
});
