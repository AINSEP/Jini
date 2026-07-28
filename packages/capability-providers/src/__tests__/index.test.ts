import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

describe('@jini-ai/capability-providers barrel completeness', () => {
  it('does NOT export any reference provider factory — those are unsafe-reference-only (SEC-RB-006)', () => {
    // The normal public entry point must only ever expose the stable port
    // interfaces/types and typed DI tokens. The non-cryptographic,
    // non-production in-memory reference stubs must stay confined to the
    // separate `@jini-ai/capability-providers/unsafe-reference` entry point so
    // they can never be imported by accident. See
    // `ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`
    // finding SEC-RB-006.
    expect((barrel as Record<string, unknown>).createInMemoryAuthProvider).toBeUndefined();
    expect((barrel as Record<string, unknown>).createInMemoryStorageProvider).toBeUndefined();
    expect((barrel as Record<string, unknown>).createInMemoryPaymentsProvider).toBeUndefined();
    expect((barrel as Record<string, unknown>).createInMemoryDbProvider).toBeUndefined();
    expect((barrel as Record<string, unknown>).createInMemoryRealtimeProvider).toBeUndefined();
  });

  it('re-exports every token', () => {
    expect(barrel.AuthProviderToken.id).toBe('jini.capabilityProviders.auth');
    expect(barrel.StorageProviderToken.id).toBe('jini.capabilityProviders.storage');
    expect(barrel.PaymentsProviderToken.id).toBe('jini.capabilityProviders.payments');
    expect(barrel.DbProviderToken.id).toBe('jini.capabilityProviders.db');
    expect(barrel.RealtimeProviderToken.id).toBe('jini.capabilityProviders.realtime');
  });
});
