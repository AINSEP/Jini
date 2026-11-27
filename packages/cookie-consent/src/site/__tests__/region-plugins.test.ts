import { expect, it, vi } from 'vitest';
import { resolveRegion } from '../../server/region.js';
import { loadSiteConsentBridges, loadSiteConsentScripts, loadSiteRegionResolvers, toRegionResolvers, type LoadConsentContributions } from '../region-plugins.js';

const primary = { kind: 'region-resolver', id: 'edge-country', header: 'x-edge-country' };
const foreign = { kind: 'region-resolver', id: 'foreign', header: 'x-other-country' };
const bridge = { kind: 'consent-bridge', id: 'preferences', src: '/preferences.mjs' };
const tags = { kind: 'declared-scripts', id: 'assets', scripts: [{ src: '/base.js' }] };
const brokenTags = { kind: 'declared-scripts', id: 'bad' };

function source() {
  const reads: unknown[] = [];
  const loadContributions: LoadConsentContributions = async ({ workspaceId, definition }, { requireActive }) => {
    reads.push({ workspaceId, filename: definition.filename, kind: definition.kind, requireActive });
    if (workspaceId !== 'workspace-9' || definition.filename !== 'jini-consent.json' || requireActive !== true) throw new Error('wrong contribution lookup');
    const items = [];
    const refusals = [];
    for (const [pluginId, contributions] of [['another', [foreign, bridge]], ['edge', [primary, tags, brokenTags, { kind: 'custom', id: 'skip-me' }]]] as const) {
      const result = definition.parse({ raw: JSON.stringify({ schemaVersion: 2, contributions }) });
      if (!result.ok) throw new Error(result.reason);
      for (const descriptor of result.descriptors) {
        const item = await definition.load({ plugin: { pluginId }, descriptor });
        if (typeof item === 'string') refusals.push(item);
        else items.push(item);
      }
    }
    return { items, refusals };
  };
  return { workspaceId: 'workspace-9', reads, loadContributions, reportFailure: vi.fn() };
}

const requestFor = (values: Record<string, string>) => ({ header: (name: string) => values[name] ?? null, ip: null });

it('trusts only the named ingress, ahead of the configured fallback header', async () => {
  const h = source();
  const resolvers = await loadSiteRegionResolvers(h, { ingress: 'edge', legacyHeader: 'x-legacy' });
  expect(h.reads).toEqual([{ workspaceId: 'workspace-9', filename: 'jini-consent.json', kind: 'data', requireActive: true }]);
  expect(resolvers.map(({ id }) => id)).toEqual(['edge-country', 'configured-header']);
  expect(await resolveRegion({ resolvers, request: requestFor({ 'x-edge-country': 'CA', 'x-legacy': 'US' }) })).toBe('strict');
  expect(await resolveRegion({ resolvers, request: requestFor({ 'x-other-country': 'US' }) })).toBe('strict');
  expect(await resolveRegion({ resolvers, request: requestFor({ 'x-edge-country': 'XX', 'x-legacy': 'US' }) })).toBe('us');
  expect(h.reportFailure).not.toHaveBeenCalled();
});

it('does not load a plugin without a configured ingress and drops invalid legacy names', async () => {
  const h = source();
  expect(await loadSiteRegionResolvers(h)).toEqual([]);
  expect(h.reads).toEqual([]);
  expect(toRegionResolvers({ entries: [bridge, { ...primary, header: 'bad header' }] }, { legacyHeader: 'another bad header' })).toEqual([]);
});

it('collects bridges and declared assets without turning them into region readers and surfaces declaration refusals', async () => {
  const h = source();
  expect(await loadSiteConsentBridges(h)).toEqual([bridge]);
  expect(await loadSiteConsentScripts(h)).toEqual({ scripts: [{ src: '/base.js' }], problems: ["Script declarations 'bad' from 'edge' need a scripts array."] });
  expect(h.reportFailure).not.toHaveBeenCalled();
});

it('fails region and bridge lookup closed, but propagates declaration load failure for snapshot retry', async () => {
  const error = new Error('contribution store offline');
  const h = { ...source(), loadContributions: async () => { throw error; } };
  expect(await loadSiteRegionResolvers(h, { ingress: 'edge' })).toEqual([]);
  expect(await loadSiteConsentBridges(h)).toEqual([]);
  await expect(loadSiteConsentScripts(h)).rejects.toBe(error);
  expect(h.reportFailure.mock.calls).toEqual([
    [{ message: 'region readers could not be loaded; visitors get the strict banner', error }],
    [{ message: 'browser bridges could not be loaded', error }],
  ]);
});

it('treats a missing contribution file as optional but leaves permission failures reportable', async () => {
  const loadContributions: LoadConsentContributions = async ({ definition }) => {
    expect(definition.onReadError?.({ error: { code: 'ENOENT' } })).toEqual([]);
    expect(definition.onReadError?.({ error: { code: 'EACCES' } })).toBeUndefined();
    return { items: [], refusals: [] };
  };
  await expect(loadSiteConsentScripts({ workspaceId: 'workspace-9', loadContributions })).resolves.toEqual({ scripts: [], problems: [] });
});
