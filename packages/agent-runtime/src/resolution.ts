/**
 * @module resolution
 * Resolve an agent's absolute executable path from the current PATH and registry.
 */
import { getAgentDef } from './registry.js';
import { resolveAgentExecutable } from './executables.js';

// Used by the chat handler so spawn() gets the same executable that
// detection reported as available — fixes Windows ENOENT when the bare
// bin name isn't on the child process's PATH.
export function resolveAgentBin({ id }: { id: string }, { configuredEnv = {} }: { configuredEnv?: Record<string, string> } = {}) {
  const def = getAgentDef({ id: id });
  if (!def?.bin) return null;
  return resolveAgentExecutable({ def: def }, { configuredEnv: configuredEnv });
}
