/**
 * Ported from OD's `apps/daemon/src/runtimes/defs/reasonix.ts` with one
 * real strip (not just a comment reword): the origin injected a
 * product-specific system-prompt block via
 * `env.REASONIX_ACP_SYSTEM_APPEND` — a `DESIGN_INSTRUCTIONS` constant that
 * literally named the host product and instructed the model to wrap output
 * in that product's own artifact-tag convention (see `source-map.md` for
 * the exact original text). That is genuine product-specific prompt
 * content baked into what's supposed to be a pure declarative def literal,
 * not the generic ACP-transport config the rest of this file is. It is
 * dropped here; a host that wants an
 * equivalent system-prompt append for reasonix should supply it via
 * `PromptAugmenter.systemOverlay` (see `prompt-augmenter.ts`) and merge it
 * into this def's `env.REASONIX_ACP_SYSTEM_APPEND` itself, since the
 * engine has no generic way to know a given def's env-based system-prompt
 * hook exists. See `source-map.md`.
 */
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
    id: 'reasonix',
    name: 'DeepSeek Reasonix',
    bin: 'reasonix',
    fallbackBins: ['dsnix'],
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin, env) =>
      detectAcpModels({
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
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
    ],
    installUrl: 'https://github.com/esengine/DeepSeek-Reasonix',
    docsUrl: 'https://esengine.github.io/DeepSeek-Reasonix/',
} satisfies RuntimeAgentDef;
