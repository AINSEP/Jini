/**
 * Pin (K05): the xAI media contribution works through the media dispatch engine for image generation and
 * TTS with synthetic credentials, refuses an unsupported route, never echoes the credential in a failure,
 * and exists in the engine ONLY when the host-injected registry contains it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  builtinMediaProviderContributions, createMediaDispatchEngine, createMediaProviderRegistry,
} from '@jini-ai/integrations/media-providers';
import { nodeMediaGuardedFetch } from '@jini-ai/integrations/media-providers/node';
import { XAI_MEDIA_PROVIDER_ALIASES, XAI_MEDIA_PROVIDER_ID, createXaiMediaContribution } from '../index.js';
import { realWire, testHttpClient } from './fixtures.js';

const SYNTHETIC_KEY = 'xai-synthetic-credential-0000';
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function engineWith({ fetchImpl, withXai = true, credentials = { grok: { apiKey: SYNTHETIC_KEY } } }: { fetchImpl: Fetch; withXai?: boolean; credentials?: Record<string, { apiKey: string }> }) {
  const contributions = [...builtinMediaProviderContributions(), ...(withXai ? [createXaiMediaContribution({ mediaWire: realWire }) as never] : [])];
  const registry = createMediaProviderRegistry({}, { contributions, aliases: XAI_MEDIA_PROVIDER_ALIASES });
  return createMediaDispatchEngine(
    { registry, httpClient: testHttpClient(fetchImpl), guardedFetch: nodeMediaGuardedFetch },
    { credentials, catalog: registry },
  );
}

describe('xai media contribution through the dispatch engine', () => {
  it('generates an image with the provider id, wire note and sniffed extension', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const fetchImpl = vi.fn<Fetch>(async (_url, init) => {
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${SYNTHETIC_KEY}`);
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 });
    });
    const result = await engineWith({ fetchImpl }).generate({ surface: 'image', model: 'grok-imagine-image' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.x.ai/v1/images/generations');
    expect(result).toMatchObject({ providerId: XAI_MEDIA_PROVIDER_ID, usedStubFallback: false, suggestedExt: '.png' });
    expect(result.providerNote).toContain('grok/grok-imagine-image');
  });

  it('synthesizes speech as mp3 bytes', async () => {
    const fetchImpl = vi.fn<Fetch>(async () => new Response(Buffer.from('audio'), { status: 200 }));
    const result = await engineWith({ fetchImpl }).generate({ surface: 'audio', model: 'grok-tts' }, { audioKind: 'speech' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.x.ai/v1/tts');
    expect(result).toMatchObject({ providerId: 'grok', suggestedExt: '.mp3', usedStubFallback: false });
  });

  it('rejects an unsupported route (grok video has no adapter) without calling the network', async () => {
    const fetchImpl = vi.fn<Fetch>();
    await expect(engineWith({ fetchImpl }).generate({ surface: 'video', model: 'grok-imagine-video' }))
      .rejects.toThrow('no renderer configured for provider "grok" / surface "video"');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails with a status-tagged error that does not echo the credential', async () => {
    const failure = await engineWith({ fetchImpl: async () => new Response('unauthorized', { status: 401 }) })
      .generate({ surface: 'image', model: 'grok-imagine-image' }).catch((error: Error) => error);
    expect((failure as Error).message).toMatch(/grok image 401/);
    expect((failure as Error).message).not.toContain(SYNTHETIC_KEY);
  });

  it('names no credential value when the credential is missing', async () => {
    const engine = engineWith({ fetchImpl: vi.fn<Fetch>(), credentials: {} });
    const failure = await engine.generate({ surface: 'image', model: 'grok-imagine-image' }).catch((error: Error) => error);
    expect((failure as Error).message).toMatch(/no xAI credential/);
  });
});

describe('xai media availability follows the injected registry', () => {
  it('has no Grok provider, model or route unless the host contributes it', async () => {
    const fetchImpl = vi.fn<Fetch>();
    const without = createMediaProviderRegistry();
    expect(without.findProvider({ id: 'grok' })).toBeNull();
    expect(without.findModel({ id: 'grok-imagine-image' })).toBeNull();
    await expect(engineWith({ fetchImpl, withXai: false }).generate({ surface: 'image', model: 'grok-imagine-image' })).rejects.toThrow(/unknown model: grok-imagine-image/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the catalogue ids and the alias-resolved registry key once contributed', () => {
    // The old UI id resolves through the host-injected alias the plugin exports, not a vendor row in the engine's table.
    const registry = createMediaProviderRegistry({}, { contributions: [...builtinMediaProviderContributions(), createXaiMediaContribution({ mediaWire: realWire }) as never], aliases: XAI_MEDIA_PROVIDER_ALIASES });
    expect(registry.findProvider({ id: 'xai-grok-imagine' })?.id).toBe('grok');
    expect(registry.modelsForSurface({ surface: 'image' }).some(model => model.id === 'grok-imagine-image')).toBe(true);
    expect(registry.modelsForSurface({ surface: 'audio' }, { audioKind: 'speech' }).some(model => model.id === 'grok-tts')).toBe(true);
    expect(registry.get({ providerId: 'grok', routeKey: 'image' })).toBeDefined();
    expect(registry.get({ providerId: 'grok', routeKey: 'audio:speech' })).toBeDefined();
    expect(registry.get({ providerId: 'grok', routeKey: 'video' })).toBeUndefined();
  });
});
