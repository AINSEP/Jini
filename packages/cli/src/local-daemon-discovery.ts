/**
 * @module local-daemon-discovery
 *
 * The real `discover` callback `resolveDaemonUrl` (`daemon-url.ts`) has always accepted but this
 * package never implemented — see `source-map.md`'s "Deferred" item 1 and its own 2026-07-21
 * investigation, which found `@jini-ai/node-host`'s `createLocalNodeDaemon` wrote nothing anywhere a
 * separate CLI process could read. That daemon side is now built (`@jini-ai/node-host`'s
 * `discoveryFile` config, backed by `@jini-ai/sidecar`'s `daemon-registry.ts`); this module is the
 * matching CLI-side reader: `createLocalDaemonDiscovery(...)` builds a probe over that same
 * on-disk record, verified live (not just present — see `readLiveDaemonRegistryRecord`'s own
 * doc), that plugs directly into `resolveDaemonUrl({ discover })`.
 *
 * Deliberately not wired to a hardcoded default `dataDir`: exactly like `resolveDaemonUrl` itself
 * has no baked-in env var name or default URL, this package has no opinion on where a given
 * product's daemon keeps its data — the caller (whatever wires a `@jini-ai/node-host` daemon and a
 * `@jini-ai/cli`-transport pack together for one product) supplies the same `dataDir` (or an
 * explicit `registryPath`, when `createLocalNodeDaemon`'s own `discoveryFile` was overridden away
 * from its default) to both sides.
 */
import { readLiveDaemonRegistryRecord, resolveDaemonRegistryPath } from '@jini-ai/sidecar';

import type { ResolveDaemonUrlOptions } from './daemon-url.js';

export interface LocalDaemonDiscoveryOptions {
  /**
   * The same `dataDir` the target `createLocalNodeDaemon({ dataDir, ... })` call was given. The
   * registry path is derived from it via `@jini-ai/sidecar`'s `resolveDaemonRegistryPath` — the
   * identical derivation `@jini-ai/node-host` uses for its own `discoveryFile` default. Ignored when
   * `registryPath` is also given.
   */
  dataDir?: string;
  /**
   * The exact registry file path, for when the host overrode `createLocalNodeDaemon`'s
   * `discoveryFile` away from its `dataDir`-derived default. Takes precedence over `dataDir`.
   */
  registryPath?: string;
}

/**
 * @internal Resolve the registry path this discovery probe should read, from whichever of
 * `registryPath`/`dataDir` was supplied.
 */
function resolveRegistryPathFromOptions(options: LocalDaemonDiscoveryOptions): string {
  if (options.registryPath !== undefined) return options.registryPath;
  if (options.dataDir !== undefined) return resolveDaemonRegistryPath(options.dataDir);
  throw new Error('createLocalDaemonDiscovery requires either dataDir or registryPath');
}

/**
 * Build a `resolveDaemonUrl({ discover })`-compatible probe backed by a local, on-disk daemon
 * registry record: reads the record at the resolved registry path, confirms the recording
 * process's pid is still alive (a stale record left behind by a daemon that crashed rather than
 * shut down cleanly is never trusted — see `readLiveDaemonRegistryRecord`), and returns its
 * `url`. Resolves to `null` (never rejects) when no live record is found, so `resolveDaemonUrl`
 * falls through to its own `defaultUrl`/error exactly as if no `discover` had been supplied at
 * all — a missing or stale local daemon is an ordinary, expected outcome here, not a failure.
 *
 * @throws Synchronously, at build time (not when the returned probe is later called), when
 * neither `dataDir` nor `registryPath` is given — there is nothing to resolve a path from, and a
 * probe that silently always discovers nothing would hide a caller's config mistake instead of
 * surfacing it immediately.
 */
export function createLocalDaemonDiscovery(
  options: LocalDaemonDiscoveryOptions,
): NonNullable<ResolveDaemonUrlOptions['discover']> {
  const registryPath = resolveRegistryPathFromOptions(options);
  return async () => {
    const record = await readLiveDaemonRegistryRecord(registryPath);
    return record?.url ?? null;
  };
}
