/**
 * @file The dependency bundle every API-connection operation receives.
 *
 * Exists so the service factory validates its wiring once and each operation module takes one
 * typed object instead of re-declaring eleven ports.
 */
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthAppOptions, OAuthClient, OAuthFetch, OAuthRandomBytes, OAuthSleep, OAuthUrlGuard } from '@jini-ai/oauth';
import type { ApiConnectionHooks, ApiConnectionRecordStore, ApiConnectionTokenStore } from './ports.js';
import type { ApiConnectionDescriptor } from './types.js';

export interface ApiConnectionServiceDeps {
  readonly descriptor: ApiConnectionDescriptor;
  /** Public (`authMethod: 'none'`) for installed apps; confidential for hosted servers. */
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

export function clientKind(deps: Pick<ApiConnectionServiceDeps, 'client'>): 'public' | 'confidential' {
  return deps.client.authMethod === 'none' ? 'public' : 'confidential';
}
