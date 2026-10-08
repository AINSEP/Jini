import { createAgentModelDiscovery } from '../model-discovery.js';
import { detectAcpModels, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const traeCliAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('trae-cli', { fallbackModels: (): readonly import('../types.js').RuntimeModelOption[] => traeCliAgentDef.fallbackModels }),
    id: 'trae-cli',
    name: 'Trae CLI',
    bin: 'traecli',
    versionArgs: ['--version'],
    versionProbeTimeoutMs: 10_000,
    fetchModels: async ({ resolvedBin, env }) =>
      (({ bin, args, ...optionalArgs }: Parameters<typeof detectAcpModels>[0] & NonNullable<Parameters<typeof detectAcpModels>[1]>) => detectAcpModels({ bin, args }, optionalArgs))({
        bin: resolvedBin,
        args: ['acp', 'serve'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
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
