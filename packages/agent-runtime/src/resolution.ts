/**
 * @module resolution
 * Resolve saved agent selections and absolute executable paths against the registry.
 */
import { getAgentDef } from './registry.js';
import { resolveAgentExecutable } from './executables.js';

/** Resolve a saved selection against the host's registry; retired ids use its default.
 * `onFallback` reports the first stale selection once per resolver, keeping repeated turns quiet
 * without retaining an unbounded collection of caller-supplied ids. Missing selections are silent.
 * Registry lookup failures propagate; executable availability remains the launcher's responsibility.
 * @complexity O(registry lookup) time per selection, O(1) retained space.
 */
export function createAgentSelectionResolver(
  { defaultAgentId, onFallback }: {
    defaultAgentId: string;
    onFallback: (input: { agentId: string; defaultAgentId: string }) => void;
  },
  { getDef = getAgentDef }: { getDef?: (input: { id: string }) => { id: string } | null } = {},
): (input: { agentId?: string | undefined }, options?: Record<string, never>) => string {
  let warned = false;
  return ({ agentId }, _options = {}) => {
    if (agentId === undefined) return defaultAgentId;
    if (getDef({ id: agentId })) return agentId;
    // Saved preferences outlive adapters: recover before session or launch state is keyed by id.
    if (!warned) {
      warned = true;
      onFallback({ agentId, defaultAgentId });
    }
    return defaultAgentId;
  };
}

// Used by the chat handler so spawn() gets the same executable that
// detection reported as available — fixes Windows ENOENT when the bare
// bin name isn't on the child process's PATH.
export function resolveAgentBin({ id }: { id: string }, { configuredEnv = {} }: { configuredEnv?: Record<string, string> } = {}) {
  const def = getAgentDef({ id: id });
  if (!def?.bin) return null;
  return resolveAgentExecutable({ def: def }, { configuredEnv: configuredEnv });
}
