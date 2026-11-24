/**
 * @file What the host injects into the taxonomy screen's hooks and rules beyond each hook's port
 * and locale: its taxonomy dictionary translator, its admin request error class (as a predicate)
 * with its base-case error copy, and its admin failure channel. Nothing in this folder imports a
 * host module; the host binds one {@link TaxonomyHostKit} at its composition root and passes it to
 * every hook.
 */

import type { useFetchMutation, useFetchQuery, useInvalidate } from "../../react/kit.js";
import type { useTaxonomyHtmlEmbed } from "./hooks/use-taxonomy-html-embed.hooks.js";

/** The fields the taxonomy rules read off a failed admin request. */
export interface TaxonomyApiErrorLike extends Error {
  readonly status: number;
  readonly code?: string | undefined;
  readonly body?: Record<string, unknown> | undefined;
}

/** The host's request-error knowledge the pure taxonomy rules need. */
export interface TaxonomyErrorKit {
  /** Whether `e` is the error class the host's admin `request` throws. The blocked/already-gone
   *  classifiers narrow on this, so a plain `Error` with the same fields must answer `false`. */
  isApiError: (e: unknown) => e is TaxonomyApiErrorLike;
  /** The host's shared base-case copy for a thrown request error, falling back to `fallback`. */
  describeApiError: (required: { e: unknown; fallback: string }) => string;
}

/** One screen-local failure the taxonomy screen reports to the host's admin failure channel. */
export interface TaxonomyLocalFailure {
  message: string;
  action: string;
  step: string;
  cause: unknown;
}

/** The host's admin failure channel, as the HTML-embed copy action reads it. */
export interface TaxonomyFailureReporter {
  /** The channel generation before an action starts, so a stale publish is dropped. */
  getGeneration: () => number;
  /** A clipboard refusal is the browser's own answer, not a failure worth reporting. */
  isClipboardRefusal: (required: { error: unknown }) => boolean;
  publishLocalFailure: (failure: TaxonomyLocalFailure, optional: { generation: number }) => void;
}

/** Everything the taxonomy hooks receive from the host beyond their port and locale. */
export interface TaxonomyHostKit extends TaxonomyErrorKit {
  /** The host's taxonomy dictionary translator; the hooks pass the admin locale per call. */
  translate: (required: { locale: string; key: string }) => string;
  failures: TaxonomyFailureReporter;
  /** The host's content-refresh subscription: calls `onRefresh` when an out-of-band write touches `resource`. */
  useContentRefreshSubscription: (required: { resource: string; onRefresh: () => void }) => void;
  /** The HTML-embed copy hook; the host injects `useTaxonomyHtmlEmbed` (or a test double) so
   *  `use-taxonomy` never calls a custom hook it imported directly. */
  useTaxonomyHtmlEmbed: typeof useTaxonomyHtmlEmbed;
  /** The two Trash mutations (`react/kit`'s `useFetchMutation`); the host binds its kit-facade implementation. */
  useFetchMutation: typeof useFetchMutation;
  /** The taxonomy list read (`useFetchQuery`). */
  useFetchQuery: typeof useFetchQuery;
  /** The list-cache invalidator the content-refresh subscription calls (`useInvalidate`). */
  useInvalidate: typeof useInvalidate;
}
