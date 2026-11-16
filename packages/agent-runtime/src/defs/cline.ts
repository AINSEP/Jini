import { createAgentModelDiscovery } from '../model-discovery-native.js';
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
import { acpModelFetcher, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';

export const clineAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('cline', { fallbackModels: (): readonly import('@jini-ai/core/contracts/agents').RuntimeModelOption[] => clineAgentDef.fallbackModels }),
    id: 'cline',
    name: 'Cline',
    bin: 'cline',
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
