/**
 * @file `useAdminLocale` — the operator's stored admin locale, shared by every screen through one
 * query cache entry. Everything host-specific is injected: the port (load + filtered refresh), the
 * boot scope, the query hooks, the cache key prefix and the fallback locale.
 *
 * Re-fetches on every relevant refresh notification, not just at mount: a fetch-once hook made a
 * Language change look "stuck". A same-tab save and another tab's server-sent echo both reach the
 * port's filtered `subscribeToSettingsRefresh` identically, so this hook never needs to know which
 * one fired.
 */
import { useCallback, useEffect, useRef } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { AdminLocalePort } from "./admin-locale-port.hooks.js";

/** Everything `useAdminLocale` reads from the host. Bound once at the host's composition root. */
export interface UseAdminLocaleArgs {
  port: AdminLocalePort;
  useBootScope: () => { queryScope: string; checking: boolean };
  useFetchQuery: FetchQueryAdapter["useFetchQuery"];
  useInvalidate: FetchQueryAdapter["useInvalidate"];
  /** Cache key prefix, e.g. `["settings", "<language namespace>"]`; the boot scope is appended. */
  queryPrefix: readonly [string, string];
  /** What screens render until the first read succeeds, and after an initial read fails. */
  fallbackLocale: string;
}

/**
 * The current locale: `fallbackLocale` until the first read resolves, and the previous value
 * after a failed refresh.
 *
 * `port` is captured at mount: a caller that builds a fake on every render must not recreate the
 * subscription. The three injected hooks are called unconditionally on every render.
 *
 * @complexity O(1) per render; one read per scope and per relevant refresh.
 */
export function useAdminLocale(required: UseAdminLocaleArgs, _optional: Record<string, never> = {}): string {
  const { useBootScope, useFetchQuery, useInvalidate, queryPrefix, fallbackLocale } = required;
  const { queryScope, checking } = useBootScope();
  const initialPort = useRef(required.port).current;
  const queryFetch = useCallback(() => initialPort.loadLanguage({}), [initialPort]);
  // The scope is part of the key, so a principal switch never shows the previous principal's read.
  // Settings are event-driven: later screen mounts reuse this principal's completed boot read.
  const query = useFetchQuery<string>({ key: [...queryPrefix, queryScope], fetch: queryFetch }, { enabled: !checking, staleTime: Infinity });
  const invalidate = useInvalidate();
  const [prefixHead, prefixNamespace] = queryPrefix;
  // Refresh notifications can overlap unordered reads. Invalidating the shared prefix revokes an
  // older read's ownership, so a slower earlier fetch cannot override the latest language change.
  useEffect(
    () => initialPort.subscribeToSettingsRefresh({ listener: () => invalidate({ key: [prefixHead, prefixNamespace] }) }),
    [initialPort, invalidate, prefixHead, prefixNamespace],
  );
  // A failed read retains earlier data, or the fallback before the first success.
  return query.data ?? fallbackLocale;
}
