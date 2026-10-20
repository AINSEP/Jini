/**
 * @file Starts and completes an API-connection sign-in (authorization code + PKCE S256).
 *
 * Exists to bind the OAuth core's browser grant to a plugin connection: start records an
 * expiring single-use attempt bound to workspace, actor, plugin connection, requested scopes,
 * callback URI, credential generation and the starting browser; complete redeems it exactly once,
 * exchanges the code, and hands the token set to `finishAuthorization` for the grant, identity and
 * commit checks.
 */
import { beginAuthorizationCode, completeAuthorizationCode, generateOAuthState, OAuthError, type OAuthProviderDescriptor,
  type OAuthTokenSet } from '@jini-ai/oauth';
import type { ApiConnectionServiceDeps } from './deps.js';
import { ApiConnectionError, invalidAttempt } from './errors.js';
import { attemptOpener, attemptSealer, BROWSER_BINDING_BYTES, hashBrowserBinding } from './attempt-state.js';
import { finishAuthorization, loadReadableTokens, type CompletedAuthorization } from './finish-authorization.js';
import { deriveApiConnectionKey } from './keys.js';
import { assertId, checkCallbackParams, checkScopes, checkStartParams, pickBoundedFields, requestInvalid } from './request-checks.js';
import type { ApiConnectionAttempt, ApiConnectionIntent, ApiConnectionRecord } from './types.js';

export interface StartApiConnectionResult {
  /** Stable reference to this connection; the same value on every reconnect. */
  readonly connectionRef: string;
  readonly authorizationUrl: string;
  /**
   * Host-only: the callback's CSRF binding, for the host's own routing (e.g. arming a loopback
   * receiver). Never hand it to plugin code or a frame; give them `attemptId` instead.
   */
  readonly state: string;
  /** Opaque, random id of this sign-in; `complete` returns the same id (e.g. to key callback fields). */
  readonly attemptId: string;
  /**
   * Host-only: proof that a callback arrives in the browser that started this sign-in. Hand it to
   * that browser (see the README's host contract) and pass it back to `complete`; never to plugin
   * code, a frame, logs or the authorization URL. Only its hash is stored.
   */
  readonly browserBinding: string;
  readonly expiresAt: string;
}

/** Same encoding as `state`, half the entropy: it names an attempt, it does not guard one. */
const ATTEMPT_ID_BYTES = 16;

function providerFor(deps: ApiConnectionServiceDeps): OAuthProviderDescriptor {
  const { descriptor } = deps;
  return {
    providerId: `${descriptor.pluginId}/${descriptor.connectionId}`, label: descriptor.label,
    supportedGrants: ['authorization_code'], authorizationEndpoint: descriptor.authorizationEndpoint,
    tokenEndpoint: descriptor.tokenEndpoint, defaultScopes: [], usesPkce: true, clientAuth: deps.client.authMethod,
  };
}

/** One canonical string per (workspace, actor, plugin connection); JSON keeps it injective. */
function ownerKeyFor(deps: ApiConnectionServiceDeps, requiredArgs: { workspaceId: string; actorId: string }): string {
  return JSON.stringify([requiredArgs.workspaceId, requiredArgs.actorId, deps.descriptor.pluginId, deps.descriptor.connectionId]);
}

function assertStartAllowed(record: ApiConnectionRecord | null, intent: ApiConnectionIntent): void {
  // The disabled credential is kept for a revocation retry; a new sign-in would orphan it.
  if (record?.status === 'revocation-pending') {
    throw new ApiConnectionError({ code: 'revocation-pending',
      message: 'This connection is disconnected locally but remote revocation is still pending. Retry disconnecting first.' });
  }
  // A new sign-in would overwrite (switch) or orphan (connect) the staged credential without revoking it.
  if (record != null && record.staged !== null) {
    throw new ApiConnectionError({ code: 'switch-in-progress',
      message: 'An account switch is waiting for confirmation. Confirm it or cancel it before signing in again.' });
  }
  if (intent === 'switch-account' && (record === null || record.account === null)) {
    throw new ApiConnectionError({ code: 'not-connected', message: 'There is no connected account to switch from. Connect an account first.' });
  }
}

/** A connected record whose stored tokens this host can read and that hold a refresh token. */
async function holdsRenewableCredential(deps: ApiConnectionServiceDeps, record: ApiConnectionRecord | null): Promise<boolean> {
  if (record?.status !== 'connected') return false;
  return (await loadReadableTokens(deps, { key: record.key }))?.refreshToken != null;
}

/**
 * The client kind's fixed parameters, plus the descriptor's force-consent ones on a hosted start
 * with nothing renewable stored for the account: a provider may issue a refresh token only on the
 * first consent per account and client (e.g. the same account in a second workspace). A switch
 * signs in another account, so the stored credential never counts for it.
 */
async function clientKindParams(deps: ApiConnectionServiceDeps, record: ApiConnectionRecord | null,
  intent: ApiConnectionIntent): Promise<Readonly<Record<string, string>>> {
  const fixed = deps.descriptor.authorizationParams[deps.clientKind];
  if (deps.clientKind === 'public') return fixed;
  const renewable = intent === 'connect' && await holdsRenewableCredential(deps, record);
  return renewable ? fixed : { ...fixed, ...deps.descriptor.forceConsentParams };
}

