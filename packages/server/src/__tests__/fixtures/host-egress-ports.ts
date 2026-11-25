import { runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn, validateBaseUrl } from '@jini-ai/agent-runtime';
import { ok } from '@jini-ai/core/contracts/server';
import type { ProxyProviderRegistration } from '@jini-ai/core/contracts/agents/proxy-provider';

/** A vendor-free proxy registration: the server preset only forwards what the host injects, so its tests inject a stub that parses any body and ends the turn at once. */
const fixtureProxyRegistration: ProxyProviderRegistration = {
  id: 'fixture',
  parse: (body) => ok({ value: body }),
  run: async (_parsed, { onEvent }) => { onEvent({ type: 'end' }); },
};

/** The egress ports a real host binds into the preset, so tests exercise production behaviour. */
export const hostEgressPorts = {
  toolTurns: { anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn, ollama: runOllamaToolTurn },
  proxyProviders: [fixtureProxyRegistration],
  baseUrlGuard: { validate: validateBaseUrl },
} as const;

/** The same ports in `BuiltInFeatureOptions` shape, for kernel-level compositions. */
export const egressFeatureOptions = {
  modelProxy: { toolTurns: hostEgressPorts.toolTurns, providers: hostEgressPorts.proxyProviders },
  research: { baseUrlGuard: hostEgressPorts.baseUrlGuard },
} as const;
