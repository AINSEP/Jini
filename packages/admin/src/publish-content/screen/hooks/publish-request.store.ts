import { useSyncExternalStore } from "react";

/**
 * @file The publish-criteria tool / WebMCP plan §4 S2 — the one
 * way anything OTHER than a person's own click opens the Publish dialog: `requestPublish(criteria)`.
 * An app-level store, not component state, because the three callers plan §0 lists (the Dashboard
 * button, the chat capability relayed through the host app's root hooks, and the WebMCP projection landing in
 * S5) are none of them the component that renders the dialog — the host's app root is, at the top of the tree,
 * and it has no props route back down from any of the three.
 *
 * State is instance-owned: the host creates ONE store with {@link createPublishRequestStore} at its
 * app root and every caller reads that instance, so two hosts (or two tests) never share a request.
 * The host hands in its publish-to-live flag reader (`isPublishToLiveAvailable`, from the instance it
 * made with `createPublishToLiveAvailabilityStore`) and the two settled results it reports when the
 * dialog never plans (`unplannedResult`) or never opens because this is the live site
 * (`liveSiteResult`). The criteria, scope and result shapes are the host's publish-content dialog
 * contract, so this store is generic over them.
 *
 * ## What this store is not
 *
 * It never calls a port, never plans, never publishes. the host's app root reads {@link usePublishRequest} to
 * decide whether to mount `PublishContentDialog` at all, and hands the request's own
 * {@link OpenPublishRequest.resolve} to that dialog's `onPlanned` prop — the dialog is what actually
 * plans (`use-publish-content-confirm.hooks.ts`), this store only remembers that a request is open and
 * carries the promise a caller is waiting on back to whoever asked.
 *
 * ## Why `resolve` travels ON the request, not as a fourth export
 *
 * `usePublishRequest()` already hands the host's app root everything a fresh mount of the dialog needs
 * (`requestId`, `criteria`); putting the matching `resolve` right there too means the host's app root wires
 * `onPlanned={request.resolve}` with no way to call the WRONG request's resolver — there is only ever
 * one in scope, and `key={request.requestId}` remounts the dialog fresh for a new one anyway.
 *
 * ## Why a still-open request is resolved, not dropped, when superseded
 *
 * A second `requestPublish` call before the first ever plans (a fast second chat message, say) would
 * otherwise leave the first caller's promise pending forever — the model that asked would hang until
 * whatever timeout wraps the call. Settling it with the same "opened, not yet planned" shape
 * {@link closePublishRequest} uses costs nothing and means every promise this module ever hands out
 * settles.
 */

/** One open ask to publish something, plus the resolver for the promise {@link requestPublish}
 *  returned when this request was made. */
export interface OpenPublishRequest<Criteria, Scope, Result> {
  /** Distinguishes one ask from the next — the host's app root's `key` for remounting `PublishContentDialog`
   *  fresh per request, so a stale instance can never call a newer request's `resolve`. */
  readonly requestId: string;
  readonly criteria: Criteria;
  /** `plan-publish-sections-2026-09-25.md` §2 S2 — a section button's ask, e.g. `{entityTypes:
   *  ["page"]}`. `undefined` for the Dashboard's own "Publish all content" (plan §0 caller 1) and for
   *  chat/WebMCP's `criteria`-only asks, which do not narrow what gets staged, only what starts
   *  ticked — see the publish-content dialog contract's `PublishScope` header for why the two are kept separate. */
  readonly scope?: Scope | undefined;
  /** Settles the promise {@link requestPublish} returned for THIS request. Wired as the dialog's
   *  `onPlanned` at the App level — see this file's header. Calling it does not close the dialog;
   *  {@link closePublishRequest} is the only thing that does that. */
  readonly resolve: (result: Result) => void;
}

/** `useSyncExternalStore`'s required SSR snapshot. This admin has no SSR entry point (same posture
 *  the host router's server route snapshot documents for the identical reason); `null` is the same
 *  "nothing open yet" state a fresh tab starts in either way. */
function getServerSnapshot(): null {
  return null;
}

/** One app-level publish-request store; see this file's header. */
export interface PublishRequestStore<Criteria, Scope, Result> {
  /**
   * Opens the Publish dialog at App level with `criteria` as its starting selection, and returns a
   * promise that settles once the dialog has planned against them (or, if nothing ever plans, once the
   * dialog closes or a newer request replaces this one — see this file's header).
   *
   * Never itself publishes anything — see this file's header for the full division of labour.
   *
   * @param scope Publish sections plan §2 S2 — see {@link OpenPublishRequest.scope}.
   * @complexity O(listeners) to notify subscribers; O(1) otherwise.
   */
  requestPublish(criteria: Criteria, scope?: Scope): Promise<Result>;
  /**
   * Closes whatever request is open — wired as the dialog's `onCancel` at the App level — settling its
   * promise first if it hadn't already settled via `onPlanned`. A no-op with nothing open (e.g. the
   * Dashboard's own dialog closing after S1's un-criteria'd `requestPublish({})`, resolved already by
   * its own `onPlanned` once it planned).
   */
  closePublishRequest(): void;
  /** The currently open request, or `null` — what the host's app root mounts the Publish dialog from. */
  usePublishRequest(): OpenPublishRequest<Criteria, Scope, Result> | null;
}

/** What the host hands {@link createPublishRequestStore}. */
export interface PublishRequestStoreHost<Result> {
  /** The host's publish-to-live flag reader (see `publish-availability.store.ts`), read on every ask. */
  isPublishToLiveAvailable: () => boolean;
  /** What a request that never got planned resolves with — a superseded request, or one the
   *  operator closed before anything plans. Called fresh for each settle. */
  unplannedResult: () => Result;
  /** What any ask to publish resolves with on the live site — the dialog never opens there. */
  liveSiteResult: () => Result;
}

/**
 * Creates the host's ONE publish-request store; see {@link PublishRequestStoreHost}.
 *
 * @complexity O(1).
 */
export function createPublishRequestStore<Criteria, Scope, Result>(
  { isPublishToLiveAvailable, unplannedResult, liveSiteResult }: PublishRequestStoreHost<Result>,
  _options: Record<string, never> = {},
): PublishRequestStore<Criteria, Scope, Result> {
  let openRequest: OpenPublishRequest<Criteria, Scope, Result> | null = null;
  let requestCounter = 0;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): OpenPublishRequest<Criteria, Scope, Result> | null {
    return openRequest;
  }

  return {
    requestPublish(criteria, scope) {
      // The live site has nowhere to publish to (`publish-availability.store.ts`), so the dialog never
      // opens there — whether the ask came from a button, the `?publish=` deep link, chat or WebMCP.
      if (!isPublishToLiveAvailable()) return Promise.resolve(liveSiteResult());

      // A still-open request is superseded, not dropped — see this file's header.
      openRequest?.resolve(unplannedResult());

      requestCounter += 1;
      const requestId = `publish-request-${requestCounter}`;
      return new Promise<Result>((resolve) => {
        openRequest = { requestId, criteria, scope, resolve };
        notify();
      });
    },
    closePublishRequest() {
      const current = openRequest;
      if (current === null) return;
      openRequest = null;
      notify();
      current.resolve(unplannedResult());
    },
    usePublishRequest() {
      return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
  };
}
