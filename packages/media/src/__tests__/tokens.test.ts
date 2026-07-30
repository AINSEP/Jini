import { describe, expect, it } from 'vitest';
import { CapabilityRegistryToken, MediaPolicyToken, MediaTaskStoreToken } from '../tokens.js';

describe('@jini-ai/media tokens', () => {
  it('are one-cardinality tokens with the jini.media.* namespace and version 1', () => {
    for (const t of [CapabilityRegistryToken, MediaTaskStoreToken, MediaPolicyToken]) {
      expect(t.cardinality).toBe('one');
      expect(t.version).toBe(1);
      expect(t.id.startsWith('jini.media.')).toBe(true);
    }
  });

  it('have distinct ids', () => {
    const ids = new Set([CapabilityRegistryToken.id, MediaTaskStoreToken.id, MediaPolicyToken.id]);
    expect(ids.size).toBe(3);
  });
});
