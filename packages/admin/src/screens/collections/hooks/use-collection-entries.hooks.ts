import type { AdminContentType, AdminEntry } from "../api/collections-api.types.js";
import { useFetchQuery } from "../../../react/kit.js";
import { KEYS } from "../rules.js";
import type { CollectionsHostKit } from "../collections-host-kit.js";
import type { CollectionEntriesPort } from "./collection-entries-port.hooks.js";

/**
 * @file Everything the collections entries LIST does, so `CollectionEntries.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error strings. Naming follows
 * `hooks/use-settings-slice.hooks.ts` and `hooks/use-dirty-guard.hooks.ts`: `use-<thing>.hooks.ts`.
 * Feature-local because nothing outside `features/collections` needs it; promote to `src/hooks/`
 * only when a second feature actually does.
 *
 * `port`/`locale` are injected — see `collection-entries-port.hooks.ts` — rather than reaching
 * `lib/api`/`useAdminLocale()` directly, so a test can describe the load outcome against
 * `createFakeCollectionEntriesPort` instead of stubbing global `fetch`. The host's `useWiredCollectionEntries`
 * is the pair `CollectionEntries.tsx` actually mounts.
 *
 * `t` (standing i18n rule, 2026-08-11 — see `use-collections.hooks.ts`'s identical note): injected
 * alongside `port`/`locale` so `CollectionEntries.tsx` sources its UI copy from this hook instead of
 * its own `useAdminLocale()`/`COLLECTIONS_DICT` import. `collections-i18n.ts`'s own `t({ locale, key })`
 * — aliased `translate` here to avoid colliding with this file's bound `({ key }) => string` closure —
 * now arrives through `deps.kit.translate` (with the host's request-error copy, `deps.kit.describeApiError`) for this hook's OWN error string (pure, takes `locale`
 * explicitly, not a host reach).
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the combined content-type + entries read (still one
 * `Promise.all`, since the screen genuinely needs both before it can render) is now one
 * `useFetchQuery` keyed on `KEYS.entries({ contentTypeKey })` — a child of `use-collections.hooks.ts`'s
 * `KEYS.list`, so a content-type lifecycle/field change refreshes this list too. `use-collection-
 * entry-editor.hooks.ts`'s `save()`/`toggleLifecycle()` also `invalidates: [KEYS.entries({ contentTypeKey: key })]`
 * directly (not by nesting a shared key under it — see `rules.ts`'s `KEYS` doc for why that nesting
 * was tried and reverted), so saving one entry refreshes this list too.
 */

export interface CollectionEntriesController {
  contentType: AdminContentType | null | undefined;
  entries: AdminEntry[] | null;
  error: string | null;
  /** Bound translator — `CollectionEntries.tsx`'s only source of UI copy; see this file's own
   *  header. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

export interface CollectionEntriesDependencies {
  port: CollectionEntriesPort;
  locale: string;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  /** The host's collections dictionary and request-error copy — see `collections-host-kit.ts`. */
  kit: CollectionsHostKit;
}

export function useCollectionEntries(
  { contentTypeKey, port, locale, t, kit }: { contentTypeKey: string } & CollectionEntriesDependencies,
  _optional: Record<string, never> = {},
): CollectionEntriesController {

  const list = useFetchQuery({
    key: KEYS.entries({ contentTypeKey: contentTypeKey }),
    fetch: async () => {
      const [typesResult, entriesResult] = await Promise.all([
        port.listContentTypes(),
        port.listEntries({ type: contentTypeKey }),
      ]);
      return {
        contentType: typesResult.items.find((entry) => entry.key === contentTypeKey) ?? null,
        entries: entriesResult.items,
      };
    },
  });

  const contentType: AdminContentType | null | undefined = list.data?.contentType;
  const entries: AdminEntry[] | null = list.data?.entries ?? null;
  const error = list.error ? kit.describeApiError({ e: list.error, fallback: kit.translate({ locale: locale, key: "failed to load entries" }) }) : null;

  return { contentType, entries, error, t };
}

