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
   *
   * **Callers MUST NOT overlap two of these.** Whole-map replacement carries
   * no expected-revision, so the implementation has nothing to reject a stale
   * write with: when two are in flight the surviving state is whichever the
   * host happens to handle LAST, which need not be the one issued last. A
   * caller that guards only its own RESPONSE handling still loses — the
   * superseded REQUEST has already rewritten the host. Serialize instead, and
   * build each payload when it is sent rather than when it is queued
   * (`useMediaProvidersTab`'s `persist`/`flushNow` is the reference).
   *
   * Adding an expected-revision parameter would let the host reject staleness
   * outright, but this port is host-implemented, so that is a breaking change
   * and deliberately not taken; caller-side serialization closes the same race
   * without one.
   */
  saveMediaProviders(providers: MediaProviderMap): Promise<MediaProviderMap>;
}
