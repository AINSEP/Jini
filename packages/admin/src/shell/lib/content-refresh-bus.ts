/**
 * @file The seam between "content changed somewhere else" and "the mounted content screens re-read
 * it", so an operator sees a taxonomy the assistant just created without reloading the page.
 *
 * ## The bug this exists for
 *
 * `taxonomy_create_taxonomy` is agent-callable. An operator with the Categories & Tags screen open
 * beside the assistant dock asks for a taxonomy, the chat says it was created, and the list beside
 * it keeps rendering what it fetched at mount. Ctrl-R is the only way to see the write land, which
 * reads as the tool having silently done nothing.
 *
 * ## Why a sibling of `settings-refresh-bus.ts` rather than a generalization of it
 *
 * The two are the same *shape* (a fire-and-forget name broadcast) but not the same *vocabulary*.
 * This one carries content resource names — `"taxonomy"` — and that one carries settings namespaces
 * — `"core.language"`. Folding them into one bus would put both vocabularies in one string space
 * with no way to tell them apart, so every settings slice would re-read on a taxonomy write and
 * every content screen on a language change. The `null` "unknown, refresh everything" case makes
 * that worse, not better: a merged bus's `null` means *both* vocabularies refresh.
 *
 * Extracting a shared `createRefreshBus()` factory would remove the duplicated listener-`Set`
 * boilerplate without merging the vocabularies, but it would mean editing a working
 * `settings-refresh-bus.ts` and its six live call sites for ~25 lines of savings. Note that the
 * other two buses in `lib/` (`assistant-dock-bus.ts`, `playground-render-target-bus.ts`) would NOT
 * be candidates for that factory — both hold state and expose a `getSnapshot` for
 * `useSyncExternalStore`, so this makes two instances of the fire-and-forget shape, not four. Two
 * is where the factory is still speculative.
 *
 * ## What it deliberately does NOT carry
 *
 * Only resource names — never rows, ids, or payloads. A subscriber re-reads through its own normal
 * authorized path (`useInvalidate()` on its own query key, which refetches through the same
 * `port`/`api` call it used at mount), so this bus can never become a channel that hands a
 * component data it would not have been allowed to fetch. That property is inherited deliberately
 * from `settings-refresh-bus.ts` and is what keeps a future SSE publisher simple: it never has to
 * reason about whether a payload is safe for this principal, because there is no payload.
 */

/**
 * A refresh notification. `null` means "content changed, but which resources is not known" — every
 * subscriber should re-read. Publishers that DO know narrow it, so an unrelated screen does not
 * refetch.
 */
export type ContentRefreshScope = readonly string[] | null;

type Listener = (scope: ContentRefreshScope) => void;

const listeners = new Set<Listener>();

/**
 * Registers `listener` and returns its unsubscribe function.
 *
 * @returns A disposer; call it from the subscriber's effect cleanup. A listener that outlives its
 * component would invalidate a cache on behalf of a screen that is no longer mounted.
 * @complexity O(1).
 */
export function subscribeToContentRefresh({ listener }: { listener: Listener }, _optional: Record<string, never> = {}): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notifies every subscriber that persisted content may have moved.
 *
 * Never throws, for the same reason `publishSettingsRefresh` does not: publishers are
 * transport/lifecycle code (a run ending, and later an SSE frame) with no sensible way to handle
 * one screen's failure, and one broken subscriber must not suppress the rest.
 *
 * @param resources - The resource names known to have changed, or omitted for "unknown, refresh
 *   all". An empty array is normalized to `null` — a publisher that knew of no resources is saying
 *   "no information", not "only these zero", and must not be read as a scope that matches nothing.
 * @complexity O(n) in the listener count.
 */
export function publishContentRefresh(resources?: readonly string[]): void {
  const scope: ContentRefreshScope = resources && resources.length > 0 ? resources : null;
  for (const listener of [...listeners]) {
    try {
      listener(scope);
    } catch (error) {
      console.error("[admin] content refresh listener failed", error);
    }
  }
}

/**
 * True when a refresh notification names `resource`, or names nothing at all (the bus's "unknown,
 * refresh everything" case). Lives here rather than in each subscriber so the `null` case cannot be
 * read as "matches nothing" by a screen that forgot about it — which would silently drop exactly
 * the notification the assistant-run publisher sends, since that publisher never narrows.
 *
 * @complexity O(n) in the notification's own resource list (typically 0-1 entries).
 */
export function contentRefreshApplies({ scope, resource }: { scope: ContentRefreshScope; resource: string }, _optional: Record<string, never> = {}): boolean {
  return scope === null || scope.includes(resource);
}

/** Test seam — drops every listener. Not used in production code. */
export function resetContentRefreshBus(): void {
  listeners.clear();
}
