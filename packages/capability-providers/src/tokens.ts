/** Typed capability-provider DI tokens built with core's token() owner. Names use the
 * bare-interface-name + Token convention. Hosts bind each port in their own composition. */
import { token } from '@jini-ai/core';
import type { AuthProvider } from './auth.js';
import type { DbProvider } from './db.js';
import type { PaymentsProvider } from './payments.js';
import type { RealtimeProvider } from './realtime.js';
import type { StorageProvider } from './storage.js';

export const AuthProviderToken = token<AuthProvider>({ id: 'jini.capabilityProviders.auth' });
export const StorageProviderToken = token<StorageProvider>({ id: 'jini.capabilityProviders.storage' });
export const PaymentsProviderToken = token<PaymentsProvider>({ id: 'jini.capabilityProviders.payments' });
export const DbProviderToken = token<DbProvider>({ id: 'jini.capabilityProviders.db' });
export const RealtimeProviderToken = token<RealtimeProvider>({ id: 'jini.capabilityProviders.realtime' });
