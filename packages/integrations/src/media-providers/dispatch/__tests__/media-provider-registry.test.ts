import { describe, expect, it } from 'vitest';
import { ProviderRegistryError } from '@jini-ai/core/provider-registry';
import { AUDIO_MODELS_BY_KIND, IMAGE_MODELS, MEDIA_PROVIDERS, VIDEO_MODELS, findMediaModel, findProvider, modelsForSurface } from '../../providers.js';
import type { AudioKind, MediaSurface } from '../../types.js';
import { createMediaDispatchEngine } from '../engine.js';
import {
  builtinMediaProviderContributions, createMediaProviderRegistry, MEDIA_PROVIDER_CONTRACT, mediaProviderDefinition, mediaProviderRegistryId,
  type MediaProviderContribution,
} from '../media-provider-registry.js';
import type { VendorAdapter } from '../types.js';
import { createBuiltinVendorAdapterRegistry } from '../vendor-registry.js';
import { testHttpClient } from './outbound-fixtures.js';

const fakeAdapter = (note = 'acme'): VendorAdapter<never> => ({
  buildRequest: () => ({ url: 'https://api.acme.test/v1/images', init: { method: 'POST' }, meta: undefined as never }),
  parseResponse: async ({ resp }) => ({ bytes: Buffer.from(await resp.text()), providerNote: note }),
});

function acme(overrides: Partial<MediaProviderContribution> = {}): MediaProviderContribution {
  return {
    provider: { id: 'acme-media', label: 'Acme', hint: 'plugin vendor', integrated: true },
    models: [{ id: 'acme-1', label: 'acme-1', hint: '', provider: 'acme-media', caps: ['t2i'], surface: 'image' }],
    adapters: { image: fakeAdapter() },
    ...overrides,
  };
}

const SURFACES: { surface: MediaSurface; audioKind?: AudioKind }[] = [
  { surface: 'image' }, { surface: 'video' }, { surface: 'audio' },
  { surface: 'audio', audioKind: 'music' }, { surface: 'audio', audioKind: 'speech' }, { surface: 'audio', audioKind: 'sfx' },
];

