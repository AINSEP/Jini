/**
 * @file Ports the host and the provider plugin implement for API connections.
 *
 * Exists so storage, sealing and provider specifics stay outside the engine: the host owns the
 * vault-backed token store and the metadata store; the plugin owns scope sets, identity and
 * revocation. Tests use typed in-memory fakes of these same interfaces.
 */
import type { OAuthTokenStore } from '@jini-ai/oauth';
import type { ApiConnectionAccount, ApiConnectionAttempt, ApiConnectionRecord } from './types.js';

/** Secret storage keyed by the opaque connection key; `delete` clears local tokens on disconnect. */
export type ApiConnectionTokenStore = OAuthTokenStore & {
  delete(requiredArgs: { readonly key: string }): Promise<void>;
};

/** Non-secret metadata and attempts. Every method must be atomic per key or state. */
export interface ApiConnectionRecordStore {
  read(requiredArgs: { readonly key: string }): Promise<ApiConnectionRecord | null>;
  /** Write only when the stored revision equals `expectedRevision` (0 = no record yet). */
  compareAndSet(requiredArgs: {
    readonly key: string;
    readonly expectedRevision: number;
    readonly record: ApiConnectionRecord;
  }): Promise<boolean>;
  putAttempt(requiredArgs: { readonly attempt: ApiConnectionAttempt }): Promise<void>;
  /** Remove and return the attempt in one step; a replayed state returns null. */
  takeAttempt(requiredArgs: { readonly state: string }): Promise<ApiConnectionAttempt | null>;
}

/** Provider behaviour the plugin supplies; the engine never calls a provider API itself. */
export interface ApiConnectionHooks {
  /** Map opaque scope-set ids (e.g. enabled product modules) to the scopes to request. */
  resolveScopes(requiredArgs: { readonly scopeSetIds: readonly string[] }): Promise<readonly string[]>;
  /** Read the signed-in account with a freshly issued access token. */
  readAccount(requiredArgs: { readonly accessToken: string }): Promise<ApiConnectionAccount>;
  /** Revoke the grant remotely. Throw when the provider did not confirm revocation. */
  revoke(requiredArgs: { readonly token: string }): Promise<void>;
}
