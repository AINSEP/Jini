/**
 * @file The agent-CLI picker's inventory: which agent runtimes a host's picker lists, and how each is summarized.
 *
 * The same probe a host may already run for another picker (launch resolution plus a model probe), reshaped to
 * the neutral `AgentInventorySummary`. Only runtimes that can take external tools are listed when the host's
 * whole tool surface arrives through an injected MCP bridge: a runtime that cannot load MCP would chat with no
 * tools at all. The host decides that eligibility through `supportsTools`.
 *
 * Cached once per process: a PATH probe spawns every installed CLI for its version and model list, which is far
 * too slow to repeat on every picker mount. `rescan` forces a fresh one.
 */
import type { RuntimeAgentDef } from "@jini-ai/core/contracts/agents";
import type { AgentInventorySummary } from "@jini-ai/core/contracts/agents/inventory";
import { orFallback } from "@jini-ai/core/errors/idioms";

/** The slice of an agent runtime this module reads — injected so tests probe nothing. */
interface AgentRuntimePorts {
  defs: readonly RuntimeAgentDef[];
  resolveLaunch: (required: { def: RuntimeAgentDef }) => { launchPath?: string | null; diagnostic?: string | null };
  probeModels: (required: { def: RuntimeAgentDef }) => Promise<{ models: RuntimeAgentDef["fallbackModels"] }>;
  supportsTools: (required: { def: RuntimeAgentDef }) => boolean;
}

/**
 * One def's summary. Probes models only for an installed CLI; an absent one shows its fallbacks and
 * says why it is unavailable.
 * @complexity O(models + reasoning options) time and space, plus one model probe when available.
 */
async function summarizeAgent({ def, ports }: { def: RuntimeAgentDef; ports: AgentRuntimePorts }, _optional = {}): Promise<AgentInventorySummary> {
  const launch = ports.resolveLaunch({ def });
  const available = Boolean(launch.launchPath);
  let models = def.fallbackModels;
  if (available) {
    const probe = ports.probeModels({ def });
    models = (await orFallback({ work: () => probe, fallback: { models: def.fallbackModels }, step: "Probe inventory agent models" })).models;
  }
  return {
    id: def.id,
    name: def.name,
    available,
    version: null,
    // An explicitly empty model vocabulary must survive so the picker does not inherit agent levels.
    models: models.map(({ id, label, reasoning }) => ({ id, label, ...(reasoning !== undefined ? { reasoning } : {}) })),
    reasoningOptions: (def.reasoningOptions ?? []).map(({ id, label }) => ({ id, label })),
    ...(def.reasoningInModelId ? { reasoningInModelId: def.reasoningInModelId } : {}),
    ...(def.supportsCustomModel === undefined ? {} : { supportsCustomModel: def.supportsCustomModel }),
    ...(available ? {} : { diagnostic: launch.diagnostic ?? `${def.name} CLI not found on PATH` }),
  };
}

/**
 * The cached lister a host's transport layer calls. Installed CLIs sort first so the picker's default is usable.
 * @complexity O(n) defs per probe, probes run concurrently.
 */
function createAgentInventory(ports: AgentRuntimePorts, _optional = {}): (required: { rescan: boolean }) => Promise<AgentInventorySummary[]> {
  let cached: Promise<AgentInventorySummary[]> | null = null;
  const probe = () => {
    const pending = Promise.all(ports.defs.filter((def) => ports.supportsTools({ def })).map((def) => summarizeAgent({ def, ports })))
      .then((rows) => [...rows].sort((a, b) => Number(b.available) - Number(a.available)));
    // A failed probe must not poison the cache forever.
    pending.catch(() => { if (cached === pending) cached = null; });
    cached = pending;
    return pending;
  };
  return ({ rescan }) => (rescan || cached === null ? probe() : cached);
}

export { createAgentInventory, summarizeAgent };
export type { AgentRuntimePorts };
