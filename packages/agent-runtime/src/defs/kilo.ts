/** Ported verbatim from OD's `apps/daemon/src/runtimes/defs/kilo.ts` (import path adjusted only). See `archived provenance ledger`. */
import { detectAcpModels, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const kiloAgentDef = {
    id: 'kilo',
    name: 'Kilo',
    bin: 'kilo',
    versionArgs: ['--version'],
    fetchModels: async ({ resolvedBin, env }) =>
      (({ bin, args, ...optionalArgs }: Parameters<typeof detectAcpModels>[0] & NonNullable<Parameters<typeof detectAcpModels>[1]>) => detectAcpModels({ bin, args }, optionalArgs))({
        bin: resolvedBin,
        args: ['acp'],
        env,
        timeoutMs: 15_000,
        defaultModelOption: DEFAULT_MODEL_OPTION,
      }),
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: () => ['acp'],
    streamFormat: 'acp-json-rpc',
    externalMcpInjection: 'acp-merge',
    // ACP's `resource_link` prompt blocks carry images natively for every
    // `acp-json-rpc` def — see `types.ts#RuntimeAgentDef.imageDelivery`'s doc.
    imageDelivery: 'native',
} satisfies RuntimeAgentDef;
