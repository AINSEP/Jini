/** @file Binds one agent definition to a host's runtime state. Lives beside `runtime-state.ts`, not in it:
 * binding Codex needs the Codex argument builder, and the Codex definition's own imports reach `runtime-state.ts`. */
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { AgentRuntimeState } from './runtime-state.js';
import { buildCodexArgs, codexAgentDef } from './defs/codex.js';
import type { CodexDefOptions } from './defs/codex/options.js';

/** Bind model probes and the argument builder to the host transport, capability state and plugin policy.
 * The Codex config reaches only the Codex definition, through its own argument; nothing vendor-specific is
 * added to the neutral build options. Returns a definition copy without mutating the registry. @complexity O(1). */
export function bindRuntimeAgentDef({ def, state }: { def: RuntimeAgentDef; state: AgentRuntimeState }, { codex }: { codex?: CodexDefOptions } = {}): RuntimeAgentDef {
  const fetchModels = def.fetchModels;
  const boundFetchModels: RuntimeAgentDef['fetchModels'] = fetchModels
    ? (required, optional = {}) => fetchModels(required, {
      ...optional, ...(state.acpModelProbe ? { acpModelProbe: state.acpModelProbe } : {}),
    }) : undefined;
  // Only the registry's own Codex builder takes the config: a host-supplied definition named `codex` keeps its builder.
  const buildArgs: RuntimeAgentDef['buildArgs'] = codex && def.buildArgs === codexAgentDef.buildArgs
    ? (required, optional = {}) => buildCodexArgs(required, { ...optional, codex })
    : def.buildArgs;
  return { ...def, ...(boundFetchModels ? { fetchModels: boundFetchModels } : {}), buildArgs: (required, optional = {}) => buildArgs(required, {
    ...optional, options: { ...optional.options, capabilities: state.capabilities.get(def.id) ?? {} },
  }) };
}
