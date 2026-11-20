import { createAgentModelDiscovery } from '../model-discovery-native.js';
import { parseLineSeparatedModels } from './shared.js';
import { opencodeAgentDef } from './opencode.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';

/** Pilot of OpenCode's native ACP mode; listed in BASE_AGENT_DEFS only after the cloud parity check passes. */
export const opencodeAcpAgentDef = {
  ...createAgentModelDiscovery('opencode', { fallbackModels: () => opencodeAgentDef.fallbackModels, args: ['models'], parse: parseLineSeparatedModels }),
  id: 'opencode-acp',
  name: 'OpenCode (ACP)',
  bin: opencodeAgentDef.bin,
  fallbackBins: opencodeAgentDef.fallbackBins,
  versionArgs: ['--version'],
  listModels: opencodeAgentDef.listModels,
  fallbackModels: opencodeAgentDef.fallbackModels,
  fallbackModelsAssertedAt: opencodeAgentDef.fallbackModelsAssertedAt,
  buildArgs: () => ['acp'],
  streamFormat: 'acp-json-rpc',
  resumesSessionViaAcpLoad: true,
  mcpHttp: true,
  externalMcpInjection: 'opencode-env-content',
  systemPromptDelivery: opencodeAgentDef.systemPromptDelivery,
  imageDelivery: 'native',
} satisfies RuntimeAgentDef;
