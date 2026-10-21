/** Contribution admission, registry rollback and widget rendering edge contracts. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginContributionCapture, createPluginContributionRegistry, renderPluginWidgetFragments, validatePluginRoute } from '../../contributions.js';
import type { PluginManifest } from '../../manifest.js';

const manifest: PluginManifest = { id: 'sample', name: 'Sample', version: '0.1.0', engine: 1, tier: 'tier-3', sdkRange: '*', hooks: [], fields: [], integrity: {},
  capabilities: ['http.route.register', 'tools.register', 'render.contribute'], contributes: { routes: ['GET /hello'], tools: ['hello'], widgets: ['hello', 'other'] } };
const sealed = (id: string, widgets: Record<string, () => unknown> = {}) => {
  const capture = createPluginContributionCapture({ manifest: { ...manifest, id } });
  for (const [name, render] of Object.entries(widgets)) capture.widgets.add({ name, render: render as () => string });
  return capture.seal({ sdk: {} as never });
};

afterEach(() => vi.restoreAllMocks());

describe('route and widget admission', () => {
  it.each(['TRACE', 'get', 'CONNECT'])('refuses the unsupported route method %s', (method) => {
    expect(() => validatePluginRoute({ method, path: '/hello' })).toThrow('unsupported plugin route method');
  });

  it('accepts the bare root path and parameter segments', () => {
    expect(() => validatePluginRoute({ method: 'GET', path: '/' })).not.toThrow();
    expect(() => validatePluginRoute({ method: 'DELETE', path: '/items/:itemId/' })).not.toThrow();
  });

  it('refuses a route without a handler, and a route the manifest never declared', () => {
    const capture = createPluginContributionCapture({ manifest });
    expect(() => capture.routes.add({ method: 'GET', path: '/hello', access: 'public', handler: 'not a function' as never })).toThrow('plugin route handler is required');
    expect(() => capture.routes.add({ method: 'POST', path: '/hello', access: 'public', handler: async () => ({}) })).toThrow("undeclared plugin route 'POST /hello'");
  });

  it('refuses a widget without a render function, and a second widget with the same name', () => {
    const capture = createPluginContributionCapture({ manifest });
    expect(() => capture.widgets.add({ name: 'hello', render: undefined as never })).toThrow('invalid or duplicate plugin widget');
    capture.widgets.add({ name: 'hello', render: () => 'one' });
    expect(() => capture.widgets.add({ name: 'hello', render: () => 'two' })).toThrow('invalid or duplicate plugin widget');
  });
});

describe('registry replacement rollback', () => {
  it('restores the previous generation and rethrows when a change listener fails on the new one', () => {
    const registry = createPluginContributionRegistry({});
    registry.replace({ contributions: sealed('first') });
    const failure = new Error('listener failed');
    const seen: string[][] = [];
    registry.subscribe({ onChanged: () => {
      const ids = registry.list({}).map((row) => row.pluginId);
      seen.push(ids);
      if (ids.includes('second')) throw failure;
    } });
    expect(() => registry.replace({ contributions: sealed('second') })).toThrow(failure);
    expect(registry.list({}).map((row) => row.pluginId)).toEqual(['first']);
    expect(seen).toEqual([['first', 'second'], ['first']]);
  });
});

describe('renderPluginWidgetFragments', () => {
  const base = (registry = createPluginContributionRegistry({})) => ({
    registry, names: ['hello'], workspaceId: 'ws', isEnabled: async () => true, validateHtml: ({ html }: { html: string }) => html,
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses an invalid timeout (%s) before rendering anything', async (timeoutMs) => {
    await expect(renderPluginWidgetFragments(base(), { timeoutMs })).rejects.toThrow(new RangeError('invalid widget timeout'));
  });

  it('skips plugins that contribute none of the requested widgets without asking whether they are enabled', async () => {
    const registry = createPluginContributionRegistry({});
    registry.replace({ contributions: sealed('unrelated', { other: () => '<i>other</i>' }) });
    const asked: string[] = [];
    const fragments = await renderPluginWidgetFragments({ ...base(registry), isEnabled: async ({ pluginId }) => { asked.push(pluginId); return true; } });
    expect({ ...fragments }).toEqual({});
    expect(asked).toEqual([]);
  });

  it('drops a non-string render result instead of validating or publishing it', async () => {
    const registry = createPluginContributionRegistry({});
    registry.replace({ contributions: sealed('sample', { hello: () => 42 }) });
    const validated: string[] = [];
    const fragments = await renderPluginWidgetFragments({ ...base(registry), validateHtml: ({ html }) => { validated.push(html); return html; } });
    expect(fragments.hello).toBeUndefined();
    expect(validated).toEqual([]);
  });

  it('drops a fragment whose plugin generation was replaced while it rendered', async () => {
    const registry = createPluginContributionRegistry({});
    registry.replace({ contributions: sealed('sample', { hello: () => {
      registry.replace({ contributions: sealed('sample', { hello: () => '<b>new</b>' }) });
      return '<b>stale</b>';
    } }) });
    expect((await renderPluginWidgetFragments(base(registry))).hello).toBeUndefined();
  });

  it('drops a fragment whose plugin was disabled while it rendered', async () => {
    const registry = createPluginContributionRegistry({});
    registry.replace({ contributions: sealed('sample', { hello: () => '<b>hi</b>' }) });
    let checks = 0;
    const fragments = await renderPluginWidgetFragments({ ...base(registry), isEnabled: async () => { checks += 1; return checks === 1; } });
    expect(fragments.hello).toBeUndefined();
    expect(checks).toBe(2);
  });

  it('without an error port, a failing widget renders empty and is reported on the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = createPluginContributionRegistry({});
    const failure = new Error('render exploded');
    registry.replace({ contributions: sealed('sample', { hello: () => { throw failure; } }) });
    expect((await renderPluginWidgetFragments(base(registry))).hello).toBe('');
    expect(warn).toHaveBeenCalledWith("[plugins] Plugin 'sample' widget 'hello' failed", failure);
  });
});
