/**
 * @file Unit tests for `capabilities.ts`: an admin-surface call gets the tool port's http, limiter
 * and (only when bound) artifacts, plus surface-only connections, state, public config and (only
 * when the site binds form delivery) delivery bindings, each scoped to the call. Typed fakes; nothing provider-specific.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { AdminSurfaceConnections, AdminSurfaceDeliveryBindings, AdminSurfaceForms, AdminSurfacePublicConfig, AdminSurfaceState } from '../../../admin-surfaces/index.js';
import type { AgentPluginToolCapabilities, AgentPluginToolCapabilityScope } from '../../../lifecycle/tools/index.js';

import { createAdminSurfaceCapabilities } from '../capabilities.js';

const unused = (name: string) => async (): Promise<never> => { throw new Error(`${name} is not used by this test`); };

function toolCapabilities(withArtifacts: boolean): AgentPluginToolCapabilities {
  return {
    connections: { getAccessToken: unused('connections.getAccessToken') },
    http: { fetch: unused('http.fetch') },
    limiter: { check: async () => ({ allowed: true }) },
    state: { get: async () => null },
    ...(withArtifacts ? { artifacts: { write: async () => ({ artifactRef: 'artifact-1' }) } } : {}),
  };
}

const connections: AdminSurfaceConnections = {
  getAccessToken: unused('getAccessToken'), status: unused('status'), begin: unused('begin'), confirmSwitch: unused('confirmSwitch'),
  cancelSwitch: unused('cancelSwitch'), disconnect: unused('disconnect'), takeCallbackFields: unused('takeCallbackFields'),
};
const state: AdminSurfaceState = { get: async () => null, set: unused('set'), delete: unused('delete') };
const publicConfig: AdminSurfacePublicConfig = { get: async () => null };
const SCOPE: AgentPluginToolCapabilityScope = { pluginId: 'acme-office', workspaceId: 'ws-1', principalId: 'owner' };

function build(withArtifacts: boolean) {
  const toolScopes: AgentPluginToolCapabilityScope[] = [];
  const connectionScopes: AgentPluginToolCapabilityScope[] = [];
  const stateScopes: Array<{ workspaceId: string; pluginId: string }> = [];
  const tools = toolCapabilities(withArtifacts);
  const port = createAdminSurfaceCapabilities({
    tools: (scope) => { toolScopes.push(scope); return tools; },
    connectionsFor: (scope) => { connectionScopes.push(scope); return connections; },
    stateFor: (scope) => { stateScopes.push(scope); return state; },
    publicConfig,
  });
  return { port, tools, toolScopes, connectionScopes, stateScopes };
}

test('http and limiter are the tool port\'s own, built for the same call scope', () => {
  const { port, tools, toolScopes } = build(false);
  const capabilities = port(SCOPE);
  assert.equal(capabilities.http, tools.http);
  assert.equal(capabilities.limiter, tools.limiter);
  assert.deepEqual(toolScopes, [SCOPE]);
});

test('no artifact store bound: the surface gets no artifacts capability at all', () => {
  const capabilities = build(false).port(SCOPE);
  assert.equal(Object.hasOwn(capabilities, 'artifacts'), false);
});

test('an artifact store bound: the surface gets the tool port\'s artifacts', () => {
  const { port, tools } = build(true);
  assert.equal(port(SCOPE).artifacts, tools.artifacts);
});

test('connections get the full call scope; state only the workspace and plugin', () => {
  const { port, connectionScopes, stateScopes } = build(false);
  const capabilities = port(SCOPE);
  assert.equal(capabilities.connections, connections);
  assert.equal(capabilities.state, state);
  assert.deepEqual(connectionScopes, [SCOPE]);
  assert.deepEqual(stateScopes, [{ workspaceId: 'ws-1', pluginId: 'acme-office' }]);
});

test('public config is the one site-wide port, the same for every call', () => {
  const { port } = build(false);
  assert.equal(port(SCOPE).publicConfig, publicConfig);
  assert.equal(port({ ...SCOPE, pluginId: 'other-plugin' }).publicConfig, publicConfig);
});

test('no delivery bindings port bound: the surface gets no deliveryBindings capability at all', () => {
  assert.equal(Object.hasOwn(build(false).port(SCOPE), 'deliveryBindings'), false);
});

test('a delivery bindings port bound: each call gets the port built for its full scope', () => {
  const deliveryBindings: AdminSurfaceDeliveryBindings = { list: unused('list'), save: unused('save'), remove: unused('remove') };
  const scopes: AgentPluginToolCapabilityScope[] = [];
  const port = createAdminSurfaceCapabilities({
    tools: () => toolCapabilities(false), connectionsFor: () => connections, stateFor: () => state, publicConfig,
  }, { deliveryBindingsFor: (scope) => { scopes.push(scope); return deliveryBindings; } });
  assert.equal(port(SCOPE).deliveryBindings, deliveryBindings);
  assert.deepEqual(scopes, [SCOPE]);
});

test('no forms port bound: the surface gets no forms capability', () => {
  assert.equal(Object.hasOwn(build(false).port(SCOPE), 'forms'), false);
});

test('a forms reader bound: each call gets the reader for its authenticated scope', () => {
  const forms: AdminSurfaceForms = { list: async () => [{ slug: 'contact', title: 'Contact' }] };
  const scopes: AgentPluginToolCapabilityScope[] = [];
  const port = createAdminSurfaceCapabilities({
    tools: () => toolCapabilities(false), connectionsFor: () => connections, stateFor: () => state, publicConfig,
  }, { formsFor: (scope) => { scopes.push(scope); return forms; } });
  assert.equal(port(SCOPE).forms, forms);
  assert.deepEqual(scopes, [SCOPE]);
});
