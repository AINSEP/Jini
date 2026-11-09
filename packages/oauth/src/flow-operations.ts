/** @file The one value a host binds to satisfy `OAuthFlowOperations` (`@jini-ai/core/contracts/oauth`). */
import type { OAuthFlowOperations } from '@jini-ai/core/contracts/oauth';
import { beginAuthorizationCode, completeAuthorizationCode } from './authorization-code.js';
import { beginDeviceAuthorization, pollDeviceAuthorizationOnce } from './device-code.js';
import { discoverAuthorizationServer } from './discovery.js';
import { createTokenRefresher, refreshAccessToken } from './refresh.js';
import { registerOAuthClientDynamically } from './registration.js';
import { buildOperatorOAuthProvider, createOAuthProviderRegistry } from './registry.js';
import { createSealedAuthorizationState } from './sealed-state.js';

/**
 * The real OAuth flow operations, by reference (same function identities as the named exports).
 * @agent-note Bind this ONE value per host composition wherever an `OAuthFlowOperations` is required; never wrap, copy or partially
 * re-implement its members. Thrown errors are this package's real `OAuthError` instances.
 */
export const oauthFlowOperations = {
    beginAuthorizationCode, beginDeviceAuthorization, buildOperatorOAuthProvider, completeAuthorizationCode, createSealedAuthorizationState,
    createTokenRefresher, discoverAuthorizationServer, createOAuthProviderRegistry, refreshAccessToken, pollDeviceAuthorizationOnce,
    registerOAuthClientDynamically,
} satisfies OAuthFlowOperations;
