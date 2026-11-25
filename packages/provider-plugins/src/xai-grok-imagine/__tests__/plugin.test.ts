import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import plugin, { createXaiMediaProvider, XaiMediaConfigError } from '../index.js';
import { fakeWire } from './fake-wire.js';

it('registers one media factory on setup and builds the contribution from the injected wire', () => {
  const register = vi.fn();
  plugin.definition.setup({ providers: { register } } as never);
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith({ contract: 'media', id: 'xai_grok_imagine', contractVersion: 1, factory: createXaiMediaProvider });
  const resource = createXaiMediaProvider({}, { context: { mediaWire: fakeWire } });
  expect(resource.port.provider.id).toBe('xai-grok-imagine');
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
    id: 'xai-grok-imagine', name: 'xAI Grok Imagine media provider', sdkRange: '^0.1.0 || ^1.0.0', engine: 1, tier: 'tier-3',
    extensions: { jini: { id: 'jini/xai-grok-imagine' } }, capabilities: ['providers.register'], hooks: [], fields: [], integrity: {},
    contributes: { providers: [{ contract: 'media', id: 'xai_grok_imagine', contractVersion: 1, settings: [] }] },
  });
});

it('packages exactly the manifest and compiled media subpaths, built into the distribution', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  expect(pkg.exports['./xai-grok-imagine']).toBe(`./plugins/xai-grok-imagine/${pkg.version}/jini.plugin.json`);
  expect(pkg.exports['./xai-grok-imagine/media']).toEqual({ types: './dist/xai-grok-imagine/media.d.ts', import: './dist/xai-grok-imagine/media.js' });
  expect(pkg.exports['./xai-grok-imagine/*']).toBe('./plugins/xai-grok-imagine/*');
  expect(pkg.jini.entries).toMatchObject({ './xai-grok-imagine': 'node', './xai-grok-imagine/media': 'node', './xai-grok-imagine/*': 'node' });
  expect(pkg.files).toEqual(expect.arrayContaining(['dist/xai-grok-imagine', 'plugins/xai-grok-imagine']));
  expect(pkg.scripts.build).toContain('scripts/build.ts xai-grok-imagine .');
});
