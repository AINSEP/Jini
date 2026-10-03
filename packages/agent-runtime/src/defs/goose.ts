/**
 * @module defs/goose
 *
 * Block's goose (`goose`). Runs over ACP: `goose acp` is the launch command the official ACP
 * registry lists (<https://github.com/agentclientprotocol/registry>, `goose/agent.json`). The
 * provider and model come from goose's own config, so `goose configure` has to have been run once.
 *
 * Name clash: `pressly/goose` (a Go database-migration tool) also installs a `goose` binary. On a
 * machine that has only that one, detection will list goose as installed and the first run will
 * fail on the unknown `acp` command.
 */
import { detectAcpModels, DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const gooseAgentDef = {
    id: 'goose',
    name: 'goose',
    bin: 'goose',
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