/** Map OAuth core failures to connection codes; the core's messages are already token-free. */
function toConnectionError(error: unknown): unknown {
  if (!(error instanceof OAuthError)) return error;
  if (error.code === 'OAUTH_INVALID_STATE') return invalidAttempt({}, { cause: error });
  const code = error.code === 'OAUTH_ACCESS_DENIED' ? 'access-denied' : 'authorization-failed';
  return new ApiConnectionError({ code, message: `Sign-in did not complete: ${error.message}. ${error.operatorAction}` }, { cause: error });
}

export async function startApiConnectionAuthorization(
  deps: ApiConnectionServiceDeps,
  requiredArgs: {
    readonly workspaceId: string; readonly actorId: string; readonly intent: ApiConnectionIntent;
    readonly scopeSetIds: readonly string[]; readonly redirectUri: string;
  },
  optionalArgs: { readonly startParams?: Readonly<Record<string, string>> } = {},
): Promise<StartApiConnectionResult> {
  const { workspaceId, actorId, intent } = requiredArgs;
  assertId(workspaceId, 'workspaceId');
  assertId(actorId, 'actorId');
  if (intent !== 'connect' && intent !== 'switch-account') throw requestInvalid('intent');
  const startParams = checkStartParams(deps.descriptor.startParams, optionalArgs.startParams ?? {});
  const key = deriveApiConnectionKey({ workspaceId, pluginId: deps.descriptor.pluginId, connectionId: deps.descriptor.connectionId });
  const record = await deps.records.read({ key });
  assertStartAllowed(record, intent);
  const requestedScopes = checkScopes(await deps.hooks.resolveScopes({ scopeSetIds: [...requiredArgs.scopeSetIds] }));
  const kindParams = await clientKindParams(deps, record, intent);
  const ownerKey = ownerKeyFor(deps, { workspaceId, actorId });
  const attemptId = generateOAuthState({ randomBytesFn: deps.randomBytesFn }, { stateBytes: ATTEMPT_ID_BYTES });
  const browserBinding = generateOAuthState({ randomBytesFn: deps.randomBytesFn }, { stateBytes: BROWSER_BINDING_BYTES });
  const draft = { key, attemptId, ownerKey, browserBindingHash: hashBrowserBinding(browserBinding), workspaceId, actorId, pluginId: deps.descriptor.pluginId,
    connectionId: deps.descriptor.connectionId, intent, requestedScopes, generation: record?.generation ?? 0 };
  const begun = await beginAuthorizationCode({
    provider: providerFor(deps), stateless: attemptSealer(deps, { draft }), randomBytesFn: deps.randomBytesFn, guard: deps.guard,
    options: deps.appOptions, ownerKey, client: deps.client, redirectUri: requiredArgs.redirectUri,
  }, { scopes: requestedScopes, extraAuthorizationParams: { ...kindParams, ...startParams } })
    .catch((error: unknown) => { throw toConnectionError(error); });
  return { connectionRef: key, authorizationUrl: begun.authorizationUrl, state: begun.state, attemptId, browserBinding,
    expiresAt: begun.expiresAt };
}

/**
 * Redeem the callback. `redirectUri` is the exact callback URL this request arrived on and the
 * identities are the host's authenticated session, never values read from the callback itself.
 * `browserBinding` is what the callback's browser carried back (`''` when it carried none); a
 * missing or different binding burns the attempt with the same `invalid-attempt`.
 */
export async function completeApiConnectionAuthorization(
  deps: ApiConnectionServiceDeps,
  requiredArgs: {
    readonly workspaceId: string; readonly actorId: string; readonly redirectUri: string;
    readonly callbackParams: Readonly<Record<string, string>>; readonly browserBinding: string;
  },
): Promise<CompletedAuthorization> {
  assertId(requiredArgs.workspaceId, 'workspaceId');
  assertId(requiredArgs.actorId, 'actorId');
  if (!URL.canParse(requiredArgs.redirectUri)) throw requestInvalid('redirectUri');
  const params = checkCallbackParams(requiredArgs.callbackParams);
  const callbackFields = pickBoundedFields(deps.descriptor.callbackFields, requiredArgs.callbackParams, 'callback field');
  let attempt: ApiConnectionAttempt | undefined;
  const tokens: OAuthTokenSet = await completeAuthorizationCode({
    provider: providerFor(deps), stateless: attemptOpener(deps, { browserBinding: requiredArgs.browserBinding, onOpen: opened => { attempt = opened.attempt; } }),
    redirectUri: new URL(requiredArgs.redirectUri).href, ownerKey: ownerKeyFor(deps, requiredArgs), client: deps.client, params,
    fetchFn: deps.fetchFn, guard: deps.guard, clock: deps.clock,
  }).catch((error: unknown) => { throw toConnectionError(error); });
  // completeAuthorizationCode only reaches the exchange after `open` returned an attempt.
  return finishAuthorization(deps, { attempt: attempt!, tokens, callbackFields });
}
