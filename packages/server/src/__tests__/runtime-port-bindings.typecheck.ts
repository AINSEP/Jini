/** Compile-time proof that the shared agent-runtime binding matches the daemon's port, with no cast. A mismatch in
 * any member (argument object, optional bag, return type, null-ness) is a `tsc` error in this file. */
import { createAgentRuntimeBindings, createNativeAgentRuntime } from '@jini-ai/agent-runtime';
import type { AgentRuntimePort, BaseUrlGuardPort } from '@jini-ai/daemon/ports/agent-runtime';
import type { ProviderToolTurnPort } from '@jini-ai/daemon/ports/provider-http';
import type { XaiOAuthPort } from '@jini-ai/daemon/ports/xai-oauth';
import {
  beginOAuthPkce, clearStoredOAuthToken, completeOAuthPkce, getStoredOAuthToken, PendingAuthCache, resolveOAuthBearer, runAnthropicToolTurn,
  runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn, setStoredOAuthToken, startOAuthCallbackListener, validateBaseUrl,
  XAI_OAUTH_PROVIDER_CONFIG, XAI_OAUTH_REDIRECT_HOST, XAI_OAUTH_REDIRECT_PATH, XAI_OAUTH_REDIRECT_PORT,
} from '@jini-ai/agent-runtime';

export function bindForTypecheck(required: { env: Record<string, string | undefined> }, _optional: Record<string, never> = {}): AgentRuntimePort {
  return createAgentRuntimeBindings({ runtime: createNativeAgentRuntime({ env: required.env }) }) satisfies AgentRuntimePort;
}

export const baseUrlGuard = { validate: (required: { baseUrl: string }) => validateBaseUrl(required) } satisfies BaseUrlGuardPort;

/** The provider tool-turn runners, as `model-proxy` calls them: the host passes the real functions with no adapter. */
export const providerToolTurns = {
  anthropic: runAnthropicToolTurn,
  openai: runOpenAiToolTurn,
  azure: runAzureToolTurn,
  google: runGoogleToolTurn,
  ollama: runOllamaToolTurn,
} satisfies ProviderToolTurnPort;

/** The xAI OAuth operations, as `xai.ts` calls them. */
export const xaiOAuth = {
  config: XAI_OAUTH_PROVIDER_CONFIG,
  redirect: { host: XAI_OAUTH_REDIRECT_HOST, port: XAI_OAUTH_REDIRECT_PORT, path: XAI_OAUTH_REDIRECT_PATH },
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
} satisfies XaiOAuthPort<PendingAuthCache>;