describe('builtin contribution = today\'s catalogue', () => {
  const registry = createMediaProviderRegistry();

  it('lists every MEDIA_PROVIDERS entry in order, keyed by the hyphen-free registry id', () => {
    expect(registry.listProviders()).toEqual(MEDIA_PROVIDERS);
    expect(registry.providers.contract).toBe(MEDIA_PROVIDER_CONTRACT);
    expect(registry.providers.has({ id: 'custom_image' })).toBe(true);
    expect(registry.providers.list().map(entry => entry.origin)).toEqual(MEDIA_PROVIDERS.map(() => 'core'));
  });

  it('modelsForSurface matches the static catalogue exactly (same order, same shape)', () => {
    for (const { surface, audioKind } of SURFACES) {
      expect(registry.modelsForSurface({ surface }, { audioKind })).toEqual(modelsForSurface({ surface }, { audioKind }));
    }
  });

  it('findModel / findProvider match the static functions, aliases included', () => {
    const ids = [...IMAGE_MODELS, ...VIDEO_MODELS, ...Object.values(AUDIO_MODELS_BY_KIND).flat()].map(model => model.id);
    for (const id of [...ids, 'missing-model']) expect(registry.findModel({ id })).toEqual(findMediaModel({ id }));
    for (const id of [...MEDIA_PROVIDERS.map(provider => provider.id), 'custom-image-api', 'nope']) {
      expect(registry.findProvider({ id })).toEqual(findProvider({ id }));
    }
  });

  it('serves exactly the adapters the legacy builtin registry serves', () => {
    const legacy = createBuiltinVendorAdapterRegistry();
    for (const [providerId, routeKey] of legacy.list()) {
      expect(registry.get({ providerId, routeKey })).toBe(legacy.get({ providerId, routeKey }));
    }
    const served = registry.providers.list().flatMap(entry => Object.keys(entry.provider.adapters).map(routeKey => [entry.provider.provider.id, routeKey]));
    expect(served).toHaveLength(legacy.list().length);
    expect(registry.get({ providerId: 'bfl', routeKey: 'image' })).toBeUndefined();
    expect(registry.get({ providerId: 'unknown', routeKey: 'image' })).toBeUndefined();
  });

  it('no two builtin ids collapse to the same registry id', () => {
    const keys = MEDIA_PROVIDERS.map(provider => mediaProviderRegistryId({ id: provider.id }));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('each call builds fresh contributions', () => {
    expect(builtinMediaProviderContributions()).not.toBe(builtinMediaProviderContributions());
  });
});

describe('mediaProviderRegistryId / mediaProviderDefinition', () => {
  it('canonicalises aliases and maps hyphens to underscores', () => {
    expect(mediaProviderRegistryId({ id: 'custom-image-api' })).toBe('custom_image');
    expect(mediaProviderRegistryId({ id: 'openai' })).toBe('openai');
  });

  it('carries the public label and the whole unit', () => {
    const contribution = acme();
    expect(mediaProviderDefinition({ contribution })).toEqual({ id: 'acme_media', provider: contribution, label: 'Acme' });
  });
});

describe('plugin contributions', () => {
  it('a contributed vendor is visible to lookups, after the builtins', () => {
    const registry = createMediaProviderRegistry();
    const contribution = acme();
    expect(registry.providers.contribute({ definition: mediaProviderDefinition({ contribution }), pluginId: 'acme-plugin' })).toBe(true);
    expect(registry.findProvider({ id: 'acme-media' })).toBe(contribution.provider);
    expect(registry.findModel({ id: 'acme-1' })).toEqual({ id: 'acme-1', label: 'acme-1', hint: '', provider: 'acme-media', caps: ['t2i'] });
    expect(registry.modelsForSurface({ surface: 'image' }).at(-1)?.id).toBe('acme-1');
    expect(registry.get({ providerId: 'acme-media', routeKey: 'image' })).toBe(contribution.adapters.image);
    expect(registry.listProviders().at(-1)).toBe(contribution.provider);
  });

  it('unordered plugin models keep their registration order', () => {
    const model = (id: string) => ({ id, label: id, hint: '', provider: 'acme-media', caps: ['t2i'], surface: 'image' as const });
    const registry = createMediaProviderRegistry();
    registry.providers.contribute({ definition: mediaProviderDefinition({ contribution: acme({ models: [model('z-first'), model('a-second')] }) }), pluginId: 'p' });
    expect(registry.modelsForSurface({ surface: 'image' }).slice(-2).map(entry => entry.id)).toEqual(['z-first', 'a-second']);
  });

  it('audio models default to the music kind when no audioKind is given', () => {
    const contribution = acme({ models: [{ id: 'acme-song', label: 's', hint: '', provider: 'acme-media', caps: ['music'], surface: 'audio' }], adapters: {} });
    const registry = createMediaProviderRegistry({}, { contributions: [contribution] });
    expect(registry.modelsForSurface({ surface: 'audio' }).map(model => model.id)).toEqual(['acme-song']);
    expect(registry.modelsForSurface({ surface: 'audio' }, { audioKind: 'speech' })).toEqual([]);
  });

  it.each([
    ['provider without a label', acme({ provider: { id: 'acme-media', label: ' ', hint: '', integrated: true } }), 'non-empty label'],
    ['a null contribution', null as unknown as MediaProviderContribution, 'non-empty label'],
    ['a missing provider', { models: [], adapters: {} } as unknown as MediaProviderContribution, 'non-empty label'],
    ['models that are not an array', acme({ models: 'x' as never }), 'models must be an array'],
    ['a model of another provider', acme({ models: [{ id: 'm', label: 'm', hint: '', provider: 'openai', caps: [], surface: 'image' }] }), "belong to provider 'acme-media'"],
    ['a model without an id', acme({ models: [{ id: '', label: 'm', hint: '', provider: 'acme-media', caps: [], surface: 'image' }] }), 'must have an id'],
    ['adapters that are not an object', acme({ adapters: null as never }), 'adapters must be an object'],
    ['a broken adapter', acme({ adapters: { image: { buildRequest: () => ({}) } as never } }), "route 'image'"],
    ['a model id another provider offers on the same route', acme({ models: [{ id: 'gpt-image-2', label: 'x', hint: '', provider: 'acme-media', caps: [], surface: 'image' }] }), "'gpt-image-2' is already offered"],
  ])('refuses %s without throwing', (_name, contribution, reason) => {
    const registry = createMediaProviderRegistry();
    const definition = { ...mediaProviderDefinition({ contribution: acme() }), provider: contribution };
    expect(registry.providers.contribute({ definition, pluginId: 'p' })).toBe(false);
    expect(registry.providers.refusals()[0]?.message).toContain(reason);
  });

  it('a plugin cannot take over a builtin vendor id', () => {
    const registry = createMediaProviderRegistry();
    const contribution = acme({ provider: { id: 'openai', label: 'Fake', hint: '', integrated: true }, models: [] });
    expect(registry.providers.contribute({ definition: mediaProviderDefinition({ contribution }), pluginId: 'p' })).toBe(false);
    expect(registry.providers.refusals()[0]?.code).toBe('duplicate');
    expect(registry.findProvider({ id: 'openai' })?.label).toBe('OpenAI');
  });

  // Why refused rather than allowed per route: `findModel` resolves by id alone, so a second vendor's
  // `gpt-image-2` on video would dispatch to OpenAI (and a plugin `order: -1` would reverse that).
  it.each([
    ['without an order', {}],
    ['sorted ahead of the builtins', { order: -1 }],
  ])('refuses a model id another provider owns on a different route (%s), and dispatch still routes by owner', async (_name, extra) => {
    const registry = createMediaProviderRegistry();
    const contribution = acme({ models: [{ id: 'gpt-image-2', label: 'v', hint: '', provider: 'acme-media', caps: ['t2v'], surface: 'video', ...extra }], adapters: { video: fakeAdapter() } });
    expect(registry.providers.contribute({ definition: mediaProviderDefinition({ contribution }), pluginId: 'p' })).toBe(false);
    expect(registry.providers.refusals()[0]?.message).toContain("'gpt-image-2' is already offered");
    expect(registry.findModel({ id: 'gpt-image-2' })?.provider).toBe('openai');
    const engine = createMediaDispatchEngine({ registry, httpClient: testHttpClient(async () => new Response('x')) }, { catalog: registry, allowStubFallback: true });
    await expect(engine.generate({ surface: 'video', model: 'gpt-image-2' }, { prompt: 'p' })).rejects.toThrow('is not registered for surface "video"');
  });

  it('one provider may offer the same model id on several routes', () => {
    const model = (surface: 'image' | 'video') => ({ id: 'acme-both', label: 'b', hint: '', provider: 'acme-media', caps: [], surface });
    const registry = createMediaProviderRegistry();
    const contribution = acme({ models: [model('image'), model('video')] });
    expect(registry.providers.contribute({ definition: mediaProviderDefinition({ contribution }), pluginId: 'p' })).toBe(true);
    expect(registry.modelsForSurface({ surface: 'video' }).at(-1)?.id).toBe('acme-both');
  });

  it.each([
    ['an undefined model', [undefined]],
    ['a null model after a valid one', [{ id: 'acme-ok', label: 'o', hint: '', provider: 'acme-media', caps: [], surface: 'image' }, null]],
  ])('refuses %s without throwing, and later valid contributions still load', (_name, models) => {
    const registry = createMediaProviderRegistry();
    const broken = acme({ models: models as never });
    expect(() => registry.providers.contribute({ definition: mediaProviderDefinition({ contribution: broken }), pluginId: 'bad' })).not.toThrow();
    expect(registry.providers.refusals()[0]?.message).toContain("must have an id and belong to provider 'acme-media'");
    const valid = acme({ provider: { id: 'beta-media', label: 'Beta', hint: '', integrated: true }, models: [{ id: 'beta-1', label: 'b', hint: '', provider: 'beta-media', caps: [], surface: 'image' }] });
    expect(registry.providers.contribute({ definition: mediaProviderDefinition({ contribution: valid }), pluginId: 'good' })).toBe(true);
    expect(registry.findModel({ id: 'beta-1' })?.provider).toBe('beta-media');
  });

  it('a malformed core contribution throws at composition', () => {
    expect(() => createMediaProviderRegistry({}, { contributions: [acme({ models: 'x' as never })] })).toThrow(ProviderRegistryError);
  });
});

describe('engine over the live registry', () => {
  it('generates with a plugin-contributed model end to end', async () => {
    const registry = createMediaProviderRegistry();
    registry.providers.contribute({ definition: mediaProviderDefinition({ contribution: acme() }), pluginId: 'acme-plugin' });
    const httpClient = testHttpClient(async () => new Response('PNGBYTES'));
    const engine = createMediaDispatchEngine({ registry, httpClient }, { catalog: registry });
    const result = await engine.generate({ surface: 'image', model: 'acme-1' }, { prompt: 'a cat' });
    expect(result).toMatchObject({ providerId: 'acme-media', usedStubFallback: false, providerNote: 'acme' });
    expect(result.bytes.toString()).toBe('PNGBYTES');
  });

  it('passes the host egress option through to the plugin adapter context', async () => {
    const seen: unknown[] = [];
    const adapter: VendorAdapter<never> = { ...fakeAdapter(), buildRequest: ({ ctx }) => { seen.push(ctx.allowPrivateNetwork); return fakeAdapter().buildRequest({ ctx, credentials: {} }); } };
    const registry = createMediaProviderRegistry({}, { contributions: [acme({ adapters: { image: adapter } })] });
    const engine = createMediaDispatchEngine({ registry, httpClient: testHttpClient(async () => new Response('x')) }, { catalog: registry, allowPrivateNetwork: true });
    await engine.generate({ surface: 'image', model: 'acme-1' }, { prompt: 'p' });
    expect(seen).toEqual([true]);
  });

  it('stub fallback reads the provider from the live catalogue', async () => {
    const registry = createMediaProviderRegistry();
    registry.providers.contribute({ definition: mediaProviderDefinition({ contribution: acme({ adapters: {} }) }), pluginId: 'acme-plugin' });
    const engine = createMediaDispatchEngine({ registry, httpClient: testHttpClient(async () => new Response('')) }, { catalog: registry, allowStubFallback: true });
    const result = await engine.generate({ surface: 'image', model: 'acme-1' }, { prompt: 'a cat' });
    expect(result).toMatchObject({ providerId: 'acme-media', usedStubFallback: true });
  });

  it('without a catalog option the engine still rejects models outside the static catalogue', async () => {
    const registry = createMediaProviderRegistry();
    registry.providers.contribute({ definition: mediaProviderDefinition({ contribution: acme() }), pluginId: 'acme-plugin' });
    const engine = createMediaDispatchEngine({ registry, httpClient: testHttpClient(async () => new Response('')) });
    await expect(engine.generate({ surface: 'image', model: 'acme-1' })).rejects.toThrow('unknown model: acme-1');
  });
});
