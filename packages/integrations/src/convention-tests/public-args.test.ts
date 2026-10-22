import { describe, expect, it } from 'vitest';
import { findMediaModel, findProvider, modelsForSurface, AUDIO_MODELS_BY_KIND } from '../media-providers/providers.js';
import { createCapabilityRegistry } from '../media-providers/capability-registry.js';
import { createVendorAdapterRegistry } from '../media-providers/dispatch/vendor-registry.js';

describe('public required/optional argument objects', () => {
  it('preserves catalog lookups and optional selection', () => {
    expect(findMediaModel({ id: 'gpt-image-2' })?.provider).toBe('openai');
    expect(findProvider({ id: 'missing' })).toBeNull();
    expect(modelsForSurface({ surface: 'audio' }, { audioKind: 'speech' })).toBe(AUDIO_MODELS_BY_KIND.speech);
  });

  it('keeps registry isolation with object methods', () => {
    const registry = createCapabilityRegistry({}, { seed: [] });
    expect(registry.get({ id: 'missing' })).toBeUndefined();
    expect(registry.all()).toEqual([]);
    const first = createVendorAdapterRegistry();
    const second = createVendorAdapterRegistry();
    expect(first.has({ providerId: 'example', routeKey: 'image' })).toBe(false);
    expect(second.list()).toEqual([]);
  });
});
