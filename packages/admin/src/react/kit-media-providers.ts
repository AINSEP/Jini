/**
 * @file Types for the media-providers editor slot of the admin UI kit. They are local copies of the
 * shapes the host's editor implements, so this package's published types pin no UI library.
 */
import type { MediaProviderCatalogPolicy, MediaProviderOption } from '@jini-ai/core';

/**
 * One provider's stored credentials.
 *
 * TWO KINDS OF "PRESENT" live in this shape, and conflating them is the bug
 * this whole module exists to avoid:
 *
 * - **Recoverable fields** (`apiKey`, `baseUrl`, `model`) are real values the
 *   operator typed and that can be re-sent.
 * - **Markers** (`apiKeyConfigured`, `apiKeyTail`) are the server saying "a key
 *   exists here, but you don't get to see it". They prove configuration
 *   without carrying anything usable.
 *
 * An entry holding ONLY markers is configured but carries no data — see
 * `isMarkerOnlyEntry`.
 */
export interface MediaProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Server-side marker: a key is stored, not disclosed. */
  apiKeyConfigured?: boolean;
  /** Server-side marker: last few characters, for display only. */
  apiKeyTail?: string;
  /** Free-form provenance tag, host-defined. */
  source?: string;
}

/** Credentials keyed by provider id. */
export type MediaProviderMap = Record<string, MediaProviderCredentials>;

/**
 * Result of the tab's daemon read, surfaced while the initial fetch or a
 * manual reload is in flight. `'unreachable'` mirrors
 * `MediaProvidersPort.fetchMediaProviders`'s `null` result as a renderable
 * state — the daemon was never reached, distinct from `'ok'` (reached; local
 * state is now reconciled against whatever it reported, including managing
 * nothing at all). There is no `'error'` member: the port's `fetchMediaProviders`
 * never rejects — see its own doc comment for why unreachable is a value,
 * not a failure, in this contract.
 */
export type MediaProvidersLoadState = { status: 'loading' } | { status: 'ok' } | { status: 'unreachable' };

/**
 * Result of `MediaProvidersPort.saveMediaProviders`, surfaced near whichever
 * action triggered it (an explicit Save, or Clear's implicit save-on-clear).
 * Same "async edge result" idiom as `ConnectionTestState`/`AgentScanState` in
 * the execution tab's types — one shared shape for "what happened the last
 * time this async edge ran" across this package.
 */
export type MediaProvidersSaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'save-error'; message: string };

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

/** The operator-editable fields of a provider entry. Server markers
 *  (`apiKeyConfigured`/`apiKeyTail`) are deliberately excluded — they only
 *  ever arrive FROM the daemon, never typed by the operator; see
 *  `MediaProviderCredentials`'s own doc comment for the recoverable-vs-marker
 *  distinction this narrows around. */
export type MediaProviderEditPatch = Pick<MediaProviderCredentials, 'apiKey' | 'baseUrl' | 'model'>;

/**
 * The per-provider alternative to {@link MediaProvidersPort}: the same read, and one write per provider
 * instead of a whole-map replace, so another window's write to a different provider is never undone
 * and deletion is never inferred from absence. Both writes REJECT on failure and resolve the server's
 * authoritative map afterward (markers only). A local copy of the editor's rows-port shape, so this
 * package's types pin no UI library; `kit-media-providers.types.test.ts` pins the two together.
 */
export interface MediaProviderRowsPort {
  /** Same contract as {@link MediaProvidersPort.fetchMediaProviders}, including `null` for unreachable. */
  fetchMediaProviders(): Promise<MediaProviderMap | null>;
  applyProviderChanges(required: { removes: readonly string[]; patches: readonly { providerId: string; fields: MediaProviderEditPatch }[] }, optional?: Record<string, never>): Promise<MediaProviderMap>;
  /** Merges `fields` into one provider's stored credentials; no other provider is touched. */
  patchProvider(required: { providerId: string; fields: MediaProviderEditPatch }, optional?: Record<string, never>): Promise<MediaProviderMap>;
  /** Deletes exactly one provider's stored credentials. */
  removeProvider(required: { providerId: string }, optional?: Record<string, never>): Promise<MediaProviderMap>;
}

export interface UseMediaProvidersTabOptions {
  port: MediaProvidersPort;
  /** Identity rules shared by catalog rows, local edits and daemon responses. Stable while mounted. */
  catalogPolicy: MediaProviderCatalogPolicy;
  /** Host-persisted local edits from before this tab mounted (e.g. the
   *  host's own locally-cached config, read before the daemon round-trip
   *  completes). Defaults to none. Threaded into the initial
   *  daemon-reconciliation merge unchanged, so a first-run migration
   *  (`shouldSyncLocalProvidersToDaemon`) has real local data to detect. */
  initialProviders?: MediaProviderMap | undefined;
}

export interface UseMediaProvidersTabResult {
  /** The full working set: local edits layered over whatever the daemon last
   *  reported. Reflects `initialProviders` until the first load settles. */
  providers: MediaProviderMap;
  load: MediaProvidersLoadState;
  save: MediaProvidersSaveState;
  hasAnyConfigured: boolean;
  /** Provider ids with an edit not yet flushed to the daemon. A `reload()`
   *  preserves exactly these over whatever the server reports for them — see
   *  `mergeDaemonProviders`'s `preserveLocalProviderIds`. */
  pendingProviderIds: ReadonlySet<string>;
  updateProvider: (providerId: string, patch: MediaProviderEditPatch) => void;
  /** Drops the provider entirely (recoverable fields AND server markers) and
   *  immediately persists the removal. Clear is treated as a decisive action
   *  — same as the origin's confirm-then-clear flow — not a pending edit an
   *  operator might still back out of via `reload()`. */
  clearProvider: (providerId: string) => void;
  /** Flushes every current provider to the daemon. */
  saveChanges: () => void;
  /** Re-reads the daemon's copy and reconciles it against local state. */
  reload: () => void;
}

/** The media-providers editor and its pure rules; the host implements them, admin's ProvidersTab renders them. */
export interface AdminMediaProvidersKit {
  useMediaProvidersTab(options: UseMediaProvidersTabOptions): UseMediaProvidersTabResult;
  readonly rules: {
    sortProvidersByConfigured<T extends { id: string; label: string }>(required: { catalog: readonly T[]; providers: MediaProviderMap | null | undefined }, optional?: { pinnedIds?: readonly string[] | undefined }): readonly T[];
    isEntryPresent(required: { entry: MediaProviderCredentials | null | undefined }, optional?: Record<string, never>): boolean;
    isMarkerOnlyEntry(required: { entry: MediaProviderCredentials | null | undefined }, optional?: Record<string, never>): boolean;
    maskedKeyLabel(required: { entry: MediaProviderCredentials | null | undefined }, optional?: Record<string, never>): string | null;
    isProviderBaseUrlInvalid(required: { entry: MediaProviderCredentials | null | undefined }, optional?: Record<string, never>): boolean;
    invalidBaseUrlProviderIds(required: { providers: MediaProviderMap | null | undefined }, optional?: Record<string, never>): readonly string[];
  };
}

export type { MediaProviderCatalogPolicy, MediaProviderOption };
