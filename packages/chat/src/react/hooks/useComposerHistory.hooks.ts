import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../core/messages.js';
import {
  composerHistoryKeyAction,
  createComposerHistoryState,
  mergeComposerHistory,
  normalizeComposerHistory,
  transitionComposerHistory,
  type ComposerHistoryKeyInput,
  type ComposerHistoryStoragePort,
} from '../../core/composer-history.js';
import { browserComposerHistoryStorage } from './composer-history-storage.js';

const EMPTY_MESSAGES: readonly ChatMessage[] = [];

export interface ComposerHistoryController {
  navigate: (input: ComposerHistoryKeyInput, optional?: {}) => boolean;
  edit: (required: {}, optional?: {}) => void;
}

export function useComposerHistory(
  { setRecalledDraft }: { setRecalledDraft: (text: string) => void },
  { messages = EMPTY_MESSAGES, scope = 'default', storage = browserComposerHistoryStorage, conversationId }: {
    messages?: readonly ChatMessage[];
    scope?: string;
    storage?: ComposerHistoryStoragePort;
    conversationId?: string | null;
  } = {},
): ComposerHistoryController {
  const browseRef = useRef(createComposerHistoryState({}));
  const [recent, setRecent] = useState<readonly string[]>([]);
  const hydratedPortRef = useRef<ComposerHistoryStoragePort | null>(null);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const pendingRef = useRef<string[]>([]);
  const conversationRef = useRef(conversationId);
  const scopeRef = useRef(scope);
  const seenRef = useRef(new Set(messages.map((message) => message.id)));
  const writeQueueRef = useRef(Promise.resolve());
  const current = useMemo(() => messages.filter((message) => message.role === 'user').map((message) => message.content), [messages]);
  const entries = mergeComposerHistory({ recent, current });

  useEffect(() => {
    let cancelled = false;
    pendingRef.current = [];
    hydratedPortRef.current = null;
    setRecent([]);
    setHydratedScope(null);
    browseRef.current = createComposerHistoryState({});
    // Read after this hook's outstanding writes so an injected async store cannot return stale
    // entries when a scope is revisited. A remounted hook's default storage writes synchronously.
    void writeQueueRef.current.then(() => storage.read({ scope }, {})).catch(() => []).then((loaded) => {
      if (cancelled) return;
      // Bootstrap an empty recent store from the already-sent current transcript. This
      // makes opening a new chat useful immediately after installing recall; opening an
      // older transcript later does not reorder an established recent list.
      const seed = loaded.length > 0 ? loaded : current;
      setRecent(normalizeComposerHistory({ entries: [...seed, ...pendingRef.current] }));
      hydratedPortRef.current = storage;
      setHydratedScope(scope);
    });
    return () => { cancelled = true; };
  }, [scope, storage]);

  useEffect(() => {
    const adopted = conversationRef.current == null && conversationId != null && scopeRef.current === scope;
    conversationRef.current = conversationId;
    scopeRef.current = scope;
    if (adopted) return;
    browseRef.current = createComposerHistoryState({});
    // A conversation's existing turns are available for navigation, but merely opening old
    // conversations must not reorder the cross-conversation recent list.
    seenRef.current = new Set(messages.map((message) => message.id));
    // messages is deliberately absent: newly appended turns are handled below, not reseeded.
  }, [conversationId, scope]);

  useEffect(() => {
    const added: string[] = [];
    for (const message of messages) {
      if (!seenRef.current.has(message.id) && message.role === 'user') added.push(message.content);
      seenRef.current.add(message.id);
    }
    if (added.length === 0) return;
    pendingRef.current.push(...added);
    pendingRef.current = normalizeComposerHistory({ entries: pendingRef.current });
    setRecent((previous) => normalizeComposerHistory({ entries: [...previous, ...added] }));
  }, [messages]);

  useEffect(() => {
    if (hydratedScope !== scope || hydratedPortRef.current !== storage) return;
    // Serialize writes; a slow earlier write must not overwrite a later prompt.
    writeQueueRef.current = writeQueueRef.current.then(() => storage.write({ scope, entries: recent }, {})).catch(() => {});
  }, [hydratedScope, recent, scope, storage]);

  const navigate = useCallback((input: ComposerHistoryKeyInput, _optional: {} = {}) => {
    const action = composerHistoryKeyAction(input);
    if (action === null) return false;
    const transition = transitionComposerHistory({ state: browseRef.current, action, text: input.text, entries });
    if (!transition.handled) return false;
    browseRef.current = transition.state;
    // Recall is a view, not an edit to the cached working draft. Reload while copying a
    // recalled entry still restores what the operator was writing before they browsed.
    setRecalledDraft(transition.text);
    return true;
  }, [entries, setRecalledDraft]);

  const edit = useCallback((_required: {}, _optional: {} = {}) => {
    // The first edit leaves history. Its text is now the working draft; stored entries and
    // the original browsing snapshot are never edited in place.
    browseRef.current = createComposerHistoryState({});
  }, []);

  return useMemo(() => ({ navigate, edit }), [navigate, edit]);
}
