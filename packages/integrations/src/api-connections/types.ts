/**
 * @file Value types for plugin-declared API connections: the trusted descriptor, the durable
 * non-secret connection record and the single-use authorization attempt.
 *
 * Exists so the record store, token store and service agree on one vocabulary. Nothing here
 * names a provider: a plugin supplies endpoints, parameters and hooks; the engine supplies flow.
 */

/** Lifecycle visible to hosts. Only `connected` lets tokens leave the store. */
export type ApiConnectionStatus = 'connected' | 'reconnect-required' | 'revocation-pending' | 'disconnected';

/** `connect` covers first connect, reconnect and adding scopes for the same account. */
export type ApiConnectionIntent = 'connect' | 'switch-account';

/** Identity reported by the plugin's account hook; shown to people, never used as a secret. */
export interface ApiConnectionAccount {
  readonly accountId: string;
  readonly displayName: string;
}

/** A plugin-declared request or callback field: the name is the allowlist, maxLength the bound. */
export interface ApiConnectionBoundedField {
  readonly name: string;
  readonly maxLength: number;
}

/** Validated, frozen plugin declaration. Contains no client secret. */
export interface ApiConnectionDescriptor {
  readonly pluginId: string;
  readonly connectionId: string;
  readonly label: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** Fixed extra authorization parameters per client kind (hosted confidential vs installed public). */
  readonly authorizationParams: {
    readonly public: Readonly<Record<string, string>>;
    readonly confidential: Readonly<Record<string, string>>;
  };
  /**
   * Extra authorization parameters a hosted (`confidential`) start adds only when nothing renewable
   * is stored for the account it signs in (first connect, switch, reconnect after a lost or rejected
   * refresh token), so the provider issues a refresh token again, e.g. a forced consent prompt.
   */
  readonly forceConsentParams: Readonly<Record<string, string>>;
  /** Parameters a caller may set per start, e.g. a one-off selection flow. */
  readonly startParams: readonly ApiConnectionBoundedField[];
  /** Extra provider callback fields passed back to the plugin after the exchange succeeds. */
  readonly callbackFields: readonly ApiConnectionBoundedField[];
}

/**
 * Why the last remote revocation was not confirmed: a fixed code, never hook or provider text.
 * `provider-unreachable` / `provider-refused` are the revoke hook's own classification (an error
 * whose `code` is one of them); `unclassified` is any other hook failure; `credential-unreadable`
 * means the stored credential could not be read, so it was removed locally without revoking.
 */
export type ApiConnectionRevocationFailure = 'provider-unreachable' | 'provider-refused' | 'unclassified' | 'credential-unreadable';

/** A switch-account result held aside until the person confirms it. */
export interface ApiConnectionStagedSwitch {
  readonly account: ApiConnectionAccount;
  readonly grantedScopes: readonly string[];
  readonly actorId: string;
  /** Credential generation the staged switch was made against; a change voids it. */
  readonly generation: number;
  readonly expiresAt: string;
}

/** Durable non-secret metadata. `revision` fences every write; `generation` fences credentials. */
export interface ApiConnectionRecord {
  readonly key: string;
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly connectionId: string;
  readonly status: ApiConnectionStatus;
  readonly revision: number;
  readonly generation: number;
  readonly account: ApiConnectionAccount | null;
  readonly grantedScopes: readonly string[];
  readonly staged: ApiConnectionStagedSwitch | null;
  /** Set by a disconnect or cancel whose revocation was not confirmed; cleared by the next confirmed one or sign-in. */
  readonly revocationFailure: ApiConnectionRevocationFailure | null;
  readonly updatedAt: string;
}

/**
 * One authorization round trip. `codeVerifier` is a short-lived PKCE secret: useless without the
 * one-time code, but record stores must still keep attempts out of logs and exports.
 */
export interface ApiConnectionAttempt {
  readonly state: string;
  /** Random id plugin code and frames may hold; unlike `state` it is no CSRF binding. */
  readonly attemptId: string;
  readonly key: string;
  readonly ownerKey: string;
  /** SHA-256 (base64url) of the host-only binding the starting browser carries; never the binding itself. */
  readonly browserBindingHash: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly pluginId: string;
  readonly connectionId: string;
  readonly intent: ApiConnectionIntent;
  readonly requestedScopes: readonly string[];
  readonly redirectUri: string;
  readonly generation: number;
  readonly codeVerifier: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}
