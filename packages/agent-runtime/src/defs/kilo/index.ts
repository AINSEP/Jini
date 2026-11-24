import { createAgentModelDiscovery } from '../../model-discovery-native.js';
import { acpModelFetcher, DEFAULT_MODEL_OPTION } from '../shared.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';

export const kiloAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('kilo', { fallbackModels: (): readonly import('@jini-ai/core/contracts/agents').RuntimeModelOption[] => kiloAgentDef.fallbackModels }),
    id: 'kilo',
    name: 'Kilo',
    bin: 'kilo',
    versionArgs: ['--version'],
    fetchModels: acpModelFetcher({ args: ['acp'] }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: () => ['acp'],
    streamFormat: 'acp-json-rpc',
    externalMcpInjection: 'acp-merge',
    // ACP's `resource_link` prompt blocks carry images natively for every
    // `acp-json-rpc` def — see `types.ts#RuntimeAgentDef.imageDelivery`'s doc.
    imageDelivery: 'native',
} satisfies RuntimeAgentDef;
