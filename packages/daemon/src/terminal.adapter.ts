/**
 * Opt-in native PTY adapter. Import from `@jini-ai/daemon/terminal` and inject
 * `() => loadRealSpawnPty({})` into the session manager's `loadSpawnPty` port.
 */
import { loadOptionalPeer } from '@jini-ai/core/optional-peer';
import { createRequire } from 'node:module';
import type { IPty } from 'node-pty';
import {
  ensureSpawnHelperExecutable,
  spawnHelperCandidatePaths,
  type PtyProcess,
  type PtySpawn,
  type PtySpawnOptions,
} from '@jini-ai/platform';

const daemonRequire = createRequire(import.meta.url);

/** Adapts a real `node-pty` `IPty` to `@jini-ai/platform`'s narrower `PtyProcess` port — explicit per-member mapping rather than relying on structural assignability, matching this package's established "explicit adapter, no implicit coercion" convention (e.g. `agent-executor.ts`'s `toStringEnvRecord`). */
function toPtyProcess(pty: IPty): PtyProcess {
  return {
    onData: (cb) => {
      pty.onData(cb);
    },
    onExit: (cb) => {
      pty.onExit(cb);
    },
    write: (input) => pty.write(input),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => pty.kill(signal),
  };
}

/**
 * The real, `node-pty`-backed {@link PtySpawn}. Dynamically imports
 * `node-pty` (mirroring OD's origin `await import('node-pty')`, not a
 * static top-level import) so a host process whose platform/environment
 * lacks a usable `node-pty` addon can still boot — only an actual
 * `terminal.create` call fails, cleanly, rather than crashing at
 * module-eval time. Before the first spawn, repairs `node-pty`'s bundled
 * `spawn-helper` binary's executable bit (pnpm unpacks it non-executable —
 * see `@jini-ai/platform`'s `terminal.ts` module doc for the full story) via
 * that package's own `spawnHelperCandidatePaths`/`ensureSpawnHelperExecutable`,
 * but with the resolver anchored at **this** module
 * (`createRequire(import.meta.url)` here, not `@jini-ai/platform`'s own
 * default): `@jini-ai/platform` deliberately does not depend on `node-pty`, so
 * its default `require.resolve('node-pty')` would not find the copy this
 * package (`@jini-ai/daemon`) actually declares — this is exactly the
 * resolver injection seam `spawnHelperCandidatePaths` was built for.
 * @throws A feature-specific load error with the original resolution/ABI error as `cause`.
 * @complexity O(1) adapter work; module loading and helper repair belong to the platform.
 */
export async function loadRealSpawnPty(_requiredArgs: Record<string, never>, _optionalArgs: Record<string, never> = {}): Promise<PtySpawn> {
  ensureSpawnHelperExecutable(
    spawnHelperCandidatePaths({ resolve: (specifier) => daemonRequire.resolve(specifier) }),
  );
  const nodePty = await loadOptionalPeer({ feature: 'Interactive terminals', dependency: 'node-pty', load: () => import('node-pty') });
  return (shell: string, args: string[], options: PtySpawnOptions) =>
    toPtyProcess(nodePty.spawn(shell, args, options));
}

