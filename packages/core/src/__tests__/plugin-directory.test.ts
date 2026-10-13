import { describe, expect, it } from 'vitest';
import { assertPluginIdentityAvailable, createPluginLookupFacade, createPluginLookup, readPluginIdentity, validatePluginIdentity } from '../../plugin-directory.js';

describe('publisher identity and live host discovery (owner 2026-10-09)', () => {
  it('returns only copied metadata even when an injected source carries host services and paths', async () => {
    const source = { id: 'example/github', version: '1.0.0', enabled: true, family: 'agent-plugin', localId: 'github', keywords: ['repo'], provides: ['source-control'], packageRoot: '/private/package', hostService: () => 'private' };
    const lookup = createPluginLookup({ listPlugins: async () => [source] });
    const result = await lookup.getPlugin({ id: 'example/github' });
    expect(result).toEqual({ id: 'example/github', version: '1.0.0', enabled: true, family: 'agent-plugin', localId: 'github', keywords: ['repo'], provides: ['source-control'] });
    (result!.keywords as string[]).push('consumer-only');
    expect(source.keywords).toEqual(['repo']);
  });
  it('exposes only metadata methods on a plugin SDK even if its host carries mutation ports', async () => {
    const host = { ...createPluginLookup({ listPlugins: async () => [] }), getHostCapability: () => { throw new Error('must not be exposed'); }, withInstallIdentity: () => { throw new Error('must not be exposed'); } };
    const facade = createPluginLookupFacade({ lookup: host });
    expect(Object.keys(facade).sort()).toEqual(['findProviders', 'getPlugin']);
    expect(await facade.getPlugin({ id: 'missing/plugin' })).toBeNull();
    expect(await facade.findProviders({ capability: 'source-control' })).toEqual([]);
  });

  it('permits a legacy slot to acquire its publisher id, but refuses takeover and cross-family duplication', () => {
    const candidate = { id: 'example/github', family: 'agent-plugin', localId: 'github' };
    const provider = { ...candidate, id: 'unknown/github', version: '1.0.0', enabled: false, provides: [], keywords: [] };
    expect(() => assertPluginIdentityAvailable({ candidate, installed: [provider] })).not.toThrow();
    expect(() => assertPluginIdentityAvailable({ candidate, installed: [{ ...provider, id: 'vendor/github' }] })).toThrow("Plugin 'github' belongs to a different publisher identity.");
    expect(() => assertPluginIdentityAvailable({ candidate, installed: [{ ...provider, id: 'example/github', family: 'site-runtime' }] })).toThrow("Duplicate plugin id 'example/github'.");
  });
  it('keeps legacy manifests usable with an explicit warning', () => {
    expect(readPluginIdentity({ manifest: { name: 'github' }, namespace: 'example' })).toEqual({
      id: 'unknown/github', keywords: [], provides: [], warnings: ["Plugin 'github' has no publisher-qualified id; using 'unknown/github'."],
    });
  });

  it('preserves a legacy site storage id accepted by the old manifest grammar', () => {
    expect(readPluginIdentity({ manifest: { name: 'Display title' }, name: 'legacy--plugin', namespace: 'example' }).id).toBe('unknown/legacy--plugin');
  });

  it('separates publisher identity from version and permission capabilities', () => {
    expect(readPluginIdentity({ namespace: 'example', manifest: {
      name: 'github', version: '1.2.3', capabilities: ['content:read'], keywords: ['repository'],
      extensions: { example: { id: 'example/github', provides: ['source-control', 'deploy-target:fly'] } },
    } })).toEqual({ id: 'example/github', keywords: ['repository'], provides: ['source-control', 'deploy-target:fly'], warnings: [] });
  });

  it.each(['github', '../github', 'Example/github', 'example/github/extra', 'example//github', 'example/github@1.0', 'example/../github'])('rejects malformed id %s', id => {
    expect(validatePluginIdentity({ namespace: 'example', manifest: { extensions: { example: { id } } } }).errors).toEqual(['Plugin id must have the form publisher/name (lowercase letters, digits, dots and hyphens).']);
  });

  it('rejects partial invalid declarations rather than dropping malformed capabilities', () => {
    expect(validatePluginIdentity({ namespace: 'example', manifest: { keywords: ['valid', 4], extensions: { example: { id: 'example/github', provides: ['source-control', false] } } } }).errors).toEqual([
      'Plugin provides must be an array of capability names.',
    ]);
    expect(validatePluginIdentity({ namespace: 'example', manifest: { extensions: { example: [] } } }).errors).toEqual(['Plugin identity extension must be an object.']);
  });

  it('reads both families afresh, includes disabled installs, and scopes enabled filtering explicitly', async () => {
    let enabled = false;
    const lookup = createPluginLookup({ listPlugins: async () => [
      { id: 'example/github', version: '1.0.0', enabled, family: 'agent-plugin', localId: 'github', provides: ['source-control'], keywords: ['repo'] },
      { id: 'github/github', version: '2.0.0', enabled: true, family: 'site-runtime', localId: 'vendor-github', provides: ['source-control'], keywords: [] },
    ] });
    expect((await lookup.findProviders({ capability: 'source-control' })).map(p => p.id)).toEqual(['example/github', 'github/github']);
    expect((await lookup.findProviders({ capability: 'source-control' }, { enabledOnly: true })).map(p => p.id)).toEqual(['github/github']);
    expect(await lookup.getPlugin({ id: 'example/github' })).toEqual({ id: 'example/github', version: '1.0.0', enabled: false, family: 'agent-plugin', localId: 'github', provides: ['source-control'], keywords: ['repo'] });
    enabled = true;
    expect((await lookup.getPlugin({ id: 'example/github' }))?.enabled).toBe(true);
    expect(await lookup.getPlugin({ id: 'missing/plugin' })).toBeNull();
    expect(await lookup.findProviders({ capability: 'repo' })).toEqual([]);
  });

  it('drops duplicate qualified ids with a warning while retaining the incumbent and healthy providers', async () => {
    const common = { id: 'example/github', version: '1.0.0', enabled: true, localId: 'github', provides: ['source-control'], keywords: [] };
    const incumbent = { ...common, family: 'site-runtime' };
    const healthy = { ...common, id: 'vendor/healthy', localId: 'healthy', family: 'agent-plugin' };
    const warnings: string[] = [];
    const lookup = createPluginLookup({ listPlugins: async () => [incumbent, { ...common, family: 'agent-plugin' }, healthy] }, { warn: message => warnings.push(message) });
    expect(await lookup.getPlugin({ id: 'example/github' })).toEqual(incumbent);
    expect(await lookup.findProviders({ capability: 'source-control' })).toEqual([incumbent, healthy]);
    expect(warnings).toEqual(Array(2).fill("Duplicate plugin id 'example/github'; later provider omitted from metadata lookup."));
  });
});

