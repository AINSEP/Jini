import { describe, expect, it } from 'vitest';
import { createCapabilityRegistry } from '../capability-registry.js';
import { MEDIA_CAPABILITY_SEED } from '../seed.js';

describe('MEDIA_CAPABILITY_SEED shape', () => {
  it('is non-empty and every entry has a unique id + apiModel', () => {
    expect(MEDIA_CAPABILITY_SEED.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const cap of MEDIA_CAPABILITY_SEED) {
      expect(cap.id.length).toBeGreaterThan(0);
      expect(cap.apiModel.length).toBeGreaterThan(0);
      expect(cap.caps.length).toBeGreaterThan(0);
      expect(ids.has(cap.id)).toBe(false);
      ids.add(cap.id);
    }
  });

  it('loads cleanly into a CapabilityRegistry with every entry retrievable', () => {
    const registry = createCapabilityRegistry(MEDIA_CAPABILITY_SEED);
    expect(registry.all()).toHaveLength(MEDIA_CAPABILITY_SEED.length);
    for (const cap of MEDIA_CAPABILITY_SEED) {
      expect(registry.get(cap.id)).toEqual(cap);
    }
  });
});
