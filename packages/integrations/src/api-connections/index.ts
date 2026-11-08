/**
 * @file Public entry `@jini-ai/integrations/api-connections`: plugin-declared OAuth connections
 * (sign-in, status, reconnect, staged account switch, disconnect/revoke, access tokens).
 */
export { parseApiConnectionDescriptor } from './descriptor.js';
export { createApiConnectionService, type ApiConnectionService } from './service.js';
export { deriveApiConnectionKey, createApiConnectionGenerationReader } from './keys.js';
export { waitForHostedSignIn, createSignInHandoffs, type SignInHandoffs } from './hosted-sign-in.js';
export { ApiConnectionError, type ApiConnectionErrorCode } from './errors.js';
export type { ApiConnectionClientKind, ApiConnectionServiceDeps } from './deps.js';
export type { ApiConnectionHooks, ApiConnectionRecordStore, ApiConnectionTokenStore } from './ports.js';
export type { StartApiConnectionResult } from './authorization.js';
export type { CompletedAuthorization } from './finish-authorization.js';
export type { ApiConnectionStatusView } from './status.js';
export type { ApiConnectionDisconnectResult, ApiConnectionRemoteRevocation, ApiConnectionSwitchResult } from './account-actions.js';
import { disconnectApiConnection as runDisconnect, type ApiConnectionDisconnectDeps } from './account-actions.js';
export type { ApiConnectionDisconnectDeps } from './account-actions.js';
export type { ApiConnectionAccessTokens } from './access-token.js';
export { assertSharedOAuthCompatibility, createSharedOAuthConsumer } from './shared.js';
export type { SharedOAuthConnection, SharedOAuthConsumer, SharedOAuthConsumerDeps, SharedOAuthConsumerTarget, SharedOAuthIdentity } from './shared.js';
export type {
  ApiConnectionAccount, ApiConnectionAttempt, ApiConnectionBoundedField, ApiConnectionDescriptor,
  ApiConnectionIntent, ApiConnectionRecord, ApiConnectionRevocationFailure, ApiConnectionStagedSwitch, ApiConnectionStatus,
} from './types.js';
export {
  createVaultOAuthTokenStore, parseOAuthTokenVaultMeta, parseTokenPayload, buildTokenPayload,
  type VaultOAuthTokenStore, type VaultOAuthTokenStoreDeps, type OAuthTokenVaultPort, type ReadConnectionGeneration,
  type OAuthConnectionOwner, type OAuthConnectionStatus, type OAuthTokenStoreErrorCode,
} from './token-store/index.js';

/** Stops an issued connection using lifecycle ports only; no sign-in client or HTTP wiring.
 * @complexity Selected record/token operations plus the existing bounded provider revocation.
 */
export function disconnectApiConnection(
  { deps, ...connection }: { readonly deps: ApiConnectionDisconnectDeps; readonly connectionRef: string; readonly workspaceId: string },
  _optional: Record<string, never> = {},
) {
  return runDisconnect(deps, connection);
}
export {
  asApiConnectionHooksModule, checkApiConnectionClientNamespace, parseApiConnectionsFile,
  type ApiConnectionClientConfig, type ApiConnectionDeclaration, type ApiConnectionHooksModule,
} from './declarations.js';
export {
  ConnectionBudgetExceededError, createConnectionBudgets, HOST_BUDGET_MAXIMUM, parseConnectionBudgets,
  type ConnectionBudget, type ConnectionBudgetLimiter, type ConnectionBudgetLimiterProfile, type ConnectionBudgets,
  type ConnectionBudgetScope, type ConnectionBudgetTarget, type CreateConnectionBudgetLimiter,
} from './budgets.js';
export type {
  ApiConnectionRuntime, DeclaredApiConnection, ApiConnectionHttpOptions, PluginHttp,
  ApiConnectionHostRecordStore, ApiConnectionHostStorage, ApiConnectionByoCredential,
  ApiConnectionByoRefusal, ApiConnectionByoCredentials, ApiConnectionSharedIssuingContext,
  ApiConnectionSharedStorage, ApiConnectionPreparedSignIn, ApiConnectionSharedConnections,
  ApiConnectionSharedFactoryInput, ApiConnectionHostPorts,
} from './host-ports.js';
export { byoClientLabel, resolveByoClient, type ByoClient } from './byo-client.js';
export { createConnectionHookHttp, CONNECTION_HOOK_UNDECLARED_ORIGIN_MESSAGE } from './hook-http.js';
export type {
  ApiConnectionSignInAttempt, ApiConnectionCallbackKey, ApiConnectionCallbackInbox, ApiConnectionStartLoopback,
  ApiConnectionHostMessages, ApiConnectionRuntimeHostDeps, ApiConnectionRuntimeHostOptions,
  ApiConnectionSignInLink, ApiConnectionConnectMessages,
} from './host-ports.js';
