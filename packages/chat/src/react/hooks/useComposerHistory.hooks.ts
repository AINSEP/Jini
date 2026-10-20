import { acceptedInputsFromMessages, type AcceptedChatInput } from '../../core/accepted-input.js';
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
  record: (required: { inputs: readonly AcceptedChatInput[] }, optional?: {}) => void;
  navigate: (input: ComposerHistoryKeyInput, optional?: {}) => boolean;
  edit: (required: {}, optional?: {}) => void;
}

export function useComposerHistory(
  { setRecalledDraft }: { setRecalledDraft: (text: string) => void },
  { messages = EMPTY_MESSAGES, scope = 'default', storage = browserComposerHistoryStorage, conversationId, cap = 100 }: {
    cap?: number;
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
  const pendingBaselineRef = useRef<readonly string[]>([]);
  const conversationRef = useRef(conversationId);
  const scopeRef = useRef(scope);
  const inputs = useMemo(() => acceptedInputsFromMessages({ messages }), [messages]);
  const seenRef = useRef(new Set(inputs.flatMap(input => [input.id, ...(input.aliases ?? [])])));
  const writeQueueRef = useRef(Promise.resolve());
  const current = inputs.map(input => input.text);
  const entries = pendingRef.current.length > 0 ? normalizeComposerHistory({ entries: recent }, { cap }) : mergeComposerHistory({ recent, current }, { cap });

  useEffect(() => {
    let cancelled = false;
    pendingRef.current = [];
    pendingBaselineRef.current = [];
    hydratedPortRef.current = null;
    setRecent([]);
    setHydratedScope(null);
    browseRef.current = createComposerHistoryState({});
    // Read after this hook's outstanding writes so an injected async store cannot return stale
    // entries when a scope is revisited. A remounted hook's default storage writes synchronously.
    void writeQueueRef.current.then(() => storage.read({ scope }, cap === 100 ? {} : { cap })).catch(() => []).then((loaded) => {
      if (cancelled) return;
      // Bootstrap an empty recent store from the already-sent current transcript. This
      // makes opening a new chat useful immediately after installing recall; opening an
      // older transcript later does not reorder an established recent list.
      const seed = loaded.length > 0 ? loaded : current;
      const baseline = pendingRef.current.length > 0
        ? mergeComposerHistory({ recent: seed, current: pendingBaselineRef.current }, { cap }) : seed;
      setRecent(normalizeComposerHistory({ entries: [...baseline, ...pendingRef.current] }, { cap }));
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
    pendingRef.current = [];
    pendingBaselineRef.current = [];
    browseRef.current = createComposerHistoryState({});
    // A conversation's existing turns are available for navigation, but merely opening old
    // conversations must not reorder the cross-conversation recent list.
    seenRef.current = new Set(inputs.flatMap(input => [input.id, ...(input.aliases ?? [])]));
    // messages is deliberately absent: newly appended turns are handled below, not reseeded.
  }, [conversationId, scope]);

  /** All acceptance paths, including replay observations, claim identities before writing recall. */
  const record = useCallback(({ inputs: accepted }: { inputs: readonly AcceptedChatInput[] }, _options = {}) => {
    const added: string[] = [];
    const newIds = new Set<string>();
    for (const input of accepted) {
      const ids = [input.id, ...(input.aliases ?? [])];
      const seen = ids.some(id => seenRef.current.has(id));
      for (const id of ids) seenRef.current.add(id);
      if (!seen) {
        added.push(input.text);
        for (const id of ids) newIds.add(id);
      }
    }
    if (added.length === 0) return;
    const firstAcceptance = pendingRef.current.length === 0;
    pendingRef.current = normalizeComposerHistory({ entries: [...pendingRef.current, ...added] }, { cap });
    const before = inputs.filter(input => !newIds.has(input.id)).map(input => input.text);
    if (firstAcceptance) pendingBaselineRef.current = before;
    setRecent(previous => normalizeComposerHistory({ entries: [...(firstAcceptance ? mergeComposerHistory({ recent: previous, current: before }, { cap }) : previous), ...added] }, { cap }));
  }, [cap, inputs]);

  useEffect(() => { record({ inputs }); }, [inputs, record]);

  useEffect(() => {
    if (hydratedScope !== scope || hydratedPortRef.current !== storage) return;
    // Serialize writes; a slow earlier write must not overwrite a later prompt.
    writeQueueRef.current = writeQueueRef.current.then(() => storage.write({ scope, entries: normalizeComposerHistory({ entries: recent }, { cap }) }, cap === 100 ? {} : { cap })).catch(() => {});
  }, [hydratedScope, recent, scope, storage, cap]);

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

  return useMemo(() => ({ navigate, edit, record }), [navigate, edit, record]);
}
