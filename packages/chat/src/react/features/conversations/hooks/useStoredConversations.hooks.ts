/**
 * @file The React binding for {@link createConversationController}: one controller per store, read
 * through `useSyncExternalStore`. Every rule and race guard — and the reasoning behind each — lives
 * in the controller (`../conversation-controller.ts`), not here.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ChatMessage } from '../../../../core/messages.js';
import { createConversationController } from '../conversation-controller.js';
import type {
  ConversationLog,
  ConversationStorePort,
  ConversationSummaryLike,
  UseStoredConversations,
} from '../types.js';

/**
 * Owns a chat's persisted conversation threads: which one is open, what's in it, and writing new
 * turns back to the host's store. The list is loaded once on mount.
 *
 * @param getStore the host's store lookup (e.g. a preload bridge accessor). Called once per
 *   identity of `getStore`, never per render; `undefined` makes every action a no-op.
 * @param log where failures are reported; defaults to `console.error`. A host prefixes its own
 *   label here. Must be referentially stable (see below).
 */
export function useStoredConversations<S extends ConversationSummaryLike = ConversationSummaryLike>(
  { getStore }: { getStore: () => ConversationStorePort<S> | undefined },
  { log }: { log?: ConversationLog } = {},
): UseStoredConversations<S> {
  const store = useMemo(() => getStore(), [getStore]);
  // A new `log` identity rebuilds the controller (and drops its state), so a host passes a
  // module-level function, not an inline closure.
  const controller = useMemo(() => createConversationController<S>({ bridge: store }, log ? { log } : {}), [store, log]);
  const subscribe = useCallback((listener: () => void) => controller.subscribe({ listener }), [controller]);
  const state = useSyncExternalStore(subscribe, controller.getState);

  useEffect(() => {
    void controller.refresh();
  }, [controller]);

  const actions = useMemo(() => ({
    select: (id: string) => controller.select({ id }),
    create: controller.create,
    remove: (id: string) => controller.remove({ id }),
    rename: (id: string, title: string) => controller.rename({ id, title }),
    onMessagesChange: (messages: ChatMessage[]) => controller.onMessagesChange({ messages }),
  }), [controller]);
  return { ...state, ...actions };
}
