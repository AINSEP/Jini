/** Compile-time proof that the shared agent-runtime binding matches the daemon's port, with no cast. A mismatch in
 * any member (argument object, optional bag, return type, null-ness) is a `tsc` error in this file. */
import { createAgentRuntimeBindings, createNativeAgentRuntime } from '@jini-ai/agent-runtime';
import type { AgentRuntimePort } from '@jini-ai/daemon/ports/agent-runtime';
import type { BaseUrlGuardPort, ProviderToolTurnPort } from '@jini-ai/core/contracts/agents';
import {
  runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn, validateBaseUrl,
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
