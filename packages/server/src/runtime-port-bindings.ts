/** @file The runtime-package functions this preset binds to the daemon's provider ports. The daemon routes never
 * import a runtime implementation (owner rule K5): the composer passes these in, and `satisfies` proves each
 * binding matches its port with no cast. */
import { runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn, validateBaseUrl } from '@jini-ai/agent-runtime';
import { createCommandInvocation } from '@jini-ai/platform/command';
import type { HostToolCommandInvocation } from '@jini-ai/daemon/http';
import type { BaseUrlGuardPort } from '@jini-ai/daemon/ports/agent-runtime';
import type { ProviderToolTurnPort } from '@jini-ai/daemon/ports/provider-http';

/** The provider tool-turn runners the model-proxy routes call: the real functions, no adapter. */
export const providerToolTurns = {
  anthropic: runAnthropicToolTurn,
  openai: runOpenAiToolTurn,
  azure: runAzureToolTurn,
  google: runGoogleToolTurn,
  ollama: runOllamaToolTurn,
} satisfies ProviderToolTurnPort;

/** The base-URL SSRF guard the research route's built-in Tavily transport runs before every call out. */
export const baseUrlGuard = { validate: (required: { baseUrl: string }) => validateBaseUrl(required) } satisfies BaseUrlGuardPort;

/** The shell-free spawn planner the open-in route launches a resolved host tool through. */
export const hostToolCommandInvocation: HostToolCommandInvocation = createCommandInvocation;
