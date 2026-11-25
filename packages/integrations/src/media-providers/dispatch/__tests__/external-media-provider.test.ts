import { afterEach, describe, expect, it, vi } from 'vitest';
import { partitionArgs } from '../../../args.js';
import { canonicalMediaProviderId, normalizeMediaProviderMap, PROVIDER_CREDENTIAL_ENV_VARS, VENDOR_API_BASE_URLS, MEDIA_PROVIDER_ID_ALIASES } from '../../providers.js';
import { resolveProviderCredentialsFromEnv } from '../credentials.js';
import { createMediaDispatchEngine } from '../engine.js';
import { createMediaProviderRegistry, builtinMediaProviderContributions } from '../media-provider-registry.js';
import { createMediaWire } from '../media-wire.js';
import { createNodeMediaHttpClient, nodeMediaGuardedFetch } from '../node.js';
import type { MediaProviderContribution as CoreContribution, MediaVendorAdapter } from '@jini-ai/core/contracts/site/media-provider-contribution';
import type { MediaGenerationRequest } from '../types.js';

afterEach(() => { vi.unstubAllGlobals(); });

const wire = createMediaWire();
type Meta = { wireModel: string };
const speechMeta = { errorTag: 'fake tts', zeroBytesMessage: 'fake tts had zero bytes', suggestedExt: '.mp3', note: ({ bytes }: { bytes: Buffer }) => `fake · ${bytes.length} bytes` };

/** A host-side stand-in for a plugin's contribution: same ids and routes the retired built-in vendor had, fake wire logic. */
function injectedContribution(): CoreContribution {
  const image: MediaVendorAdapter<Meta> = {
    requireCredential: wire.requireApiKey({ message: 'no credential for the injected vendor' }),
    buildRequest: ({ ctx, credentials }) => ({ url: wire.imageGenerationUrl({ baseUrl: (credentials.baseUrl ?? 'https://media.example/v1').replace(/\/$/, '') }), init: wire.jsonPostInit({ ctx, body: { model: ctx.wireModel } }, { apiKey: credentials.apiKey! }), meta: { wireModel: ctx.wireModel } }),
    parseResponse: async ({ resp, ctx, request }) => {
      const bytes = await wire.imageBytesFromData({ data: await wire.parseJson({ resp, providerTag: 'fake image' }), providerTag: 'fake image', ctx });
      return { bytes, providerNote: `fake/${request.meta.wireModel}`, suggestedExt: wire.sniffImageExt({ bytes }) };
    },
  };
  const speech: MediaVendorAdapter<Meta> = {
    requireCredential: wire.requireApiKey({ message: 'no credential for the injected vendor' }),
    buildRequest: ({ ctx, credentials }) => ({ url: `${credentials.baseUrl ?? 'https://media.example/v1'}/tts`, init: wire.jsonPostInit({ ctx, body: { text: ctx.prompt } }, { apiKey: credentials.apiKey! }), meta: { wireModel: ctx.wireModel } }),
    parseResponse: wire.createRawBytesParser<Meta>(speechMeta),
  };
  return {
    provider: { id: 'xai-grok-imagine', label: 'Injected media vendor', hint: '', integrated: true },
    models: [
      { id: 'grok-imagine-image', label: 'grok-imagine-image', hint: '', provider: 'xai-grok-imagine', caps: ['t2i'], surface: 'image' },
      { id: 'grok-imagine-video', label: 'grok-imagine-video', hint: '', provider: 'xai-grok-imagine', caps: ['t2v'], surface: 'video' },
      { id: 'grok-tts', label: 'grok-tts', hint: '', provider: 'xai-grok-imagine', caps: ['tts'], surface: 'audio', audioKind: 'speech' },
    ],
    adapters: { image: image as MediaVendorAdapter<never>, 'audio:speech': speech as MediaVendorAdapter<never> },
  };
}

const request = (value: MediaGenerationRequest) => partitionArgs({ value, requiredKeys: ['surface', 'model'] });
const engineFor = (registry: ReturnType<typeof createMediaProviderRegistry>, credentials: Record<string, { apiKey: string }>) =>
  createMediaDispatchEngine({ registry, httpClient: createNodeMediaHttpClient({}), guardedFetch: nodeMediaGuardedFetch }, { credentials, catalog: registry });

