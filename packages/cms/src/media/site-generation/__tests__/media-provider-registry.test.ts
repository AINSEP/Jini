import { expect, it, vi } from 'vitest';
import { createProviderRegistry } from '@jini-ai/core/provider-registry';
import {
  loadMediaProviderRegistry, parseMediaProvidersFile,
  type LoadedMediaProviderItem, type MediaProviderContributionShape,
  type MediaProviderContributionSpec, type MediaProviderContributionSpecOptional,
  type MediaProviderRegistryContributionPorts,
} from '../media-provider-registry.js';

const entry = { id: 'studio_one', module: './studio.mjs', label: 'Studio One' };
const manifest = (providers: unknown) => JSON.stringify({ schemaVersion: 1, providers });

it('keeps provider order, module paths and optional labels from the host manifest', () => {
  expect(parseMediaProvidersFile({ raw: manifest([{ ...entry, ignored: 'metadata' }, { id: 'second', module: 'vendors/second.mjs' }]) })).toEqual({
    ok: true, descriptors: [entry, { id: 'second', module: 'vendors/second.mjs' }],
  });
});

const invalidManifests: Array<[string, string]> = [
  ['{not-json', 'not valid JSON'],
  ['null', 'schemaVersion must be 1'],
  ['[]', 'schemaVersion must be 1'],
  ['{"schemaVersion":2,"providers":[]}', 'schemaVersion must be 1'],
  [manifest({}), 'providers must be an array'],
  [manifest([entry, null]), 'providers[1] must be an object'],
  [manifest([entry, { ...entry, id: 42 }]), 'providers[1].id must be a string'],
  [manifest([entry, { id: 'other', module: 42 }]), 'providers[1].module must be a relative path ending in .mjs'],
  [manifest([entry, { id: 'other', module: './other.js' }]), 'providers[1].module must be a relative path ending in .mjs'],
  [manifest([entry, { id: 'other', module: '/other.mjs' }]), 'providers[1].module must be a relative path ending in .mjs'],
  [manifest([entry, { id: 'other', module: './other.mjs', label: 12 }]), 'providers[1].label must be a non-empty string when present'],
  [manifest([entry, { id: 'other', module: './other.mjs', label: '  ' }]), 'providers[1].label must be a non-empty string when present'],
  [manifest([entry, { ...entry, module: './different.mjs' }]), "providers[1].id 'studio_one' is declared twice"],
];

it.each(invalidManifests)('refuses the malformed manifest %s with the exact reason', (raw, reason) => {
  expect(parseMediaProvidersFile({ raw })).toEqual({ ok: false, reason });
});

type Contribution = MediaProviderContributionShape;
type Definition = { spec: MediaProviderContributionSpec<Contribution>; optional: MediaProviderContributionSpecOptional };
const contract = 'media-generator';
const filename = 'site-media-providers.json';
const workspaceId = 'west';
const core = { id: 'builtin', provider: { provider: { id: 'builtin', label: 'Built-in' } } };

function fixture() {
  const createRegistry = () => ({ providers: createProviderRegistry<Contribution>({ contract }, { seed: [core] }) });
  const defineProviderContribution = (spec: Definition['spec'], optional: Definition['optional']): Definition => ({ spec, optional });
  const contributeProviders = vi.fn<MediaProviderRegistryContributionPorts<Contribution>['contributeProviders']>(({ registry, loaded }) => {
    const before = registry.refusals().length;
    for (const item of loaded.items) {
      if (item.pluginId === 'faulty-registry-plugin') throw new Error('internal registry fault');
      registry.contribute(item);
    }
    return { refusals: [...loaded.refusals, ...registry.refusals().slice(before).map(refusal => refusal.message)] };
  });
  return { contract, filename, workspaceId, createRegistry, defineProviderContribution, contributeProviders,
    registryId: ({ id }: { id: string }) => id.replaceAll('-', '_') };
}

function item(id: string, pluginId: string, publicId: string, label?: string): LoadedMediaProviderItem<Contribution> {
  return { contract, pluginId, definition: { id, provider: { provider: { id: publicId, label: `Vendor ${publicId}` } },
    ...(label === undefined ? {} : { label }) } };
}

it('binds parser and validator to a scoped contribution load and keeps good plugins after individual refusals', async () => {
  const deps = fixture();
  const loadContributions = vi.fn(async ({ workspaceId: scope, definition }: { workspaceId: string; definition: Definition },
    options: { orderByPluginId: boolean }) => {
    expect([scope, options, definition.spec.contract, definition.spec.filename]).toEqual([workspaceId, { orderByPluginId: true }, contract, filename]);
    expect(definition.spec.parse({ raw: manifest([entry]) })).toEqual({ ok: true, descriptors: [entry] });
    const valid = { provider: { id: 'studio-one', label: 'Studio' } };
    expect(definition.spec.validate({ exported: valid })).toBe(valid);
    for (const invalid of [null, {}, { provider: [] }, { provider: { id: 7 } }]) {
      expect(definition.spec.validate({ exported: invalid })).toBe('its module must export { provider, models, adapters }');
    }
    expect(definition.optional.importErrorReason).toBe('module could not be read or imported');
    return {
      items: [
        item('studio_one', 'plugin-a', 'studio-one', 'Manifest label'),
        item('mismatch', 'plugin-b', 'actual-id'),
        item('broken', 'faulty-registry-plugin', 'broken'),
        item('builtin', 'plugin-c', 'builtin'),
        item('another', 'plugin-d', 'another'),
      ],
      refusals: definition.optional.onReadError({ plugin: { pluginId: 'unreadable' } }),
    };
  });
  const loaded = await loadMediaProviderRegistry({ ...deps, loadContributions });
  expect(loaded.registry.providers.list().map(({ id, origin, label }) => [id, origin, label])).toEqual([
    ['builtin', 'core', undefined], ['studio_one', 'plugin', 'Manifest label'], ['another', 'plugin', 'Vendor another'],
  ]);
  expect(loaded.refusals).toEqual([
    "media providers from 'unreadable' were not loaded: site-media-providers.json could not be read",
    "media provider 'mismatch' from 'plugin-b' was not loaded: its module exports provider 'actual-id' (registry id 'actual_id')",
    "media provider 'broken' from 'faulty-registry-plugin' was not loaded: its contribution could not be registered",
    "media-generator provider 'builtin' from plugin 'plugin-c' was not loaded: already registered by the built-in provider",
  ]);
});

it('keeps built-ins usable when contribution discovery is unavailable', async () => {
  const deps = fixture();
  const result = await loadMediaProviderRegistry({
    ...deps, loadContributions: async () => { throw new Error('plugin directory unavailable'); },
  });
  expect(result.refusals).toEqual(['plugin media providers were not loaded: plugin directory unavailable']);
  expect(result.registry.providers.get({ id: 'builtin' })).toEqual({ ...core, origin: 'core' });
  expect(deps.contributeProviders.mock.calls).toEqual([]);
});
