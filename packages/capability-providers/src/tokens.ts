/**
 * Typed DI tokens for each capability-provider port, following the exact
 * pattern `@jini-ai/core`'s `token()` establishes (see
 * `packages/core/src/token.ts`) and the naming convention `@jini-ai/daemon`'s
 * `src/tokens.ts` / `@jini-ai/media`'s `src/tokens.ts` already set
 * (bare-interface-name-suffixed-`Token`).
 *
 * These tokens are exported for a future consumer to `bind()` in its own
 * composition — this package itself does not bind them anywhere, and
 * nothing else in this repo imports this package (see `source-map.md`).
 */
import { token } from '@jini-ai/core';
import type { AuthProvider } from './auth.js';
import type { DbProvider } from './db.js';
import type { PaymentsProvider } from './payments.js';
import type { RealtimeProvider } from './realtime.js';
import type { StorageProvider } from './storage.js';

export const AuthProviderToken = token<AuthProvider>('jini.capabilityProviders.auth');
export const StorageProviderToken = token<StorageProvider>('jini.capabilityProviders.storage');
export const PaymentsProviderToken = token<PaymentsProvider>('jini.capabilityProviders.payments');
export const DbProviderToken = token<DbProvider>('jini.capabilityProviders.db');
export const RealtimeProviderToken = token<RealtimeProvider>('jini.capabilityProviders.realtime');
