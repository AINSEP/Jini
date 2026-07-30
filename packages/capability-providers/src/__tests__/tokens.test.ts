import { describe, expect, it } from 'vitest';
import { AuthProviderToken, DbProviderToken, PaymentsProviderToken, RealtimeProviderToken, StorageProviderToken } from '../tokens.js';

describe('@jini-ai/capability-providers tokens', () => {
  const tokens = [AuthProviderToken, StorageProviderToken, PaymentsProviderToken, DbProviderToken, RealtimeProviderToken];

  it('are one-cardinality tokens with the jini.capabilityProviders.* namespace and version 1', () => {
    for (const t of tokens) {
      expect(t.cardinality).toBe('one');
      expect(t.version).toBe(1);
      expect(t.id.startsWith('jini.capabilityProviders.')).toBe(true);
    }
  });

  it('have distinct ids', () => {
    const ids = new Set(tokens.map((t) => t.id));
    expect(ids.size).toBe(tokens.length);
  });
});
