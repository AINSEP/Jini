/**
 * @file What the host injects into the collections screen's rules beyond each call's own data: its
 * collections dictionary translator, its admin request error class (as a predicate) with its
 * base-case error copy, and its version-conflict test. Nothing in this folder imports a host module;
 * the host binds one {@link CollectionsHostKit} at its composition root (see `rules.ts`'s
 * `bindCollectionsRules`).
 */

/** The fields the collections rules read off a failed admin request. */
export interface CollectionsApiErrorLike extends Error {
  readonly status: number;
}

/** Everything the collections rules receive from the host. */
export interface CollectionsHostKit {
  /** The host's collections dictionary translator for one locale. */
  translate: (required: { locale: string; key: string }) => string;
  /** Whether `e` is the error class the host's admin `request` throws; a plain `Error` with the same
   *  fields must answer `false`. */
  isApiError: (e: unknown) => e is CollectionsApiErrorLike;
  /** The host's shared base-case copy for a thrown request error, falling back to `fallback`. */
  describeApiError: (required: { e: unknown; fallback: string }) => string;
  /** Whether `error` is a lost compare-and-set (`409 VERSION_CONFLICT`). */
  isVersionConflict: (required: { error: unknown }) => boolean;
}
