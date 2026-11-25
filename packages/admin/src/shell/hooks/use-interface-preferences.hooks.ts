import { useCallback, useEffect } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { useAdminBootScope } from "../lib/admin-boot-scope.js";

/**
 * @file The operator's interface preferences, read live for the admin shell, which turns them into
 * classes on `.jini-admin-layout` that gate CSS rules:
 *
 * - "Hide the chat button while the chat is open" -> `hides-fab-while-open`, which gates the
 *   hide-while-open rules, so the FAB either hides while the dock is open (the close control
 *   closes it) or stays on top of it and toggles it closed.
 * - "Wrap tabs instead of scrolling" -> `wraps-tabs`, which turns the phone's one-row swipeable tab
 *   strips back into wrapping rows.
 *
 * Same load-then-follow-refreshes shape as `useAdminLocale`: the settings tab's own save echoes
 * back over the settings-changed feed, so flipping a toggle updates the shell without a reload.
 * One read covers every preference in the namespace.
 */

/** The two preferences the shell's layout class list reads; a host's config may carry more. */
export interface InterfacePreferences {
  hideChatFabWhileOpen: boolean;
  wrapTabs: boolean;
}

export interface InterfacePreferencesPort<T extends InterfacePreferences> {
  loadInterface(): Promise<T>;
  subscribeToSettingsRefresh(required: { listener: () => void }): () => void;
}

/** Everything `useInterfacePreferences` reads from the host. Bound once at the host's composition root. */
export interface UseInterfacePreferencesArgs<T extends InterfacePreferences> {
  port: InterfacePreferencesPort<T>;
  /** The settings namespace that owns the preferences; part of the shared cache key. */
  namespace: string;
  /** What the shell uses until the stored values arrive, and after an initial read fails. */
  defaultPreferences: T;
  useFetchQuery: FetchQueryAdapter["useFetchQuery"];
  useInvalidate: FetchQueryAdapter["useInvalidate"];
}

/**
 * `defaultPreferences` until the stored values arrive, so the default behaviour never flickers
 * in. A failed read keeps the last values rather than flipping the shell on a network error.
 *
 * @complexity O(1) per load.
 */
export function useInterfacePreferences<T extends InterfacePreferences>(required: UseInterfacePreferencesArgs<T>, _optional: Record<string, never> = {}): T {
  const { port, namespace, defaultPreferences, useFetchQuery, useInvalidate } = required;
  const { queryScope, checking } = useAdminBootScope();
  const queryFetch = useCallback(() => port.loadInterface(), [port]);
  const query = useFetchQuery<T>({ key: ["settings", namespace, queryScope], fetch: queryFetch }, { enabled: !checking, staleTime: Infinity });
  const invalidate = useInvalidate();
  useEffect(() => port.subscribeToSettingsRefresh({ listener: () => invalidate({ key: ["settings", namespace] }) }), [port, invalidate, namespace]);
  return query.data ?? defaultPreferences;
}

/** `.jini-admin-layout`'s class list: each preference's CSS rules apply only under its class. */
export function resolveAdminLayoutClassName<T extends InterfacePreferences>(preferences: T): string {
  return [
    "jini-admin-layout",
    preferences.hideChatFabWhileOpen ? "hides-fab-while-open" : null,
    preferences.wrapTabs ? "wraps-tabs" : null,
  ].filter(Boolean).join(" ");
}
