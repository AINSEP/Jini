/**
 * @file Ports the host and the provider plugin implement for API connections.
 *
 * Exists so storage, sealing and provider specifics stay outside the engine: the host owns the
 * vault-backed token store and the metadata store; the plugin owns scope sets, identity and
 * revocation. Tests use typed in-memory fakes of these same interfaces.
 */
import type { OAuthTokenSet, OAuthTokenStore } from '@jini-ai/oauth';
import type { ApiConnectionAccount, ApiConnectionAttempt, ApiConnectionRecord } from './types.js';

/**
 * Secret storage keyed by the opaque connection key; `delete` clears local tokens on disconnect.
 * `persist` is the refresher's write (the store may require its refresh lease); `install` writes a
 * freshly issued sign-in or switch credential for `generation`, needs no lease, and must refuse
 * once the connection's live generation differs or a newer generation's tokens are stored.
 * `load` must return null for tokens sealed under an older generation (that is how a disconnect
 * disables a credential); `loadForRevocation` must return them anyway, because only the
 * disabled credential can still revoke the grant. The engine passes its result to the plugin's
 * revoke hook and nowhere else: never wire it into a refresher, tool or host read path.
 */
export type ApiConnectionTokenStore = OAuthTokenStore & {
  install(requiredArgs: { readonly key: string; readonly tokens: OAuthTokenSet; readonly generation: number }): Promise<void>;
  loadForRevocation(requiredArgs: { readonly key: string }): Promise<OAuthTokenSet | null>;
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
  /**
   * Revoke the grant remotely. Throw when the provider did not confirm revocation. A retry may
   * send a token the provider already revoked: report that as success, not as a failure.
   */
  revoke(requiredArgs: { readonly token: string }): Promise<void>;
}
