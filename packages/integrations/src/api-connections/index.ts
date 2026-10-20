/**
 * @file Public entry `@jini-ai/integrations/api-connections`: plugin-declared OAuth connections
 * (sign-in, status, reconnect, staged account switch, disconnect/revoke, access tokens).
 */
export { parseApiConnectionDescriptor } from './descriptor.js';
export { createApiConnectionService, type ApiConnectionService } from './service.js';
export { deriveApiConnectionKey, createApiConnectionGenerationReader } from './keys.js';
export { ApiConnectionError, type ApiConnectionErrorCode } from './errors.js';
export type { ApiConnectionClientKind, ApiConnectionServiceDeps } from './deps.js';
export type { ApiConnectionHooks, ApiConnectionRecordStore, ApiConnectionTokenStore } from './ports.js';
export type { StartApiConnectionResult } from './authorization.js';
export type { CompletedAuthorization } from './finish-authorization.js';
export type { ApiConnectionStatusView } from './status.js';
export type { ApiConnectionDisconnectResult, ApiConnectionRemoteRevocation, ApiConnectionSwitchResult } from './account-actions.js';
export type { ApiConnectionAccessTokens } from './access-token.js';
export type {
  ApiConnectionAccount, ApiConnectionAttempt, ApiConnectionBoundedField, ApiConnectionDescriptor,
  ApiConnectionIntent, ApiConnectionRecord, ApiConnectionStagedSwitch, ApiConnectionStatus,
} from './types.js';
export * from './token-store/index.js';
