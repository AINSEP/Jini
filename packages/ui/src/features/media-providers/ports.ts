/** Catalog policy is UI-owned; the shared contract lives once in core. */
export type { MediaProviderCatalogPolicy } from '@jini-ai/core';

import type { MediaProviderCredentials, MediaProviderMap } from './types.js';

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
   * Serialization only orders THIS tab's writes. A whole map from a tab opened
   * earlier still omits a key another window saved since, and omission deletes.
   * A host keeps this shape only if it can make the write conditional on what
   * the tab last read (its last-read revision) and refuse a stale one; otherwise
   * it implements {@link MediaProviderRowsPort} instead, which never needs one.
   */
  saveMediaProviders(providers: MediaProviderMap): Promise<MediaProviderMap>;
}

/** The operator-editable fields of one provider; server markers never travel back. An omitted `apiKey` keeps the stored key. */
export type MediaProviderFields = Pick<MediaProviderCredentials, 'apiKey' | 'baseUrl' | 'model'>;

/**
 * The per-provider alternative to {@link MediaProvidersPort}: the same read, and one write per
 * provider instead of a whole-map replace. A save sends only the provider that changed and a
 * removal names the provider it removes, so another window's write to a different provider can
 * never be undone by this tab, and deletion is never inferred from a provider's absence.
 *
 * Both writes REJECT on failure and resolve the server's authoritative map afterward (markers only),
 * like `saveMediaProviders`. `useMediaProvidersTab` still issues one write at a time.
 */
export interface MediaProviderRowsPort {
  /** Same contract as {@link MediaProvidersPort.fetchMediaProviders}, including `null` for unreachable. */
  fetchMediaProviders(): Promise<MediaProviderMap | null>;
  /** Merges `fields` into one provider's stored credentials; no other provider is touched. */
  patchProvider(required: { providerId: string; fields: MediaProviderFields }, optional?: Record<string, never>): Promise<MediaProviderMap>;
  /** Deletes exactly one provider's stored credentials. */
  removeProvider(required: { providerId: string }, optional?: Record<string, never>): Promise<MediaProviderMap>;
}

/** Either transport the media-providers tab can drive. */
export type AnyMediaProvidersPort = MediaProvidersPort | MediaProviderRowsPort;
