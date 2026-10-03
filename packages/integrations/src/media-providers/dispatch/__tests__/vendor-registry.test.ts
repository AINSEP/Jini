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
        registry.register({ providerId: 'acme', routeKey: 'image', adapter: adapter });
        expect(registry.get({ providerId: 'acme', routeKey: 'image' })).toBe(adapter);
    });
    it('get() returns undefined for an unregistered providerId', () => {
        const registry = createVendorAdapterRegistry();
        expect(registry.get({ providerId: 'nope', routeKey: 'image' })).toBeUndefined();
    });
    it('get() returns undefined for a known providerId but unregistered routeKey', () => {
        const registry = createVendorAdapterRegistry();
        registry.register({ providerId: 'acme', routeKey: 'image', adapter: fakeAdapter() });
        expect(registry.get({ providerId: 'acme', routeKey: 'audio:speech' })).toBeUndefined();
    });
    it('has() reflects registration state', () => {
        const registry = createVendorAdapterRegistry();
        expect(registry.has({ providerId: 'acme', routeKey: 'image' })).toBe(false);
        registry.register({ providerId: 'acme', routeKey: 'image', adapter: fakeAdapter() });
        expect(registry.has({ providerId: 'acme', routeKey: 'image' })).toBe(true);
    });
    it('supports multiple routeKeys for the same providerId', () => {
        const registry = createVendorAdapterRegistry();
        const imageAdapter = fakeAdapter();
        const speechAdapter = fakeAdapter();
        registry.register({ providerId: 'acme', routeKey: 'image', adapter: imageAdapter });
        registry.register({ providerId: 'acme', routeKey: 'audio:speech', adapter: speechAdapter });
        expect(registry.get({ providerId: 'acme', routeKey: 'image' })).toBe(imageAdapter);
        expect(registry.get({ providerId: 'acme', routeKey: 'audio:speech' })).toBe(speechAdapter);
    });
    it('throws when the same (providerId, routeKey) is registered twice', () => {
        const registry = createVendorAdapterRegistry();
        registry.register({ providerId: 'acme', routeKey: 'image', adapter: fakeAdapter() });
        expect(() => registry.register({ providerId: 'acme', routeKey: 'image', adapter: fakeAdapter() })).toThrow(/already registered/);
    });
    it('list() enumerates every registered (providerId, routeKey) pair', () => {
        const registry = createVendorAdapterRegistry();
        registry.register({ providerId: 'acme', routeKey: 'image', adapter: fakeAdapter() });
        registry.register({ providerId: 'acme', routeKey: 'audio:speech', adapter: fakeAdapter() });
        registry.register({ providerId: 'other', routeKey: 'video', adapter: fakeAdapter() });
        const pairs = registry.list().map(([providerId, routeKey]) => `${providerId}/${routeKey}`).sort();
        expect(pairs).toEqual(['acme/audio:speech', 'acme/image', 'other/video']);
    });
    it('list() returns an empty array for a fresh registry', () => {
        expect(createVendorAdapterRegistry().list()).toEqual([]);
    });
    it('createVendorAdapterRegistry() returns independent instances', () => {
        const a = createVendorAdapterRegistry();
        const b = createVendorAdapterRegistry();
        a.register({ providerId: 'acme', routeKey: 'image', adapter: fakeAdapter() });
        expect(b.has({ providerId: 'acme', routeKey: 'image' })).toBe(false);
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
        expect(mediaVendorRegistry.has({ providerId: 'openai', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'openai', routeKey: 'audio:speech' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'minimax', routeKey: 'audio:speech' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'senseaudio', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'senseaudio', routeKey: 'audio:speech' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'fishaudio', routeKey: 'audio:speech' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'imagerouter', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'imagerouter', routeKey: 'video' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'custom-image', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'grok', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'grok', routeKey: 'audio:speech' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'nanobanana', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'openrouter', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'volcengine', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'elevenlabs', routeKey: 'audio:speech' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'elevenlabs', routeKey: 'audio:sfx' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'aihubmix', routeKey: 'image' })).toBe(true);
        expect(mediaVendorRegistry.has({ providerId: 'aihubmix', routeKey: 'audio:speech' })).toBe(true);
    });
    it('does not have a not-yet-migrated vendor registered', () => {
        // leonardo+image is genuinely unwired (submit-then-poll shaped, deferred
        // per archived provenance ledger's async-polling bucket — see engine.test.ts's
        // stub-fallback tests, which use the same fixture) — every vendor that
        // previously had a ROUTES entry has now migrated onto the registry, so
        // this can no longer use one of those as its "not migrated" example.
        expect(mediaVendorRegistry.has({ providerId: 'leonardo', routeKey: 'image' })).toBe(false);
    });
});
