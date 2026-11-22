import { createAgentModelDiscovery } from '../model-discovery-native.js';
import { acpModelFetcher, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';

export const kimiAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('kimi', { fallbackModels: (): readonly import('@jini-ai/core/contracts/agents').RuntimeModelOption[] => kimiAgentDef.fallbackModels }),
    id: 'kimi',
    name: 'Kimi CLI',
    bin: 'kimi',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview' },
      { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
      { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k' },
    ],
    fetchModels: acpModelFetcher({ args: ['acp'] }),
    buildArgs: () => ['acp'],
    streamFormat: 'acp-json-rpc',
    mcpDiscovery: 'mature-acp',
    externalMcpInjection: 'acp-merge',
    // ACP's `resource_link` prompt blocks carry images natively for every
    // `acp-json-rpc` def — see `types.ts#RuntimeAgentDef.imageDelivery`'s doc.
    imageDelivery: 'native',
} satisfies RuntimeAgentDef;
