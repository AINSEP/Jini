/** @agent-note Types only. Sign-in contracts for hosted MCP connections; the host fulfills every port and passes the same repository instance the store uses. */
import type { KeyringPort, SecretSealerPort } from '@jini-ai/core/contracts/vault';
import type { OAuthDiscoveryPolicy, OAuthFlowOperations, OAuthMessages, OAuthUrlGuard } from '@jini-ai/core/contracts/oauth';
import type { ExternalMcpAuthMode, ExternalMcpOAuthStatus, ExternalMcpSealedOAuthPayload, ExternalMcpServerRecord, SealedExternalMcpOAuth } from '@jini-ai/core/contracts/hosted-mcp';

/** @agent-note The fields of a real OAuth error the sign-in reads after `isOAuthError` recognized it; never built by the sign-in itself. */
export interface HostedMcpOAuthFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly providerErrorCode: string | undefined;
  readonly retryAfterSeconds: number | undefined;
}

/** @agent-note Host wording for the sign-in's refusals and operator actions. Every string may be model- or operator-facing, so it never carries provider text, tokens or URLs; the host binds its exact current bytes. */
export interface HostedMcpSignInCopy {
  /** Operator actions attached to the OAuth refusals, keyed by the refusal. */
  readonly actions: { readonly noProvider: string; readonly noClientId: string; readonly chooseGrant: string; readonly noRegistration: string; readonly restartDevice: string; readonly restartShared: string };
  /** The refusal message when discovery advertises no grant the sign-in implements. */
  readonly noSupportedGrant: (input: { readonly serverId: string; readonly offered: readonly string[] }) => string;
  /** The validation message when an authorization-code grant has no callback origin. */
  readonly noPublicOrigin: (input: { readonly serverId: string }) => string;
  /** Validation message when shared sign-in is asked for where the host has no shared owner. */
  readonly sharedLocalOnly: string;
  /** Message of the connection error for a shared connection that is not usable here. */
  readonly sharedUnavailable: string;
  /** Message of the access-denied error when the actor is not the shared owner. */
  readonly sharedOwnerOnly: string;
}

/**
 * Everything the hosted-MCP sign-in needs from its host, so the sign-in imports only core types.
 * @agent-note Fulfilled by the host ONCE per composition (one object shared by the sign-in service and its shared-owner sign-in); members are the host's real implementations, never copies:
 * `flow` = `@jini-ai/oauth`'s `oauthFlowOperations` (its errors are real `OAuthError`s); `errors.oauth` constructs a real `OAuthError` and `errors.isOAuthError` is that class's own predicate (identity, codes, retryability preserved, never matched by message);
 * `errors.validation` constructs the canonical `ExternalMcpValidationError` and `errors.isUnconfigured` recognizes the canonical `ExternalMcpSecretStoreUnconfiguredError` (both from `@jini-ai/mcp/federation/hosted`), so `isSignInRefusal`/`classifyError` keep recognizing them;
 * `errors.reauthRequired` is the host's ONE canonical re-authorization factory, the same function the connection gate receives.
 * `store` is the same store module the host's repository was built with (same envelope instance); the repository itself is `deps.repo`, which MUST be the store's repo instance, and every find/upsert/lease/CAS call goes through it in the original order.
 * `aad.format` produces the configuration-bound `oauth-redirect-state` v2 AAD bytes; `registrationIdentity` is stable (changing it registers a new client at every provider); `signInLink` builds the host route link (routes and browser binding stay in the host).
 */
export interface HostedMcpSignInPorts {
  readonly flow: OAuthFlowOperations;
  readonly errors: {
    /** @agent-note Returns a real `OAuthError` instance built from exactly this input. */
    readonly oauth: (input: { readonly code: 'OAUTH_INVALID_REQUEST' | 'OAUTH_INVALID_STATE'; readonly message: string; readonly operatorAction: string }) => Error;
    /** @agent-note `instanceof` the real `OAuthError` class `flow` throws. */
    readonly isOAuthError: (error: unknown) => error is HostedMcpOAuthFailure;
    /** @agent-note Returns the canonical validation error; `field` names the refused input. */
    readonly validation: (message: string, field: string) => Error;
    /** @agent-note `instanceof` the canonical secret-store-unconfigured error the `store` members throw. */
    readonly isUnconfigured: (error: unknown) => boolean;
    /** @agent-note The canonical terminal, non-retryable re-authorization error; `cause` rides along unchanged. */
    readonly reauthRequired: (input: { readonly serverId: string; readonly label?: string | null; readonly cause?: unknown }) => Error;
  };
  readonly store: {
    /** @agent-note Exactly one sealer open per call; `{}` when the row holds no blob. */
    openPayload(sealer: Pick<SecretSealerPort, 'open'>, record: Pick<ExternalMcpServerRecord, 'sealedOAuth' | 'workspaceId' | 'serverId' | 'oauthAadVersion'>): Promise<ExternalMcpSealedOAuthPayload>;
    /** @agent-note Exactly one seal; the result is staged for the conditional `deps.repo` write (`updateIfVersion` or `updateOAuthRuntime`) in the same call sequence. */
    sealPayload(deps: { readonly sealer: SecretSealerPort; readonly keyring: KeyringPort }, identity: { readonly workspaceId: string; readonly serverId: string }, payload: ExternalMcpSealedOAuthPayload): Promise<SealedExternalMcpOAuth>;
  };
  /** @agent-note Pure row projections (the canonical resolvers); no I/O. */
  readonly projections: { readonly authMode: (record: Pick<ExternalMcpServerRecord, 'authMode'>) => ExternalMcpAuthMode; readonly oauthStatus: (record: Pick<ExternalMcpServerRecord, 'oauthStatus'>) => ExternalMcpOAuthStatus };
  /** @agent-note Redirect-state AAD format; v2 binds the saved creation time and version. */
  readonly aad: { readonly format: (input: { readonly kind: string; readonly version: string; readonly parts: readonly string[] }) => string };
  /** @agent-note Host route link for the hosted browser hop; no provider URL leaves it. */
  readonly signInLink: (input: { readonly callbackUrl: string; readonly workspaceId: string; readonly serverId: string }) => string;
  /** @agent-note Stable registration identity: `clientName` names a connection's own client, `sharedClientName` the shared-owner client. */
  readonly registrationIdentity: { readonly softwareId: string; readonly clientName: (record: Pick<ExternalMcpServerRecord, 'label' | 'serverId'>) => string; readonly sharedClientName: string };
  /** @agent-note Host OAuth copy passed to `flow`, the issuer-bound discovery policy, and the wrapper that maps provider failures to host copy (it never adds retries). */
  readonly oauthMessages: OAuthMessages;
  readonly discoveryPolicy: (input: { readonly guard: OAuthUrlGuard }) => OAuthDiscoveryPolicy;
  readonly withCopy: <T>(input: { readonly call: () => Promise<T> }) => Promise<T>;
  readonly copy: HostedMcpSignInCopy;
  /** @agent-note Operator diagnostics only; called when `onConnected` rejects, after which sign-in still succeeds. This logger MUST NOT throw or forward provider details to model-facing text. */
  readonly log: { readonly postConnectFailed: (input: { readonly serverId: string; readonly error: unknown }) => void };
}
