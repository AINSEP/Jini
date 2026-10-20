/**
 * @file The dependency bundle every API-connection operation receives.
 *
 * Exists so the service factory validates its wiring once and each operation module takes one
 * typed object instead of re-declaring eleven ports.
 */
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthAppOptions, OAuthClient, OAuthFetch, OAuthRandomBytes, OAuthSleep, OAuthUrlGuard } from '@jini-ai/oauth';
import { ApiConnectionError } from './errors.js';
import type { ApiConnectionHooks, ApiConnectionRecordStore, ApiConnectionTokenStore } from './ports.js';
import type { ApiConnectionDescriptor } from './types.js';

export interface ApiConnectionServiceDeps {
  readonly descriptor: ApiConnectionDescriptor;
  /**
   * How the app is registered, independent of how it authenticates: `public` for an installed app
   * (PKCE, loopback callback, re-consent replaces the whole token set), `confidential` for a hosted
   * server that keeps its secret. Selects the descriptor's extra parameters and refresh-token rules.
   */
  readonly clientKind: ApiConnectionClientKind;
  /**
   * Client identity and token-endpoint auth method. A public client may still send a
   * provider-issued, non-confidential secret; it stays server-side and is never logged or shown.
   */
  readonly client: OAuthClient;
  /** Application identity and the registered callback URLs an attempt may use. */
  readonly appOptions: OAuthAppOptions;
  readonly hooks: ApiConnectionHooks;
  readonly records: ApiConnectionRecordStore;
  readonly tokens: ApiConnectionTokenStore;
  readonly fetchFn: OAuthFetch;
  readonly guard: OAuthUrlGuard;
  readonly clock: Clock;
  readonly randomBytesFn: OAuthRandomBytes;
  readonly sleep: OAuthSleep;
}

export type ApiConnectionClientKind = 'public' | 'confidential';

/**
 * Refuse wiring whose client kind is unknown, or confidential without token-endpoint
 * authentication (a client that does not authenticate is not confidential).
 */
export function assertClientWiring(deps: Pick<ApiConnectionServiceDeps, 'client' | 'clientKind'>): void {
  const known = deps.clientKind === 'public' || deps.clientKind === 'confidential';
  if (known && !(deps.clientKind === 'confidential' && deps.client?.authMethod === 'none')) return;
  throw new ApiConnectionError({ code: 'configuration-invalid',
    message: 'The connection is wired with an invalid client kind for its client. Fix the host configuration and restart.' });
}
