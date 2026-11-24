import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetchQuery, useInvalidate } from "../../../../react/kit.js";

import { DEFAULT_CHAT_AGENT_PLUGINS, type ChatAgentPlugins } from "../chat-agent-plugin-preferences.js";

/** The shape of `chatAgentPluginsPreferencePort`; a test passes a fake. */
export interface ChatAgentPluginsPort {
  load(input?: Record<string, never>, options?: Record<string, never>): Promise<ChatAgentPlugins>;
  save(input: { next: ChatAgentPlugins; previous: ChatAgentPlugins }, options?: Record<string, never>): Promise<void>;
  subscribe(input: { listener: () => void }, options?: Record<string, never>): () => void;
}

export interface ChatAgentPluginsController {
  mode: ChatAgentPlugins;
  /** Applies a choice at once (Off hides the "Using" chip) and saves it for this person. */
  update: (mode: ChatAgentPlugins) => void;
  /** The last save failed; the choice still applies until the page reloads. */
  saveFailed: boolean;
}

/**
 * The gear's Agent plugins choice, live — the same optimistic-then-stored flow as
 * `useChatDisplayPreferences`: a choice applies on the spot, is saved per person, and the optimistic
 * copy is dropped once the stored value agrees, so a change made elsewhere shows up again.
 * {@link DEFAULT_CHAT_AGENT_PLUGINS} until the stored value arrives; a failed read keeps it.
 * @param input.namespace - The host's chat-display settings namespace; it scopes the query key.
 * @complexity O(1) per change.
 */
export function useChatAgentPlugins(
  { port, namespace }: { port: ChatAgentPluginsPort; namespace: string }, _options: Record<string, never> = {},
): ChatAgentPluginsController {
  // Stable per namespace, as the module-level key was, so the effects keyed on it do not re-run each render.
  const queryKey = useMemo(() => ["settings", namespace, "agent-plugins"], [namespace]);
  const fetchMode = useCallback(() => port.load({}, {}), [port]);
  const query = useFetchQuery({ key: queryKey, fetch: fetchMode }, { staleTime: 0 });
  const invalidate = useInvalidate();
  const [optimistic, setOptimistic] = useState<ChatAgentPlugins | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const lastRequested = useRef<ChatAgentPlugins | null>(null);
  const pendingSaves = useRef(0);
  const mode = optimistic ?? query.data ?? DEFAULT_CHAT_AGENT_PLUGINS;

  useEffect(() => port.subscribe({ listener: () => invalidate({ key: queryKey }) }, {}), [port, invalidate, queryKey]);
  useEffect(() => {
    if (pendingSaves.current === 0 && optimistic && query.data === optimistic) {
      lastRequested.current = null;
      setOptimistic(null);
    }
  }, [optimistic, query.data]);

  const update = useCallback((next: ChatAgentPlugins) => {
    // A quick second choice must diff against the last requested one, not a not-yet-re-read value.
    const previous = lastRequested.current ?? mode;
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
  }, [mode, port, invalidate, queryKey]);

  return { mode, update, saveFailed };
}

