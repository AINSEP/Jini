import type { ExecutableResolutionOptions } from './executables.js';
/**
 * @module launch
 * Resolve a launchable process, including Codex native-binary/node-wrapper selection and child PATH.
 */
import path, { delimiter } from 'node:path';
import { inspectAgentExecutableResolution, userToolchainBinDirs } from './executables.js';
import type { RuntimeAgentDef } from './types.js';
import { trimCharsEnd } from '@jini-ai/core/text';
import { resolveCodexLaunch } from './defs/codex/launch.js';

export type AgentLaunchKind = 'selected' | 'codex-native';

export type AgentLaunchResolution = ReturnType<typeof inspectAgentExecutableResolution> & {
  launchPath: string | null;
  launchKind: AgentLaunchKind;
  childPathPrepend: string[];
  diagnostic: string | null;
};

const LAUNCH_ADAPTERS = new Map<string, typeof resolveCodexLaunch>([['codex', resolveCodexLaunch]]);

export function resolveAgentLaunch({ def }: { def: RuntimeAgentDef }, options: ExecutableResolutionOptions & { configuredEnv?: Record<string, string> } = {}
): AgentLaunchResolution {
  const resolution = inspectAgentExecutableResolution({ def: def }, options);
  if (!resolution.selectedPath) {
    return { ...resolution, launchPath: null, launchKind: 'selected', childPathPrepend: [], diagnostic: null };
  }
  const childPathPrepend = path.isAbsolute(resolution.selectedPath)
    ? [path.dirname(resolution.selectedPath)]
    : [];
  const adapt = LAUNCH_ADAPTERS.get(def.id);
  return { ...resolution, ...(adapt?.(resolution.selectedPath, childPathPrepend) ?? {
    launchPath: resolution.selectedPath, launchKind: 'selected', childPathPrepend, diagnostic: null,
  }) };
}

export function applyAgentLaunchEnv({ env, launch }: { env: NodeJS.ProcessEnv; launch: Pick<AgentLaunchResolution, 'childPathPrepend'> }, { nodeBinDir = path.dirname(process.execPath), appendPathDirs = userToolchainBinDirs() }: { nodeBinDir?: string; appendPathDirs?: string[] } = {}
): NodeJS.ProcessEnv {
  // Build the ordered list of directories to guarantee are at the front of
  // PATH: the running Node binary directory first (so npm .cmd shims on
  // Windows that invoke bare "node" find the correct binary even when the
  // host was GUI-launched without a nodejs entry on PATH), then the agent
  // wrapper/shim directory. Using process.execPath as the default means
  // every call site — detectAgents, connection tests, and chat runs —
  // consistently reaches the correct Node binary without each caller
  // having to duplicate the dirname(process.execPath) prepend
  // independently.
  //
  // `appendPathDirs` adds the user toolchain bin dirs (Homebrew,
  // ~/.bun/bin, version-manager dirs, …) to the END of PATH so a resolved
  // binary's shebang interpreter is findable at spawn time even when the
  // host's own PATH is minimal (GUI launch). Without this, an agent whose
  // shebang is `#!/usr/bin/env bun` resolves but the version probe / run
  // spawn fails with exit 127 ("env: bun: No such file or directory"), so
  // detection wrongly marks it unavailable. Defaults to the real
  // toolchain dirs; tests pass [] for determinism.
  const toPrepend = [...(nodeBinDir ? [nodeBinDir] : []), ...launch.childPathPrepend];
  if (toPrepend.length === 0 && appendPathDirs.length === 0) return env;
  const pathKey = pathEnvKey(env);
  const existing = typeof env[pathKey] === 'string' ? (env[pathKey] as string) : '';
  const existingParts = existing.split(delimiter).filter((e) => e.length > 0);
  return { ...env, [pathKey]: dedupePathEntries([...toPrepend, ...existingParts, ...appendPathDirs]).join(delimiter) };
}

// Case-insensitive key lookup — Windows uses 'Path', not 'PATH'. Using
// env.PATH directly would be undefined on Windows, yielding a
// one-entry PATH that contains only toPrepend and discards all system
// paths. Find the actual key name so we update in place rather than
// adding a conflicting duplicate key.
function pathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
}

function normalizePathEntry(p: string): string {
  const trimmed = trimCharsEnd({ text: p, chars: '/\\' });
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

// Keep the first spelling of each directory (trailing separators ignored,
// case-insensitive on Windows).
function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of entries) {
    const n = normalizePathEntry(entry);
    if (!seen.has(n)) {
      seen.add(n);
      merged.push(entry);
    }
  }
  return merged;
}
