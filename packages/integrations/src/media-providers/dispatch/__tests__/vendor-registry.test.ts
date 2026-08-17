import { describe, expect, it } from 'vitest';
import { createVendorAdapterRegistry, mediaVendorRegistry } from '../vendor-registry.js';
import type { VendorAdapter } from '../vendor-adapter.js';

function fakeAdapter(): VendorAdapter {
  return {
    buildRequest: () => ({ url: 'https://example.com', init: {}, meta: undefined }),
    parseResponse: async () => ({ bytes: Buffer.alloc(0), providerNote: '' }),
  };
}

describe('VendorAdapterRegistry', () => {
  it('register() then get() returns the same adapter instance', () => {
    const registry = createVendorAdapterRegistry();
    const adapter = fakeAdapter();
    registry.register('acme', 'image', adapter);
    expect(registry.get('acme', 'image')).toBe(adapter);
  });

  it('get() returns undefined for an unregistered providerId', () => {
    const registry = createVendorAdapterRegistry();
    expect(registry.get('nope', 'image')).toBeUndefined();
  });

  it('get() returns undefined for a known providerId but unregistered routeKey', () => {
    const registry = createVendorAdapterRegistry();
    registry.register('acme', 'image', fakeAdapter());
    expect(registry.get('acme', 'audio:speech')).toBeUndefined();
  });

  it('has() reflects registration state', () => {
    const registry = createVendorAdapterRegistry();
    expect(registry.has('acme', 'image')).toBe(false);
    registry.register('acme', 'image', fakeAdapter());
    expect(registry.has('acme', 'image')).toBe(true);
  });

  it('supports multiple routeKeys for the same providerId', () => {
    const registry = createVendorAdapterRegistry();
    const imageAdapter = fakeAdapter();
    const speechAdapter = fakeAdapter();
    registry.register('acme', 'image', imageAdapter);
    registry.register('acme', 'audio:speech', speechAdapter);
    expect(registry.get('acme', 'image')).toBe(imageAdapter);
    expect(registry.get('acme', 'audio:speech')).toBe(speechAdapter);
  });

  it('throws when the same (providerId, routeKey) is registered twice', () => {
    const registry = createVendorAdapterRegistry();
    registry.register('acme', 'image', fakeAdapter());
    expect(() => registry.register('acme', 'image', fakeAdapter())).toThrow(/already registered/);
  });

  it('list() enumerates every registered (providerId, routeKey) pair', () => {
    const registry = createVendorAdapterRegistry();
    registry.register('acme', 'image', fakeAdapter());
    registry.register('acme', 'audio:speech', fakeAdapter());
    registry.register('other', 'video', fakeAdapter());
    const pairs = registry.list().map(([providerId, routeKey]) => `${providerId}/${routeKey}`).sort();
    expect(pairs).toEqual(['acme/audio:speech', 'acme/image', 'other/video']);
  });

  it('list() returns an empty array for a fresh registry', () => {
    expect(createVendorAdapterRegistry().list()).toEqual([]);
  });

  it('createVendorAdapterRegistry() returns independent instances', () => {
    const a = createVendorAdapterRegistry();
    const b = createVendorAdapterRegistry();
    a.register('acme', 'image', fakeAdapter());
    expect(b.has('acme', 'image')).toBe(false);
  });
});

describe('mediaVendorRegistry — the shared singleton', () => {
  it('has every vendor migrated onto the generic engine registered, once imported', async () => {
    // Import for the registration side effect — mirrors how engine.ts pulls
    // these modules in for the same reason.
    await import('../providers/openai.js');
    await import('../providers/minimax.js');
    await import('../providers/senseaudio.js');
    await import('../providers/fishaudio.js');
    await import('../providers/imagerouter.js');
    await import('../providers/custom-image.js');
    await import('../providers/grok.js');
    await import('../providers/nanobanana.js');
    await import('../providers/openrouter.js');
    await import('../providers/volcengine.js');
    await import('../providers/elevenlabs.js');
    await import('../providers/aihubmix.js');

    expect(mediaVendorRegistry.has('openai', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('openai', 'audio:speech')).toBe(true);
    expect(mediaVendorRegistry.has('minimax', 'audio:speech')).toBe(true);
    expect(mediaVendorRegistry.has('senseaudio', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('senseaudio', 'audio:speech')).toBe(true);
    expect(mediaVendorRegistry.has('fishaudio', 'audio:speech')).toBe(true);
    expect(mediaVendorRegistry.has('imagerouter', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('imagerouter', 'video')).toBe(true);
    expect(mediaVendorRegistry.has('custom-image', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('grok', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('grok', 'audio:speech')).toBe(true);
    expect(mediaVendorRegistry.has('nanobanana', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('openrouter', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('volcengine', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('elevenlabs', 'audio:speech')).toBe(true);
    expect(mediaVendorRegistry.has('elevenlabs', 'audio:sfx')).toBe(true);
    expect(mediaVendorRegistry.has('aihubmix', 'image')).toBe(true);
    expect(mediaVendorRegistry.has('aihubmix', 'audio:speech')).toBe(true);
  });

  it('does not have a not-yet-migrated vendor registered', () => {
    // leonardo+image is genuinely unwired (submit-then-poll shaped, deferred
    // per source-map.md's async-polling bucket — see engine.test.ts's
    // stub-fallback tests, which use the same fixture) — every vendor that
    // previously had a ROUTES entry has now migrated onto the registry, so
    // this can no longer use one of those as its "not migrated" example.
    expect(mediaVendorRegistry.has('leonardo', 'image')).toBe(false);
  });
});
