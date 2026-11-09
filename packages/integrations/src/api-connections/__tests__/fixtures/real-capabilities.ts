/**
 * @file Test-host wiring: the REAL `@jini-ai/oauth` exports and the REAL platform vault-conflict
 * classifier, bound exactly as a production host binds them. Test hosts may import real providers.
 */
import {
  createPendingAuthorizationStore, generateOAuthState, invalidPendingAuthorizationState, isOAuthError, MAX_AUTHORIZATION_STATE_LENGTH,
  oauthFlowOperations, PENDING_AUTHORIZATION_STATE_BYTES, secureEqualsForOwnerBinding,
} from '@jini-ai/oauth';
import { VaultError } from '@jini-ai/platform/secrets/credential-sets';
import type { ApiConnectionOAuthCapabilities } from '../../index.js';

export const realOAuthCapabilities: ApiConnectionOAuthCapabilities = {
  flow: oauthFlowOperations, generateState: generateOAuthState, pendingStateBytes: PENDING_AUTHORIZATION_STATE_BYTES,
  invalidPendingState: invalidPendingAuthorizationState, secureEquals: secureEqualsForOwnerBinding, isOAuthError,
  maxAuthorizationStateLength: MAX_AUTHORIZATION_STATE_LENGTH, createPendingAuthorizationStore,
};

export const realCallbackLimits = { maxAuthorizationStateLength: MAX_AUTHORIZATION_STATE_LENGTH } as const;

export function realVaultConflict(error: unknown): boolean {
  return error instanceof VaultError && error.code === 'conflict';
}
