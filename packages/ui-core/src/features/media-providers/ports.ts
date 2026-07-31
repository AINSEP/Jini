import type { MediaProviderMap } from './types.js';

/**
 * The daemon-side transport this tab needs: reading the server's current
 * provider credentials and persisting the operator's local edits back to it.
 * Genuinely host-owned — the origin called its own daemon's media-provider
 * config endpoints (`fetchMediaProvidersFromDaemon`/`syncMediaProvidersToDaemon`
 * in `App.tsx`). This feature ships only a fake in `dependencies.ts`; a real
 * host supplies its own implementation (same convention as
 * `ProjectLocationsPort`/`SkillsPort`).
 */
export interface MediaProvidersPort {
  /**
   * The server's current provider credentials. Called on mount and on
   * reload.
   *
   * Resolves `null` when the daemon could not be reached at all — as opposed
   * to reached and managing nothing (`{}`). `mergeDaemonProviders` treats
   * those two outcomes very differently (see `rules.ts`'s doc comment):
   * `null` leaves local edits untouched, `{}` is a real answer that can drop
   * stale local markers. A host implementation MUST preserve this
   * distinction rather than collapsing an unreachable daemon to `{}` — doing
   * so would make a transient network blip read as "the server manages
   * nothing" and wipe local edits that only `null` protects.
   */
  fetchMediaProviders(): Promise<MediaProviderMap | null>;

  /**
   * Persists `providers` as the full set of daemon-held credentials and
   * resolves the authoritative copy afterward — same "save the whole set,
   * get the truth back" shape as `ProjectLocationsPort.saveLocations`.
   *
   * REJECTS on failure — unlike `ExecutionPort.testConnection`, there is no
   * "reached but declined" outcome worth modelling as a value here; a save
   * either persists or it doesn't.
   */
  saveMediaProviders(providers: MediaProviderMap): Promise<MediaProviderMap>;
}
