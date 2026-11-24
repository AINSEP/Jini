import { createAgentModelDiscovery } from '../../model-discovery-native.js';
import { acpModelFetcher, DEFAULT_MODEL_OPTION } from '../shared.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';

export const traeCliAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('trae-cli', { fallbackModels: (): readonly import('@jini-ai/core/contracts/agents').RuntimeModelOption[] => traeCliAgentDef.fallbackModels }),
    id: 'trae-cli',
    name: 'Trae CLI',
    bin: 'traecli',
    versionArgs: ['--version'],
    versionProbeTimeoutMs: 10_000,
    fetchModels: acpModelFetcher({ args: ['acp', 'serve'] }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
    // behavior) unless a caller explicitly opts into a restricted run.
    buildArgs: ({ prompt: _prompt, imagePaths: _imagePaths }, { extraAllowedDirs: _extra, options = {} } = {}) =>
      options.permissionMode === 'restricted' ? ['acp', 'serve'] : ['acp', 'serve', '--yolo'],
    streamFormat: 'acp-json-rpc',
    mcpDiscovery: 'mature-acp',
    externalMcpInjection: 'acp-merge',
    // ACP's `resource_link` prompt blocks carry images natively for every
    // `acp-json-rpc` def — see `types.ts#RuntimeAgentDef.imageDelivery`'s doc.
    imageDelivery: 'native',
} satisfies RuntimeAgentDef;
