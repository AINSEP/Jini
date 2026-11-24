import { useCallback as useQueryFetchCallback } from "react";
import type { AdminQueryKit } from "../../../react/kit.js";

import type { AdminAnalyticsHit } from "../api/analytics-api.types.js";
import type { AnalyticsPort } from "./analytics-port.hooks.js";

/**
 * @file Everything the Analytics screen does, so `Analytics.tsx` is only markup.
 *
 * Extracted verbatim — same state, same effect, same error string. Naming follows
 * `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because nothing
 * outside `screens/analytics` needs it.
 *
 * `port` is injected — see `analytics-port.hooks.ts` — rather than importing `lib/api` directly,
 * so a test can describe the recent-hits list against `createFakeAnalyticsPort` instead of
 * stubbing global `fetch`. The zero-argument `useWiredAnalytics()` pair that `Analytics.tsx`
 * actually mounts is the host's: it binds the host's port and the host's admin-locale hook, then
 * passes the result to `Analytics` as its required `useAnalyticsHook` prop.
 *
 * `t` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that hook,
 * not its own `useAdminLocale()`/dictionary import): injected with the port and pre-bound to the
 * locale, accepting a `{ key }` object — the same injection pattern `features/posts/hooks/use-post-editor.hooks
 * .ts` established for this rule. `useAdminLocale()` and `analytics-i18n`'s `t` are called/
 * read only inside the host's wired hook, exactly where `Analytics.tsx` used to call them
 * directly before this change. `useAnalytics` itself never calls `t` internally (no translated
 * error strings originate here) — it exists solely to hand the bound translator through to the
 * component, same as the port.
 */

export interface AnalyticsController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  hits: AdminAnalyticsHit[] | null;
  error: string | null;
  /** Bound translator — `key` already resolved against the caller's locale, so `Analytics.tsx`
   *  never imports `useAdminLocale`/`analytics-i18n` itself. See this file's header. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

/**
 * @complexity Time/space: O(1) — one fetch on mount, no iteration of its own.
 */
export function useAnalytics({ port, t, useFetchQueryHook }: { port: AnalyticsPort; t: (required: { key: string }, optional?: Record<string, never>) => string; useFetchQueryHook: AdminQueryKit['useFetchQuery'] }, _optional = {}): AnalyticsController {
  const queryFetch = useQueryFetchCallback(async () => {
    try { return (await port.listRecentAnalyticsHits()).hits; }
    catch (error) { if (error instanceof Error) throw error; throw new Error("failed to load recent hits", { cause: error }); }
  }, [port]);
  const query = useFetchQueryHook({ key: ["analytics", "recent-hits"], fetch: queryFetch }, { staleTime: 0 });
  const hits = query.data ?? null;
  const error = query.error?.message ?? null;

  return { hits, error, t };
}