describe('xAI media is absent without the plugin and preserves image and TTS dispatch when injected', () => {
  it('has no xAI provider, model or adapter route in the built-in set', () => {
    const registry = createMediaProviderRegistry();
    expect(registry.listProviders().map(provider => provider.id)).not.toEqual(expect.arrayContaining(['grok']));
    expect(registry.listProviders().some(provider => /^(grok|xai)/.test(provider.id))).toBe(false);
    for (const id of ['grok-imagine-image', 'grok-imagine-video', 'grok-tts']) expect(registry.findModel({ id })).toBeNull();
    for (const providerId of ['grok', 'xai-grok-imagine']) for (const routeKey of ['image', 'audio:speech']) expect(registry.get({ providerId, routeKey })).toBeUndefined();
  });

  it('routes image and speech to the injected contribution with the credentials saved under its id', async () => {
    const registry = createMediaProviderRegistry({}, { contributions: [...builtinMediaProviderContributions(), injectedContribution() as never] });
    const fetchMock = vi.fn(async (url: string) => (url.endsWith('/tts')
      ? new Response(Buffer.from('audio'))
      : new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }))));
    vi.stubGlobal('fetch', fetchMock);
    const engine = engineFor(registry, { 'xai-grok-imagine': { apiKey: 'k' } });
    const image = await engine.generate(...request({ surface: 'image', model: 'grok-imagine-image' }));
    expect(image).toMatchObject({ providerId: 'xai-grok-imagine' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://media.example/v1/images/generations');
    const speech = await engine.generate(...request({ surface: 'audio', audioKind: 'speech', model: 'grok-tts' }));
    expect(speech.providerId).toBe('xai-grok-imagine');
    expect(speech.bytes.toString('utf8')).toBe('audio');
  });

  it('refuses the same request with no injected contribution rather than falling back to a built-in', async () => {
    const engine = engineFor(createMediaProviderRegistry(), { 'xai-grok-imagine': { apiKey: 'k' } });
    await expect(engine.generate(...request({ surface: 'image', model: 'grok-imagine-image' }))).rejects.toThrow();
  });

  it('resolves a legacy provider id only through an alias the host injected', () => {
    const registry = createMediaProviderRegistry({}, { contributions: [...builtinMediaProviderContributions(), injectedContribution() as never], aliases: { grok: 'xai-grok-imagine' } });
    expect(registry.findProvider({ id: 'grok' })?.id).toBe('xai-grok-imagine');
    expect(createMediaProviderRegistry({}, { contributions: [...builtinMediaProviderContributions(), injectedContribution() as never] }).findProvider({ id: 'grok' })).toBeNull();
    expect(normalizeMediaProviderMap({ providers: { grok: { apiKey: 'old' } } }, { aliases: { grok: 'xai-grok-imagine' } })).toEqual({ 'xai-grok-imagine': { apiKey: 'old' } });
  });
});

describe('ImageRouter routed xAI video is not claimed by the plugin', () => {
  it('keeps the routed xAI video row owned by ImageRouter beside an injected contribution of the same family', () => {
    const registry = createMediaProviderRegistry({}, { contributions: [...builtinMediaProviderContributions(), injectedContribution() as never] });
    expect(registry.findModel({ id: 'xAI/grok-imagine-video' })).toMatchObject({ provider: 'imagerouter' });
    expect(registry.findModel({ id: 'grok-imagine-video' })).toMatchObject({ provider: 'xai-grok-imagine' });
    expect(createMediaProviderRegistry().findModel({ id: 'xAI/grok-imagine-video' })).toMatchObject({ provider: 'imagerouter' });
  });
});

describe('the built-in URL, reverse alias and env-key row are gone', () => {
  it('has no built-in xAI base URL, reverse alias or environment key row', () => {
    expect(Object.keys(VENDOR_API_BASE_URLS)).not.toContain('grok');
    expect(Object.values(MEDIA_PROVIDER_ID_ALIASES)).not.toContain('grok');
    expect(canonicalMediaProviderId({ id: 'xai-grok-imagine' })).toBe('xai-grok-imagine');
    expect(Object.keys(PROVIDER_CREDENTIAL_ENV_VARS)).not.toContain('grok');
    expect(resolveProviderCredentialsFromEnv({ providerId: 'xai-grok-imagine', env: { XAI_API_KEY: 'k' } })).toEqual({});
  });
  it('reads an environment key only from the table the host injects', () => {
    expect(resolveProviderCredentialsFromEnv({ providerId: 'xai-grok-imagine', env: { XAI_API_KEY: ' k ' } }, { envVars: { 'xai-grok-imagine': ['XAI_API_KEY'] } })).toEqual({ apiKey: 'k' });
    expect(resolveProviderCredentialsFromEnv({ providerId: 'grok', env: { XAI_API_KEY: 'k' } }, { envVars: { 'xai-grok-imagine': ['XAI_API_KEY'] }, aliases: { grok: 'xai-grok-imagine' } })).toEqual({ apiKey: 'k' });
  });
});

vi.mock('@jini-ai/platform/http/guarded', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  const { testNodeGuardedHttpPorts } = await import('./outbound-fixtures.js');
  return { ...original, createNodeGuardedHttpPorts: testNodeGuardedHttpPorts };
});
