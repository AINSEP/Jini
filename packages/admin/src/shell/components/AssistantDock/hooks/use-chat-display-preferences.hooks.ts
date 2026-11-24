import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";

/** The tool-call card display modes: every card, one fold-up line per turn, or none. */
export type ChatToolCallDisplay = "show" | "collapsed" | "hidden";

export interface ChatDisplayPreferences {
  /** Every tool card, one fold-up line per turn, or only failed calls. */
  toolCalls: ChatToolCallDisplay;
  /** The "Done · time · cost · total" line under each reply. */
  showUsageLine: boolean;
  /** The model's reasoning, folded where it happened. */
  showThinking: boolean;
}

/** Whether two preference sets say the same thing (lets the hook drop its optimistic copy). */
export function sameChatDisplay({ a, b }: { a: ChatDisplayPreferences; b: ChatDisplayPreferences }): boolean {
  return a.toolCalls === b.toolCalls && a.showUsageLine === b.showUsageLine && a.showThinking === b.showThinking;
}

export interface ChatDisplayPreferencesPort {
  load(): Promise<ChatDisplayPreferences>;
  save(input: { next: ChatDisplayPreferences; previous: ChatDisplayPreferences }, options?: Record<string, never>): Promise<void>;
  subscribeToSettingsRefresh(input: { listener: () => void }, options?: Record<string, never>): () => void;
}

export interface ChatDisplayPreferencesController {
  preferences: ChatDisplayPreferences;
  /** Applies a change at once and saves it for this operator. */
  update: (patch: Partial<ChatDisplayPreferences>) => void;
  /** The last save failed; the choice still applies until the page reloads. */
  saveFailed: boolean;
}

/**
 * The dock's Chat settings → Display choices, live. A change applies on the spot through an
 * optimistic copy (the pane re-renders with the new props, no reload), is saved per operator, and the
 * copy is dropped once the stored values say the same thing — so a later change made elsewhere
 * (another tab's save echoing over the settings feed) shows up again.
 *
 * `defaults` until the stored values arrive; a failed read keeps the defaults.
 * @param input.namespace - The host's settings namespace; it scopes the query key.
 * @param input.defaults - The host's default display choices.
 * @param input.useFetchQuery - The host kit's query hook (required; Jini ships no default).
 * @param input.useInvalidate - The host kit's cache-invalidation hook (required).
 * @complexity O(1) per change.
 */
export function useChatDisplayPreferences(
  { port, namespace, defaults, useFetchQuery, useInvalidate }: {
    port: ChatDisplayPreferencesPort; namespace: string; defaults: Readonly<ChatDisplayPreferences>;
    useFetchQuery: FetchQueryAdapter["useFetchQuery"]; useInvalidate: FetchQueryAdapter["useInvalidate"];
  },
  _optional: Record<string, never> = {},
): ChatDisplayPreferencesController {
  // Stable per namespace, so the effects keyed on it do not re-run each render.
  const queryKey = useMemo(() => ["settings", namespace, "chat-display"], [namespace]);
  const fetchPreferences = useCallback(() => port.load(), [port]);
  const query = useFetchQuery({ key: queryKey, fetch: fetchPreferences }, { staleTime: 0 });
  const invalidate = useInvalidate();
  const [optimistic, setOptimistic] = useState<ChatDisplayPreferences | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const lastRequested = useRef<ChatDisplayPreferences | null>(null);
  const pendingSaves = useRef(0);
  const stored = query.data ?? defaults;
  const preferences = optimistic ?? stored;

  useEffect(() => port.subscribeToSettingsRefresh({ listener: () => invalidate({ key: queryKey }) }), [port, invalidate, queryKey]);
  useEffect(() => {
    if (pendingSaves.current === 0 && optimistic && query.data && sameChatDisplay({ a: optimistic, b: query.data })) {
      lastRequested.current = null;
      setOptimistic(null);
    }
  }, [optimistic, query.data]);

  const update = useCallback((patch: Partial<ChatDisplayPreferences>) => {
    // A reversal must undo the last requested write, even before its re-read (or React render).
    const previous = lastRequested.current ?? preferences;
    const next = { ...previous, ...patch };
    lastRequested.current = next;
    pendingSaves.current += 1;
    setOptimistic(next);
    port.save({ next, previous }).then(
      () => {
        pendingSaves.current -= 1;
        setSaveFailed(false);
        invalidate({ key: queryKey });
      },
      () => {
        pendingSaves.current -= 1;
        setSaveFailed(true);
      },
    );
  }, [preferences, port, invalidate, queryKey]);

  return { preferences, update, saveFailed };
}
