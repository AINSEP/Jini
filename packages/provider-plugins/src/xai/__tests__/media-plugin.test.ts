import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import plugin, { createXaiMediaProvider, createXaiRoutesProvider, XaiMediaConfigError } from '../index.js';
import { fakeWire } from '../media/__tests__/fake-wire.js';

it('registers one media factory on setup and builds the contribution from the injected wire', () => {
  const register = vi.fn();
  plugin.definition.setup({ providers: { register } } as never);
  // Merged with K04: the one xAI plugin registers its routes and exactly one media factory, under the persisted `grok` id.
  expect(register).toHaveBeenCalledTimes(2);
  expect(register).toHaveBeenCalledWith({ contract: 'xai_routes', id: 'xai', contractVersion: 1, factory: createXaiRoutesProvider });
  expect(register.mock.calls.filter(([call]) => call.contract === 'media')).toEqual([[{ contract: 'media', id: 'grok', contractVersion: 1, factory: createXaiMediaProvider }]]);
  const resource = createXaiMediaProvider({}, { context: { mediaWire: fakeWire } });
  expect(resource.port.provider.id).toBe('grok');
  expect(resource.dispose({})).toBeUndefined();
  expect(resource.dispose({}, {})).toBeUndefined();
});

it('fails at initialize, in plain words, when the host injected no wire helpers', () => {
  expect(() => createXaiMediaProvider({}, {})).toThrow(XaiMediaConfigError);
  expect(() => createXaiMediaProvider({}, { context: { mediaWire: { imageAspectFor: () => '' } } })).toThrow(/media helpers/);
});

it('declares the media contribution in its manifest, with no credential settings of its own', async () => {
  const manifest = JSON.parse(await readFile(new URL('../jini.plugin.json', import.meta.url), 'utf8'));
  expect(manifest).toMatchObject({
    id: 'xai', name: 'xAI provider', sdkRange: '^0.1.0 || ^1.0.0', engine: 1, tier: 'tier-3',
    extensions: { jini: { id: 'jini/xai' } }, capabilities: ['providers.register'], hooks: [], fields: [], integrity: {},
  });
  expect(manifest.contributes.providers.filter((entry: { contract: string }) => entry.contract === 'media')).toEqual([{ contract: 'media', id: 'grok', contractVersion: 1, settings: [] }]);
});

it('packages exactly the manifest and compiled media subpaths, built into the distribution', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  expect(pkg.exports['./xai']).toBe(`./plugins/xai/${pkg.version}/jini.plugin.json`);
  expect(pkg.exports['./xai/media']).toEqual({ types: './dist/xai/media/index.d.ts', import: './dist/xai/media/index.js' });
  expect(pkg.exports['./xai/*']).toBe('./plugins/xai/*');
  expect(pkg.jini.entries).toMatchObject({ './xai': 'node', './xai/media': 'node', './xai/*': 'node' });
  expect(pkg.files).toEqual(expect.arrayContaining(['dist/xai', 'plugins/xai']));
  expect(pkg.files.some((file: string) => file.includes('xai-grok-imagine'))).toBe(false);
  expect(pkg.scripts.build).toContain('scripts/build.ts xai .');
});
