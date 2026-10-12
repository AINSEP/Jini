/** Owner dispatch plugwire: declaration admission, capture sealing and revocation contracts. */
import { expect, it } from 'vitest';
import { createPluginContributionCapture, createPluginContributionRegistry, pluginToolIdFor } from '../../contributions.js';
import type { PluginManifest } from '../../manifest.js';
const manifest: PluginManifest = { id: 'sample', name: 'Sample', version: '0.1.0', engine: 1, tier: 'tier-3', sdkRange: '*', hooks: [], fields: [], integrity: {}, capabilities: ['http.route.register','tools.register','render.contribute'], contributes: { routes: ['GET /hello'], tools: ['hello'], widgets: ['hello'] } };
it('captures only declared contributions, refuses duplicate routes and seals setup', () => {
  const capture = createPluginContributionCapture({ manifest });
  capture.routes.add({ method: 'GET', path: '/hello', access: 'public', handler: async () => ({ body: 'hello' }) });
  expect(() => capture.routes.add({ method: 'GET', path: '/HELLO/', access: 'public', handler: async () => ({}) })).toThrow(/duplicate/);
  expect(() => capture.tools.add({ name: 'undeclared', description: 'test', inputSchema: { type: 'object' }, handler: async () => null })).toThrow(/undeclared/);
  const snapshot = capture.seal({ sdk: {} as never });
  expect(snapshot.routes).toHaveLength(1);
  expect(() => capture.widgets.add({ name: 'hello', render: () => '<b>Hello</b>' })).toThrow(/sealed/);
});
it('publishes a generation atomically, swaps handlers, detaches and refuses prefixed tool collisions', () => {
  const registry = createPluginContributionRegistry({});
  const make = (id: string, value: string) => {
    const capture = createPluginContributionCapture({ manifest: { ...manifest, id } });
    capture.tools.add({ name: 'hello', description: value, inputSchema: { type: 'object' }, handler: async () => value });
    return capture.seal({ sdk: {} as never });
  };
  registry.replace({ contributions: make('sample', 'first') });
  registry.replace({ contributions: make('sample', 'second') });
  expect(registry.list({})[0]!.tools[0]!.description).toBe('second');
  registry.replace({ contributions: make('a-b', 'a') });
  expect(() => registry.replace({ contributions: make('a_b', 'b') })).toThrow(/collision/);
  registry.detach({ pluginId: 'sample' });
  expect(registry.list({}).some(row => row.pluginId === 'sample')).toBe(false);
  expect(pluginToolIdFor({ pluginId: 'sample', name: 'hello' })).toBe('p_sample__hello');
});
it('rejects route escape, malformed access, unsupported schemas and excessive registrations', () => {
  const capture = createPluginContributionCapture({ manifest });
  for (const path of ['/../hello', '//hello', '/hello?x=1', '/hello%2fworld']) expect(() => capture.routes.add({ method: 'GET', path, access: 'public', handler: async () => ({}) })).toThrow();
  expect(() => capture.routes.add({ method: 'GET', path: '/hello', access: 'owner' as never, handler: async () => ({}) })).toThrow(/access/);
  expect(() => capture.tools.add({ name: 'hello', description: 'hello', inputSchema: [] as never, handler: async () => null })).toThrow(/schema/);
  expect(() => capture.tools.add({ name: 'hello', description: 'hello', inputSchema: { type: 'object', description: 'é'.repeat(40000) }, handler: async () => null })).toThrow(/too large/);
  const limited = createPluginContributionCapture({ manifest }, { maxContributions: 1 });
  limited.tools.add({ name: 'hello', description: 'hello', inputSchema: { type: 'object' }, handler: async () => null });
  expect(() => limited.widgets.add({ name: 'hello', render: () => 'hello' })).toThrow(/limit/);
});
