import { createAgentModelDiscovery } from '../model-discovery.js';
/**
 * @module defs/cline
 *
 * Cline CLI (`cline`, npm `cline`). Runs over ACP: `cline --acp` is both the launch command the
 * official ACP registry lists (<https://github.com/agentclientprotocol/registry>, `cline/agent.json`)
 * and what an installed `cline` 3.0.60 answered live — `initialize` returned
 * `promptCapabilities.image: true` and three `authMethods`, and `session/new` on a machine with no
 * sign-in failed with "Authentication required: Call authenticate before starting a session",
 * which `auth.ts`'s generic classifier already reads as a missing sign-in (fix: `cline auth`).
 */
import { detectAcpModels, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const clineAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('cline', { fallbackModels: (): readonly import('../types.js').RuntimeModelOption[] => clineAgentDef.fallbackModels }),
    id: 'cline',
    name: 'Cline',
    bin: 'cline',
    versionArgs: ['--version'],
    fetchModels: async ({ resolvedBin, env }) =>
      (({ bin, args, ...optionalArgs }: Parameters<typeof detectAcpModels>[0] & NonNullable<Parameters<typeof detectAcpModels>[1]>) => detectAcpModels({ bin, args }, optionalArgs))({
        bin: resolvedBin,
        args: ['--acp'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: () => ['--acp'],
    streamFormat: 'acp-json-rpc',
    externalMcpInjection: 'acp-merge',
    // ACP's `resource_link` prompt blocks carry images natively for every
    // `acp-json-rpc` def — see `types.ts#RuntimeAgentDef.imageDelivery`'s doc.
    imageDelivery: 'native',
} satisfies RuntimeAgentDef;
