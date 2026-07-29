import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';
import * as blobStorageAdapter from '../adapters/blob-storage/index.js';
import * as jwtAuthAdapter from '../adapters/jwt-auth/index.js';
import * as sqliteAdapter from '../adapters/sqlite/index.js';
import * as stripeAdapter from '../adapters/stripe/index.js';
import * as wsAdapter from '../adapters/ws/index.js';

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

  it('does NOT re-export any concrete adapter — each lives behind its own ./adapters/* subpath', () => {
    // Moved out 2026-07-29: these are real, production-quality concrete implementations (unlike
    // the unsafe-reference stubs above, they are meant to be used) — but the main barrel's own doc
    // comment promises "stable interfaces and typed DI tokens only," and re-exporting them would
    // force every consumer to resolve `ws` / `better-sqlite3` / `@jini-ai/platform` / `node:crypto`.
    // Two concrete consequences this closes: the `better-sqlite3` one leaked a `Database.Database`
    // type reference into the barrel's emitted `.d.ts` (breaking TypeScript resolution for anyone
    // who skipped the optional peer), and the `node:crypto` one is what forced the whole package's
    // `jini.runtime` to `node` rather than `universal`.
    //
    // Compared by reference, not by name: a name-presence check would pass for an unrelated export
    // that happened to share a name, which is a trap this repo has already hit once.
    for (const adapter of [wsAdapter, sqliteAdapter, blobStorageAdapter, jwtAuthAdapter, stripeAdapter]) {
      // Asserted so the loop below can never pass vacuously if an adapter's value exports vanish.
      expect(Object.keys(adapter).length).toBeGreaterThan(0);
      for (const name of Object.keys(adapter)) {
        expect(
          (barrel as Record<string, unknown>)[name],
          `${name} must not be reachable from the root barrel`,
        ).not.toBe((adapter as Record<string, unknown>)[name]);
      }
    }
  });

  it('re-exports every token', () => {
    expect(barrel.AuthProviderToken.id).toBe('jini.capabilityProviders.auth');
    expect(barrel.StorageProviderToken.id).toBe('jini.capabilityProviders.storage');
    expect(barrel.PaymentsProviderToken.id).toBe('jini.capabilityProviders.payments');
    expect(barrel.DbProviderToken.id).toBe('jini.capabilityProviders.db');
    expect(barrel.RealtimeProviderToken.id).toBe('jini.capabilityProviders.realtime');
  });
});
