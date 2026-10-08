import { describe, expect, it, vi } from 'vitest';

/** The old mechanism registered vendors merely by importing the dispatch engine. */
describe('vendor registration runs at use rather than import', () => {
  it('keeps imports inert, then registers the full built-in roster exactly once', async () => {
    vi.resetModules();
    const { VendorAdapterRegistry, mediaVendorRegistry, createVendorAdapterRegistry } = await import('../vendor-registry.js');
    const register = vi.spyOn(VendorAdapterRegistry.prototype, 'register');
    try {
      await import('../engine.js');
      expect(register).not.toHaveBeenCalled();
      expect(createVendorAdapterRegistry().list()).toEqual([]);

      const pairs = mediaVendorRegistry.list();
      expect(pairs).toHaveLength(18);
      expect(new Set(pairs.map(([provider, route]) => `${provider}:${route}`)).size).toBe(18);
      expect(pairs).toContainEqual(['openai', 'image']);
      expect(pairs).toContainEqual(['elevenlabs', 'audio:sfx']);
      expect(register).toHaveBeenCalledTimes(18);

      expect(mediaVendorRegistry.has({ providerId: 'openai', routeKey: 'image' })).toBe(true);
      expect(mediaVendorRegistry.get({ providerId: 'elevenlabs', routeKey: 'audio:sfx' })).toBeDefined();
      expect(mediaVendorRegistry.list()).toEqual(pairs);
      expect(register).toHaveBeenCalledTimes(18);
      expect(createVendorAdapterRegistry().list()).toEqual([]);
    } finally {
      register.mockRestore();
    }
  });
});
