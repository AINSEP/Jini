/**
 * @file Host binding of the xAI plugin's OAuth port: agent-runtime's generic OAuth+PKCE
 * functions, called with no adapter. The plugin imports no implementation, so this
 * composition root is where the mechanics meet the routes.
 */
import {
  beginOAuthPkce,
  clearStoredOAuthToken,
  completeOAuthPkce,
  getStoredOAuthToken,
  PendingAuthCache,
  resolveOAuthBearer,
  setStoredOAuthToken,
  startOAuthCallbackListener,
} from '@jini-ai/agent-runtime';
import type { OAuthPkceFlowPort } from '@jini-ai/provider-plugins/xai/oauth-port';

const REAL_OAUTH = {
  begin: (required) => beginOAuthPkce(required),
  complete: (required, optional = {}) => completeOAuthPkce(required, optional),
  tokens: {
    get: (required) => getStoredOAuthToken(required),
    set: (required) => setStoredOAuthToken(required),
    clear: (required) => clearStoredOAuthToken(required),
  },
  resolveBearer: (required, optional = {}) => resolveOAuthBearer(required, optional),
  startCallbackListener: (required, optional = {}) => startOAuthCallbackListener(required, optional),
  createPendingCache: (required = {}, optional = {}) => new PendingAuthCache(required, optional),
} satisfies OAuthPkceFlowPort<PendingAuthCache>;

/** The port the xAI routes are mounted with. */
export const hostOAuthPort: OAuthPkceFlowPort = REAL_OAUTH as OAuthPkceFlowPort;
