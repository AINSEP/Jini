import { createAgentModelDiscovery } from '../model-discovery.js';
/** Reasonix's declarative definition stays product-neutral (R5, checkEngineBoundaries).
 * Per-run system overlays use REASONIX_ACP_SYSTEM_APPEND via the shared systemPromptDelivery
 * dispatch and computeChildEnv. Static def.env is computed once and cannot carry host/per-run
 * overlay wording. */
import os from 'node:os';
import path from 'node:path';
import { detectAcpModels, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

/** Resolve Reasonix's home directory, respecting REASONIX_HOME if already set. */
function reasonixHome(): string {
  if (process.env.REASONIX_HOME) return process.env.REASONIX_HOME;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'reasonix');
  }
  return path.join(os.homedir(), '.reasonix');
}

export const reasonixAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('reasonix', { fallbackModels: (): readonly import('../types.js').RuntimeModelOption[] => reasonixAgentDef.fallbackModels }),
    id: 'reasonix',
    name: 'DeepSeek Reasonix',
    bin: 'reasonix',
    fallbackBins: ['dsnix'],
    versionArgs: ['--version'],
    fetchModels: async ({ resolvedBin, env }) =>
      (({ bin, args, ...optionalArgs }: Parameters<typeof detectAcpModels>[0] & NonNullable<Parameters<typeof detectAcpModels>[1]>) => detectAcpModels({ bin, args }, optionalArgs))({
        bin: resolvedBin,
        args: ['acp'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    buildArgs: () => ['acp'],
    streamFormat: 'acp-json-rpc',
    mcpDiscovery: 'mature-acp',
    externalMcpInjection: 'acp-merge',
    // ACP's `resource_link` prompt blocks carry images natively for every
    // `acp-json-rpc` def — see `types.ts#RuntimeAgentDef.imageDelivery`'s doc.
    imageDelivery: 'native',
    acpMcpEnvFormat: 'map',
    env: {
      REASONIX_HOME: reasonixHome(),
    },
    // See this file's module doc — the real, OD-confirmed mechanism, wired generically (no
    // product-specific text lives here; the overlay content itself comes from the host's own
    // `PromptAugmenter`, never from this def).
    systemPromptDelivery: { strategy: 'env-var', varName: 'REASONIX_ACP_SYSTEM_APPEND' },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
    ],
    installUrl: 'https://github.com/esengine/DeepSeek-Reasonix',
    docsUrl: 'https://esengine.github.io/DeepSeek-Reasonix/',
} satisfies RuntimeAgentDef;