// fxpid: advisory metadata and family-scoped legacy identities must not disable healthy providers.
describe('plugin identity review regressions', () => {
  it.each([{ keywords: ['repository', 4, ''] }, { keywords: 'repository' }, { keywords: null }])('warns and normalizes previously accepted keywords %j', ({ keywords }) => {
    const manifest = { name: 'bridge', keywords, extensions: { example: { id: 'example/bridge' } } };
    expect(validatePluginIdentity({ manifest, namespace: 'example' }).errors).toEqual([]);
    expect(readPluginIdentity({ manifest, namespace: 'example' })).toEqual({
      id: 'example/bridge', provides: [], keywords: Array.isArray(keywords) ? ['repository'] : [],
      warnings: ['Plugin keywords must be an array of nonempty strings; invalid keywords were ignored.'],
    });
  });

  it('permits equal fallback ids across families and allows an explicit family lookup', async () => {
    const common = { id: 'unknown/bridge', localId: 'bridge', version: '1.0.0', enabled: true, provides: ['source-control'], keywords: [] };
    const agent = { ...common, family: 'agent-plugin' };
    const site = { ...common, family: 'site-runtime' };
    expect(() => assertPluginIdentityAvailable({ candidate: agent, installed: [site] })).not.toThrow();
    const lookup = createPluginLookup({ listPlugins: async () => [site, agent] });
    expect(await lookup.findProviders({ capability: 'source-control' })).toEqual([site, agent]);
    expect(await lookup.getPlugin({ id: common.id })).toBeNull();
    expect(await lookup.getPlugin({ id: common.id, family: 'agent-plugin' })).toEqual(agent);
    const warnings: string[] = [];
    const duplicate = createPluginLookup({ listPlugins: async () => [agent, agent] }, { warn: message => warnings.push(message) });
    expect(await duplicate.getPlugin({ id: common.id })).toEqual(agent);
    expect(warnings).toEqual(["Duplicate plugin id 'unknown/bridge'; later provider omitted from metadata lookup."]);
  });

  it('reserves unknown for inferred legacy ids and rejects a publisher declaring it', () => {
    const manifest = { name: 'bridge', extensions: { example: { id: 'unknown/bridge' } } };
    expect(validatePluginIdentity({ manifest, namespace: 'example' }).errors).toEqual(["Plugin publisher 'unknown' is reserved for legacy identities."]);
    expect(() => readPluginIdentity({ manifest, namespace: 'example' })).toThrow("Plugin publisher 'unknown' is reserved for legacy identities.");
    expect(readPluginIdentity({ manifest: { name: 'bridge' }, namespace: 'example' }).id).toBe('unknown/bridge');
  });
});
