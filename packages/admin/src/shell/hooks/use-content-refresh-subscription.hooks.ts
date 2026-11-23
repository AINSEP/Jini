import { useEffect } from "react";

import { contentRefreshApplies, subscribeToContentRefresh, type ContentRefreshScope } from "../lib/content-refresh-bus.js";

/**
 * @file The one-line adoption path for `lib/content-refresh-bus.ts` — so a list/detail hook does
 * not have to remember the `subscribeToContentRefresh` + `contentRefreshApplies` + cleanup triangle
 * on its own.
 *
 * ## Why this needed generalizing at all
 *
 * `content-refresh-bus.ts` shipped once, for Categories & Tags (2026-08-26, `use-taxonomy.hooks.ts`),
 * and every OTHER agent-writable list screen — Posts, Pages, Media, Forms, Access Tokens — stayed on
 * whatever it fetched at mount. The mechanism was never broken; nothing else was wired to it. That is
 * a "the pattern was not the default" bug, not a "taxonomy forgot something" bug: a hook author reads
 * a sibling hook for the shape to copy, and the sibling that shipped a five-line inline
 * `useEffect(() => subscribeToContentRefresh(...), [invalidate])` block is easy to miss entirely,
 * easier still to copy WRONG (the `null`-means-"refresh everything" case above is exactly the kind of
 * default a hurried copy drops — see `contentRefreshApplies`'s own doc for why treating `null` as
 * "matches nothing" would silently swallow the one notification every finished assistant run actually
 * sends, since `AssistantDock.hooks.tsx`'s publisher never narrows). Extracting the triangle into a
 * hook other hooks call turns "remember to copy this correctly" into "call this with the resource and callback."
 *
 * ## Why a hook, not just re-exporting the bus functions
 *
 * A raw `subscribeToContentRefresh` call still needs an effect (subscribe on mount, unsubscribe on
 * unmount) and the `contentRefreshApplies` filter at every call site — the exact boilerplate this
 * exists to remove. Wrapping both in one hook means a call site cannot skip the cleanup (a listener
 * that outlives its component would fire a state update, or here an `invalidate`/reload call, on a
 * screen that is no longer mounted) or the scope check (an unfiltered subscriber would refetch on
 * every OTHER screen's write too).
 *
 * ## Deliberately generic over "what a refresh means"
 *
 * `onRefresh` is `() => void`, not `invalidate: (key: QueryKey) => void` — this codebase has two
 * shapes of list hook, and both need to compile: `use-media.hooks.ts`/`Jini forms/react/hooks/use-forms-list.hooks.ts`
 * already read through `lib/fetch-query`'s `useFetchQuery`, where "refresh" is
 * `useInvalidate()(KEYS.list)`; `use-posts.hooks.ts`/`use-pages.hooks.ts` predate that migration and
 * hold their list in plain `useState`, where "refresh" is re-running the `port.listX()` call that
 * seeded it. `use-access-tokens.hooks.ts` is a third shape again — it reads through `useFetchQuery`
 * but only to SEED local state once (see that hook's own header), so refreshing it means re-running
 * the same direct `port.*.list()` calls its own `removeToken`/`makeDefault` already use, not
 * invalidating a cache nothing re-reads from after the seed. Accepting a plain callback lets every one
 * of the three keep its own reload mechanics; this hook only owns "when."
 *
 * @param required.resource - This screen's name on the bus (e.g. `POSTS_RESOURCE`) — colocated as a constant
 *   in the feature's own `rules.ts`, matching `TAXONOMY_RESOURCE`'s precedent. Passed as a value, not
 *   read from a wider registry: see `content-refresh-bus.ts`'s own header on why a merged vocabulary
 *   across features is a worse trade than a few duplicated resource-name constants.
 * @param required.onRefresh - Re-reads this screen's own data through its own authorized path. Called with no
 *   arguments and expected to ignore its return value — this hook does not await it, matching every
 *   existing call site's own fire-and-forget reload (`invalidate()`, or a `.then(setState)` promise
 *   chain neither `use-posts.hooks.ts` nor `use-pages.hooks.ts` awaits on remount either).
 * @complexity O(1) to subscribe/unsubscribe; the notification fan-out cost is
 *   `publishContentRefresh`'s, not this hook's.
 */
export function useContentRefreshSubscription({ resource, onRefresh }: { resource: string; onRefresh: () => void }, _options = {}): void {
  useEffect(() => {
    return subscribeToContentRefresh({ listener: (scope: ContentRefreshScope) => {
      if (contentRefreshApplies({ scope, resource })) onRefresh();
    } });
  }, [resource, onRefresh]);
}
