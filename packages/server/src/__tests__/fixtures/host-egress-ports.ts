import { runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn, validateBaseUrl } from '@jini-ai/agent-runtime';
import { createAnthropicProxyRegistration } from '@jini-ai/provider-plugins/model-proxy-anthropic';
import { createAzureProxyRegistration } from '@jini-ai/provider-plugins/model-proxy-azure';
import { createGoogleProxyRegistration } from '@jini-ai/provider-plugins/model-proxy-google';
import { createOllamaProxyRegistration } from '@jini-ai/provider-plugins/model-proxy-ollama';
import { createOpenAiProxyRegistration } from '@jini-ai/provider-plugins/model-proxy-openai';

/** The egress ports a real host binds into the preset, so tests exercise production behaviour. */
export const hostEgressPorts = {
  toolTurns: { anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn, ollama: runOllamaToolTurn },
  proxyProviders: [createAnthropicProxyRegistration(), createOpenAiProxyRegistration(), createAzureProxyRegistration(), createGoogleProxyRegistration(), createOllamaProxyRegistration()],
  baseUrlGuard: { validate: validateBaseUrl },
} as const;

/** The same ports in `BuiltInFeatureOptions` shape, for kernel-level compositions. */
export const egressFeatureOptions = {
  modelProxy: { toolTurns: hostEgressPorts.toolTurns, providers: hostEgressPorts.proxyProviders },
  research: { baseUrlGuard: hostEgressPorts.baseUrlGuard },
} as const;
