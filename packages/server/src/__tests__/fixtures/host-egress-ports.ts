import { runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn, validateBaseUrl } from '@jini-ai/agent-runtime';

/** The egress ports a real host binds into the preset, so tests exercise production behaviour. */
export const hostEgressPorts = {
  toolTurns: { anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn, ollama: runOllamaToolTurn },
  baseUrlGuard: { validate: validateBaseUrl },
} as const;

/** The same ports in `BuiltInFeatureOptions` shape, for kernel-level compositions. */
export const egressFeatureOptions = {
  modelProxy: { toolTurns: hostEgressPorts.toolTurns },
  research: { baseUrlGuard: hostEgressPorts.baseUrlGuard },
} as const;
