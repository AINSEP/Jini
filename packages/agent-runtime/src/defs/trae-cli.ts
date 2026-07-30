/** Ported verbatim from OD's `apps/daemon/src/runtimes/defs/trae-cli.ts` (import path adjusted only). See `source-map.md`. */
import { detectAcpModels, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const traeCliAgentDef = {
    id: 'trae-cli',
    name: 'Trae CLI',
    bin: 'traecli',
    versionArgs: ['--version'],
    versionProbeTimeoutMs: 10_000,
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
        bin: resolvedBin,
        args: ['acp', 'serve'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
    // behavior) unless a caller explicitly opts into a restricted run.
    buildArgs: (_prompt, _imagePaths, _extra, options = {}) =>
      options.permissionMode === 'restricted' ? ['acp', 'serve'] : ['acp', 'serve', '--yolo'],
    streamFormat: 'acp-json-rpc',
    mcpDiscovery: 'mature-acp',
    externalMcpInjection: 'acp-merge',
} satisfies RuntimeAgentDef;
