import { createAgentModelDiscovery } from '../../model-discovery-native.js';
/**
 * @module defs/auggie
 *
 * Augment Code's Auggie CLI (`auggie`, npm `@augmentcode/auggie`). Runs over ACP: `auggie --acp`
 * is the launch command the official ACP registry lists
 * (<https://github.com/agentclientprotocol/registry>, `auggie/agent.json`). Sign-in is
 * `auggie login` in a terminal.
 */
import { acpModelFetcher, DEFAULT_MODEL_OPTION } from '../shared.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';

export const auggieAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('auggie', { fallbackModels: (): readonly import('@jini-ai/core/contracts/agents').RuntimeModelOption[] => auggieAgentDef.fallbackModels }),
    id: 'auggie',
    name: 'Auggie CLI',
    bin: 'auggie',
    versionArgs: ['--version'],
    fetchModels: acpModelFetcher({ args: ['--acp'] }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: () => ['--acp'],
    streamFormat: 'acp-json-rpc',
    externalMcpInjection: 'acp-merge',
    // ACP's `resource_link` prompt blocks carry images natively for every
    // `acp-json-rpc` def — see `types.ts#RuntimeAgentDef.imageDelivery`'s doc.
    imageDelivery: 'native',
} satisfies RuntimeAgentDef;
