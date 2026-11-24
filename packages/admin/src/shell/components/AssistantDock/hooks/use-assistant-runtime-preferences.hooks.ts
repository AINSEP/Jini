import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";

/** Structural slice of the host's assistant runtime preferences (the gear's switches and Reply length). */
export interface AssistantRuntimePreferences {
  /** Delegate multi-step or output-heavy work to a subagent when the runtime supports one. */
  preferSubagents: boolean;
  /** Let the runtime use the person's real, logged-in Chrome. */
  useClaudeInChrome: boolean;
  /** How much the assistant writes. */
  replyLength: "short" | "normal" | "detailed";
}

/** The shape of `assistantRuntimePreferencesPort`; a test passes a fake. */
function sameRuntimePreferences(a: AssistantRuntimePreferences, b: AssistantRuntimePreferences): boolean {
  return a.preferSubagents === b.preferSubagents && a.useClaudeInChrome === b.useClaudeInChrome && a.replyLength === b.replyLength;
}

export interface AssistantRuntimePreferencesPort {
  load(input?: Record<string, never>, options?: Record<string, never>): Promise<AssistantRuntimePreferences>;
  save(input: { next: AssistantRuntimePreferences; previous: AssistantRuntimePreferences }, options?: Record<string, never>): Promise<void>;
  subscribe(input: { listener: () => void }, options?: Record<string, never>): () => void;
}

export interface AssistantRuntimePreferencesController {
  preferences: AssistantRuntimePreferences;
  /** Applies a change at once and saves it for this person; the server reads it at the next run. */
  update: (patch: Partial<AssistantRuntimePreferences>) => void;
  /** The last save failed; the choice still shows until the page reloads. */
  saveFailed: boolean;
}

/**
 * The gear's runtime switches and Reply length choice, live — the same
 * optimistic-then-stored flow as `useChatAgentPlugins`: a flip shows at once, is saved per person,
 * and the optimistic copy is dropped once the stored values agree, so a change made elsewhere shows up.
 * `defaults` until the stored values arrive; a failed read keeps them.
 * @param input.namespace - The host's chat-display settings namespace; it scopes the query key.
 * @param input.defaults - The host's default runtime preferences.
 * @param input.useFetchQuery - The host kit's query hook (required; Jini ships no default).
 * @param input.useInvalidate - The host kit's cache-invalidation hook (required).
 * @complexity O(1) per change.
 */
export function useAssistantRuntimePreferences(
  { port, namespace, defaults, useFetchQuery, useInvalidate }: {
    port: AssistantRuntimePreferencesPort; namespace: string; defaults: Readonly<AssistantRuntimePreferences>;
    useFetchQuery: FetchQueryAdapter["useFetchQuery"]; useInvalidate: FetchQueryAdapter["useInvalidate"];
  },
  _options: Record<string, never> = {},
): AssistantRuntimePreferencesController {
  // Stable per namespace, as the module-level key was, so the effects keyed on it do not re-run each render.
  const queryKey = useMemo(() => ["settings", namespace, "assistant-runtime"], [namespace]);
  const fetchPreferences = useCallback(() => port.load({}, {}), [port]);
  const query = useFetchQuery({ key: queryKey, fetch: fetchPreferences }, { staleTime: 0 });
  const invalidate = useInvalidate();
  const [optimistic, setOptimistic] = useState<AssistantRuntimePreferences | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const lastRequested = useRef<AssistantRuntimePreferences | null>(null);
  const pendingSaves = useRef(0);
  const preferences = optimistic ?? query.data ?? defaults;

  useEffect(() => port.subscribe({ listener: () => invalidate({ key: queryKey }) }, {}), [port, invalidate, queryKey]);
  useEffect(() => {
    if (pendingSaves.current === 0 && optimistic && query.data && sameRuntimePreferences(optimistic, query.data)) {
      lastRequested.current = null;
      setOptimistic(null);
    }
  }, [optimistic, query.data]);

  const update = useCallback((patch: Partial<AssistantRuntimePreferences>) => {
    // A quick second flip must diff against the last requested values, not a not-yet-re-read copy.
    const previous = lastRequested.current ?? preferences;
    const next = { ...previous, ...patch };
    lastRequested.current = next;
    pendingSaves.current += 1;
    setOptimistic(next);
    port.save({ next, previous }, {}).then(
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
