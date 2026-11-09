/**
 * @file The narrow OAuth capabilities the API-connection closure uses, injected by the host so this
 * entry never imports the OAuth runtime. Every member is the OAuth package's real export (or the
 * real flow operations value); nothing here is a copy or a fallback.
 */
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthEmptyArgs, OAuthFlowOperations, OAuthRandomBytes } from '@jini-ai/core/contracts/oauth';
import type { ApiConnectionCallbackFieldRules } from './descriptor.js';

/** The fields of a real OAuth error this closure reads after classification. */
export interface ApiConnectionOAuthError {
  readonly code: string;
  readonly message: string;
  readonly operatorAction: string;
}

/** The generic single-use pending cache (`createPendingAuthorizationStore`'s cache overload). */
export interface ApiConnectionPendingCache<T> {
  put(requiredArgs: { state: string; value: T }): void;
  consume(requiredArgs: { state: string }): T | null;
}

/**
 * @agent-note Fulfilled by the host from `@jini-ai/oauth`, ONE object per host composition shared by every service, attempt,
 * callback and hand-off it creates: `flow` = `oauthFlowOperations`; `generateState` = `generateOAuthState`; `pendingStateBytes` =
 * `PENDING_AUTHORIZATION_STATE_BYTES`; `invalidPendingState` = `invalidPendingAuthorizationState`; `secureEquals` =
 * `secureEqualsForOwnerBinding`; `isOAuthError` = `isOAuthError` (real `instanceof OAuthError`, so error identity, codes and
 * retryability are the package's own, never matched by message); `maxAuthorizationStateLength` = `MAX_AUTHORIZATION_STATE_LENGTH`; `callbackFieldRules` = the same rules object given to
 * `parseApiConnectionDescriptor` (`MAX_CALLBACK_FIELDS`, `MAX_CALLBACK_FIELD_LENGTH`, `isCallbackFieldName`);
 * `createPendingAuthorizationStore` = `createPendingAuthorizationStore`. Required: there is no default or fallback.
 */
export interface ApiConnectionOAuthCapabilities {
  readonly flow: Pick<OAuthFlowOperations, 'beginAuthorizationCode' | 'completeAuthorizationCode' | 'createTokenRefresher' | 'refreshAccessToken'>;
  readonly generateState: (requiredArgs: { readonly randomBytesFn: OAuthRandomBytes }, optionalArgs?: { readonly stateBytes?: number }) => string;
  readonly pendingStateBytes: number;
  readonly invalidPendingState: (requiredArgs: OAuthEmptyArgs) => Error;
  readonly secureEquals: (requiredArgs: { readonly a: string; readonly b: string }) => boolean;
  readonly isOAuthError: (input: { readonly value: unknown }) => input is { readonly value: ApiConnectionOAuthError };
  readonly maxAuthorizationStateLength: number;
  readonly callbackFieldRules: ApiConnectionCallbackFieldRules;
  readonly createPendingAuthorizationStore: <T>(deps: { readonly clock: Clock },
    optionalArgs: { readonly expiry: (requiredArgs: { value: T; ttlMs: number }) => number }) => ApiConnectionPendingCache<T>;
}
