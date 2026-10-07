import { createAgentModelDiscovery } from '../model-discovery.js';
/** Ported verbatim from OD's `apps/daemon/src/runtimes/defs/mimo.ts` (import path adjusted only). See `archived provenance ledger`. */
import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const mimoAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('mimo', { fallbackModels: (): readonly import('../types.js').RuntimeModelOption[] => mimoAgentDef.fallbackModels }),
  id: 'mimo',
  name: 'MiMo Code',
  bin: 'mimo',
  versionArgs: ['--version'],
  fallbackModels: [DEFAULT_MODEL_OPTION],
  buildArgs: ({ prompt: _prompt, imagePaths: _imagePaths }, { extraAllowedDirs: _extra, options = {} } = {}) => {
    const args = ['run', '--format', 'json'];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'json-event-stream',
  eventParser: 'opencode',
  // MiMo reads MCP servers from its layered config using the same
  // JSON schema as OpenCode's `mcp` config, but under the MIMOCODE_
  // env namespace instead of OPENCODE_. The daemon serialises the
  // enabled MCP servers into MIMOCODE_CONFIG_CONTENT following the
  // same structure as OPENCODE_CONFIG_CONTENT.
  externalMcpInjection: 'mimo-env-content',
} satisfies RuntimeAgentDef;
